/**
 * READING A WITHDRAWN MIGRATION, WITHOUT PRETENDING IT IS STILL SQL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG (P10-F1)
 *
 * Four assertions in `adminCertificates.test.ts` and `certificateTiers.test.ts`
 * went red on 2026-09-24 and stayed red. Nothing they describe changed: R-70 §4
 * confirmed on the live staging database that `certificates.heading` exists and
 * that `admin_list_certificates` returns it. What changed is the FILE they read.
 *
 * #291 (D1 Unit C, `f6fe1a5`) neutralised three withdrawn certificate
 * migrations under rulings R-24 / R-26 by prefixing every line of each body
 * with `-- `. That ruling is right and stands: `apply-migration.yml` globs on
 * directory and extension, so an `UNAPPLIED_` prefix stops nothing, and a
 * withdrawn file that is still executable SQL is one typed path away from
 * running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FIX IS NOT "LET THE REGEXES TOLERATE `-- `"
 *
 * Look at which four failed, and the shape is the whole story. Every pattern
 * that spans a line break or anchors to the start of one died:
 *
 *     /if v_q = '' then\s*\n\s*return;/            `\s*` cannot match `-- `
 *     /^  heading         text,$/m                 `^  ` is now `-- ` + spaces
 *
 * and every pattern that lives inside ONE line still passed — against a line
 * that is now a comment. Those are the forty-six that stayed green, and they
 * stayed green by accident. They were not checking anything; they were matching
 * substrings in commented-out text.
 *
 * Loosening the four to accept a leading `-- ` would make the file uniformly
 * green and uniformly meaningless: fifty assertions reading a body that the
 * database has never seen in that form. That is the C-34 failure wearing the
 * opposite coat — not "a test that could not have failed", but a test that can
 * no longer fail for the reason it was written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES INSTEAD
 *
 * The neutralised file states its own recovery procedure, in its own header:
 *
 *     strip this block, then strip exactly three characters from the start of
 *     every remaining line, and the result is the original file.
 *
 *     sha256 of the original, before neutralisation (newline-preserving): …
 *
 * So this helper performs exactly that, and then CHECKS THE HASH. The
 * assertions go back to reading the SQL as written, and they gain a guard they
 * never had: if anyone edits the commented body, the recovered text stops
 * matching the recorded sha256 and every test using this helper fails loudly,
 * naming the file. Standing Rule 21 — the header is an instructing comment, and
 * therefore a control. Nothing checked it until now.
 *
 * The file stays neutralised. Nothing here writes to `supabase/**`, and nothing
 * here can execute SQL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS STILL DOES NOT PROVE, SAID PLAINLY
 *
 * These assertions read a WITHDRAWN file. They pin the text of a migration that
 * was never applied in this form, and the objects it describes are live on the
 * database all the same — `admin_search_certificate_recipients`,
 * `cleanup_certificate_references`, `certificates.heading`. No APPLIED file
 * under `supabase/migrations/` creates them; only these three withdrawn files
 * and the (also `UNAPPLIED_`) full-schema bootstrap mention them at all.
 *
 * That gap is real and is NOT closed here: it is a `supabase/**` question and
 * belongs to D1 and the Auditor. It is raised as a finding rather than papered
 * over, because a green suite that reads only withdrawn files would otherwise
 * read as coverage of the live schema, which it is not.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { MIGRATIONS_DIR } from "@/test-utils/migrations";

/** The last line of the neutralisation preamble, before the preserved body. */
const GUARD_END = "END $withdrawn$;";

/** `--     <64 hex>` on its own line, under the sha256 sentence in the header. */
const RECORDED_SHA = /sha256 of the original[^\n]*\n--\s+([0-9a-f]{64})/;

export interface MigrationText {
  /** Repo-relative path of the file that was read. */
  path: string;
  /** True when the file carries the R-24 / R-26 neutralisation preamble. */
  neutralised: boolean;
  /**
   * The SQL as it stood before withdrawal. For a file that was never
   * neutralised this is simply the file's contents.
   */
  sql: string;
  /** The sha256 the header records, when there is one. */
  recordedSha256: string | null;
}

