/**
 * THE APP COMPOSER SHOWS THE POST, NOT A THUMBNAIL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-16, with the web composer open beside his phone:
 *
 *   "this page must come afte image pic king"
 *
 * On the website, picking photos shows the composer: the picture at the size
 * it will actually publish, a rule-of-thirds guide, Crop, a cover badge, and
 * reorder. On the APP it showed a 160x160 square and nothing else — no crop,
 * no cover choice, no reorder, no sight of the framing.
 *
 * On a photography platform that is the screen that matters, and the phone is
 * where nearly every member posts from.
 *
 * WHY IT HAPPENED, recorded rather than glossed: the owner chose a two-screen
 * Android flow on 2026-08-12 so the app would use Android's own photo picker
 * instead of a gallery grid we draw ourselves. That was right, and it stands.
 * Collapsing screen 2 down to a thumbnail was NOT part of that decision — it
 * was a shortcut, and it silently removed the framing step from the app.
 *
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST: reaching that screen needs
 * `@capacitor/camera` to return a photo from a native gallery. There is no
 * native gallery in a headless container, so no test here can drive the real
 * flow. What CAN be proven is the wiring: that the app branch renders the same
 * component the web renders. The pixels are proven separately by the
 * `composer-single` and `composer-album` screenshot scenes, which photograph
 * that component directly.
 *
 * WHAT THIS TEST CANNOT CATCH, stated so nobody trusts it further than it
 * deserves: a source pin reads TEXT, not behaviour. Verified by mutation —
 * DELETING the composer from the app branch fails three of these tests, but
 * disabling it with `{false && <PostComposerPreview …>}` passes them all,
 * because the string is still on the page. Only a screenshot could catch that,
 * and reaching this screen needs a native gallery that does not exist in a
 * headless container. If this screen ever regresses in a way these tests miss,
 * that is the hole it went through.
 *
 * The rule being defended is the owner's, set on 2026-08-15 after a post
 * rendered two different ways depending on where it was opened: ONE FUNNEL.
 * If the app and the web draw the same thing, they draw it with the same code,
 * or they drift apart again — which is exactly what happened here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const src = stripComments(
  readFileSync(join(process.cwd(), "src/components/WallPosts.tsx"), "utf8"),
);

/**
 * The `appFlow ? ( … ) : ( … )` branch that draws the post on screen 2.
 * Sliced from the ternary itself rather than grepping the whole file, so a
 * match somewhere else in a 2000-line component cannot satisfy these checks.
 */
const appBranch = (() => {
  const start = src.indexOf("{appFlow ? (");
  expect(start, "the appFlow ternary moved — update this test").toBeGreaterThan(-1);
  const end = src.indexOf("<div className=\"divide-y divide-border", start);
  expect(end, "the settings rows after the branch moved").toBeGreaterThan(start);
  return src.slice(start, end);
})();

describe("the app composer renders the real composer", () => {
  it("uses PostComposerPreview — the SAME component the website renders", () => {
    expect(appBranch).toContain("<PostComposerPreview");
  });

  it("passes it every control: reorder, remove, crop, add more", () => {
    // A preview that cannot be reordered is a picture, not a composer. The
    // FIRST photo is the cover and sets the frame for the whole album, so
    // reordering is the single most important one here.
    for (const prop of ["onMove=", "onRemove=", "onCrop=", "onAddMore=", "activeIndex="]) {
      expect(appBranch, `PostComposerPreview is missing ${prop}`).toContain(prop);
    }
  });

  it("no longer shows a bare 160px thumbnail for freshly picked photos", () => {
    // `h-40 w-40` was the whole of the old app composer. It may still appear
    // for a RESUMED DRAFT — those are stored URLs with no local File to
    // preview — but never for `imagePreviews`, which is what the picker fills.
    const thumbAt = appBranch.indexOf("h-40 w-40");
    if (thumbAt !== -1) {
      const around = appBranch.slice(Math.max(0, thumbAt - 400), thumbAt);
      expect(
        around,
        "a 160px thumbnail is being used for freshly picked photos again",
      ).toMatch(/resumedThumbs|resumedUrls/);
      expect(around).not.toMatch(/imagePreviews\[0\]/);
    }
  });

  it("keeps the caption box, which only the app has here", () => {
    // The web wrote its caption on the previous screen; the app arrives
    // straight from Android's picker and has never seen one. Removing this
    // would leave no way to write a caption at all.
    expect(appBranch).toContain("post.caption");
  });
});

describe("one funnel — the app cannot grow its own composer", () => {
  it("WallPosts imports the shared composer, not a local reimplementation", () => {
    expect(src).toMatch(/import PostComposerPreview.*from "@\/components\/post\/PostComposerPreview"/);
  });

  it("both call sites are the SAME component, not two implementations", () => {
    /**
     * My first version of this asserted ONE call site and failed at 2. The
     * test was wrong, not the code: `appFlow ? ( … ) : ( … )` is two BRANCHES
     * of one component, and each has to render the composer in its own place.
     * Two call sites of ONE shared component is exactly right.
     *
     * What must never happen is two IMPLEMENTATIONS — which is the failure the
     * owner caught on 2026-08-15, when a post rendered one way in the feed and
     * another way from his wall. So the count is pinned (a third site means
     * somebody added a surface without thinking) and the import is pinned
     * above, which together mean every site is the same component.
     */
    const uses = src.match(/<PostComposerPreview/g) ?? [];
    expect(uses.length, "expected the app branch and the web branch, no more").toBe(2);

    const localCopy = /(function|const)\s+\w*ComposerPreview\w*\s*[=(]/.test(src);
    expect(localCopy, "WallPosts has grown its own composer — one funnel").toBe(false);
  });
});
