/**
 * "50mm Retina World with Avijit Sheel and 19 others".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-10, with an Instagram screenshot of
 * "vineet_vohra ✓ and ifp.festival":
 *
 *   "In this picture I tagged Avijit Sheel but not showing 50mm Retina World
 *    with Avijit Sheel like Instagram"
 *   "If Tagged 20 person then it will show 50mm Retina World with Avijit Sheel
 *    and 19 Others. If someone click 19 others then the 20 name list will open
 *    nicely"
 *
 * Tagging itself has worked since 1059 — the row is saved, the tagged member is
 * notified, the pin shows on the photo. It was simply never said on the post,
 * so from outside a tag looked like it had never happened.
 *
 * THE TWO RULES THAT MATTER, and why each is pinned:
 *
 *   1. THE NUMBER IS REAL. "and 19 others" is `people.length - 1`. Nothing on
 *      this project may display an invented figure (PROJECT_MASTER_RECORD §12),
 *      and an off-by-one here is the easiest possible way to break that: it is
 *      tempting to write `length` because there are 20 people.
 *
 *   2. THE LIST IS THE WHOLE LIST. "19 others" promises nineteen MORE people,
 *      so the dialog shows all 20 — the first name included. A list of 19 would
 *      be a different set from the 20 who are actually tagged.
 *
 * These render for real rather than reading the source, because both rules are
 * about what a member SEES. A source check would pass on a component that
 * computed the right number and rendered it in a hidden element.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TaggedPeople from "@/components/post/TaggedPeople";
import type { TaggedPerson } from "@/types/post";

const people = (n: number): TaggedPerson[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `Person ${i}` }));

const show = (list: TaggedPerson[]) =>
  render(
    <MemoryRouter>
      <TaggedPeople people={list} />
    </MemoryRouter>,
  );

describe("the tagged-people line on a post header", () => {
  it("says nothing at all when nobody is tagged", () => {
    // A post with no tags must look exactly as it did before this feature.
    const { container } = show([]);
    expect(container.textContent).toBe("");
  });

  it("names one tagged person, with no count", () => {
    show([{ id: "a", name: "Avijit Sheel" }]);
    expect(screen.getByText("Avijit Sheel")).toBeTruthy();
    expect(screen.queryByText(/other/)).toBeNull();
  });

  it("says 'and 19 others' for twenty people — not 20, not 18", () => {
    const list = [{ id: "a", name: "Avijit Sheel" }, ...people(19)];
    show(list);
    expect(screen.getByText("Avijit Sheel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "19 others" })).toBeTruthy();
  });

  it("uses the singular for exactly one other", () => {
    show([{ id: "a", name: "Avijit Sheel" }, { id: "b", name: "Ravi" }]);
    expect(screen.getByRole("button", { name: "1 other" })).toBeTruthy();
  });

  it("opens the FULL list of twenty when the count is clicked", async () => {
    const list = [{ id: "a", name: "Avijit Sheel" }, ...people(19)];
    show(list);
    fireEvent.click(screen.getByRole("button", { name: "19 others" }));

    const dialog = await screen.findByRole("dialog");
    // The first name is IN the list. "19 others" means nineteen more people,
    // so a dialog of 19 would be the wrong set.
    expect(within(dialog).getByText("Avijit Sheel")).toBeTruthy();
    expect(within(dialog).getByText("Person 0")).toBeTruthy();
    expect(within(dialog).getByText("Person 18")).toBeTruthy();
    expect(within(dialog).getByText("Tagged (20)")).toBeTruthy();
  });

  it("links every name to that member's profile", () => {
    show([{ id: "abc123", name: "Avijit Sheel" }]);
    const link = screen.getByText("Avijit Sheel").closest("a");
    expect(link?.getAttribute("href")).toBe("/profile/abc123");
  });
});

describe("only tags the member AGREED to are ever shown", () => {
  /**
   * This one is a source check on purpose: the filter is in the data layer, not
   * in the component, and it is the rule with the worst failure mode. A pending
   * tag is a request nobody has answered and a declined tag is a refusal —
   * rendering either puts a person's name on a stranger's photo against their
   * wish, which is the entire reason the accept/decline flow exists.
   */
  it("the feed asks the database for approved tags only", () => {
    const src = readSource("src/hooks/feed/useFeedQuery.ts");
    const at = src.indexOf('.from("post_tags")');
    expect(at, "the feed no longer loads post_tags — did the query move?").toBeGreaterThan(-1);
    const query = src.slice(at, at + 260);
    expect(query).toMatch(/\.eq\("status",\s*"approved"\)/);
  });
});

// Kept at the bottom so the render tests above read cleanly.
function readSource(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require("node:path") as typeof import("node:path");
  return readFileSync(join(process.cwd(), p), "utf8");
}
