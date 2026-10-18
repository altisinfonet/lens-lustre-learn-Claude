/**
 * OFF-2 · THE OUTBOX. An action made with no network is kept on the device and
 * sent once — exactly once — when the network comes back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, R-90: "the app must work on poor network and with no network, like
 * FB/Insta." OFF-5 G4: an action is QUEUED or ONLINE-ONLY, never silently lost.
 * OFF-5 R8: "every outbox item carries a client-generated idempotency key (UUID
 * v4)". D1's half (migration 0008, APPLIED on staging) made the server enforce
 * it: UNIQUE (user_id, idempotency_key) on post_comments, UNIQUE (reporter_id,
 * idempotency_key) on reports; likes are one row per (post_id, user_id) by their
 * natural key. The contract is `scripts/db-off2-outbox-contract.json`.
 *
 * THE ONE RULE THAT MAKES "EXACTLY ONCE" TRUE ON THIS SIDE:
 *   the key is made by `crypto.randomUUID()` ONCE, in `enqueue`, written to the
 *   device with the item, and every send of that item — the first, a retry after
 *   a timeout whose answer was lost, a resend after the app was killed and
 *   reopened — carries THAT key. Nothing on the send path may make a new one.
 *   The server then turns every repeat into "already done" (upsert with
 *   ignoreDuplicates, or a 23505 on the named constraint), and the device reads
 *   the original row back.
 *
 * STORAGE. Its own IndexedDB database (`retina-outbox`), NOT the OFF-1 device
 * store: the device store evicts by age and count, and OFF-5 G7 says the pending
 * outbox is never evicted. Items are per member; only the signed-in member's
 * items are ever sent; sign-out wipes the whole outbox (G6, signOutWipe.ts).
 *
 * ORDER AND RETRIES (OFF-5 R1, R5, R7, G8):
 *   • FIFO by creation. A retryable failure stops the drain, so nothing is sent
 *     ahead of an item that is still waiting (a reply never lands before the
 *     comment it answers).
 *   • like/unlike on the same post collapse to the last intent before sending.
 *   • network failure, 408, 429, 5xx → retry with back-off 1 s, 2 s, 4 s …
 *     capped at 60 s, ±20 % jitter, at most MAX_ATTEMPTS sends. Paused offline.
 *   • any other 4xx (RLS, a deleted post, bad input) is final: the item is
 *     dropped and the failure is announced, never retried and never hidden.
 *   • Stage L2: feed_events (what the member has seen) is UNORDERED — it never
 *     stops the drain and nothing waits for it (UNORDERED_KINDS); OutboxBridge
 *     does not announce its failures (telemetry, logged instead). S12-F1:
 *     feed_signals (time on post, skips, watch %, share clicks, profile visits)
 *     is the same kind of telemetry and is treated the same way.
 *
 * This file talks to no server. The sender (outboxSender.ts) does; tests and
 * the offline harness give it their own.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { onlineManager } from "@tanstack/react-query";
import { getNetState } from "./networkQuality";

export const OUTBOX_DB = "retina-outbox";
export const OUTBOX_STORE = "items";
export const MAX_ATTEMPTS = 8;
export const MAX_BACKOFF_MS = 60_000;

export type ReportTarget = "post" | "user" | "comment";
/**
 * Stage L2 · one feed event as the outbox carries it. `id` is the row's primary
 * key, made ONCE by the tracker (crypto.randomUUID) when the event is recorded
 * — the same rule as an item key: every resend carries the same id, and the
 * server's ON CONFLICT (id) DO NOTHING turns a repeat into "already there".
 */
