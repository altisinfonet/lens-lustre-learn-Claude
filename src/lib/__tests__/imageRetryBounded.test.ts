/**
 * THE AMPLIFIER, BOUNDED — behavioural tests, not source-reading ones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 2026-08-07: *"if same issues happens again and again then no point of
 * solving the issues from root level."*
 *
 * He was right. The SAME visible failure — search hangs, backspace does nothing,
 * the app freezes — was produced twice by two different image bugs (2026-08-05
 * recycled nodes, 2026-08-07 a guessed thumbnail address). Both times the
 * trigger was fixed and the amplifier was left intact, so the next image
 * mistake recreated the identical symptom.
 *
 * The amplifier: every failed image fired up to 2 extra requests, each with a
 * cache-busting `__r=` parameter that defeats all caching, with NOTHING limiting
 * how many ran at once. A feed of broken photos became hundreds of simultaneous
 * uncacheable requests — which is the freeze.
 *
 * The sibling file imageFallbackRecycle.test.ts pins the SHAPE of the guards by
 * reading the source. This one pins the BEHAVIOUR by driving real <img> elements
 * and real events, because "the app must not flood the network" is a claim about
 * what happens at runtime, and only running it can prove that.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import {
  installImageFallback,
  IMAGE_PLACEHOLDER,
  __resetRetryBudgetForTests,
} from "@/lib/imageFallback";

/** Mirrors the constants in imageFallback.ts. */
const MAX_CONCURRENT_RETRIES = 3;
const STORM_THRESHOLD = 10;
const FIRST_RETRY_DELAY_MS = 400;

/** Install exactly once — a second listener would double-count every failure. */
beforeAll(() => {
  installImageFallback();
});

beforeEach(() => {
  __resetRetryBudgetForTests();
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

/** A real <img> in the document, at a unique working-looking URL. */
function makeImage(n: number): HTMLImageElement {
  const img = document.createElement("img");
  img.src = `https://cdn.50mmretina.com/post-images/u/photo-${n}.webp`;
  document.body.appendChild(img);
  return img;
}

/** Fail an image the way the browser does: a non-bubbling error event. */
function fail(img: HTMLImageElement) {
  img.dispatchEvent(new Event("error"));
}

const isRetrying = (img: HTMLImageElement) => img.src.includes("__r=");
const isPlaceholder = (img: HTMLImageElement) => img.src === IMAGE_PLACEHOLDER;

describe("a burst of image failures cannot flood the network", () => {
  it("never has more than the cap of retry requests in flight at once", () => {
    // Eight failures at once — comfortably under the storm threshold, so every
    // one of them is legitimately entitled to a retry.
    const imgs = Array.from({ length: 8 }, (_, i) => makeImage(i));
    imgs.forEach(fail);

    vi.advanceTimersByTime(FIRST_RETRY_DELAY_MS + 10);

    // Before the fix this was 8 — every retry fired simultaneously, each one
    // cache-busting. That burst is the freeze.
    const inFlight = imgs.filter(isRetrying).length;
    expect(inFlight).toBe(MAX_CONCURRENT_RETRIES);
  });

  it("lets a queued retry through as soon as an earlier one settles", () => {
    const imgs = Array.from({ length: 8 }, (_, i) => makeImage(i));
    imgs.forEach(fail);
    vi.advanceTimersByTime(FIRST_RETRY_DELAY_MS + 10);
    expect(imgs.filter(isRetrying).length).toBe(MAX_CONCURRENT_RETRIES);

    // The first in-flight retry succeeds — its slot must go to a waiting image,
    // otherwise the queue stalls and images that could recover never do.
    const firstRunning = imgs.find(isRetrying)!;
    firstRunning.dispatchEvent(new Event("load"));

    expect(imgs.filter(isRetrying).length).toBe(MAX_CONCURRENT_RETRIES + 1);
  });

  it("does not leak slots when an image is removed while its retry waits", () => {
    const imgs = Array.from({ length: 8 }, (_, i) => makeImage(i));
    imgs.forEach(fail);
    // The feed scrolls and React unmounts the first three before their timers.
    imgs.slice(0, 3).forEach((i) => i.remove());

    vi.advanceTimersByTime(FIRST_RETRY_DELAY_MS + 10);

    // The three dead ones must release their slots to the ones still on screen.
    // A leak here would silently disable retrying for the rest of the session.
    expect(imgs.filter((i) => i.isConnected && isRetrying(i)).length).toBe(
      MAX_CONCURRENT_RETRIES,
    );
  });
});

describe("when everything is failing, retries stand down", () => {
  it("stops retrying once the storm threshold is crossed", () => {
    // A whole feed of broken photos — the 2026-08-07 situation exactly.
    const imgs = Array.from({ length: STORM_THRESHOLD + 6 }, (_, i) => makeImage(i));
    imgs.forEach(fail);

    // Images that failed AFTER the breaker tripped must go straight to the
    // placeholder, with no request at all.
    const late = imgs.slice(STORM_THRESHOLD);
    expect(late.every(isPlaceholder)).toBe(true);

    vi.advanceTimersByTime(FIRST_RETRY_DELAY_MS + 10);
    // And the total request count stays bounded by the cap, never by the
    // number of broken images.
    expect(imgs.filter(isRetrying).length).toBeLessThanOrEqual(
      MAX_CONCURRENT_RETRIES,
    );
  });

  it("a single failure on a healthy app still gets its retry — the rescue path is intact", () => {
    // The bound must not cost us the behaviour it was built around: one photo
    // lost to one dropped packet still recovers.
    const img = makeImage(1);
    fail(img);
    vi.advanceTimersByTime(FIRST_RETRY_DELAY_MS + 10);

    expect(isRetrying(img)).toBe(true);
    expect(isPlaceholder(img)).toBe(false);
  });

  it("still ends at the placeholder when an image is genuinely gone", () => {
    const img = makeImage(1);
    fail(img);
    vi.advanceTimersByTime(FIRST_RETRY_DELAY_MS + 10);
    fail(img); // retry 1 failed
    vi.advanceTimersByTime(1200 + 10);
    fail(img); // retry 2 failed — out of attempts
    expect(isPlaceholder(img)).toBe(true);
  });
});
