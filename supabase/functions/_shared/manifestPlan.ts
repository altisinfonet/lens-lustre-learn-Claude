/**
 * MANIFEST-DRIVEN MIGRATION — THE REFUSALS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This module is the entire safety surface of the media migration, and it is
 * deliberately the boring part: it decides what the migrator is ALLOWED to do,
 * and it does no I/O at all. No fetch, no database, no Deno. That is what lets
 * the same code that runs in production run inside vitest against hand-built
 * fixtures — one implementation, both worlds, exactly like `imageDims.ts`.
 *
 * WHY IT EXISTS AT ALL. The abandoned `backfill-media-objects` derived its own
 * population from a live `posts` scan. Audited 2026-08-17 (Cycle 5A), that scan
 * would have migrated 255 slides where the approved manifest holds 207 — 28 of
 * them members' AVATARS, three of those carrying a folder UUID belonging to
 * somebody other than the post's author. Nothing in that function was wrong
 * about hashing or about S3; it was wrong about WHERE THE WORK COMES FROM.
 *
 * So here the manifest is the only source of truth, and every function below
 * exists to refuse something:
 *
 *   assertManifestIntegrity  the file is not the approved one          -> refuse
 *   parseManifest            a row is malformed or a key repeats       -> refuse
 *   assertFence              the live set differs from the manifest    -> refuse
 *   planPost                 a post's slides disagree with the manifest-> refuse
 *   verifyMeasured           the bytes disagree with the manifest      -> refuse
 *   reconcile                the end state disagrees with the manifest -> refuse
 *
 * A COUNT IS NOT A SET. `assertFence` compares digests over sorted key sets,
 * never lengths. The old migrator compared `expected_count` to an array length,
 * which passes unchanged when one post leaves the population and another
 * arrives. That is the specific hole this replaces.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { cdnHost } from "./laneConfig.ts";

/** One approved row. Mirrors the 13 columns of the Cycle-4 manifest exactly. */
export interface ManifestRow {
  post_id: string;
  owner_id: string;
  ord: number;
  source_url: string;
  source_host: string;
  object_path: string;
  width: number;
  height: number;
  aspect_ratio: string;
  mime: string;
  bytes: number;
  sha256: string;
  visibility: string;
}

/** What the fetcher measured from the real object. Never from a filename. */
export interface Measured {
  status: number;
  bytes: number;
  width: number;
  height: number;
  mime: string;
  sha256: string;
}

/** Every refusal carries a code, because every error on this platform does. */
export interface Refusal {
  code: string;
  detail: string;
}

export const MIGRATOR_VERSION = "1";

/** The one host the migration will ever accept. */
// Lane-derived (G10). An allow-list, not a display value: callers compare
// against it to decide whether a URL is this lane's. Call-time, not module load.
export const cdnHostFor = (): string => cdnHost();

/**
 * THE APPROVED POPULATION'S PATH SHAPES. Anything else is not a candidate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Class A is the original and is FROZEN — `media_migration_fence_digest` and
 * every manifest digest ever approved were computed against it, so changing it
 * would retroactively falsify `docs/MANIFEST_PROVENANCE.md`.
 *
 * Classes B and C were added on 2026-08-20 for 34 slides across 19 posts that
 * are real photographs in a bucket the CDN serves, owned by the member who
 * posted them, and were outside every manifest only because the pattern did
 * not describe them. `docs/CANDIDATE_PATTERN_AUDIT.md` is the audit; the short
 * version:
 *
 *   • the three are DISJOINT — measured over all 310 production slides, 0
 *     matched more than one. A and B cannot overlap because `[^/?]+$` forbids
 *     a slash.
 *   • ownership needs no new rule: `MIG-1019` requires the owner at path
 *     segment 2, which holds for all three shapes. 0 mismatches across 34.
 *   • `post-images/` and `avatars/` are key prefixes in ONE R2 bucket served
 *     by one CDN origin, so there is no cross-bucket mapping to get wrong.
 *     Verified by retrieval, not assumed.
 *
 * ⚠ WHAT IS DELIBERATELY EXCLUDED, AND MUST STAY EXCLUDED:
 *   `avatars/<uuid>/avatar.webp?t=…`   — MUTABLE. Overwritten on every profile
 *                                        photo change, so content identity can
 *                                        never be stable. No `/my-photos/` so
 *                                        class C does not reach it.
 *   `avatars/covers/<uuid>/<file>`     — the owner is at segment 3, not 2.
 *                                        `covers` is not a uuid so the pattern
 *                                        fails before MIG-1019 even runs.
 *   anything with `?`                  — `[^/?]+$` keeps a cache-buster out of
 *                                        an object key.
 *
 * ⚠ DO NOT REPLACE THESE WITH ONE PERMISSIVE PATTERN. Each is narrow on
 * purpose, and the narrowness is what keeps the two classes above out.
 */
