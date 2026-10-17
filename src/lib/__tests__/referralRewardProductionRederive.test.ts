/**
 * F-105d + F-105e ON PRODUCTION, RE-DERIVED — AND THE ASSUMPTION THAT WAS WRONG.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT RUN #69 PROVED
 *
 * 0023 was dispatched against production and refused itself at its own P2
 * precondition gate:
 *
 *   live 2-arg body md5 7999749b88688973dc95680d68ae5e86 (1416 bytes),
 *   expected a82168c949cbc3eef0dad32e17961730 (1371 bytes) per main's
 *   20260228101821.
 *
 * Nothing was applied; the transaction rolled back. The gate worked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CORRECTION, WHICH INVERTS WHAT 0023 BELIEVED
 *
 * That md5 is not an unknown value: it is byte-for-byte the 2-arg body in
 * staging's `20260911101721` bootstrap snapshot. So production runs the same
 * body staging inherited — meaning **production already has BUG-049 (the
 * `FOR UPDATE` lock) and BUG-047 (the self-referral guard)**.
 *
 * 0023's header asserted the opposite: that production lacked both, and that
 * porting staging's bodies would smuggle two behaviour fixes into production.
 * The reasoning was sound; the premise was wrong. Main's `20260228101821` and
 * `20260228102118` do not describe production — they are **stale**. The drift
 * is in the repository, not the database.
 *
 * That the stale source was the only production-lane record available is
 * exactly why 0023 carried a precondition gate, and why it was not optional.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE TESTS PIN
 *
 * Two things, and the second is the one that matters:
 *
 *   1. that 0024 installs staging's finished bodies — because production's
 *      pre-state IS staging's pre-state, so the finished state is the same;
 *   2. that 0024 does NOT strip BUG-047/BUG-049. Production has them. A file
 *      built from main's stale source would remove them silently, and that is
 *      now the live hazard rather than the one 0023 guarded against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE TESTS ARE NOT
 *
 * Source pins. Nothing here touches a database. Of production, exactly two
 * facts are measured — two overloads exist, and the 2-arg body's digest — both
 * from run #69's refusal. The 3-arg body, the DEFAULT, the ACL and the PGRST203
 * behaviour remain **inferred**, which is why 0024 keeps a precondition gate and
 * why `PROBE_process_referral_reward_source_dump_readonly.sql` exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const MIGRATION = read(
  "supabase/migrations/20260910_0024_f105de_referral_reward_production_close.sql",
);
const ROLLBACK = read(
  "supabase/rollback/20260910_0024_f105de_referral_reward_production_close_ROLLBACK.sql",
);
const DUMP = read(
  "supabase/migrations/PROBE_process_referral_reward_source_dump_readonly.sql",
);
const GATE = read(
  "supabase/migrations/PROBE_f105de_referral_reward_production_closed.sql",
);

/**
 * Comment-stripped probe text. The safety assertions below MUST run against
 * this, not the raw file: the dump probe's header explains at length that it
 * issues no GRANT and never reads $DB_URL, and matching those words in the
 * explanation would fail the file for describing its own safety.
 */
const dumpCode = DUMP.replace(/^\s*--.*$/gm, "").replace(/--.*$/gm, "");

