/**
 * Top Contributors V2 — guards on the frontend switch.
 *
 * Nothing in the suite referenced Top Contributors before this file, so the
 * switch from v1 to v2 had nothing watching it. These tests read the real source
 * files rather than mocking, because what actually broke things here would be a
 * component still reading a field the RPC no longer returns — a rendering bug
 * that type-checks fine if anyone reaches for `any`.
 *
 * The scoring maths is NOT tested here. It lives entirely in the database and is
 * verified against production in claude/PHASE1_VERIFICATION_REPORT_2026-08-11.md
 * (49 members cross-checked against an independent implementation, 0 mismatches).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const HOOK = "src/hooks/useTopContributors.ts";
const HOME = "src/pages/Index.tsx";
const SIDEBAR = "src/components/sidebar/SidebarTopContributors.tsx";

describe("useTopContributors calls v2", () => {
  const src = read(HOOK);

  it("calls get_top_contributors_v2", () => {
    expect(src).toContain("get_top_contributors_v2");
  });

  it("does not call get_top_contributors_v1", () => {
    expect(src).not.toContain("rpc('get_top_contributors_v1'");
    expect(src).not.toContain('rpc("get_top_contributors_v1"');
  });

  it("uses a query key that cannot serve cached v1 OR v2 rows", () => {
    // Same key + different row shape = blank scores for anyone mid-session.
    // Updated 2026-09-03 for TC-v3 (OWNER-RULING-2026-09-03-02): the hook now
    // keys on v3 because v3 adds recent_score, and a member holding a cached v2
    // payload would render an empty 30d line until they reloaded. Exactly the
    // trap this test was written for at the v1 -> v2 switch, one version on.
    expect(src).toContain("'top-contributors-v3'");
    expect(src).not.toContain("queryKey: ['top-contributors-v1']");
    expect(src).not.toContain("queryKey: ['top-contributors-v2']");
  });

  it("exposes contributor_score and rank_position", () => {
    expect(src).toContain("contributor_score");
    expect(src).toContain("rank_position");
  });

  it("no longer exposes the fields v2 does not return", () => {
    for (const gone of ["posts_count", "likes_received", "comments_received"]) {
      expect(src).not.toContain(gone);
    }
  });

  it("hands the UI exactly eight fields and nothing else", () => {
    // Asserting on the mapped object rather than searching the whole file: the
    // prose above it discusses engagement at length, and a keyword scan would
    // fail on the explanation of why engagement is absent.
    const body = src.slice(src.indexOf("return rows.map("));
    const obj = body.slice(body.indexOf("return {") + 8, body.indexOf("};"));
    const keys = [...obj.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    // Eight since TC-v3, not seven: recent_score joined the mapped object.
    // contributor_score STAYS - it is still displayed, as the secondary line.
    expect(keys).toEqual([
      "avatar_url",
      "badges",
      "contributor_score",
      "full_name",
      "id",
      "rank_position",
      "recent_score",
      "roles",
    ].sort());
  });
});

describe("both Top Contributors surfaces render the score, not a post count", () => {
  for (const [label, path] of [
    ["Home page card", HOME],
    ["signed-out sidebar", SIDEBAR],
  ] as const) {
    describe(label, () => {
      const src = read(path);

      it("renders contributor_score", () => {
        expect(src).toContain("contributor_score");
      });

      it("does not render posts_count", () => {
        // The whole point of the change: "15 posts / 34 posts" confused members.
        expect(src).not.toContain("posts_count");
      });
    });
  }
});

describe("Home page card", () => {
  const src = read(HOME);

  it("labels the window Last 30 Days, not This Month", () => {
    // A rolling 30 UTC days is not a calendar month.
    expect(src).toContain("home.last30Days");
    expect(src).not.toContain("home.thisMonth");
  });

  it("scales the progress bar by the 30-day score, not the lifetime score", () => {
    // Updated 2026-09-03. Dividing by rank 1's LIFETIME score was wrong because
    // the lifetime score is not the maximum: measured on production the same
    // day, ranks 1/2/3 hold 9,143 / 9,551 / 11,546 lifetime against 7,233 /
    // 7,055 / 6,823 recent. The old bar therefore computed 11,546 / 9,143 for
    // the BRONZE row, clipped by overflow-hidden, so the last-placed member
    // rendered the fullest bar. recent_score is descending by construction, so
    // rank 1 holds the maximum and no row can exceed 100%.
    expect(src).toContain("topContributors[0]?.recent_score");
    expect(src).not.toContain("topContributors[0]?.contributor_score");
  });
});

describe("the Last 30 Days label is translated, not left as an English fallback", () => {
  const i18n = read("src/i18n/home.ts");

  it("exists in every locale that defines the block it replaced", () => {
    const locales = (i18n.match(/"home\.thisMonth":/g) || []).length;
    const added = (i18n.match(/"home\.last30Days":/g) || []).length;
    expect(locales).toBeGreaterThan(1);
    expect(added).toBe(locales);
  });
});

describe("v1 is still available for rollback", () => {
  it("the migration that created v2 does not drop or replace v1", () => {
    const sql = read("supabase/migrations/20260811160000_top_contributors_v2.sql");
    expect(sql).not.toMatch(/drop\s+function[^;]*get_top_contributors_v1/i);
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function\s+public\.get_top_contributors_v1/i);
  });
});
