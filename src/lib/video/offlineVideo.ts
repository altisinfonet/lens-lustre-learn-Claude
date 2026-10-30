/**
 * S7b-6 · FEED VIDEOS WITH NO NETWORK.
 *
 * Owner gate: in flight mode "saved videos play"; one shared phone budget
 * (default 300 MB, the member can change it), a Wi-Fi-only option, and an
 * offline preview of at least the first 25 s.
 *
 * WHAT IS KEPT. For a feed video the member scrolled to while online, the
 * smallest rendition (240p — VID-1 always makes it) of its first segments,
 * ≥ PREVIEW_MIN_S seconds, plus the matching audio. The playlists are rewritten
 * to exactly those files and the stream ends there (VOD), so the player stops
 * cleanly at the end of what is on the phone. A video shorter than that is
 * kept whole.
 *
 * WHERE. Cache Storage `video-offline-v1`, under synthetic URLs
 * `${OFFLINE_VIDEO_ORIGIN}/<member>/<video>/<file>` that no network request
 * ever uses: hls.js reaches them only through `offlineLoaderFor`, which answers
 * from the phone and never falls back to the network for them. The list (with
 * sizes, for the budget) is in localStorage.
 *
 * NEVER. A file name that is not a plain relative name (the server already
 * refuses those — SEC condition 3; checked again here); a save that is half
 * done (all files or none); keeping anything after sign-out (signOutWipe).
 */

export const OFFLINE_VIDEO_CACHE = "video-offline-v1";
/** `.invalid` is reserved (RFC 2606): this host can never be fetched by mistake. */
export const OFFLINE_VIDEO_ORIGIN = "https://saved-video.invalid";
export const PREVIEW_MIN_S = 25;
export const DEFAULT_BUDGET_MB = 300;
/** What the settings screen offers (0 = do not save videos). */
export const BUDGET_CHOICES_MB = [0, 100, 300, 500, 1000, 2000] as const;

const SETTINGS_KEY = "retina:video-offline:settings";
const INDEX_KEY = "retina:video-offline:index";
const MB = 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * Review #674: the media-authz Worker serves every playlist with each URI
 * rewritten to `name?t=<token>` (cloudflare/media-authz/handler.ts). The token
 * expires in 15 minutes and is not needed on the phone: the kept playlists name
 * the bare file, and the name alone is what must be plain.
 */
const bare = (uri: string): string => uri.replace(/\?.*$/, "");

/* ── settings ─────────────────────────────────────────────────────────────── */

export interface VideoOfflineSettings { budgetMB: number; wifiOnly: boolean }
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => { try { f(); } catch { /* a listener must not break the others */ } });
export function subscribeVideoOffline(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

export function getVideoOfflineSettings(): VideoOfflineSettings {
  const out: VideoOfflineSettings = { budgetMB: DEFAULT_BUDGET_MB, wifiOnly: true };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<VideoOfflineSettings> | null;
    if (raw && typeof raw.budgetMB === "number" && Number.isFinite(raw.budgetMB) && raw.budgetMB >= 0) out.budgetMB = Math.floor(raw.budgetMB);
    if (raw && typeof raw.wifiOnly === "boolean") out.wifiOnly = raw.wifiOnly;
  } catch { /* storage blocked or garbled: the defaults */ }
  return out;
}

export function setVideoOfflineSettings(patch: Partial<VideoOfflineSettings>): VideoOfflineSettings {
  const before = getVideoOfflineSettings();
  const next = { ...before, ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* memory of this choice is lost; harmless */ }
  emit();
  // Review #674: a lower budget holds NOW — the oldest saved videos go; Off removes them all.
  if (next.budgetMB < before.budgetMB && typeof globalThis.caches !== "undefined") void enforceVideoBudget(globalThis.caches).catch(() => undefined);
  return next;
}

/* ── the list of saved videos ─────────────────────────────────────────────── */

interface Entry { videoId: string; userId: string; files: string[]; bytes: number; seconds: number; full: boolean; savedAt: number }
let memo: Entry[] | null = null;

function readIndex(): Entry[] {
  if (memo) return memo;
  let list: Entry[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]");
    if (Array.isArray(raw)) list = raw.filter((e) => e && typeof e.videoId === "string" && typeof e.userId === "string" && Array.isArray(e.files) && typeof e.bytes === "number");
  } catch { /* garbled: start empty */ }
  memo = list;
  return list;
}
function writeIndex(list: Entry[]): void {
  memo = list;
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch { /* the cache still holds the files; the next save rewrites the list */ }
  emit();
}

