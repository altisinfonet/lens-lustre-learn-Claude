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

  it("uses a query key that cannot serve cached v1 rows", () => {
    // Same key + different row shape = blank scores for anyone mid-session.
    expect(src).toContain("'top-contributors-v2'");
    expect(src).not.toContain("queryKey: ['top-contributors-v1']");
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

  it("hands the UI exactly seven fields and nothing else", () => {
    // Asserting on the mapped object rather than searching the whole file: the
    // prose above it discusses engagement at length, and a keyword scan would
    // fail on the explanation of why engagement is absent.
    const body = src.slice(src.indexOf("return rows.map("));
    const obj = body.slice(body.indexOf("return {") + 8, body.indexOf("};"));
    const keys = [...obj.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    expect(keys).toEqual([
      "avatar_url",
      "badges",
      "contributor_score",
      "full_name",
      "id",
      "rank_position",
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

  it("scales the progress bar by the contributor score", () => {
    expect(src).toContain("topContributors[0]?.contributor_score");
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
