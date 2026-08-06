/**
 * THE ERROR LOG MUST BE REACHABLE, AND MUST NOT LIE.
 *
 * Owner, 2026-08-06: "Now when someone reports 'I'm getting DB-3002' your team
 * immediately knows which subsystem, what failed, and where to start
 * investigating."
 *
 * Storing the logs was only half of that sentence. This file pins the other
 * half: that the screen exists, is wired into the admin panel (a screen with
 * no route is a screen nobody will ever open), reads through the admin-only
 * functions rather than the table, and shows every field the standard says a
 * log must answer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (rel: string) =>
  readFileSync(join(__dirname, "..", "..", rel), "utf8")
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const screen = read("components/admin/AdminAppEvents.tsx");
const panel = read("pages/AdminPanel.tsx");
const access = read("lib/adminRoleAccess.ts");

describe("the screen is actually reachable", () => {
  it("AdminPanel lazy-loads it, routes to it, and puts it in the menu", () => {
    expect(panel).toContain('import("@/components/admin/AdminAppEvents")');
    expect(panel).toContain('currentRoute === "app_events"');
    expect(panel).toContain('["app_events", "Error Log", Bug]');
  });

  it("the route is in the valid-routes set, or the panel would fall back to the default tab", () => {
    // The routes set and the menu entry must agree; a menu item pointing at a
    // route the panel rejects silently lands the admin on Hero Banners.
    const routesBlock = panel.slice(panel.indexOf("new Set"), panel.indexOf("DEFAULT_ROUTE"));
    expect(routesBlock).toContain('"app_events"');
  });

  it("the tab key exists in the access-control type", () => {
    expect(access).toContain('"app_events"');
  });
});

describe("it reads through the admin-only functions, never the table", () => {
  it("uses both RPCs and never selects from client_errors directly", () => {
    expect(screen).toContain("get_app_event_counts_admin");
    expect(screen).toContain("get_app_events_admin");
    expect(screen).not.toContain('from("client_errors"');
  });

  it("surfaces a load failure instead of showing an empty screen", () => {
    // An admin screen that fails silently is the disease this feature cures.
    expect(screen).toContain("Could not load the logs.");
    expect(screen).toContain("admin only");
  });
});

describe("it shows what the standard says a log must answer", () => {
  it("renders code, severity, event, reason, expected, actual and next step", () => {
    for (const field of [
      "row.code",
      "row.severity",
      "row.event",
      "row.reason",
      "row.expected",
      "row.actual",
      "row.next_step",
    ]) {
      expect(screen, `${field} is not rendered`).toContain(field);
    }
  });

  it("shows which function, which file, which member, which build and how long", () => {
    expect(screen).toContain("row.fn");
    expect(screen).toContain("row.src_file");
    expect(screen).toContain("row.user_id");
    expect(screen).toContain("row.app_build");
    expect(screen).toContain("row.duration_ms");
  });

  it("falls back to the catalog's resolution when a log carries no next step", () => {
    expect(screen).toContain("getErrorCode");
    expect(screen).toMatch(/row\.next_step \|\| entry\?\.resolution/);
  });

  it("can pull up every line of ONE member action by correlation id", () => {
    expect(screen).toContain("setCorrelation");
    expect(screen).toContain("r.correlation_id === correlation");
  });

  it("offers every catalog code as a filter, so the list can never go stale", () => {
    expect(screen).toContain("ERROR_CATALOG.map");
  });
});