export interface FeedEventPayload {
  id: string;
  post_id: string;
  author_id: string;
  event_type: "view" | "like" | "share" | "comment" | "click";
  dwell_ms: number;
}
/**
 * S12-F1 · one signal as the outbox carries it: the member's OWN attention,
 * folded server-side into per-viewer aggregates (feed_post_signals,
 * feed_author_signals) for the personal feed (F2+). Same exactly-once rule as a
 * feed event: `id` is the row's primary key, made ONCE when the signal is
 * recorded, so a resend is the same row and the server's AFTER INSERT fold
 * never runs for it twice.
 *   dwell          value = ms on screen (1 … 600,000 per signal), post_id set
 *   watch          value = highest % of the video played (0 … 100), post_id set
 *   skip           value = 0, post_id set (on screen ≥ 300 ms and < 1 s)
 *   share_click    value = 0, post_id set ("Copy link")
 *   profile_visit  value = 0, post_id NULL, subject_id = the profile
 * subject_id is the post's author for the post kinds; the server overwrites it
 * from posts, and skips a row about a post the member may not see.
 */
export type HideReason = "not_interested" | "hide";
export type FeedSignalKind = "dwell" | "watch" | "skip" | "share_click" | "profile_visit";
export interface FeedSignalPayload {
  id: string;
  kind: FeedSignalKind;
  post_id: string | null;
  subject_id: string;
  value: number;
}
export type OutboxAction =
  | { kind: "react"; postId: string; reactionType: string; replace: boolean }
  | { kind: "unreact"; postId: string }
  | { kind: "comment"; postId: string; content: string; parentId: string | null }
  | { kind: "report"; targetType: ReportTarget; targetId: string; reason: string }
  | { kind: "feed_events"; events: FeedEventPayload[] }
  | { kind: "feed_signals"; signals: FeedSignalPayload[] }
  /** S12-F1 Extra A · "Not interested" / "Hide post" (natural key: user_id, post_id). */
  | { kind: "hide_post"; postId: string; reason: HideReason }
  /** S12-F5 · Undo of "Not interested" (deletes by the natural key). */
  | { kind: "unhide_post"; postId: string }
  /** S12-F1 Extra D · mute / unmute an account (natural key: user_id, author_id). */
  | { kind: "mute"; authorId: string }
  | { kind: "unmute"; authorId: string }
  /** S12-F5 · ★ Add to / Remove from Favourites (natural key: user_id, author_id). */
  | { kind: "favourite"; authorId: string }
  | { kind: "unfavourite"; authorId: string };
export type OutboxKind = OutboxAction["kind"];

/**
 * Stage L2 · kinds with no order relative to anything else in the outbox.
 *
 * Feed events ("this member saw this post") are telemetry the feed ranks by,
 * not something a member did and waits on. FIFO exists so a reply never lands
 * before the comment it answers (R1/G8); a seen-event answers nothing, so one
 * waiting on back-off must not hold a member's comment behind it, and a member's
 * comment must not wait for it. Such an item is skipped while it waits and
 * re-scheduled on a retryable failure, instead of stopping the drain.
 */
export const UNORDERED_KINDS: ReadonlySet<OutboxKind> = new Set<OutboxKind>(["feed_events", "feed_signals"]);

/**
 * At most this many unsent items per member PER TELEMETRY KIND (feed_events,
 * feed_signals; ≤ 25 rows each).
 * Past it the OLDEST is dropped: a member scrolling a saved feed offline for
 * hours must not grow the device store without bound for ranking telemetry.
 */
export const MAX_FEED_EVENT_ITEMS = 40;

/**
 * Every table the outbox writes, and how the server makes a repeat harmless.
 * Must be a subset of D1's contract — `outboxContract.test.ts` and
 * `scripts/web-off2-outbox-check.mjs` fail the build otherwise.
 */
