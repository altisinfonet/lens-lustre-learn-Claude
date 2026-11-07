/**
 * STORIES — THE OWNER'S RULES, PINNED.
 *
 * 2026-08-05 (with an Instagram screenshot):
 *   2. "Once updated user unable to delete, delete anytime option needed."
 *   3. "When opened stories full page like instagram must be opened."
 *   4. "Stories time 5 sec to do it 10 sec to stay."
 * 2026-11-06, Stories v2 ("go stories … exact matching of your screen"):
 *   1. (REPLACES the 2026-08-05 round 80/96 px rings, by the Owner, in writing,
 *      with an approved screenshot) "No Round … Make it square corner rounded
 *      but show image category don't hide that" — 88 px square tiles with
 *      rounded corners showing the story photo, under the category tabs.
 *   5. One viewer for every story (feed, profile, bell).
 *   6. Every post goes to the story unless the box is unticked (ticked by default).
 *
 * Source pins on comment-stripped code, so a change that quietly breaks a rule
 * fails CI with this file explaining whose rule it broke.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { STORY_DISPLAY_MS } from "@/lib/storyTiming";
import { STORY_RULES } from "@/lib/stories/storyData";
import { STORY_BOX_HINT } from "@/components/stories/AddToStoryBox";
import { getNotifLink } from "@/lib/notificationLinks";
import { stripComments } from "@/test-utils/sourceText";

const read = (rel: string) => stripComments(readFileSync(join(__dirname, "..", "..", "..", "src", rel), "utf8"))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const feed = read("components/feed/FeedStoriesBar.tsx");
const profile = read("components/profile/ProfileStories.tsx");
const viewer = read("components/stories/StoryViewer.tsx");
const rules = read("lib/stories/storyRules.ts");
const viewerData = read("lib/stories/storyViewerData.ts");
const app = read("App.tsx");

describe("rule 4 — a story stays 10 seconds", () => {
  it("the shared constant is exactly 10 000 ms (was 5 000)", () => {
    expect(STORY_DISPLAY_MS).toBe(10_000);
  });

  it("the one viewer times photos with that constant", () => {
    expect(STORY_RULES.photoMs).toBe(STORY_DISPLAY_MS);
    expect(rules).toContain('from "@/lib/storyTiming"');
  });
});

describe("rule 1 (v2) — square tiles with rounded corners, showing the photo", () => {
  it("feed tiles are 88 px squares with rounded corners — no round rings", () => {
    expect(feed).toContain("h-[88px] w-[88px] rounded-[18px] p-[3px]");
    expect(feed).toContain("rounded-[15px]");
    expect(feed).not.toContain("h-20 w-20 sm:h-24 sm:w-24");
  });

  it("a tile shows the newest story photo, with the face small in the corner", () => {
    expect(feed).toContain("b.cover_url");
    expect(feed).toContain("absolute -bottom-1 -right-1 h-7 w-7 rounded-full");
  });

  it("profile rings keep the 2026-08-16 size and no dashed placeholders", () => {
    expect(profile).toContain("h-[68px] w-[68px] sm:h-20 sm:w-20");
    expect(profile).not.toContain("border-dashed");
  });
});

describe("rule 3 + 5 — one full-page viewer for every story", () => {
  it("feed and profile both open the one StoryViewer", () => {
    // Loaded on demand (P13 entry-bundle ceiling) — still the one viewer.
    expect(feed).toContain('import("@/components/stories/StoryViewer")');
    expect(profile).toContain('import("@/components/stories/StoryViewer")');
  });

  it("the phone viewer is full screen, with progress bars and tap zones", () => {
    expect(viewer).toContain('"fixed inset-0 z-[200] bg-black"');
    expect(viewer).toContain("h-[3px] flex-1 overflow-hidden rounded-full bg-white/35");
    expect(viewer).toContain('aria-label="Previous"');
    expect(viewer).toContain('aria-label="Next"');
  });
});

describe("rule 2 — the owner can delete ANYTIME, and the delete is verified", () => {
  it("the viewer offers Delete on one's own story", () => {
    expect(viewer).toContain("deleteOwnStory(story.id)");
  });

  it("a delete returns the deleted row, and zero rows is an error", () => {
    expect(viewerData).toContain('.delete().eq("id", storyId).select("id")');
    expect(viewerData).toContain("Story could not be deleted.");
  });
});

describe("rule 6 — posts go to the story by default", () => {
  it("the box starts ticked", () => {
    expect(STORY_RULES.addToStoryByDefault).toBe(true);
  });
});

describe("Owner 7 Nov 2026 — small changes after the staging check", () => {
  it("the box says 'Shows for 24 hours publicly.' for a public post, and never 'publicly' for a smaller audience", () => {
    expect(STORY_BOX_HINT.public).toBe("Shows for 24 hours publicly.");
    expect(STORY_BOX_HINT.friends).not.toMatch(/public/i);
    expect(STORY_BOX_HINT.private).not.toMatch(/public/i);
  });

  it("no 'Your Story' name and no 'Share a story' line under the own tile", () => {
    expect(feed).not.toMatch(/>\s*Your Story\s*</);
    expect(feed).not.toContain("Share a story");
    expect(feed).toContain('aria-label="Your story"');
  });

  it("an unseen story's border is blue into gold", () => {
    expect(feed).toContain('RING_UNSEEN = "bg-gradient-to-tr from-primary to-amber-400"');
  });

  it("a story has its own address: /<handle>/stories/<id>, and the bell opens /stories/<id>", () => {
    expect(app).toContain('path="/:handle/stories/:storyId"');
    expect(app).toContain('path="/stories/:storyId"');
    expect(app.indexOf('path="/:handle/stories/:storyId"')).toBeLessThan(app.indexOf('path="/:customUrl"'));
    expect(getNotifLink({ type: "story_comment", reference_id: "abc" })).toBe("/stories/abc");
    expect(viewer).toContain("/stories/${storyKey}");
  });
});
