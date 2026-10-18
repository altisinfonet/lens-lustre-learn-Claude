import { useCallback, useEffect, useMemo, useRef } from "react";
import { submit as outboxSubmit, type FeedEventPayload, type FeedSignalPayload } from "@/lib/offline/outbox";
import { startVisibilityInterval } from "@/lib/timers/visibilityInterval";
import { makeEventId, submitSignalsToOutbox, type SubmitSignals } from "@/lib/feed/feedSignals";

export type { SubmitSignals } from "@/lib/feed/feedSignals";

/**
 * STAGE L2 (F-REV4-8) — WHAT THE MEMBER HAS SEEN, RECORDED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG. This hook existed since 2026-07-09, and `Feed.tsx` took
 * `trackViewStart` / `trackViewEnd` from it and never called either. Not once,
 * in all of git history. `feed_events` held 0 view rows, so for every member the
 * database's "seen" set was empty, every post was permanently "unseen", and the
 * feed could never move on from what it had already shown. A failed insert was
 * also swallowed (`catch {}`), so even a connected tracker would have lost
 * events silently on a weak signal.
 *
 * WHAT IT DOES NOW
 *   · A post card is SEEN when at least VIEW_VISIBLE_RATIO of it — or, for a
 *     card taller than the screen, VIEW_VIEWPORT_SHARE of the viewport — is on
 *     screen for VIEW_DWELL_MS without a break (per-card IntersectionObserver,
 *     usePostSeenObserver.ts). Scrolling past is not a view; neither is a card
 *     on a hidden tab or a backgrounded app — the clocks stop.
 *   · One view per post per feed session. A refresh starts a new session, so a
 *     post shown again later can be recorded again (that is what moves a
 *     recycled post to the back of the queue).
 *   · Events are sent through the OFF-2 OUTBOX, never inserted directly: on the
 *     device first (survives a kill), then sent; a network failure is retried
 *     with back-off instead of dropped. Each event's primary key is made HERE,
 *     once, so a resend after a lost answer is the same row (exactly once).
 *   · Flushed every FLUSH_INTERVAL_MS while visible, immediately before a
 *     refresh (so the next deal already knows), on the way out — tab hidden,
 *     `pagehide`, Capacitor App `pause` / `appStateChange` inactive, unmount —
 *     and again on the way back in (`resume`, tab visible, `pageshow`), for
 *     anything recorded just before the app was frozen.
 *   · Nothing about the member's OWN posts is recorded, views or actions: see
 *     SeenTracker.report and SeenTracker.action.
 *
 * S12-F1 · SIGNALS, FROM THE SAME ENGINE (no second tracker, no second clock)
 *   · TIME ON POST. While a card is visible enough and the page is on screen, a
 *     stopwatch runs — timestamps only, no timer. It stops on scroll-away and
 *     on pause (tab hidden, app backgrounded), so hidden time is never counted.
 *     A visit that reached VIEW_DWELL_MS is dwell; each flush checkpoints a card
 *     still on screen, so a long look is not held back until the scroll.
 *   · SKIP. A visit of SKIP_MIN_MS … VIEW_DWELL_MS that ends by scrolling away,
 *     on a post not seen this session: one per post per session. A fling under
 *     SKIP_MIN_MS is nothing; the tab going hidden is not a skip.
 *   · VIDEO WATCH %. The highest % played (FeedVideoCard reports it), sent when
 *     it grows — never one request per timeupdate.
 *   · SHARE CLICK ("Copy link"): one per post per session.
 *   · Batched with the seen-events: the same FLUSH_INTERVAL_MS / MAX_BATCH and
 *     the same flush points; sent through the outbox as kind "feed_signals".
 *     Each signal's id is made here, once (exactly once on the wire).
 *   · Never about the member's own post; never while the page is hidden.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Share of the card that must be on screen. */
