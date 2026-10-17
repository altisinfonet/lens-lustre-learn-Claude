/**
 * Live bug, Android app 1.2.22 (2026-10-17): the app (https://localhost) asks
 * the site's Pages Functions cross-origin. Live, OPTIONS /api/video/play-token
 * answered 405 with no Access-Control-Allow-Origin, so the WebView threw every
 * answer away. These pin the shared helper (functions/_cors.ts) on EVERY route
 * the app calls — the six /api/video/* routes and /config/site-settings:
 *   · OPTIONS -> 204 with ACAO echoing an allowed origin;
 *   · a stranger (or a look-alike) gets no ACAO at all, never "*";
 *   · error answers carry the headers too (else the app sees "CORS", not the code);
 *   · Vary: Origin always; never Allow-Credentials.
 * On 7f3dcf89 the OPTIONS and ACAO cases fail (405 / no header).
 */
import { describe, expect, it } from "vitest";
import { handlePlayToken } from "../../../../functions/api/video/play-token";
import { handleUploadUrls } from "../../../../functions/api/video/upload-urls";
import { handleComplete } from "../../../../functions/api/video/complete";
import { handleSourceUrl } from "../../../../functions/api/video/source-url";
import { handleSourceComplete } from "../../../../functions/api/video/source-complete";
import { handleSourceCancel } from "../../../../functions/api/video/source-cancel";
import * as siteSettings from "../../../../functions/config/site-settings";

/** Pages' own dispatch for a file with per-method exports: onRequest<Method>, else 405. */
function pagesDispatch(mod: Record<string, unknown>, ctx: { request: Request; env: unknown }): Promise<Response> {
  const m = ctx.request.method;
  const fn = mod[`onRequest${m[0]}${m.slice(1).toLowerCase()}`] as ((c: typeof ctx) => Promise<Response>) | undefined;
  return fn ? fn(ctx) : Promise.resolve(new Response("Method Not Allowed", { status: 405 }));
}

const STAGING = "https://staging.50mmretina.com";
type Env = Record<string, string | undefined>;
/** Uploads/playback off on this lane: every POST fails fast with 503 VID-ENV-002 — an ERROR answer, no network. */
const ENV: Env = { SUPABASE_PROJECT_REF: "testref", SUPABASE_ANON_KEY: "anon-key", SITE_ORIGIN: STAGING };
const noNet = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

type Route = { name: string; path: string; run: (r: Request, env: Env) => Promise<Response> };
/* eslint-disable @typescript-eslint/no-explicit-any */
const ROUTES: Route[] = [
  { name: "play-token", path: "/api/video/play-token", run: (r, e) => handlePlayToken(r, e as any, new Date(), noNet) },
  { name: "upload-urls", path: "/api/video/upload-urls", run: (r, e) => handleUploadUrls(r, e as any, new Date(), noNet) },
  { name: "complete", path: "/api/video/complete", run: (r, e) => handleComplete(r, e as any, noNet) },
  { name: "source-url", path: "/api/video/source-url", run: (r, e) => handleSourceUrl(r, e as any, new Date(), noNet) },
  { name: "source-complete", path: "/api/video/source-complete", run: (r, e) => handleSourceComplete(r, e as any, noNet) },
  { name: "source-cancel", path: "/api/video/source-cancel", run: (r, e) => handleSourceCancel(r, e as any, noNet) },
  {
    name: "site-settings", path: "/config/site-settings",
    run: (r, e) => pagesDispatch(siteSettings as any, { request: r, env: { ...e, SUPABASE_ANON_KEY: undefined } }),
  },
];
/* eslint-enable @typescript-eslint/no-explicit-any */

const req = (path: string, method: string, origin?: string, extra: Record<string, string> = {}) =>
  new Request(`${STAGING}${path}`, {
    method,
    headers: { ...(origin ? { origin } : {}), ...extra },
    ...(method === "POST" ? { body: "{}" } : {}),
  });

const preflight = (path: string, origin: string) =>
  req(path, "OPTIONS", origin, { "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" });

