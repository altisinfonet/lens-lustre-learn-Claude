/**
 * TAGGED MEMBERS GET THE POST'S LIKE AND COMMENT NOTIFICATIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 2026-08-11, after being told that only the post owner was notified:
 *
 *   "Build like All tagged person will get all notification untill bering
 *    removed the tag. ... This is the normal you buld worng."
 *
 * The fan-out itself lives in the database (two plpgsql job handlers), which no
 * unit test can execute here. What a test CAN do — and what has caught real
 * bugs on this project twice — is pin the rules the SQL is written to, as text,
 * so that quietly deleting a guard fails CI instead of failing a member.
 *
 * The four rules that matter, and what breaks if each is lost:
 *
 *   1. only LIVE tags count — status IN ('pending','approved').
 *      Lose it and a member who removed themselves from a photo keeps getting
 *      its notifications forever, which is the opposite of what he asked for.
 *   2. the dedup key carries the RECIPIENT id.
 *      Lose it and the unique index uniq_user_notifications_dedup_key lets the
 *      FIRST tagged member through and silently swallows the other 18.
 *   3. actor, post owner and parent-comment author are excluded.
 *      Lose it and people get two notifications for one event.
 *   4. no email for these two types.
 *      Lose it and a post with 19 tags can send 480 emails.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THE FILE, NOT THE COMMENTS
 *
 * Every SQL assertion below runs against a comment-stripped copy. On 2026-08-01
 * and again on 2026-08-10 a source-scanning test on this project passed by
 * matching its own explanatory comment while the code underneath was wrong.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ACTION_CATALOG, describeNotification } from "@/lib/notifications/describe";
import { getNotifLink } from "@/lib/notificationLinks";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const MIGRATION = "20260811090000_tagged_members_get_post_notifications.sql";

const stripComments = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));

/** The body of one SQL function in that migration, by name. */
function fn(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start, `${name} is not defined in ${MIGRATION}`).toBeGreaterThan(-1);
  const open = sql.indexOf("$fn$", start);
  const close = sql.indexOf("$fn$", open + 4);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 4, close);
}

const reactionFn = fn("pj_handle_reaction_notification");
const commentFn = fn("pj_handle_comment_notification");

describe("the migration exists and is the newest word on these handlers", () => {
  it("is the last migration that redefines either handler", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) =>
        readFileSync(join(MIGRATIONS_DIR, f), "utf8").includes(
          "CREATE OR REPLACE FUNCTION public.pj_handle_reaction_notification",
        ),
      )
      .sort();
    expect(files[files.length - 1]).toBe(MIGRATION);
  });
});

describe("rule 1 — a tag only counts while it is live", () => {
  it("selects tagged members with status pending or approved, in both handlers", () => {
    for (const [name, body] of [
      ["reaction", reactionFn],
      ["comment", commentFn],
    ] as const) {
      expect(body, `${name} handler reads post_tags`).toContain("FROM public.post_tags");
      expect(body, `${name} handler filters on live status`).toMatch(
        /status\s+IN\s*\(\s*'pending'\s*,\s*'approved'\s*\)/,
      );
    }
  });

  it("never treats a removed or declined tag as live", () => {
    // "Remove tag of me" in PostCard writes status = 'removed'. If either word
    // appeared in the WHERE list, self-removal would stop working.
    expect(reactionFn).not.toMatch(/'removed'/);
    expect(reactionFn).not.toMatch(/'declined'/);
    expect(commentFn).not.toMatch(/'removed'/);
    expect(commentFn).not.toMatch(/'declined'/);
  });
});

describe("rule 2 — every tagged member gets their own row", () => {
  it("puts the recipient in the dedup key so the unique index cannot swallow 18 of 19", () => {
    expect(reactionFn).toMatch(
      /'tagged_post_reaction:'\s*\|\|\s*_reaction_id::text\s*\|\|\s*':'\s*\|\|\s*_tagged\.tagged_user_id::text/,
    );
    expect(commentFn).toMatch(
      /'tagged_post_comment:'\s*\|\|\s*_comment_id::text\s*\|\|\s*':'\s*\|\|\s*_tagged\.tagged_user_id::text/,
    );
  });

  it("writes one row per tagged member, in a loop", () => {
    expect(reactionFn).toContain("FOR _tagged IN");
    expect(reactionFn).toContain("END LOOP;");
    expect(commentFn).toContain("FOR _tagged IN");
    expect(commentFn).toContain("END LOOP;");
  });
});

describe("rule 3 — nobody is told the same thing twice", () => {
  it("excludes the actor and the post owner from the reaction fan-out", () => {
    expect(reactionFn).toMatch(/tagged_user_id\s*<>\s*_actor_id/);
    expect(reactionFn).toMatch(/tagged_user_id\s*<>\s*_post_owner/);
  });

  it("excludes the actor, the post owner and the parent-comment author from the comment fan-out", () => {
    expect(commentFn).toMatch(/tagged_user_id\s*<>\s*_actor_id/);
    expect(commentFn).toMatch(/tagged_user_id\s*<>\s*_post_owner/);
    expect(commentFn).toMatch(/tagged_user_id\s*<>\s*_parent_author/);
  });

  it("still writes the post owner's own row on the original type", () => {
    // The fan-out must be an ADDITION. If these vanished, the owner would stop
    // being notified about their own photo — the live behaviour before today.
    expect(reactionFn).toContain("'post_reaction'");
    expect(commentFn).toContain("'post_comment'");
    expect(commentFn).toContain("'comment_reply'");
  });

  it("keeps the owner's row guarded rather than returning early on a self-like", () => {
    // Changed deliberately: an owner liking their own photo used to RETURN
    // before anything else ran, which would have skipped the tagged people too.
    expect(reactionFn).toMatch(/IF\s+_post_owner\s*<>\s*_actor_id\s+THEN/);
  });
});

