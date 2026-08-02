/**
 * THE PUSH BODY AND THE APP CANNOT DRIFT APART.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * The sentence a member reads exists in two languages. In the app it is built by
 * describe.ts. In a push it is built by the database — public.notif_push_body(),
 * added in migration 20260802090000_push_text_from_catalog.sql — because the
 * push is fired by an INSERT trigger that no TypeScript ever sees.
 *
 * Two copies of the same wording is exactly how the original bug happened: the
 * push said "commented on your post" while the app said "commented on your
 * photo", and nothing anywhere noticed for months.
 *
 * So this test reads the migration file as text and compares it, character for
 * character, against the catalog the app uses. Change a phrase in one place and
 * CI fails naming the other. That is the whole point — it is not testing SQL
 * behaviour (the database proves that), it is testing that two files agree.
 *
 * IF THIS TEST FAILS: you changed a phrase in one of the two places. Change it
 * in the other. Do not delete the test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_CATALOG,
  IMPERSONAL_TYPES,
  NAME_UNKNOWN,
  NAME_DELETED,
  actionPhrase,
} from "@/lib/notifications/describe";
import { BRAND_NAME } from "@/lib/adminBrand";

const MIGRATION = "supabase/migrations/20260802090000_push_text_from_catalog.sql";

const rawSql = readFileSync(join(process.cwd(), MIGRATION), "utf8");

/**
 * Strip `--` line comments before asserting on code. Learned the hard way on
 * 2026-08-01: a source-pin test matched its own explanatory comment and passed
 * while the code underneath was wrong.
 */
const code = rawSql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

/** The body of one SQL function, by name. */
function functionBody(name: string): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start, `${name} is not defined in ${MIGRATION}`).toBeGreaterThan(-1);
  const open = code.indexOf("$fn$", start);
  const close = code.indexOf("$fn$", open + 4);
  expect(close).toBeGreaterThan(open);
  return code.slice(open + 4, close);
}

/** { type -> phrase } as the DATABASE would answer it. */
function sqlPhrases(): Record<string, string> {
  const body = functionBody("notif_action_phrase");
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([^']*)'/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

describe("the push body speaks the same language as the app", () => {
  it("phrases exactly the same set of notification types", () => {
    expect(Object.keys(sqlPhrases()).sort()).toEqual(Object.keys(ACTION_CATALOG).sort());
  });

  it("uses byte-identical wording for every one of them", () => {
    const sql = sqlPhrases();
    for (const [type, entry] of Object.entries(ACTION_CATALOG)) {
      // `.one` and not `.many`: a push is a single event, so only the singular
      // form has a counterpart in SQL.
      expect(sql[type], `wording for "${type}"`).toBe(entry.one);
      // And prove the app really would say that, rather than trusting the object.
      expect(actionPhrase({ type, actors: [], actorCount: 0, eventCount: 1, createdAt: "" })).toBe(
        sql[type],
      );
    }
  });

  it("carries no phrase the app cannot produce", () => {
    for (const [type, phrase] of Object.entries(sqlPhrases())) {
      expect(ACTION_CATALOG[type], `SQL phrases "${type}" but the app does not`).toBeDefined();
      expect(phrase.endsWith(".")).toBe(true);
    }
  });
});

describe("the naming rules survived the trip into SQL", () => {
  const body = functionBody("notif_display_name");

  it("renders an admin as the brand, not a person", () => {
    expect(body).toContain(`'${BRAND_NAME}'`);
    expect(body).toContain("has_role");
  });

  it("uses the same two words for the two nameless states", () => {
    expect(body).toContain(`'${NAME_UNKNOWN}'`);
    expect(body).toContain(`'${NAME_DELETED}'`);
  });

  it('never says "Someone"', () => {
    // The word this whole exercise removed. It must not come back through SQL.
    expect(code).not.toMatch(/'Someone/);
  });

  it("prefers the full name, then the profile handle — the owner's order", () => {
    const full = body.indexOf("full_name");
    const handle = body.indexOf("custom_url");
    expect(full).toBeGreaterThan(-1);
    expect(handle).toBeGreaterThan(full);
  });
});

describe("no impersonal notification can have a person glued to the front of it", () => {
  it("keeps the two lists disjoint", () => {
    // "Your entry in Monsoon has been approved!" must never become
    // "A member Your entry in Monsoon has been approved!". In SQL that is
    // prevented by those types having no phrase at all, so the stored message
    // is used — which only holds while the two sets stay separate.
    for (const type of IMPERSONAL_TYPES) {
      expect(ACTION_CATALOG[type], `${type} is both impersonal and phrasable`).toBeUndefined();
    }
  });
});

describe("the trigger actually uses the composer", () => {
  const trigger = functionBody("push_on_notification");

  it("sends the composed sentence as the push body", () => {
    expect(trigger).toMatch(/'body',\s*public\.notif_push_body\(NEW\.type,\s*NEW\.actor_id,\s*NEW\.message\)/);
  });

  it("no longer sends the frozen message column", () => {
    // Comments are stripped above, so the "Was: COALESCE(NEW.message, '')" note
    // in the migration cannot make this pass by accident.
    expect(trigger).not.toMatch(/'body',\s*COALESCE\(NEW\.message/);
  });

  it("still refuses to push to the person who caused the event", () => {
    expect(trigger).toMatch(/NEW\.actor_id\s*=\s*NEW\.user_id/);
  });

  it("still swallows its own failures rather than breaking the insert", () => {
    expect(trigger).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(trigger).toContain("RAISE LOG");
  });
});
