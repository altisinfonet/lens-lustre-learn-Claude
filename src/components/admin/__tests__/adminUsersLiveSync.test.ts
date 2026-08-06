/**
 * THE ADMIN MEMBER LIST MUST UPDATE WITHOUT A PAGE REFRESH. PINNED.
 *
 * Owner, 2026-08-06: *"instantly user list is not updateing (without a refresh
 * the page) who is active from where logged in — instant need"*.
 *
 * The realtime subscription was always correct. What broke it:
 *   * scheduleRefresh returns early when activeQueryRef is null.
 *   * activeQueryRef is only ever set inside fetchUsers.
 *   * fetchUsers was only ever called from a click or the Enter key.
 * So on a freshly opened screen every live update was discarded, and the only
 * way to see a change was to reload — exactly what was reported.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const src = () =>
  readFileSync(join(__dirname, "..", "AdminUsers.tsx"), "utf8")
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the admin member list stays live", () => {
  it("loads on mount, so the realtime handler is never left with a null query", () => {
    const code = src();
    expect(code, "no mount load — live updates will be discarded").toMatch(
      /if\s*\(!activeQueryRef\.current\)\s*\{[\s\S]*?fetchUsersRef\.current\?\.\(\)/,
    );
  });

  it("still subscribes to everything the list displays", () => {
    const code = src();
    // profiles carries last_active_at and last_platform — the "who is active,
    // from where" columns the owner asked about.
    for (const table of ["profiles", "user_roles", "user_badges"]) {
      expect(code, `lost the ${table} subscription`).toContain(`table: "${table}"`);
    }
    expect(code).toContain('.channel("admin-users-live-sync")');
  });

  it("records the load, so a silent regression is visible", () => {
    expect(src()).toContain("ADMIN-8107");
  });
});
