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

describe("the keyboard can send too", () => {
  it("asks Android for a Send key", () => {
    // Before this change the input carried no enterKeyHint, so the keyboard
    // offered a plain newline and the 24px button was the ONLY way to send.
    expect(src).toMatch(/enterKeyHint="send"/);
  });
});
