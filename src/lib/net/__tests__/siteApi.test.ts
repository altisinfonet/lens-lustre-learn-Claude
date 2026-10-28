/**
 * Live bug, Android app 1.2.22 (2026-10-17): "This video can't play right now"
 * on every video post. playGrant.ts asked fetch("/api/video/play-token") — a
 * RELATIVE URL, which inside the app (served from https://localhost) goes to
 * the phone, not the site. Uploads had the same shape (/api/video/upload-urls,
 * complete, source-*), and so did /config/site-settings.
 *
 * These tests run the REAL callers with the Capacitor bridge present and
 * assert the URL each one actually asked for. On 7f3dcf89 every "native" case
 * here fails: the URL is relative.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-a", user: { id: "viewer-a" } } } }) },
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  },
}));
vi.mock("@/lib/offline/networkQuality", () => ({ getNetState: () => ({ online: true }), noteOutcome: () => {} }));

import { SITE_ORIGIN } from "@/lib/env";
import { requestGrant, resetGrantCache } from "@/lib/video/playGrant";
import { realJobDeps } from "@/lib/video/jobDeps";
import { getSiteSetting, invalidateSiteSetting, resetSiteSettingsEdgeState } from "@/lib/siteSettingsCache";

/** The lane vitest builds for (vitest.config.ts: production). */
const LANE = "https://www.50mmretina.com";

/** Every Pages Function route the client calls today, as the callers wrote them before the fix. */
const VIDEO_ROUTES = [
  "/api/video/play-token",
  "/api/video/upload-urls",
  "/api/video/complete",
  "/api/video/source-url",
  "/api/video/source-complete",
  "/api/video/source-cancel",
] as const;
const ALL_ROUTES = [...VIDEO_ROUTES, "/api/media/photo-token", "/config/site-settings"] as const;
/** Imported per test, so each case below fails on its own on a tree without the helper. */
const HELPER = "@/lib/net/siteApi";
const helper = (): Promise<typeof import("@/lib/net/siteApi")> => import(/* @vite-ignore */ HELPER);

let asked: string[] = [];
const OK_GRANT = { master_url: "https://cdn.50mmretina.com/video/o/v/v1/master.m3u8?t=a", poster_url: "https://cdn.50mmretina.com/video/o/v/v1/poster.jpg?t=a", expires_at: 1 };

function native(on: boolean) {
  const w = window as unknown as { Capacitor?: unknown };
  if (on) w.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
  else delete w.Capacitor;
}

beforeEach(() => {
  asked = [];
  resetGrantCache();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    if (url.endsWith("/config/site-settings")) return new Response(JSON.stringify({ version: "v", settings: { a: 1 } }), { status: 200 });
    return new Response(JSON.stringify(OK_GRANT), { status: 200 });
  }));
});
afterEach(() => { native(false); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the lane origin the app talks to", () => {
  it("is this lane's site origin (production under vitest)", () => {
    expect(SITE_ORIGIN).toBe(LANE);
  });
  it("SITE_API names every route the callers use, and nothing else", async () => {
    const { SITE_API } = await helper();
    expect(Object.values(SITE_API).sort()).toEqual([...ALL_ROUTES].sort());
  });
});

describe("siteUrl", () => {
  it.each(ALL_ROUTES)("native: %s is absolute, to the lane's site", async (p) => {
    const { siteUrl } = await helper();
    native(true);
    expect(siteUrl(p)).toBe(`${LANE}${p}`);
  });
  it.each(ALL_ROUTES)("web: %s stays relative (same origin, no CORS)", async (p) => {
    const { siteUrl } = await helper();
    native(false);
    expect(siteUrl(p)).toBe(p);
  });
});

describe("the real callers, inside the app", () => {
  it("playGrant asks the SITE for a play token, not https://localhost", async () => {
    native(true);
    const g = await requestGrant("v1");
    expect(asked).toEqual([`${LANE}/api/video/play-token`]);
    expect(g?.master_url).toBe(OK_GRANT.master_url);
  });

  it.each(VIDEO_ROUTES.filter((r) => r !== "/api/video/play-token"))("upload: realJobDeps.api(%s) goes to the site", async (route) => {
    native(true);
    await realJobDeps.api(route as never, {});
    expect(asked).toEqual([`${LANE}${route}`]);
  });

  it("site-settings is read from the site's edge", async () => {
    vi.stubEnv("DEV", false);
    invalidateSiteSetting();
    resetSiteSettingsEdgeState();
    native(true);
    expect(await getSiteSetting("a")).toBe(1);
    expect(asked).toEqual([`${LANE}/config/site-settings`]);
  });
});

describe("the same callers on the web are unchanged", () => {
  it("playGrant stays relative", async () => {
    await requestGrant("v2");
    expect(asked).toEqual(["/api/video/play-token"]);
  });
  it("upload stays relative", async () => {
    await realJobDeps.api("/api/video/complete" as never, {});
    expect(asked).toEqual(["/api/video/complete"]);
  });
});
