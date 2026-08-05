/**
 * THE SEARCH REGRESSION, PINNED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-05, within the hour of the image-retry shipping:
 *
 *   "search whatever we have developped all malfucnting, app hang after a
 *    search, backspace not working, after selecting a person that profile not
 *    opening all 100 problems that solved - again same issues repreated"
 *
 * CAUSE — mine. `installImageFallback()` kept its retry bookkeeping in `data-*`
 * attributes on the `<img>` element. React reuses those elements: a search box
 * re-renders its result list on every keystroke and hands the same node a
 * different person's photo. React does not clear `data-*` it did not set, so
 * the previous occupant's state carried over:
 *
 *   * `fallbackApplied="1"` sent a perfectly healthy new photo straight to the
 *     grey placeholder;
 *   * a pending 400 ms / 1200 ms timer fired after the node was recycled and
 *     wrote the OLD person's URL onto the NEW person's avatar;
 *   * every retry uses a `__r=` cache-busting parameter, so on a phone one fast
 *     word typed into search became a burst of uncacheable image requests —
 *     the hang.
 *
 * These tests read the source rather than driving a DOM, in the same style as
 * the other pins in this repo, because what has to hold is the SHAPE of the
 * guard: state keyed on the URL, and a stale-timer check before writing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/lib/imageFallback.ts"), "utf8");

describe("retry state follows the IMAGE, not the element", () => {
  it("resets the bookkeeping when the element is given a different url", () => {
    // Without this, a recycled node inherits "already gave up" from whoever
    // used it last.
    expect(src).toMatch(/const liveSrc = stripRetryParam\(img\.currentSrc \|\| img\.src\);/);
    expect(src).toMatch(
      /if \(img\.dataset\.originalSrc && img\.dataset\.originalSrc !== liveSrc\) \{/,
    );
    expect(src).toMatch(/delete img\.dataset\.originalSrc;/);
    expect(src).toMatch(/delete img\.dataset\.retryCount;/);
    expect(src).toMatch(/delete img\.dataset\.fallbackApplied;/);
  });

  it("stores the ORIGINAL url with our retry parameter stripped", () => {
    // Storing the raw src would make attempt 2 compare unequal to attempt 1,
    // reset the counter every time, and retry forever.
    expect(src).toMatch(/img\.dataset\.originalSrc = liveSrc;/);
    expect(src).toMatch(/function stripRetryParam\(url: string\): string \{/);
    expect(src).toMatch(/u\.searchParams\.delete\(RETRY_PARAM\);/);
  });

  it("a pending retry is dropped if the node was recycled while it waited", () => {
    // This is the line that stops the old person's photo overwriting the new
    // person's. It must re-read the dataset, not trust the closure.
    expect(src).toMatch(/if \(img\.dataset\.originalSrc !== original\) return;/);
  });

  it("still gives up after a bounded number of attempts", () => {
    expect(src).toMatch(/const MAX_RETRIES = 2;/);
    expect(src).toMatch(/const RETRY_DELAYS_MS = \[400, 1200\];/);
    // The guard must sit BEFORE the give-up check, or a recycled node can
    // never recover.
    const resetAt = src.indexOf("delete img.dataset.fallbackApplied;");
    const giveUpAt = src.indexOf('if (img.dataset.fallbackApplied === "1") return;');
    expect(resetAt).toBeGreaterThan(-1);
    expect(giveUpAt).toBeGreaterThan(resetAt);
  });
});
