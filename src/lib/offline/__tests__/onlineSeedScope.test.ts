/**
 * S7b-3 carry review: on a desktop browser `navigator.onLine` can read false
 * while connected (VPNs, virtual adapters) and no "online" event ever follows,
 * so seeding React Query from it froze every query on the website. The seed is
 * for the installed app (Capacitor), where the WebView reports it reliably.
 * And: previews are fetched ahead only when the photo worker is there to keep
 * them (switch app_image_sw on) — otherwise it is mobile data for nothing.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";

afterEach(() => {
  onlineManager.setOnline(true);
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
  vi.resetModules();
});

function offlineNavigator() {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
}

describe("seedOnlineManager", () => {
  it("on the website: React Query is NOT told offline from navigator.onLine", async () => {
    offlineNavigator();
    const { seedOnlineManager } = await import("@/lib/offline/onlineSeed");
    seedOnlineManager();
    expect(onlineManager.isOnline()).toBe(true);
  });
  it("in the installed app: it is", async () => {
    offlineNavigator();
    (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
    const { seedOnlineManager } = await import("@/lib/offline/onlineSeed");
    seedOnlineManager();
    expect(onlineManager.isOnline()).toBe(false);
  });
});

describe("preview warm-up", () => {
  it("fetches nothing when no photo worker controls the page", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(""));
    const { memoryBackend, setBackend } = await import("@/lib/offline/deviceStore");
    setBackend(memoryBackend());
    const { recordFeedPage } = await import("@/lib/offline/feedArchive");
    await recordFeedPage("me", 0, [{ id: "p1", thumbnail_urls: ["https://cdn.example.com/t.jpg"] }], { saveDelayMs: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});
