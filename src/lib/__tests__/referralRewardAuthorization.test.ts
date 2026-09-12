/**
 * PROCESS_REFERRAL_REWARD — WHO YOU SAY YOU ARE WAS NEVER CHECKED (F-105d).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG (read from pg_proc on staging, 2026-09-12)
 *
 * Both overloads of `process_referral_reward` were SECURITY DEFINER, VOLATILE,
 * held EXECUTE for PUBLIC + anon + authenticated, took the beneficiary as an
 * ARGUMENT (`_referred_user_id`), and never compared it to `auth.uid()` — the
 * string did not appear in either body. Both call `wallet_transaction()`, which
 * issues the credit. So any signed-in member could POST
 *
 *     /rest/v1/rpc/process_referral_reward
 *       { "_referred_user_id": "<somebody else's id>", "_activity_type": "x" }
 *
 * and move money on behalf of a member who never appears in the request.
 *
 * The Auditor sized it honestly in PROMOTION_LEDGER §44.5: production has zero
 * referral rows, so the function returns at its first statement and it is
 * **"ARMED, NOT LOADED"**. That is a fact about the DATA. The first referral row
 * loads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REVOKE WAS NOT THE FIX, AND WHY THAT IS THE INTERESTING PART
 *
 * F-105a and F-105c were revokes — nothing called those functions as a member,
 * so the grant could simply go. This one has TWO live member call sites, and
 * they are not the same caller:
 *
 *   CompetitionSubmit.tsx  -> 3-arg, `_referred_user_id: user.id`  (SELF)
 *   AdminReferrals.tsx     -> 2-arg, `_referred_user_id: ref.referred_id` (OTHER)
 *
 * A blanket `REVOKE FROM authenticated` takes both features down. So the control
 * moved INSIDE the function: self, or admin. The grant to `authenticated` stays,
 * which is why the tests below assert it is still there — an over-revoke is as
 * much a defect as an under-revoke, and it is the easier mistake to make.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE TESTS READ SQL
 *
 * The rule lives in a Postgres function; there is no TypeScript left to
 * unit-test (WORKING_RULES §14), exactly as with `get_todays_birthdays` in
 * birthdayVisibility.test.ts. So these pin the SQL and the call sites. The
 * BEHAVIOUR is proven separately and against the running database by
 * `supabase/migrations/PROBE_f105d_process_referral_reward_authorized.sql`,
 * which signs in as one member, names another, and requires the refusal — these
 * tests do not and cannot replace it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const MIGRATION = read(
  "supabase/migrations/20260910_0019_f105d_process_referral_reward_authorize.sql",
);

/**
 * Comments AND the `COMMENT ON` documentation strings are stripped — a
 * source-pin test must never match its own explanation. The header of this
 * migration discusses `auth.uid()`, `<>`, the revoke and both call sites at
 * length, and would satisfy almost every assertion below on its own.
 */
