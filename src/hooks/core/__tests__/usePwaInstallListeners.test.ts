/**
 * S11 runtime · usePwaInstall removed its beforeinstallprompt listener on
 * unmount but never its anonymous `appinstalled` one, so every mount (each
 * screen that shows the install card) left a listener behind that later called
 * setState on an unmounted component.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePwaInstall } from "@/hooks/core/usePwaInstall";

afterEach(() => vi.restoreAllMocks());

describe("usePwaInstall cleans up every window listener it adds", () => {
  it("add/remove calls balance per event type after mount + unmount, five times over", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const added = new Map<string, EventListenerOrEventListenerObject[]>();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    for (let i = 0; i < 5; i++) renderHook(() => usePwaInstall()).unmount();
    for (const [t, fn] of addSpy.mock.calls) {
      const type = String(t);
      if (type !== "beforeinstallprompt" && type !== "appinstalled") continue;
      added.set(type, [...(added.get(type) ?? []), fn!]);
    }
    expect(added.get("appinstalled")?.length).toBe(5);
    for (const [type, fns] of added) {
      for (const fn of fns) {
        expect(removeSpy.mock.calls.some(([t, f]) => String(t) === type && f === fn), `${type} listener never removed`).toBe(true);
      }
    }
  });

  it("appinstalled still marks the app installed while mounted", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.isInstalled).toBe(false);
    act(() => { window.dispatchEvent(new Event("appinstalled")); });
    expect(result.current.isInstalled).toBe(true);
  });
});