/** Comments and COMMENT ON strings stripped — a source pin must never match its own explanation. */
const sql = MIGRATION.replace(/^\s*--.*$/gm, "")
  .replace(/--.*$/gm, "")
  .replace(/COMMENT ON[\s\S]*?';/g, "");

/**
 * The two function bodies, pulled back out of the RAW file.
 *
 * ⚠ NOT out of `sql`. The guard carries its own `--` comments, and pg_proc
 * stores them: the body that reaches the database is the commented one. Pulling
 * these from the comment-stripped text would hash a string that never exists
 * anywhere, and the digest comparison below would be theatre.
 */
const body2 =
  MIGRATION.match(
    /CREATE OR REPLACE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  )?.[1] ?? "";
const body3 =
  MIGRATION.match(
    /CREATE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text, _txn_amount numeric\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  )?.[1] ?? "";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

describe("the bodies are staging's, byte-for-byte", () => {
  it("extracted both bodies from the migration", () => {
    expect(body2).not.toBe("");
    expect(body3).not.toBe("");
  });

  it("2-arg body is staging's live definition", () => {
    // Verified against staging's live pg_proc before this file was written.
    expect(md5(body2)).toBe("f7242f2cc0989c74ff3731abfc2500ba");
    expect(body2.length).toBe(2483);
  });

  it("3-arg body is staging's live definition", () => {
    expect(md5(body3)).toBe("df71a90afca03692c1873846c72771cc");
    expect(body3.length).toBe(3291);
  });
});

describe("BUG-047 and BUG-049 are NOT stripped — production has them", () => {
  it("keeps the FOR UPDATE lock on both overloads (BUG-049)", () => {
    // The live hazard is now the opposite of the one 0023 guarded against:
    // building from main's stale source would REMOVE these.
    expect(body2).toMatch(/FOR UPDATE/);
    expect(body3).toMatch(/FOR UPDATE/);
  });

  it("keeps the self-referral guard on both overloads (BUG-047)", () => {
    expect(body2).toMatch(/IF _referral\.referrer_id = _referred_user_id THEN RETURN; END IF;/);
    expect(body3).toMatch(/IF _referral\.referrer_id = _referred_user_id THEN RETURN; END IF;/);
  });

  it("does not install main's stale bodies", () => {
    // main 20260228101821 / 20260228102118, the ones run #69 disproved.
    expect(md5(body2)).not.toBe("a82168c949cbc3eef0dad32e17961730");
    expect(md5(body3)).not.toBe("12b13af9a3bfce42f6294d12d3e7d9cf");
  });
});

describe("the F-105d guard is complete on both overloads", () => {
  it("carries both raises and the admin branch, per overload", () => {
    // 0023's first generated version truncated this guard and still compiled,
    // still round-tripped, and authorised nothing. Reversibility is not
    // sufficiency.
    for (const body of [body2, body3]) {
      expect(body.match(/USING ERRCODE = '42501'/g)).toHaveLength(2);
      expect(body).toMatch(/_caller := \(select auth\.uid\(\)\);/);
      expect(body).toMatch(/IF _caller IS NULL THEN/);
      expect(body).toMatch(/_referred_user_id IS DISTINCT FROM _caller/);
      expect(body).toMatch(/AND NOT public\.has_role\(_caller, 'admin'::app_role\) THEN/);
    }
  });

  it("is NULL-safe — never a bare <> against auth.uid()", () => {
    for (const body of [body2, body3]) {
      expect(body).not.toMatch(/_referred_user_id\s*<>\s*_caller/);
    }
  });
});

describe("the F-105e half", () => {
  it("recreates the 3-arg with no DEFAULT", () => {
    expect(sql).toMatch(
      /CREATE FUNCTION public\.process_referral_reward\(_referred_user_id uuid, _activity_type text, _txn_amount numeric\)/,
    );
    expect(sql).not.toMatch(/_txn_amount numeric DEFAULT/);
  });

  it("drops the 3-arg inside the transaction, and never the 2-arg", () => {
    const drop = sql.indexOf("DROP FUNCTION");
    expect(drop).toBeGreaterThan(sql.indexOf("BEGIN;"));
    expect(drop).toBeLessThan(sql.indexOf("COMMIT;"));
    expect(sql).not.toMatch(/DROP FUNCTION public\.process_referral_reward\(uuid, text\);/);
  });

  it("is one transaction", () => {
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
  });
});

describe("the precondition gate pins the MEASURED state, not main's", () => {
  it("expects the bootstrap-snapshot bodies", () => {
    expect(sql).toMatch(/7999749b88688973dc95680d68ae5e86/); // 2-arg, MEASURED run #69
    expect(sql).toMatch(/5a69d3fa10a09745b9bfd1a5a7d48690/); // 3-arg, INFERRED
  });

  it("no longer pins main's disproved digests", () => {
    expect(sql).not.toMatch(/a82168c949cbc3eef0dad32e17961730/);
    expect(sql).not.toMatch(/12b13af9a3bfce42f6294d12d3e7d9cf/);
  });

  it("keeps the two body checks separate, and both are now measured", () => {
    // P2a was measured by run #69's refusal, P2b by run #70's source dump.
    // When P2b was still an inference the file said so; now that it is a
    // reading, the file must not still claim it is unmeasured.
    expect(sql).toMatch(/P2a FAILED/);
    expect(sql).toMatch(/P2b FAILED/);
    expect(MIGRATION).toMatch(/MEASURED on production by run #70/);
    expect(MIGRATION).not.toMatch(/THIS EXPECTATION WAS INFERRED, NOT MEASURED/);
  });

  it("records the pre-ACL as a NOTICE, never as a refusal", () => {
    // Correcting the ACL is part of this file's job, so refusing because the
    // ACL is wrong would refuse exactly the case it exists to fix. Recording it
    // puts the before-state in the same log as the after-state — which is what
    // a rollback author needs, and what this unit got wrong once already.
    expect(sql).toMatch(/RAISE NOTICE 'P4 · pre-ACL 2-arg = %'/);
    expect(sql).toMatch(/RAISE NOTICE 'P4 · pre-ACL 3-arg = %'/);
    expect(sql).not.toMatch(/P4 FAILED/);
  });

  it("still flags the one thing production has NOT told us", () => {
    // The PGRST203 behaviour. Better supported now that both overloads and the
    // DEFAULT are confirmed, but no production HTTP request has been issued.
    expect(MIGRATION).toMatch(/STILL NOT MEASURED/);
    expect(MIGRATION).toMatch(/no production HTTP request has ever been issued/);
  });

  it("runs before any DDL, and asserts the end state before COMMIT", () => {
    expect(sql.indexOf("DO $pre$")).toBeLessThan(sql.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(sql.indexOf("DO $gate$")).toBeLessThan(sql.indexOf("COMMIT;"));
  });

  it("points a failed gate at the source-dump probe rather than at forcing it", () => {
    expect(MIGRATION).toMatch(/PROBE_process_referral_reward_source_dump_readonly\.sql/);
    expect(MIGRATION).toMatch(/DO NOT weaken this check/);
  });
});

describe("the ACL is declared in full, because the DROP resets it", () => {
  it("revokes from every role then grants the two that need it", () => {
    expect(sql.match(/FROM PUBLIC, anon, authenticated, service_role;/g)).toHaveLength(2);
    expect(sql.match(/TO authenticated, service_role;/g)).toHaveLength(2);
  });

  it("puts every grant after every CREATE (F-66)", () => {
    expect(sql.indexOf("REVOKE ALL")).toBeGreaterThan(sql.lastIndexOf("CREATE FUNCTION"));
  });
});

describe("the source-dump probe is safe to run against production", () => {
  it("writes nothing — no DDL, no DML, no grants", () => {
    expect(dumpCode).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  });

  it("reads the catalogue only — no member data table anywhere", () => {
    for (const t of ["referrals", "wallet_transactions", "profiles", "site_settings", "auth.users"]) {
      expect(dumpCode).not.toMatch(new RegExp(`FROM\\s+(public\\.)?${t}\\b`, "i"));
    }
    expect(dumpCode).toMatch(/FROM pg_proc p/);
  });

  it("never touches the credential", () => {
    expect(dumpCode).not.toMatch(/DB_URL|password|pgpass|connection string/i);
  });

  it("prints what a re-derivation needs", () => {
    expect(dumpCode).toMatch(/md5\(p\.prosrc\)/);
    expect(dumpCode).toMatch(/length\(p\.prosrc\)/);
    expect(dumpCode).toMatch(/pronargdefaults/);
    expect(dumpCode).toMatch(/proacl/);
    expect(dumpCode).toMatch(/pg_get_functiondef/);
  });

  it("says plainly that a green run proves nothing about any migration", () => {
    expect(DUMP).toMatch(/GREEN RUN OF THIS FILE PROVES NOTHING ABOUT ANY MIGRATION/);
  });
});

describe("the rollback restores the state production actually has", () => {
  it("restores the bootstrap bodies, not main's stale ones", () => {
    expect(ROLLBACK).toMatch(/7999749b88688973dc95680d68ae5e86/);
    expect(ROLLBACK).not.toMatch(/a82168c949cbc3eef0dad32e17961730/);
  });

  it("keeps BUG-047/049 in the restored bodies", () => {
    expect(ROLLBACK).toMatch(/FOR UPDATE/);
    expect(ROLLBACK).toMatch(/IF _referral\.referrer_id = _referred_user_id THEN RETURN; END IF;/);
  });

  it("puts DEFAULT 0 back and drops the guard", () => {
    expect(ROLLBACK).toMatch(/_txn_amount numeric DEFAULT 0/);
    expect(ROLLBACK).not.toMatch(/IS DISTINCT FROM _caller/);
  });

  it("restores the ACL run #70 MEASURED — never grants PUBLIC or anon", () => {
    // ⚠ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT. The first
    // version of this rollback granted `TO PUBLIC, anon, authenticated,
    // service_role`, on the assumption that production sat on Supabase's
    // default ACL for a function in schema public. Run #70 measured it and it
    // does not:
    //
    //     postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres
    //
    // No PUBLIC, no anon. So that grant would not have restored the pre-state —
    // it would have ADDED anon EXECUTE to a VOLATILE SECURITY DEFINER function
    // that calls wallet_transaction(), on a database that had already closed
    // it. A rollback that leaves the system more open than it found it is an
    // incident with a reassuring filename.
    expect(ROLLBACK).not.toMatch(/GRANT EXECUTE[^;]*TO PUBLIC/);
    expect(ROLLBACK).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/);
    expect(ROLLBACK.match(/GRANT EXECUTE ON FUNCTION[^;]*TO authenticated, service_role;/g)).toHaveLength(2);
    // and it declares the whole ACL rather than inheriting what the recreate landed
    expect(ROLLBACK.match(/REVOKE ALL[^;]*FROM PUBLIC, anon, authenticated, service_role;/g)).toHaveLength(2);
  });

  it("warns that 0023's rollback would strip BUG-047/049", () => {
    expect(ROLLBACK).toMatch(/0023 and its rollback are superseded/);
  });

  it("records that the ACL was corrected after measurement, not quietly changed", () => {
    expect(ROLLBACK).toMatch(/CORRECTED 2026-09-12 AFTER RUN #70 MEASURED IT/);
  });
});

describe("the gate probe is coherent with this unit", () => {
  it("its operational references name 0024, not the superseded 0023", () => {
    // The one surviving mention of 0023 is history — "run #69 refused 0023" —
    // and must stay. What must have moved on is every instruction: which file
    // to run this before, and which file a red gate means has not been applied.
    expect(GATE).toMatch(/RUN THIS BEFORE 0024 AS WELL AS AFTER/);
    expect(GATE).toMatch(/After 0024 every assertion must pass/);
    expect(GATE).toMatch(/0024 has not been applied/);
    expect(GATE).not.toMatch(/BEFORE 0023|After 0023 every|0023 has not been applied/);
  });

  it("tells the operator to run the source dump first", () => {
    expect(GATE).toMatch(/PROBE_process_referral_reward_source_dump_readonly\.sql FIRST/);
  });

  it("writes nothing", () => {
    expect(GATE).toMatch(/^ROLLBACK;/m);
    expect(GATE).not.toMatch(/^COMMIT;/m);
  });
});