export const OUTBOX_TARGETS: Record<OutboxKind, { table: string; kind: "key" | "natural"; owner?: string; onConflict: string }> = {
  react: { table: "post_reactions", kind: "natural", onConflict: "post_id,user_id" },
  unreact: { table: "post_reactions", kind: "natural", onConflict: "post_id,user_id" },
  comment: { table: "post_comments", kind: "key", owner: "user_id", onConflict: "user_id,idempotency_key" },
  report: { table: "reports", kind: "key", owner: "reporter_id", onConflict: "reporter_id,idempotency_key" },
  feed_events: { table: "feed_events", kind: "natural", onConflict: "id" },
  feed_signals: { table: "feed_signal_events", kind: "natural", onConflict: "id" },
  hide_post: { table: "feed_hidden_posts", kind: "natural", onConflict: "user_id,post_id" },
  mute: { table: "feed_muted_authors", kind: "natural", onConflict: "user_id,author_id" },
  unmute: { table: "feed_muted_authors", kind: "natural", onConflict: "user_id,author_id" },
  unhide_post: { table: "feed_hidden_posts", kind: "natural", onConflict: "user_id,post_id" },
  favourite: { table: "feed_favourite_authors", kind: "natural", onConflict: "user_id,author_id" },
  unfavourite: { table: "feed_favourite_authors", kind: "natural", onConflict: "user_id,author_id" },
};

export interface OutboxItem {
  /** The idempotency key. Made once, in enqueue. Never regenerated. */
  key: string;
  userId: string;
  action: OutboxAction;
  createdAt: number;
  /** Creation order; ties on createdAt are broken by this. */
  seq: number;
  attempts: number;
  nextAt: number;
  lastError?: string;
}

export type SendResult =
  | { ok: true; result?: unknown }
  | { ok: false; retry: boolean; error: unknown };
export type Sender = (item: OutboxItem) => Promise<SendResult>;

/* ── storage ─────────────────────────────────────────────────────────────── */

export interface OutboxStore {
  getAll(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryOutboxStore(): OutboxStore & { map: Map<string, OutboxItem> } {
  const map = new Map<string, OutboxItem>();
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    map,
    getAll: async () => [...map.values()].map(clone),
    put: async (i) => { map.set(i.key, clone(i)); },
    delete: async (k) => { map.delete(k); },
    clear: async () => { map.clear(); },
  };
}

function idbOutboxStore(): OutboxStore | null {
  if (typeof indexedDB === "undefined" || !indexedDB) return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(OUTBOX_DB, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(OUTBOX_STORE)) req.result.createObjectStore(OUTBOX_STORE, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("indexedDB open blocked"));
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  };
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(OUTBOX_STORE, mode).objectStore(OUTBOX_STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    getAll: () => tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>),
    put: async (i) => { await tx("readwrite", (s) => s.put(i)); },
    delete: async (k) => { await tx("readwrite", (s) => s.delete(k)); },
    clear: async () => { await tx("readwrite", (s) => s.clear()); },
  };
}

/** No IndexedDB (old WebView, private mode): an in-memory outbox — the action still goes once online, it just does not survive a restart. */
let store: OutboxStore | undefined;
function getStore(): OutboxStore {
  if (!store) store = idbOutboxStore() ?? memoryOutboxStore();
  return store;
}

/* ── engine state ────────────────────────────────────────────────────────── */

export type OutboxEvent =
  | { type: "delivered"; item: OutboxItem; result?: unknown; awaited: boolean }
  /** `awaited`: a live `submit` is waiting for this item and will report it itself. */
  | { type: "failed"; item: OutboxItem; error: unknown; awaited: boolean }
  | { type: "changed" };

let sender: Sender | null = null;
let activeUser: string | null = null;
let draining: Promise<void> | null = null;
let again = false;
let inflight: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let seqCounter = 0;
let random = Math.random;
let isOnlineFn = () => onlineManager.isOnline() && getNetState().online;
const listeners = new Set<(e: OutboxEvent) => void>();
/** The settled outcome of each key, for `submit` to read after a drain. Cleared on stop. */
const awaited = new Set<string>();
const outcomes = new Map<string, { delivered: true; result?: unknown } | { delivered: false; error: unknown }>();

