/**
 * A MEMBER CAN TURN PUSH OFF.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on production 2026-08-02
 *
 * 12 members have a device registered and 62 notifications were created in the
 * last 24 hours. Push has been firing since it was repaired on 2026-08-01, and
 * **there was no way anywhere in the app to stop it.** An app that pushes with
 * no off switch is a store-compliance risk; the migration that introduced push
 * said so at the time.
 *
 * The six columns already existed and `push_on_notification()` already read
 * them. Nothing server-side changed to fix this — the switches were simply
 * never put on screen. Proven through the real trigger, inside a transaction
 * that was rolled back:
 *
 *     push_enabled = true,  push_comments = true   -> 1 push queued
 *     push_enabled = false                         -> 0 pushed
 *     push_comments = false                        -> 0 pushed
 *     after ROLLBACK: 0 queued, 0 probe rows, preferences untouched
 *
 * These tests pin the client half: that the six fields exist, default to the
 * same value the columns default to, and that the one column the trigger does
 * NOT read never becomes a switch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const hook = read("src/hooks/notifications/useNotificationPreferences.ts");
const page = read("src/pages/NotificationSettings.tsx");

/** Exactly the columns `push_on_notification()` reads. */
const HONOURED = [
  "push_enabled",
  "push_reactions",
  "push_comments",
  "push_friend_requests",
  "push_new_followers",
  "push_competition_updates",
];

describe("the preferences hook carries the push switches", () => {
  it.each(HONOURED)("%s is part of the preferences shape", (field) => {
    expect(hook).toContain(`${field}: boolean;`);
  });

  it.each(HONOURED)("%s defaults to on, matching the column default", (field) => {
    expect(hook).toMatch(new RegExp(`${field}:\\s*true,`));
  });

  it("reads a row written before these columns existed as ON, not OFF", () => {
    // `?? true` matches NOT NULL DEFAULT true. Without it an older row would
    // read as false and silently mute a member who never asked for that.
    for (const field of HONOURED) {
      expect(hook).toMatch(new RegExp(`${field}:\\s*\\(data as any\\)\\.${field} \\?\\? true`));
    }
  });
});

describe("the settings screen shows them", () => {
  it.each(HONOURED)("%s has a toggle bound to it", (field) => {
    expect(page).toMatch(new RegExp(`checked=\\{preferences\\.${field}\\}`));
    expect(page).toMatch(new RegExp(`toggle\\("${field}"\\)`));
  });

  it("greys the category switches out when the master switch is off", () => {
    const disabled = page.match(/disabled=\{!preferences\.push_enabled\}/g) ?? [];
    expect(disabled).toHaveLength(HONOURED.length - 1); // all but the master
  });
});

describe("no switch that does nothing", () => {
  it("never offers a new-posts toggle, because the trigger ignores that column", () => {
    // push_new_posts EXISTS in the table but push_on_notification() does not
    // read it — a new-post push falls through to "send to everyone" and is
    // governed only by push_enabled. Putting it on screen would be a control
    // that changes nothing, which is the whole fault this section removes.
    expect(page).not.toContain("push_new_posts");
    expect(hook).not.toContain("push_new_posts");
  });
});
