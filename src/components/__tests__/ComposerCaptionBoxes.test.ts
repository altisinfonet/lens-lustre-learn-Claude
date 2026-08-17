/**
 * THE COMPOSER'S TWO CAPTION BOXES, PINNED.
 *
 * Both of the faults these tests guard were live in production and neither was
 * visible in a screenshot, which is why they are asserted on the source.
 *
 *  1. The app's caption box had no ref. `useCaptionMentions` reads
 *     `textareaRef`, so on a phone it was reading a textarea that was not on
 *     screen — the @mention list has never once appeared there.
 *  2. The @mention list markup existed only under the web composer's textarea.
 *     Even with a ref, the app had nothing to draw.
 *
 * The two boxes are mutually exclusive by STEP — the web box is in
 * `composerStep === "compose"`, the app box in `composerStep === "settings"`,
 * and the website's settings step has no caption box at all — which is what
 * makes ONE ref correct rather than a shortcut. Two hook instances would have
 * split the picked-mention list in half, and only the instance a name was
 * picked from can convert "@Name" into `@[Name](id)` at submit time. The
 * dropdown would have looked fixed while the tag posted as plain text.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "..", "WallPosts.tsx"), "utf8");

describe("both caption boxes are wired to the same caption machinery", () => {
  it("has exactly two caption textareas and both carry the shared ref", () => {
    expect(SRC.match(/ref=\{textareaRef\}/g) ?? []).toHaveLength(2);
  });

  it("has no second, app-only ref — that is the shape that split the picks", () => {
    expect(SRC).not.toContain("appTextareaRef");
    expect(SRC).not.toContain("appCaptionHashtags");
  });

  it("draws the @mention list under BOTH boxes, from one definition", () => {
    expect(SRC.match(/\{mentionList\}/g) ?? []).toHaveLength(2);
    // One definition, not two copies of the markup.
    expect(SRC.match(/const mentionList =/g) ?? []).toHaveLength(1);
  });

  it("draws the #hashtag list under both boxes too", () => {
    expect(SRC.match(/<HashtagSuggestions/g) ?? []).toHaveLength(2);
  });
});

/**
 * THE CROP DIALOG MUST NOT DISMISS THE COMPOSER.
 *
 * Owner, 2026-08-17: "If anyone click crop and upload, option for Tag and
 * select category screen is not opening, directly lightbox disappearing."
 *
 * Traced with a stack trace out of the browser, not by reading:
 *
 *   closeComposer <- onOpenChange <- onDismiss <- usePointerDownOutside
 *
 * The crop dialog is rendered OUTSIDE the composer's Radix Dialog on purpose —
 * that is the 1.2.10 fix for the frozen crop screen, because Radix makes
 * everything inside the dialog's inert region untouchable. The cost, unnoticed
 * for two releases: every press inside the crop dialog is a press OUTSIDE the
 * composer, so Radix read "Crop & Upload" as clicking away and dismissed the
 * composer. The photo cropped correctly and then had nowhere to go.
 *
 * The live proof is tools/uishot/repro-crop-upload.mjs, which drives the real
 * composer and fails without these guards (mutation-tested both ways). This
 * test is the cheap sentry that runs on every commit.
 */
describe("the composer survives the crop dialog", () => {
  it("refuses outside-dismissal while a crop dialog is open", () => {
    expect(SRC).toMatch(/onInteractOutside=\{\(e\) => \{ if \(cropIndex !== null\)/);
    expect(SRC).toMatch(/onPointerDownOutside=\{\(e\) => \{ if \(cropIndex !== null\)/);
  });

  it("gives Escape to the topmost dialog, not to both at once", () => {
    expect(SRC).toMatch(/onEscapeKeyDown=\{\(e\) => \{ if \(cropIndex !== null\)/);
  });

  it("keeps the crop dialog outside the composer dialog — do not 'tidy' this", () => {
    // If someone moves <ImageCropModal> inside <DialogContent> to make the
    // guards above unnecessary, the crop screen goes back to being frozen.
    const cropAt = SRC.indexOf("<ImageCropModal");
    const dialogAt = SRC.indexOf("<Dialog open={composerOpen}");
    expect(cropAt).toBeGreaterThan(0);
    expect(cropAt).toBeLessThan(dialogAt);
  });
});
