/**
 * 0023 IS WITHDRAWN, AND THIS FILE IS THE THING THAT KEEPS IT WITHDRAWN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * This file used to be `referralRewardProductionClose.test.ts`, 32 assertions
 * pinning the internals of `20260910_0023_f105de_…`. That unit is superseded by
 * 0024, and the test had gone red on main for an unrelated reason: 0024
 * replaced the gate probe both units read under the same filename, and the old
 * test asserted wording the new probe does not carry.
 *
 * It was NOT deleted to make the suite green. Deleting a red test to get a
 * clean run is the one move this project forbids outright. It was **repointed**:
 * the unit it described is withdrawn, so the useful thing to assert is no longer
 * "0023 is correct" but "0023 cannot quietly come back".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY 0023 IS WITHDRAWN
 *
 * It was dispatched against production as run #69 and refused itself at its own
 * P2 precondition gate: the live 2-arg body was
 * `7999749b88688973dc95680d68ae5e86` (1416 bytes), not the
 * `a82168c949cbc3eef0dad32e17961730` (1371) that main's `20260228101821`
 * defines. Nothing applied; the transaction rolled back.
 *
 * Run #70's source dump then confirmed why: production runs the
 * bootstrap-snapshot bodies, carrying BUG-049's `FOR UPDATE` lock and BUG-047's
 * self-referral guard. Main's `20260228*` files are stale. 0023 would have
 * stripped both.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ROLLBACK IS THE REAL HAZARD, AND IT IS WHY THIS FILE EXISTS
 *
 * 0023's migration protects itself — its P2 gate refuses. **Its rollback has no
 * gate.** Run by hand against production it would strip BUG-047 and BUG-049
 * *and* grant EXECUTE to PUBLIC and anon on a VOLATILE `SECURITY DEFINER`
 * function that calls `wallet_transaction()` — on a database that run #70
 * measured as holding neither.
 *
 * So the assertions below are about reachability and labelling, not about SQL
 * correctness. Nothing here can stop a determined operator typing the path into
 * a dispatch box. What it can do is make any change that quietly un-withdraws
 * these files — restoring the runnable filename, dropping the banner — fail in
 * CI with the reason attached.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const ROLLBACKS = join(process.cwd(), "supabase/rollback");

const WITHDRAWN_MIGRATION =
  "UNAPPLIED_20260910_0023_f105de_referral_reward_production_close.sql";
const WITHDRAWN_ROLLBACK =
  "UNAPPLIED_20260910_0023_f105de_referral_reward_production_close_ROLLBACK.sql";

const migration = readFileSync(join(MIGRATIONS, WITHDRAWN_MIGRATION), "utf8");
const rollback = readFileSync(join(ROLLBACKS, WITHDRAWN_ROLLBACK), "utf8");

describe("0023 is not in the runnable set", () => {
  it("carries the UNAPPLIED_ prefix, this repository's own marker", () => {
    // Same convention as UNAPPLIED_20260824000000_admin_user_list_pagination.sql
    // and its siblings: kept in the tree, not for dispatch.
    expect(existsSync(join(MIGRATIONS, WITHDRAWN_MIGRATION))).toBe(true);
    expect(existsSync(join(ROLLBACKS, WITHDRAWN_ROLLBACK))).toBe(true);
  });

  it("no runnable 0023 filename exists in either directory", () => {
    // The assertion that catches a revert, a bad merge, or someone "restoring"
    // the file because a link went stale.
    const runnable = (dir: string) =>
      readdirSync(dir).filter(
        (f) => f.includes("0023_f105de") && !f.startsWith("UNAPPLIED_"),
      );
    expect(runnable(MIGRATIONS)).toEqual([]);
    expect(runnable(ROLLBACKS)).toEqual([]);
  });

  it("the superseding unit is present and runnable", () => {
    // Withdrawing 0023 is only safe because 0024 exists. If it ever does not,
    // this is a hole rather than a cleanup.
    expect(
      existsSync(
        join(MIGRATIONS, "20260910_0024_f105de_referral_reward_production_close.sql"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          ROLLBACKS,
          "20260910_0024_f105de_referral_reward_production_close_ROLLBACK.sql",
        ),
      ),
    ).toBe(true);
  });
});

describe("both files say why, at the top, before anything else", () => {
  it("the migration opens with the withdrawal banner", () => {
    expect(migration.slice(0, 400)).toMatch(/⛔ WITHDRAWN 2026-09-12\. DO NOT RUN THIS FILE\./);
    expect(migration).toMatch(/SUPERSEDED BY/);
    expect(migration).toMatch(/20260910_0024_f105de_referral_reward_production_close\.sql/);
  });

  it("the rollback opens with a stronger one, because it has no gate", () => {
    expect(rollback.slice(0, 400)).toMatch(/⛔ WITHDRAWN 2026-09-12\. DO NOT RUN THIS FILE, NOW OR EVER\./);
    expect(rollback).toMatch(/A rollback has NO SUCH GATE|NO SUCH GATE/);
  });

  it("the migration records that its refusal was the gate working", () => {
    expect(migration).toMatch(/run #69/i);
    expect(migration).toMatch(/7999749b88688973dc95680d68ae5e86/);
    expect(migration).toMatch(/The gate worked/i);
  });

  it("the rollback names both faults it would cause", () => {
    expect(rollback).toMatch(/BUG-049/);
    expect(rollback).toMatch(/BUG-047/);
    expect(rollback).toMatch(/GRANT EXECUTE TO PUBLIC AND anon|PUBLIC AND anon/);
    expect(rollback).toMatch(/run #70/i);
  });

  it("says plainly that renaming is not rewriting an applied migration", () => {
    // The distinction that made this cleanup legitimate: staging's already-
    // applied 0019 was deliberately NOT renamed for a cosmetic collision,
    // because renaming an applied file falsifies the run log. 0023 never
    // applied, so nothing in any log becomes untrue.
    expect(migration).toMatch(/this\s*\n?--\s*file NEVER APPLIED|NEVER APPLIED/);
  });
});

describe("the dangerous content is still there to be read, and still dangerous", () => {
  it("the rollback really does carry the PUBLIC/anon grant being warned about", () => {
    // If this ever stops matching, the file was edited rather than withdrawn —
    // and the banner above would be describing a file that no longer exists.
    // Withdrawn means "kept as it was, out of reach", not "quietly fixed".
    expect(rollback).toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO PUBLIC, anon, authenticated, service_role;/);
  });

  it("the rollback really does carry main's stale bodies", () => {
    // No FOR UPDATE and no self-referral guard: the two things it would strip.
    const bodies = rollback.split("BEGIN;")[1] ?? "";
    expect(bodies).not.toMatch(/FOR UPDATE/);
    expect(bodies).not.toMatch(/IF _referral\.referrer_id = _referred_user_id THEN RETURN; END IF;/);
  });
});