const UUID_SEG = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const CANDIDATE_CLASSES: ReadonlyArray<{ cls: string; re: RegExp }> = [
  { cls: "A", re: new RegExp(`^post-images/${UUID_SEG}/posts/[^/?]+$`) },
  { cls: "B", re: new RegExp(`^post-images/${UUID_SEG}/[^/?]+$`) },
  { cls: "C", re: new RegExp(`^avatars/${UUID_SEG}/my-photos/${UUID_SEG}/[^/?]+$`) },
];

/**
 * Class A alone. FROZEN. Kept exported because the frozen fence, the approved
 * manifests and their tests are all defined against exactly this shape, and a
 * reader comparing them needs the same regex, not a widened one.
 */
export const CANDIDATE_PATH = CANDIDATE_CLASSES[0].re;

/** Which class a path belongs to, or null if it is not a candidate at all. */
export function candidateClass(objectPath: string): string | null {
  for (const { cls, re } of CANDIDATE_CLASSES) if (re.test(objectPath)) return cls;
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** `media_objects.mime` is CHECK-constrained to exactly these four. */
export const ALLOWED_MIME = ["image/webp", "image/jpeg", "image/png", "image/avif"];

/** `media_objects.visibility` is CHECK-constrained to exactly these three. */
export const ALLOWED_VISIBILITY = ["public", "restricted", "private"];

/**
 * ── 1. INTEGRITY ──────────────────────────────────────────────────────────
 * The manifest file must hash to the approved value. Byte-for-byte, before a
 * single row is looked at.
 *
 * The digest is passed in rather than computed here so this module stays
 * dependency-free: Deno and vitest both have SubtleCrypto, but they reach it
 * differently, and a shared module that imports either stops being shared.
 */
export function assertManifestIntegrity(
  actualSha256: string,
  approvedSha256: string,
): Refusal | null {
  if (!HEX64.test(actualSha256)) {
    return { code: "MIG-1001", detail: `manifest digest is not a sha256: ${actualSha256}` };
  }
  if (!HEX64.test(approvedSha256)) {
    return { code: "MIG-1002", detail: "approved digest is not a sha256" };
  }
  if (actualSha256 !== approvedSha256) {
    return {
      code: "MIG-1003",
      detail: `manifest is not the approved one: got ${actualSha256}, approved ${approvedSha256}`,
    };
  }
  return null;
}

/**
 * ── 2. PARSE ──────────────────────────────────────────────────────────────
 * Strict. 13 tab-separated columns, every field checked against the shape the
 * database will enforce anyway — so a bad row is refused here, where the error
 * names the row, rather than 200 posts later as a constraint violation.
 *
 * A repeated (post_id, ord) or a repeated (post_id, sha256) is refused: the
 * first would collide with `post_media_pkey`, the second with
 * `post_media_post_media_uniq`, and a migrator that discovers its own
 * duplicates halfway through has already written half a post.
 */
export function parseManifest(text: string): { rows: ManifestRow[]; refusal: Refusal | null } {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return { rows: [], refusal: { code: "MIG-1010", detail: "manifest is empty" } };
  }
  const rows: ManifestRow[] = [];
  const seenKey = new Set<string>();
  const seenPostSha = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].split("\t");
    const at = `line ${i + 1}`;
    if (f.length !== 13) {
      return { rows: [], refusal: { code: "MIG-1011", detail: `${at}: expected 13 columns, got ${f.length}` } };
    }
    const [post_id, owner_id, ordS, source_url, source_host, object_path,
           widthS, heightS, aspect_ratio, mime, bytesS, sha256, visibility] = f;

    if (!UUID.test(post_id)) return { rows: [], refusal: { code: "MIG-1012", detail: `${at}: bad post_id` } };
    if (!UUID.test(owner_id)) return { rows: [], refusal: { code: "MIG-1013", detail: `${at}: bad owner_id` } };
    const ord = Number(ordS);
    if (!Number.isInteger(ord) || ord < 1) {
      return { rows: [], refusal: { code: "MIG-1014", detail: `${at}: ord must be a positive integer` } };
    }
    if (source_host !== cdnHostFor()) {
      return { rows: [], refusal: { code: "MIG-1015", detail: `${at}: host ${source_host} is not ${cdnHostFor()}` } };
    }
    if (object_path.includes("..")) {
      return { rows: [], refusal: { code: "MIG-1016", detail: `${at}: object_path contains ".."` } };
    }
    if (candidateClass(object_path) === null) {
      return { rows: [], refusal: { code: "MIG-1017", detail: `${at}: object_path is not a post-photograph path` } };
    }
    // The URL must be exactly the host and path, so there is one address and
    // not two that can drift apart.
    if (source_url !== `https://${source_host}/${object_path}`) {
      return { rows: [], refusal: { code: "MIG-1018", detail: `${at}: source_url does not equal host + object_path` } };
    }
    // Cycle 4 proved this holds 207/207. Cycle 5A found it VIOLATED 3 times in
    // the avatar rows the old migrator would have taken. It is free; use it.
    if (object_path.split("/")[1] !== owner_id) {
      return { rows: [], refusal: { code: "MIG-1019", detail: `${at}: owner_id is not the object path's folder` } };
    }
    const width = Number(widthS), height = Number(heightS), bytes = Number(bytesS);
    if (!Number.isInteger(width) || width <= 0 || width > 100000) {
      return { rows: [], refusal: { code: "MIG-1020", detail: `${at}: width out of range` } };
    }
    if (!Number.isInteger(height) || height <= 0 || height > 100000) {
      return { rows: [], refusal: { code: "MIG-1021", detail: `${at}: height out of range` } };
    }
    if (!Number.isInteger(bytes) || bytes <= 0) {
      return { rows: [], refusal: { code: "MIG-1022", detail: `${at}: bytes must be > 0` } };
    }
    if (!ALLOWED_MIME.includes(mime)) {
      return { rows: [], refusal: { code: "MIG-1023", detail: `${at}: mime ${mime} is not allowed` } };
    }
    if (!HEX64.test(sha256)) {
      return { rows: [], refusal: { code: "MIG-1024", detail: `${at}: sha256 is not 64 hex characters` } };
    }
    if (!ALLOWED_VISIBILITY.includes(visibility)) {
      return { rows: [], refusal: { code: "MIG-1025", detail: `${at}: visibility ${visibility} is not allowed` } };
    }
    if (Math.abs(Number(aspect_ratio) - width / height) > 1e-6) {
      return { rows: [], refusal: { code: "MIG-1026", detail: `${at}: aspect_ratio does not equal width/height` } };
    }

    const key = `${post_id}|${ord}`;
    if (seenKey.has(key)) {
      return { rows: [], refusal: { code: "MIG-1027", detail: `${at}: duplicate (post_id, ord) ${key}` } };
    }
    seenKey.add(key);

    // Two slides of ONE post sharing bytes would resolve to a single
    // media_objects row and then collide on post_media_post_media_uniq. Refuse
    // it here, named, instead of failing the post on a constraint later.
    const ps = `${post_id}|${sha256}`;
    if (seenPostSha.has(ps)) {
      return { rows: [], refusal: { code: "MIG-1028", detail: `${at}: post ${post_id} repeats sha256 ${sha256.slice(0, 12)}…` } };
    }
    seenPostSha.add(ps);

    rows.push({ post_id, owner_id, ord, source_url, source_host, object_path,
                width, height, aspect_ratio, mime, bytes, sha256, visibility });
  }

  // Ordinals must be dense 1..n per post, because post_media.ord is the
  // member-visible order of their photographs and a gap is a lost slide.
  const byPost = groupByPost(rows);
  for (const [postId, group] of byPost) {
    const ords = group.map((r) => r.ord).sort((a, b) => a - b);
    for (let i = 0; i < ords.length; i++) {
      if (ords[i] !== i + 1) {
        return { rows: [], refusal: { code: "MIG-1029", detail: `post ${postId}: ordinals are not dense 1..${ords.length}` } };
      }
    }
    // One post, one owner. A post whose slides claim different owners is
    // incoherent and must never reach the database.
    if (new Set(group.map((r) => r.owner_id)).size !== 1) {
      return { rows: [], refusal: { code: "MIG-1030", detail: `post ${postId}: slides disagree about owner_id` } };
    }
  }

  return { rows, refusal: null };
}

