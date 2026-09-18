/**
 * THE FOUR ITEMS THE AUDITOR MEASURED ON THE DEPLOYED PREVIEW, 2026-09-07.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * All four were reproduced with DOM/accessibility-tree checks on
 * https://0e30d46e.lens-lustre-learn-claude.pages.dev (tip 6bc9d2f) and then
 * reproduced again HERE, in real Chromium against this repository's own
 * harness, before any of them was touched:
 *
 *   1. /discover — 11 "Add Friend" and 11 "Remove" buttons announcing
 *      identically, plus ONE button on the page with no accessible name at all.
 *      Harness, 1440x900: 6 cards, 12 buttons, every one announcing "Add
 *      Friend" or "Remove" with nothing to tell them apart; 1 nameless button.
 *   2. People You May Know — 5 buttons reading "Add", aria-label null, 57x27,
 *      under the 44px floor. Harness: 3 buttons, "Add", null, 55.4x27.4.
 *   3. The @mention list, sliced by the clipping edge above it. Harness, on a
 *      post with no comments yet (where the composer sits at the top of the
 *      section, which is where a member writing the first comment stands):
 *      188px of a 308px list hidden — 61% — at BOTH 1440px and 390px.
 *   4. The feed lightbox running pre-fix code. NOT a regression in this branch:
 *      it is 23f0332 missing from the promotion branch. Measured as ALREADY
 *      PASSING here, which is the evidence that the fix exists and only the
 *      merge is outstanding — see the note at the bottom.
 *
 * ⚠ WHY THIS TEST READS SOURCE RATHER THAN RENDERING.
 *
 * The same reason MentionSuggestionsFitOnScreen.test.ts gives: jsdom reports
 * every element as 0 x 0 and computes no accessible name, so a rendered
 * assertion about a 44px hit region or a clipped popup would pass at any size
 * and prove nothing. The PIXEL proof lives in
 * `tools/uishot/a11y-four-items.mjs`, which drives real Chromium and fails on
 * the pre-fix code — 6 checks red before, 0 after.
 *
 * What THIS file is for is the regression that would return silently: someone
 * tidying an aria-label away, or putting the static `overflow-hidden` back on
 * a comments panel because it "looks like it belongs with the animation". Each
 * assertion below was shown failing against the unfixed files.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), "utf8"));

const discoverCard = read("src/components/discover/DiscoverCard.tsx");
const rightSidebar = read("src/components/FeedRightSidebar.tsx");
const bottomNav = read("src/components/MobileBottomNav.tsx");
const postComments = read("src/components/PostCommentsSection.tsx");
const imageEngagement = read("src/components/ImageEngagement.tsx");

/** Every `<button …>` opening tag in a file, attributes only. */
function buttonTags(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const start = src.indexOf("<button", i);
    if (start === -1) return out;
    // find the end of the opening tag, ignoring `>` inside braces
    let depth = 0;
    let end = -1;
    for (let j = start; j < src.length; j++) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) { end = j; break; }
    }
    if (end === -1) return out;
    out.push(src.slice(start, end + 1));
    i = end + 1;
  }
}

