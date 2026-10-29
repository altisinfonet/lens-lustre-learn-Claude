/**
 * S6-c · THE PROFILE GRID IS WINDOWED WITH THE FEED'S OWN COMPONENT.
 *
 * Every tile of ProfilePostGrid sits inside `FeedCardWindow` (imported from
 * the feed — the same component, not a copy), so a long wall keeps only the
 * tiles near the viewport mounted, exactly as the feed keeps its cards. The
 * showcase tile's full width goes on the wrapper, which is the grid item.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const grid = read("src/components/profile/ProfilePostGrid.tsx");

describe("S6-c profile windowing", () => {
  it("imports the feed's FeedCardWindow — the one windowing component", () => {
    expect(grid).toMatch(/import FeedCardWindow from "@\/components\/feed\/FeedCardWindow";/);
  });

  it("wraps BOTH tile kinds, the showcase with its full width on the wrapper", () => {
    expect(grid).toMatch(/<FeedCardWindow key=\{post\.id\} className="col-span-3">\s*<ShowcaseTile post=\{post\} \/>/);
    expect(grid).toMatch(/<FeedCardWindow key=\{post\.id\}>\s*<GridTile post=\{post\} \/>/);
  });

  it("no second windowing component exists in src/components", () => {
    const hits = readdirSync(join(process.cwd(), "src/components"), { recursive: true })
      .map(String)
      .filter((f) => /Window\.tsx$/.test(f) && !/feed[\\/]FeedCardWindow\.tsx$/.test(f));
    expect(hits).toEqual([]);
  });

  it("the window exposes its state for the S6-d harness count", () => {
    expect(read("src/components/feed/FeedCardWindow.tsx")).toMatch(/data-feed-window=\{mounted \? "mounted" : "placeholder"\}/);
  });
});
