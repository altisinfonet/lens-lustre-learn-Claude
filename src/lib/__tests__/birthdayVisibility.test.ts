/**
 * TODAY'S BIRTHDAY — THE 50-ROW BUG, AND THE PRIVACY RULE THAT CAME WITH IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG (measured on production, 2026-08-04)
 *
 * The sidebar's birthday list was computed in TypeScript inside dashboard-init
 * from a query that read `.limit(50)` with no `ORDER BY`. The site has 82
 * members; 68 have a date of birth recorded; **28 of those 68 sit outside that
 * 50-row window** and so could never appear on their own birthday — including
 * SOMNATH PAL (20 Aug), the next birthday due at the time of the report.
 *
 * The second fault only becomes dangerous once the first is fixed: the code
 * never looked at `privacy_settings->>'dob_day_month'`, the control Edit
 * Profile offers as "Control who can see your birthday". Production split:
 * 1 `public`, 16 `friends`, 2 `only_me`, 49 unset — and **the Edit Profile UI
 * defaults that control to "friends"**, so those 49 have been told their
 * birthday is friends-only. Lifting the cap alone would have newly exposed 9
 * members who had explicitly restricted it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE TESTS READ SQL
 *
 * The rule now lives in `get_todays_birthdays()`, a Postgres function. There is
 * no TypeScript left to unit-test — which is the point (WORKING_RULES §14). So
 * these pin the SQL and the call site: that no limit came back, that the
 * default is `friends` and not `public`, that `only_me` has no branch that can
 * reach it, and that dashboard-init no longer derives birthdays from the
 * 50-row query.
 *
 * The behaviour itself was proven against real rows before this shipped; the
 * numbers are recorded in the migration header and in PROJECT_MASTER_RECORD.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const RPC = read("supabase/migrations/20260804160000_todays_birthdays_rpc.sql");
/**
 * Comments AND the `COMMENT ON` documentation string are stripped — a
 * source-pin test must never match its own explanation. (The `COMMENT ON` text
 * mentions the LIMIT 50 it replaced, which would satisfy the very assertion
 * that is supposed to prove the limit is gone.)
 */
const rpcBody = RPC.replace(/^\s*--.*$/gm, "")
  .replace(/--.*$/gm, "")
  .replace(/COMMENT ON[\s\S]*?;/g, "");
const edgeFn = read("supabase/functions/dashboard-init/index.ts");
const edgeBody = edgeFn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the 50-row window is gone", () => {
  it("the function has no LIMIT at all", () => {
    // 28 of 68 members were invisible because of one. There is no row count
    // that is correct here — the answer is "everyone whose birthday it is".
    expect(rpcBody).not.toMatch(/\bLIMIT\b/i);
  });

  it("dashboard-init no longer derives birthdays from the profiles query", () => {
    // The old code read `p.date_of_birth` out of the LIMIT-50 result and pushed
    // matches into `birthdays`. If that loop ever comes back, so does the bug.
    expect(edgeBody).not.toMatch(/birthdays\.push\(/);
    expect(edgeBody).not.toMatch(/dobMD/);
  });

  it("birthdays come from the RPC instead", () => {
    expect(edgeBody).toMatch(/admin\.rpc\("get_todays_birthdays", \{ _viewer: targetUserId \}\)/);
    expect(edgeBody).toMatch(/const birthdays: any\[\] = \(\(todaysBirthdaysRes as any\)\?\.data \?\? \[\]\)/);
  });

  it("an anonymous caller still gets an empty list, without a query", () => {
    // PII-derived data must not reach a logged-out visitor, and Q12 must not
    // run at all for one.
    expect(edgeBody).toMatch(/targetUserId\s*\?\s*admin\.rpc\("get_todays_birthdays"/);
    expect(edgeBody).toMatch(/Promise\.resolve\(\{ data: \[\] as any\[\] \}\)/);
  });

  it("the milestones/suggestions query is deliberately left alone", () => {
    // The owner scoped this to birthdays. Quietly widening two other features
    // in the same change is exactly the "bulk modification" his standing rules
    // forbid — the weakness is recorded instead.
    expect(edgeBody).toMatch(/\.limit\(50\)/);
  });
});

describe("each member's own privacy choice decides who sees them", () => {
  it("reads the same key Edit Profile writes", () => {
    expect(rpcBody).toMatch(/privacy_settings->>'dob_day_month'/);
  });

  it("defaults to 'friends', because that is what Edit Profile shows", () => {
    // 49 members never touched the control. `EditProfile.tsx` initialises it to
    // "friends", so the app has been telling them friends-only. Defaulting to
    // 'public' here would break that promise for 49 people in one deploy.
    expect(rpcBody).toMatch(/COALESCE\(NULLIF\(p\.privacy_settings->>'dob_day_month', ''\), 'friends'\)/);
    expect(rpcBody).not.toMatch(/'dob_day_month'[^)]*\),\s*'public'\)/);
  });

  it("the Edit Profile default really is 'friends' — not assumed, read", () => {
    const editProfile = read("src/pages/EditProfile.tsx");
    expect(editProfile).toMatch(/useState<PrivacyLevel>\("friends"\)/);
  });

  it("'friends' requires an ACCEPTED friendship, not a pending request", () => {
    // 97 of 134 friendship rows on production are still `pending`.
    expect(rpcBody).toMatch(/f\.status = 'accepted'/);
    expect(rpcBody).toMatch(/requester_id = _viewer AND f\.addressee_id = p\.id/);
    expect(rpcBody).toMatch(/addressee_id = _viewer AND f\.requester_id = p\.id/);
  });

  it("'only_me' has no branch that can match it", () => {
    // The visibility test is a whitelist of 'public' and 'friends' plus self.
    // There is no `<> 'only_me'` anywhere, which would have been the fragile way
    // to write it.
    expect(rpcBody).not.toMatch(/only_me/);
  });

  it("you can always see your own birthday", () => {
    expect(rpcBody).toMatch(/p\.id = _viewer/);
  });

  it("suspended members are still excluded", () => {
    expect(rpcBody).toMatch(/p\.is_suspended = false/);
  });
});

describe("the function cannot be called by a logged-out visitor", () => {
  it("execute is revoked from anon and granted only to the service role", () => {
    expect(rpcBody).toMatch(/REVOKE ALL ON FUNCTION public\.get_todays_birthdays\(uuid\) FROM PUBLIC, anon/);
    expect(rpcBody).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_todays_birthdays\(uuid\) TO service_role/);
  });

  it("is SECURITY DEFINER with a pinned search_path", () => {
    // It reads `profiles`, which RLS protects. Without the pinned search_path a
    // definer function is a privilege-escalation shape.
    expect(rpcBody).toMatch(/SECURITY DEFINER/);
    expect(rpcBody).toMatch(/SET search_path TO 'public'/);
  });
});

describe("the day boundary was NOT quietly moved", () => {
  it("still matches on the server clock, exactly as the TypeScript did", () => {
    // The old code used `now.getMonth()/getDate()` — UTC. `to_char(now(),…)`
    // is UTC too on this instance. For an India-centred community that means
    // the card turns over at 05:30 IST; changing it is an open decision, not
    // something to slip into a fix for a different bug.
    expect(rpcBody).toMatch(/to_char\(p\.date_of_birth, 'MM-DD'\) = to_char\(now\(\), 'MM-DD'\)/);
  });
});
