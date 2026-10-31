import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

describe("stale chunk after a deploy — the tab recovers by itself", () => {
  let reload: ReturnType<typeof vi.fn>;
  let added: [string, EventListenerOrEventListenerObject][] = [];
  beforeEach(() => {
    vi.resetModules();
    added = [];
    const orig = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => {
      added.push([t, l]);
      return orig(t, l, o as AddEventListenerOptions);
    });
    sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => {
    for (const [t, l] of added) window.removeEventListener(t, l);
    vi.restoreAllMocks();
  });

  it("is installed at app start (main.tsx calls installStaleChunkReload before rendering)", () => {
    const main = fs.readFileSync(path.join(ROOT, "src/main.tsx"), "utf8");
    expect(main).toMatch(/import \{ installStaleChunkReload \} from "\.\/lib\/staleChunkReload";/);
    const call = main.indexOf("installStaleChunkReload();");
    expect(call).toBeGreaterThan(0);
    expect(call).toBeLessThan(main.indexOf("createRoot("));
  });

  it("a failed chunk (vite:preloadError) reloads once and cancels the error; a second failure inside the cooldown does not loop and is NOT cancelled", async () => {
    const { installStaleChunkReload } = await import("@/lib/staleChunkReload");
    installStaleChunkReload();
    const e1 = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(e1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(e1.defaultPrevented).toBe(true);
    const e2 = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(e2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(e2.defaultPrevented).toBe(false); // the error boundary shows its RELOAD screen
  });

  it("a rejected dynamic import that is a stale chunk reloads; any other rejection is left alone", async () => {
    const { installStaleChunkReload } = await import("@/lib/staleChunkReload");
    installStaleChunkReload();
    const other = new Event("unhandledrejection", { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(other, "reason", { value: new TypeError("x is undefined") });
    window.dispatchEvent(other);
    expect(reload).not.toHaveBeenCalled();
    const stale = new Event("unhandledrejection", { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(stale, "reason", { value: new TypeError("Failed to fetch dynamically imported module: https://x/assets/A-1.js") });
    window.dispatchEvent(stale);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("installing twice adds no second set of listeners", async () => {
    const { installStaleChunkReload } = await import("@/lib/staleChunkReload");
    installStaleChunkReload();
    const once = added.length;
    installStaleChunkReload();
    expect(once).toBe(3);
    expect(added.length).toBe(once);
  });
});