describe("item 1 — /discover: a control that acts on a person says which person", () => {
  const tags = buttonTags(discoverCard);

  it("DiscoverCard renders the buttons the Auditor counted", () => {
    // Add Friend, Request Sent, Accept, Unfriend, and three Remove buttons.
    expect(tags.length).toBe(7);
  });

  it("every one of them carries an aria-label", () => {
    const unnamed = tags.filter((t) => !/aria-label=/.test(t));
    expect(unnamed, `these buttons announce only their generic label:\n${unnamed.join("\n")}`).toEqual([]);
  });

  it("every label is built from the person, not from a literal", () => {
    // `named(...)` is the single helper; a hand-written string here would be a
    // label that cannot carry a name.
    for (const t of tags) {
      expect(t, `an aria-label that is not built from the person:\n${t}`).toMatch(/aria-label=\{named\(/);
    }
    expect(discoverCard).toMatch(/const personName = profile\.full_name \|\| "Photographer"/);
  });
});

describe("item 1b — the one button on the page with no accessible name", () => {
  it("MobileBottomNav's profile button is named", () => {
    const tags = buttonTags(bottomNav);
    // Exactly one <button> in this nav; the rest of the bar is links.
    expect(tags.length).toBe(1);
    expect(tags[0]).toMatch(/aria-label=/);
  });

  it("the icon-only tabs beside it are named too", () => {
    // Same cause, three lines away: the captions came off the screen on
    // 2026-08-10 and took the names out of the accessibility tree with them.
    const links = bottomNav.match(/<Link[\s\S]*?>/g) ?? [];
    const unnamed = links.filter((l) => !/aria-label=/.test(l));
    expect(unnamed, `icon-only nav links with no name:\n${unnamed.join("\n")}`).toEqual([]);
  });
});

describe("item 2 — People You May Know: the Add button", () => {
  const addButton = (() => {
    const tags = buttonTags(rightSidebar).filter((t) => /sendFriendRequest\(s\.id\)/.test(t));
    expect(tags.length, "the Add button moved — update this test").toBe(1);
    return tags[0];
  })();

  it("says whose row it is", () => {
    expect(addButton).toMatch(/aria-label=\{`\$\{t\("fr\.addFriend"\)\} — \$\{s\.full_name \|\| "Photographer"\}`\}/);
  });

  it("has a 44px hit region", () => {
    expect(addButton).toMatch(/className="tap-44 /);
  });

  it("uses the SYMMETRIC region, which is the measured choice here", () => {
    /*
     * F-109: the direction matters, and clearance is a claim to be measured.
     * It was measured — elementFromPoint 6px above and 6px below this button
     * returns the row, not a link, and the rect check in the Chromium probe
     * finds zero overlap between the enlarged region and any of the seven
     * links in this widget. `.tap-44-down` would push 17px past the bottom
     * edge into the divider, which is worse. This assertion exists so that
     * swapping one for the other is a deliberate act with a measurement
     * behind it rather than a tidy-up.
     */
    expect(addButton).not.toMatch(/tap-44-down/);
  });
});

describe("item 3 — the comments panel stops clipping once it has finished opening", () => {
  /*
   * ⚠ REWRITTEN 2026-09-13. THE GUARANTEE IS THE SAME; THE MECHANISM MOVED.
   *
   * This used to pin `rolling`/`setRolling`/`onAnimationComplete` in
   * PostCommentsSection. That state existed because the panel was a
   * height-animated strip INSIDE PostCard, and the clip had to be released
   * when the animation finished. The panel is not that any more: comments open
   * in a dedicated overlay (CommentsOverlay — a Dialog on web, a sheet on the
   * app) and PostCommentsSection is a three-band flex layout with NO animation
   * at all. There is nothing left to roll, so the assertion could never pass
   * again — it had been red on main and on staging for weeks, describing a
   * component that no longer exists.
   *
   * A stale assertion is worse than no assertion: it is a red test everyone
   * learns to expect, which is how a real failure gets waved through. But it is
   * NOT deleted — item 3 is a live guarantee, and it is re-pinned to the
   * mechanism that actually protects it now.
   *
   * MEASURED BEFORE REWRITING, not assumed. tools/uishot/a11y-four-items.mjs,
   * real Chromium, against this commit:
   *
   *   1440x900  reached, hidden 0px = 0%, clipper "fixed left-[50%] top-[50%]…"
   *    390x844  reached, hidden 0px = 0%, clipTop null (no clipping ancestor)
   *
   * and the REPLY box — which, unlike the composer, opens INSIDE the scrolling
   * band and is therefore the case this layout could plausibly have broken:
   *
   *   390px  rows 7, hidden 0px  ·  1440px  rows 7, hidden 0px
   *
   * ALL FOUR ITEMS CLEAR. Nothing was fixed here; only the guard was re-aimed.
   *
   * WHAT WOULD SILENTLY BRING THE 61%-CLIPPED LIST BACK is no longer a removed
   * `rolling` flag — it is moving the composer INSIDE the scrolling band. The
   * band is `overflow-y-auto`, and the @mention list opens UPWARD out of the
   * box, so a composer nested in it would be sliced by exactly the edge the
   * Auditor measured on 2026-09-07. `hideComposer` on CommentThread plus a
   * `shrink-0` sibling band is what keeps it out, and that is what is pinned.
   *
   * ImageEngagement is UNTOUCHED below: its panel is still the animated inline
   * strip, so `commentsRolling` is still the right thing to assert there. The
   * two panels genuinely differ now, and the test says so rather than pretending
   * they are one shape.
   */
  it("PostCommentsSection keeps the composer OUT of the scrolling band", () => {
    // The thread is told not to draw its own composer …
    expect(postComments).toMatch(/hideComposer/);
    // … because the panel renders one itself, as a sibling of the scroll band.
    expect(postComments).toMatch(/<CommentComposer\b/);

    const scrollIdx = postComments.indexOf("overflow-y-auto");
    const threadIdx = postComments.indexOf("<CommentThread");
    const composerIdx = postComments.indexOf("<CommentComposer");
    expect(scrollIdx, "the thread's band must still scroll").toBeGreaterThan(-1);
    expect(threadIdx, "the thread belongs inside the scrolling band").toBeGreaterThan(scrollIdx);
    expect(composerIdx, "the composer comes after the thread").toBeGreaterThan(threadIdx);

    /*
     * The structural half, and the one that actually catches the regression:
     * between the thread and the composer the scrolling band must CLOSE, and
     * the composer must sit in a `shrink-0` band of its own. Move the composer
     * inside the scroll container and both of these stop being true.
     */
    const between = postComments.slice(threadIdx, composerIdx);
    expect(between, "the scrolling band must close before the composer").toMatch(/<\/div>/);
    expect(between, "the composer's own band is shrink-0, not the scrolling one").toMatch(/shrink-0/);

    // And the band scrolls — it never hides. (The static-overflow-hidden guard
    // below covers the other direction, for both panels.)
    expect(postComments).toMatch(/flex-1 min-h-0 overflow-y-auto/);
  });

  it("ImageEngagement's panel does the same — the same box, one screen over", () => {
    expect(imageEngagement).toMatch(/const \[commentsRolling, setCommentsRolling\] = useState\(true\)/);
    expect(imageEngagement).toMatch(/onAnimationComplete=\{\(\) => setCommentsRolling\(false\)\}/);
    expect(imageEngagement).toMatch(/commentsRolling \? "overflow-hidden" : ""/);
  });

  it("neither panel carries a STATIC overflow-hidden any more", () => {
    /*
     * This is the assertion that catches the regression. `overflow-hidden`
     * reads as if it belongs beside a height animation — it is why it was
     * written that way in the first place — so the likeliest future edit is
     * someone putting it back into the className and leaving the state behind.
     * The panel would look identical and the @mention list would be sliced
     * again.
     */
    for (const [name, src] of [["PostCommentsSection", postComments], ["ImageEngagement", imageEngagement]] as const) {
      const staticClip = src.match(/className="[^"]*overflow-hidden[^"]*"/g) ?? [];
      expect(staticClip, `${name} has a static overflow-hidden back on a container:\n${staticClip.join("\n")}`).toEqual([]);
    }
  });

  it("the mention list is still IN FLOW — no portal, for a measured reason", () => {
    /*
     * react-mentions can portal the overlay to <body>, which escapes every
     * clipping ancestor at once. Rejected on a measurement: the overlay
     * carries zIndex 50, and this same composer renders inside
     * CompetitionLightbox — `fixed inset-0 z-[100]` — so at body level the
     * list would land underneath that viewer. That is the fault the owner
     * reported on 2026-08-31 ("options are hiding not coming in fornt"),
     * reintroduced one stacking context higher.
     */
    const mentionInput = read("src/components/MentionInput.tsx");
    expect(mentionInput).not.toMatch(/suggestionsPortalHost/);
    const lightbox = read("src/components/CompetitionLightbox.tsx");
    expect(lightbox).toMatch(/z-\[100\]/);
    expect(lightbox).toMatch(/ImageEngagement/);
  });
});

describe("item 4 — the lightbox fix is CARRIED, not rewritten", () => {
  /*
   * The Auditor's item 4 is that PostMedia.tsx's accessibility work "never made
   * it into this branch" — it is on d2/preview-a11y-five-20260907 as 23f0332,
   * and the promotion branch is still at its parent 6bc9d2f. The instruction
   * was explicit: "That fix needs to be merged into this branch, not redone
   * from scratch." So this branch is cut FROM 23f0332 and the work arrives by
   * ancestry — byte-identical, not retyped.
   *
   * These assertions are the receipt: if a rebase or a hand-merge ever drops
   * that commit, they go red here rather than on a member's screen.
   */
  const postMedia = read("src/components/post/PostMedia.tsx");

  it("the feed's own viewer is a dialog with a name", () => {
    expect(postMedia).toMatch(/role="dialog"/);
    expect(postMedia).toMatch(/aria-modal="true"/);
    expect(postMedia).toMatch(/aria-label=\{author\?\.name \?/);
  });

  it("its controls are named and the photographer is a link inside it", () => {
    expect(postMedia).toMatch(/aria-label="Close photo viewer"/);
    expect(postMedia).toMatch(/aria-label="Previous photo"/);
    expect(postMedia).toMatch(/aria-label="Next photo"/);
    expect(postMedia).toMatch(/ariaLabel="Download photo"/);
    expect(postMedia).toMatch(/<ProfileLink/);
  });
});
