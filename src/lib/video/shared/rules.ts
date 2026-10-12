/**
 * VID-1 · THE RULES BOTH SIDES OF THE UPLOAD AGREE ON. Pure, no imports.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Imported by the app (src/lib/video/*) AND by the Pages Functions
 * (functions/api/video/*). It must stay free of `@/` aliases, React and DOM so
 * the Functions bundler can take it as it is. Source of every rule:
 * docs/evidence/d2/phase5/VID-1/DECISION.md (signed #376), R-97/R-100/R-104,
 * and D1's `video_validate_version` (20261005_0005), whose numbers are copied
 * here for the UX checks only — the database re-checks every one of them.
 *
 * THE TWO PREFIXES (SEC-VID-1, R-104 item 4):
 *   upload/video/<owner>/<video>/v<n>/<file>   ← the ONLY keys a client is ever
 *                                                given a presigned PUT for
 *   video/<owner>/<video>/v<n>/<file>          ← what viewers are served; written
 *                                                ONLY by /api/video/complete, as
 *                                                a server-side copy of bytes it
 *                                                has just verified
 * A presigned URL is valid for an hour. If it pointed at the served key, a
 * client could re-PUT the audio after the music check passed and swap what
 * viewers hear (check-then-overwrite). Pointing it at the upload prefix makes a
 * late re-PUT harmless: the served copy was made from the verified bytes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type VideoPurpose = "post" | "ad";

/**
 * Owner ruling 2026-10-11 (DECISION A3.2): no time limit — 500 MB is the limit,
 * for members and ads alike. 24 h is only a technical guard on the declared
 * number, the same as the database's (20261012_0001).
 */
export const VIDEO_LIMITS: Record<VideoPurpose, { maxSeconds: number; maxBytes: number }> = {
  post: { maxSeconds: 86_400, maxBytes: 524_288_000 },
  ad: { maxSeconds: 86_400, maxBytes: 524_288_000 },
};

/**
 * Per-file caps (review C1 on #410). With no time cap, the bytes-per-second
 * ceilings below divide by a DECLARED length; these keep any single file —
 * and so any single download a viewer's player makes — small, whatever is
 * declared. Our encoder's 4 s segments are ~0.1–1.5 MB; init segments a few KB.
 */
export const SEGMENT_MAX_BYTES = 8_388_608;
export const INIT_MAX_BYTES = 1_048_576;

/** Bytes per declared second, per rendition (SEC F-D3-15 condition 4 = D1's _ceiling). */
export const RENDITION_CEILING_BPS = { "240p": 61_440, "480p": 163_840, "720p": 358_400, audio: 16_384 } as const;
/** Poster + playlists together (D1: VID-LIM-005). */
export const OTHER_MAX_BYTES = 2_097_152;

export type RenditionKey = "240p" | "480p" | "720p" | "audio" | "other";

/**
 * The VID-1 §3 allow-list (SEC condition 1): no `/`, no `..`, no other extension.
 * Tightened (review #411 C3): a playlist per rendition + the master; ONE init
 * per rendition (`240p.mp4`, `audio.mp4`); numbered pieces only for segments
 * (`240p_17.m4s`), no leading zeros — so no file can exist that the judge
 * never looks at (`240p_3.mp4`, `master.m4s`, `audio_1.mp4` were allowed).
 */
export const VIDEO_FILE_RE =
  /^(?:(?:master|240p|480p|720p|audio)\.m3u8|(?:240p|480p|720p|audio)\.mp4|(?:240p|480p|720p|audio)_(?:0|[1-9]\d{0,3})\.m4s|poster\.jpg)$/;

/** Review #411 C4: a cap on files per version (a 5½-hour video at 4 s segments is ~5,000 per rendition). */
export const MAX_MANIFEST_FILES = 12_000;

export function isAllowedFileName(name: string): boolean {
  return typeof name === "string" && VIDEO_FILE_RE.test(name);
}

/** VID-1 §3 step 2: the type each URL signs, fixed by extension. */
export function contentTypeFor(name: string): string | null {
  if (!isAllowedFileName(name)) return null;
  if (name.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (name.endsWith(".m4s")) return "video/iso.segment";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".jpg")) return "image/jpeg";
  return null;
}