export function groupByPost(rows: ManifestRow[]): Map<string, ManifestRow[]> {
  const m = new Map<string, ManifestRow[]>();
  for (const r of rows) m.set(r.post_id, [...(m.get(r.post_id) ?? []), r]);
  for (const [k, v] of m) m.set(k, v.slice().sort((a, b) => a.ord - b.ord));
  return m;
}

/**
 * The canonical key set. Sorted, newline-joined, ready to be hashed on either
 * side of the fence check. `(post_id, ord, source_url)` is the identity of a
 * slide: the post it belongs to, where it sits, and which object it is.
 */
export function keySetText(rows: { post_id: string; ord: number; source_url: string }[]): string {
  return rows.map((r) => `${r.post_id}|${r.ord}|${r.source_url}`).sort().join("\n");
}

/**
 * ── 3. FENCE ──────────────────────────────────────────────────────────────
 * The live fenced population must be EXACTLY the manifest. Not the same size —
 * the same set.
 *
 * Both digests are computed over `keySetText`: one here from the manifest, one
 * inside Postgres over posts created at or before the fence. They are compared
 * as strings. A count is never consulted.
 */
export function assertFence(
  manifestRows: ManifestRow[],
  liveKeySetDigest: string,
  manifestKeySetDigest: string,
  liveCount: number,
): Refusal | null {
  if (manifestKeySetDigest !== liveKeySetDigest) {
    return {
      code: "MIG-1040",
      detail:
        `fenced population does not match the manifest: manifest digest ${manifestKeySetDigest}, ` +
        `live digest ${liveKeySetDigest}. Do not proceed; produce a delta and have it approved.`,
    };
  }
  // Belt as well as braces: a digest match with a different length would mean
  // the digest function is broken, which is worth refusing loudly.
  if (liveCount !== manifestRows.length) {
    return {
      code: "MIG-1041",
      detail: `digests match but counts differ (live ${liveCount}, manifest ${manifestRows.length}) — refusing`,
    };
  }
  return null;
}

