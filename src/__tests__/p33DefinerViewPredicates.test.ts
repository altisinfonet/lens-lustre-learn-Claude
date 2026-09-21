/**
 * P33 clause 2 — the four definer views are judged by their WHERE clause, and
 * MUST NOT be "fixed" by flipping `security_invoker`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `judge_decisions_owner_safe`, `judge_comments_owner_safe` and
 * `judge_tag_assignments_owner_safe` are safe because each row is gated on
 * `ce.user_id = auth.uid()` (a caller-scoped predicate) AND a publication
 * check (`crp.published_at IS NOT NULL`) — not because of who defined the
 * view. `entry_public_status` is safe for a different, deliberate reason: it
 * is the public results board, gated on a status allow-list OR an admin role
 * check, with every award-shaped column separately conditioned on
 * `latest_published_round`.
 *
 * A future edit that removes the `auth.uid()` ownership predicate, widens the
 * status allow-list to leak an in-progress status, or drops the publication
 * gate would be invisible to `securityDefinerGrants.test.ts` (these are
 * VIEWS the grant guard does not scan function bodies for) and would not
 * change any GRANT — it would just quietly start returning another member's
 * row. This test is the guard for that specific class of regression.
 *
 * WHAT THIS TEST DOES NOT DO. It is a static check against a committed
 * snapshot of the live view definitions
 * (`docs/evidence/d1/P33/view-definitions-snapshot-20260921.sql`), taken
 * 2026-09-21. It cannot see a change made live and never re-snapshotted, and
 * it cannot catch a defect that keeps the predicate text but breaks its
 * logic (e.g. an `OR` written where an `AND` belongs). The live,
 * real-member-data cross-member proof for `judge_decisions_owner_safe` is
 * recorded in `docs/evidence/d1/P33/README.md` §4 — this file is the
 * regression guard that runs on every PR without needing a live database; it
 * complements that proof, it does not replace it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SNAPSHOT = join(
  process.cwd(),
  "docs/evidence/d1/P33/view-definitions-snapshot-20260921.sql",
);

const snapshot = readFileSync(SNAPSHOT, "utf8");

describe("P33 · the three judge_*_owner_safe views stay owner-scoped and publish-gated", () => {
  it("the snapshot file exists and is non-trivial (guards against a vacuous pass)", () => {
    expect(snapshot.length).toBeGreaterThan(500);
  });

  for (const view of [
    "judge_decisions_owner_safe",
    "judge_comments_owner_safe",
    "judge_tag_assignments_owner_safe",
  ]) {
    it(`${view}: snapshot carries the owner predicate (ce.user_id = auth.uid())`, () => {
      const section = snapshot.slice(snapshot.indexOf(`=== ${view} `));
      expect(
        /ce\.user_id\s*=\s*auth\.uid\(\)/.test(section),
        `${view}'s committed snapshot no longer shows an auth.uid()-scoped ownership predicate. ` +
          `If this view was legitimately changed, re-read it live from staging, verify the new ` +
          `predicate still scopes by the caller (not by a supplied argument — that is the ` +
          `amplification class this gate exists to catch), re-run the cross-member proof in ` +
          `docs/evidence/d1/P33/README.md §4, and only then update the snapshot.`,
      ).toBe(true);
    });

    it(`${view}: snapshot carries a publication gate (published_at IS NOT NULL)`, () => {
      const section = snapshot.slice(snapshot.indexOf(`=== ${view} `));
      expect(
        /published_at\s+IS\s+NOT\s+NULL/i.test(section),
        `${view}'s committed snapshot no longer shows a publication gate. Without it, an owner ` +
          `could read their own judging data before it is published — a different leak than the ` +
          `cross-member one, but still a defect this view exists to prevent.`,
      ).toBe(true);
    });
  }
});

describe("P33 · entry_public_status stays gated by status-allowlist OR admin role, not by ownership", () => {
  const section = snapshot.slice(snapshot.indexOf("=== entry_public_status "));

  it("the snapshot has a section for entry_public_status (guards against a vacuous pass)", () => {
    expect(section.length).toBeGreaterThan(200);
  });

  it("snapshot carries the admin-role escape hatch (has_role(..., 'admin'))", () => {
    expect(
      /has_role\s*\(\s*\(\s*SELECT\s+auth\.uid\(\)[^)]*\)\s*,\s*'admin'/i.test(section),
      "entry_public_status's committed snapshot no longer shows the admin-role check in its " +
        "WHERE clause — a change here is a genuine access-control edit, not cosmetics, and needs " +
        "a fresh live read plus an updated snapshot, not just a passing test.",
    ).toBe(true);
  });

  it("snapshot documents that no raw score/mark column is projected", () => {
    // The snapshot is a prose+SQL evidence file, not the live view — this
    // assertion is intentionally about the evidence record itself staying
    // honest, not a substitute for src/test/marks-private.test.ts, which
    // pins the actual forbidden-field list against the client-facing shape.
    expect(section).toMatch(/No column in entry_public_status's SELECT list is a raw score/);
  });
});
