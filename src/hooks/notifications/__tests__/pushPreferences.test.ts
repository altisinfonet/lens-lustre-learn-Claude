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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const hook = read("src/hooks/notifications/useNotificationPreferences.ts");
const page = read("src/pages/NotificationSettings.tsx");

/**
 * Exactly the columns `push_on_notification()` reads.
 *
 * `push_new_posts` joined this list on 2026-08-02. It existed in the table from
 * the start but the trigger ignored it, so `new_post_from_following` — the
 * highest-volume push on the platform — fell through to "push to everyone" and
 * could only be silenced by killing every push. The toggle was held OFF the
 * screen until migration 20260802230000 taught the trigger to read it. Proven
 * on production, rolled back: on -> 1 push queued, off -> 0.
 */
const HONOURED = [
  "push_enabled",
  "push_reactions",
  "push_comments",
  "push_friend_requests",
  "push_new_followers",
  "push_competition_updates",
  "push_new_posts",
  /**
   * `push_announcements` joined this list on 2026-08-15, for the same reason
   * `push_new_posts` did in August: the two platform broadcasts
   * (`journal_published`, `course_published`) fell through the trigger's CASE
   * to `ELSE true`, so they reached every registered device and the only way
   * to stop them was to kill every push. Both are deliberately barred from
   * EMAIL under BUG-038 — a type kept out of the inbox was arriving on the
   * phone. The switch was held off the screen until migration
   * 20260815999999 taught the trigger to read the column.
   */
  "push_announcements",
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
  /**
   * The rule is not "never show this toggle" — it is "never show a toggle the
   * server ignores". So the toggle is allowed to exist only while the trigger
   * demonstrably reads the column. This reads the migration and fails if the
   * line is ever removed while the switch stays on screen.
   */
  const trigger = readFileSync(
    join(process.cwd(), "supabase/migrations/20260802230000_push_new_posts_switch_is_read.sql"),
    "utf8",
  )
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  /**
   * Same contract as the new-posts toggle above: the announcements switch is
   * allowed on screen only while a migration demonstrably teaches the trigger
   * to read its column. Resolved by CONTENT, not by filename, so renaming the
   * migration after a connector version drift cannot silently void it.
   */
  const announcementsMigration = readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) =>
      readFileSync(join(process.cwd(), "supabase/migrations", f), "utf8")
        .split("\n")
        .map((l) => l.replace(/--.*$/, ""))
        .join("\n"),
    )
    .find((sql) => /THEN\s+np\.push_announcements/.test(sql));

  it("only offers the announcements toggle because a migration makes the trigger read it", () => {
    expect(
      announcementsMigration,
      "no migration teaches push_on_notification() to read np.push_announcements, " +
        "so the switch on screen would do nothing",
    ).toBeDefined();
    expect(announcementsMigration!).toMatch(
      /WHEN NEW\.type IN \('journal_published','course_published'\)\s+THEN np\.push_announcements/,
    );
    expect(page).toContain("push_announcements");
  });

  it("keeps the master switch ahead of the announcements branch too", () => {
    const block = announcementsMigration!.slice(
      announcementsMigration!.indexOf("SELECT CASE"),
      announcementsMigration!.indexOf("INTO _allow"),
    );
    expect(block.indexOf("push_enabled = false")).toBeLessThan(
      block.indexOf("np.push_announcements"),
    );
  });

  it("does not let the announcements branch shadow an earlier category", () => {
    // The branch must sit BELOW the specific category branches, or it could
    // swallow a type that already has its own switch. `new_competition` is the
    // one that matters: it is also a broadcast, and it already has a switch
    // members understand.
    const block = announcementsMigration!.slice(
      announcementsMigration!.indexOf("SELECT CASE"),
      announcementsMigration!.indexOf("INTO _allow"),
    );
    expect(block.indexOf("np.push_competition_updates")).toBeLessThan(
      block.indexOf("np.push_announcements"),
    );
    expect(block.indexOf("np.push_announcements")).toBeLessThan(block.indexOf("ELSE true"));
  });

  it("only offers the new-posts toggle because the trigger reads that column", () => {
    expect(trigger).toMatch(
      /WHEN NEW\.type = 'new_post_from_following'\s+THEN np\.push_new_posts/,
    );
    expect(page).toContain("push_new_posts");
  });

  it("keeps the master switch ahead of every category, so it still silences all", () => {
    const caseBlock = trigger.slice(trigger.indexOf("SELECT CASE"), trigger.indexOf("INTO _allow"));
    expect(caseBlock.indexOf("push_enabled = false")).toBeLessThan(
      caseBlock.indexOf("np.push_new_posts"),
    );
  });
});
