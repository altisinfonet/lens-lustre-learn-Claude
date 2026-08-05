/**
 * THE VERSION BESIDE LOGOUT MUST BE THE REAL ONE — PINNED.
 *
 * Owner, 2026-08-05: "…show app version so that user can understand
 * 1050 (1.2.2) … what is the current app version loaded".
 *
 * The rule these tests hold: each surface shows ITS OWN real number —
 * the app shows versionCode (versionName), the web shows its deploy stamp —
 * and when nothing real is available the label is EMPTY, never invented.
 * A wrong version on this row would send the next debugging session to the
 * wrong build, which is precisely the confusion the row exists to end.
 */
import { describe, it, expect, afterEach } from "vitest";
import { getAppVersionLabel } from "@/lib/appVersion";

type AnyWindow = Window & {
  Capacitor?: unknown;
  __APP_BUILD?: string;
};

const w = window as AnyWindow;
const originalBuild = w.__APP_BUILD;

afterEach(() => {
  delete w.Capacitor;
  if (originalBuild === undefined) delete w.__APP_BUILD;
  else w.__APP_BUILD = originalBuild;
});

describe("in the app (Capacitor native)", () => {
  it("shows versionCode (versionName), e.g. 1052 (1.2.2)", async () => {
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { getInfo: async () => ({ build: "1052", version: "1.2.2" }) },
      },
    };
    expect(await getAppVersionLabel()).toBe("1052 (1.2.2)");
  });

  it("shows just the build when versionName is missing", async () => {
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { App: { getInfo: async () => ({ build: "1052" }) } },
    };
    expect(await getAppVersionLabel()).toBe("1052");
  });

  it("shows NOTHING when the App plugin is absent — never a made-up number", async () => {
    w.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    expect(await getAppVersionLabel()).toBe("");
  });

  it("shows NOTHING when getInfo throws", async () => {
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: {
          getInfo: async () => {
            throw new Error("bridge dead");
          },
        },
      },
    };
    expect(await getAppVersionLabel()).toBe("");
  });
});

describe("on the web", () => {
  it("shows the web deploy stamp, not a fake versionCode", async () => {
    w.__APP_BUILD = "2026-08-05-1";
    expect(await getAppVersionLabel()).toBe("2026-08-05-1");
  });

  it("shows NOTHING when no stamp is set", async () => {
    delete w.__APP_BUILD;
    expect(await getAppVersionLabel()).toBe("");
  });
});
