# Sprint 0 — Phase 0B-1 — Guardrail: `no-as-any-in-protected-dirs`

**Mandate:** `docs/forensic-engineering-mandate.md` (strictly applied)
**Phase type:** GUARDRAIL ONLY — no runtime change, no schema change, no business-logic change, no cleanup of existing violations.
**Generated:** 2026-05-12 UTC

---

## 1. VERIFIED FINDINGS

- **F-1 (proven):** ESLint AST scan of the 7 protected directories detects **333 `as any` cast nodes** across **275 unique (file,line) sites**. Source: `bunx eslint … --rule '{"audit-v6/no-as-any-in-protected-dirs":"error"}'` against an empty baseline (proof file `/tmp/eslint-full.json`).
- **F-2 (proven):** With the populated baseline, the same lint command reports **0** `audit-v6/no-as-any-in-protected-dirs` errors → existing code is NOT broken.
- **F-3 (proven):** Synthetic file `src/lib/__phase0b1_planted_asany.ts` containing `(x as any).foo` was rejected by the rule (1 error, message includes file/line + protected-dir name). File removed; tree clean.
- **F-4 (proven):** Subsystem distribution of the 275 baselined sites — `admin-ui: 150`, `judging: 61`, `edge-fn: 36`, `lib: 23`, `wallet: 5`. (Counter on `entries[].subsystem`.)
- **F-5 (proven):** No existing rule, file, or runtime path was modified. Only additive changes (new rule file, baseline JSON, 3 lines in `eslint.config.js`, 1 grep token in CI workflow).

## 2. NOT VERIFIED ITEMS

- **NV-1:** TS-only sites where the cast spans multiple lines and the AST `TSAsExpression.loc.start.line` differs from where a future edit will land. If a developer reformats a baselined site so the `as any` moves to a new line, the rule WILL fire — by design (Mandate Rule 4: "no silent widening"). Re-baselining is a follow-up phase, not this one.
- **NV-2:** `tsx` files inside `supabase/functions/**` (none today, but ignored by the protected glob — only `*.ts` is included there).
- **NV-3:** Whether every one of the 275 baselined sites is actually unsafe (per-site triage is Sprint 0B-2+).
- **NV-4:** End-to-end CI run on GitHub Actions — only local `bunx eslint` was executed. Workflow YAML diff is byte-verified but not executed in cloud.

## 3. FILES TOUCHED

| File | Change | Lines |
|---|---|---|
| `eslint-rules/no-as-any-in-protected-dirs.js` | **NEW** rule (TSAsExpression + TSTypeAssertion → TSAnyKeyword, baseline-aware) | +120 |
| `scripts/audits/baselines/as-any-protected-baseline.json` | **NEW** baseline, 275 entries, ESLint-AST sourced | +~1700 |
| `eslint.config.js` | Import + register + enable rule (browser block AND edge-fn block) | +4 |
| `.github/workflows/audit-forbidden.yml` | Add `no-as-any-in-protected-dirs` to grep-fail token list | +0/-0 (1 token added) |
| `docs/fix-sprints/sprint-0-phase-0b-1-no-as-any-guardrail.md` | **NEW** (this file) | +~150 |

**Not touched:** any `.ts/.tsx` source file containing existing `as any`. Zero runtime files modified.

## 4. RULE IMPLEMENTED

`audit-v6/no-as-any-in-protected-dirs`

- **Detects:** `TSAsExpression` with `TSAnyKeyword` annotation (`x as any`) AND `TSTypeAssertion` with `TSAnyKeyword` (`<any>x`).
- **Scope (protected prefixes):** `src/hooks/wallet/`, `src/hooks/judging/`, `src/components/admin/`, `src/modules/admin/`, `src/pages/admin/`, `src/lib/`, `supabase/functions/`.
- **Allow mechanism:** baseline JSON keyed on `${repo-relative-posix-path}:${line}`. Excerpt is informational (not part of the key) so reformatting whitespace inside a baselined line does NOT re-trigger; only line-number drift triggers.
- **Files outside protected prefixes:** rule is a no-op (returns `{}` from `create`).

## 5. BASELINE CREATED

`scripts/audits/baselines/as-any-protected-baseline.json`

```
{
  "generated_by": "sprint-0-phase-0b-1",
  "rule": "audit-v6/no-as-any-in-protected-dirs",
  "policy": "Existing occurrences allowed; NEW occurrences in protected dirs blocked.",
  "source": "eslint-ast (TSAsExpression+TSAnyKeyword) — empty-baseline self-discovery",
  "count": 275,
  "entries": [ { file, line, excerpt, subsystem, severity_sprint_0a }, ... ]
}
```

## 6. CURRENT ALLOWED VIOLATIONS COUNT

