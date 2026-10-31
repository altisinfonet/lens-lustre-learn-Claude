/**
 * "🎉 Today is Neil Basu's Birthday" — the notification, end to end.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner request, 2026-08-04, in that exact wording. Decisions taken with him:
 *   recipients → accepted FRIENDS only · delivery → bell + push · email → none.
 *
 * THE TRAP THESE EXIST FOR, and it is not a small one:
 *
 * `get_notification_email_enabled()` ends in `ELSE true`, and
 * `send_notification_email` gates on nothing else — no template lookup, no
 * allow-list. Verified on production 2026-08-04. So ANY new notification type
 * emails every recipient by default. A birthday row would have sent an email to
 * every friend of every member with a birthday, every year, and nobody asked
 * for a birthday email at all.
 *
 * The suppression is `email_sent = true` on insert, because the email trigger's
 * first statement is `IF NEW.email_sent IS TRUE THEN RETURN NEW`. That is a
 * one-column change instead of rewriting a function 20+ other types depend on.
 * If someone "tidies" that flag away, birthday emails start going out silently
 * — hence a test.
 *
 * Push is the opposite case: it is WANTED, and `push_on_notification` also ends
 * in `ELSE true`, so it already works. Relying on a fall-through is the
 * "implicit behaviour" the owner's standing rules forbid, so it is stated.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getNotifLink } from "../notificationLinks";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SQL = read("supabase/migrations/20260804161000_birthday_notifications.sql");
/**
 * Comments (whole-line AND trailing) plus the `COMMENT ON` documentation string
 * are stripped — a source-pin test must never match its own explanation.
 */
const sql = SQL.replace(/^\s*--.*$/gm, "")
  .replace(/--.*$/gm, "")
  .replace(/COMMENT ON[\s\S]*?;/g, "");
const bell = read("src/components/NotificationBell.tsx");

describe("the sentence the owner asked for", () => {
  it("is written exactly once, in the database row", () => {
    expect(sql).toMatch(/'🎉 Today is ' \|\| r\.display_name \|\| '''s Birthday'/);
  });

  it("takes the name from notif_display_name, not from full_name", () => {
    // That function is where the owner's naming rules already live: full name
    // first, @username as fallback, an admin always shown as the brand. Reading
    // `full_name` here would have been a fourth place for them to drift.
    expect(sql).toMatch(/public\.notif_display_name\(p\.id\)/);
    expect(sql).not.toMatch(/\|\|\s*p\.full_name/);
  });

  it("needs no phrase in the TypeScript catalogue, and must not get one", () => {
    // Both surfaces fall back to the row's `message` when the type has no
    // phrase: the bell via describeNotification(), push via notif_push_body().
    // Adding an ACTION_CATALOG entry would switch the bell to "<name> <verb>"
    // and the two would disagree — the exact class of bug that catalogue was
    // built to end.
    const describe_ = read("src/lib/notifications/describe.ts");
    expect(describe_).not.toMatch(/\bbirthday\s*:/);
  });
});

describe("who receives it", () => {
  it("accepted friends only", () => {
    // 97 of 134 friendship rows on production are `pending`. Sending to those
    // would notify people who never accepted.
    expect(sql).toMatch(/f\.status = 'accepted'/);
  });

  it("reads the friendship from whichever side the celebrant is on", () => {
    expect(sql).toMatch(/f\.requester_id = c\.id OR f\.addressee_id = c\.id/);
    expect(sql).toMatch(/CASE WHEN f\.requester_id = c\.id THEN f\.addressee_id ELSE f\.requester_id END/);
  });

  it("never notifies the birthday member about themselves", () => {
    expect(sql).toMatch(/r\.user_id <> r\.actor_id/);
  });

  it("skips suspended recipients", () => {
    expect(sql).toMatch(/rp\.is_suspended = false/);
  });

  it("a member who chose 'only me' is not announced to anyone", () => {
    expect(sql).toMatch(/privacy_settings->>'dob_day_month', ''\), 'friends'\) <> 'only_me'/);
  });
});

describe("email must not go out", () => {
  it("inserts with email_sent already true", () => {
    // This is the whole suppression. See the header for why it is not a change
    // to get_notification_email_enabled.
    expect(sql).toMatch(/email_sent\)/);
    expect(sql).toMatch(/true\s*$/m);
    const insertCols = sql.slice(sql.indexOf("INSERT INTO public.user_notifications"), sql.indexOf("FROM recipients"));
    expect(insertCols).toMatch(/email_sent/);
  });

  it("adds no birthday email template", () => {
    // There are 9 templates and none of them is a birthday. Adding one would be
    // building a channel the owner did not ask for.
    expect(sql).not.toMatch(/email_templates/);
  });
});

describe("it cannot double-send", () => {
  it("carries a dedup key that is unique per celebrant, day and recipient", () => {
    expect(sql).toMatch(/'birthday:' \|\| r\.actor_id::text \|\| ':' \|\| to_char\(now\(\), 'YYYY-MM-DD'\) \|\| ':' \|\| r\.user_id::text/);
  });

  it("repeats the partial index predicate, or ON CONFLICT cannot infer it", () => {
    // uniq_user_notifications_dedup_key is `... WHERE dedup_key IS NOT NULL`.
    // Omitting the predicate makes the statement fail at runtime, on a cron job
    // nobody is watching.
    expect(sql).toMatch(/ON CONFLICT \(dedup_key\) WHERE dedup_key IS NOT NULL DO NOTHING/);
  });

  it("is scheduled once a day and replaces any earlier schedule", () => {
    expect(sql).toMatch(/cron\.schedule\(\s*'emit-birthday-notifications',\s*'30 3 \* \* \*'/);
    expect(sql).toMatch(/cron\.unschedule\('emit-birthday-notifications'\)/);
  });
});

describe("where it takes you when you tap it", () => {
  const PERSON = "11111111-1111-4111-8111-111111111111";

  it("opens the birthday member's profile, by NAME", () => {
    // reference_id is the celebrant, written by the emitter — and F-95 turned
    // the destination from `/profile/${reference_id}` into their name url. The
    // whole point of this notification is to go and wish them, so it still
    // opens the celebrant; it just no longer does it through a UUID.
    expect(getNotifLink({ type: "birthday", reference_id: PERSON, handle: "liwei" })).toBe("/liwei");
    expect(sql).toMatch(/r\.actor_id,\s*$/m);
  });

  it("F-95 — with no handle it goes to the feed, never to an id address", () => {
    const link = getNotifLink({ type: "birthday", reference_id: PERSON });
    expect(link).toBe("/feed");
    expect(link.startsWith("/profile/")).toBe(false);
  });

  it("does not fall through to the /dashboard catch-all", () => {
    // Eight types spent their whole lives landing there. Not a ninth.
    expect(getNotifLink({ type: "birthday", reference_id: PERSON })).not.toBe("/dashboard");
  });

  it("still has somewhere to go if reference_id is ever missing", () => {
    expect(getNotifLink({ type: "birthday", reference_id: null })).toBe("/feed");
  });
});

describe("it looks like a birthday in the bell", () => {
  it("has its own icon rather than the generic bell", () => {
    expect(bell).toMatch(/birthday: Cake,/);
  });

  it("has a category, so it groups with a heading like every other type", () => {
    expect(bell).toMatch(/birthday: "Birthdays",/);
  });
});