const sql = MIGRATION.replace(/^\s*--.*$/gm, "")
  .replace(/--.*$/gm, "")
  .replace(/COMMENT ON[\s\S]*?';/g, "");

describe("the guard exists, on both overloads", () => {
  it("both overloads are redefined by this migration", () => {
    const defs = sql.match(
      /CREATE OR REPLACE FUNCTION public\.process_referral_reward\(/g,
    );
    expect(defs).toHaveLength(2);
  });

  it("the authorisation check appears once per overload", () => {
    // Two functions, two guards. Closing one overload and not the other is
    // exactly how the 2-arg was missed when this was first swept.
    const guards = sql.match(/public\.has_role\(_caller, 'admin'::app_role\)/g);
    expect(guards).toHaveLength(2);
  });

  it("compares the argument against auth.uid(), which is what was missing", () => {
    const checks = sql.match(/_caller := \(select auth\.uid\(\)\);/g);
    expect(checks).toHaveLength(2);
  });

  it("uses (select auth.uid()), not a bare call", () => {
    // House rule: a bare auth.uid() re-evaluates per row.
    expect(sql).not.toMatch(/[^(]auth\.uid\(\)\s*;/);
  });
});

describe("the guard is NULL-safe, which is the whole trap", () => {
  it("uses IS DISTINCT FROM, never a bare <> against auth.uid()", () => {
    // `_referred_user_id <> NULL` is NULL, not TRUE. Written with `<>`, the IF
    // is not taken and an unauthenticated caller walks through the guard — the
    // opposite of what it is for.
    expect(sql).toMatch(/_referred_user_id IS DISTINCT FROM _caller/);
    expect(sql).not.toMatch(/_referred_user_id\s*<>\s*_caller/);
    expect(sql).not.toMatch(/_referred_user_id\s*<>\s*\(?\s*select auth\.uid/);
  });

  it("refuses a NULL caller explicitly, before the comparison", () => {
    const nullChecks = sql.match(/IF _caller IS NULL THEN/g);
    expect(nullChecks).toHaveLength(2);
  });

  it("raises insufficient_privilege rather than returning quietly", () => {
    // enroll_in_course wraps its call in EXCEPTION WHEN OTHERS THEN NULL, so a
    // silent RETURN here would be indistinguishable from success. 42501 is also
    // what the probe catches by name.
    const codes = sql.match(/USING ERRCODE = '42501'/g);
    expect(codes).toHaveLength(4); // two overloads × (null caller + not self/admin)
  });
});

describe("the ACL change is a closure, not an outage", () => {
  it("revokes PUBLIC and anon from both overloads", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_referral_reward\(uuid, text\)\s+FROM PUBLIC, anon;/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_referral_reward\(uuid, text, numeric\) FROM PUBLIC, anon;/,
    );
  });

  it("names PUBLIC as well as anon — F-62/F-98", () => {
    // Revoking only `anon` leaves the empty-grantee `=X/postgres` entry
    // standing and the function stays reachable through PUBLIC while the
    // catalogue looks changed.
    const revokes = sql.match(/FROM PUBLIC, anon;/g);
    expect(revokes).toHaveLength(2);
  });

  it("does NOT revoke from authenticated — both call sites are member-invoked", () => {
    expect(sql).not.toMatch(/REVOKE[^;]*process_referral_reward[^;]*authenticated/);
  });

  it("uses CREATE OR REPLACE, never DROP — a DROP resets the ACL (F-66)", () => {
    // DROP + CREATE re-acquires PUBLIC + anon + authenticated silently from
    // ALTER DEFAULT PRIVILEGES, which is how get_todays_birthdays came to hold
    // a grant no migration line ever wrote.
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*process_referral_reward/i);
  });

  it("is one transaction, so a half-applied guard cannot exist", () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/COMMIT;\s*$/);
  });
});

describe("the call sites this was measured against have not moved", () => {
  it("CompetitionSubmit still calls it for the caller's OWN id", () => {
    // If this ever becomes anything but `user.id`, the self branch of the guard
    // stops covering it and the feature breaks — loudly, which is correct, but
    // this test is the cheaper place to find out.
    const submit = stripComments(read("src/pages/CompetitionSubmit.tsx"));
    expect(submit).toMatch(/process_referral_reward[\s\S]{0,120}_referred_user_id:\s*user\.id/);
  });

  it("AdminReferrals still calls it for SOMEBODY ELSE's id", () => {
    // This is the call that makes a blanket revoke impossible and the admin
    // branch of the guard necessary.
    const admin = stripComments(read("src/components/admin/AdminReferrals.tsx"));
    expect(admin).toMatch(
      /process_referral_reward[\s\S]{0,120}_referred_user_id:\s*ref\.referred_id/,
    );
  });

  it("no third client call site has appeared", () => {
    // The guard permits self and admin. A new call site passing anything else
    // would fail at runtime; the inventory is part of the design, so it is
    // pinned rather than re-derived.
    const submit = read("src/pages/CompetitionSubmit.tsx");
    const admin = read("src/components/admin/AdminReferrals.tsx");
    const hits = (s: string) => (s.match(/process_referral_reward/g) ?? []).length;
    expect(hits(submit)).toBe(1);
    expect(hits(admin)).toBe(1);
  });
});

describe("what this migration deliberately does NOT do", () => {
  it("leaves _txn_amount caller-supplied, and says so in the file", () => {
    // The minimum-spend rule is gated on a number the browser sends. After
    // F-105d a member can still clear it for their OWN referral without having
    // paid. That is a different fault with a different fix (move the call
    // behind the submission RPC, as enroll_in_course already does for courses)
    // and it must not be quietly bundled in here — but it must not be
    // forgotten either, so the admission is pinned.
    expect(MIGRATION).toMatch(/_txn_amount/);
    expect(MIGRATION).toMatch(/authorisation fix and is labelled as one/);
  });

  it("does not touch enroll_in_course, whose own guard has the <> hole", () => {
    // Reported, not silently edited: it is a different function with a
    // different gate, and one change is one migration.
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.enroll_in_course/);
  });
});
