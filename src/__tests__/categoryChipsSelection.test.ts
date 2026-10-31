/**
 * The 1–5 selection rule, tested as pure logic.
 *
 * This is the only thing enforcing the minimum until Stage B2 turns on
 * `POST-CAT-002`. If it breaks, uncategorised posts reach the database and
 * nothing stops them — so it is tested as behaviour, not as rendering.
 *
 * The rule, from the owner verbatim (2026-08-12):
 *   "once tap 5 - rest all will be grey no option to choose" … "if i need to
 *    see ful, then untapp anyone, full categories will be seen then tap 5"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toggleCategory, canPublishCategories } from "@/components/post/CategoryChips";
import { draftDaysLeft, DRAFT_EXPIRY_DAYS } from "@/hooks/feed/usePostDrafts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("selecting categories", () => {
  it("adds up to five", () => {
    let v: string[] = [];
    for (const s of ["wildlife", "portrait", "street", "landscape", "macro"]) {
      v = toggleCategory(v, s);
    }
    expect(v).toEqual(["wildlife", "portrait", "street", "landscape", "macro"]);
  });

  it("preserves the member's own order — it is not sorted", () => {
    // "the first one is the primary category" is an obvious future ask, and a
    // list that quietly reorders itself makes that impossible to build on.
    const v = toggleCategory(toggleCategory([], "street"), "aerial");
    expect(v).toEqual(["street", "aerial"]);
  });

  it("REFUSES a sixth, and returns the identical array so the caller sees a no-op", () => {
    const five = ["wildlife", "portrait", "street", "landscape", "macro"];
    const after = toggleCategory(five, "travel");
    expect(after).toEqual(five);
    // Identity, not just equality: a refused tap must not mark the draft dirty
    // or trigger a re-render.
    expect(after).toBe(five);
  });

  it("ALWAYS allows removal, including at the limit — the escape hatch", () => {
    // If this failed, the first five choices would be permanent with no way
    // back. This single assertion is the difference between a usable picker
    // and a trap.
    const five = ["wildlife", "portrait", "street", "landscape", "macro"];
    expect(toggleCategory(five, "portrait")).toEqual([
      "wildlife", "street", "landscape", "macro",
    ]);
  });

  it("untapping one immediately makes room for a different choice", () => {
    const five = ["wildlife", "portrait", "street", "landscape", "macro"];
    const four = toggleCategory(five, "portrait");
    const swapped = toggleCategory(four, "travel");
    expect(swapped).toHaveLength(5);
    expect(swapped).toContain("travel");
    expect(swapped).not.toContain("portrait");
  });

  it("removing then re-adding the same slug puts it last, not back in place", () => {
    const v = ["wildlife", "portrait", "street"];
    expect(toggleCategory(toggleCategory(v, "wildlife"), "wildlife"))
      .toEqual(["portrait", "street", "wildlife"]);
  });

  it("never duplicates a slug", () => {
    const v = toggleCategory(["portrait"], "portrait");
    expect(v).toEqual([]);
  });
});

describe("when publishing is allowed", () => {
  it("is refused at zero — the member is told before submitting, not after", () => {
    expect(canPublishCategories([])).toBe(false);
  });

  it("is allowed from one through five", () => {
    expect(canPublishCategories(["wildlife"])).toBe(true);
    expect(canPublishCategories(["a", "b", "c", "d", "e"])).toBe(true);
  });

  it("is refused above five", () => {
    expect(canPublishCategories(["a", "b", "c", "d", "e", "f"])).toBe(false);
  });
});

describe("the chip component honours the rule it renders", () => {
  const src = read("src/components/post/CategoryChips.tsx");

  it("disables only the UNSELECTED chips at the limit", () => {
    // `disabled={atLimit}` would trap the member. The bug is one word wide, so
    // it is asserted on the source rather than trusted to review.
    expect(src).toContain("const isDisabled = atLimit && !isSelected;");
    expect(src).not.toMatch(/disabled=\{atLimit\}/);
  });

  it("always shows the count", () => {
    expect(src).toContain("{value.length}/{MAX_POST_CATEGORIES}");
  });

  it("renders the translated name, never the slug", () => {
    // A slug is a storage key. `black-and-white` must never appear on screen.
    expect(src).toContain("t(categoryLabelKey(c.slug), c.name)");
    expect(src).not.toMatch(/>\{c\.slug\}</);
  });
});

describe("draft expiry is shown, not sprung", () => {
  it("is seven days", () => {
    expect(DRAFT_EXPIRY_DAYS).toBe(7);
  });

  it("counts down from the last edit", () => {
    const now = Date.parse("2026-08-12T00:00:00Z");
    expect(draftDaysLeft("2026-08-12T00:00:00Z", now)).toBe(7);
    expect(draftDaysLeft("2026-08-09T00:00:00Z", now)).toBe(4);
    expect(draftDaysLeft("2026-08-06T00:00:00Z", now)).toBe(1);
  });

  it("never goes negative, however stale the row", () => {
    const now = Date.parse("2026-08-12T00:00:00Z");
    expect(draftDaysLeft("2026-07-01T00:00:00Z", now)).toBe(0);
  });
});

describe("the drafts layer keeps its two safety properties", () => {
  const src = read("src/hooks/feed/usePostDrafts.ts");

  it("publishes through the RPC, never through two client statements", () => {
    // Two statements can half-fail and leave the same content both published
    // and still in Drafts.
    expect(src).toContain('rpc("publish_post_draft"');
    expect(src).not.toMatch(/from\("posts"\)[\s\S]{0,40}\.insert/);
  });

  it("autosave updates an existing draft and never creates one", () => {
    const update = src.slice(src.indexOf("export function useUpdateDraft"));
    const body = update.slice(0, update.indexOf("export function useDeleteDraft"));
    expect(body).toContain(".update(patch)");
    expect(body, "autosave must not be able to create a draft").not.toContain(".insert(");
  });

  it("invalidates every feed variant after publishing, not just All", () => {
    expect(src).toContain("queryKeys.feedAll()");
  });
});