function emit(e: OutboxEvent) {
  listeners.forEach((l) => { try { l(e); } catch { /* a listener must not break the outbox */ } });
}
export function subscribeOutbox(fn: (e: OutboxEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function backoffMs(attempts: number, rnd = random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.round(base * (0.8 + 0.4 * rnd()));
}

function makeKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.randomUUID !== "function") throw new Error("crypto.randomUUID is unavailable — an outbox item cannot be keyed");
  return c.randomUUID();
}

/** Actions that toggle one thing; an unsent earlier toggle of the same thing is replaced (last intent wins, R5). */
const togglePost = (a: OutboxAction) =>
  a.kind === "react" || a.kind === "unreact" ? `post:${a.postId}`
  : a.kind === "mute" || a.kind === "unmute" ? `author:${a.authorId}`
  : a.kind === "hide_post" || a.kind === "unhide_post" ? `hide:${a.postId}`
  : a.kind === "favourite" || a.kind === "unfavourite" ? `favourite:${a.authorId}`
  : null;

/**
 * Put one action on the device. The idempotency key is made HERE, once.
 * A like/unlike on a post that already has an unsent like/unlike replaces it
 * (last intent wins, R5) — unless that one is on the wire right now.
 */
export async function enqueue(userId: string, action: OutboxAction, now = Date.now()): Promise<OutboxItem> {
  if (!userId) throw new Error("outbox: no member");
  const s = getStore();
  const post = togglePost(action);
  if (post) {
    for (const i of await s.getAll()) {
      if (i.userId === userId && i.key !== inflight && togglePost(i.action) === post) await s.delete(i.key);
    }
  }
  if (UNORDERED_KINDS.has(action.kind)) {
    const waiting = (await s.getAll())
      .filter((i) => i.userId === userId && i.key !== inflight && i.action.kind === action.kind)
      .sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
    for (const i of waiting.slice(0, Math.max(0, waiting.length - MAX_FEED_EVENT_ITEMS + 1))) await s.delete(i.key);
  }
  const item: OutboxItem = { key: makeKey(), userId, action, createdAt: now, seq: ++seqCounter, attempts: 0, nextAt: 0 };
  await s.put(item);
  emit({ type: "changed" });
  return item;
}

/** The signed-in member's unsent items, oldest first. */
export async function pending(userId = activeUser): Promise<OutboxItem[]> {
  if (!userId) return [];
  try {
    return (await getStore().getAll()).filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
  } catch {
    return [];
  }
}

function schedule(at: number, now: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void drain(); }, Math.max(0, at - now));
}

async function drainOnce(now: () => number) {
  if (!sender || !activeUser || !isOnlineFn()) return;
  const s = getStore();
  /** Earliest moment something skipped in this pass is due again. */
  let wake = Infinity;
  /**
   * An ORDERED item is waiting on back-off: every later ordered item waits too
   * (FIFO — nothing goes ahead of it). UNORDERED items (UNORDERED_KINDS) are
   * neither held by this nor able to cause it.
   */
  let blocked = false;
  for (const item of await pending(activeUser)) {
    if (!isOnlineFn()) return;
    const unordered = UNORDERED_KINDS.has(item.action.kind);
    if (blocked && !unordered) continue;
    const t = now();
    if (item.nextAt > t) {
      wake = Math.min(wake, item.nextAt);
      if (!unordered) blocked = true;
      continue;
    }
    inflight = item.key;
    let r: SendResult;
    try {
      r = await sender(item);
    } catch (error) {
      r = { ok: false, retry: true, error };
    } finally {
      inflight = null;
    }
    if (r.ok) {
      await s.delete(item.key);
      outcomes.set(item.key, { delivered: true, result: r.result });
      emit({ type: "delivered", item, result: r.result, awaited: awaited.has(item.key) });
      continue;
    }
    const f = r as { ok: false; retry: boolean; error: unknown };
    const attempts = item.attempts + 1;
    if (f.retry && attempts < MAX_ATTEMPTS) {
      const t2 = now();
      const nextAt = t2 + backoffMs(attempts);
      await s.put({ ...item, attempts, nextAt, lastError: describe(f.error) });
      wake = Math.min(wake, nextAt);
      if (!unordered) blocked = true; // FIFO: no ordered item goes ahead of one that is waiting
      continue;
    }
    await s.delete(item.key);
    outcomes.set(item.key, { delivered: false, error: f.error });
    emit({ type: "failed", item: { ...item, attempts }, error: f.error, awaited: awaited.has(item.key) });
  }
  if (wake !== Infinity) schedule(wake, now());
}

