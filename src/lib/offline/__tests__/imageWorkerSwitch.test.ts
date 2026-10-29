/**
 * S7b-1b · the photo-saving worker has a remote switch, and it is OFF unless
 * the Owner says otherwise (site_settings key `app_image_sw`).
 *
 * Owner rule: never switch a feature on without the Owner. So:
 *   · value "on"               → the worker is registered;
 *   · row absent, or any other → NOT registered, the photo worker is
 *     unregistered and its gallery-images-* caches are deleted;
 *   · the switch could not be READ (flight mode, a dead link) → nothing is
 *     touched. "Unknown" is not "off": wiping the saved photos when there is no
 *     network would destroy exactly what offline needs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  rows: [] as { key: string; value: unknown }[],
  error: null as { message: string } | null,
  throws: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async () => {
          if (db.throws) throw new TypeError("Failed to fetch");
          return { data: db.rows, error: db.error };
        },
      }),
    }),
  },
}));

const settings = await import("@/lib/siteSettingsCache");
const { IMAGE_SW_SETTING, imageSwitchFrom, readImageWorkerSwitch, applyImageWorkerSwitch } = await import(
  "@/lib/offline/imageWorkerRegistration"
);

beforeEach(() => {
  db.rows = [];
  db.error = null;
  db.throws = false;
  settings.invalidateSiteSetting();
});

describe("reading the switch: known vs unknown", () => {
  it("the key is app_image_sw", () => {
    expect(IMAGE_SW_SETTING).toBe("app_image_sw");
  });

  it("no row is a KNOWN answer: off", async () => {
    expect(await settings.readSiteSettingState(IMAGE_SW_SETTING)).toEqual({ known: true, value: null });
    expect(await readImageWorkerSwitch()).toBe("off");
  });

  it('"on" turns it on; "off" and anything else is off', async () => {
    db.rows = [{ key: IMAGE_SW_SETTING, value: "on" }];
    expect(await readImageWorkerSwitch()).toBe("on");
    expect(imageSwitchFrom({ known: true, value: "off" })).toBe("off");
    expect(imageSwitchFrom({ known: true, value: true })).toBe("off");
    expect(imageSwitchFrom({ known: true, value: { enabled: true } })).toBe("off");
    expect(imageSwitchFrom({ known: true, value: " ON " })).toBe("on");
  });

  it("a read that failed (offline) is UNKNOWN, never off", async () => {
    db.throws = true;
    expect(await settings.readSiteSettingState(IMAGE_SW_SETTING)).toEqual({ known: false, value: null });
    expect(await readImageWorkerSwitch()).toBe("unknown");
    db.throws = false;
    db.error = { message: "permission denied" };
    settings.invalidateSiteSetting();
    expect(await readImageWorkerSwitch()).toBe("unknown");
  });
});

function fakeEnv(registered: string[], cacheNames: string[]) {
  const unregistered: string[] = [];
  const deleted: string[] = [];
  const registeredUrls: string[] = [];
  const regs = registered.map((scriptURL) => ({
    active: { scriptURL },
    unregister: vi.fn(async () => { unregistered.push(scriptURL); return true; }),
  }));
  return {
    unregistered, deleted, registeredUrls,
    deps: {
      register: vi.fn(async (url: string) => { registeredUrls.push(url); }),
      getRegistrations: async () => regs as unknown as ReadonlyArray<ServiceWorkerRegistration>,
      cacheKeys: async () => cacheNames.slice(),
      deleteCache: async (n: string) => { deleted.push(n); return true; },
    },
  };
}

describe("acting on the switch", () => {
  const url = "/sw-image-cache.js?cdn=cdn.example.com";
  const sw = "https://www.50mmretina.com/sw-image-cache.js?cdn=cdn.example.com";
  const other = "https://www.50mmretina.com/push-worker.js";

  it("on: registers the worker, removes nothing", async () => {
    const e = fakeEnv([], ["gallery-images-v3"]);
    expect(await applyImageWorkerSwitch("on", url, e.deps)).toBe("registered");
    expect(e.registeredUrls).toEqual([url]);
    expect(e.unregistered).toEqual([]);
    expect(e.deleted).toEqual([]);
  });

  it("off: not registered; ONLY the photo worker unregistered; ONLY gallery-images-* deleted", async () => {
    const e = fakeEnv([sw, other], ["gallery-images-v3", "gallery-images-v2", "something-else"]);
    expect(await applyImageWorkerSwitch("off", url, e.deps)).toBe("removed");
    expect(e.deps.register).not.toHaveBeenCalled();
    expect(e.unregistered).toEqual([sw]);
    expect(e.deleted.sort()).toEqual(["gallery-images-v2", "gallery-images-v3"]);
  });

  it("unknown (no network): nothing registered, nothing removed — the saved photos stay", async () => {
    const e = fakeEnv([sw], ["gallery-images-v3"]);
    expect(await applyImageWorkerSwitch("unknown", url, e.deps)).toBe("kept");
    expect(e.deps.register).not.toHaveBeenCalled();
    expect(e.unregistered).toEqual([]);
    expect(e.deleted).toEqual([]);
  });

  it("never throws: a broken service-worker API is 'failed', not a crash", async () => {
    const e = fakeEnv([], []);
    e.deps.getRegistrations = async () => { throw new Error("SecurityError"); };
    expect(await applyImageWorkerSwitch("off", url, e.deps)).toBe("failed");
    e.deps.register = vi.fn(async () => { throw new Error("no"); });
    expect(await applyImageWorkerSwitch("on", url, e.deps)).toBe("failed");
  });
});

describe("src/main.tsx goes through the switch", () => {
  it("never registers the worker directly; asks the switch first", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync("src/main.tsx", "utf8");
    // the ONLY register call is the adapter handed to applyImageWorkerSwitch
    expect(main.match(/serviceWorker\.register\(/g)).toHaveLength(1);
    expect(main).toContain("register: (url) => navigator.serviceWorker.register(url)");
    expect(main).toContain("applyImageWorkerSwitch(await readImageWorkerSwitch(), imageWorkerUrl(CDN_HOST),");
  });
});
