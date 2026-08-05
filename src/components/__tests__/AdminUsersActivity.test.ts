/**
 * ADMIN USERS LIST: LAST-ACTIVE + APP/WEB ORIGIN — PINNED.
 *
 * Owner, 2026-08-05: "on the admin users list show last activated time and
 * login from app or website on the same list nicely show".
 *
 * The rules these tests hold:
 *  1. useLastActive WRITES both fields — last_active_at and last_platform —
 *     so the admin list has real data to show. last_platform comes from
 *     isNativeCapacitorApp(), never from error rows (client_errors.platform
 *     only exists for members who hit an error and is NOT a sign-in record).
 *  2. AdminUsers READS both from profiles and renders them; the platform
 *     pill is conditional — a member who has not signed in since 2026-08-05
 *     shows a blank, never an invented value.
 *
 * Source pins in the style of stage-catalog-parity.test.ts: assertions on
 * comment-stripped source, so a refactor that silently drops the owner's
 * columns fails CI with this file explaining why.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (rel: string) =>
  readFileSync(join(__dirname, "..", "..", "..", "src", rel), "utf8")
    // strip block + line comments so pins match code, not prose
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("useLastActive writes the origin, not just the time", () => {
  const src = read("hooks/core/useLastActive.ts");

  it("writes last_active_at and last_platform in the same update", () => {
    expect(src).toContain("last_active_at: new Date().toISOString()");
    expect(src).toContain("last_platform: isNativeCapacitorApp()");
  });

  it("derives platform from the Capacitor runtime check, values app/web", () => {
    expect(src).toMatch(/isNativeCapacitorApp\(\)\s*\?\s*"app"\s*:\s*"web"/);
  });

  it("never imports @capacitor/* directly (web build would break)", () => {
    expect(src).not.toMatch(/from\s+["']@capacitor\//);
  });
});

describe("AdminUsers shows both columns from profiles", () => {
  const src = read("components/admin/AdminUsers.tsx");

  it("fetches last_active_at and last_platform from profiles for the listed ids", () => {
    expect(src).toContain('select("id, last_active_at, last_platform"');
  });

  it("renders last-seen with the live-now state", () => {
    expect(src).toContain("formatLastSeen(u.last_active_at)");
    expect(src).toContain("isActiveNow(u.last_active_at)");
  });

  it("renders the App / Website pill only when a platform is recorded", () => {
    expect(src).toContain("u.last_platform && (");
    expect(src).toMatch(/u\.last_platform === "app" \? "App" : "Website"/);
  });

  it("does not derive origin from client_errors (error rows are not sign-ins)", () => {
    expect(src).not.toContain("client_errors");
  });
});
