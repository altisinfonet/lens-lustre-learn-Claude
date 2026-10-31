/**
 * AN EDGE FUNCTION THAT SPENDS MONEY ON SOMEONE ELSE'S API IS UNLIMITED BY
 * DEFAULT, AND SILENT ABOUT IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED ON PRODUCTION, 2026-08-15 — see docs/rate-limit-abuse-audit.md.
 *
 * 68 deployed edge functions. Eleven Postgres triggers enforce durable
 * per-user limits on the social write paths, and those are real. Three
 * functions carry an in-memory `Map` limiter, which resets on every isolate
 * cold start and is never shared between concurrent isolates, so it is
 * advisory. The other sixty-five have nothing.
 *
 * That is survivable for a function that only reads our own database. It is
 * not survivable for a function that calls a metered third party, because the
 * bill is ours and — this is the part that is easy to miss — the upstream 429
 * throttles OUR ACCOUNT KEY, not the abusive caller. One member looping
 * `translate-text` does not get slowed down; the AI stops working for everyone.
 *
 * WHAT THIS TEST ASKS FOR is deliberately modest, and identical in shape to
 * newTableGrants and deletionCoverage: a function that reaches a paid upstream
 * must either consume a DURABLE server-side counter, or be named here with a
 * reason. Silence is the failure mode, because silence looks exactly like a
 * decision that was never made.
 *
 * It does NOT demand that the fifteen current ones be fixed today — two of
 * them need a race closed first (R1, R2 in the audit) and that is a change to
 * production behaviour, not a test's business. It demands that the SIXTEENTH
 * cannot arrive unnoticed.
 *
 * WHY THE LEDGER TAKES A REASON AND NOT A BARE NAME: a bare allow-list is
 * copied without thought. Making the author write down what bounds the spend
 * is the whole mechanism; if they cannot, that is the finding.
 *
 * Functions are resolved at run time, never by a hardcoded list — trap #8.
 * `_shared` imports are inlined one level, because the auth and the HTTP calls
 * frequently live one import away: the first draft of the audit census
 * mislabelled six correctly-protected endpoints for exactly that reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS = join(process.cwd(), "supabase/functions");
const AUDIT_DOC = join(process.cwd(), "docs/rate-limit-abuse-audit.md");
const CONFIG_TOML = join(process.cwd(), "supabase/config.toml");

/**
 * Hosts and gateway indirections that cost real money per call. Deliberately
 * specific: an earlier, looser pattern (bare "LOVABLE_API_KEY", "smtp",
 * "googleapis.com") matched twenty-one functions including six that make no
 * outbound paid call at all. A gate that cries wolf is a gate nobody reads —
 * the same lesson scripts/security-audit.mjs already records.
 */
const PAID_UPSTREAM =
  /(ai\.gateway\.lovable\.dev|AI_GATEWAY_URL|api\.stripe\.com|api\.razorpay\.com|api-m\.paypal\.com|api-m\.sandbox\.paypal\.com|paypalBase|api\.brevo\.com|analyticsdata\.googleapis\.com|fcm\.googleapis\.com|oauth2\.googleapis\.com)/;

/**
 * The only thing that counts as a real limit here: an RPC that consumes a
 * counter the DATABASE owns, so it holds across isolates and cold starts.
 * An in-memory Map deliberately does NOT satisfy this — see the header.
 */
