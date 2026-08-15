/**
 * A MEMBER MAY START AN UPLOAD. ONLY THE SERVER MAY SAY IT WAS VERIFIED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * That asymmetry is the entire security property of the media pipeline, and it
 * is worth writing down what it costs to lose it: `media_mark_ready` is, by
 * definition, the ability to publish bytes the server never checked. A member
 * who can reach it can attach anything to a post — the wrong image, a file that
 * is not an image, or bytes whose hash does not match what they claimed.
 *
 * Three separate things hold the line, and this file asserts all three, because
 * any one of them silently reverting restores the hole:
 *
 *   1. `media_objects` is NOT granted to anon or authenticated at all. This is
 *      the load-bearing one and the least obvious. RLS constrains WHICH ROWS a
 *      statement may touch — it says nothing about WHICH COLUMN VALUES. With a
 *      plain `GRANT INSERT ... TO authenticated` plus the existing
 *      `WITH CHECK (owner_id = auth.uid())` policy, a member inserts a row with
 *      `state = 'ready'` in the same statement, and the post_media gate from
 *      20260814084711 waves it through because the row does say `ready`.
 *
 *   2. The worker functions are revoked from `authenticated`, not merely from
 *      `anon`. `ALTER DEFAULT PRIVILEGES` grants EXECUTE to BOTH roles on every
 *      new public function, and `REVOKE ... FROM PUBLIC` removes neither.
 *      `securityDefinerGrants.test.ts` covers the anon half for every migration;
 *      the authenticated half is what matters here, and it is specific enough
 *      to these four functions to belong in its own file.
 *
 *   3. The state machine lives in a trigger, so `pending -> ready` is refused
 *      even for `service_role` and `postgres`. The worker is the component most
 *      likely to carry a bug, and "skip verification, mark it ready" is the bug
 *      that matters. A trigger cannot be forgotten by whoever writes the next
 *      worker; a convention can.
 *
 * Migrations are resolved at run time, never by a hardcoded filename — trap #8:
 * a test pinned to a superseded file passes forever while production drifts.
 * Comments are stripped before matching so the prose above cannot satisfy an
 * assertion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const MANDATE_FROM = "20260813000000";

const inScope = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .sort();

const strip = (f: string) =>
  readFileSync(join(MIGRATIONS, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");

/** Every in-scope migration, concatenated. Later files may revoke what earlier ones granted. */
const all = inScope.map(strip).join("\n");

/** The three transitions only the server may make. */
const WORKER_FNS = ["media_mark_verified", "media_mark_ready", "media_quarantine"];

