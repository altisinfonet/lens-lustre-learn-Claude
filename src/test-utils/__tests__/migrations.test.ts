/**
 * THE GUARD ON THE GUARDS.
 *
 * `../migrations.ts` exists because a file that is in the directory but not in
 * the sequence was silently winning every "latest definition" resolver in the
 * repository. This file pins both halves of that fix:
 *
 *   1. the helper actually excludes what it claims to, measured against the
 *      real `supabase/migrations/` rather than a fixture; and
 *   2. no migration-reading test quietly goes back to `.endsWith(".sql")`.
 *
 * (2) is the half that matters in a year. The original bug was not that anyone
 * wrote a bad filter — it was that fifteen call sites each wrote their own, so
 * there was no single place where "which files are real?" was answered.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  MIGRATIONS_DIR,
  NOT_IN_SEQUENCE_PREFIXES,
  isInSequence,
  migrationsInSequence,
} from "../migrations";

describe("isInSequence", () => {
  it("rejects both out-of-sequence prefixes", () => {
    expect(isInSequence("UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql")).toBe(false);
    expect(isInSequence("PROBE_credential_connectivity_readonly.sql")).toBe(false);
  });

  it("accepts ordinary dated migrations, including both ordinal styles", () => {
    expect(isInSequence("20260814042609_email_queue_authority.sql")).toBe(true);
    expect(isInSequence("20260910_0019_f105d_process_referral_reward_authorize.sql")).toBe(true);
  });

  it("is anchored at the start — a migration may CONTAIN these exact words", () => {
    // `includes` here would drop a real migration whose subject is a probe or
    // an unapplied unit. The prefix is a position, not a keyword.
    //
    // Spelled in the SAME CASE as the prefixes on purpose: a lowercase
    // `..._add_probe_results_...` cannot tell `startsWith` from `includes`,
    // so an earlier draft of this test passed under exactly that mutation.
    expect(isInSequence("20260901120000_PROBE_results_backfill.sql")).toBe(true);
    expect(isInSequence("20260901120000_UNAPPLIED_credit_backfill.sql")).toBe(true);
  });
});

describe("migrationsInSequence, against the real directory", () => {
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const excluded = all.filter((f) => !isInSequence(f));
  const kept = migrationsInSequence();

  it("there ARE out-of-sequence files to exclude, so this is not vacuous", () => {
    // If this ever reads zero the suite below proves nothing, and the helper
    // could be a no-op without anyone noticing.
    expect(excluded.length).toBeGreaterThan(0);
    for (const p of NOT_IN_SEQUENCE_PREFIXES) {
      expect(excluded.some((f) => f.startsWith(p)), `no ${p}* file present`).toBe(true);
    }
  });

  it("excludes exactly those, and keeps everything else", () => {
    expect(kept).toEqual(all.filter(isInSequence).sort());
    expect(kept.filter((f) => !isInSequence(f))).toEqual([]);
    expect(kept.length).toBe(all.length - excluded.length);
  });

  it("returns them sorted, so callers need not re-sort", () => {
    expect(kept).toEqual([...kept].sort());
  });

  it("excludes prefixed files in a real directory, not just in the repo", () => {
    const tmp = mkdtempSync(join(tmpdir(), "migsort-"));
    try {
      for (const n of ["30_c.sql", "10_a.sql", "20_b.sql", "PROBE_z.sql", "UNAPPLIED_y.sql"]) {
        writeFileSync(join(tmp, n), "-- fixture\n");
      }
      expect(migrationsInSequence(tmp)).toEqual(["10_a.sql", "20_b.sql", "30_c.sql"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });


  /**
   * THE REASON THIS BUG WAS TOTAL RATHER THAN PARTIAL. ASCII puts digits before
   * uppercase letters, so an excluded file does not merely join the candidate
   * set — it sorts after every dated migration and wins every resolver that
   * takes the last match. If this ever stops being true the exclusion still
   * matters, but the blast radius of forgetting it changes, so it is recorded.
   */
  it("an excluded file would sort LAST among all .sql files", () => {
    const last = [...all].sort().pop()!;
    expect(isInSequence(last)).toBe(false);
  });
});

