/**
 * The Contributor Score badge on the feed and the wall.
 *
 * These read the real source rather than mocking, because the failures that
 * matter here are placement and batching — a badge that renders on the wrong
 * surface, or twenty cards firing twenty requests. Both type-check perfectly.
 *
 * The batching test exists because that exact bug shipped once already: the ad
 * engagement bar promised "one round trip, not sixty-four" while every caller
 * passed a single id, and it had to be fixed the same day.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const LIB = "src/lib/contributorScore.ts";
const BADGE = "src/components/ContributorScore.tsx";
const POSTCARD = "src/components/post/PostCard.tsx";
const HOME = "src/pages/Index.tsx";
const SIDEBAR = "src/components/sidebar/SidebarTopContributors.tsx";

describe("scores are fetched in one batched request", () => {
  const src = read(LIB);

  it("coalesces ids inside a microtask instead of querying per caller", () => {
    const fn = src.slice(src.indexOf("export const fetchContributorScores"));
    expect(fn).toContain("pendingIds.includes(id)");
    expect(fn).toContain("pendingIds.push(id)");
    // The exported function must NOT call the RPC itself — that is the whole
    // point. Only runBatch may.
    expect(fn).not.toContain("supabase.rpc");
  });

  it("calls get_contributor_scores with an array", () => {
    expect(src).toContain("get_contributor_scores");
    expect(src).toContain("_user_ids: ids");
  });

  it("drops non-positive scores so a bare 0 can never render", () => {
    expect(src).toContain("n > 0");
  });
});

describe("the badge itself", () => {
  const src = read(BADGE);

  it("renders nothing when the member has no score", () => {
    // Admin, suspended, deleted, or zero — the RPC returns no row for all four.
    expect(src).toContain("if (score === null) return null;");
  });

  it("animates the count once, on first view, not on every render", () => {
    expect(src).toContain("IntersectionObserver");
    expect(src).toContain("animated.current");
  });

  it("respects prefers-reduced-motion", () => {
    expect(src).toContain("prefers-reduced-motion: reduce");
  });

  it("cancels its animation frame, timer and observer on unmount", () => {
    // A feed unmounts cards constantly; a leaked rAF per card would be real.
    expect(src).toContain("cancelAnimationFrame");
    expect(src).toContain("clearTimeout");
    expect(src).toContain("observer.disconnect()");
  });

  it("has a timer fallback that lands on the real value if frames stall", () => {
    // requestAnimationFrame does not run in a hidden tab. If the tab is hidden
    // between the observer firing and the frames running, the count would stop
    // partway and `animated` is already true, so nothing restarts it. A public
    // score stuck at a wrong number is worse than a clipped animation.
    expect(src).toContain("setTimeout(() => setShown(score)");
  });

  it("uses tabular numerals so the row does not twitch while counting", () => {
    expect(src).toContain("tabular-nums");
  });
});

describe("placement — feed and wall only", () => {
  it("is mounted in PostCard, which serves both the feed and the wall", () => {
    const src = read(POSTCARD);
    expect(src).toContain('import ContributorScore from "@/components/ContributorScore"');
    expect(src).toContain("<ContributorScore userId={post.user_id} />");
  });

  it("is NOT mounted on the Home page Top Contributors list", () => {
    // Owner, 2026-08-11: Home keeps the score on the right of the name, on one
    // line. Under-the-name is the feed/wall treatment only.
    expect(read(HOME)).not.toContain("<ContributorScore");
    expect(read(SIDEBAR)).not.toContain("<ContributorScore");
  });

  it("is not mounted on comments, sidebars or notification rows", () => {
    for (const p of [
      "src/components/PostCommentsSection.tsx",
      "src/components/CommentsSection.tsx",
      "src/components/FeedLeftSidebar.tsx",
      "src/components/FeedRightSidebar.tsx",
    ]) {
      expect(read(p)).not.toContain("<ContributorScore");
    }
  });
});

/**
 * ⚠ REWRITTEN 2026-09-03, and the reason matters more than the change.
 *
 * The claim these two tests defend is unchanged: the score belongs in the
 * RIGHT-HAND CELL of the row, not nested inside the name column, because a
 * score inside the name column steals width from the name and defeats the
 * `truncate` + `min-w-0` pair that produces the ellipsis.
 *
 * What changed is the MECHANISM, and only because the old one was fragile.
 * It walked back to the nearest `<` before the score and asserted `shrink-0`
 * on that tag. Under OWNER-RULING-2026-09-03-02 (Option B) the right-hand cell
 * became two lines — the 30-day figure over a muted `Lifetime …` line — so the
 * nearest preceding tag is now the inner line's div, and the `shrink-0` sits
 * one level out on the cell that still wraps both. The tests failed while the
 * property they exist to protect was never broken.
 *
 * They now assert the CELL rather than the nearest tag, and additionally assert
 * that the name column is not re-entered between the cell and the score — which
 * is the thing that would actually be a regression. This is a correction of a
 * check, NOT a relaxation of one: the new form fails on the arrangement the old
 * form was written to catch, and the old form did not test re-entry at all.
 */
describe("Home page keeps the score in the right-hand cell, not inside the name column", () => {
  for (const [label, path] of [
    ["Index.tsx", HOME],
    ["SidebarTopContributors", SIDEBAR],
  ] as const) {
    it(`${label} renders the score inside a shrink-0 cell`, () => {
      const src = read(path);
      const i = src.indexOf("c.contributor_score.toLocaleString()");
      expect(i).toBeGreaterThan(-1);

      const cellOpen = src.lastIndexOf('className="shrink-0', i);
      expect(cellOpen).toBeGreaterThan(-1);

      // The name column is `flex-1 min-w-0`. If it opens again between the
      // right-hand cell and the score, the score is inside the name column.
      expect(src.slice(cellOpen, i)).not.toContain("min-w-0");
    });
  }
});