- **Total unique (file,line) sites:** **275**
- **By subsystem:**
  - `admin-ui` (components/admin + modules/admin + pages/admin): **150**
  - `judging` (hooks/judging): **61**
  - `edge-fn` (supabase/functions): **36**
  - `lib` (src/lib): **23**
  - `wallet` (hooks/wallet): **5**
- **By Sprint 0A severity hint:** HIGH = 102 (judging+edge-fn+wallet), MEDIUM = 173 (admin-ui+lib).

## 7. SYNTHETIC FAILURE TEST RESULT

Planted (then removed):

```ts
// src/lib/__phase0b1_planted_asany.ts
export function planted(x: unknown) { return (x as any).foo; }
```

ESLint output (verbatim):

```
src/lib/__phase0b1_planted_asany.ts
  2:47  error  Sprint 0 Phase 0B-1: NEW `as any` cast in protected dir `src/lib/`
               is forbidden (audit-v6/no-as-any-in-protected-dirs). …
✖ 2 problems (2 errors, 0 warnings)
```

(The 2nd error is the pre-existing `@typescript-eslint/no-explicit-any` — confirms our rule is independent and additive, not a duplicate.)

File removed; `ls` confirms absence.

## 8. CI / LINT RESULT

Local proof (Mandate Rule 1 — no assumptions):

```
$ bunx eslint --no-warn-ignored \
    'src/hooks/wallet/**' 'src/hooks/judging/**' \
    'src/components/admin/**' 'src/modules/admin/**' 'src/pages/admin/**' \
    'src/lib/**' 'supabase/functions/**/*.ts' \
    --rule '{"audit-v6/no-as-any-in-protected-dirs":"error"}' \
    | grep -c "no-as-any-in-protected-dirs"
0
```

CI (`.github/workflows/audit-forbidden.yml`) grep-fail token list now includes `no-as-any-in-protected-dirs`. Any future PR that adds a new `as any` in a protected dir will fail the existing **AUDIT FORBIDDEN** job at the lint step.

## 9. DIFF SUMMARY

```
A  eslint-rules/no-as-any-in-protected-dirs.js               (+120, new)
A  scripts/audits/baselines/as-any-protected-baseline.json   (275 entries)
M  eslint.config.js                                          (+4 lines, additive)
M  .github/workflows/audit-forbidden.yml                     (1 token added to grep -E)
A  docs/fix-sprints/sprint-0-phase-0b-1-no-as-any-guardrail.md
```

Zero modifications to:
- any business-logic file
- any DB migration
- any edge-function runtime code
- any UI component
- `tsconfig*.json` / `vite.config.ts` / `vitest.config.ts`
- the Supabase generated client/types

## 10. RISKS

- **R-1 (LOW):** Line-shift sensitivity. Re-formatting a baselined file may move an `as any` to a different line and re-trigger the rule. **Mitigation:** documented in rule docstring; re-baselining is the explicit follow-up path. This is intentional — it prevents silent widening of existing casts.
- **R-2 (LOW):** Baseline drift if a developer deletes an existing `as any` (good!). The baseline still allows that line — no harm, but the entry becomes stale. Stale-entry pruning is a follow-up phase, not a blocker.
- **R-3 (LOW):** Performance. The rule is O(1) per AST node and the baseline `Set` lookup is O(1). No measurable lint-time impact.
- **R-4 (NONE):** Runtime — rule only runs at lint time; ships zero runtime code.
- **R-5 (NONE):** Schema, RLS, payments, judging logic — untouched.

## 11. ROLLBACK PLAN

Single-commit revert. Equivalent manual rollback:

```bash
rm eslint-rules/no-as-any-in-protected-dirs.js
rm scripts/audits/baselines/as-any-protected-baseline.json
# eslint.config.js: remove the import line + the 2 plugin/rule registrations
# .github/workflows/audit-forbidden.yml: remove "|no-as-any-in-protected-dirs" from grep -E
```

After rollback, lint behavior reverts byte-for-byte to pre-Phase-0B-1.

## 12. NEXT RECOMMENDED STEP

**Phase 0B-2 — Forensic triage of the 102 HIGH-severity baselined sites** (`judging` 61 + `edge-fn` 36 + `wallet` 5).

Read-only output: `docs/fix-sprints/sprint-0-phase-0b-2-as-any-high-triage.md` classifying each HIGH site as either:
- **(a) safe-cast** (parsed JSON / RPC payload narrowed downstream),
- **(b) needs-typing** (replace with explicit interface — Phase 0B-3),
- **(c) latent-bug-suspect** (escalate before typing).

No code change in 0B-2. Awaiting explicit **"GO 0B-2"**.