/**
 * Recover the original body of a neutralised migration, verifying the hash the
 * file itself records.
 *
 * Throws rather than returning a best effort: a recovery that silently differs
 * from the recorded hash would hand every caller text that looks like SQL and
 * is not, which is the defect this whole file exists to avoid.
 */
export function recoverNeutralised(raw: string, path: string): MigrationText {
  const recorded = raw.match(RECORDED_SHA)?.[1] ?? null;
  const lines = raw.split("\n");
  const guard = lines.findIndex((l) => l.trim() === GUARD_END);

  if (guard === -1 || recorded === null) {
    return { path, neutralised: false, sql: raw, recordedSha256: recorded };
  }

  // The header's own instruction, followed literally: three characters off the
  // front of every line after the guard. Not `trimStart`, not a regex — the
  // leading whitespace of the original SQL is load-bearing for the `^  heading`
  // style assertions, and a forgiving strip would quietly eat it.
  const sql = lines.slice(guard + 1).map((l) => l.slice(3)).join("\n");
  const actual = createHash("sha256").update(sql, "utf8").digest("hex");

  if (actual !== recorded) {
    throw new Error(
      `${path}: the neutralised body no longer recovers to the sha256 its own ` +
        `header records.\n  recorded:  ${recorded}\n  recovered: ${actual}\n` +
        `The header promises the body is "recoverable byte for byte". Either the ` +
        `body was edited after neutralisation, or the preamble was. Both are ` +
        `D1/Auditor findings, not something a test should route around.`,
    );
  }

  return { path, neutralised: true, sql, recordedSha256: recorded };
}

/**
 * Read ONE file by its exact path and return its SQL as written, undoing
 * neutralisation when the file carries it.
 *
 * For a caller that already knows the filename — and asserts elsewhere that it
 * exists — resolution by fragment adds a failure mode and buys nothing. It also
 * reaches `supabase/rollback/`, which is not a migrations directory at all:
 * `UNAPPLIED_20260910_0023_…_ROLLBACK.sql` is neutralised the same way and is
 * read by `referralReward0023Withdrawn.test.ts`.
 */
export function sqlAsWritten(absolutePath: string): MigrationText {
  const shown = relative(process.cwd(), absolutePath).split("\\").join("/") || absolutePath;
  return recoverNeutralised(readFileSync(absolutePath, "utf8"), shown);
}

/**
 * Find one migration by a fragment of its filename and return its SQL, undoing
 * neutralisation when the file carries it.
 *
 * ── WHY THIS DOES NOT CALL `migrationsInSequence()` ──────────────────────────
 * `@/test-utils/migrations` exists because an `UNAPPLIED_`/`PROBE_` file sorts
 * after every dated migration and so wins every "latest definition" resolver.
 * That hazard does not apply here and the exclusion would be exactly wrong:
 * **the withdrawn file IS the subject.** What this takes from that helper is
 * the one thing it should not retype — `MIGRATIONS_DIR`, the single answer to
 * "where is the directory".
 *
 * The other half of that hazard is answered by refusing ambiguity instead of
 * resolving it: a fragment matching two files throws, rather than quietly
 * reading whichever the filesystem listed first. The two call sites this
 * replaced had no such check.
 */
export function migrationText(fragment: string, dir: string = MIGRATIONS_DIR): MigrationText {
  const matches = readdirSync(dir).filter((n) => n.includes(fragment));
  const shown = relative(process.cwd(), dir).split("\\").join("/") || dir;

  if (matches.length === 0) {
    throw new Error(`no migration under ${shown} matches "${fragment}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `"${fragment}" matches ${matches.length} files under ${shown}: ${matches.join(", ")}. ` +
        `Resolving this by taking the first would make the assertions below depend ` +
        `on directory order.`,
    );
  }

  return sqlAsWritten(join(dir, matches[0]));
}
