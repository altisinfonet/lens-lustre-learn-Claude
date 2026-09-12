/**
 * THE ADMIN APPROVE BUTTON HAS NEVER WORKED (F-105e).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG (measured over real HTTP against staging, 2026-09-12)
 *
 * `process_referral_reward` has two overloads, and the three-argument one gives
 * `_txn_amount` a DEFAULT. That makes it an equally good candidate for a
 * TWO-argument call, so PostgREST cannot choose:
 *
 *   POST /rest/v1/rpc/process_referral_reward
 *   { "_referred_user_id": "…", "_activity_type": "manual approval" }
 *     -> HTTP 300  PGRST203  Could not choose the best candidate function
 *
 * `AdminReferrals.tsx:124` sends exactly those two keys. The Approve button has
 * been raising "Reward failed" and approving nothing.
 *
 * The control that makes it conclusive: the same endpoint with THREE keys
 * returned 401 / 42501 permission denied — refused for PERMISSION, while the
 * two-key call was refused at ROUTING with a 300, before any permission check.
 * Routing precedes authorisation, and a JWT changes only authorisation, so an
 * admin gets the same 300. No admin token was needed to establish that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FIX IS "REMOVE THE DEFAULT" AND NOT THE TWO OBVIOUS ALTERNATIVES
 *
 * Both alternatives replace a LOUD failure with a SILENT one, which is worse:
 *
 *   1. Point AdminReferrals at the three-argument overload. That body contains
 *      `IF _manual_approval THEN RETURN; END IF;`; the two-argument body has
 *      none of the enabled / minimum / manual-approval / cap checks. Manual
 *      approval is the only setting under which an admin approves anything, so
 *      the button would silently do nothing in exactly its own use case.
 *
 *   2. Drop or rename the two-argument overload. A two-key request then falls
 *      through to the three-argument function VIA THE DEFAULT — same silent
 *      no-op, in the window between applying the SQL and deploying the client.
 *      Any rename must remove the DEFAULT first anyway.
 *
 * So: remove the default, change no client code, and each arity resolves to
 * exactly one function with the semantics it already had.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE TESTS READ SQL
 *
 * The rule lives in a function signature, not in TypeScript (WORKING_RULES §14),
 * exactly as with birthdayVisibility.test.ts. These pin the migration and the
 * two call-site shapes. The BEHAVIOUR is proven against the running database by
 * `supabase/migrations/PROBE_f105e_referral_overload_unambiguous.sql`, and over
 * real HTTP by the pg_net readings recorded in the migration header — these
 * tests do not and cannot replace either.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const MIGRATION = read(
  "supabase/migrations/20260910_0022_f105e_referral_overload_unambiguous.sql",
);
const ROLLBACK = read(
  "supabase/rollback/20260910_0022_f105e_referral_overload_unambiguous_ROLLBACK.sql",
);

/**
 * Comments and `COMMENT ON` strings stripped — a source-pin test must never
 * match its own explanation. This header quotes `DEFAULT 0`, PGRST203 and both
 * rejected alternatives at length and would satisfy most assertions below on
 * prose alone. The same trap cost this unit a red probe gate: pg_proc.prosrc
 * contains comments too.
 */
const sql = MIGRATION.replace(/^\s*--.*$/gm, "")
  .replace(/--.*$/gm, "")
  .replace(/COMMENT ON[\s\S]*?';/g, "");

describe("the default is gone, which is the whole fix", () => {
  it("recreates the 3-arg overload with no DEFAULT on _txn_amount", () => {
    expect(sql).toMatch(
      /CREATE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text, _txn_amount numeric\)/,
    );
    expect(sql).not.toMatch(/_txn_amount numeric DEFAULT/);
  });

  it("drops first, because CREATE OR REPLACE cannot remove a default", () => {
    // Measured on a throwaway function rather than read in a manual:
    // 42P13 cannot remove parameter defaults from existing function.
    expect(sql).toMatch(
      /DROP FUNCTION public\.process_referral_reward\(uuid, text, numeric\);/,
    );
  });

  it("does not touch the 2-arg overload at all", () => {
    // It is the admin override and applies none of the enabled/minimum/
    // manual-approval/cap checks. Merging the two would silently change what
    // an approval means.
    expect(sql).not.toMatch(
      /(DROP|CREATE)[^;]*process_referral_reward\(uuid, text\)[^,]/,
    );
    expect(sql).not.toMatch(
      /CREATE (OR REPLACE )?FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text\)/,
    );
  });

  it("is one transaction, so a dropped-but-not-recreated function cannot exist", () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/COMMIT;\s*$/);
  });
});

