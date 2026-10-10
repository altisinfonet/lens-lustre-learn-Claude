/**
 * F-D1-4 client half · the attestation /api/video/complete signs for
 * video_mark_uploaded's 5-argument form (20261005_0007, D1; SEC T1 ACCEPT).
 *
 * Contract (docs/evidence/d1/VID/README-vid2-attest.md, read 2026-10-10):
 *   _attest = lowercase hex HMAC-SHA256(key, message), message UTF-8, no newline:
 *   v1|<lane>|<video_id>|<version_no>|<manifest_sha256>|<has_audio>|<audio_sha256>|<issued_at>
 *     lane          the WORD "staging" or "production" — never the project ref
 *     video_id      lowercase hyphenated uuid
 *     version_no    decimal, no padding
 *     manifest/audio 64 lowercase hex; audio is the word "none" when there is no audio
 *     issued_at     Unix SECONDS when complete signed (the DB accepts ≤ 15 min old, ≤ 60 s ahead)
 * The database rebuilds the message from its own stored row and compares, so
 * any field this file gets wrong is a refusal (VID-MU-005), never a bypass.
 * D1's two test vectors are pinned in src/lib/video/__tests__/completeAttest.test.ts.
 *
 * ENVIRONMENT (Pages project, per lane — the Owner sets these; none in the repo):
 *   VIDEO_COMPLETE_ATTEST_KEY — = vault secret video_complete_attest_key on that
 *                               lane's database. ≥ 32 characters, different per lane.
 *   VIDEO_ATTEST_LANE         — "staging" or "production", the word 0007 fixed into
 *                               that lane's database at apply time. Pages Functions
 *                               get no other lane signal (functions/_seo.ts) and
 *                               scripts/lane-config.mjs is frozen, so the word is
 *                               set explicitly. A wrong word cannot open anything:
 *                               the database refuses (VID-MU-005).
 *   MEDIA_TOKEN_KEY           — read ONLY to refuse a collision (SEC-VID-10): one
 *                               leaked key must never both mint play tokens and
 *                               mark uploads.
 *
 * A misconfigured lane answers 503 VID-ENV-003 BEFORE complete copies anything:
 * it is the lane's fault, not the member's, so the upload job retries later
 * instead of telling the member their video was refused. Messages name the
 * variable, never a value.
 */
import { HttpError } from "./_lib";

export interface AttestEnv {
  VIDEO_COMPLETE_ATTEST_KEY?: string;
  VIDEO_ATTEST_LANE?: string;
  MEDIA_TOKEN_KEY?: string;
}

export type AttestLane = "staging" | "production";

/** 0007 ignores a key shorter than this and fails closed (VID-MU-004). */
export const ATTEST_MIN_KEY_CHARS = 32;

const notReady = (why: string) =>
  new HttpError(503, "VID-ENV-003", `video uploads are not configured on this lane yet: ${why}`);

/** SEC-VID-10 + F-D1-4: the lane may sign only with its own, distinct key. */
export function checkAttestEnv(env: AttestEnv): { lane: AttestLane; key: string } {
  const key = env.VIDEO_COMPLETE_ATTEST_KEY ?? "";
  if (key.trim().length < ATTEST_MIN_KEY_CHARS) {
    throw notReady(`VIDEO_COMPLETE_ATTEST_KEY is missing or shorter than ${ATTEST_MIN_KEY_CHARS} characters`);
  }
  const media = env.MEDIA_TOKEN_KEY;
  if (typeof media === "string" && media.trim() !== "" && media.trim() === key.trim()) {
    throw notReady("VIDEO_COMPLETE_ATTEST_KEY must not be the same value as MEDIA_TOKEN_KEY (SEC-VID-10)");
  }
  const lane = env.VIDEO_ATTEST_LANE;
  if (lane !== "staging" && lane !== "production") {
    throw notReady('VIDEO_ATTEST_LANE must be exactly "staging" or "production"');
  }
  return { lane, key };
}

export interface AttestFields {
  lane: AttestLane;
  videoId: string;
  versionNo: number;
  manifestSha256: string;
  hasAudio: boolean;
  /** 64 lowercase hex, or null when there is no audio (sent as the word "none"). */
  audioSha256: string | null;
  /** Unix seconds. */
  issuedAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** The exact message 0007 rebuilds. Throws on anything the database would read differently. */
export function attestMessage(f: AttestFields): string {
  if (f.lane !== "staging" && f.lane !== "production") throw new Error("attest: lane must be the word staging or production");
  if (!UUID.test(f.videoId)) throw new Error("attest: video_id must be a lowercase uuid");
  if (!Number.isSafeInteger(f.versionNo) || f.versionNo < 1) throw new Error("attest: version_no must be a positive integer");
  if (!HEX64.test(f.manifestSha256)) throw new Error("attest: manifest_sha256 must be 64 lowercase hex");
  if (f.hasAudio ? !(typeof f.audioSha256 === "string" && HEX64.test(f.audioSha256)) : f.audioSha256 !== null) {
    throw new Error("attest: audio_sha256 must be 64 lowercase hex exactly when has_audio is true");
  }
  // Seconds, not ms: anything past year 2286 in seconds is a millisecond value.
  if (!Number.isSafeInteger(f.issuedAt) || f.issuedAt < 0 || f.issuedAt > 9_999_999_999) {
    throw new Error("attest: issued_at must be Unix seconds");
  }
  return ["v1", f.lane, f.videoId, String(f.versionNo), f.manifestSha256, String(f.hasAudio), f.audioSha256 ?? "none", String(f.issuedAt)].join("|");
}

/** lowercase hex HMAC-SHA256 of the message under the key (both UTF-8). */
export async function signAttest(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The database's attestation refusals (0007): the lane's configuration, not the member's video. */
export const ATTEST_DB_CODES = ["VID-MU-004", "VID-MU-005", "VID-MU-006"] as const;