const fileUrl = (userId: string, videoId: string, name: string) => `${OFFLINE_VIDEO_ORIGIN}/${encodeURIComponent(userId)}/${encodeURIComponent(videoId)}/${name}`;

/** Is there a saved copy of this video on the phone? (Only the signed-in member's: the list is wiped at sign-out.) */
export function hasSavedPreview(videoId: string): boolean {
  return readIndex().some((e) => e.videoId === videoId);
}
/** The saved copy's master playlist, for hls.js with `offlineLoaderFor` — or null. */
export function savedPreviewUrl(videoId: string): string | null {
  const e = readIndex().find((x) => x.videoId === videoId);
  return e ? fileUrl(e.userId, e.videoId, "master.m3u8") : null;
}
/** Is the saved copy the whole video, and how long is it? */
export function savedPreviewInfo(videoId: string): { seconds: number; full: boolean } | null {
  const e = readIndex().find((x) => x.videoId === videoId);
  return e ? { seconds: e.seconds, full: e.full } : null;
}
export function savedVideoUsage(): { bytes: number; videos: number } {
  const list = readIndex();
  return { bytes: list.reduce((n, e) => n + e.bytes, 0), videos: list.length };
}

/* ── which part of a video is kept (pure) ─────────────────────────────────── */

export interface PreviewPlan {
  /** the rewritten master playlist: one variant (240p) + the audio rendition */
  master: string;
  /** the chosen variant's playlist file name */
  level: string;
  /** rewritten playlists by file name (level, and audio when there is one) */
  playlists: Record<string, string>;
  /** media files to fetch and keep, in order */
  files: string[];
  seconds: number;
  /** the whole video fits in the preview */
  full: boolean;
}

/** The variant with the smallest picture; its playlist name. */
export function smallestVariant(master: string): { inf: string; uri: string } | null {
  const lines = master.split(/\r?\n/).map((l) => l.trim());
  let best: { inf: string; uri: string; h: number; bw: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const uri = lines[i + 1];
    if (!uri || uri.startsWith("#")) continue;
    const h = Number(/RESOLUTION=\d+x(\d+)/.exec(lines[i])?.[1] ?? Infinity);
    const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? Infinity);
    if (!best || h < best.h || (h === best.h && bw < best.bw)) best = { inf: lines[i], uri: bare(uri), h, bw };
  }
  return best ? { inf: best.inf, uri: best.uri } : null;
}

/** The audio rendition's playlist, if the master names one. */
export function audioPlaylistName(master: string): string | null {
  for (const l of master.split(/\r?\n/)) {
    if (l.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/.test(l)) {
      const u = /URI="([^"]+)"/.exec(l)?.[1];
      return u ? bare(u) : null;
    }
  }
  return null;
}

interface Trimmed { text: string; files: string[]; seconds: number; full: boolean }
/** The playlist's header + init + segments until at least `minS` seconds; null when a name is not plain. */
function trimMedia(text: string, minS: number): Trimmed | null {
  const out: string[] = [];
  const files: string[] = [];
  let seconds = 0;
  let pending: string | null = null;
  let stoppedEarly = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "#EXT-X-ENDLIST") continue;
    if (line.startsWith("#EXT-X-MAP:")) {
      const raw = /URI="([^"]+)"/.exec(line)?.[1];
      const uri = raw ? bare(raw) : "";
      if (!uri || !SAFE_NAME.test(uri)) return null;
      files.push(uri);
      out.push(`#EXT-X-MAP:URI="${uri}"`);
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      if (seconds >= minS) { stoppedEarly = true; break; }
      pending = line;
      continue;
    }
    if (line.startsWith("#")) { if (pending === null) out.push(line); continue; }
    // a segment URI
    if (pending === null) continue;
    const name = bare(line);
    if (!SAFE_NAME.test(name)) return null;
    out.push(pending, name);
    files.push(name);
    seconds += Number(/^#EXTINF:([\d.]+)/.exec(pending)?.[1] ?? 0);
    pending = null;
  }
  out.push("#EXT-X-ENDLIST", "");
  return { text: out.join("\n"), files, seconds: Math.round(seconds * 1000) / 1000, full: !stoppedEarly };
}

