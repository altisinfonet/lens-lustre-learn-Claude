/**
 * F-105d + F-105e ON PRODUCTION — ONE TRANSACTION, AND A BODY THAT IS NOT
 * STAGING'S.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT 0023 CLOSES
 *
 * F-105d — both overloads of `process_referral_reward` are SECURITY DEFINER,
 * take `_referred_user_id` from the caller, never compare it to `auth.uid()`,
 * and call `wallet_transaction()`. Any signed-in member could credit any
 * account by naming it.
 *
 * F-105e — `_txn_amount numeric DEFAULT 0` makes the three-argument function an
 * equally good candidate for a two-argument call, so PostgREST answers the
 * admin Approve button (`AdminReferrals.tsx`, two keys) with
 * `HTTP 300 PGRST203` and approves nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONE FILE, NOT TWO
 *
 * `apply-migration.yml` runs one file per dispatch, each waits on its own
 * production approval, and psql runs WITHOUT `--single-transaction`. 0020's
 * header makes this argument for the birthday pair; here it is sharper, because
 * F-105e needs a DROP (a default cannot be removed by CREATE OR REPLACE) and a
 * DROP re-lands the Supabase default grants (F-66). Ported separately, the
 * F-105e half would republish a VOLATILE `wallet_transaction()` caller to
 * **anon** and leave it that way until a human approved the next dispatch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THING THAT NEARLY WENT WRONG, PINNED HERE SO IT CANNOT COME BACK
 *
 * Production has DRIFTED from staging. Main's definitions have no `FOR UPDATE`
 * on the pending-referral SELECT (staging: BUG-049) and no self-referral guard
 * (staging: BUG-047). Lifting staging's finished bodies into a production
 * migration would have smuggled two behaviour fixes into production inside a
 * security migration.
 *
 * So 0023 ports the FIX, not the body: the guard block sliced from staging's
 * 0019, grafted onto main's own bodies. The tests below pin both halves of
 * that — the guard is present, AND main's body characteristics are preserved
 * exactly as main has them, undrifted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE TESTS ARE NOT
 *
 * Source pins. Nothing here touches a database, and **no part of F-105d or
 * F-105e has been measured on production** — this lane has no production
 * access. The behaviour was measured on staging (see
 * `docs/evidence/d1/F-105e/OVERLOAD-RESOLUTION-HTTP.md`), and 0023 carries a
 * precondition gate plus `PROBE_f105de_…` so that its first production run is
 * also its first production measurement, safely. These tests cannot and do not
 * stand in for that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const MIGRATION = read(
  "supabase/migrations/20260910_0023_f105de_referral_reward_production_close.sql",
);
const ROLLBACK = read(
  "supabase/rollback/20260910_0023_f105de_referral_reward_production_close_ROLLBACK.sql",
);
const PROBE = read(
  "supabase/migrations/PROBE_f105de_referral_reward_production_closed.sql",
);

/** Main's own definitions — the production-lane source 0023 was built from. */
const MAIN_2ARG = read(
  "supabase/migrations/20260228101821_8df7579c-4b66-4ddd-a5a2-6bc4eab484f3.sql",
);
const MAIN_3ARG = read(
  "supabase/migrations/20260228102118_91c16770-67a4-4980-ba3e-1cceb75a7f8f.sql",
);

/**
 * Comments and `COMMENT ON` strings stripped — a source-pin test must never
 * match its own explanation. This header quotes PGRST203, `DEFAULT 0`, the
 * guard and the drift at length. The same trap already cost this family a red
 * probe gate via `pg_proc.prosrc`, which also contains comments.
 */
