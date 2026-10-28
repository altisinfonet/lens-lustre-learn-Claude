/**
 * THE ANDROID APP'S ORIGIN, AGAINST THIS CHECKOUT'S OWN PAGES FUNCTIONS.
 *
 * The app's page runs on https://localhost and calls the site for every route in
 * SITE_API (src/lib/net/siteApi.ts). For EACH route this sends, from that
 * Origin, the preflight the WebView sends and the request it follows with, into
 * the route's real handler, and requires exactly one
 * `Access-Control-Allow-Origin: https://localhost` (a duplicated header reads
 * back as "https://localhost, https://localhost" and fails) and a 204 preflight.
 *
 * Run by .github/workflows/d2-app-origin.yml, which then repeats the same
 * journey over the wire against the staging site (scripts/app-origin-check.mjs).
 * This half is the one that sees a PR's own code before it is deployed.
 */
import { describe, it, expect } from "vitest";
import { SITE_API } from "@/lib/net/siteApi";

const APP_ORIGIN = "https://localhost";
const ENV = { SITE_ORIGIN: "https://staging.50mmretina.com" };

type Ctx = { request: Request; env: typeof ENV };
type Handler = (ctx: Ctx) => Response | Promise<Response>;
type Route = { method: "GET" | "POST"; load: () => Promise<Record<string, unknown>>; pick: (m: Record<string, unknown>, method: string) => Handler };
const onRequest = (m: Record<string, unknown>) => m.onRequest as Handler;

const ROUTES: Record<string, Route> = {
  "/api/video/play-token": { method: "POST", load: () => import("../../functions/api/video/play-token"), pick: onRequest },
  "/api/video/upload-urls": { method: "POST", load: () => import("../../functions/api/video/upload-urls"), pick: onRequest },
  "/api/video/complete": { method: "POST", load: () => import("../../functions/api/video/complete"), pick: onRequest },
  "/api/video/source-url": { method: "POST", load: () => import("../../functions/api/video/source-url"), pick: onRequest },
  "/api/video/source-complete": { method: "POST", load: () => import("../../functions/api/video/source-complete"), pick: onRequest },
  "/api/video/source-cancel": { method: "POST", load: () => import("../../functions/api/video/source-cancel"), pick: onRequest },
  "/api/media/photo-token": { method: "POST", load: () => import("../../functions/api/media/photo-token"), pick: onRequest },
  "/config/site-settings": {
    method: "GET",
    load: () => import("../../functions/config/site-settings"),
    pick: (m, method) => (method === "OPTIONS" ? m.onRequestOptions : m.onRequestGet) as Handler,
  },
};

const url = (path: string) => `https://www.50mmretina.com${path}`;

describe("app origin journey (https://localhost)", () => {
  it("covers every route siteApi.ts declares, and no others", () => {
    expect(Object.keys(ROUTES).sort()).toEqual(Object.values(SITE_API).sort());
  });

  for (const [path, route] of Object.entries(ROUTES)) {
    it(`${route.method} ${path}: preflight 204 and one ACAO, request carries one ACAO`, async () => {
      const mod = await route.load();

      const pre = await route.pick(mod, "OPTIONS")({
        request: new Request(url(path), {
          method: "OPTIONS",
          headers: {
            origin: APP_ORIGIN,
            "access-control-request-method": route.method,
            "access-control-request-headers": "authorization, content-type",
          },
        }),
        env: ENV,
      });
      expect(pre.status, "preflight status").toBe(204);
      expect(pre.headers.get("access-control-allow-origin"), "preflight ACAO").toBe(APP_ORIGIN);
      expect(pre.headers.get("access-control-allow-methods") ?? "", "preflight methods").toContain(route.method);

      const res = await route.pick(mod, route.method)({
        request: new Request(url(path), {
          method: route.method,
          headers: { origin: APP_ORIGIN, "content-type": "application/json" },
          body: route.method === "POST" ? "{}" : undefined,
        }),
        env: ENV,
      });
      // Status is whatever the route says (no bearer: an error). The WebView must still be handed it.
      expect(res.headers.get("access-control-allow-origin"), `${route.method} ACAO (status ${res.status})`).toBe(APP_ORIGIN);
    });
  }
});
