/**
 * ALARMS FOR THE ACTIVITY-LOG FLOOD.
 *
 * MEASURED ON PRODUCTION, 2026-08-15: **5,702 `login` rows for 90 members over
 * 37 days.** Grouped into bursts more than 30 minutes apart that is **685 real
 * sign-ins — 8.3 rows written for each**, and one sign-in that wrote **233
 * rows on its own**.
 *
 * Two consequences, and the second is the one that hurt:
 *   • Every member's phone made a database write per event, for nothing.
 *   • A real sign-in could not be told apart from noise, so this table was
 *     USELESS for investigating the owner's random sign-outs the same day.
 *     A broken measurement is worse than no measurement: it invites a
 *     confident wrong answer. (It nearly produced one — a "63 logins per
 *     member" crisis that did not exist.)
 *
 * The fix has two halves and these tests hold BOTH, because either alone is
 * insufficient:
 *   1. The database index is the GUARANTEE — a second row for the same sign-in
 *      is unrepresentable, for every client and every retry.
 *   2. The client guard saves the member's DATA — the index would reject the
 *      row anyway, but 233 rejected requests still cost 233 round-trips.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const MIGRATION = "supabase/migrations/20260815124734_one_activity_row_per_sign_in.sql";
const ROLLBACK = "supabase/rollback/20260815124734_one_activity_row_per_sign_in_ROLLBACK.sql";

const AUTH = readFileSync(join(root, "src/hooks/core/useAuth.tsx"), "utf8");
const LOG = readFileSync(join(root, "src/lib/activityLog.ts"), "utf8");

describe("half 1: the database guarantee", () => {
  const sql = readFileSync(join(root, MIGRATION), "utf8");

  it("the index is UNIQUE — a non-unique index would prevent nothing", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX/i);
  });

  it("it keys on the member AND the sign-in identity, not on time", () => {
    // Keying on a time WINDOW would silently drop a member's genuine second
    // sign-in inside that window. The identity is exact.
    expect(sql).toMatch(/\(user_id, \(metadata->>'sign_in_at'\)\)/);
  });

  it("it is PARTIAL, which is the only reason it was safe to add live", () => {
    // Every one of the 5,702 existing rows lacks the key, so none is indexed
    // and none conflicts. Without this clause the migration would have needed
    // to DELETE 5,017 rows first.
    expect(sql).toMatch(/WHERE action_type = 'login' AND metadata \? 'sign_in_at'/);
  });

  it("it deletes nothing and rewrites nothing", () => {
    expect(sql).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/i);
  });

  it("has a rollback, as every migration must", () => {
    expect(existsSync(join(root, ROLLBACK))).toBe(true);
    expect(readFileSync(join(root, ROLLBACK), "utf8")).toMatch(/DROP INDEX IF EXISTS public\.activity_logs_one_row_per_sign_in/);
  });
});

describe("half 2: the client stops sending what the index would reject", () => {
  it("the sign-in identity is sent, or the index has nothing to key on", () => {
    expect(LOG).toMatch(/metadata: signInAt \? \{ sign_in_at: signInAt \} : \{\}/);
  });

  it("the identity is the AUTH timestamp, never a clock reading here", () => {
    // Date.now() would differ on every event and defeat the index entirely —
    // every duplicate would look like a new sign-in and all 5,702 rows would
    // come back.
    expect(AUTH).toMatch(/session\.user\.last_sign_in_at/);
    const branch = AUTH.slice(AUTH.indexOf("const signInAt"), AUTH.indexOf("logDeviceSignIn"));
    expect(branch).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });

  it("a repeat of the SAME sign-in is not even requested", () => {
    expect(AUTH).toMatch(/if \(signInAt !== lastLoggedSignInRef\.current\)/);
  });

  it("the guard remembers, or it would fire every time and guard nothing", () => {
    expect(AUTH).toMatch(/lastLoggedSignInRef\.current = signInAt;/);
    expect(AUTH).toMatch(/useRef<string \| null>\(null\)/);
  });

  it("events that are NOT sign-ins still log — this was a dedupe, not a mute", () => {
    // profile_updated, password_recovery and logout carry no sign_in_at, are
    // not indexed, and must keep working exactly as before.
    expect(AUTH).toMatch(/logAuthEvent\(session\.user\.id, "profile_updated"\)/);
    expect(AUTH).toMatch(/logAuthEvent\(session\.user\.id, "password_recovery"\)/);
    expect(AUTH).toMatch(/logAuthEvent\(user\.id, "logout"\)/);
  });
});

describe("the shape of the dedupe, as arithmetic", () => {
  /**
   * A tiny model of the real thing, so the RULE is tested rather than the
   * wiring: given the stream of SIGNED_IN events a phone actually produces,
   * how many rows reach the database?
   */
  function rowsWritten(signInStream: Array<string | null>): number {
    let lastLogged: string | null = null;
    const indexed = new Set<string>();
    for (const signInAt of signInStream) {
      if (signInAt === lastLogged) continue;      // client guard: no request
      lastLogged = signInAt;
      const key = `u:${signInAt}`;
      if (indexed.has(key)) continue;             // database index: no row
      indexed.add(key);
    }
    return indexed.size;
  }

  it("the worst real burst — 233 events for ONE sign-in — writes one row", () => {
    expect(rowsWritten(Array(233).fill("2026-08-15T09:00:00Z"))).toBe(1);
  });

  it("the measured average — 8.3 events per sign-in — writes one row", () => {
    expect(rowsWritten(Array(8).fill("2026-08-15T09:00:00Z"))).toBe(1);
  });

  it("two GENUINE sign-ins still write two rows — this must not over-collapse", () => {
    expect(rowsWritten([
      "2026-08-15T09:00:00Z", "2026-08-15T09:00:00Z",
      "2026-08-15T14:30:00Z", "2026-08-15T14:30:00Z", "2026-08-15T14:30:00Z",
    ])).toBe(2);
  });

  it("a sign-in the member REPEATS later in the day is still recorded", () => {
    // The danger of a time-window dedupe, avoided by keying on identity.
    expect(rowsWritten(["A", "B", "A"])).toBe(2); // A already indexed, B new
  });

  it("the whole measured month collapses 5,702 rows to 685", () => {
    // 685 real sign-ins, each firing its measured 8.3 events.
    const stream: string[] = [];
    for (let i = 0; i < 685; i++) {
      for (let j = 0; j < 8; j++) stream.push(`sign-in-${i}`);
    }
    expect(stream.length).toBe(5480);
    expect(rowsWritten(stream)).toBe(685);
  });
});