export const VIEW_VISIBLE_RATIO = 0.5;
/** …or share of the viewport the card must fill (a card taller than 2× the screen can never be 50 % visible). */
export const VIEW_VIEWPORT_SHARE = 0.5;
/** For this long, without interruption. */
export const VIEW_DWELL_MS = 1000;
/** Flush cadence while the page is visible (no request when nothing is waiting). */
export const FLUSH_INTERVAL_MS = 15_000;
/** Events per outbox item / per insert. */
export const MAX_BATCH = 25;
/** How long a refresh waits for the seen-flush before dealing anyway (the events stay in the outbox). */
export const REFRESH_FLUSH_TIMEOUT_MS = 1500;
/** S12-F1 · a visit at least this long (and under VIEW_DWELL_MS) that ends by scrolling away is a skip; shorter is a fling. */
export const SKIP_MIN_MS = 300;
/** S12-F1 · one dwell signal never claims more than this (feed_signal_events' CHECK bound). */
export const MAX_DWELL_EVENT_MS = 600_000;

export type FeedAction = "like" | "share" | "comment" | "click";
export type SubmitEvents = (userId: string, events: FeedEventPayload[]) => Promise<unknown>;

interface Clock {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Milliseconds; the dwell stopwatch reads it (no timer). Defaults to Date.now. */
  now?: () => number;
}
const realClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** S12-F1 · one continuous on-screen visit of a card. */
interface Visit {
  authorId: string;
  start: number;
  /** Already reached VIEW_DWELL_MS (or was checkpointed): what remains is dwell, never a skip. */
  counted: boolean;
}

/**
 * The engine, with no React in it, so the threshold, the dedupe and the
 * flushing can be driven by a test with a fake clock.
 */
export class SeenTracker {
  readonly userId: string;
  private readonly send: SubmitEvents;
  private readonly clock: Clock;
  private readonly makeId: () => string;
  /** Posts on screen enough to count, right now (postId → authorId). */
  private readonly visible = new Map<string, string>();
  /** Running one-second clocks. */
  private readonly timers = new Map<string, unknown>();
  /** Posts already recorded as seen in this feed session. */
  private readonly seen = new Set<string>();
  private batch: FeedEventPayload[] = [];
  private paused = false;
  /* ── S12-F1 signals ── */
  private readonly sendSignals: SubmitSignals;
  /** Running visits (postId → visit). */
  private readonly visits = new Map<string, Visit>();
  /** Dwell measured and not yet turned into a signal (postId → author, ms). */
  private readonly dwell = new Map<string, { authorId: string; ms: number }>();
  /** Posts skipped / share-clicked in this feed session. */
  private readonly skipped = new Set<string>();
  private readonly shared = new Set<string>();
  /** Highest watch % per post, and the highest already sent. */
  private readonly watched = new Map<string, { authorId: string; pct: number; sent: number }>();
  private signals: FeedSignalPayload[] = [];

  constructor(opts: { userId: string; send: SubmitEvents; sendSignals?: SubmitSignals; clock?: Clock; makeId?: () => string }) {
    this.userId = opts.userId;
    this.send = opts.send;
    // The hook always passes the outbox sender; a bare engine (tests of the
    // seen-events alone) measures signals and sends them nowhere.
    this.sendSignals = opts.sendSignals ?? (async () => undefined);
    this.clock = opts.clock ?? realClock;
    this.makeId = opts.makeId ?? makeEventId;
  }

  private now(): number {
    return this.clock.now ? this.clock.now() : Date.now();
  }

  /**
   * The per-card observer reports whether the card is visible enough now.
   *
   * The member's OWN posts are never recorded as seen: "seen" ranks other
   * people's posts reaching you, view counts already exclude the author, and
   * recording it would drop a member's fresh post from the top of their own
   * feed on the very next refresh (R-LIVE-5 would treat it as seen).
   */
  report(postId: string, authorId: string, visibleEnough: boolean): void {
    if (authorId === this.userId) return;
    if (visibleEnough) {
      this.visible.set(postId, authorId);
      if (!this.paused) { this.arm(postId, authorId); this.startVisit(postId, authorId); }
    } else {
      this.visible.delete(postId);
      this.disarm(postId);
      this.endVisit(postId, true);
    }
  }