/**
 * ── 4. PLAN ONE POST ──────────────────────────────────────────────────────
 * A post is migrated whole or not at all — the same rule the publish gate
 * applies at the front door. The live slide list must equal the manifest's for
 * that post, in order.
 *
 * `alreadyDone` makes repeated execution a no-op rather than an error: a post
 * that already has references is SKIPPED, never re-written.
 */
export function planPost(
  postId: string,
  manifestRows: ManifestRow[],
  liveUrls: string[],
  alreadyDone: boolean,
): { plan: ManifestRow[] | null; skip: string | null; refusal: Refusal | null } {
  const group = manifestRows.filter((r) => r.post_id === postId).sort((a, b) => a.ord - b.ord);
  if (group.length === 0) {
    return { plan: null, skip: null, refusal: { code: "MIG-1050", detail: `post ${postId} is not in the manifest` } };
  }
  if (alreadyDone) return { plan: null, skip: "already-has-references", refusal: null };

  if (liveUrls.length !== group.length) {
    return {
      plan: null, skip: null,
      refusal: { code: "MIG-1051", detail: `post ${postId}: live has ${liveUrls.length} slides, manifest has ${group.length}` },
    };
  }
  for (let i = 0; i < group.length; i++) {
    if (liveUrls[i] !== group[i].source_url) {
      return {
        plan: null, skip: null,
        refusal: { code: "MIG-1052", detail: `post ${postId} slide ${i + 1}: live url differs from the manifest` },
      };
    }
  }
  return { plan: group, skip: null, refusal: null };
}

/**
 * ── 5. VERIFY THE BYTES ───────────────────────────────────────────────────
 * Nothing here is taken from a filename. The old migrator read dimensions with
 * `dimsFromName(key) ?? imageDimsFromBytes(bytes)` and MIME from the file
 * extension — the opposite of what `media-verify-upload` does to real uploads.
 * Here the measurement comes from the object and must EQUAL the manifest.
 */
export function verifyMeasured(row: ManifestRow, m: Measured): Refusal | null {
  if (m.status !== 200) return { code: "MIG-1060", detail: `${row.object_path}: HTTP ${m.status}` };
  if (m.bytes !== row.bytes) {
    return { code: "MIG-1061", detail: `${row.object_path}: bytes ${m.bytes} != manifest ${row.bytes}` };
  }
  if (!HEX64.test(m.sha256)) return { code: "MIG-1062", detail: `${row.object_path}: measured sha256 malformed` };
  if (m.sha256 !== row.sha256) {
    return { code: "MIG-1063", detail: `${row.object_path}: SHA-256 MISMATCH — object is not the one that was approved` };
  }
  if (m.mime !== row.mime) {
    return { code: "MIG-1064", detail: `${row.object_path}: mime ${m.mime} != manifest ${row.mime}` };
  }
  if (!ALLOWED_MIME.includes(m.mime)) {
    return { code: "MIG-1065", detail: `${row.object_path}: mime ${m.mime} is not allowed` };
  }
  if (!Number.isInteger(m.width) || m.width <= 0 || m.width !== row.width) {
    return { code: "MIG-1066", detail: `${row.object_path}: width ${m.width} != manifest ${row.width}` };
  }
  if (!Number.isInteger(m.height) || m.height <= 0 || m.height !== row.height) {
    return { code: "MIG-1067", detail: `${row.object_path}: height ${m.height} != manifest ${row.height}` };
  }
  return null;
}