/** Which of D1's rendition_bytes keys a file counts toward. Playlists and the poster are "other". */
export function renditionOf(name: string): RenditionKey {
  if (name.endsWith(".m3u8") || name === "poster.jpg") return "other";
  const m = /^(240p|480p|720p|audio)/.exec(name);
  return (m ? m[1] : "other") as RenditionKey;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function prefixParts(owner: string, video: string, version: number): string {
  if (!UUID_RE.test(owner) || !UUID_RE.test(video)) throw new Error("VID-KEY-001: owner and video must be lowercase uuids");
  if (!Number.isInteger(version) || version < 1 || version > 9999) throw new Error("VID-KEY-002: version must be 1..9999");
  return `${owner}/${video}/v${version}`;
}

/** SEC-VID-1: the only key family a client may ever PUT to. */
export const UPLOAD_PREFIX = "upload/video/";
/** What viewers are served. Never presigned for a client. */
export const SERVED_PREFIX = "video/";

export function uploadKey(owner: string, video: string, version: number, file: string): string {
  if (!isAllowedFileName(file)) throw new Error(`VID-KEY-003: ${JSON.stringify(file)} is not an allowed file name`);
  return `${UPLOAD_PREFIX}${prefixParts(owner, video, version)}/${file}`;
}

export function servedKey(owner: string, video: string, version: number, file: string): string {
  if (!isAllowedFileName(file)) throw new Error(`VID-KEY-003: ${JSON.stringify(file)} is not an allowed file name`);
  return `${SERVED_PREFIX}${prefixParts(owner, video, version)}/${file}`;
}

export function manifestKey(owner: string, video: string, version: number): string {
  return `${UPLOAD_PREFIX}${prefixParts(owner, video, version)}/manifest.json`;
}

/* ── the manifest ───────────────────────────────────────────────────────── */

export interface ManifestFile {
  name: string;
  bytes: number;
  /** lowercase hex */
  sha256: string;
}

export interface VideoManifest {
  v: 1;
  duration_s: number;
  has_audio: boolean;
  width: number;
  height: number;
  /** Sorted by name, so the same files always serialise the same way. */
  files: ManifestFile[];
}

/** Canonical JSON: fixed key order, files sorted. Its sha256 is the version id (VID-1 §2.3). */
export function canonicalManifest(m: VideoManifest): string {
  const files = [...m.files]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256 }));
  return JSON.stringify({
    v: 1,
    duration_s: Math.round(m.duration_s * 100) / 100,
    has_audio: m.has_audio,
    width: m.width,
    height: m.height,
    files,
  });
}