describe("no migration-reading test goes back to naive filename matching", () => {
  /**
   * Tests that read the migrations directory WITHOUT the helper, each because
   * the out-of-sequence files are the subject rather than noise. Adding a name
   * here is a claim that the test means to see them — not a way to silence it.
   *
   * Not every entry exists on every lane. `referralReward0023Withdrawn.test.ts`
   * is main-lane-only by design (P-1 reconciliation, 2026-09-16) — it pins
   * production-specific evidence (run #69/#70 body hashes) for a unit that was
   * dispatched against production and nowhere else, and it is deliberately not
   * carried to staging. That is a lane fact, not staleness: the two self-checks
   * below distinguish "this entry no longer describes what it claims" (still an
   * error, on whichever lane the file exists) from "this entry's file simply
   * isn't part of this checkout" (not an error anywhere).
   */
  const DELIBERATE: Record<string, string> = {
    "src/__tests__/adminCertificates.test.ts":
      "resolves UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql by fragment — the unapplied file IS the subject",
    "src/__tests__/adminUserListPagination.test.ts":
      "resolves UNAPPLIED_20260824000000_admin_user_list_pagination.sql and its rollback by fragment",
    "src/__tests__/certificateTiers.test.ts":
      "resolves the UNAPPLIED_ certificate_types and certificate_custom_heading files by fragment",
    "src/__tests__/postMediaClientReadPath.test.ts":
      "walks src/ for call sites; reads its one migration by exact path, never by resolution",
    "src/__tests__/postMediaForSecurity.test.ts":
      "asserts one exact filename is present in the directory — an existence check, not a resolution",
    "src/lib/__tests__/referralOverloadUnambiguous.test.ts":
      "asserts NO runnable bootstrap exists — it must see the excluded names to do that",
    "src/lib/__tests__/referralReward0023Withdrawn.test.ts":
      "asserts NO runnable 0023 exists — same reason",
  };

  const ROOT = process.cwd();

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  /**
   * Both spellings of the path. `edit-window-invariant.spec.ts` builds it as
   * join(__dirname, "..", "..", "supabase", "migrations"), so a check for the
   * literal "supabase/migrations" walks straight past it — which it did, on the
   * first draft of this guard.
   */
  const NAMES_THE_DIR = /supabase\/migrations|["']supabase["']\s*,\s*["']migrations["']/;

  const offenders = walk(join(ROOT, "src"))
    .map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), src: readFileSync(p, "utf8") }))
    .filter(({ src }) => NAMES_THE_DIR.test(src) && /\breaddirSync\s*\(/.test(src))
    .filter(({ src }) => !src.includes("@/test-utils/migrations"))
    .map(({ rel }) => rel)
    .filter((rel) => !(rel in DELIBERATE))
    .sort();

  it("every such test imports the shared helper, or is listed with a reason", () => {
    expect(
      offenders,
      "these tests read supabase/migrations with their own readdirSync filter. " +
        "An UNAPPLIED_/PROBE_ file sorts last and would win any 'latest definition' " +
        "resolution. Use migrationsInSequence() from @/test-utils/migrations, or add " +
        "the file to DELIBERATE above with the reason it means to see those files.",
    ).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    // A listed file that no longer reads the directory should come off the list,
    // or the list stops describing the repository. A listed file that isn't in
    // THIS checkout at all is a lane fact (see the comment on DELIBERATE above),
    // not staleness — there is nothing here to read and nothing to assert.
    const stale = Object.keys(DELIBERATE).filter((rel) => {
      const abs = join(ROOT, rel);
      if (!existsSync(abs)) return false;
      const src = readFileSync(abs, "utf8");
      return !(NAMES_THE_DIR.test(src) && /\breaddirSync\s*\(/.test(src));
    });
    expect(stale).toEqual([]);
  });

  it("the guard can actually see the files it is meant to police", () => {
    // Without this, a broken walk() or a bad regex would report zero offenders
    // and look identical to success. Asserted against the allowlist itself:
    // every DELIBERATE entry that EXISTS on this lane must be something the
    // scan genuinely reaches. An entry absent from this lane is skipped — the
    // scan cannot "see" a file that was never checked out, and that is not
    // what this test polices (see the comment on DELIBERATE above).
    const scanned = new Set(
      walk(join(ROOT, "src"))
        .map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), src: readFileSync(p, "utf8") }))
        .filter(({ src }) => NAMES_THE_DIR.test(src) && /\breaddirSync\s*\(/.test(src))
        .map(({ rel }) => rel),
    );
    for (const rel of Object.keys(DELIBERATE)) {
      if (!existsSync(join(ROOT, rel))) continue;
      expect(scanned.has(rel), `guard cannot see allowlisted ${rel}`).toBe(true);
    }
    expect(walk(join(ROOT, "src")).length).toBeGreaterThan(150);
  });

  describe("the two self-checks above tolerate a DELIBERATE entry being absent on this lane, without tolerating anything else", () => {
    /**
     * P-1 reconciliation, 2026-09-16. Reproduces the exact shape of the two
     * self-checks above against a synthetic tree, so the claim "absent is fine,
     * present-but-wrong is still caught" is evidence, not a description. Each of
     * these three cases is a mutation of the "entry absent" case, and each must
     * still fail the way it did before this file added the existsSync guard.
     */
    const checkStale = (root: string, deliberate: Record<string, string>): string[] =>
      Object.keys(deliberate).filter((rel) => {
        const abs = join(root, rel);
        if (!existsSync(abs)) return false;
        const src = readFileSync(abs, "utf8");
        return !(NAMES_THE_DIR.test(src) && /\breaddirSync\s*\(/.test(src));
      });

    const checkSeen = (root: string, deliberate: Record<string, string>): string[] => {
      const scanned = new Set(
        walk(join(root, "src"))
          .map((p) => ({ rel: relative(root, p).split("\\").join("/"), src: readFileSync(p, "utf8") }))
          .filter(({ src }) => NAMES_THE_DIR.test(src) && /\breaddirSync\s*\(/.test(src))
          .map(({ rel }) => rel),
      );
      return Object.keys(deliberate).filter((rel) => existsSync(join(root, rel)) && !scanned.has(rel));
    };

    const MATCHING_SOURCE = 'readdirSync(join(ROOT, "supabase", "migrations"))';
    const NON_MATCHING_SOURCE = "// this file no longer reads the migrations directory at all";

    it("an entry whose file does not exist on this lane: neither check reports it", () => {
      const tmp = mkdtempSync(join(tmpdir(), "guard-absent-"));
      try {
        mkdirSync(join(tmp, "src"), { recursive: true }); // walk() needs src/ to exist; the file itself must not
        const deliberate = { "src/__tests__/onlyOnAnotherLane.test.ts": "lane-specific, not present here" };
        // deliberately never written into tmp
        expect(checkStale(tmp, deliberate)).toEqual([]);
        expect(checkSeen(tmp, deliberate)).toEqual([]);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("an entry whose file EXISTS but no longer matches the pattern: still reported stale", () => {
      const tmp = mkdtempSync(join(tmpdir(), "guard-stale-"));
      try {
        const rel = "src/__tests__/driftedAway.test.ts";
        const abs = join(tmp, rel);
        mkdirSync(join(tmp, "src/__tests__"), { recursive: true });
        writeFileSync(abs, NON_MATCHING_SOURCE);
        const deliberate = { [rel]: "used to read the dir directly; no longer does" };
        expect(checkStale(tmp, deliberate)).toEqual([rel]);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("an entry whose file EXISTS, matches the pattern, but the scan cannot reach it: still reported unseen", () => {
      const tmp = mkdtempSync(join(tmpdir(), "guard-unseen-"));
      try {
        // Written outside src/, so walk(join(root, "src")) never visits it —
        // the same failure mode a broken walk() or a bad NAMES_THE_DIR regex
        // would produce.
        const rel = "outside-src/notWalked.test.ts";
        const abs = join(tmp, rel);
        mkdirSync(join(tmp, "src"), { recursive: true }); // walk() needs src/ to exist and be empty
        mkdirSync(join(tmp, "outside-src"), { recursive: true });
        writeFileSync(abs, MATCHING_SOURCE);
        const deliberate = { [rel]: "present, matches, but not under src/ in this fixture" };
        expect(checkSeen(tmp, deliberate)).toEqual([rel]);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

});
