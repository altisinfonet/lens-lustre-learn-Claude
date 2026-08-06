import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * BUILD 1055 — the app-only pinch-zoom lock.
 *
 * The owner's requirement has TWO halves and the second is the one that is
 * easy to lose: *"no pinch zoom … inside the app"* AND *"do not affect
 * desktop, do not affect normal mobile web."* A change that locked zoom
 * everywhere would satisfy every manual test he can run on his handset and
 * would still be wrong — it would take an accessibility control away from
 * every visitor to the website. That is what the second case here exists for.
 */

vi.mock("@/lib/native/authDeepLink", () => ({
  isNativeCapacitorApp: vi.fn(),
}));

import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import {
  installZoomPolicy,
  __resetZoomPolicyForTests,
  ZOOM_LOCK_CLASS,
} from "@/lib/native/zoomPolicy";

const mockedIsNative = vi.mocked(isNativeCapacitorApp);

describe("installZoomPolicy", () => {
  beforeEach(() => {
    __resetZoomPolicyForTests();
    mockedIsNative.mockReset();
  });

  it("locks pinch-zoom inside the installed app", () => {
    mockedIsNative.mockReturnValue(true);
    installZoomPolicy();
    expect(document.documentElement.classList.contains(ZOOM_LOCK_CLASS)).toBe(true);
  });

  it("LEAVES THE WEB ALONE — a visitor's zoom is their accessibility control", () => {
    mockedIsNative.mockReturnValue(false);
    installZoomPolicy();
    expect(document.documentElement.classList.contains(ZOOM_LOCK_CLASS)).toBe(false);
  });

  it("is idempotent, so a second call site cannot double-apply or fight the first", () => {
    mockedIsNative.mockReturnValue(true);
    installZoomPolicy();
    installZoomPolicy();
    installZoomPolicy();
    expect(
      document.documentElement.className.split(/\s+/).filter((c) => c === ZOOM_LOCK_CLASS),
    ).toHaveLength(1);
  });

  it("never throws — it runs during boot, before anything can catch for it", () => {
    mockedIsNative.mockImplementation(() => {
      throw new Error("Capacitor bridge not ready");
    });
    expect(() => installZoomPolicy()).not.toThrow();
    expect(document.documentElement.classList.contains(ZOOM_LOCK_CLASS)).toBe(false);
  });
});
