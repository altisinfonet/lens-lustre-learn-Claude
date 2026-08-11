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

  it("cancels its animation frame and observer on unmount", () => {
    // A feed unmounts cards constantly; a leaked rAF per card would be real.
    expect(src).toContain("cancelAnimationFrame");
    expect(src).toContain("observer.disconnect()");
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

describe("Home page keeps the score beside the name, not beneath it", () => {
  it("Index.tsx renders the score in a shrink-0 span, not a block under the name", () => {
    const src = read(HOME);
    const i = src.indexOf("c.contributor_score.toLocaleString()");
    expect(i).toBeGreaterThan(-1);
    // Walk back to the element that opens this span and confirm it is the
    // right-hand cell, not a div nested inside the name container.
    const openTag = src.lastIndexOf("<", i);
    const tag = src.slice(openTag, i);
    expect(tag).toContain("shrink-0");
  });

  it("SidebarTopContributors does the same", () => {
    const src = read(SIDEBAR);
    const i = src.indexOf("c.contributor_score.toLocaleString()");
    expect(i).toBeGreaterThan(-1);
    const tag = src.slice(src.lastIndexOf("<", i), i);
    expect(tag).toContain("shrink-0");
  });
});