/**
 * Across the whole manifest, one owner must not present the same bytes twice
 * under two different slides unless it is genuinely the same photograph — which
 * `UNIQUE (owner_id, sha256)` will collapse into one row. That is CORRECT and
 * allowed across posts; this reports it so a run is never surprised by a reuse
 * it did not expect.
 */
export function crossPostSharedContent(rows: ManifestRow[]): { owner_id: string; sha256: string; posts: string[] }[] {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${r.owner_id}|${r.sha256}`;
    m.set(k, (m.get(k) ?? new Set()).add(r.post_id));
  }
  return [...m.entries()].filter(([, posts]) => posts.size > 1).map(([k, posts]) => {
    const [owner_id, sha256] = k.split("|");
    return { owner_id, sha256, posts: [...posts] };
  });
}

/**
 * ── 6. RECONCILE ──────────────────────────────────────────────────────────
 * The end state, checked against the manifest rather than against a count of
 * what the run believed it did. `postMediaCount` and `mediaObjectCount` come
 * from the database after the run.
 */
/**
 * The end state as a SET, not a size. One line per reference:
 *   post_id|ord0|sha256      (ord0 is post_media.ord, i.e. the manifest ord - 1)
 * The database computes the same string in `media_migration_reconcile()`.
 */
export function expectedRefSetText(rows: ManifestRow[]): string {
  return rows.map((r) => `${r.post_id}|${r.ord - 1}|${r.sha256}`).sort().join("\n");
}

export function reconcile(
  rows: ManifestRow[],
  db: { postMediaCount: number; mediaObjectCount: number; unreferencedMediaCount: number;
        nonReadyMediaCount: number; refSetDigest?: string },
  expectedRefSetDigest?: string,
): { ok: boolean; failures: Refusal[] } {
  const failures: Refusal[] = [];
  const expectedRefs = rows.length;
  // Distinct content per owner is what media_objects can hold, because
  // UNIQUE (owner_id, sha256) collapses a repeat into the row it already has.
  const expectedMedia = new Set(rows.map((r) => `${r.owner_id}|${r.sha256}`)).size;

  if (db.postMediaCount !== expectedRefs) {
    failures.push({ code: "MIG-1070", detail: `post_media has ${db.postMediaCount}, manifest expects ${expectedRefs}` });
  }
  if (db.mediaObjectCount !== expectedMedia) {
    failures.push({ code: "MIG-1071", detail: `media_objects has ${db.mediaObjectCount}, manifest expects ${expectedMedia}` });
  }
  if (db.unreferencedMediaCount !== 0) {
    failures.push({ code: "MIG-1072", detail: `${db.unreferencedMediaCount} media_objects rows are referenced by nothing (orphans)` });
  }
  if (db.nonReadyMediaCount !== 0) {
    failures.push({ code: "MIG-1073", detail: `${db.nonReadyMediaCount} media_objects rows are not in state 'ready'` });
  }
  // ⚠ COUNT EQUALITY MUST NOT BE ABLE TO PRODUCE A PASS.
  // Audited 2026-08-17 (Cycle 7): the checks above compare totals, so a post
  // holding the right NUMBER of references pointing at the WRONG media
  // reconciled clean. This compares the actual (post, position, content) set.
  if (expectedRefSetDigest !== undefined || db.refSetDigest !== undefined) {
    if (!expectedRefSetDigest || !db.refSetDigest) {
      failures.push({ code: "MIG-1074", detail: "reference-set digest missing on one side — cannot reconcile by set" });
    } else if (expectedRefSetDigest !== db.refSetDigest) {
      failures.push({
        code: "MIG-1075",
        detail: `reference set differs from the manifest (expected ${expectedRefSetDigest}, actual ${db.refSetDigest}) — counts alone would have passed`,
      });
    }
  }
  return { ok: failures.length === 0, failures };
}