export function planPreview(master: string, levelText: string, audioText: string | null, minS: number = PREVIEW_MIN_S): PreviewPlan | null {
  const v = smallestVariant(master);
  if (!v || !SAFE_NAME.test(v.uri)) return null;
  const audioName = audioPlaylistName(master);
  if (audioName && !SAFE_NAME.test(audioName)) return null;
  const video = trimMedia(levelText, minS);
  // no init or no segment: nothing that could play (an empty or refused playlist)
  if (!video || video.files.length < 2) return null;
  // the audio, to at least the same length as the picture
  const audio = audioName && audioText ? trimMedia(audioText, video.seconds) : null;
  if (audioName && audioText && !audio) return null;
  const head = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  if (audio) head.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,URI="${audioName}"`);
  const inf = audio ? v.inf : v.inf.replace(/,AUDIO="[^"]*"/, "");
  const playlists: Record<string, string> = { [v.uri]: video.text };
  if (audio && audioName) playlists[audioName] = audio.text;
  return {
    master: [...head, inf, v.uri, ""].join("\n"),
    level: v.uri,
    playlists,
    files: [...video.files, ...(audio?.files ?? [])],
    seconds: video.seconds,
    full: video.full,
  };
}

/* ── when it may save ──────────────────────────────────────────────────────── */

export interface SaveConditions {
  online: boolean;
  slow: boolean;
  /** navigator.connection.type: "wifi", "ethernet", "cellular", … or undefined when the device cannot say */
  connectionType: string | undefined;
  saveData: boolean;
  native: boolean;
  hasCaches: boolean;
}
export function canSaveVideoNow(c: SaveConditions): boolean {
  const s = getVideoOfflineSettings();
  if (s.budgetMB <= 0 || !c.online || c.slow || c.saveData || !c.hasCaches) return false;
  if (!s.wifiOnly) return true;
  // Wi-Fi only: only when the device SAYS it is on Wi-Fi (or a cable). A link
  // the device cannot name might be mobile data — not Wi-Fi as far as we know.
  return c.connectionType === "wifi" || c.connectionType === "ethernet";
}

/* ── saving one ───────────────────────────────────────────────────────────── */

export interface SaveDeps {
  fetch: typeof fetch;
  caches: CacheStorage;
  /**
   * Re-review #674: may it save NOW? Asked when the save starts and before every
   * file — a save queued on Wi-Fi must not download over mobile data later.
   */
  allowed?: () => boolean;
  /** Who is signed in when the save runs; a save for anyone else keeps nothing. */
  currentUserId?: () => Promise<string | null>;
}
export type SaveResult = "saved" | "exists" | "too-big" | "failed";

/** One save at a time: a phone's link and storage are shared with everything else. */
let chain: Promise<unknown> = Promise.resolve();
const inFlight = new Set<string>();
/**
 * Review #674: bumped by clearSavedVideos (sign-out, "Remove saved videos"). A
 * save started before it must not write anything after it — not its files, not
 * the list it read before the wipe.
 */
let generation = 0;
class Wiped extends Error {}

export function saveVideoPreview(
  input: { userId: string; videoId: string; masterUrl: string },
  deps: SaveDeps,
): Promise<SaveResult> {
  // Re-review #674: the generation is taken when the save is QUEUED — a save
  // still waiting at sign-out must not start after the wipe as if nothing happened.
  const gen = generation;
  const run = chain.then(() => saveNow(input, deps, gen), () => saveNow(input, deps, gen));
  chain = run.catch(() => undefined);
  return run;
}

async function saveNow(input: { userId: string; videoId: string; masterUrl: string }, deps: SaveDeps, gen: number): Promise<SaveResult> {
  const { userId, videoId, masterUrl } = input;
  if (gen !== generation) return "failed";
  if (hasSavedPreview(videoId)) return "exists";
  if (inFlight.has(videoId)) return "exists";
  if (deps.allowed && !deps.allowed()) return "failed";
  inFlight.add(videoId);
  const alive = () => {
    if (gen !== generation) throw new Wiped();
    if (deps.allowed && !deps.allowed()) throw new Wiped();
  };
  const written: string[] = [];
  let cacheRef: Cache | null = null;
  try {
    const q = masterUrl.indexOf("?");
    const path = q < 0 ? masterUrl : masterUrl.slice(0, q);
    const query = q < 0 ? "" : masterUrl.slice(q);
    if (!/\/master\.m3u8$/.test(path)) return "failed";
    const base = path.slice(0, -"master.m3u8".length);
    if (deps.currentUserId && (await deps.currentUserId()) !== userId) return "failed";
    alive();
    const get = async (name: string) => {
      alive();
      const r = await deps.fetch(`${base}${name}${query}`);
      alive();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    };
    const master = await (await get("master.m3u8")).text();
    const v = smallestVariant(master);
    const audioName = audioPlaylistName(master);
    if (!v || !SAFE_NAME.test(v.uri) || (audioName && !SAFE_NAME.test(audioName))) return "failed";
    const levelText = await (await get(v.uri)).text();
    const audioText = audioName ? await (await get(audioName)).text() : null;
    const plan = planPreview(master, levelText, audioText);
    if (!plan) return "failed";

    const budget = getVideoOfflineSettings().budgetMB * MB;
    const bodies: Array<[string, ArrayBuffer | string, string]> = [];
    let bytes = 0;
    const enc = new TextEncoder();
    const addText = (name: string, text: string) => { bodies.push([name, text, "application/vnd.apple.mpegurl"]); bytes += enc.encode(text).byteLength; };
    addText("master.m3u8", plan.master);
    for (const [name, text] of Object.entries(plan.playlists)) addText(name, text);
    for (const name of plan.files) {
      const buf = await (await get(name)).arrayBuffer();
      alive();
      bytes += buf.byteLength;
      if (bytes > budget) return "too-big"; // stop fetching: it cannot be kept anyway
      bodies.push([name, buf, name.endsWith(".mp4") || name.endsWith(".m4s") ? "video/mp4" : "application/octet-stream"]);
    }

    // make room: the oldest saved videos go first
    const cache = await deps.caches.open(OFFLINE_VIDEO_CACHE);
    cacheRef = cache;
    alive();
    // only a sign-out stops the making of room, never a network change (round 3)
    await evictTo(budget - bytes, cache, () => { if (gen !== generation) throw new Wiped(); });

    for (const [name, body, type] of bodies) {
      alive();
      await cache.put(fileUrl(userId, videoId, name), new Response(body, { headers: { "content-type": type } }));
      written.push(name);
    }
    alive();
    if (deps.currentUserId && (await deps.currentUserId()) !== userId) throw new Wiped();
    if (gen !== generation) throw new Wiped();
    const list = readIndex().filter((e) => e.videoId !== videoId);
    list.push({ videoId, userId, files: written, bytes, seconds: plan.seconds, full: plan.full, savedAt: Date.now() });
    writeIndex(list);
    return "saved";
  } catch {
    // all or nothing: what this save already put on the phone goes again
    if (cacheRef && written.length) {
      const c = cacheRef;
      await Promise.all(written.map((n) => c.delete(fileUrl(userId, videoId, n)).catch(() => false)));
    }
    return "failed";
  } finally {
    inFlight.delete(videoId);
  }
}

/**
 * Remove the oldest saved videos until at most `maxBytes` are used. The list is
 * updated BEFORE each video's files go (round 3 of review #674): whatever stops
 * this midway, the list never names files that are no longer on the phone.
 * Only a sign-out (`stillOurs` throws) stops it — never a network change.
 */
async function evictTo(maxBytes: number, cache: Cache, stillOurs: () => void = () => {}): Promise<void> {
  for (;;) {
    stillOurs();
    const list = readIndex();
    const used = list.reduce((n, e) => n + e.bytes, 0);
    if (used <= maxBytes || list.length === 0) return;
    const [old, ...rest] = list;
    writeIndex(rest);
    await Promise.all(old.files.map((f) => cache.delete(fileUrl(old.userId, old.videoId, f)).catch(() => false)));
  }
}

/** Review #674: hold the budget now (after it was lowered). Runs in turn with saves. */
export function enforceVideoBudget(cacheStorage: CacheStorage = globalThis.caches): Promise<void> {
  const gen = generation;
  const alive = () => { if (gen !== generation) throw new Wiped(); };
  const run = chain.then(async () => {
    alive();
    const budget = getVideoOfflineSettings().budgetMB * MB;
    if (savedVideoUsage().bytes <= budget) return;
    const cache = await cacheStorage.open(OFFLINE_VIDEO_CACHE);
    alive();
    await evictTo(budget, cache, alive); // a sign-out meanwhile: the old list is not written back
  }).catch((e) => { if (!(e instanceof Wiped)) throw e; });
  chain = run.catch(() => undefined);
  return run;
}

/* ── the app's own entry point: called by the feed card once it holds a play grant ── */

interface NetInfo { type?: string; saveData?: boolean }
const isNative = (): boolean => {
  try { return (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true; } catch { return false; }
};

/** Best effort and silent: saves this video's preview in the background when the member's settings allow it now. */
export function maybeSaveVideoPreview(
  input: { userId: string | null | undefined; videoId: string; masterUrl: string },
  net: () => { online: boolean; slow: boolean },
  currentUserId?: () => Promise<string | null>,
): void {
  if (!input.userId || hasSavedPreview(input.videoId)) return;
  const hasCaches = typeof globalThis.caches !== "undefined";
  // Asked again when the save runs and before every file (re-review #674).
  const allowed = () => {
    const conn = (globalThis.navigator as Navigator & { connection?: NetInfo } | undefined)?.connection;
    const n = net();
    return canSaveVideoNow({ online: n.online, slow: n.slow, connectionType: conn?.type, saveData: conn?.saveData === true, native: isNative(), hasCaches });
  };
  if (!allowed()) return;
  void saveVideoPreview(
    { userId: input.userId, videoId: input.videoId, masterUrl: input.masterUrl },
    { fetch: globalThis.fetch.bind(globalThis), caches: globalThis.caches, allowed, currentUserId },
  ).catch(() => "failed");
}

/* ── playing it back ──────────────────────────────────────────────────────── */

type Ctx = { url: string; responseType?: string };
type Callbacks = {
  onSuccess: (r: { url: string; data: string | ArrayBuffer }, stats: unknown, ctx: Ctx, details: null) => void;
  onError: (e: { code: number; text: string }, ctx: Ctx, details: null, stats: unknown) => void;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a mixin base must take (...args: any[])
type LoaderCtor = new (...args: any[]) => {
  load(ctx: Ctx, cfg: unknown, cb: unknown): void;
  abort?(): void;
  destroy?(): void;
  stats: { loaded: number; total: number; loading: { start: number; first: number; end: number }; parsing?: { start: number; end: number } };
  context?: unknown;
};

/**
 * hls.js loader class: URLs under OFFLINE_VIDEO_ORIGIN are answered from the
 * phone (never the network); every other URL goes to hls.js's own loader.
 */
export function offlineLoaderFor<T extends LoaderCtor>(Base: T, cacheStorage: CacheStorage = globalThis.caches): T {
  return class OfflineVideoLoader extends Base {
    /** Review #674: hls.js aborts a load on seek / level switch; an aborted load never calls back. */
    private phoneLoad: { aborted: boolean } | null = null;
    abort(): void {
      if (this.phoneLoad) { this.phoneLoad.aborted = true; (this.stats as { aborted?: boolean }).aborted = true; return; }
      (super.abort as (() => void) | undefined)?.call(this);
    }
    destroy(): void {
      if (this.phoneLoad) this.phoneLoad.aborted = true;
      (super.destroy as (() => void) | undefined)?.call(this);
    }
    load(ctx: Ctx, cfg: unknown, cb: unknown): void {
      if (!ctx.url.startsWith(`${OFFLINE_VIDEO_ORIGIN}/`)) { this.phoneLoad = null; super.load(ctx, cfg, cb); return; }
      const callbacks = cb as Callbacks;
      const mine = { aborted: false };
      this.phoneLoad = mine;
      this.context = ctx;
      const stats = this.stats;
      const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
      stats.loading.start = now();
      void (async () => {
        try {
          const cache = await cacheStorage.open(OFFLINE_VIDEO_CACHE);
          const hit = await cache.match(ctx.url);
          if (mine.aborted) return;
          if (!hit) {
            callbacks.onError({ code: 404, text: "not saved on this phone" }, ctx, null, stats);
            return;
          }
          const data = ctx.responseType === "arraybuffer" ? await hit.arrayBuffer() : await hit.text();
          if (mine.aborted) return;
          const t = now();
          stats.loading.first = t;
          stats.loading.end = t;
          stats.loaded = stats.total = typeof data === "string" ? data.length : data.byteLength;
          callbacks.onSuccess({ url: ctx.url, data }, stats, ctx, null);
        } catch {
          if (mine.aborted) return;
          callbacks.onError({ code: 500, text: "could not read the saved video" }, ctx, null, stats);
        }
      })();
    }
  } as T;
}

/* ── sign-out ─────────────────────────────────────────────────────────────── */

/** Every saved video and the list: they belong to the member who saw them. */
export async function clearSavedVideos(cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<boolean> {
  generation++; // a save still running writes nothing after this (review #674)
  memo = [];
  try { localStorage.removeItem(INDEX_KEY); } catch { /* nothing to remove */ }
  emit();
  if (!cacheStorage) return true;
  try { await cacheStorage.delete(OFFLINE_VIDEO_CACHE); return true; } catch { return false; }
}

/** Tests only. */
export function __resetOfflineVideo(): void {
  memo = null;
  chain = Promise.resolve();
  inFlight.clear();
  generation++;
}
