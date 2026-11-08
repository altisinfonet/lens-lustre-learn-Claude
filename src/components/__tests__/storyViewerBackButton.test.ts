// @vitest-environment jsdom
/**
 * Owner, 8 Nov 2026: "When seeing Stories - back it - closing the App why??"
 *
 * The Android Back key first closes any open layer (useAndroidBackButton:
 * openOverlays). The story viewer is a full-screen layer but carried only
 * role="dialog" — the selector also needs data-state="open" — so Back on the
 * feed found no layer, could not go back, and EXITED the app. Both viewer
 * bodies (phone and computer) now carry data-state="open".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleBackPress } from "@/hooks/core/useAndroidBackButton";

const viewer = readFileSync(join(process.cwd(), "src/components/stories/StoryViewer.tsx"), "utf8");

describe("Android Back closes a story, not the app", () => {
  it("both story viewer bodies mark themselves as an open layer", () => {
    const bodies = viewer.match(/role="dialog" aria-modal="true" data-state="open" aria-label="Story"/g) ?? [];
    expect(bodies.length).toBe(2);
  });

  it("Back on the feed with a story open asks the story to close instead of exiting", () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true" data-state="open" aria-label="Story"></div>';
    let exited = false;
    let escapes = 0;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") escapes++; };
    document.addEventListener("keydown", onKey);
    const outcome = handleBackPress({
      canGoBack: () => false,
      navigateBack: () => {},
      exitApp: () => { exited = true; },
      schedule: () => {}, // the viewer closes on Escape; the orphan check is not needed here
    });
    document.removeEventListener("keydown", onKey);
    expect(outcome).toBe("dismissing");
    expect(escapes).toBe(1);
    expect(exited).toBe(false);
  });
});
