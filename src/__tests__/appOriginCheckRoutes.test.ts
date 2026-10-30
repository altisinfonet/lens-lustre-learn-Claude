/**
 * scripts/app-origin-check.mjs asks the STAGING site, over the wire, whether
 * every SITE_API route answers the app's origin (https://localhost).
 *
 * Bug (PR #541, run 40890330801): the script took the route list from THIS
 * checkout. A PR that adds a route therefore asked pre-merge staging about a
 * route staging has never had — staging answers it exactly like a route that
 * does not exist (405) — and the check went red for every route-adding PR.
 * The routes to ask about are the ones in the commit staging is serving
 * (its <meta name="build-commit">). A route only this checkout has is covered
 * in-process by src/__tests__/appOriginJourney.test.ts (step 1 of the job).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSiteApi, selectRoutes } from "../../scripts/app-origin-check.mjs";
import { SITE_API } from "@/lib/net/siteApi";

const DEPLOYED = ["/api/video/play-token", "/api/video/source-cancel", "/config/site-settings"];

describe("app-origin-check: which routes it asks the deployed site about", () => {
  it("a route this checkout adds is not asked of a site that does not serve it yet", () => {
    const r = selectRoutes([...DEPLOYED, "/api/video/takedown"], DEPLOYED);
    expect(r.check).toEqual(DEPLOYED);
    expect(r.notDeployed).toEqual(["/api/video/takedown"]);
  });

  it("every route the deployed commit serves is still asked, even one this checkout removes", () => {
    const r = selectRoutes(["/api/video/play-token", "/config/site-settings"], DEPLOYED);
    expect(r.check).toEqual(DEPLOYED);
    expect(r.notDeployed).toEqual([]);
  });

  it("deployed list unreadable: fails closed and asks about every route in this checkout", () => {
    const all = [...DEPLOYED, "/api/video/takedown"];
    expect(selectRoutes(all, null)).toEqual({ check: all, notDeployed: [] });
  });

  it("an empty deployed list is treated as unreadable (fails closed)", () => {
    expect(selectRoutes(DEPLOYED, [])).toEqual({ check: DEPLOYED, notDeployed: [] });
  });

  it("parseSiteApi on text with no SITE_API block reads nothing", () => {
    expect(parseSiteApi("export const OTHER = {};")).toEqual([]);
  });

  it("parseSiteApi reads exactly SITE_API from the real siteApi.ts", () => {
    const src = readFileSync("src/lib/net/siteApi.ts", "utf8");
    expect(parseSiteApi(src).sort()).toEqual(Object.values(SITE_API).sort());
  });
});
