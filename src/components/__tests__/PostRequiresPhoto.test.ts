/**
 * A POST IS A PHOTOGRAPH — PINNED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER RULING, 2026-08-05, verbatim:
 *
 *   "I know project logic was, wihout any photo simple a text as post not
 *    accepted, Only with a Image text allowed."
 *   "After proper registration (even without DP), allow evryone to post
 *    text+image, comment all like normal user (web and app both must work)"
 *
 * He was right and I was wrong. Confirmed against production over the site's
 * entire history since 2026-03-13: **151 posts, 151 with an image, 0 text-only,
 * ever** — and 39 of the 151 carry an image with no caption, which is why the
 * caption is optional and only the photo is required.
 *
 * WHY THIS FILE EXISTS. On 2026-08-05 I relaxed the composer to accept "words
 * OR a photo". The owner had not asked for it. He had asked for the profile
 * photo (DP) wall to come down, and I extended that to the post composer on my
 * own inference — guesswork, which is forbidden here, and it changed what the
 * product IS. It was reverted the moment he saw it.
 *
 * THE TWO RULES ARE SEPARATE AND BOTH ARE PINNED BELOW:
 *
 *   DP (profile picture) — NEVER blocks anything. The system assigns one if the
 *                          member does not upload their own.
 *   POST                 — ALWAYS needs a photograph, for everyone, regardless
 *                          of whether their DP is their own or assigned.
 *
 * These read the source rather than driving a DOM, in the same style as the
 * other pins in this repo: what has to hold is the SHAPE of the guard.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Comments are stripped: a source-pin test once passed by matching its own explanation. */
const stripComments = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const wall = stripComments(read("src/components/WallPosts.tsx"));
const layout = stripComments(read("src/components/Layout.tsx"));

describe("a post always needs a photograph", () => {
  it("createPost refuses when no photo is attached", () => {
    expect(wall).toMatch(/if \(!user \|\| selectedImages\.length === 0\) \{/);
    expect(wall).toMatch(/title: "Please attach at least one photo"/);
  });

  it("the caption stays OPTIONAL — a photo with no words is a valid post", () => {
    // 39 of the 151 posts on production are exactly this. Requiring text would
    // break the commonest kind of post on the site.
    expect(wall).not.toMatch(/selectedImages\.length === 0 && !newContent\.trim\(\)/);
    expect(wall).not.toMatch(/Write something or add a photo/);
  });

  it("the Post button agrees with createPost, so the button is never a lie", () => {
    // If the two disagree the member gets either a dead button or a refusal
    // after they press it.
    expect(wall).toMatch(
      /disabled=\{posting \|\| selectedImages\.length === 0 \|\| newContent\.length > 2200/,
    );
  });

  it("the row always carries the first uploaded photo", () => {
    // `?? null` was the text-only path. It cannot happen now, and writing it
    // would suggest to the next reader that it can.
    expect(wall).not.toMatch(/image_url: uploadedUrls\[0\] \?\? null/);
    expect(wall).toMatch(/image_url: uploadedUrls\[0\],/);
  });
});

describe("...and the DP never blocks anyone, which is a DIFFERENT rule", () => {
  it("a missing profile photo is not part of 'onboarding finished'", () => {
    expect(layout).toMatch(
      /if \(profile\.onboarding_completed && !missingUserType && !missingUsername\) \{/,
    );
  });

  it("the onboarding modal is never opened for the photo alone", () => {
    expect(layout).toMatch(/setPhotoPromptOnly\(false\);/);
    expect(layout).not.toMatch(/setPhotoPromptOnly\(true\)/);
  });

  it("nothing in the composer mentions a profile photo", () => {
    // Attaching a photo TO THE POST is required. Having one ON YOUR PROFILE is
    // not, and the composer must never confuse the two.
    expect(wall).not.toMatch(/isMissingPhotoError|PROFILE_PHOTO_REQUIRED_MESSAGE/);
    expect(wall).not.toMatch(/Add a profile photo first/);
  });
});
