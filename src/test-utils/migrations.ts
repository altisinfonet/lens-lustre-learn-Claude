/**
 * RESOLVING "THE MIGRATION THAT IS ACTUALLY LIVE", WITHOUT READING ONE THAT ISN'T.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Dozens of gates in this repository answer the question "what does the
 * database actually do today?" by reading `supabase/migrations/` and taking the
 * LAST file that defines a thing:
 *
 *     readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
 *
 * That is the right question — `CREATE OR REPLACE` means an earlier file's text
 * proves nothing about the function that is live. But `.endsWith(".sql")` is
 * not the set of files that ever ran.
 *
 * This directory also holds two kinds of file that are deliberately NOT part of
 * the migration sequence, marked by a filename prefix:
 *
 *   PROBE_*      read-only gate probes, dispatched by hand to MEASURE a
 *                database. They never define anything, but they quote bodies.
 *   UNAPPLIED_*  units that were withdrawn, superseded, or never dispatched —
 *                kept in the tree for the record, out of the runnable set.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A HELPER AND NOT A ONE-LINE FILTER IN EACH TEST
 *
 * ASCII sorts digits before uppercase letters. Every real migration starts with
 * a digit; `PROBE_` and `UNAPPLIED_` start with `P` and `U`. So an excluded file
 * does not merely join the candidate set — **it sorts last, and therefore wins
 * every "latest definition" resolver in the repository at once.**
 *
 * That is not hypothetical. On 2026-09-12 the 21,442-line schema bootstrap was
 * renamed `UNAPPLIED_…` to take it out of reach of the apply-migration.yml
 * dispatch box. It stayed in the directory, so it kept matching
 * `.endsWith(".sql")` — and, sorting after every dated file, it silently became
 * "the newest word" on every function it contains. Eight gate files went red at
 * once, all reporting the bootstrap's snapshot of a function instead of the
 * migration that actually last changed it. The assertions were fine; the
 * targets were wrong.
 *
 * The failure mode is worse when it is quiet. A resolver pointed at a file that
 * never ran can just as easily report GREEN — asserting a property of SQL no
 * database has executed. A gate that passes for a reason unrelated to what it
 * claims to check is the same class of defect as the `accept="image/*"` comment
 * trap documented in ./sourceText.ts, and it is why the exclusion lives in one
 * place with one name rather than being retyped per call site.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The one directory every migration gate reads. */
export const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/**
 * Filename prefixes this repository uses to mean "in the tree, not in the
 * sequence". Both are existing conventions — see
 * `UNAPPLIED_20260824000000_admin_user_list_pagination.sql` and
 * `PROBE_credential_connectivity_readonly.sql` — this helper only names them.
 */
export const NOT_IN_SEQUENCE_PREFIXES = ["UNAPPLIED_", "PROBE_"] as const;

/**
 * True when `filename` is a migration that is part of the runnable sequence.
 *
 * Prefix-anchored on purpose: `startsWith`, never `includes`. A dated migration
 * whose subject happens to contain the word "probe" is a real migration.
 */
export function isInSequence(filename: string): boolean {
  return !NOT_IN_SEQUENCE_PREFIXES.some((p) => filename.startsWith(p));
}

/**
 * Every `.sql` migration in the runnable sequence, sorted — the candidate set
 * for any "latest definition wins" resolution.
 *
 * Sorted here so no caller has to remember to; callers that want newest-first
 * should reverse the result rather than re-sorting.
 */
export function migrationsInSequence(dir: string = MIGRATIONS_DIR): string[] {
  return selectInSequence(readdirSync(dir));
}

/**
 * The selection itself, over a list of names — no filesystem.
 *
 * Split out so the ordering guarantee can be tested against a directory listing
 * that is NOT already sorted. `readdirSync` happens to return sorted entries on
 * the filesystems CI runs on, so a test that goes through the disk cannot tell
 * a working `.sort()` from a deleted one — an earlier version of this helper's
 * tests asserted sortedness twice and survived removing the sort outright.
 * POSIX guarantees no order, so the sort is real work on some machine.
 */
export function selectInSequence(filenames: string[]): string[] {
  return filenames
    .filter((f) => f.endsWith(".sql"))
    .filter(isInSequence)
    .sort();
}