const sql = MIGRATION.replace(/^\s*--.*$/gm, "")
  .replace(/--.*$/gm, "")
  .replace(/COMMENT ON[\s\S]*?';/g, "");

describe("one transaction, no window between the two fixes", () => {
  it("is a single explicit BEGIN/COMMIT", () => {
    // psql runs without --single-transaction, so without these each statement
    // would commit on its own and the window would reappear inside one dispatch.
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("COMMIT;"));
  });

  it("does both fixes inside it — guard on both overloads, and the DROP", () => {
    // Counted on the two-line form that only appears in a function body. A bare
    // `IS DISTINCT FROM _caller` also appears once in the end-state gate's LIKE
    // pattern, and counting that would make this assertion pass for the wrong
    // reason.
    expect(
      sql.match(/IS DISTINCT FROM _caller\s*\n\s*AND NOT public\.has_role\(_caller, 'admin'::app_role\)/g),
    ).toHaveLength(2);
    expect(sql).toMatch(
      /DROP FUNCTION public\.process_referral_reward\(uuid, text, numeric\);/,
    );
  });

  it("the guard grafted into each body is COMPLETE, not truncated", () => {
    // ⚠ THIS TEST EXISTS BECAUSE THE GENERATOR GOT IT WRONG ONCE. The guard is
    // sliced out of staging's 0019 rather than retyped, and the first slice
    // regex was non-greedy: it stopped at the FIRST `USING ERRCODE = '42501'`,
    // which is the NULL-caller check, and dropped the self-or-admin check
    // entirely. The bodies still compiled, still round-tripped back to main's
    // source when the slice was removed, and still contained something that
    // looked like a guard — while authorising nothing.
    //
    // Reversibility is not sufficiency. Each body must carry BOTH raises and
    // the admin branch, or F-105d is open on that overload.
    for (const body of [
      sql.match(/CREATE OR REPLACE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text\)[\s\S]*?\$\$([\s\S]*?)\$\$;/)?.[1] ?? "",
      sql.match(/CREATE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text, _txn_amount numeric\)[\s\S]*?\$\$([\s\S]*?)\$\$;/)?.[1] ?? "",
    ]) {
      expect(body).not.toBe("");
      expect(body.match(/USING ERRCODE = '42501'/g)).toHaveLength(2);
      expect(body).toMatch(/IF _caller IS NULL THEN/);
      expect(body).toMatch(/_referred_user_id IS DISTINCT FROM _caller/);
      expect(body).toMatch(/AND NOT public\.has_role\(_caller, 'admin'::app_role\) THEN/);
    }
  });

  it("the DROP is inside the transaction, never after COMMIT", () => {
    const drop = sql.indexOf("DROP FUNCTION");
    expect(drop).toBeGreaterThan(sql.indexOf("BEGIN;"));
    expect(drop).toBeLessThan(sql.indexOf("COMMIT;"));
  });
});

describe("the F-105e half", () => {
  it("recreates the 3-arg overload with no DEFAULT", () => {
    expect(sql).toMatch(
      /CREATE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text, _txn_amount numeric\)/,
    );
    expect(sql).not.toMatch(/_txn_amount numeric DEFAULT/);
  });

  it("leaves the 2-arg overload's signature alone", () => {
    // It is the admin override and applies none of the enabled/minimum/
    // manual-approval/cap checks. Merging the two changes what approval means.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text\)/,
    );
    expect(sql).not.toMatch(
      /DROP FUNCTION public\.process_referral_reward\(uuid, text\);/,
    );
  });
});

describe("the F-105d half is NULL-safe on both overloads", () => {
  it("resolves the caller from auth.uid() once per overload", () => {
    expect(sql.match(/_caller := \(select auth\.uid\(\)\);/g)).toHaveLength(2);
  });

  it("uses IS DISTINCT FROM, never a bare <>", () => {
    // `_referred_user_id <> NULL` is NULL, not TRUE: written with <>, the IF is
    // never taken and the guard admits exactly the caller it refuses.
    expect(sql).not.toMatch(/_referred_user_id\s*<>\s*_caller/);
  });

  it("refuses a NULL caller explicitly, on both", () => {
    expect(sql.match(/IF _caller IS NULL THEN/g)).toHaveLength(2);
  });

  it("raises 42501 rather than returning quietly", () => {
    // enroll_in_course() swallows exceptions with EXCEPTION WHEN OTHERS THEN
    // NULL, so a silent RETURN would be indistinguishable from success.
    expect(sql.match(/USING ERRCODE = '42501'/g)).toHaveLength(4);
  });

  it("admits admins, reusing the has_role pattern", () => {
    expect(sql.match(/public\.has_role\(_caller, 'admin'::app_role\)/g)).toHaveLength(2);
  });
});

