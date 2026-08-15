/**
 * TWO TAPS MUST NOT MAKE TWO POSTS. A TAKEDOWN MUST TAKE THE PHOTO DOWN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * These assertions exist because both properties were MEASURED FALSE on the B4
 * harness (harness/b4/, 2026-08-14) before the fixes:
 *
 *   RACE-1  two sessions submitting the same caption + photos at the same
 *           moment BOTH committed → 2 identical posts. The guard reads
 *           "is there a duplicate?" and the other session's row is not yet
 *           visible to that read. Ordinary member behaviour — a double-tap on
 *           a slow connection — not an attack.
 *
 *   RACE-3  a quarantine landing while a publish was in flight left a LIVE
 *           post referencing quarantined bytes.
 *
 *   R16     the same photo could occupy two positions in one carousel.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS: these are `CREATE OR REPLACE` functions,
 * so a later migration silently wins over an earlier one. A test that greps
 * the whole migration corpus for `pg_advisory_xact_lock` would keep passing
 * after someone replaced the function with the racy body — the string would
 * still be there, in the superseded file. So every assertion below resolves
 * the LAST definition of each function across in-scope migrations and asserts
 * on THAT body only. Ordering (lock before read; detach after state change) is
 * asserted by index comparison, not by presence, because a lock taken after
 * the read protects nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const MANDATE_FROM = "20260813000000";

const inScope = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .sort();

const strip = (f: string) =>
  readFileSync(join(MIGRATIONS, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");

const bodies = inScope.map(strip);
const all = bodies.join("\n");

/**
 * The body of the LAST `CREATE OR REPLACE FUNCTION public.<fn>` across
 * in-scope migrations, in filename (= version) order. Returns "" when no
 * migration defines it — which the vacuity guard turns into a loud failure
 * rather than a silent pass.
 */
function lastDefinitionOf(fn: string): string {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$`,
    "gi",
  );
  let latest = "";
  for (const body of bodies) {
    const hits = [...body.matchAll(re)];
    if (hits.length) latest = hits[hits.length - 1][0];
  }
  return latest;
}

describe("duplicate-post race (RACE-1, measured 2 rows before the fix)", () => {
  const fn = lastDefinitionOf("detect_duplicate_post");

  it("an in-scope migration defines the guard at all (vacuity guard)", () => {
    // Without this, deleting the migration would make every assertion below
    // pass against an empty string.
    expect(
      fn.length > 0,
      "No in-scope migration defines detect_duplicate_post — this file is " +
        "asserting nothing. Either the mandate window moved past it or the " +
        "function was renamed.",
    ).toBe(true);
  });

  it("the newest definition takes an advisory lock BEFORE it reads", () => {
    const lockAt = fn.indexOf("pg_advisory_xact_lock");
    const readAt = fn.indexOf("SELECT EXISTS");
    expect(lockAt, "the duplicate guard no longer locks — two simultaneous submits both commit").toBeGreaterThan(-1);
    expect(readAt, "the duplicate check itself is gone").toBeGreaterThan(-1);
    expect(
      lockAt < readAt,
      "the lock is taken AFTER the duplicate read. A lock that follows the " +
        "read serialises nothing — both sessions still read a snapshot the " +
        "other cannot appear in.",
    ).toBe(true);
  });

  it("the lock key is per member AND per content — not a global posting lock", () => {
    // A single global key would serialise every post on the platform behind
    // one another. Measured: a different member's insert completed at
    // t+1152ms while this key was held until t+3000ms.
    expect(
      /pg_advisory_xact_lock\(\s*hashtextextended\(\s*NEW\.user_id::text \|\| ':' \|\| hash_val\s*,\s*0\s*\)\s*\)/.test(fn),
      "the advisory-lock key changed shape. If it no longer includes BOTH " +
        "the member and the content hash it is either too broad (every post " +
        "on the platform queues) or too narrow (the race reopens).",
    ).toBe(true);
  });
});

describe("takedown consistency (RACE-3 left a live post on quarantined bytes)", () => {
  const gate = lastDefinitionOf("tg_post_media_requires_ready");
  const quar = lastDefinitionOf("media_quarantine");

  it("both functions are defined in scope (vacuity guard)", () => {
    expect(gate.length > 0, "no in-scope migration defines tg_post_media_requires_ready").toBe(true);
    expect(quar.length > 0, "no in-scope migration defines media_quarantine").toBe(true);
  });

  it("the publish gate reads the media row FOR UPDATE, so a takedown cannot interleave", () => {
    expect(
      /SELECT\s+state\s+INTO\s+_state\s+FROM\s+public\.media_objects\s+WHERE\s+id\s*=\s*NEW\.media_id\s+FOR\s+UPDATE/i.test(gate),
      "the publish gate reads the media state without FOR UPDATE — a " +
        "quarantine can commit between the read and the reference insert.",
    ).toBe(true);
  });

  it("quarantine detaches live references, and does so AFTER the state change", () => {
    const stateAt = quar.indexOf("SET state = 'quarantined'");
    const detachAt = quar.indexOf("DELETE FROM public.post_media");
    expect(stateAt, "quarantine no longer sets the state").toBeGreaterThan(-1);
    expect(
      detachAt,
      "quarantine no longer removes the photo from the posts showing it — a " +
        "taken-down image stays on the feed.",
    ).toBeGreaterThan(-1);
    expect(
      detachAt > stateAt,
      "references are detached BEFORE the state change, so a failure between " +
        "the two leaves the media live but stripped from its posts.",
    ).toBe(true);
  });

  it("no duplicate reference: the same photo cannot occupy two carousel slots", () => {
    const created = /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+post_media_post_media_uniq/i.test(all);
    const dropped = /DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+(?:public\.)?post_media_post_media_uniq/i.test(all);
    expect(created, "the no-duplicate-reference index was never created").toBe(true);
    expect(
      dropped,
      "a later in-scope migration DROPS post_media_post_media_uniq — the " +
        "duplicate-reference clause of the B4 gate is open again.",
    ).toBe(false);
  });
});

describe("both fixes ship with the rollback the protocol requires", () => {
  // ⚠ The first version of this test looked for `supabase/migrations/rollback/
  // <name>.rollback.sql` — a location and a spelling I had just invented. It
  // PASSED, because I had put the files there too, and the reconciler (which
  // reads the real directory, `supabase/rollback/<name>_ROLLBACK.sql`) reported
  // the rollbacks MISSING. A test that asserts your own convention rather than
  // the project's is not a check, it is an echo. Resolve the path the way
  // scripts/ai-control.mjs does.
  const ROLLBACKS = join(process.cwd(), "supabase/rollback");

  it("every B4 migration has a matching rollback where the reconciler looks", () => {
    const b4 = inScope.filter((f) => /dup_post_race_fix|media_takedown_consistency/.test(f));
    expect(b4.length, "the B4 migrations are missing from the migrations directory").toBe(2);
    for (const f of b4) {
      const rb = join(ROLLBACKS, f.replace(/\.sql$/, "_ROLLBACK.sql"));
      expect(existsSync(rb), `no rollback at supabase/rollback/ for ${f} — protocol requires one per migration`).toBe(true);
    }
  });

  it("the rollback directory the reconciler reads is the only one that exists", () => {
    // Two rollback directories is the "two catalogs drift" failure with a new
    // face: one of them stops being maintained and nobody notices which.
    expect(
      existsSync(join(MIGRATIONS, "rollback")),
      "supabase/migrations/rollback/ exists again — a second rollback location " +
        "the reconciler does not read. Everything in it is invisible to the gate.",
    ).toBe(false);
  });
});
