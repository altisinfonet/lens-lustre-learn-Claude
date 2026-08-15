/**
 * ALARMS FOR THE BACK BUTTON.
 *
 * Owner, 2026-08-15: *"back option not working"*, then *"gesture back is not
 * also working"*. One defect, two symptoms — Android's back gesture and the
 * hardware button raise the same Capacitor `backButton` event.
 *
 * The cause is written up in docs/fix-sprints/owner-reported-3-bugs-2026-08-15.md:
 * an orphaned Radix layer keeps `data-state="open"` forever, the old handler saw
 * it, pressed Escape at nobody, and returned — so Back did NOTHING for the rest
 * of the session.
 *
 * These tests build that exact orphan out of real DOM nodes rather than mocking
 * the check, because a mock of `hasOpenOverlay` would have passed against the
 * broken code too.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handleBackPress,
  hasOpenOverlay,
  DISMISS_GRACE_MS,
} from "@/hooks/core/useAndroidBackButton";

/** Runs the scheduled re-check immediately, so no test waits 300 ms. */
const runNow = (fn: () => void) => { fn(); };

/** A Radix-shaped open dialog. Fresh node every time — the orphan WeakSet is
 *  keyed by node identity, so tests cannot contaminate each other. */
function mountOverlay(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "dialog");
  el.setAttribute("data-state", "open");
  document.body.appendChild(el);
  return el;
}

function spies() {
  return { navigateBack: vi.fn(), exitApp: vi.fn() };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("no overlay", () => {
  it("goes back one screen when the router has somewhere to go", () => {
    const s = spies();
    const out = handleBackPress({ canGoBack: () => true, schedule: runNow, ...s });
    expect(out).toBe("navigated");
    expect(s.navigateBack).toHaveBeenCalledTimes(1);
    expect(s.exitApp).not.toHaveBeenCalled();
  });

  it("leaves the app at the start, which is Android's convention", () => {
    const s = spies();
    const out = handleBackPress({ canGoBack: () => false, schedule: runNow, ...s });
    expect(out).toBe("exited");
    expect(s.exitApp).toHaveBeenCalledTimes(1);
    expect(s.navigateBack).not.toHaveBeenCalled();
  });
});

describe("a live overlay", () => {
  it("closes it and goes nowhere", () => {
    const el = mountOverlay();
    // A real Radix layer removes itself when Escape is not prevented.
    document.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") el.remove();
    }, { once: true });

    const s = spies();
    const out = handleBackPress({ canGoBack: () => true, schedule: runNow, ...s });

    expect(out).toBe("dismissing");
    expect(document.body.contains(el)).toBe(false);
    expect(s.navigateBack).not.toHaveBeenCalled();
    expect(s.exitApp).not.toHaveBeenCalled();
  });

  it("RESPECTS a refusal — a mandatory modal must not be navigated out from under", () => {
    // This is OnboardingModal while `dismissible` is false: it calls
    // e.preventDefault() in onEscapeKeyDown. If this test ever fails, the app
    // has started walking members out of onboarding with the back gesture.
    mountOverlay();
    document.addEventListener("keydown", (e) => e.preventDefault(), { once: true });

    const s = spies();
    const out = handleBackPress({ canGoBack: () => true, schedule: runNow, ...s });

    expect(out).toBe("refused");
    expect(s.navigateBack).not.toHaveBeenCalled();
    expect(s.exitApp).not.toHaveBeenCalled();
  });
});

describe("the orphaned overlay — the reported bug", () => {
  it("does NOT swallow the press: nobody listening means Back still navigates", () => {
    mountOverlay(); // no listener at all: this is the orphan
    const s = spies();

    const out = handleBackPress({ canGoBack: () => true, schedule: runNow, ...s });

    expect(out).toBe("dismissing");
    expect(s.navigateBack).toHaveBeenCalledTimes(1);
  });

  it("exits when the orphan is the only thing left and there is nowhere back to", () => {
    mountOverlay();
    const s = spies();
    handleBackPress({ canGoBack: () => false, schedule: runNow, ...s });
    expect(s.exitApp).toHaveBeenCalledTimes(1);
  });

  it("remembers the orphan, so the SECOND press is immediate and not deferred", () => {
    const el = mountOverlay();
    const first = spies();
    handleBackPress({ canGoBack: () => true, schedule: runNow, ...first });

    // Still in the DOM — we never rip a node out, same restraint as
    // unfreezeStuckOverlay.ts. It is simply no longer counted.
    expect(document.body.contains(el)).toBe(true);
    expect(hasOpenOverlay()).toBe(false);

    const second = spies();
    const out = handleBackPress({ canGoBack: () => true, schedule: runNow, ...second });
    expect(out).toBe("navigated");
    expect(second.navigateBack).toHaveBeenCalledTimes(1);
  });

  it("a REAL layer opening during the grace period still wins", () => {
    mountOverlay(); // orphan
    const s = spies();
    handleBackPress({
      canGoBack: () => true,
      schedule: (fn) => { mountOverlay(); fn(); }, // a genuine dialog appears meanwhile
      ...s,
    });
    expect(s.navigateBack).not.toHaveBeenCalled();
  });
});

describe("source-pinned decisions", () => {
  const src = readFileSync(
    join(process.cwd(), "src/hooks/core/useAndroidBackButton.ts"),
    "utf8",
  );

  it("never tests window.history.length — it only grows in a WebView, which made exitApp unreachable", () => {
    expect(src).not.toMatch(/window\.history\.length/);
  });

  it("counts the router's own pushes instead", () => {
    expect(src).toMatch(/navigationType === "PUSH"/);
    expect(src).toMatch(/navigationType === "POP"/);
  });

  it("keeps the grace period aligned with unfreezeStuckOverlay's 300 ms", () => {
    const unfreeze = readFileSync(
      join(process.cwd(), "src/lib/unfreezeStuckOverlay.ts"),
      "utf8",
    );
    const theirs = unfreeze.match(/GRACE_MS\s*=\s*(\d+)/);
    expect(theirs).not.toBeNull();
    expect(DISMISS_GRACE_MS).toBe(Number(theirs![1]));
  });

  it("never removes an overlay node — that turns a stuck Back into a white screen", () => {
    expect(src).not.toMatch(/\.remove\(\)\s*;?\s*\/\/\s*orphan/);
    expect(src).not.toMatch(/removeChild/);
  });
});
