/**
 * THE SEND BUTTON HAS TO BE BIG ENOUGH TO HIT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on production 2026-08-03
 *
 * The owner reported that sending a comment in the installed app "is not working
 * fully". I typed into the real comment box on 50mmretina.com and measured the
 * button's bounding box:
 *
 *     tap target   24 x 24 px      (16 px icon + 4 px padding)
 *     icon         16 x 16 px
 *
 * Android's minimum touch target is 48 dp. iOS's is 44 pt. WCAG 2.5.5 (AAA) asks
 * for 44 x 44 CSS px; WCAG 2.2's 2.5.8 (AA) sets the absolute floor at 24 x 24 —
 * so the button was sitting EXACTLY on the legal minimum and at half of what
 * Android asks for, 8 px from the edge of a 36 px pill.
 *
 * An adult thumb contact patch is roughly 45 px across. People were not
 * mis-tapping through carelessness; the target was smaller than their finger.
 *
 * Two further defects in the same eight lines:
 *
 *   - no `type` attribute, so it defaulted to `type="submit"`. Harmless today
 *     because no comment box sits inside a <form> — a latent page reload the
 *     first time one does.
 *   - `onClick` only. This codebase already knows the Android WebView can fail
 *     to deliver a click after a tap that dismisses the keyboard — GlobalSearch
 *     uses `pointerdown` for exactly that reason. This button never got it.
 *
 * One component, MentionInput, backs all eight comment boxes in the app (feed,
 * post comments, replies, image engagement), so one fix covers every one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This test reads the source rather than rendering, deliberately: jsdom reports
 * every element as 0 x 0, so a render-based assertion on size would be
 * meaningless and would pass no matter how small the button got.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/components/MentionInput.tsx"), "utf8");

/** The send button's JSX, comments stripped so a mention in prose cannot satisfy a check. */
const buttonJsx = (() => {
  const start = src.indexOf("showSendButton && value.trim()");
  expect(start, "the send button block moved — update this test").toBeGreaterThan(-1);
  return src
    .slice(start, src.indexOf("</button>", start))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
})();

/** Tailwind h-11/w-11 = 2.75rem = 44px. h-4/w-4 = 1rem = 16px. */
const REM = 4; // px per Tailwind unit
const sizeOf = (cls: "h" | "w") => {
  const m = buttonJsx.match(new RegExp(`\\b${cls}-(\\d+)\\b`));
  return m ? Number(m[1]) * REM : 0;
};

describe("the comment send button is reachable with a thumb", () => {
  it("is at least 44px in both directions", () => {
    // 44 = iOS minimum and WCAG 2.5.5 AAA. Android asks 48dp; 44 is the
    // compromise that still sits cleanly on a 36px input pill.
    expect(sizeOf("h"), "send button height").toBeGreaterThanOrEqual(44);
    expect(sizeOf("w"), "send button width").toBeGreaterThanOrEqual(44);
  });

  it("keeps the icon small — the target grew, the design did not", () => {
    expect(buttonJsx).toMatch(/<Send className="h-4 w-4"/);
  });

  it("is type=button, so it can never submit a surrounding form", () => {
    expect(buttonJsx).toMatch(/type="button"/);
  });

  it("fires on pointerdown as well as click, for the Android WebView", () => {
    expect(buttonJsx).toMatch(/onPointerDown=/);
    expect(buttonJsx).toMatch(/onClick=/);
  });

  it("cannot post the same comment twice when both events arrive", () => {
    // The two handlers must share a guard. Without it, pointerdown + click on a
    // desktop browser would post a comment twice.
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(body).toMatch(/sentRef/);
    expect(body).toMatch(/onSubmit\(\)/);
  });

  it("does not let typed text run underneath the button", () => {
    // Right padding on the input must clear the 44px button. react-mentions
    // overlays `input` and `highlighter`, so the two paddings must be identical
    // or every @mention pill drifts out of alignment.
    const paddings = [...src.matchAll(/padding:\s*showSendButton \? "8px (\d+)px 8px 16px"/g)].map(
      (m) => Number(m[1]),
    );
    expect(paddings, "expected an input padding and a highlighter padding").toHaveLength(2);
    expect(paddings[0]).toBe(paddings[1]);
    expect(paddings[0]).toBeGreaterThanOrEqual(sizeOf("w"));
  });
});