/** `GRANT EXECUTE ON FUNCTION public.<fn>(...) TO <roles>` — returns the role lists. */
function grantsFor(fn: string): string[] {
  return [
    ...all.matchAll(
      new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s*TO\\s+([^;]+);`, "gi"),
    ),
  ].map((m) => m[1]);
}

describe("only the server can publish media", () => {
  it("the write-path migration is present (guards against a vacuous pass)", () => {
    // Every assertion below is "X is not granted". Delete the migration and
    // they all pass. This makes that failure loud.
    expect(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.media_begin_upload\s*\(/i.test(all),
      "No in-scope migration defines media_begin_upload. Either the mandate " +
        "window moved past it or it was renamed — either way this file is now " +
        "asserting nothing.",
    ).toBe(true);
  });

  /** (1) The load-bearing one. */
  it("media_objects and post_media are never granted to anon or authenticated", () => {
    const offenders: string[] = [];
    for (const table of ["media_objects", "post_media"]) {
      for (const [, roles] of all.matchAll(
        new RegExp(`GRANT\\s+[^;]*\\bON\\s+(?:TABLE\\s+)?public\\.${table}\\b[^;]*?TO\\s+([^;]+);`, "gi"),
      )) {
        if (/\b(anon|authenticated)\b/i.test(roles)) offenders.push(`${table} -> ${roles.trim()}`);
      }
    }
    expect(
      offenders,
      "A direct table grant defeats the whole design: RLS restricts which ROWS " +
        "a member may write, never which COLUMN VALUES, so an INSERT grant lets " +
        "them set state='ready' inline and publish unverified bytes. All member " +
        "access goes through media_begin_upload().",
    ).toEqual([]);
  });

  /** (2) Revoked from authenticated, not merely from anon. */
  for (const fn of WORKER_FNS) {
    it(`${fn}() is revoked from authenticated as well as anon`, () => {
      const revoked = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s*FROM[^;]*\\bauthenticated\\b`,
        "i",
      ).test(all);
      expect(
        revoked,
        `${fn}() is not revoked from authenticated by name. ALTER DEFAULT ` +
          `PRIVILEGES already granted it EXECUTE, and REVOKE ... FROM PUBLIC ` +
          `does not remove a grant held by a named role.`,
      ).toBe(true);
    });

    it(`${fn}() is never granted back to anon or authenticated`, () => {
      const bad = grantsFor(fn).filter((roles) => /\b(anon|authenticated)\b/i.test(roles));
      expect(
        bad,
        `${fn}() is granted to a member-reachable role. This function asserts ` +
          `that bytes were verified; a member who can call it can publish ` +
          `anything.`,
      ).toEqual([]);
    });
  }

  it("media_begin_upload is reachable by authenticated but not by anon", () => {
    const roles = grantsFor("media_begin_upload").join(" ");
    expect(roles, "media_begin_upload is not granted to authenticated — members cannot upload at all").toMatch(
      /\bauthenticated\b/,
    );
    expect(
      /\banon\b/.test(roles),
      "media_begin_upload is granted to anon. A logged-out visitor has no " +
        "reason to create media rows, and auth.uid() is NULL for them anyway.",
    ).toBe(false);
  });

  /** (3) The machine is a trigger, not a convention. */
  it("the state machine is enforced by a BEFORE UPDATE trigger on media_objects", () => {
    expect(
      /CREATE\s+TRIGGER\s+trg_media_state_transition[\s\S]{0,120}?BEFORE\s+UPDATE\s+ON\s+public\.media_objects/i.test(all),
      "trg_media_state_transition is missing. Without it, state is governed " +
        "only by its CHECK constraint, which permits pending -> ready — " +
        "verification becomes skippable.",
    ).toBe(true);
  });

  it("the legal-transition list does not allow skipping verification", () => {
    const fn = all.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.tg_media_state_transition[\s\S]*?\$\$([\s\S]*?)\$\$/i,
    )?.[1];
    expect(fn, "tg_media_state_transition body not found").toBeTruthy();

    // pending may become verified or quarantined. It may NOT become ready.
    const pendingEdge = fn!.match(/OLD\.state\s*=\s*'pending'\s+AND\s+NEW\.state\s+IN\s*\(([^)]*)\)/i)?.[1] ?? "";
    expect(pendingEdge, "no pending-state edge found in the transition guard").toMatch(/verified/);
    expect(
      /'ready'/.test(pendingEdge),
      "pending -> ready is listed as a legal transition. That is the exact " +
        "edge the state machine exists to forbid: it publishes bytes whose " +
        "hash was never recomputed server-side.",
    ).toBe(false);
  });

  it("owner_id and sha256 are frozen after insert", () => {
    const fn = all.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.tg_media_state_transition[\s\S]*?\$\$([\s\S]*?)\$\$/i,
    )?.[1] ?? "";
    expect(
      /NEW\.owner_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.owner_id/i.test(fn),
      "owner_id is mutable. A row could be verified honestly and then handed " +
        "to another member.",
    ).toBe(true);
    expect(
      /NEW\.sha256\s+IS\s+DISTINCT\s+FROM\s+OLD\.sha256/i.test(fn),
      "sha256 is mutable. A row could reach `ready` against one byte stream " +
        "and then claim a different one, making the verification meaningless.",
    ).toBe(true);
  });

  it("quarantine does not require a verification that never happened", () => {
    // The 20260814084711 constraint was `state = 'pending' OR verified_at IS NOT NULL`,
    // which forced a quarantined-from-pending row to carry a fabricated timestamp.
    const latest = [...all.matchAll(
      /ADD\s+CONSTRAINT\s+media_objects_verified_has_ts\s+CHECK\s*\(([\s\S]*?)\);/gi,
    )].pop()?.[1];
    expect(latest, "media_objects_verified_has_ts is never re-added").toBeTruthy();
    expect(
      /quarantined/i.test(latest!),
      "The verified_has_ts constraint does not exempt `quarantined`. Quarantine " +
        "is what happens when hash verification FAILS, so verified_at is " +
        "legitimately NULL — the constraint would only be satisfiable by writing " +
        "a timestamp asserting a verification that did not happen.",
    ).toBe(true);
  });
});