describe("the DROP does not silently reopen F-66", () => {
  it("declares the ACL in full for both overloads", () => {
    // A CREATE re-lands what a REVOKE took away: production's measured default
    // for a new function in public is {anon,authenticated,service_role} plus
    // the PUBLIC '=X/' entry.
    expect(sql.match(/FROM PUBLIC, anon, authenticated, service_role;/g)).toHaveLength(2);
    expect(sql.match(/TO authenticated, service_role;/g)).toHaveLength(2);
  });

  it("puts every grant statement AFTER every CREATE", () => {
    const lastCreate = sql.lastIndexOf("CREATE FUNCTION");
    const firstRevoke = sql.indexOf("REVOKE ALL");
    expect(firstRevoke).toBeGreaterThan(lastCreate);
  });
});

describe("it refuses to run against a database it does not recognise", () => {
  it("asserts the live bodies before changing anything", () => {
    // Written without production access: main's source records what was
    // dispatched, not what is running. Without this, CREATE OR REPLACE would
    // silently revert any drift.
    expect(sql).toMatch(/DO \$pre\$/);
    expect(sql).toMatch(/SELECT md5\(prosrc\) INTO _md2/);
    expect(sql).toMatch(/SELECT md5\(prosrc\) INTO _md3/);
    expect(sql.indexOf("DO $pre$")).toBeLessThan(sql.indexOf("CREATE OR REPLACE FUNCTION"));
  });

  it("pins the md5s of main's own definitions, not staging's", () => {
    expect(sql).toMatch(/a82168c949cbc3eef0dad32e17961730/); // main 2-arg body
    expect(sql).toMatch(/12b13af9a3bfce42f6294d12d3e7d9cf/); // main 3-arg body
  });

  it("expects the UNFIXED state, so a second run refuses", () => {
    expect(sql).toMatch(/P3 FAILED/);
    expect(sql).toMatch(/pronargdefaults INTO _n/);
  });

  it("asserts the end state before COMMIT", () => {
    expect(sql).toMatch(/DO \$gate\$/);
    expect(sql.indexOf("DO $gate$")).toBeLessThan(sql.indexOf("COMMIT;"));
    for (const g of ["G1 FAILED", "G2 FAILED", "G3 FAILED", "G4 FAILED", "G5 FAILED", "G6 FAILED", "G7 FAILED", "G8 FAILED"]) {
      expect(sql).toContain(g);
    }
  });
});

describe("production's body is preserved — this is a security fix, not a port of staging", () => {
  it("keeps main's SELECT without FOR UPDATE (BUG-049 NOT smuggled in)", () => {
    // Staging has `FOR UPDATE`; main does not. Adding it here would be a
    // behaviour change riding inside a security migration.
    expect(MAIN_2ARG).not.toMatch(/FOR UPDATE/);
    expect(MAIN_3ARG).not.toMatch(/FOR UPDATE/);
    expect(sql).not.toMatch(/FOR UPDATE/);
  });

  it("keeps main's absence of the self-referral guard (BUG-047 NOT smuggled in)", () => {
    expect(MAIN_2ARG).not.toMatch(/referrer_id = _referred_user_id/);
    expect(sql).not.toMatch(/IF _referral\.referrer_id = _referred_user_id THEN RETURN; END IF;/);
  });

  it("carries main's own comments, which is what proves the body is main's", () => {
    // These strings are in main's definitions and NOT in staging's rewritten
    // ones. If they vanish, someone has swapped in the staging body.
    expect(MIGRATION).toMatch(/-- Find pending referral for this user/);
    expect(MIGRATION).toMatch(/-- Credit referee welcome bonus/);
    expect(MIGRATION).toMatch(/-- If manual approval required, leave as pending/);
  });

  it("keeps the member-path business rules the 3-arg overload owns", () => {
    expect(sql).toMatch(/IF NOT _enabled THEN RETURN; END IF;/);
    expect(sql).toMatch(/IF _manual_approval THEN RETURN; END IF;/);
    expect(sql).toMatch(/IF _month_count >= _monthly_cap THEN/);
  });

  it("keeps both overloads SECURITY DEFINER with a pinned search_path", () => {
    // Asserted on each CREATE's own preamble, not by counting occurrences in
    // the file: the end-state gate's G8 message names SECURITY DEFINER too, and
    // a global count would be measuring the error text as much as the DDL.
    const preambles = [
      ...sql.matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION public\.process_referral_reward\([^)]*\)\n([\s\S]*?)AS \$\$/g,
      ),
    ].map((m) => m[1]);
    expect(preambles).toHaveLength(2);
    for (const p of preambles) {
      expect(p).toMatch(/SECURITY DEFINER/);
      expect(p).toMatch(/SET search_path TO 'public'/);
      expect(p).toMatch(/LANGUAGE plpgsql/);
    }
  });
});

