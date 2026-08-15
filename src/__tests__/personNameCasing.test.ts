/**
 * THE NAME RULE EXISTS TWICE, SO THE TEST IS THAT THE TWO AGREE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER RULE, 2026-08-15: "Any name can not be ALL CAPS. User may write, type
 * or fetch from Google All Caps but it will Show in DB and UI Like Sentence
 * Case. AVIJIT SHEEL will be Avijit Sheel, SHIV SANKAR das will be Shiv Sankar
 * Das not Shiv sankar Das."
 *
 * Applied on production as `20260815075526_person_name_casing`: a BEFORE INSERT
 * OR UPDATE trigger on `profiles`, plus a backfill that corrected 15 of 94
 * names. The database is the one that decides. `src/lib/formatPersonName.ts` is
 * a SECOND copy of the same rule, so a name looks right while it is being typed
 * and so any name rendered from a source that has not been through the trigger
 * matches what is stored.
 *
 * Two copies of a rule diverge. That is recorded as a maintenance risk
 * elsewhere in this project (the privacy rule is written in five places, the
 * notification channel rule in two) and it applies here too. THIS FILE IS THE
 * MITIGATION: every fixture below is asserted against the TypeScript
 * implementation, and `personNameCasingSql.test.ts` — no, deliberately not a
 * second file: the SQL is asserted here too, by reading the applied migration
 * and checking the same decisions are present in it. A change to either has to
 * be made to both or this fails.
 *
 * THE FIXTURES ARE THE SPEC. Each one is here because a real name in the live
 * data or a real edge case made it necessary, and each is annotated with why.
 * Adding a case here without adding it to both implementations is the failure
 * this file is for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatPersonName } from "@/lib/formatPersonName";

/** [input, expected, why this case exists] */
const FIXTURES: [string, string, string][] = [
  // The owner's own two examples, verbatim from the instruction.
  ["AVIJIT SHEEL", "Avijit Sheel", "owner's example 1 — a real member, was ALL CAPS in production"],
  ["SHIV SANKAR das", "Shiv Sankar Das", "owner's example 2 — mixed input, every word capitalised"],

  // Live production names that were actually corrected by the backfill.
  ["sushanta das", "Sushanta Das", "LIVE MEMBER — proves `das` is a surname here, never lowercased as a particle"],
  ["SHARMISTHA DE", "Sharmistha De", "LIVE MEMBER — proves `de` is a surname here, never lowercased as a particle"],
  ["ATASHI DUTTA", "Atashi Dutta", "live member, ALL CAPS"],
  ["arghya chowdhury", "Arghya Chowdhury", "live member, all lowercase"],
  ["Tariqul hossain middya", "Tariqul Hossain Middya", "live member — MIXED case, which the first count of ALL-CAPS+all-lower missed"],

  // The two that would have been damaged by a naive rule.
  ["50mm Retina World", "50mm Retina World", "THE PLATFORM ACCOUNT — must survive untouched"],
  [
    "3D studio KOLKATA",
    "3D Studio Kolkata",
    "THE CASE THAT ACTUALLY NEEDS THE DIGIT GUARD — without it `3D` lowercases to `3d` and initcap leaves it there. The first version of this suite claimed 50mm was that case; it is not (initcap('50mm') is '50mm', verified on production), so removing the guard escaped the suite",
  ],
  [
    "SOMNATH PAL - AFIAP, AFIP, EFIP",
    "Somnath Pal - AFIAP, AFIP, EFIP",
    "FIAP photographic distinctions — title-casing them to `Afiap, Afip, Efip` demotes credentials the photographer earned",
  ],
  ["somnath pal, EFIAP", "Somnath Pal, EFIAP", "same protection with a comma separator instead of ` - `"],

  // Name shapes the rule must get right even though nobody has one yet.
  ["o'brien", "O'Brien", "apostrophe — capital after it"],
  ["D'SOUZA", "D'Souza", "apostrophe from ALL CAPS input"],
  ["anne-marie DUTTA", "Anne-Marie Dutta", "hyphen inside a first name is NOT a credentials separator"],
  ["JEAN-LUC picard", "Jean-Luc Picard", "hyphen plus mixed case"],
  ["mcdonald", "McDonald", "Mc is a prefix, not a word — initcap alone gives `Mcdonald`"],
  ["MCKENZIE ROY", "McKenzie Roy", "Mc from ALL CAPS input"],
  ["machado", "Machado", "`Mac` is deliberately NOT special-cased — this must stay Machado, not MacHado"],

  // Shape and emptiness.
  ["  ritam   dey  ", "Ritam Dey", "leading, trailing and doubled spaces are typos, never a style"],
  ["Avijit Sheel", "Avijit Sheel", "an already-correct name must be left exactly alone (idempotence)"],
  ["", "", "blank in, blank out — callers pass possibly-missing names straight through"],
  ["a", "A", "single character"],
];