/** Problems with a manifest, before anything is uploaded or presigned. Empty = acceptable shape. */
export function manifestProblems(m: unknown, purpose: VideoPurpose): string[] {
  const out: string[] = [];
  const x = m as Partial<VideoManifest> | null;
  if (!x || typeof x !== "object") return ["manifest is not an object"];
  if (x.v !== 1) out.push("manifest v must be 1");
  const lim = VIDEO_LIMITS[purpose];
  if (typeof x.duration_s !== "number" || !(x.duration_s > 0) || x.duration_s > lim.maxSeconds) {
    out.push(`duration must be > 0 and at most ${lim.maxSeconds} s`);
  }
  if (typeof x.has_audio !== "boolean") out.push("has_audio must be a boolean");
  if (!Number.isInteger(x.width) || !Number.isInteger(x.height) || (x.width as number) < 1 || (x.height as number) < 1) {
    out.push("width and height must be positive integers");
  }
  if (!Array.isArray(x.files) || x.files.length === 0) return [...out, "files must be a non-empty list"];
  if (x.files.length > MAX_MANIFEST_FILES) return [...out, `${x.files.length} files is above ${MAX_MANIFEST_FILES}`];
  const seen = new Set<string>();
  let total = 0;
  for (const f of x.files) {
    if (!f || !isAllowedFileName(f.name)) { out.push(`file name ${JSON.stringify(f?.name)} is not allowed`); continue; }
    if (seen.has(f.name)) out.push(`file ${f.name} is listed twice`);
    seen.add(f.name);
    if (!Number.isInteger(f.bytes) || f.bytes < 1) out.push(`file ${f.name} has no size`);
    else if (f.name.endsWith(".m4s") && f.bytes > SEGMENT_MAX_BYTES) out.push(`segment ${f.name} is ${f.bytes} bytes, above ${SEGMENT_MAX_BYTES}`);
    else if (f.name.endsWith(".mp4") && f.bytes > INIT_MAX_BYTES) out.push(`init segment ${f.name} is ${f.bytes} bytes, above ${INIT_MAX_BYTES}`);
    if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) out.push(`file ${f.name} has no sha256`);
    total += Number(f.bytes) || 0;
  }
  if (total > lim.maxBytes) out.push(`total ${total} bytes is above ${lim.maxBytes}`);
  for (const must of ["master.m3u8", "poster.jpg", "240p.m3u8", "240p.mp4"]) {
    if (!seen.has(must)) out.push(`${must} is required`);
  }
  if (x.has_audio === true && !seen.has("audio.m3u8")) out.push("has_audio is true but there is no audio.m3u8");
  if (x.has_audio === false && [...seen].some((n) => n.startsWith("audio"))) out.push("has_audio is false but audio files are listed");
  return out;
}

/**
 * The AUDIO FINGERPRINT handed to video_mark_uploaded and signed in the
 * attestation (VID-1 §6.1 as amended A4, 2026-10-12): sha256 over one line per
 * audio file — "name:sha256\n" — for audio.mp4 and then every audio segment
 * in playlist order. Each per-file sha256 is the hash of the SERVED bytes,
 * verified by /complete when it copied that file, so this binds the exact
 * audio viewers get (same strength as hashing the bytes themselves: a change
 * to any byte changes that file's hash) — without re-reading hours of audio
 * in one request, which Cloudflare's 1,000-calls-per-request limit forbids.
 */
export async function audioFingerprint(m: VideoManifest, audioSegmentsInOrder: readonly string[]): Promise<string> {
  const sha = new Map(m.files.map((f) => [f.name, f.sha256]));
  const lines: string[] = [];
  for (const name of ["audio.mp4", ...audioSegmentsInOrder]) {
    const h = sha.get(name);
    if (!h) throw new Error(`VID-AUD-001: ${name} is not in the manifest`);
    lines.push(`${name}:${h}\n`);
  }
  return sha256Hex(lines.join(""));
}

/** D1's `rendition_bytes` argument: per-rendition totals that add up to total_bytes. */
export function renditionBytes(m: VideoManifest): Partial<Record<RenditionKey, number>> {
  const out: Partial<Record<RenditionKey, number>> = {};
  for (const f of m.files) {
    const k = renditionOf(f.name);
    out[k] = (out[k] ?? 0) + f.bytes;
  }
  return out;
}

export function totalBytes(m: VideoManifest): number {
  return m.files.reduce((a, f) => a + f.bytes, 0);
}

/**
 * Upload order (VID-1 §3 step 3): 240p, then audio, poster, the master, 480p,
 * 720p — so the check and low-quality playback can start before the big
 * renditions arrive. Within a rendition: playlist, init, then segments in order.
 */
export function uploadOrder(names: readonly string[]): string[] {
  const rank = (n: string): number => {
    if (n.startsWith("240p")) return 0;
    if (n.startsWith("audio")) return 1;
    if (n === "poster.jpg") return 2;
    if (n === "master.m3u8") return 3;
    if (n.startsWith("480p")) return 4;
    if (n.startsWith("720p")) return 5;
    return 6;
  };
  const within = (n: string): number => {
    if (n.endsWith(".m3u8")) return -2;
    if (n.endsWith(".mp4")) return -1;
    const m = /_(\d{1,4})\.m4s$/.exec(n);
    return m ? Number(m[1]) : 0;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || within(a) - within(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Hex of a digest. */
export function hex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as ArrayBuffer));
}