describe.each(ROUTES)("$name — CORS for the native app", ({ path, run }) => {
  it("OPTIONS from https://localhost (Android) -> 204, ACAO echoed, methods + headers allowed", async () => {
    const r = await run(preflight(path, "https://localhost"), ENV);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const methods = (r.headers.get("access-control-allow-methods") ?? "").toUpperCase();
    for (const m of ["POST", "GET", "OPTIONS"]) expect(methods).toContain(m);
    const headers = (r.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const h of ["authorization", "content-type"]) expect(headers).toContain(h);
    expect(r.headers.get("vary") ?? "").toMatch(/\bOrigin\b/);
    expect(r.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("OPTIONS from capacitor://localhost (iOS) and from the lane's own site are allowed", async () => {
    for (const o of ["capacitor://localhost", STAGING]) {
      const r = await run(preflight(path, o), ENV);
      expect(r.status).toBe(204);
      expect(r.headers.get("access-control-allow-origin")).toBe(o);
    }
  });

  it("a stranger or look-alike origin gets NO Access-Control-Allow-Origin (never *)", async () => {
    for (const o of ["https://evil.example", "https://localhost.evil.example", "http://localhost", "https://www.50mmretina.com", "null"]) {
      const r = await run(preflight(path, o), ENV);
      expect(r.headers.get("access-control-allow-origin"), o).toBeNull();
      expect(r.headers.get("vary") ?? "").toMatch(/\bOrigin\b/);
    }
  });

  it("an ERROR answer carries CORS too, so the app sees the error code, not a CORS failure", async () => {
    const r = await run(req(path, path.startsWith("/config") ? "GET" : "POST", "https://localhost", { "content-type": "application/json" }), ENV);
    expect(r.status).toBe(503);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(r.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("a request without Origin (same-origin web) is answered as before, with no ACAO", async () => {
    const r = await run(req(path, path.startsWith("/config") ? "GET" : "POST"), ENV);
    expect(r.status).toBe(503);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("the allow-list is equality, never a prefix", () => {
  const acao = async (origin: string, env: Env) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await handlePlayToken(preflight("/api/video/play-token", origin), env as any)).headers.get("access-control-allow-origin");
  it("SITE_ORIGIN with a trailing slash still matches exactly; unset SITE_ORIGIN allows only the app", async () => {
    expect(await acao(STAGING, { ...ENV, SITE_ORIGIN: `${STAGING}/` })).toBe(STAGING);
    expect(await acao(STAGING, { ...ENV, SITE_ORIGIN: undefined })).toBeNull();
    expect(await acao("https://localhost", { ...ENV, SITE_ORIGIN: undefined })).toBe("https://localhost");
    expect(await acao(`${STAGING}.evil.example`, ENV)).toBeNull();
  });
});

describe("a successful play-token answer carries CORS", () => {
  it("200 with ACAO for the app", async () => {
    const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 7)));
    const V = "33333333-3333-4333-8333-333333333333";
    const O = "11111111-1111-4111-8111-111111111111";
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("/rest/v1/videos?")) return ok([{ id: V, owner_id: O, current_version: 1, state: "ready" }]);
      if (url.includes("/rest/v1/video_versions?")) return ok([{ width: 720, height: 1280, declared_duration_s: "5", has_audio: true, renditions: ["240p"] }]);
      return new Response("{}", { status: 401 });
    }) as typeof fetch;
    const r = await handlePlayToken(
      new Request(`${STAGING}/api/video/play-token`, { method: "POST", headers: { origin: "https://localhost", "content-type": "application/json" }, body: JSON.stringify({ video_id: V }) }),
      { ...ENV, VIDEO_DELIVERY_PRIVATE: "1", MEDIA_TOKEN_KEY: KEY, MEDIA_CDN_HOST: "cdn-staging.50mmretina.com" },
      new Date(1_800_000_000_000), fetchImpl,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(((await r.json()) as { master_url: string }).master_url).toMatch(/^https:\/\/cdn-staging\.50mmretina\.com\//);
  });
});
