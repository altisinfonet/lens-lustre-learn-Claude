/**
 * WHY TOKEN REFRESH IS **NOT** EXEMPT FROM THE 25-SECOND ABORT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This file exists to stop a plausible-sounding "fix" being applied later —
 * including by me, because I proposed it myself and I was wrong.
 *
 * THE PROPOSAL, written into docs/fix-sprints/owner-reported-3-bugs-2026-08-15.md
 * on 2026-08-15 as suspect #1 for the owner's random sign-outs:
 *
 *   "src/integrations/supabase/client.ts wraps every request in a 25s abort.
 *    It carefully exempts uploads — but NOT /auth/v1/token. On a poor
 *    connection a stalled refresh is aborted, and a failed refresh can end the
 *    session."
 *
 * It reads well. It is false, and the library source says so.
 *
 * WHAT WAS ACTUALLY CHECKED, in node_modules/@supabase/auth-js:
 *
 *   1. `lib/fetch.js` — a fetch that THROWS (which is exactly what our abort
 *      does) is caught and re-thrown as `AuthRetryableFetchError`.
 *   2. `GoTrueClient.js` — the session is removed on a refresh failure only
 *      `if (!isAuthRetryableFetchError(error))`.
 *
 *   Our abort is retryable ⇒ the session is NOT removed. It is retried on the
 *   next auto-refresh tick. The 25-second abort cannot sign a member out.
 *
 * AND REMOVING IT WOULD BE WORSE. A refresh with no bound at all can hang
 * forever on a stalled socket, and auth-js holds `refreshingDeferred` while one
 * is in flight — so a single hung refresh would block every later refresh for
 * the life of the page. The 25s abort is what releases it. The upload exemption
 * is justified by SIZE (a photo is legitimately slow); a token refresh is a
 * tiny request that is only ever slow because the network is bad, which is
 * precisely the case the abort exists for.
 *
 * MEASURED ON PRODUCTION the same day, ruling out the neighbouring suspects:
 *   • 118 live sessions, every one holding exactly ONE usable refresh token.
 *     Zero sessions locked out, zero holding multiple usable tokens — so there
 *     is no evidence of refresh-token reuse, the other classic cause.
 *   • Zero sessions carry a hard expiry, so nothing is being timeboxed out.
 *
 * WHAT REMAINS: a stored session that fails validation — WebView storage loss
 * or corruption. That is what `storedSessionPresent` in the session-loss
 * recorder measures, and it is now the leading suspect by elimination rather
 * than by guesswork.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const CLIENT = readFileSync(join(root, "src/integrations/supabase/client.ts"), "utf8");

describe("the abort still applies to auth, on purpose", () => {
  it("only UPLOADS are exempt — COUNTED, because a keyword search misses escapes", () => {
    /**
     * `isUpload` must be the single exemption. A second one appearing here
     * without the reasoning above being disproven first is the regression this
     * file guards against.
     *
     * Asserted by COUNTING the unbounded early-returns rather than by grepping
     * for words like "auth/v1/token": a mutation that added exactly that
     * exemption, written as the regex `/\/auth\/v1\/token/`, sailed straight
     * past the keyword version of this test, because the escaped source text
     * does not contain the unescaped substring. Counting the behaviour cannot
     * be dodged by spelling.
     */
    const fn = CLIENT.slice(CLIENT.indexOf("const timeoutFetch"), CLIENT.indexOf("export const supabase"));
    const unbounded = fn.match(/return fetch\(input, init\);/g) ?? [];
    expect(unbounded).toHaveLength(1);
    expect(fn).toMatch(/if \(isUpload\(input, init\)\) return fetch\(input, init\);/);
  });

  it("the exemption test is about STORAGE WRITES, not about auth", () => {
    expect(CLIENT).toMatch(/\/\\\/storage\\\/v1\\\/object\\\//);
  });

  it("there is exactly one timeout, and it is finite", () => {
    const m = CLIENT.match(/const READ_TIMEOUT_MS = ([\d_]+);/);
    expect(m).not.toBeNull();
    const ms = Number(m![1].replace(/_/g, ""));
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
  });
});

describe("the library behaviour this conclusion rests on", () => {
  /**
   * Asserted against the INSTALLED library, not from memory. If a future
   * upgrade changes how a thrown fetch is classified, this fails and the
   * conclusion above must be re-derived rather than assumed to still hold.
   */
  const AUTH_DIR = join(root, "node_modules/@supabase/auth-js/dist/main");

  it("the auth library is present to check", () => {
    expect(existsSync(join(AUTH_DIR, "lib/fetch.js"))).toBe(true);
    expect(existsSync(join(AUTH_DIR, "GoTrueClient.js"))).toBe(true);
  });

  it("a THROWN fetch — our abort — becomes a RETRYABLE auth error", () => {
    const fetchSrc = readFileSync(join(AUTH_DIR, "lib/fetch.js"), "utf8");
    // catch (e) { ... throw new AuthRetryableFetchError(...) }
    expect(fetchSrc).toMatch(/catch \(e\) \{[\s\S]{0,200}AuthRetryableFetchError/);
  });

  it("the session is removed ONLY when the error is NOT retryable", () => {
    const clientSrc = readFileSync(join(AUTH_DIR, "GoTrueClient.js"), "utf8");
    expect(clientSrc).toMatch(
      /if \(!\(0, errors_1\.isAuthRetryableFetchError\)\(error\)\) \{[\s\S]{0,200}_removeSession\(\)/,
    );
  });
});

describe("the write-up matches the finding", () => {
  it("the bug document no longer presents the timeout as a suspect", () => {
    const doc = readFileSync(
      join(root, "docs/fix-sprints/owner-reported-3-bugs-2026-08-15.md"),
      "utf8",
    );
    // A document that still lists a disproven suspect sends the next person
    // down a dead end — which is the whole failure mode this project keeps
    // catching itself in.
    expect(doc).toMatch(/DISPROVEN/);
    expect(doc).toMatch(/AuthRetryableFetchError/);
  });
});
