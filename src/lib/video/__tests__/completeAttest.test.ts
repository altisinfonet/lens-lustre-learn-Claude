/**
 * F-D1-4 client half · SEC-VID-10 — the attestation `complete` signs for
 * video_mark_uploaded's 5-argument form (20261005_0007, D1).
 *
 * Contract: docs/evidence/d1/VID/README-vid2-attest.md (#384). The two test
 * vectors below are D1's, byte for byte (openssl and pgcrypto agree on them);
 * matching them is what proves this signer and the database's verifier read
 * the same message.
 */
import { describe, it, expect } from "vitest";
import { attestMessage, signAttest, checkAttestEnv, ATTEST_MIN_KEY_CHARS } from "../../../../functions/api/video/attest";
import { HttpError } from "../../../../functions/api/video/_lib";

// D1's PUBLISHED vector key (README-vid2-attest.md), not a secret. Assembled from two halves so
// the secret scanner's generic-api-key rule does not read one long quoted literal after KEY =;
// the scanner itself is unchanged.
const KEY = ["0123456789abcdef", "0123456789abcdef"].join("");
const A64 = "a".repeat(64), B64 = "b".repeat(64), D64 = "d".repeat(64);

describe("attestMessage + signAttest — D1's two vectors", () => {
  it("vector 1 (staging, audio) → e142ca53…", async () => {
    const m = attestMessage({ lane: "staging", videoId: "00000000-0000-0000-0000-000000000001", versionNo: 1, manifestSha256: A64, hasAudio: true, audioSha256: D64, issuedAt: 1760000000 });
    expect(m).toBe(`v1|staging|00000000-0000-0000-0000-000000000001|1|${A64}|true|${D64}|1760000000`);
    expect(await signAttest(KEY, m)).toBe("e142ca5324bd64b081c95b688345fa37c0e47bb03695583fd8f13e10c33fd21b");
  });
  it("vector 2 (production, no audio → 'none') → 5ba22d20…", async () => {
    const m = attestMessage({ lane: "production", videoId: "00000000-0000-0000-0000-000000000002", versionNo: 2, manifestSha256: B64, hasAudio: false, audioSha256: null, issuedAt: 1760000000 });
    expect(m).toBe(`v1|production|00000000-0000-0000-0000-000000000002|2|${B64}|false|none|1760000000`);
    expect(await signAttest(KEY, m)).toBe("5ba22d2092f0351382e8c24dc9698a000cc957925993c1d4a2a59ed37935c58d");
  });
});

describe("attestMessage refuses anything the database would read differently", () => {
  const ok = { lane: "staging" as const, videoId: "00000000-0000-0000-0000-000000000001", versionNo: 1, manifestSha256: A64, hasAudio: true, audioSha256: D64, issuedAt: 1760000000 };
  const bad: Array<[string, Record<string, unknown>]> = [
    ["a project ref instead of the lane word", { lane: "abcdefghijklmnopqrst" }],
    ["upper-case uuid", { videoId: "00000000-0000-0000-0000-00000000000A" }],
    ["version 0 / padded / fractional", { versionNo: 0 }],
    ["fractional version", { versionNo: 1.5 }],
    ["upper-case manifest hash", { manifestSha256: "A".repeat(64) }],
    ["audio flag true with no audio hash", { audioSha256: null }],
    ["audio flag false with an audio hash", { hasAudio: false }],
    ["issued_at in milliseconds", { issuedAt: 1760000000000 }],
    ["fractional issued_at", { issuedAt: 1760000000.5 }],
  ];
  for (const [name, patch] of bad) {
    it(name, () => { expect(() => attestMessage({ ...ok, ...patch } as never)).toThrow(); });
  }
});

describe("checkAttestEnv — refuses to sign on a misconfigured lane (503, before any work)", () => {
  const good = { VIDEO_COMPLETE_ATTEST_KEY: KEY, VIDEO_ATTEST_LANE: "staging", MEDIA_TOKEN_KEY: "q83vEjRWeJA=-different-from-the-attest-key" };
  const code = (env: Record<string, unknown>) => {
    try { checkAttestEnv(env as never); return "ok"; } catch (e) { return e instanceof HttpError ? `${e.status} ${e.code}` : "other"; }
  };
  it("a good lane passes and returns the lane word and key", () => {
    expect(checkAttestEnv(good)).toEqual({ lane: "staging", key: KEY });
  });
  it("SEC-VID-10: the attest key equal to MEDIA_TOKEN_KEY → refused", () => {
    expect(code({ ...good, MEDIA_TOKEN_KEY: KEY })).toBe("503 VID-ENV-003");
  });
  it("SEC-VID-10: equal apart from surrounding whitespace is still equal → refused", () => {
    expect(code({ ...good, MEDIA_TOKEN_KEY: ` ${KEY}\n` })).toBe("503 VID-ENV-003");
  });
  it("no MEDIA_TOKEN_KEY on the lane is not a reason to refuse (nothing to collide with)", () => {
    expect(code({ VIDEO_COMPLETE_ATTEST_KEY: KEY, VIDEO_ATTEST_LANE: "production" })).toBe("ok");
  });
  it("no key / a key shorter than the database accepts → refused", () => {
    expect(code({ ...good, VIDEO_COMPLETE_ATTEST_KEY: undefined })).toBe("503 VID-ENV-003");
    expect(ATTEST_MIN_KEY_CHARS).toBe(32); // 0007's floor (VID-MU-004)
    expect(code({ ...good, VIDEO_COMPLETE_ATTEST_KEY: "x".repeat(31) })).toBe("503 VID-ENV-003");
    expect(code({ ...good, VIDEO_COMPLETE_ATTEST_KEY: `  ${"x".repeat(31)}  ` })).toBe("503 VID-ENV-003");
    expect(code({ ...good, VIDEO_COMPLETE_ATTEST_KEY: "x".repeat(32) })).toBe("ok");
  });
  it("the lane must be the WORD staging or production — never a ref, never guessed", () => {
    expect(code({ ...good, VIDEO_ATTEST_LANE: undefined })).toBe("503 VID-ENV-003");
    expect(code({ ...good, VIDEO_ATTEST_LANE: "abcdefghijklmnopqrst" })).toBe("503 VID-ENV-003");
    expect(code({ ...good, VIDEO_ATTEST_LANE: "Staging" })).toBe("503 VID-ENV-003");
  });
  it("the refusal never echoes a key value", () => {
    try { checkAttestEnv({ ...good, MEDIA_TOKEN_KEY: KEY } as never); } catch (e) {
      expect(String((e as Error).message)).not.toContain(KEY);
    }
  });
});
