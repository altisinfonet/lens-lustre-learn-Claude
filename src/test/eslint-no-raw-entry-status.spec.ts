/**
 * B0.1 — ESLint rule spec for `audit-v6/no-raw-entry-status`.
 *
 * Locks two enforcement axes:
 *   1) MemberExpression check (legacy P-01..P-06): `entry.status`,
 *      `entry.placement`, `entry.progression_decision`, plus single-letter
 *      `e.status` form.
 *   2) PostgREST string-filter check (B0.1 extension): `.eq / .neq / .in /
 *      .filter` on column `"status"` or `"progression_decision"` with a
 *      judging-outcome literal value.
 *
 * Allowlist axes also locked: DIR_ALLOWLIST + FILE_ALLOWLIST suppress both
 * checks for legitimate raw-access locations.
 */
import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-raw-entry-status.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("audit-v6/no-raw-entry-status", () => {
  it("runs RuleTester suite", () => {
    tester.run("no-raw-entry-status", rule, {
      valid: [
        // -- MemberExpression: non-targeted objects ignored.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `const x = app.status; const y = result.placement;`,
        },
        // -- MemberExpression: non-forbidden props ignored.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `const x = entry.title; const y = entry.id;`,
        },
        // -- DIR_ALLOWLIST suppresses both checks.
        {
          filename: "/repo/src/hooks/judging/useFoo.ts",
          code: `const x = entry.status; supabase.from("competition_entries").eq("status", "winner");`,
        },
        {
          filename: "/repo/src/components/admin/EntryRow.tsx",
          code: `const x = entry.placement;`,
        },
        // -- FILE_ALLOWLIST suppresses both checks.
        {
          filename: "/repo/src/lib/exportJudgingResults.ts",
          code: `const x = entry.status; q.eq("status", "winner");`,
        },
        // -- PostgREST: benign workflow values not flagged.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.eq("status", "submitted");`,
        },
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.in("status", ["draft", "submitted", "withdrawn"]);`,
        },
        // -- PostgREST: unrelated column not flagged.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.eq("verification_status", "winner");`,
        },
        // -- PostgREST: dynamic value (variable) not flagged — only literals.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.eq("status", someVar);`,
        },
        // -- B0.1 fix: caught Error params are not entries.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `try { doIt(); } catch (e) { return bad(e.message, e.status); }`,
        },
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `try { doIt(); } catch (entry) { console.log(entry.status); }`,
        },
        // -- B0.1 fix: new FILE_ALLOWLIST entries.
        {
          filename: "/repo/src/pages/Winners.tsx",
          code: `q.eq("status", "winner");`,
        },
        {
          filename: "/repo/src/components/profile/ProfileActivityFeed.tsx",
          code: `q.eq("status", "winner");`,
        },
        {
          filename: "/repo/supabase/functions/dashboard-init/index.ts",
          code: `const p = e.placement;`,
        },
      ],
      invalid: [
        // -- MemberExpression: classic leak.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `const x = entry.status;`,
          errors: [{ messageId: "raw" }],
        },
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `const x = entry.placement;`,
          errors: [{ messageId: "raw" }],
        },
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `const x = entry.progression_decision;`,
          errors: [{ messageId: "raw" }],
        },
        // Single-letter `e` form (map callbacks).
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `arr.map((e) => e.status);`,
          errors: [{ messageId: "raw" }],
        },
        // -- PostgREST string-filter (B0.1): .eq with judging outcome.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `supabase.from("competition_entries").eq("status", "winner");`,
          errors: [{ messageId: "filter" }],
        },
        // .neq with judging outcome.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.neq("status", "shortlisted");`,
          errors: [{ messageId: "filter" }],
        },
        // .in with at least one judging outcome.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.in("status", ["submitted", "winner"]);`,
          errors: [{ messageId: "filter" }],
        },
        // .filter(column, op, value) with judging outcome.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.filter("status", "eq", "finalist");`,
          errors: [{ messageId: "filter" }],
        },
        // progression_decision column also covered.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `q.eq("progression_decision", "qualified_r3");`,
          errors: [{ messageId: "filter" }],
        },
        // Template literal column name still detected.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: "q.eq(`status`, `winner`);",
          errors: [{ messageId: "filter" }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});