function describe(e: unknown): string {
  const x = e as { message?: string; code?: string } | null;
  return [x?.code, x?.message].filter(Boolean).join(" ").slice(0, 200) || String(e).slice(0, 200);
}

/** Send what can be sent now. Single-flight: a call during a drain runs one more pass after it. */
export function drain(now: () => number = Date.now): Promise<void> {
  if (draining) { again = true; return draining; }
  draining = (async () => {
    try {
      do { again = false; await drainOnce(now); } while (again);
    } catch {
      /* storage failure: the items stay; the next trigger tries again */
    } finally {
      draining = null;
    }
  })();
  return draining;
}

export type SubmitResult = { status: "delivered"; result?: unknown } | { status: "queued"; key: string };

/**
 * The call the mutation hooks make. Queues the action, then — when online —
 * sends it straight away and waits for that one send.
 *   delivered → the server has it (the first time or, after a lost answer, again
 *               harmlessly); `result` is the row read back where there is one.
 *   queued    → offline, or the network failed: it is on the device and will be
 *               sent once when the network returns. NOT an error.
 *   throws    → the server refused it (a final 4xx). The item is gone; the
 *               caller rolls back and tells the member.
 */
export async function submit(userId: string, action: OutboxAction): Promise<SubmitResult> {
  const item = await enqueue(userId, action);
  awaited.add(item.key);
  try {
    if (sender && activeUser === userId && isOnlineFn()) await drain();
  } finally {
    awaited.delete(item.key);
  }
  const o = outcomes.get(item.key);
  if (!o) return { status: "queued", key: item.key };
  outcomes.delete(item.key);
  if (o.delivered) return { status: "delivered", result: (o as { result?: unknown }).result };
  throw (o as { error: unknown }).error;
}

let unwire: (() => void) | null = null;
/** Start sending for this member (on sign-in / app start). Safe to call again. */
export function startOutbox(userId: string, send: Sender): () => void {
  activeUser = userId;
  sender = send;
  if (!unwire) {
    const kick = () => { if (isOnlineFn()) void drain(); };
    const offManager = onlineManager.subscribe(kick);
    if (typeof window !== "undefined") window.addEventListener("online", kick);
    unwire = () => {
      offManager();
      if (typeof window !== "undefined") window.removeEventListener("online", kick);
    };
  }
  void drain();
  return stopOutbox;
}

export function stopOutbox() {
  activeUser = null;
  sender = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (unwire) { unwire(); unwire = null; }
  outcomes.clear();
  awaited.clear();
}

/** Sign-out: stop, then delete every member's items. Never throws. */
export async function clearOutbox(): Promise<boolean> {
  stopOutbox();
  try { await getStore().clear(); emit({ type: "changed" }); return true; } catch { return false; }
}

/** Test seams. */
export function __setOutboxStore(s: OutboxStore | undefined) { store = s; }
export function __setOutboxOnline(fn: (() => boolean) | undefined) {
  isOnlineFn = fn ?? (() => onlineManager.isOnline() && getNetState().online);
}
export function __setOutboxRandom(fn: (() => number) | undefined) { random = fn ?? Math.random; }
export function __resetOutbox() {
  stopOutbox();
  listeners.clear();
  draining = null;
  again = false;
  inflight = null;
  seqCounter = 0;
}
