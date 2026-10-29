/**
 * S7b-3 · THE SAVED FEED. The last ~200 "For you" posts, in the order the
 * member saw them, kept on the phone so the feed can be scrolled with no
 * network (Owner 2026-10-29: "Instagram with no network … better than
 * Instagram"; OFF-5 G1/G2: saved first, age is a label, never a reason to hide).
 *
 * WHY ITS OWN STORE. The feed query keeps at most 5 pages (50 posts) in memory
 * on purpose (S6 `maxPages: 5`), and OFF-1 persists only its first page. So the
 * query can never hold 200 posts; this archive is filled page by page as the
 * member scrolls online, and read page by page when they scroll offline.
 *
 * ORDER. Page 0 of a new session goes to the front; every later page of that
 * session goes right after the pages before it, so archive page N is what the
 * member saw as page N. Older posts follow, de-duplicated, then the cap.
 *
 * STORAGE. OFF-1's device store (IndexedDB, per member, wiped on sign-out —
 * OFF-5 G6), in chunks of 50 posts so no record nears MAX_RECORD_BYTES.
 *
 * PHOTOS. Each newly saved post's small preview is fetched once in the
 * background on a good connection, so S7b-1's photo cache holds a picture for
 * posts the member scrolled past too quickly to load. Never on a slow link or
 * Data Saver.
 */
import { putRecord, readAll } from "./deviceStore";
import { getNetState } from "./networkQuality";

export const ARCHIVE_MAX_POSTS = 200;
export const ARCHIVE_CHUNK = 50;
const KEY = "feed-archive";

type ArchivedPost = { id: string; thumbnail_urls?: (string | null)[] | null; image_urls?: (string | null)[] | null; image_url?: string | null };

let owner: string | null = null;
let posts: ArchivedPost[] = [];
let sessionLen = 0;
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Saves run one at a time, each on the newest posts (review #548). */
let saving: Promise<void> = Promise.resolve();
/**
 * Bumped by every sign-out wipe (resetFeedArchiveMemory). A feed page asks for
 * it when its request STARTS and hands it back when it records the page, so a
 * page that was loading when the member signed out is never saved after the
 * wipe (review #548).
 */
let epoch = 0;
/** Bumped whenever the in-memory copy is dropped, so a read of the phone's store
 *  that finishes late can never merge into another member's copy. */
let generation = 0;

export function feedArchiveEpoch(): number {
  return epoch;
}

function reset(userId: string) {
  owner = userId;
  posts = [];
  sessionLen = 0;
  loaded = null;
  generation++;
}

function dedupe(list: ArchivedPost[]): ArchivedPost[] {
  const seen = new Set<string>();
  const out: ArchivedPost[] = [];
  for (const p of list) {
    if (!p || typeof p.id !== "string" || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Read this member's saved feed from the phone (once per app session). */
function ensureLoaded(userId: string): Promise<void> {
  if (owner !== userId) reset(userId);
  if (!loaded) {
    const gen = generation;
    loaded = readAll(userId)
      .then((records) => {
        // Signed out / another member meanwhile: this read is not theirs.
        if (gen !== generation || owner !== userId) return;
        const sorted = records
          .filter((r) => Array.isArray(r.key) && r.key[0] === KEY && typeof r.key[1] === "number")
          .sort((a, b) => (a.key[1] as number) - (b.key[1] as number));
        // Only chunks 0, 1, 2 … without a gap: if the store evicted a middle
        // chunk, the ones after it would no longer be in the order seen.
        const contiguous: typeof sorted = [];
        for (const r of sorted) {
          if (r.key[1] !== contiguous.length) break;
          contiguous.push(r);
        }
        const chunks = contiguous.flatMap((r) => (Array.isArray(r.data) ? (r.data as ArchivedPost[]) : []));
        // Anything recorded while the read was in flight stays in front.
        posts = dedupe([...posts, ...chunks]).slice(0, ARCHIVE_MAX_POSTS);
      })
      .catch(() => {});
  }
  return loaded;
}

function scheduleSave(userId: string, delayMs: number) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (owner !== userId) return;
    void saveNow(userId);
  }, delayMs);
}

function saveNow(userId: string): Promise<void> {
  const ep = epoch;
  saving = saving.then(() => writeChunks(userId, ep)).catch(() => {});
  return saving;
}

async function writeChunks(userId: string, ep: number) {
  if (ep !== epoch || owner !== userId) return; // signed out before this save's turn
  const snapshot = posts.slice();
  const chunks = Math.ceil(ARCHIVE_MAX_POSTS / ARCHIVE_CHUNK);
  for (let i = 0; i < chunks; i++) {
    if (ep !== epoch || owner !== userId) return; // signed out meanwhile: write nothing more
    const part = snapshot.slice(i * ARCHIVE_CHUNK, (i + 1) * ARCHIVE_CHUNK);
    // An empty chunk is written too, so a shorter archive never keeps stale
    // tails. A chunk the store refuses (over its size cap) is replaced by an
    // empty one, so an old chunk never sits beside new ones.
    const ok = await putRecord(userId, [KEY, i], part);
    if (!ok && part.length > 0) await putRecord(userId, [KEY, i], []);
  }
}

/** The small preview of a post's first photo, else its first photo. */
export function previewUrl(p: ArchivedPost): string | null {
  const t = p.thumbnail_urls?.find((u) => typeof u === "string" && u);
  if (t) return t;
  const i = p.image_urls?.find((u) => typeof u === "string" && u) ?? p.image_url ?? null;
  return typeof i === "string" && i ? i : null;
}

function warmPreviews(list: ArchivedPost[]) {
  const net = getNetState();
  if (!net.online || net.slow) return;
  const conn = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)?.connection;
  if (conn?.saveData) return;
  if (typeof fetch !== "function") return;
  // Only when the photo worker controls the page (switch app_image_sw on):
  // without it nothing keeps the picture, and it would be mobile data for
  // nothing (carry review #563).
  const controller = (globalThis.navigator as Navigator | undefined)?.serviceWorker?.controller;
  if (!controller || !/\/sw-image-cache\.js/.test(controller.scriptURL)) return;
  for (const p of list) {
    const u = previewUrl(p);
    // Same request the image worker stores (CORS, no cookies), at low priority
    // so it never competes with what is on screen; a failure is harmless.
    if (u) fetch(u, { mode: "cors", credentials: "omit", priority: "low" } as RequestInit).catch(() => {});
  }
}

