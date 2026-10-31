/**
 * S12-F5 · review #466 B1: the post ⋯ menu's "Not interested" / "Mute" are
 * offered only to members the personal_feed switch includes (the same
 * `showTabs` that shows the feed tabs). With the switch Off a member sees the
 * feed exactly as before. PostCard renders each item only when its handler is
 * passed (PostCard.tsx `{onNotInterested && …}`), so the gate is the prop.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const feed = readFileSync(join(process.cwd(), "src/pages/Feed.tsx"), "utf8");

describe("Feed ⋯ menu gated by the personal_feed switch", () => {
  it("passes onNotInterested / onMuteAuthor only when showTabs is true", () => {
    expect(feed).toMatch(/onNotInterested=\{showTabs \? notInterested : undefined\}/);
    expect(feed).toMatch(/onMuteAuthor=\{showTabs \? mute : undefined\}/);
    expect(feed).not.toMatch(/onNotInterested=\{notInterested\}/);
    expect(feed).not.toMatch(/onMuteAuthor=\{mute\}/);
  });
});