describe("the rollback restores main's pre-0023 state, defects included", () => {
  it("puts DEFAULT 0 back", () => {
    expect(ROLLBACK).toMatch(/_txn_amount numeric DEFAULT 0/);
  });

  it("removes the guard, because that is what rolling back means", () => {
    expect(ROLLBACK).not.toMatch(/IS DISTINCT FROM _caller/);
  });

  it("restores the Supabase default ACL rather than quietly keeping the revokes", () => {
    // A rollback that kept them would land in a state that is neither the
    // before nor the after, and nothing would say so.
    expect(ROLLBACK).toMatch(/TO PUBLIC, anon, authenticated, service_role;/);
  });

  it("is itself one transaction", () => {
    expect(ROLLBACK.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(ROLLBACK.match(/^COMMIT;/gm)).toHaveLength(1);
  });
});

describe("the probe is honest about what it can see", () => {
  it("writes nothing — BEGIN … ROLLBACK", () => {
    expect(PROBE).toMatch(/^BEGIN;/m);
    expect(PROBE).toMatch(/^ROLLBACK;/m);
    expect(PROBE).not.toMatch(/^COMMIT;/m);
  });

  it("says the SQL gate is a proxy for the HTTP defect, not a substitute", () => {
    expect(PROBE).toMatch(/42725/);
    expect(PROBE).toMatch(/PGRST203/);
    expect(PROBE).toMatch(/proxy/i);
  });

  it("states that production has never been measured", () => {
    expect(PROBE).toMatch(/FIRST TIME ANY OF THIS IS MEASURED ON PRODUCTION/);
  });
});

describe("the call-site shapes 0023 was built against", () => {
  it("AdminReferrals sends exactly TWO keys — the shape that gets PGRST203", () => {
    const admin = stripComments(read("src/components/admin/AdminReferrals.tsx"));
    const call = admin.match(/process_referral_reward[\s\S]{0,200}?\}\)/)?.[0] ?? "";
    expect(call).toMatch(/_referred_user_id:/);
    expect(call).toMatch(/_activity_type:/);
    expect(call).not.toMatch(/_txn_amount/);
  });

  it("CompetitionSubmit sends exactly THREE keys", () => {
    const submit = stripComments(read("src/pages/CompetitionSubmit.tsx"));
    const call = submit.match(/process_referral_reward[\s\S]{0,200}?\}\)/)?.[0] ?? "";
    expect(call).toMatch(/_txn_amount:/);
  });

  it("neither call site is changed by this unit", () => {
    // The whole point of removing the DEFAULT rather than renaming: no client
    // change, so no window in which the button silently no-ops.
    const hits = (s: string) => (s.match(/process_referral_reward/g) ?? []).length;
    expect(hits(read("src/components/admin/AdminReferrals.tsx"))).toBe(1);
    expect(hits(read("src/pages/CompetitionSubmit.tsx"))).toBe(1);
  });
});
