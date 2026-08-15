/**
 * A NEW TABLE MAY NOT SILENTLY OPT OUT OF ACCOUNT DELETION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The deletion audit (docs/account-deletion-audit.md) measured the root cause:
 * only 28 foreign keys in the whole schema point at `auth.users` or `profiles`,
 * while 78 user-owned columns have none. So the database removes almost nothing
 * on its own, and deletion coverage is whatever somebody remembered to write by
 * hand — which means **a table added next month is uncovered by default, and
 * nothing says so**. That is how the existing 41-table gap accumulated: not by
 * one bad decision, but by forty small omissions nobody was told about.
 *
 * This gate stops the gap WIDENING while the owner decides what to do about the
 * part that already exists. It is deliberately forward-looking: it does not
 * fail on the historical 41 (that is a product and legal decision, recorded in
 * the audit, not something a test should force), but any NEW user-owned table
 * must declare how deletion reaches it.
 *
 * It is the same shape as newTableGrants.test.ts, which stops a new table
 * shipping readable by anonymous users — the lesson there was identical: the
 * dangerous default is the one nobody has to type.
 *
 * A new table satisfies this gate by either:
 *   a) declaring `REFERENCES auth.users(id) ON DELETE CASCADE` on the column
 *      (the database deletes it — preferred, because it cannot be forgotten), or
 *   b) being named in DELETION_HANDLED below, with a reason, meaning the
 *      deletion path removes it explicitly.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const MANDATE_FROM = "20260813000000";

/** Columns that mean "this row belongs to a member". */
const OWNER_COLUMNS = [
  "user_id", "owner_id", "author_id", "judge_id", "uploaded_by",
  "viewer_id", "actor_id", "member_id", "follower_id", "recipient_id",
];

/**
 * Tables whose rows are removed by the deletion PATH rather than by a cascade.
 * Every entry needs a reason, so that "it is in the list" can never be the
 * whole justification.
 */
const DELETION_HANDLED: Record<string, string> = {
  // (empty today — every in-scope table so far uses a cascade instead)
};

const inScope = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (f.match(/^(\d{14})/)?.[1] ?? "0") >= MANDATE_FROM)
  .sort();

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");

interface NewTable { file: string; table: string; body: string }

/** Every `CREATE TABLE public.x ( … )` block in the mandate window. */
function newTables(): NewTable[] {
  const out: NewTable[] = [];
  for (const f of inScope) {
    const sql = strip(readFileSync(join(MIGRATIONS, f), "utf8"));
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z0-9_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      // Walk to the matching close paren so nested parens (CHECK, REFERENCES)
      // do not truncate the body — a naive lazy match loses columns.
      let depth = 0, i = m.index + m[0].length - 1;
      for (; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") { depth--; if (depth === 0) break; }
      }
      out.push({ file: f, table: m[1], body: sql.slice(m.index, i + 1) });
    }
  }
  return out;
}

describe("account deletion cannot be silently opted out of", () => {
  const tables = newTables();

  it("the scanner actually finds the tables created in this window (vacuity guard)", () => {
    // If the CREATE TABLE regex ever stops matching, every assertion below
    // passes against an empty list and the gate is decorative.
    expect(
      tables.length,
      "No CREATE TABLE found in any in-scope migration. Either none exist " +
        "(check by hand) or the scanner is broken — and a broken scanner " +
        "makes this whole file pass while guarding nothing.",
    ).toBeGreaterThan(0);
    expect(tables.map((t) => t.table)).toContain("media_objects");
  });

  it("the body walker captures whole definitions, not a truncated prefix", () => {
    // Nested parens in CHECK/REFERENCES clauses break a lazy `[\s\S]*?\)` match,
    // which would hide the very columns this gate is looking for.
    // ⚠ First version of this assertion checked for `quarantine_reason` — a
    // column PRODUCTION has but this migration never created (it was added
    // later). Asserting against the live schema instead of the file under
    // test is the same class of mistake as measuring the wrong origin.
    // Anchor on the LAST constraint in the block, which sits past several
    // nested parens and so only survives if the walker really balanced them.
    const mo = tables.find((t) => t.table === "media_objects")!;
    expect(mo.body).toContain("media_objects_verified_has_ts");
    expect(mo.body.trimEnd().endsWith(")")).toBe(true);
  });

  it("every new user-owned table cascades from auth.users, or is explicitly handled", () => {
    const offenders: string[] = [];

    for (const t of tables) {
      for (const col of OWNER_COLUMNS) {
        const declared = new RegExp(`\\b${col}\\s+uuid\\b`, "i").test(t.body);
        if (!declared) continue;

        const cascades = new RegExp(
          `\\b${col}\\s+uuid[^,]*REFERENCES\\s+auth\\.users\\s*\\(\\s*id\\s*\\)[^,]*ON\\s+DELETE\\s+CASCADE`,
          "i",
        ).test(t.body);

        if (!cascades && !(t.table in DELETION_HANDLED)) {
          offenders.push(`${t.table}.${col}  (${t.file})`);
        }
      }
    }

    expect(
      offenders,
      "These new tables hold member-owned rows that account deletion would " +
        "leave behind, exactly as the existing 41-table gap did:\n" +
        offenders.map((o) => `  • ${o}`).join("\n") +
        "\n\nFix by adding REFERENCES auth.users(id) ON DELETE CASCADE to the " +
        "column, or — if the row must outlive the account — add the table to " +
        "DELETION_HANDLED with the reason why.",
    ).toEqual([]);
  });

  it("every DELETION_HANDLED entry carries a real reason", () => {
    for (const [table, reason] of Object.entries(DELETION_HANDLED)) {
      expect(reason.trim().length, `${table} is exempted with no reason`).toBeGreaterThan(20);
    }
  });

  it("the audit that explains the historical gap is present", () => {
    // This gate is only half the answer; the other half is the owner decision
    // recorded in the audit. If the audit disappears, the exemption for the
    // existing 41 tables loses its justification.
    const audit = readFileSync(join(process.cwd(), "docs/account-deletion-audit.md"), "utf8");
    expect(/41 tables/.test(audit)).toBe(true);
    expect(/bank_details/.test(audit)).toBe(true);
  });
});
