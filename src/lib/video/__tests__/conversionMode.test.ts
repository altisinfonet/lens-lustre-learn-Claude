/**
 * Server conversion · where a new video is prepared (site_settings
 * 'video_conversion'), as the app reads it and the admin writes it:
 *   • the read goes through the shared site-settings cache — ONE key, at most
 *     a minute old — never a table read of its own (P4: "No unfiltered
 *     site_settings read in src/", scripts/web-site-settings-guard.mjs);
 *   • anything but the exact word "server" is the device (the safe default);
 *   • the guard passes on the two new files and goes red when their key
 *     filter is removed (fail-first on the real code, C-34).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { scanText } from "../../../../scripts/web-site-settings-guard.mjs";

const asked: Array<{ key: string; opts: unknown }> = [];
let stored: unknown = "device";
let throws = false;
vi.mock("@/lib/siteSettingsCache", () => ({
  getSiteSetting: async (key: string, opts: unknown) => {
    asked.push({ key, opts });
    if (throws) throw new Error("boom");
    return stored;
  },
  invalidateSiteSetting: () => {},
}));

import { CONVERSION_MAX_AGE_MS, parseConversionMode, readConversionMode, VIDEO_CONVERSION_KEY } from "../conversionMode";

beforeEach(() => { asked.length = 0; stored = "device"; throws = false; });

describe("the conversion mode, as the app reads it", () => {
  it("reads ONE key through the shared cache, at most a minute old", async () => {
    stored = "server";
    expect(await readConversionMode()).toBe("server");
    expect(asked).toEqual([{ key: "video_conversion", opts: { maxAgeMs: 60_000 } }]);
    expect(VIDEO_CONVERSION_KEY).toBe("video_conversion");
    expect(CONVERSION_MAX_AGE_MS).toBe(60_000);
  });

  it("anything but the exact word \"server\" is the device", () => {
    for (const v of ["device", null, undefined, "", "SERVER", " server", { mode: "server" }, true, 1]) expect(parseConversionMode(v)).toBe("device");
    expect(parseConversionMode("server")).toBe("server");
  });

  it("an unset or unreadable setting is the device — today's behaviour", async () => {
    stored = null;
    expect(await readConversionMode()).toBe("device");
    throws = true;
    expect(await readConversionMode()).toBe("device");
  });
});

type V = { rule: string };
describe("P4 guard on the new code", () => {
  const files = ["src/lib/video/conversionMode.ts", "src/lib/admin/videoConversion.ts", "src/components/admin/video/AdminVideoConversion.tsx"];

  it.each(files)("%s reads site_settings only by key", (path) => {
    expect(scanText(readFileSync(path, "utf8"), path)).toEqual([]);
  });

  it("the admin read goes red when its key filter is removed (the guard sees this code)", () => {
    const path = "src/lib/admin/videoConversion.ts";
    const real = readFileSync(path, "utf8");
    const mutated = real.replace(/\.eq\("key",\s*VIDEO_CONVERSION_KEY\)/, "");
    expect(mutated).not.toBe(real);
    expect((scanText(mutated, path) as V[]).map((v) => v.rule)).toEqual(["unfiltered-read"]);
  });
});
