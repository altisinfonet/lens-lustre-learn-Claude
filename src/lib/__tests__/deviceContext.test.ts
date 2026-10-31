/**
 * Device facts attached to an upload failure. Owner instruction, 2026-08-06:
 * every failure must carry the app build, the Android version and the device.
 *
 * Nothing here may identify a person — model and OS describe hardware.
 */
import { describe, it, expect, afterEach } from "vitest";
import { deviceContext } from "@/lib/deviceContext";

const setUA = (ua: string) =>
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

const ORIGINAL = navigator.userAgent;
afterEach(() => setUA(ORIGINAL));

describe("device context", () => {
  it("reads the Android version and model out of the User-Agent", () => {
    setUA("Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
    const d = deviceContext();
    expect(d.androidVersion).toBe("14");
    expect(d.deviceModel).toBe("SM-A546E");
  });

  it("does not invent a model when Android froze it for privacy", () => {
    // Android 13+ sends the literal "K" in place of the model. Recording that
    // as a device would be a made-up value, which the owner's rules forbid.
    setUA("Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
    const d = deviceContext();
    expect(d.androidVersion).toBe("13");
    expect(d.deviceModel).toBeNull();
  });

  it("returns nulls rather than throwing off Android", () => {
    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36");
    const d = deviceContext();
    expect(d.androidVersion).toBeNull();
    expect(d.deviceModel).toBeNull();
    expect(d.runtime).toBe("web");
  });

  it("never throws — it is called from inside failure handlers", () => {
    setUA("");
    expect(() => deviceContext()).not.toThrow();
  });

  it("carries the build marker, so a log names the code that produced it", () => {
    (window as any).__APP_BUILD = "2026-08-06-7";
    expect(deviceContext().appBuild).toBe("2026-08-06-7");
  });
});
