import { useCallback, useEffect, useMemo, useRef } from "react";
import { submit as outboxSubmit, type FeedEventPayload } from "@/lib/offline/outbox";
import { startVisibilityInterval } from "@/lib/timers/visibilityInterval";

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

export type FeedAction = "like" | "share" | "comment" | "click";
export type SubmitEvents = (userId: string, events: FeedEventPayload[]) => Promise<unknown>;

interface Clock {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}
const realClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

function makeEventId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Old WebView without randomUUID: still a v4 UUID from the CSPRNG.
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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

  constructor(opts: { userId: string; send: SubmitEvents; clock?: Clock; makeId?: () => string }) {
    this.userId = opts.userId;
    this.send = opts.send;
    this.clock = opts.clock ?? realClock;
    this.makeId = opts.makeId ?? makeEventId;
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
      if (!this.paused) this.arm(postId, authorId);
    } else {
      this.visible.delete(postId);
      this.disarm(postId);
    }
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
  }

  /** Back on screen: the cards still visible start their second again. */
  resume(): void {
    this.paused = false;
    for (const [id, author] of this.visible) this.arm(id, author);
  }

  /** A refresh is a new feed session: every post may be recorded again. */
  newSession(): void {
    for (const id of [...this.timers.keys()]) this.disarm(id);
    this.seen.clear();
    if (!this.paused) for (const [id, author] of this.visible) this.arm(id, author);
  }

  /** Hand everything recorded so far to the outbox. Never throws. */
  flush(): Promise<void> {
    if (this.batch.length === 0) return Promise.resolve();
    const chunks: FeedEventPayload[][] = [];
    while (this.batch.length) chunks.push(this.batch.splice(0, MAX_BATCH));
    return Promise.all(chunks.map((c) => Promise.resolve().then(() => this.send(this.userId, c)).catch(() => undefined))).then(() => undefined);
  }

  /** Recorded and not yet handed to the outbox (tests, diagnostics). */
  get unsent(): readonly FeedEventPayload[] {
    return this.batch;
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
  /** Send what is recorded now; resolves when sent or after `timeoutMs`, whichever is first. */
  flushNow: (timeoutMs?: number) => Promise<void>;
  /** Start a new feed session (call when a refresh has dealt a new hand). */
  newSession: () => void;
}

export function useFeedEventTracker(userId: string | undefined, send: SubmitEvents = submitToOutbox): FeedEventTracker {
  const trackerRef = useRef<SeenTracker | null>(null);
  if (userId && trackerRef.current?.userId !== userId) {
    trackerRef.current = new SeenTracker({ userId, send });
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

  return useMemo(() => ({ reportVisibility, trackAction, flushNow, newSession }), [reportVisibility, trackAction, flushNow, newSession]);
}
