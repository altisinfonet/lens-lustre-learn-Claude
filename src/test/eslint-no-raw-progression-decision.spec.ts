/**
 * Audit v6 B0.2 — RuleTester for `no-raw-progression-decision`.
 *
 * Locks:
 *   - .select("...progression_decision...") → error
 *   - .update / .insert / .upsert({ progression_decision: ... }) → error
 *   - .insert([{ progression_decision: ... }, ...]) → error
 *   - .rpc("name", { progression_decision: ... }) → error
 *   - DIR allowlist (hooks/judging/, components/admin/, etc.) → silent
 *   - FILE allowlist (SubmissionDetail.tsx, complete-round/index.ts) → silent
 *   - Benign forms (other columns, dynamic vars in select, computed keys) → silent
 */
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-raw-progression-decision.js";
import { describe, it } from "vitest";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

describe("audit-v6/no-raw-progression-decision", () => {
  it("RuleTester suite", () => {
    tester.run("no-raw-progression-decision", rule, {
      valid: [
        // Other columns are not flagged.
        {
          filename: "/repo/src/pages/SomePage.tsx",
          code: `q.select("id, status, current_round");`,
        },
        // Mutation with unrelated columns.
        {
          filename: "/repo/src/pages/SomePage.tsx",
          code: `q.update({ status: "draft", title: "x" });`,
        },
        // Dynamic select string — not literal, can't inspect.
        {
          filename: "/repo/src/pages/SomePage.tsx",
          code: `const cols = buildCols(); q.select(cols);`,
        },
        // Computed key with column name as identifier — skipped by design
        // (vanishingly rare; covered by no-raw-entry-status if member-read).
        {
          filename: "/repo/src/pages/SomePage.tsx",
          code: `const k = "progression_decision"; q.update({ [k]: "x" });`,
        },
        // RPC without object payload.
        {
          filename: "/repo/src/pages/SomePage.tsx",
          code: `supabase.rpc("get_x", { id: "abc" });`,
        },
        // Word-boundary safety — not the actual column.
        {
          filename: "/repo/src/pages/SomePage.tsx",
          code: `q.select("xprogression_decisionx");`,
        },
        // DIR allowlist — judging hooks may read/write the column directly.
        {
          filename: "/repo/src/hooks/judging/useFoo.ts",
          code: `q.select("id, progression_decision"); q.update({ progression_decision: "r1_accepted" });`,
        },
        // DIR allowlist — admin components.
        {
          filename: "/repo/src/components/admin/JudgingDriftAudit.tsx",
          code: `q.update({ progression_decision: row.expected_decision });`,
        },
        // DIR allowlist — Certificates page.
        {
          filename: "/repo/src/pages/Certificates.tsx",
          code: `q.select("id, progression_decision");`,
        },
        // FILE allowlist — SubmissionDetail.
        {
          filename: "/repo/src/pages/SubmissionDetail.tsx",
          code: `q.select("id, status, progression_decision");`,
        },
        // FILE allowlist — complete-round edge fn.
        {
          filename: "/repo/supabase/functions/complete-round/index.ts",
          code: `q.update({ status: "rejected", progression_decision: "r1_rejected" });`,
        },
      ],
      invalid: [
        // 1. .select("...progression_decision...")
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `q.select("id, progression_decision, title");`,
          errors: [{ messageId: "select" }],
        },
        // 2. .select with column at start.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `q.select("progression_decision");`,
          errors: [{ messageId: "select" }],
        },
        // 3. .update with shorthand identifier key.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `q.update({ progression_decision: "r1_rejected" });`,
          errors: [{ messageId: "mutation" }],
        },
        // 4. .insert with object.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `q.insert({ id: "x", progression_decision: "r1_accepted" });`,
          errors: [{ messageId: "mutation" }],
        },
        // 5. .upsert with object.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `q.upsert({ progression_decision: "r1_accepted" });`,
          errors: [{ messageId: "mutation" }],
        },
        // 6. .insert with array of objects.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `q.insert([{ id: "a" }, { progression_decision: "r1_accepted" }]);`,
          errors: [{ messageId: "mutation" }],
        },
        // 7. .rpc with payload containing the column.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `supabase.rpc("custom_fn", { progression_decision: "r1_accepted" });`,
          errors: [{ messageId: "rpc" }],
        },
        // 8. Quoted-key literal form in update payload.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: `q.update({ "progression_decision": "r1_accepted" });`,
          errors: [{ messageId: "mutation" }],
        },
        // 9. Template-literal column list in select.
        {
          filename: "/repo/src/pages/RandomPage.tsx",
          code: "q.select(`id, progression_decision, status`);",
          errors: [{ messageId: "select" }],
        },
        // 10. Edge fn outside the allowlisted writers.
        {
          filename: "/repo/supabase/functions/some-other-fn/index.ts",
          code: `q.update({ progression_decision: "r1_accepted" });`,
          errors: [{ messageId: "mutation" }],
        },
      ],
    });
  });
});