  /**
   * S12-F1 · FeedVideoCard reports the % of the video played so far. The
   * highest value is kept and sent at the next flush, only if it grew.
   */
  watch(postId: string, authorId: string, pct: number): void {
    if (authorId === this.userId || this.paused || !Number.isFinite(pct)) return;
    const v = Math.max(0, Math.min(100, Math.floor(pct)));
    const w = this.watched.get(postId);
    if (!w) this.watched.set(postId, { authorId, pct: v, sent: -1 });
    else if (v > w.pct) w.pct = v;
  }

  /** S12-F1 · "Copy link" on a post: one per post per feed session. */
  shareClick(postId: string, authorId: string): void {
    if (authorId === this.userId || this.shared.has(postId)) return;
    this.shared.add(postId);
    this.pushSignal({ id: this.makeId(), kind: "share_click", post_id: postId, subject_id: authorId, value: 0 });
  }

  /**
   * A like / share / comment / click on a post (kept from the original tracker).
   *
   * ⚠ NOT ON THE MEMBER'S OWN POST. The database renames such an event to
   * `self_like` / `self_share` / `self_comment` (validate_feed_event_author,
   * "won't boost own ranking") — and feed_events' own CHECK constraint has no
   * such value, so the row is refused, and with it EVERY other row of the same
   * INSERT. One like on your own photograph would take a whole batch of views
   * with it. (Proved on production's function bodies:
   * docs/evidence/d1/L2-feed-freshness, "a like on the member's OWN post".)
   * The event carried no ranking weight by design; it is simply not sent.
   */
  action(postId: string, authorId: string, action: FeedAction): void {
    if (authorId === this.userId) return;
    this.push({ id: this.makeId(), post_id: postId, author_id: authorId, event_type: action, dwell_ms: 0 });
  }

  /** Tab hidden / app backgrounded: a screen nobody is looking at is not a view. */
  pause(): void {
    this.paused = true;
    for (const id of [...this.timers.keys()]) this.disarm(id);
    for (const id of [...this.visits.keys()]) this.endVisit(id, false);
  }

  /** Back on screen: the cards still visible start their second again. */
  resume(): void {
    this.paused = false;
    for (const [id, author] of this.visible) { this.arm(id, author); this.startVisit(id, author); }
  }

  /** A refresh is a new feed session: every post may be recorded again. */
  newSession(): void {
    for (const id of [...this.timers.keys()]) this.disarm(id);
    for (const id of [...this.visits.keys()]) this.endVisit(id, false);
    this.seen.clear();
    this.skipped.clear();
    this.shared.clear();
    if (!this.paused) for (const [id, author] of this.visible) { this.arm(id, author); this.startVisit(id, author); }
  }

  /** Hand everything recorded so far to the outbox. Never throws. */
  flush(): Promise<void> {
    this.collectSignals();
    const sends: Promise<unknown>[] = [];
    while (this.batch.length) {
      const c = this.batch.splice(0, MAX_BATCH);
      sends.push(Promise.resolve().then(() => this.send(this.userId, c)).catch(() => undefined));
    }
    while (this.signals.length) {
      const c = this.signals.splice(0, MAX_BATCH);
      sends.push(Promise.resolve().then(() => this.sendSignals(this.userId, c)).catch(() => undefined));
    }
    if (sends.length === 0) return Promise.resolve();
    return Promise.all(sends).then(() => undefined);
  }

  /** Recorded and not yet handed to the outbox (tests, diagnostics). */
  get unsent(): readonly FeedEventPayload[] {
    return this.batch;
  }

  /** S12-F1 · signals recorded and not yet handed to the outbox (tests, diagnostics). */
  get unsentSignals(): readonly FeedSignalPayload[] {
    return this.signals;
  }

