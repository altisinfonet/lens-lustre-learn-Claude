/**
 * ADMIN USERS LIST: LAST-ACTIVE + APP/WEB ORIGIN — STILL PINNED, NEW WRITER.
 *
 * Owner, 2026-08-05: "on the admin users list show last activated time and
 * login from app or website on the same list nicely show".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE CHANGED, AND ON WHOSE AUTHORITY
 *
 * It used to assert that `useLastActive.ts` writes `last_active_at` and
 * `last_platform` from the client, every five minutes. `docs/gates/P1-interface.md`
 * §5 removes exactly that: "No client code writes profiles.last_active_at or
 * profiles.last_platform. There is no client timer that touches profiles." So
 * the old assertions could not survive 2-D2-03 — and the Auditor said so in the
 * Phase 2 kickoff, which names this file as one the unit must update. It was NOT
 * edited to make a change pass quietly; the rule it pinned was replaced in
 * writing first.
 *
 * WHAT DID NOT CHANGE IS THE OWNER'S REQUIREMENT. Both columns still have to be
 * filled and both still have to be rendered. What moved is WHO fills them:
 *
 *   before   every client, every five minutes, via .update({ last_active_at,
 *            last_platform }) — a write per member per five minutes for a fact
 *            nobody read more than once
 *   after    once per session, when the session ends, via
 *            record_session_end(_platform) — which also resolves the two-tab
 *            case in the database (P1 §2) and is backstopped by
 *            backfill_last_seen() on pg_cron for sessions that end without a
 *            signal (§3)
 *
 * `last_platform` still comes from `isNativeCapacitorApp()` and still never from
 * `client_errors.platform`, which only exists for members who hit an error and
 * is not a sign-in record. That distinction is the reason the original file
 * exists and it is pinned below, on the new writer.
 *
 * Source pins in the style of stage-catalog-parity.test.ts: assertions on
 * comment-stripped source, so a refactor that silently drops the owner's
 * columns fails CI with this file explaining why.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripComments } from "@/test-utils/sourceText";

const read = (rel: string) =>
  stripComments(readFileSync(join(__dirname, "..", "..", "..", "src", rel), "utf8"));

describe("the session-end write records the origin, not just the time", () => {
  const src = read("hooks/core/useSessionEnd.ts");

  it("calls record_session_end, which writes both columns server-side", () => {
    expect(src).toContain('"record_session_end"');
  });

  it("derives platform from the Capacitor runtime check, values app/web", () => {
    expect(src).toMatch(/_platform:\s*isNativeCapacitorApp\(\)\s*\?\s*"app"\s*:\s*"web"/);
  });

  it("never imports @capacitor/* directly (web build would break)", () => {
    expect(src).not.toMatch(/from\s+["']@capacitor\//);
  });

  it("fires on teardown, not on a timer — P1 §5 leaves no client timer on profiles", () => {
    expect(src).toContain('addEventListener("pagehide"');
    expect(src).toContain('addEventListener("visibilitychange"');
    expect(
      src,
      "a timer here would be the five-minute write coming back under a new name",
    ).not.toMatch(/setInterval|VisibilityInterval/);
  });

  it("does not await the write and does not retry it", () => {
    // A page being torn down has no time for a promise; §3's cron is the
    // backstop for a call that never lands.
    expect(src).toMatch(/void Promise\.resolve\(/);
    expect(src).not.toMatch(/retry|attempts|setTimeout\(/);
  });

  it("records nothing when the page is going into the back/forward cache", () => {
    // `persisted: true` means the session has not ended — the page comes back.
    expect(src).toMatch(/if\s*\(event\.persisted\)\s*return;/);
  });
});

describe("the old client write is gone, not merely unused", () => {
  const src = read("hooks/core/useLastActive.ts");

  it("useLastActive no longer exists", () => {
    expect(
      src,
      "P1 §5. An exported hook nobody mounts is one import away from being mounted again.",
    ).not.toMatch(/export function useLastActive/);
  });

  it("isActiveNow no longer exists either", () => {
    // §4: "The green dot uses isOnline(userId), never isActiveNow(last_active_at)."
    expect(src).not.toMatch(/export function isActiveNow/);
  });

  it("formatLastSeen stays — §4 keeps 'Last seen X ago' reading last_active_at", () => {
    expect(src).toMatch(/export function formatLastSeen/);
  });

  it("writes nothing", () => {
    expect(src).not.toMatch(/\.update\(|\.upsert\(|\.insert\(/);
  });
});

describe("AdminUsers shows both columns from profiles", () => {
  const src = read("components/admin/AdminUsers.tsx");

  it("fetches last_active_at and last_platform from profiles for the listed ids", () => {
    expect(src).toContain('select("id, last_active_at, last_platform"');
  });

  it("renders last-seen from the timestamp", () => {
    expect(src).toContain("formatLastSeen(u.last_active_at)");
  });

  it("takes 'Active now' from live presence, not from the timestamp window", () => {
    // P1 §4: "The admin list shows 'Active now' when isOnline." The timestamp is
    // written when a member LEAVES, so deriving "now" from it was always going to
    // disagree with the dot beside it.
    expect(src).toContain("useOnlineIds()");
    expect(src).toMatch(/onlineIds\.has\(u\.id\)\s*\?\s*"Active now"/);
    expect(src).not.toContain("isActiveNow");
  });

  it("renders the App / Website pill only when a platform is recorded", () => {
    expect(src).toContain("u.last_platform && (");
    expect(src).toMatch(/u\.last_platform === "app" \? "App" : "Website"/);
  });

  it("does not derive origin from client_errors (error rows are not sign-ins)", () => {
    expect(src).not.toContain("client_errors");
  });
});
