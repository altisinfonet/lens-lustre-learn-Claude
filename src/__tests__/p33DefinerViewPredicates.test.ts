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
 *
 * ── CARRIED BY D2, AND REVIEWED. Ruling R-1. ──
 *
 * Authored by a D1 session on `d1/P1-session-b-p30-p31-p33-20260921` @ 2bc2e39.
 * `src/**` has one owner and it is not D1 (§3.1), which is why PR #275 was
 * closed and #277 carries the D1 half without this file. D1 stated plainly
 * that its content had not been reviewed and was not being vouched for. It has
 * now been reviewed, and two things were wrong with it:
 *
 *   1. EVERY SECTION SLICE RAN TO THE END OF THE FILE. `snapshot.slice(
 *      snapshot.indexOf("=== judge_decisions_owner_safe "))` does not stop at
 *      that view — it carries the two views below it as well, and all three
 *      carry the same predicate text. Deleting `ce.user_id = auth.uid()` from
 *      `judge_decisions_owner_safe` alone therefore left its own assertion
 *      GREEN, matching `judge_comments_owner_safe`'s copy of the string two
 *      sections further down. Two of the three views had a guard that could
 *      not fail — which is exactly C-34, in the test written to prevent it.
 *      `sectionFor()` below now ends each section at the next `-- === ` banner.
 *
 *   2. ONLY `entry_public_status` HAD A VACUOUS-PASS GUARD. A missing or
 *      renamed banner made `indexOf` return -1 and `slice(-1)` hand the
 *      regexes a single character, so the three judge views' assertions failed
 *      for a reason no message explained. `sectionFor()` now throws by name.
 *
 * WHAT THIS STILL IS NOT, stated because the P33 clause asks for something
 * else: "each of the four definer views covered by a cross-member test". This
 * is not one. It never opens a connection, never authenticates as a member and
 * never reads a row; it cannot be shown failing against a member who should
 * not see the row, because no member is involved. It is a text guard over a
 * committed snapshot of the definitions, and it is useful as that. The
 * cross-member proof lives in docs/evidence/d1/P33/README.md §4 and is D1's;
 * carrying this file does not close that clause and must not be recorded as
 * closing it.
 *
 * DEPENDENCY: the snapshot this reads is `docs/evidence/d1/**`, which is D1's
 * lane. It reaches `staging` with PR #277, not with this PR. Until #277 lands
 * this file fails, loudly and by design — see the message in `readSnapshot()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SNAPSHOT_PATH = "docs/evidence/d1/P33/view-definitions-snapshot-20260921.sql";
const SNAPSHOT = join(process.cwd(), SNAPSHOT_PATH);

function readSnapshot(): string {
  try {
    return readFileSync(SNAPSHOT, "utf8");
  } catch (cause) {
    throw new Error(
      `${SNAPSHOT_PATH} is not in this tree, so nothing below can be checked. ` +
        `That file is D1's evidence (docs/evidence/d1/**) and arrives on staging with ` +
        `PR #277; this test cannot pass before it does. Do not make this skip — an absent ` +
        `snapshot means the guard is not running, which is the one outcome worse than red. ` +
        `(${String(cause)})`,
    );
  }
}

const snapshot = readSnapshot();

/**
 * The text of ONE view's section, ending at the next banner.
 *
 * The original took `snapshot.slice(indexOf(banner))` and ran to end of file,
 * so a section inherited every predicate written below it and the first two
 * views' assertions could not fail. Bounding it is the whole point.
 */
function sectionFor(view: string): string {
  const BANNER = /^--\s*===\s*\S+\s*=+\s*$/gm;
  const start = snapshot.search(new RegExp(`^--\\s*===\\s*${view}\\s*=`, "m"));
  if (start < 0) {
    throw new Error(
      `${SNAPSHOT_PATH} has no "-- === ${view} ===" banner. Either the view was renamed ` +
        `without re-snapshotting, or the snapshot was rewritten in a shape this guard no ` +
        `longer understands. Both are findings; neither is a reason to relax this test.`,
    );
  }
  BANNER.lastIndex = start + 1;
  const next = BANNER.exec(snapshot);
  return snapshot.slice(start, next ? next.index : snapshot.length);
}

describe("P33 · the three judge_*_owner_safe views stay owner-scoped and publish-gated", () => {
  it("the snapshot file exists and is non-trivial (guards against a vacuous pass)", () => {
    expect(snapshot.length).toBeGreaterThan(500);
  });

  for (const view of [
    "judge_decisions_owner_safe",
    "judge_comments_owner_safe",
    "judge_tag_assignments_owner_safe",
  ]) {
    it(`${view}: its OWN section is non-trivial (guards against a vacuous pass)`, () => {
      expect(sectionFor(view).length).toBeGreaterThan(200);
    });

    it(`${view}: snapshot carries the owner predicate (ce.user_id = auth.uid())`, () => {
      const section = sectionFor(view);
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
      const section = sectionFor(view);
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
  const section = sectionFor("entry_public_status");

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
