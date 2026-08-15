/**
 * ALARMS FOR THE COMPOSER.
 *
 * Owner, 2026-08-15, approving this half: an Instagram-like posting experience,
 * with the scope stated plainly — **no new plugin, no new permission, nothing
 * that touches Play Store policy.**
 *
 * The reordering arithmetic gets the most attention here, and deliberately: an
 * off-by-one silently posts a member's photographs in the wrong order, or —
 * worse — posts the FILES in one order under the PREVIEWS of another. Nothing
 * on screen would look wrong. No screenshot would catch it. The member finds
 * out after publishing, which on a photography platform is the moment that
 * matters most.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PHOTOS, moveTarget, reorder } from "@/components/post/PostComposerPreview";

const root = process.cwd();
const SRC = readFileSync(join(root, "src/components/post/PostComposerPreview.tsx"), "utf8");
const WALL = readFileSync(join(root, "src/components/WallPosts.tsx"), "utf8");

describe("moveTarget — where a photo lands", () => {
  it("moves one step, in the direction asked", () => {
    expect(moveTarget(2, -1, 5)).toBe(1);
    expect(moveTarget(2, 1, 5)).toBe(3);
  });

  it("refuses to move off either end, rather than wrapping", () => {
    // Wrapping would send the cover photo to the back of the album with one
    // tap, which is the opposite of what the member asked for.
    expect(moveTarget(0, -1, 5)).toBeNull();
    expect(moveTarget(4, 1, 5)).toBeNull();
  });

  it("a single photo cannot move at all", () => {
    expect(moveTarget(0, -1, 1)).toBeNull();
    expect(moveTarget(0, 1, 1)).toBeNull();
  });
});

describe("reorder — the array arithmetic", () => {
  it("moves an item forward and closes the gap behind it", () => {
    expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(reorder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("swapping neighbours is exactly a swap — the commonest single tap", () => {
    expect(reorder(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(reorder(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("NEVER MUTATES the array it is given", () => {
    // React state is compared by reference. A mutating reorder would change
    // the data and NOT re-render — the member taps, nothing moves, and the
    // post goes out in the new order anyway.
    const original = ["a", "b", "c"];
    const result = reorder(original, 0, 2);
    expect(original).toEqual(["a", "b", "c"]);
    expect(result).not.toBe(original);
  });

  it("loses nothing and invents nothing, for every possible move", () => {
    const items = ["a", "b", "c", "d", "e"];
    for (let from = 0; from < items.length; from++) {
      for (let to = 0; to < items.length; to++) {
        const out = reorder(items, from, to);
        expect(out).toHaveLength(items.length);
        expect([...out].sort()).toEqual([...items].sort());
        expect(out[to]).toBe(items[from]); // the moved one is where it was sent
      }
    }
  });

  it("an out-of-range move is a no-op copy, not a crash or a hole", () => {
    expect(reorder(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(reorder([], 0, 0)).toEqual([]);
  });
});

describe("the two arrays move together, or a member's photos post under the wrong previews", () => {
  it("the wall reorders BOTH selectedImages and imagePreviews", () => {
    // They are aligned by index throughout WallPosts — the upload loop reads
    // imagePreviews[i] for selectedImages[i]. Reordering one and not the other
    // is invisible until after the post is published.
    const fn = WALL.slice(WALL.indexOf("const movePhoto"), WALL.indexOf("const movePhoto") + 700);
    expect(fn).toMatch(/setSelectedImages\(prev => reorder\(prev, from, to\)\)/);
    expect(fn).toMatch(/setImagePreviews\(prev => reorder\(prev, from, to\)\)/);
  });

  it("moving closes the crop dialog, because its index has just shifted", () => {
    const fn = WALL.slice(WALL.indexOf("const movePhoto"), WALL.indexOf("const movePhoto") + 700);
    expect(fn).toMatch(/setCropIndex\(null\)/);
  });

  it("removing a photo keeps the preview pointing at one that still exists", () => {
    const fn = WALL.slice(WALL.indexOf("const clearImage"), WALL.indexOf("const clearAllImages"));
    expect(fn).toMatch(/setPreviewIndex/);
  });
});

describe("the scope the owner set: no new permission, no new plugin", () => {
  it("imports nothing from @capacitor", () => {
    // A static @capacitor import here would also break the website build —
    // those packages exist only in the Android CI job.
    expect(SRC).not.toMatch(/@capacitor/);
  });

  it("asks for no device capability", () => {
    expect(SRC).not.toMatch(/navigator\.mediaDevices|getUserMedia|requestPermissions|showOpenFilePicker/);
  });

  it("still honours the app's 10-photo limit", () => {
    expect(MAX_PHOTOS).toBe(10);
    expect(WALL).toMatch(/imagePreviews\.length < 10 \?/);
  });
});

describe("what the preview promises", () => {
  it("shows the WHOLE photo — object-contain, never cover", () => {
    // A composer that crops is the thing this component exists to prevent: the
    // member would discover their own framing only after posting.
    expect(SRC).toMatch(/object-contain/);
    expect(SRC).not.toMatch(/object-cover/);
  });

  it("frames it with the SAME rule the feed uses, so the preview is true", () => {
    expect(SRC).toMatch(/frameAspectFor/);
    expect(SRC).toMatch(/from "@\/lib\/imageFrame"/);
  });

  it("the rule-of-thirds guide is decoration only — never part of the upload", () => {
    const guide = SRC.slice(SRC.indexOf('data-testid="thirds-guide"') - 300, SRC.indexOf('data-testid="thirds-guide"') + 400);
    expect(guide).toMatch(/aria-hidden/);
    expect(guide).toMatch(/pointer-events-none/);
    // Four lines: two vertical, two horizontal, at the thirds.
    expect(guide).toMatch(/left-1\/3/);
    expect(guide).toMatch(/left-2\/3/);
    expect(guide).toMatch(/top-1\/3/);
    expect(guide).toMatch(/top-2\/3/);
  });

  it("names the cover, because the first photo sets the frame for the album", () => {
    expect(SRC).toMatch(/Cover/);
  });
});

describe("a photo that will not load — found by looking at the screenshot", () => {
  /**
   * The first version covered the broken <img> with a translucent message and
   * left the element in the DOM. Chromium then drew its OWN torn-page glyph in
   * the corner, on top of everything, which on a photography app reads as
   * "your photograph is corrupt". It is not: an object URL was revoked.
   *
   * These pin the shape of the fix, because a later refactor that puts the
   * <img> back alongside the message would look correct in code review and
   * wrong on a phone.
   */
  it("removes the broken img instead of covering it", () => {
    // The message and the <img> are the two branches of one ternary, so they
    // can never both be on screen.
    expect(SRC).toMatch(/previewFailed \? \(/);
    // Search FROM the ternary, not from the top of the file: the thumbnail has
    // its own `) : (` earlier, and slicing to that gave an empty string — a
    // test that passes by examining nothing, which is the exact failure mode
    // this project spent a day paying for.
    const start = SRC.indexOf("previewFailed ? (");
    const failedBranch = SRC.slice(start, SRC.indexOf(") : (", start));
    expect(failedBranch.length).toBeGreaterThan(100);
    expect(failedBranch).toMatch(/could not be previewed/);
    expect(failedBranch).not.toMatch(/<img/);
  });

  it("remembers WHICH url failed, not merely that one did", () => {
    // A boolean survives the member tapping a different, perfectly good photo:
    // one bad file would make the whole album look broken. Keying on the url
    // makes the reset automatic and needs no effect.
    expect(SRC).toMatch(/const \[failedSrc, setFailedSrc\] = useState<string \| null>\(null\)/);
    expect(SRC).toMatch(/failedSrc === active/);
    expect(SRC).toMatch(/onError=\{\(\) => setFailedSrc\(active\)\}/);
  });

  it("hides the thirds guide — there is no photograph to compose", () => {
    // The guide lives inside the SUCCESS branch, after the ternary's `) : (`.
    const start = SRC.indexOf("previewFailed ? (");
    const okBranch = SRC.slice(SRC.indexOf(") : (", start));
    expect(okBranch).toMatch(/data-testid="thirds-guide"/);
    // ...and NOT in the failure branch, which is what actually matters.
    expect(SRC.slice(start, SRC.indexOf(") : (", start))).not.toMatch(/thirds-guide/);
  });

  it("hides Crop, because the crop editor reads the same url", () => {
    expect(SRC).toMatch(/\{!previewFailed && \(/);
    const guarded = SRC.slice(SRC.indexOf("{!previewFailed && ("), SRC.indexOf("{!previewFailed && (") + 500);
    expect(guarded).toMatch(/onCrop\(activeIndex\)/);
  });

  it("a thumbnail that will not load draws our mark, not the browser's", () => {
    expect(SRC).toMatch(/const \[failed, setFailed\] = useState\(false\)/);
    const thumb = SRC.slice(SRC.indexOf("const Thumb ="), SRC.indexOf("const PostComposerPreview"));
    expect(thumb).toMatch(/failed \? \(/);
    expect(thumb).toMatch(/onError=\{\(\) => setFailed\(true\)\}/);
    expect(thumb).toMatch(/ImageOff/);
  });
});
