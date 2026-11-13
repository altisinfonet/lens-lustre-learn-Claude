import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEED_INSERTS } from "@/lib/feed/feedInserts";
import { slotForPostIndex } from "@/lib/ads/feedAdPlacement";

const feed = readFileSync(join(__dirname, "..", "..", "..", "pages", "Feed.tsx"), "utf8");
const sidebar = readFileSync(join(__dirname, "..", "..", "..", "components", "FeedLeftSidebar.tsx"), "utf8");

describe("the cards the feed puts between posts", () => {
  it("Trending never lands on a Story Card ad's place", () => {
    expect(slotForPostIndex(FEED_INSERTS.trending)).toBeNull();
  });
  it("Trending sits below the 4th post, apart from the people rail", () => {
    expect(FEED_INSERTS.trending).toBe(3);
    expect(FEED_INSERTS.trending).not.toBe(FEED_INSERTS.people);
  });
  it("the feed places them from this list, never from its own numbers", () => {
    expect(feed).toMatch(/i === FEED_INSERTS\.trending/);
    expect(feed).toMatch(/i === FEED_INSERTS\.people/);
    expect(feed).not.toMatch(/i === 9 &&/);
  });
  it("web and app draw the SAME Trending card (Owner 13 Nov)", () => {
    expect(feed).toMatch(/<TrendingWeekCard variant="feed"/);
    expect(sidebar).toMatch(/<TrendingWeekCard variant="sidebar"/);
    expect(sidebar).not.toMatch(/grid-cols-2[^"]*" data-testid="trending-photos"/);
  });
});
