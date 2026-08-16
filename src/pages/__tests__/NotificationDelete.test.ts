/**
 * A MEMBER CAN REMOVE A NOTIFICATION — AND ONLY THEIR OWN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on production 2026-08-02
 *
 * There was no way to delete a notification anywhere in the app. Not a missing
 * button — a missing PERMISSION. `user_notifications` carried exactly three
 * policies: INSERT (admins), SELECT (own), UPDATE (own). **No DELETE policy at
 * all**, and with RLS on that means nobody could ever remove a row. The table
 * only grew: 994 rows, 207 of them older than 90 days, the oldest from March.
 *
 * The migration adds one policy, `auth.uid() = user_id`. Proven on production
 * inside a rolled-back transaction:
 *
 *     member deletes their own row          -> 1 deleted
 *     same member aims at another's rows    -> 0 deleted
 *     after ROLLBACK                        -> 994 rows, unchanged
 *
 * These tests pin the client half, and the one distinction that matters most:
 * **delete is not dismiss.** Marking read can be undone; deleting cannot. They
 * must never share a control.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n"));

const hook = read("src/hooks/notifications/useNotificationHistory.ts");
const page = read("src/pages/Notifications.tsx");
const bell = read("src/components/NotificationBell.tsx");
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260802190000_members_can_delete_own_notifications.sql"),
  "utf8",
)
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

describe("the permission that was missing", () => {
  it("grants DELETE, scoped to the row's owner", () => {
    expect(migration).toMatch(/CREATE POLICY[\s\S]*FOR DELETE/i);
    expect(migration).toMatch(/auth\.uid\(\)\)?\s*=\s*user_id/);
  });

  it("does not widen it to admins or to the actor", () => {
    // A notification belongs to the person it was sent to. Nobody else gets to
    // remove what landed in their inbox — not even an admin.
    const policy = migration.slice(migration.search(/CREATE POLICY/i));
    expect(policy).not.toMatch(/has_role|is_admin|actor_id/i);
  });
});

describe("delete really deletes", () => {
  it("issues a DELETE, not an is_read update", () => {
    expect(hook).toMatch(/export async function deleteGroup/);
    const fn = hook.slice(hook.search(/export async function deleteGroup/));
    expect(fn).toContain(".delete()");
    expect(fn).not.toContain("is_read");
  });

  it("does nothing when handed an empty list", () => {
    const fn = hook.slice(hook.search(/export async function deleteGroup/));
    expect(fn).toMatch(/if \(!notificationIds\.length\) return;/);
  });
});

describe("delete is not dismiss", () => {
  it("the history row offers it, wired to the delete call", () => {
    expect(page).toMatch(/onDelete=\{removeGroup\}/);
    expect(page).toMatch(/await deleteGroup\(/);
  });

  it("leaves the row on screen if the delete failed", () => {
    // A delete that appears to work and reappears on the next refetch is worse
    // than one that visibly did nothing.
    const fn = page.slice(page.search(/const removeGroup/));
    expect(fn.slice(0, fn.indexOf("};"))).toMatch(/catch\s*\{[\s\S]*return;/);
  });

  it("NEVER lets the bell delete anything — its X means mark read", () => {
    expect(bell).not.toContain("deleteGroup");
    expect(bell).not.toMatch(/from\("user_notifications"\)[\s\S]{0,80}\.delete\(\)/);
  });
});