describe("the name rule, TypeScript side", () => {
  for (const [input, expected, why] of FIXTURES) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(formatPersonName(input)).toBe(expected);
    });
  }

  it("passes null and undefined through untouched", () => {
    expect(formatPersonName(null)).toBeNull();
    expect(formatPersonName(undefined)).toBeUndefined();
  });

  it("is idempotent — running it twice changes nothing the second time", () => {
    // The trigger fires on every UPDATE of full_name, so a member editing
    // their bio re-runs this over an already-formatted name. If it were not
    // idempotent, names would drift on every save.
    for (const [input] of FIXTURES) {
      const once = formatPersonName(input);
      expect(formatPersonName(once), `not idempotent for ${JSON.stringify(input)}`).toBe(once);
    }
  });
});

/**
 * The SQL half. Resolved by CONTENT across all migrations, never by filename —
 * the connector renames migrations on apply (it renamed this one from
 * ...999999 to 20260815075526), so a filename-pinned test would pass forever
 * while pointing at nothing.
 */
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const nameMigration = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .find((sql) => /CREATE OR REPLACE FUNCTION public\.format_person_name/.test(sql));

describe("the name rule, SQL side", () => {
  it("a migration defines format_person_name", () => {
    expect(
      nameMigration,
      "no migration defines public.format_person_name — the TypeScript copy would be the only rule, " +
        "and the database would accept ALL CAPS again",
    ).toBeDefined();
  });

  it("keeps the three decisions the live data forced", () => {
    const sql = nameMigration!;
    // 1. digits: a word containing one is passed through untouched.
    expect(sql, "lost the digit guard — `3D` would lowercase to `3d`").toMatch(
      /_w\s*~\s*'\[0-9\]'/,
    );
    // 2. credentials suffix: split at the first " - " or "," and preserve it.
    expect(sql, "lost the credentials split — `AFIAP` becomes `Afiap`").toMatch(
      /regexp_match\(_clean,\s*'\^\(\.\*\?\)\(\\s\+-\\s\+\.\*\|\\s\*,\.\*\)\$'\)/,
    );
    // 3. Mc handled, Mac deliberately not.
    expect(sql, "lost the Mc prefix rule").toMatch(/\^Mc\[a-z\]/);
    expect(sql, "added a Mac rule — Machado and Macey would be broken by it").not.toMatch(
      /\^Mac\[a-z\]/,
    );
  });

  it("enforces the rule on write, not just once at backfill", () => {
    const sql = nameMigration!;
    // A backfill without a trigger fixes today and nothing after. Google OAuth
    // supplies whatever the member set on their Google account, and it is
    // frequently ALL CAPS.
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF full_name ON public\.profiles/i);
    expect(sql).toMatch(/UPDATE public\.profiles[\s\S]*SET full_name = public\.format_person_name/i);
  });

  it("does not normalise featured_artists or office_staff", () => {
    const sql = nameMigration!;
    // featured_artists.artist_name holds "SOMNATH PAL - AFIAP, AFIP, EFIP" and
    // is an editorial string, not a typed member name. office_staff holds one
    // already-correct admin row. Widening the trigger to either would be a
    // scope change nobody approved.
    expect(sql).not.toMatch(/ON public\.featured_artists/i);
    expect(sql).not.toMatch(/ON public\.office_staff/i);
  });
});
