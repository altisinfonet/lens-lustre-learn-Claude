/**
 * THE SERVER MUST LOOK AT THE BYTES — AND AT THE RIGHT BYTES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The media engine's security claim is that publishing bytes the server never
 * checked is impossible. Before this function that claim was untested in the
 * strongest sense: NOTHING drove the state machine at all. `media_begin_upload`
 * had no caller and only the backfill touched verified/ready, so a real client
 * could never have completed an upload — the claim held only because the path
 * was unreachable.
 *
 * Now the path exists, three properties carry it, and each one is a hole if it
 * reverts:
 *
 *   1. THE KEY IS DERIVED, NEVER ACCEPTED. If the caller could name the object,
 *      they could point verification at someone else's photograph, and their
 *      row would go ready against bytes they never uploaded.
 *   2. OWNERSHIP IS CHECKED. Otherwise any member could drive any other
 *      member's upload through the state machine.
 *   3. A MISMATCH QUARANTINES. Not "retry", not "warn" — quarantine is
 *      terminal, and begin_upload refuses to re-hand a quarantined
 *      fingerprint, so the member gets a fresh row instead of a loop.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fn = strip(
  readFileSync(join(process.cwd(), "supabase/functions/media-verify-upload/index.ts"), "utf8"),
);

describe("the storage key is the server's, not the caller's", () => {
  it("the key is computed from the row's own owner and id", () => {
    expect(
      /return `post-images\/\$\{ownerId\}\/media\/\$\{mediaId\}\/original\.\$\{EXT_BY_MIME\[mime\] \?\? "webp"\}`;/.test(fn),
      "the derived-key helper changed shape — if the key stops being built " +
        "from the row's owner and id, verification can be aimed elsewhere.",
    ).toBe(true);
    expect(
      /const key = originalKeyFor\(row\.owner_id, row\.id, row\.mime\);/.test(fn),
      "the key is no longer derived from the ROW. If it comes from the " +
        "request, a member can have someone else's photograph hashed and " +
        "their own row marked ready against it.",
    ).toBe(true);
  });

  it("the request body supplies nothing but a media id", () => {
    const reads = [...fn.matchAll(/body\?\.([a-z_]+)/g)].map((m) => m[1]);
    expect(reads.sort()).toEqual(["media_id"]);
  });
});

describe("only your own upload", () => {
  it("a row belonging to someone else is indistinguishable from a missing one", () => {
    expect(
      /if \(row\.owner_id !== callerId\) return json\(\{ error: "No such upload" \}, 404\);/.test(fn),
      "the ownership check is gone — any member could drive any other " +
        "member's upload through the state machine.",
    ).toBe(true);
  });
  it("only a pending row may be verified", () => {
    expect(/if \(row\.state !== "pending"\)/.test(fn)).toBe(true);
  });
  it("re-verifying a finished upload succeeds instead of erroring", () => {
    expect(/already: true/.test(fn)).toBe(true);
  });
});

describe("the check itself", () => {
  it("the fingerprint is recomputed from the stored bytes", () => {
    expect(/crypto\.subtle\.digest\("SHA-256", bytes\)/.test(fn)).toBe(true);
    expect(/readS3Object\(s3, prefix \+ key\)/.test(fn), "no whole-object read").toBe(true);
    expect(
      /readS3ObjectHead/.test(fn),
      "verification reads only part of the object. A hash of a container " +
        "header matches almost every photograph, so this would verify nothing.",
    ).toBe(false);
  });

  it("both the fingerprint AND the byte length must agree", () => {
    expect(/const shaMatches = actualSha\.toLowerCase\(\) === String\(declaredSha\)\.toLowerCase\(\);/.test(fn)).toBe(true);
    expect(/const sizeMatches = bytes\.byteLength === Number\(row\.bytes\);/.test(fn)).toBe(true);
    expect(/if \(!shaMatches \|\| !sizeMatches\)/.test(fn)).toBe(true);
  });

  it("a mismatch QUARANTINES — it does not warn, skip, or retry", () => {
    const mismatchAt = fn.indexOf("if (!shaMatches || !sizeMatches)");
    const quarantineAt = fn.indexOf('rpc("media_quarantine"');
    const readyAt = fn.indexOf('rpc("media_mark_ready"');
    expect(quarantineAt, "no quarantine call").toBeGreaterThan(mismatchAt);
    expect(
      quarantineAt < readyAt,
      "the quarantine branch no longer precedes the ready call — bytes that " +
        "fail the check could reach ready.",
    ).toBe(true);
  });

  it("ready is only reached after verified, and only past the mismatch gate", () => {
    const mismatchAt = fn.indexOf("if (!shaMatches || !sizeMatches)");
    const verifiedAt = fn.indexOf('rpc("media_mark_verified"');
    const readyAt = fn.indexOf('rpc("media_mark_ready"');
    expect(verifiedAt > mismatchAt, "verified is set before the checksum gate").toBe(true);
    expect(readyAt > verifiedAt, "ready is set before verified").toBe(true);
  });

  it("a missing object leaves the row pending and retryable — it does not quarantine", () => {
    // The upload simply has not landed. Quarantining here would burn the
    // member's fingerprint for a network hiccup.
    expect(/state: "pending", retryable: true/.test(fn)).toBe(true);
  });
});

describe("dimensions are corrected from the bytes, not trusted", () => {
  it("parseable bytes overrule the client's declared size", () => {
    expect(/if \(parsed && \(parsed\.width !== row\.width \|\| parsed\.height !== row\.height\)\)/.test(fn)).toBe(true);
    expect(/\.update\(\{ width: parsed\.width, height: parsed\.height \}\)/.test(fn)).toBe(true);
  });
  it("unparseable bytes leave the declared values alone rather than guessing", () => {
    expect(/const parsed = imageDimsFromBytes\(bytes\);/.test(fn)).toBe(true);
  });
});

describe("abuse bounds", () => {
  it("each caller is rate limited, because every call reads a whole file", () => {
    expect(/if \(rateLimited\(callerId\)\)/.test(fn)).toBe(true);
    expect(/429/.test(fn)).toBe(true);
  });
  it("an unauthenticated caller gets nowhere", () => {
    expect(/if \(!authHeader\?\.startsWith\("Bearer "\)\) return json\(\{ error: "Unauthorized" \}, 401\);/.test(fn)).toBe(true);
  });
});