describe("the box is multi-line, the way Instagram's is", () => {
  it("is a textarea, not a single-line input", () => {
    // react-mentions renders <input type="text"> when `singleLine` is set and
    // <textarea> when it is not. Instagram, Facebook and WhatsApp all use a
    // textarea for comments. Owner's decision, 2026-08-03.
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(body).not.toMatch(/^\s*singleLine\s*$/m);
  });

  it("pins lineHeight identically on the input and the highlighter", () => {
    // THE TRAP. react-mentions overlays the textarea on the highlighter, and
    // the highlighter — being in normal flow — is what sets the box height.
    // Before this change lineHeight was set on the highlighter ONLY. On one
    // line that is invisible; the moment the text wraps, every @mention pill
    // drifts out of alignment and the measured height is wrong.
    const lineHeights = [...src.matchAll(/lineHeight:\s*"(\d+)px"/g)].map((m) => Number(m[1]));
    expect(lineHeights, "expected a lineHeight on both input and highlighter").toHaveLength(2);
    expect(lineHeights[0]).toBe(lineHeights[1]);
  });

  it("caps its height so a long comment cannot push the composer off screen", () => {
    // The field accepts 2200 characters. Uncapped, that is a very tall box.
    //
    // Scoped to the style block BEFORE `suggestions:` on purpose — the @mention
    // dropdown has its own maxHeight and is a different thing. An earlier draft
    // of this test scooped that up and failed for the wrong reason.
    const boxStyles = src.slice(
      src.indexOf("control: {"),
      src.indexOf("suggestions: {"),
    );
    const caps = [...boxStyles.matchAll(/maxHeight:\s*"(\d+)px"/g)].map((m) => Number(m[1]));
    expect(caps.length, "expected a cap on the control and on the highlighter").toBe(2);
    expect(new Set(caps).size, "the two caps must agree or the overlay drifts").toBe(1);
  });

  it("keeps the send button on the last line, not floating in the middle", () => {
    // Centred was fine while the box was 36px tall. Now that it grows, a
    // centred button would sit in the middle of a paragraph.
    expect(buttonJsx).toMatch(/bottom-0/);
    expect(buttonJsx).not.toMatch(/top-1\/2/);
  });

  it("anchors the button to the FIELD, not to the wrapper", () => {
    // CAUGHT IN A RENDERED SCREENSHOT, not by reading the code.
    //
    // The wrapper contains the field AND the character counter. While
    // `relative` sat on the wrapper, `bottom-0` resolved to the bottom of the
    // whole wrapper, so the send button hung outside the pill, below its
    // bottom-right corner. It looked broken and no unit test noticed, because
    // jsdom has no layout.
    //
    // The fix is a `relative` div wrapping ONLY the field. These assertions pin
    // that structure.
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // the outer wrapper must NOT be the positioning context
    expect(body).toMatch(/className=\{`flex-1 mention-input-wrapper \$\{className\}`\}/);
    expect(body).not.toMatch(/className=\{`relative flex-1 mention-input-wrapper/);

    // ...and a relative box must sit between the wrapper and the field
    const wrapperAt = body.indexOf("mention-input-wrapper");
    const relativeAt = body.indexOf('<div className="relative">', wrapperAt);
    const fieldAt = body.indexOf("<MentionsInput", wrapperAt);
    expect(relativeAt, "expected a relative div after the wrapper").toBeGreaterThan(wrapperAt);
    expect(relativeAt, "the relative div must come BEFORE the field").toBeLessThan(fieldAt);

    // the counter must live OUTSIDE that relative box, or it is inside the
    // button's positioning context again
    const counterAt = body.indexOf("/ {maxLength}");
    const closeAt = body.lastIndexOf("</div>", counterAt);
    expect(closeAt, "the relative box must close before the counter").toBeGreaterThan(fieldAt);
  });
});

describe("the keyboard behaves like Instagram's", () => {
  it("does NOT label the return key 'Send'", () => {
    // Deliberate reversal, 2026-08-03. enterKeyHint="send" was correct while
    // the box was single-line and the 24px button was unusable. Now Enter
    // inserts a new line on touch, so a key labelled "Send" would lie.
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(body).not.toMatch(/enterKeyHint/);
  });

  it("capitalises the first letter of a comment", () => {
    expect(src).toMatch(/autoCapitalize="sentences"/);
  });

  it("only submits on Enter when the pointer is not a finger", () => {
    // Phones have no Shift key. If Enter posted on touch, a member could never
    // write a second line — which would defeat the whole point of the change.
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(body).toMatch(/\(pointer:\s*coarse\)/);
    expect(body).toMatch(/if\s*\(isTouch\(\)\)\s*return/);
    expect(body).toMatch(/if\s*\(e\.shiftKey\)\s*return/);
  });
});