const DURABLE_LIMIT_RPC = /\.rpc\(\s*["'`][a-z_]*(quota|rate_limit|consume|throttle)[a-z_]*["'`]/i;

/**
 * The fifteen that exist today, each with what actually bounds the spend.
 * Removing an entry is how a fix gets recorded: close the race, add a durable
 * counter, delete the line.
 */
const COST_UPSTREAM_LEDGER: Record<string, string> = {
  "ask-anything":
    "has the right idea and the wrong implementation: ai_chat_usage gives 15/day anon (hashed IP+date) and 25/day registered, but the increment is a read-modify-write, fire-and-forget — audit R1",
  "analyze-gallery-image":
    "no limit at all; any signed-in member can loop paid vision calls — audit R3, fix is to reuse ai_chat_usage once R1 is closed",
  "detect-ai-image":
    "no limit at all; the 429 branch only relays the gateway's own throttle, which punishes our key not the caller — audit R3",
  "translate-text":
    "no limit at all; any signed-in member can loop paid AI calls — audit R3",
  "moderate-comment":
    "authorised to comment owner or admin, which is not a rate limit: a member may re-moderate their own comment endlessly — audit R3",
  "create-payment-session":
    "signed-in only; abuse creates junk checkout sessions at Stripe/Razorpay/PayPal, who apply their own per-merchant throttles. Nuisance, not loss",
  "paypal-capture-order":
    "signed-in, ownership-checked, and idempotency-keyed on the capture id, so a replay cannot double-credit; upstream calls are bounded by real orders",
  "razorpay-verify-payment":
    "signed-in, ownership-checked, and idempotency-keyed on the payment id; upstream calls are bounded by real orders",
  "send-push":
    "admin JWT or the internal shared secret only; never reachable by an ordinary member",
  "send-broadcast-push":
    "admin JWT only, deliberately with no internal-secret path, because a leaked secret must not be able to message the whole userbase",
  "process-email-queue":
    "queue worker, not a member-facing endpoint; carries its own Brevo 429 cooldown that stops the batch",
  "verify-email-provider":
    "admin JWT only; a one-shot provider check run by hand, so the caller set is the owner and the call count is human-paced",
  "diagnose-brevo-key":
    "admin JWT only; a diagnostic run by hand when mail misbehaves, so the caller set is the owner and the call count is human-paced",
  "test-smtp":
    "admin JWT only; sends a single test message on demand, so the caller set is the owner and the call count is human-paced",
  "ga-report":
    "admin JWT only; the analytics dashboard's own reads, bounded by how often an admin opens that page",
};

/** `_shared` is inlined one level so auth and fetch calls are not missed. */
function sourceOf(fn: string): string {
  const entry = join(FUNCTIONS, fn, "index.ts");
  let src = readFileSync(entry, "utf8");
  for (const m of src.matchAll(/from\s+["']\.\.\/_shared\/([\w./-]+)["']/g)) {
    const shared = join(FUNCTIONS, "_shared", m[1]);
    if (existsSync(shared)) src += "\n" + readFileSync(shared, "utf8");
  }
  return src;
}

const functionNames = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => d.name)
  .filter((n) => existsSync(join(FUNCTIONS, n, "index.ts")))
  .sort();

const paidFunctions = functionNames.filter((n) => PAID_UPSTREAM.test(sourceOf(n)));

describe("cost-bearing edge functions are limited or declared", () => {
  it("finds the functions at all (vacuity guard)", () => {
    // If a refactor moves supabase/functions, every assertion below passes by
    // scanning nothing. This is the tripwire for that.
    expect(functionNames.length).toBeGreaterThanOrEqual(60);
    expect(paidFunctions.length).toBeGreaterThanOrEqual(10);
  });

  it("every function that calls a paid upstream is durably limited or declared with a reason", () => {
    const undeclared: string[] = [];
    for (const fn of paidFunctions) {
      if (DURABLE_LIMIT_RPC.test(sourceOf(fn))) continue;
      const reason = COST_UPSTREAM_LEDGER[fn];
      if (!reason || reason.trim().length <= 20) undeclared.push(fn);
    }
    expect(
      undeclared,
      `These edge functions call a metered third party with no durable per-caller limit and no entry in ` +
        `COST_UPSTREAM_LEDGER: ${undeclared.join(", ")}. Either consume a database-owned counter (an RPC ` +
        `named *quota*/*rate_limit*/*consume*/*throttle*), or add an entry saying what bounds the spend. ` +
        `An in-memory Map does not count — it resets on every isolate cold start. See docs/rate-limit-abuse-audit.md.`,
    ).toEqual([]);
  });

  it("the ledger does not outlive the functions it describes", () => {
    // A stale entry is how an allow-list quietly grants something that no
    // longer exists — and how the NEXT function to take that name inherits an
    // exemption nobody granted it.
    const orphaned = Object.keys(COST_UPSTREAM_LEDGER).filter((fn) => !paidFunctions.includes(fn));
    expect(
      orphaned,
      `Ledger entries for functions that no longer call a paid upstream: ${orphaned.join(", ")}. Delete them.`,
    ).toEqual([]);
  });

  it("keeps the audit that justifies every exemption", () => {
    // Each reason above is a summary of a measurement. If the measurements are
    // deleted, the reasons become assertions nobody can check.
    expect(existsSync(AUDIT_DOC)).toBe(true);
  });

  it("send-transactional-email still declares verify_jwt = true", () => {
    // R6: that function decides "is this the service role?" by base64-decoding
    // the JWT payload WITHOUT verifying the signature. It is safe only because
    // the Supabase gateway rejects unsigned tokens first. Flip this flag to
    // false — as 25 other functions in this project already are — and the check
    // becomes a string comparison anyone can satisfy, letting a stranger send
    // mail as the platform. The flag lives in the Supabase dashboard, outside
    // this repo; config.toml is the only copy a test can watch.
    const cfg = readFileSync(CONFIG_TOML, "utf8");
    const block = cfg.match(/\[functions\.send-transactional-email\][^[]*/)?.[0] ?? "";
    expect(block, "no [functions.send-transactional-email] block in config.toml").not.toEqual("");
    expect(/verify_jwt\s*=\s*true/.test(block)).toBe(true);
  });
});