describe("rule 4 — the fan-out never sends email", () => {
  const emailFn = fn("get_notification_email_enabled");

  it("pins both new types to false", () => {
    expect(emailFn).toMatch(
      /_notif_type\s+IN\s*\(\s*'tagged_post_reaction'\s*,\s*'tagged_post_comment'\s*\)\s*THEN\s+false/,
    );
  });

  it("puts that rule before the catch-all that would let them through", () => {
    expect(emailFn.indexOf("tagged_post_reaction")).toBeLessThan(emailFn.indexOf("ELSE true"));
  });

  it("leaves every other type's email branch alone", () => {
    // A spot check that the reproduced function did not lose a rule in transit.
    expect(emailFn).toContain("email_reactions");
    expect(emailFn).toContain("email_comments");
    expect(emailFn).toContain("email_friend_requests");
    expect(emailFn).toContain("email_new_followers");
    expect(emailFn).toContain("email_competition_updates");
    expect(emailFn).toContain("email_certificates");
    expect(emailFn).toContain("email_gift_credits");
    expect(emailFn).toContain("email_course_updates");
    expect(emailFn).toMatch(/'new_competition',\s*'journal_published'\)\s*THEN\s+false/);
  });
});

describe("volume — 16 likes collapse into one bell line, as they do on your own photo", () => {
  const groupFn = fn("notif_group_key");

  it("adds both types to the grouped list", () => {
    expect(groupFn).toContain("'tagged_post_reaction'");
    expect(groupFn).toContain("'tagged_post_comment'");
  });

  it("keeps every type that was grouped before", () => {
    for (const t of [
      "post_reaction",
      "image_reaction",
      "post_comment",
      "image_comment",
      "comment_reply",
      "new_post_from_following",
    ]) {
      expect(groupFn, `${t} must stay grouped`).toContain(`'${t}'`);
    }
  });
});

describe("the app says whose photo it was", () => {
  it("does not claim the photo belongs to the tagged member", () => {
    expect(ACTION_CATALOG.tagged_post_reaction.one).toBe("reacted to a photo you are tagged in.");
    expect(ACTION_CATALOG.tagged_post_comment.one).toBe("commented on a photo you are tagged in.");
    expect(ACTION_CATALOG.tagged_post_reaction.one).not.toContain("your photo");
    expect(ACTION_CATALOG.tagged_post_comment.one).not.toContain("your photo");
  });

  it("uses no apostrophe, because the SQL twin is a single-quoted literal", () => {
    expect(ACTION_CATALOG.tagged_post_reaction.one).not.toContain("'");
    expect(ACTION_CATALOG.tagged_post_comment.one).not.toContain("'");
  });

  it("renders a whole sentence with the actor in front", () => {
    const d = describeNotification({
      type: "tagged_post_reaction",
      actors: [{ id: "a", fullName: "Partha Dalal" }],
      actorCount: 1,
      eventCount: 1,
      createdAt: new Date().toISOString(),
    });
    expect(d.text).toBe("Partha Dalal reacted to a photo you are tagged in.");
    expect(d.hasActor).toBe(true);
  });

  it("counts real events when the day's likes are grouped", () => {
    const d = describeNotification({
      type: "tagged_post_reaction",
      actors: [{ id: "a", fullName: "Partha Dalal" }],
      actorCount: 1,
      eventCount: 4,
      createdAt: new Date().toISOString(),
    });
    expect(d.text).toContain("4 times");
  });
});

describe("tapping the notification opens the post", () => {
  it("goes to the post, not the dashboard", () => {
    const POST = "11111111-2222-3333-4444-555555555555";
    expect(getNotifLink({ type: "tagged_post_reaction", reference_id: POST })).toBe(`/post/${POST}`);
    expect(getNotifLink({ type: "tagged_post_comment", reference_id: POST })).toBe(`/post/${POST}`);
    expect(getNotifLink({ type: "tagged_post_reaction", reference_id: POST })).not.toBe("/dashboard");
  });

  it("falls back to the feed when the post is gone", () => {
    expect(getNotifLink({ type: "tagged_post_reaction", reference_id: null })).toBe("/feed");
    expect(getNotifLink({ type: "tagged_post_comment", reference_id: null })).toBe("/feed");
  });
});

describe("the bell knows how to draw them", () => {
  const bell = readFileSync(join(process.cwd(), "src/components/NotificationBell.tsx"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("has an icon and a category for both types", () => {
    expect(bell).toMatch(/tagged_post_reaction:\s*Heart/);
    expect(bell).toMatch(/tagged_post_comment:\s*MessageCircle/);
    expect(bell).toMatch(/tagged_post_reaction:\s*"Photo Tags"/);
    expect(bell).toMatch(/tagged_post_comment:\s*"Photo Tags"/);
  });
});