/**
 * Record one page the member was just served online. `pageIndex` 0 starts a
 * new session at the front of the archive.
 */
export async function recordFeedPage(
  userId: string,
  pageIndex: number,
  page: ArchivedPost[],
  opts: { saveDelayMs?: number; warm?: boolean; epoch?: number } = {},
): Promise<void> {
  if (!userId || !Array.isArray(page) || page.length === 0) return;
  // The member signed out while this page was loading: it is not saved.
  if (opts.epoch !== undefined && opts.epoch !== epoch) return;
  await ensureLoaded(userId);
  if (owner !== userId || (opts.epoch !== undefined && opts.epoch !== epoch)) return;
  const before = new Set(posts.map((p) => p.id));
  if (pageIndex === 0) {
    posts = dedupe([...page, ...posts]);
    sessionLen = Math.min(page.length, posts.length);
  } else {
    const head = posts.slice(0, sessionLen);
    const fresh = page.filter((p) => !head.some((h) => h.id === p.id));
    posts = dedupe([...head, ...fresh, ...posts.slice(sessionLen)]);
    sessionLen = Math.min(head.length + fresh.length, posts.length);
  }
  posts = posts.slice(0, ARCHIVE_MAX_POSTS);
  sessionLen = Math.min(sessionLen, posts.length);
  scheduleSave(userId, opts.saveDelayMs ?? 1000);
  if (opts.warm !== false) warmPreviews(page.filter((p) => !before.has(p.id)));
}

/** Saved page `pageIndex` (size `pageSize`), and whether more saved posts follow. */
export async function readFeedPage(
  userId: string,
  pageIndex: number,
  pageSize: number,
  opts: { epoch?: number } = {},
): Promise<{ posts: ArchivedPost[]; more: boolean }> {
  if (!userId) return { posts: [], more: false };
  // A request that started before a sign-out reads nothing (and never loads
  // the departed member's posts back into memory).
  if (opts.epoch !== undefined && opts.epoch !== epoch) return { posts: [], more: false };
  await ensureLoaded(userId);
  if (owner !== userId) return { posts: [], more: false };
  const start = pageIndex * pageSize;
  const slice = posts.slice(start, start + pageSize);
  return { posts: slice, more: start + pageSize < posts.length };
}

/** S7b-4: one post as saved in the feed (a post page opened with no network). */
export async function findSavedFeedPost(userId: string, postId: string): Promise<ArchivedPost | null> {
  if (!userId) return null;
  await ensureLoaded(userId);
  if (owner !== userId) return null;
  return posts.find((p) => p.id === postId) ?? null;
}

/** How many posts are saved for this member. */
export async function savedFeedCount(userId: string): Promise<number> {
  await ensureLoaded(userId);
  return owner === userId ? posts.length : 0;
}

/** Write any pending change now (tests; sign-out never needs it — the store is wiped). */
export async function flushFeedArchive(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (owner) await saveNow(owner);
}

/** Forget the in-memory copy (sign-out, tests). The device copy is wiped by signOutWipe. */
export function resetFeedArchiveMemory(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  epoch++;
  generation++;
  owner = null;
  posts = [];
  sessionLen = 0;
  loaded = null;
}
