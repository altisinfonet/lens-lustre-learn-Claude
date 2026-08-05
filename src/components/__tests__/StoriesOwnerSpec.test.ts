/**
 * STORIES — THE OWNER'S FOUR RULES, PINNED (2026-08-05, with an Instagram
 * screenshot as the size reference):
 *
 *   1. "Stories round will be like this size now it's too small."
 *   2. "Once updated user unable to delete, delete anytime option needed."
 *   3. "When opened stories full page like instagram must be opened."
 *   4. "Stories time 5 sec to do it 10 sec to stay."
 *
 * Source pins on comment-stripped code, so a future change that quietly
 * shrinks the rings, drops the delete, boxes the viewer again or reverts the
 * timer fails CI with this file explaining whose rule it broke.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { STORY_DISPLAY_MS } from "@/lib/storyTiming";

const read = (rel: string) =>
  readFileSync(join(__dirname, "..", "..", "..", "src", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const feed = read("components/feed/FeedStoriesBar.tsx");
const profile = read("components/profile/ProfileStories.tsx");

describe("rule 4 — a story stays 10 seconds", () => {
  it("the shared constant is exactly 10 000 ms (was 5 000)", () => {
    expect(STORY_DISPLAY_MS).toBe(10_000);
  });

  it("both viewers run on the shared constant, so they can never disagree", () => {
    expect(feed).toContain('from "@/lib/storyTiming"');
    expect(profile).toContain('from "@/lib/storyTiming"');
    // and no viewer re-hardcodes the old five seconds
    expect(feed).not.toMatch(/STORY_MS\s*=\s*5000/);
  });
});

describe("rule 1 — rings at the screenshot's size", () => {
  it("feed bar rings are 80px on phones, 96px from sm up", () => {
    expect(feed).toContain("h-20 w-20 sm:h-24 sm:w-24");
    expect(feed).not.toContain("h-16 w-16");
  });

  it("profile rings match", () => {
    expect(profile).toContain("h-20 w-20 sm:h-24 sm:w-24");
    expect(profile).not.toContain("h-16 w-16");
  });
});

describe("rule 3 — a story opens FULL PAGE", () => {
  it("the profile viewer renders stories full-bleed like the feed viewer", () => {
    // the full-page image sizing used by both viewers
    expect(profile).toContain("max-h-[92vh] max-w-[100vw]");
    expect(feed).toContain("max-h-[92vh] max-w-[100vw]");
  });

  it("with Instagram-style timed progress bars and tap zones", () => {
    expect(profile).toContain("onAnimationComplete");
    expect(profile).toContain('aria-label="Previous"');
    expect(profile).toContain('aria-label="Next"');
  });
});

describe("rule 2 — the owner can delete ANYTIME", () => {
  it("profile viewer keeps a delete path for the story on screen", () => {
    expect(profile).toContain("handleDeleteStory(currentViewerItem.id)");
  });

  it("feed viewer keeps delete for one's own story", () => {
    expect(feed).toContain("handleDeleteOwn");
    expect(feed).toContain('supabase.from("stories" as any).delete()');
  });

  it("a delete is VERIFIED (rows returned) and SEEN (state refreshed) — both viewers", () => {
    // .select("id") after .delete() makes the database return what it deleted;
    // zero rows must surface as an error, never a false "Story removed".
    expect(feed).toContain('.delete().eq("id", currentStory.id).select("id")');
    expect(profile).toContain('.delete().eq("id", storyId).select("id")');
    // and the feed bar refreshes so the ring disappears without a reload —
    // the 2026-08-05 "unable to delete" was exactly this missing refresh
    expect(feed).toContain("setOwnStories((prev) => prev.filter((s) => s.id !== currentStory.id))");
    expect(feed).toMatch(/closeViewer\(\);\s*loadBar\(\);/);
  });
});