describe("the DROP does not silently reopen F-66", () => {
  it("declares the ACL in full rather than inheriting the recreate's", () => {
    // A recreate takes Supabase's ALTER DEFAULT PRIVILEGES grants: PUBLIC,
    // anon, authenticated, service_role, with no line in any file saying so.
    // That mechanism is what put F-105a and F-105d there in the first place.
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_referral_reward\(uuid, text, numeric\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.process_referral_reward\(uuid, text, numeric\)\s*\n\s*TO authenticated, service_role;/,
    );
  });

  it("names PUBLIC first and explicitly — F-62/F-98", () => {
    expect(sql).toMatch(/FROM PUBLIC, anon/);
  });

  it("keeps authenticated, because the member call site is live", () => {
    expect(sql).toMatch(/TO authenticated, service_role;/);
  });
});

describe("the recreate carries the same body, not a new one", () => {
  it("still contains F-105d's self-or-admin guard", () => {
    // A DROP+CREATE can silently ship a different body. This file changes one
    // thing; if the guard vanished it would reopen F-105d while claiming to
    // fix an overload-resolution bug.
    expect(sql).toMatch(/_caller := \(select auth\.uid\(\)\);/);
    expect(sql).toMatch(/_referred_user_id IS DISTINCT FROM _caller/);
    expect(sql).toMatch(/public\.has_role\(_caller, 'admin'::app_role\)/);
  });

  it("still refuses a NULL caller", () => {
    expect(sql).toMatch(/IF _caller IS NULL THEN/);
  });

  it("is still SECURITY DEFINER with a pinned search_path", () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("still applies the member-path business rules", () => {
    // The 3-arg overload is the one with the checks. Losing them here would
    // turn the member path into the admin override.
    expect(sql).toMatch(/IF NOT _enabled THEN RETURN; END IF;/);
    expect(sql).toMatch(/IF _manual_approval THEN RETURN; END IF;/);
    expect(sql).toMatch(/IF _month_count >= _monthly_cap THEN/);
  });
});

describe("the rollback restores the default and nothing else", () => {
  it("puts DEFAULT 0 back", () => {
    expect(ROLLBACK).toMatch(/_txn_amount numeric DEFAULT 0/);
  });

  it("carries the guard too, so rolling back does not reopen F-105d", () => {
    expect(ROLLBACK).toMatch(/_referred_user_id IS DISTINCT FROM _caller/);
  });

  it("declares the ACL in full, because it also drops and recreates", () => {
    expect(ROLLBACK).toMatch(/FROM PUBLIC, anon, authenticated, service_role;/);
    expect(ROLLBACK).toMatch(/TO authenticated, service_role;/);
  });
});

describe("the call-site shapes this fix was measured against", () => {
  it("AdminReferrals still sends exactly TWO keys", () => {
    // This is the shape that received PGRST203. If it ever grows a third key
    // it becomes the member path — with the manual-approval early return —
    // and the Approve button silently stops approving.
    const admin = stripComments(read("src/components/admin/AdminReferrals.tsx"));
    const call = admin.match(/process_referral_reward[\s\S]{0,200}?\}\)/)?.[0] ?? "";
    expect(call).toMatch(/_referred_user_id:/);
    expect(call).toMatch(/_activity_type:/);
    expect(call).not.toMatch(/_txn_amount/);
  });

  it("CompetitionSubmit still sends exactly THREE keys", () => {
    // With the DEFAULT gone, a two-key call from here would no longer resolve
    // to this overload at all.
    const submit = stripComments(read("src/pages/CompetitionSubmit.tsx"));
    const call = submit.match(/process_referral_reward[\s\S]{0,200}?\}\)/)?.[0] ?? "";
    expect(call).toMatch(/_referred_user_id:/);
    expect(call).toMatch(/_activity_type:/);
    expect(call).toMatch(/_txn_amount:/);
  });

  it("enroll_in_course passes all three arguments positionally", () => {
    // The database caller. It passes three, so removing the default cannot
    // affect it — and it swallows exceptions with EXCEPTION WHEN OTHERS THEN
    // NULL, so if it could, it would fail silently.
    const bootstrap = read(
      "supabase/migrations/20260911101721_new_project_full_schema_bootstrap.sql",
    );
    expect(bootstrap).toMatch(
      /PERFORM process_referral_reward\(_user_id, 'course purchase', _course\.price\);/,
    );
  });
});
