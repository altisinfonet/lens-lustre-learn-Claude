/**
 * CREDIT U3 (review of #881): a new photo has no credited file until the server
 * sweep has run. Arming the save target then points the <img> at a missing
 * `-r2048c`. It must fall back to the clean picture the way ZoomableImage does,
 * and that missing file is not a broken photo: the global retrier must not
 * replace it with the placeholder, or a member's photo turns into a grey box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armCreditedSave } from "@/lib/photoSaveTarget";
import { installImageFallback } from "@/lib/imageFallback";

const SHOWN = "https://cdn.test/post-images/u/posts/a-w1080h810-l5.webp";
const FEED_1X = `${SHOWN} 1080w`;
let n = 0;
/** A file of its own per test: a failed file is remembered for a minute. */
const creditedUrl = () => `https://cdn.test/post-images/u/posts/a${++n}-w1080h810-l5-r2048c.webp?cv=4`;

function shownImage(src = SHOWN): HTMLImageElement {
  const img = document.createElement("img");
  img.setAttribute("src", src);
  img.setAttribute("srcset", FEED_1X);
  img.setAttribute("sizes", "100vw");
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: 1080, configurable: true });
  Object.defineProperty(img, "currentSrc", { get: () => img.getAttribute("src") ?? "", configurable: true });
  document.body.appendChild(img);
  return img;
}

beforeEach(() => { vi.useFakeTimers(); installImageFallback(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("armCreditedSave when the credited file is missing", () => {
  it("arms normally: the credited file is the <img>'s source", () => {
    const img = shownImage("https://cdn.test/one-w10h10-l5.webp");
    armCreditedSave(img, "https://cdn.test/one-w10h10-l5-r2048c.webp");
    expect(img.getAttribute("src")).toBe("https://cdn.test/one-w10h10-l5-r2048c.webp");
    expect(img.hasAttribute("srcset")).toBe(false);
  });

  it("an error puts the clean picture back exactly: src, srcset, sizes, no layering left", () => {
    const img = shownImage();
    armCreditedSave(img, creditedUrl());
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe(SHOWN);
    expect(img.getAttribute("srcset")).toBe(FEED_1X);
    expect(img.getAttribute("sizes")).toBe("100vw");
    expect(img.dataset.saveAs).toBeUndefined();
    expect(img.style.backgroundImage).toBe("");
    expect(img.style.objectPosition).toBe("");
  });

  it("the global retrier leaves a missing credited file alone: no retry, no placeholder", () => {
    const img = shownImage();
    armCreditedSave(img, creditedUrl());
    img.dispatchEvent(new Event("error"));
    expect(img.dataset.retryCount).toBeUndefined();
    vi.advanceTimersByTime(5000);
    expect(img.getAttribute("src")).toBe(SHOWN);
    expect(img.dataset.fallbackApplied).toBeUndefined();
  });

  it("does not ask for the same missing file again on the next press, but does after a minute (the sweep may have run)", () => {
    const missing = "https://cdn.test/two-w10h10-l5-r2048c.webp";
    const img = shownImage();
    armCreditedSave(img, missing);
    img.dispatchEvent(new Event("error"));
    armCreditedSave(img, missing);
    expect(img.getAttribute("src")).toBe(SHOWN);
    vi.advanceTimersByTime(61_000);
    armCreditedSave(img, missing);
    expect(img.getAttribute("src")).toBe(missing);
  });

  it("an error after React gave the element another source is not this file's: nothing is reverted", () => {
    const img = shownImage();
    armCreditedSave(img, "https://cdn.test/three-w10h10-l5-r2048c.webp");
    img.setAttribute("src", "https://cdn.test/other.webp");
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).not.toBe(SHOWN);
    expect(img.dataset.saveAs).toBeDefined();
  });
});