  private startVisit(postId: string, authorId: string): void {
    if (!this.visits.has(postId)) this.visits.set(postId, { authorId, start: this.now(), counted: false });
  }

  /** `scrolledAway`: the card left the screen (a skip is possible); false = the page was hidden or the session ended. */
  private endVisit(postId: string, scrolledAway: boolean): void {
    const v = this.visits.get(postId);
    if (!v) return;
    this.visits.delete(postId);
    const ms = Math.max(0, this.now() - v.start);
    if (v.counted || ms >= VIEW_DWELL_MS) {
      this.addDwell(postId, v.authorId, ms);
    } else if (scrolledAway && ms >= SKIP_MIN_MS && !this.seen.has(postId) && !this.skipped.has(postId)) {
      this.skipped.add(postId);
      this.pushSignal({ id: this.makeId(), kind: "skip", post_id: postId, subject_id: v.authorId, value: 0 });
    }
  }

  private addDwell(postId: string, authorId: string, ms: number): void {
    if (ms <= 0) return;
    const d = this.dwell.get(postId);
    if (d) d.ms += ms;
    else this.dwell.set(postId, { authorId, ms });
  }

  /** Turn measured dwell (checkpointing visits still running) and grown watch % into signals. */
  private collectSignals(): void {
    const now = this.now();
    for (const [id, v] of this.visits) {
      const ms = now - v.start;
      if (v.counted || ms >= VIEW_DWELL_MS) {
        this.addDwell(id, v.authorId, ms);
        v.start = now;
        v.counted = true;
      }
    }
    for (const [id, d] of this.dwell) {
      this.signals.push({ id: this.makeId(), kind: "dwell", post_id: id, subject_id: d.authorId, value: Math.min(Math.round(d.ms), MAX_DWELL_EVENT_MS) });
    }
    this.dwell.clear();
    for (const [id, w] of this.watched) {
      if (w.pct > w.sent) {
        this.signals.push({ id: this.makeId(), kind: "watch", post_id: id, subject_id: w.authorId, value: w.pct });
        w.sent = w.pct;
      }
    }
  }

  private pushSignal(s: FeedSignalPayload): void {
    this.signals.push(s);
    if (this.signals.length >= MAX_BATCH) void this.flush();
  }

  private arm(postId: string, authorId: string): void {
    if (this.seen.has(postId) || this.timers.has(postId)) return;
    this.timers.set(postId, this.clock.setTimeout(() => {
      this.timers.delete(postId);
      if (this.paused || !this.visible.has(postId) || this.seen.has(postId)) return;
      this.seen.add(postId);
      this.push({ id: this.makeId(), post_id: postId, author_id: authorId, event_type: "view", dwell_ms: VIEW_DWELL_MS });
    }, VIEW_DWELL_MS));
  }

  private disarm(postId: string): void {
    const t = this.timers.get(postId);
    if (t !== undefined) {
      this.clock.clearTimeout(t);
      this.timers.delete(postId);
    }
  }

  private push(e: FeedEventPayload): void {
    this.batch.push(e);
    if (this.batch.length >= MAX_BATCH) void this.flush();
  }
}

/** The default sender: one OFF-2 outbox item per batch. */
export const submitToOutbox: SubmitEvents = (userId, events) => outboxSubmit(userId, { kind: "feed_events", events });

type CapListenerHandle = { remove?: () => void };
type CapApp = { addListener: (event: string, cb: (s?: { isActive?: boolean }) => void) => CapListenerHandle | Promise<CapListenerHandle> | void };
/** Read through the runtime global, never an import — see src/lib/timers/visibilityInterval.ts (CAPACITOR). */
const capApp = () => (globalThis as unknown as { Capacitor?: { Plugins?: { App?: CapApp } } }).Capacitor?.Plugins?.App;

