import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  exitMetrics,
  reportNativeExits,
  EXIT_BUILD_KEY,
  EXIT_SINCE_KEY,
  MAX_EXITS_PER_START,
  type ExitInfoPlugin,
} from "@/lib/native/exitReasons";
import { installNativePlugins, PACKAGE_DIR } from "../../../../scripts/android-native-plugins.mjs";

const ROOT = path.resolve(__dirname, "../../../..");
const JAVA = path.join(ROOT, "resources/android/java/com/fiftymmretina/app/ExitInfoPlugin.java");

function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const plugin = (exits: unknown, supported = true): ExitInfoPlugin => ({ recent: async () => ({ supported, exits }) });

describe("S2 native exits — the OS record becomes telemetry metrics", () => {
  it("maps crash / native crash / on-screen OOM / ANR; skips background OOM, other reasons and old records", () => {
    const { metrics, newest } = exitMetrics(
      [
        { reason: "anr", timestamp: 500 },
        { reason: "crash", timestamp: 300 },
        { reason: "low_memory", timestamp: 400, foreground: false },
        { reason: "low_memory", timestamp: 450, foreground: true },
        { reason: "crash_native", timestamp: 350 },
        { reason: "user_requested", timestamp: 600 },
        { reason: "crash", timestamp: 100 }, // before `since`
        null,
        { reason: "crash", timestamp: "x" },
      ],
      200,
    );
    expect(metrics).toEqual(["app.exit.crash", "app.exit.crash_native", "app.exit.low_memory", "app.exit.anr"]);
    expect(newest).toBe(600);
  });

  it("caps a crash loop at MAX_EXITS_PER_START rows", () => {
    const many = Array.from({ length: 16 }, (_, i) => ({ reason: "crash", timestamp: 1000 + i }));
    expect(exitMetrics(many, 0).metrics).toHaveLength(MAX_EXITS_PER_START);
  });

  it("first run: remembers now and the build, reports nothing", async () => {
    const s = mem();
    const rec = vi.fn();
    const n = await reportNativeExits("v1133", rec, plugin([{ reason: "crash", timestamp: 5 }]), s, () => 777);
    expect(n).toBe(0);
    expect(rec).not.toHaveBeenCalled();
    expect(s.m.get(EXIT_SINCE_KEY)).toBe("777");
    expect(s.m.get(EXIT_BUILD_KEY)).toBe("v1133");
  });

  it("credits a new exit to the build that was running, then never reports it twice", async () => {
    const s = mem({ [EXIT_SINCE_KEY]: "100", [EXIT_BUILD_KEY]: "v1132" });
    const rec = vi.fn();
    const p = plugin([{ reason: "crash_native", timestamp: 150 }, { reason: "crash", timestamp: 90 }]);
    expect(await reportNativeExits("v1133", rec, p, s)).toBe(1);
    expect(rec).toHaveBeenCalledWith("app.exit.crash_native", "v1132");
    expect(s.m.get(EXIT_SINCE_KEY)).toBe("150");
    expect(s.m.get(EXIT_BUILD_KEY)).toBe("v1133");
    rec.mockClear();
    expect(await reportNativeExits("v1133", rec, p, s)).toBe(0);
    expect(rec).not.toHaveBeenCalled();
  });

  it("never throws: no plugin, unsupported Android, a rejecting plugin, a broken storage", async () => {
    const rec = vi.fn();
    const s = mem({ [EXIT_SINCE_KEY]: "1" });
    expect(await reportNativeExits("v1", rec, null, s)).toBe(0);
    expect(await reportNativeExits("v1", rec, plugin([{ reason: "crash", timestamp: 9 }], false), s)).toBe(0);
    expect(await reportNativeExits("v1", rec, { recent: () => Promise.reject(new Error("x")) }, s)).toBe(0);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(await reportNativeExits("v1", rec, plugin([]), broken)).toBe(0);
    expect(rec).not.toHaveBeenCalled();
  });
});

describe("S2 native exits — Java plugin contract (the names JS reads are the names Java writes)", () => {
  const java = fs.readFileSync(JAVA, "utf8");
  it("is the ExitInfo plugin with a recent() method", () => {
    expect(java).toMatch(/@CapacitorPlugin\(name = "ExitInfo"\)/);
    expect(java).toMatch(/@PluginMethod\s+public void recent\(PluginCall call\)/);
    expect(java).toContain("package com.fiftymmretina.app;");
  });
  it("returns supported / exits and each exit's reason / timestamp / foreground", () => {
    for (const k of ["supported", "exits", "reason", "timestamp", "foreground"]) expect(java).toContain(`put("${k}"`);
  });
  it("emits exactly the four reasons JS maps", () => {
    const reasons = [...java.matchAll(/return "([a-z_]+)";/g)].map((m) => m[1]).sort();
    expect(reasons).toEqual(["anr", "crash", "crash_native", "low_memory"]);
    for (const r of reasons) expect(exitMetrics([{ reason: r, timestamp: 2, foreground: true }], 1).metrics).toEqual([`app.exit.${r}`]);
  });
});

describe("S2 native exits — the build step that puts the plugin into the app", () => {
  function project(main: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s2-android-"));
    fs.mkdirSync(path.join(dir, PACKAGE_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, PACKAGE_DIR, "MainActivity.java"), main);
    return dir;
  }
  const TEMPLATE = "package com.fiftymmretina.app;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n";

  it("copies the plugin and registers it before super.onCreate; a second run changes nothing", () => {
    const dir = project(TEMPLATE);
    installNativePlugins(dir);
    const main = fs.readFileSync(path.join(dir, PACKAGE_DIR, "MainActivity.java"), "utf8");
    expect(fs.existsSync(path.join(dir, PACKAGE_DIR, "ExitInfoPlugin.java"))).toBe(true);
    expect(main.indexOf("registerPlugin(ExitInfoPlugin.class);")).toBeGreaterThan(0);
    expect(main.indexOf("registerPlugin(ExitInfoPlugin.class);")).toBeLessThan(main.indexOf("super.onCreate("));
    installNativePlugins(dir);
    expect(fs.readFileSync(path.join(dir, PACKAGE_DIR, "MainActivity.java"), "utf8")).toBe(main);
  });

  it("refuses a MainActivity it does not recognise, and a missing project", () => {
    const dir = project("package com.fiftymmretina.app;\npublic class MainActivity extends BridgeActivity { void x() {} }\n");
    expect(() => installNativePlugins(dir)).toThrow(/not Capacitor's template/);
    expect(() => installNativePlugins(path.join(os.tmpdir(), "no-such-android-dir"))).toThrow(/not found/);
  });
});
