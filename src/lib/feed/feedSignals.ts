import { submit as outboxSubmit, type FeedSignalPayload, type HideReason } from "@/lib/offline/outbox";

/**
 * S12-F1 · SIGNALS — THE ONE WAY A MEMBER'S OWN ATTENTION IS RECORDED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Gate: "Likes, comments, shares, saves, follows, profile visits, time on post,
 * video watch %, skips (own-member data only, via the outbox) — Signals
 * recorded exactly once; no other member can read them."
 *
 * What already had a home, and stays there (F2 reads those tables, nothing is
 * copied): likes → post_reactions, comments → post_comments, shares to the wall
 * → post_shares, follows → follows, "seen" → feed_events. Saves: the product
 * has no save feature yet; it gets its own table when it is built. Hide and
 * mute (S12-F1 Extra A / D) had no home either: hidePost / muteAuthor below.
 *
 * What had no home, and is recorded here: time on post (dwell), video watch %,
 * fast skips, "Copy link" share clicks and profile visits. They travel through
 * the OFF-2 outbox (kind "feed_signals") into feed_signal_events; the database
 * folds each row it actually inserts into per-viewer aggregates
 * (feed_post_signals, feed_author_signals). Only the member can read their own
 * rows (RLS), and nothing about their own posts/profile is recorded.
 *
 * The feed's signals are measured by SeenTracker (useFeedEventTracker.ts) — the
 * same engine and the same visibility discipline as "seen". This file holds
 * what is shared with surfaces outside the feed: the id maker, the outbox
 * sender, and the profile-visit recorder.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** One profile visit per viewer per profile per this window (StrictMode double effects, back-and-forth navigation). */
export const PROFILE_VISIT_DEDUPE_MS = 30 * 60_000;

export type SubmitSignals = (userId: string, signals: FeedSignalPayload[]) => Promise<unknown>;

/** The default sender: one OFF-2 outbox item per batch. */
export const submitSignalsToOutbox: SubmitSignals = (userId, signals) => outboxSubmit(userId, { kind: "feed_signals", signals });

/**
 * A v4 UUID, made ONCE per row when it is recorded — the row's primary key and
 * so its idempotency key: every resend of it is the same row.
 */
export function makeEventId(): string {
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
 * VIDEO WATCH % — what was PLAYED, not where the playhead is: seeking to the
 * end is not watching it. Between two `timeupdate`s a playing video advances
 * ~0.25 s; a jump bigger than MAX_PLAY_STEP_S (or backwards) is a seek, a loop
 * or a stall and adds nothing. A loop keeps adding, so the % is capped at 100.
 */
export const MAX_PLAY_STEP_S = 1.5;
export function playedStep(lastT: number, nowT: number): number {
  const d = nowT - lastT;
  return Number.isFinite(d) && d > 0 && d < MAX_PLAY_STEP_S ? d : 0;
}
export function watchPercent(playedS: number, durationS: number): number {
  if (!(durationS > 0) || !Number.isFinite(playedS)) return 0;
  return Math.max(0, Math.min(100, Math.floor((playedS / durationS) * 100)));
}

/* ── S12-F1 Extra A / Extra D · hide a post, mute an account ───────────────
 * The member's standing choices (UI comes in a later unit). Each is ONE outbox
 * item: kept on the device first, sent once when online; the server's natural
 * primary keys make a resend the same row. They are member actions, not
 * telemetry — ordered like a like/comment, and a refusal is announced. Mute /
 * unmute of one author collapse to the last intent before sending.
 * Returns the outbox's answer, or null when there is nothing to record. */
type OutboxSubmit = typeof outboxSubmit;

export function hidePost(userId: string | null | undefined, postId: string, reason: HideReason = "not_interested", submit: OutboxSubmit = outboxSubmit) {
  if (!userId || !postId) return Promise.resolve(null);
  return submit(userId, { kind: "hide_post", postId, reason });
}

export function muteAuthor(userId: string | null | undefined, authorId: string, submit: OutboxSubmit = outboxSubmit) {
  if (!userId || !authorId || userId === authorId) return Promise.resolve(null);
  return submit(userId, { kind: "mute", authorId });
}

export function unmuteAuthor(userId: string | null | undefined, authorId: string, submit: OutboxSubmit = outboxSubmit) {
  if (!userId || !authorId || userId === authorId) return Promise.resolve(null);
  return submit(userId, { kind: "unmute", authorId });
}

const lastVisit = new Map<string, number>();

/** Tests only. */
export function __resetProfileVisits(): void {
  lastVisit.clear();
}

/**
 * A member opened another member's profile. Returns whether it was recorded.
 * Never their own profile; never from a hidden tab (a profile restored in a
 * background tab was not visited); once per PROFILE_VISIT_DEDUPE_MS. A visit
 * is one user action, so it goes out as its own one-row outbox item — the
 * outbox is what keeps it offline-safe and exactly once.
 */
export function recordProfileVisit(
  viewerId: string | null | undefined,
  profileId: string | null | undefined,
  submit: SubmitSignals = submitSignalsToOutbox,
  now: number = Date.now(),
): boolean {
  if (!viewerId || !profileId || viewerId === profileId) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  const key = `${viewerId}:${profileId}`;
  const last = lastVisit.get(key);
  if (last !== undefined && now - last < PROFILE_VISIT_DEDUPE_MS) return false;
  lastVisit.set(key, now);
  try {
    void Promise.resolve(submit(viewerId, [{ id: makeEventId(), kind: "profile_visit", post_id: null, subject_id: profileId, value: 0 }]))
      .catch(() => undefined);
  } catch {
    // Telemetry must never break the profile page.
  }
  return true;
}
