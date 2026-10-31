/**
 * Owner, 2026-10-29: no birthday box above the posts on phones or in the app —
 * "In web left card is okay but in App NO, Only Push Notification, Email are
 * Okay." The desktop left-sidebar card (FeedLeftSidebar, `hidden xl:block`)
 * stays; nothing birthday-related is rendered in the feed column.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("no birthday box above the feed (Owner 2026-10-29)", () => {
  it("Feed.tsx renders no birthday component", () => {
    expect(stripComments(read("src/pages/Feed.tsx"))).not.toMatch(/birthday/i);
  });

  it("the phone/app strip component is gone", () => {
    expect(existsSync(join(process.cwd(), "src/components/feed/TodaysBirthdayStrip.tsx"))).toBe(false);
  });

  it("the desktop left-sidebar card is kept", () => {
    expect(read("src/components/FeedLeftSidebar.tsx")).toMatch(/Today's Birthday/);
  });
});