export interface FeedEventTracker {
  /** For usePostSeenObserver: is this card visible enough right now? */
  reportVisibility: (postId: string, authorId: string, visibleEnough: boolean) => void;
  trackAction: (postId: string, authorId: string, action: FeedAction) => void;
  /** S12-F1 · the % of a video played so far (FeedVideoCard). */
  trackWatch: (postId: string, authorId: string, pct: number) => void;
  /** S12-F1 · "Copy link" on a post. */
  trackShareClick: (postId: string, authorId: string) => void;
  /** Send what is recorded now; resolves when sent or after `timeoutMs`, whichever is first. */
  flushNow: (timeoutMs?: number) => Promise<void>;
  /** Start a new feed session (call when a refresh has dealt a new hand). */
  newSession: () => void;
}

export function useFeedEventTracker(
  userId: string | undefined,
  send: SubmitEvents = submitToOutbox,
  sendSignals: SubmitSignals = submitSignalsToOutbox,
): FeedEventTracker {
  const trackerRef = useRef<SeenTracker | null>(null);
  if (userId && trackerRef.current?.userId !== userId) {
    trackerRef.current = new SeenTracker({ userId, send, sendSignals });
  } else if (!userId) {
    trackerRef.current = null;
  }

  useEffect(() => {
    const t = trackerRef.current;
    if (!userId || !t) return;
    // Start in step with the page: a tab opened in the background has nobody
    // looking at it, and a tracker paused by an earlier clean-up of this effect
    // (React StrictMode runs effects twice) must start again.
    if (document.hidden) t.pause(); else t.resume();
    const stopInterval = startVisibilityInterval(() => { void t.flush(); }, FLUSH_INTERVAL_MS);
    const away = () => { t.pause(); void t.flush(); };
    const back = () => { t.resume(); void t.flush(); };
    const onVisibility = () => { if (document.hidden) away(); else back(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", away);
    // A page restored from the back/forward cache gets `pageshow`, not always a
    // visibilitychange — without this it would stay paused for good.
    window.addEventListener("pageshow", back);

    // Android can background the app without `document.hidden` changing.
    const handles: Array<CapListenerHandle | Promise<CapListenerHandle> | void> = [];
    try {
      const app = capApp();
      if (app) {
        handles.push(app.addListener("pause", away));
        handles.push(app.addListener("resume", back));
        handles.push(app.addListener("appStateChange", (s) => { if (s?.isActive === false) away(); else back(); }));
      }
    } catch {
      // Web, or an app build without the App plugin: visibilitychange + pagehide cover it.
    }

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("pageshow", back);
      for (const h of handles) {
        void Promise.resolve(h).then((x) => { try { (x as CapListenerHandle | undefined)?.remove?.(); } catch { /* must not break unmount */ } });
      }
      t.pause();
      void t.flush();
    };
  }, [userId]);

  const reportVisibility = useCallback((postId: string, authorId: string, visibleEnough: boolean) => {
    trackerRef.current?.report(postId, authorId, visibleEnough);
  }, []);
  const trackAction = useCallback((postId: string, authorId: string, action: FeedAction) => {
    trackerRef.current?.action(postId, authorId, action);
  }, []);
  const flushNow = useCallback((timeoutMs = REFRESH_FLUSH_TIMEOUT_MS) => {
    const t = trackerRef.current;
    if (!t) return Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((r) => { timer = setTimeout(r, timeoutMs); });
    return Promise.race([t.flush(), cap]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  }, []);
  const newSession = useCallback(() => { trackerRef.current?.newSession(); }, []);
  const trackWatch = useCallback((postId: string, authorId: string, pct: number) => {
    trackerRef.current?.watch(postId, authorId, pct);
  }, []);
  const trackShareClick = useCallback((postId: string, authorId: string) => {
    trackerRef.current?.shareClick(postId, authorId);
  }, []);

  return useMemo(
    () => ({ reportVisibility, trackAction, flushNow, newSession, trackWatch, trackShareClick }),
    [reportVisibility, trackAction, flushNow, newSession, trackWatch, trackShareClick],
  );
}
