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

describe("a tag is public the moment it is made, and removable for ever", () => {
  /**
   * Owner ruling, 2026-08-10 — his SECOND answer, which replaced the first:
   *
   *   "Show immediately to public, but tagged person only can remove my Tag
   *    anytime."
   *
   * The two halves have to ship together. Publishing pending tags WITHOUT the
   * remove control would put a member's name on a stranger's photo with no way
   * to take it off — anyone may tag anyone. These pin both halves.
   */
  const feed = readSource("src/hooks/feed/useFeedQuery.ts");
  const wall = readSource("src/hooks/feed/useUserPostsQuery.ts");
  const card = readSource("src/components/post/PostCard.tsx");
  const policy = readSource("supabase/migrations/20260810180000_pending_tags_are_public.sql")
    .replace(/^\s*--.*$/gm, "");

  for (const [label, src] of [["feed", feed], ["wall", wall]] as const) {
    it(`${label}: reads pending AND approved tags`, () => {
      const at = src.indexOf('.from("post_tags")');
      expect(at, `${label} no longer loads post_tags — did the query move?`).toBeGreaterThan(-1);
      const q = src.slice(at, at + 400);
      expect(q).toMatch(/\.in\("status",\s*\["pending",\s*"approved"\]\)/);
    });

    it(`${label}: never reads a declined or removed tag`, () => {
      // Those two are refusals, and the accept/decline flow exists so a refusal
      // sticks. This is the assertion that must never be relaxed.
      const at = src.indexOf('.from("post_tags")');
      const q = src.slice(at, at + 400);
      expect(q).not.toContain("declined");
      expect(q).not.toContain("removed");
    });
  }

  it("the database policy publishes pending, and still hides refusals", () => {
    expect(policy).toMatch(/USING \(status IN \('approved', 'pending'\)\)/);
    expect(policy, "a blanket USING (true) would expose refusals").not.toMatch(/USING \(true\)/);
    expect(policy).not.toMatch(/'declined'/);
    expect(policy).not.toMatch(/'removed'/);
  });

  it("a tagged member can remove their own tag, on any status", () => {
    // No .eq("status", ...) on the update: the whole point is that removal
    // works after acceptance too, not only while the tag is pending.
    const at = card.indexOf("const removeMyTag");
    expect(at, "removeMyTag is gone — the owner's rule needs it").toBeGreaterThan(-1);
    const fn = card.slice(at, at + 900);
    expect(fn).toMatch(/\.update\(\{ status: "removed" \}\)/);
    expect(fn).toMatch(/\.eq\("tagged_user_id", currentUserId\)/);
    expect(fn, "removal must not be limited to pending tags").not.toMatch(/\.eq\("status"/);
  });

  it("tells the member when a removal changed nothing", () => {
    // A write that succeeds but changes zero rows is the signature of an RLS
    // refusal. Silence there would look like success while the name stayed put.
    const at = card.indexOf("const removeMyTag");
    const fn = card.slice(at, at + 1400);
    expect(fn).toMatch(/data\.length === 0/);
  });

  it("offers the control only to someone actually tagged", () => {
    expect(card).toMatch(/const viewerIsTagged = Boolean\(/);
    // Signed out there is no id, and an undefined id must not match anything.
    expect(card).toMatch(/currentUserId && \(post\.tagged_people \?\? \[\]\)\.some/);
    expect(card).toContain("Remove tag of me");
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

/**
 * THE SPACE BEFORE "with" IS A FLEX GAP, NOT A TEXT NODE.
 *
 * Owner, 2026-08-11, with a Facebook post beside ours: "After verification tick
 * check the space, while FB reference is also given nicely line space
 * maintained. you did wrong". The header read
 * "50mm Retina World(tick)with AVIJIT SHEEL".
 *
 * TaggedPeople DID open with a {" "} for exactly this. It never rendered,
 * because PostCard's header is a flex container and that space was the first
 * thing inside its own flex item, where CSS collapses it. A text node cannot
 * carry spacing across a flex boundary.
 *
 * If someone "tidies up" gap-x-1 out of that container, the names run into the
 * tick again and this fails.
 */
describe("the header breathes between the tick and the tag phrase", () => {
  const card = readFileSync(join(process.cwd(), "src/components/post/PostCard.tsx"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  const tagged = readFileSync(join(process.cwd(), "src/components/post/TaggedPeople.tsx"), "utf8");

  it("spaces the name block from the tag phrase with a horizontal gap", () => {
    expect(card).toContain('className="flex flex-wrap items-center gap-x-1 min-w-0 text-sm"');
  });

  it("uses gap-x only, so a wrapped tag phrase does not change line spacing", () => {
    expect(card).not.toContain("flex flex-wrap items-center gap-1 min-w-0 text-sm");
  });

  it("no longer relies on a leading space that CSS throws away", () => {
    expect(tagged).not.toContain('{" "}with{" "}');
    expect(tagged).toContain('with{" "}');
  });
});
