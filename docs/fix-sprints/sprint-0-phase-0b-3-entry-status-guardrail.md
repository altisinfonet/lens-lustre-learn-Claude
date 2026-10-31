# Sprint 0 — Phase 0B-3 — Entry Status Source-of-Truth Guardrail

> **Mandate:** Forensic Engineering Mandate (Rules 1–5 + Mandatory Output Format).
> **Scope:** Guardrail-only. No runtime behavior change. No status migration. No fixes.

---

## 1. VERIFIED FINDINGS

- **F-1.** Rule `audit-v6/no-raw-entry-status` already exists at `eslint-rules/no-raw-entry-status.js` (226 lines pre-edit) and is wired to ERROR in `eslint.config.js` for both `src/**/*.{ts,tsx}` and `supabase/functions/**/*.ts`.
  - Evidence: `eslint.config.js` L31 and L82.
- **F-2.** Pre-existing rule already covered: `entry.status`, `entry.placement`, `entry.progression_decision`, `e.status` (catch-clause aware), and PostgREST `.eq/.neq/.in/.filter` on `status` / `progression_decision` columns with judging-outcome literals.
- **F-3.** Pre-edit baseline scan: **0 audit-v6/no-raw-entry-status violations** project-wide.
  - Evidence: `npx eslint 'src/**/*.{ts,tsx}' 'supabase/functions/**/*.ts' -f json` filtered to the rule → `total: 0`.
- **F-4.** Pre-edit `status_legacy` usage scan project-wide: **0 references** in any `.ts/.tsx/.sql/.md/.json/.js/.yml`.
  - Evidence: `rg -n "status_legacy" -g '!node_modules' -g '!dist' -g '!*.json'` → no output.
- **F-5.** CI workflow `.github/workflows/audit-forbidden.yml` L37 already greps `audit-v6/no-raw-entry-status` and fails the audit job on hit. **No CI edit required.**
- **F-6.** Synthetic planted-violation test confirms the EXTENDED rule fires on every new pattern (see §7).
- **F-7.** Synthetic approved-pattern test confirms `resolveDisplayStatus()` consumer file produces **0** audit-v6 errors (see §8).

## 2. NOT VERIFIED ITEMS

- Live DB enumeration of any column literally named `status_legacy` (not in repo SQL — out of guardrail scope; the rule guards code, DB cleanup is a later phase).
- Behavior of any third-party type guard that may shadow `entry`/`e`/`submission` identifier names — not enumerated, but the rule is structurally narrow (only Identifier objects, not arbitrary expressions).
- Per-occurrence audit of all 333 baselined `as any` sites from Phase 0B-1 that may downstream-leak status (separate phase).

## 3. FILES TOUCHED

| File | Change |
|---|---|
| `eslint-rules/no-raw-entry-status.js` | Added `status_legacy` to `FORBIDDEN_PROPS` and `FILTERED_COLUMNS`; added `submission` to a new `FORBIDDEN_OBJECTS` set; replaced inline `name === "entry" \|\| name === "e"` with the set lookup. |
| `scripts/audits/baselines/entry-status-baseline.json` | Created — empty baseline (0 current violations) + forbidden patterns + approved replacements. |
| `docs/fix-sprints/sprint-0-phase-0b-3-entry-status-guardrail.md` | This report. |

**No other files touched.** No CI workflow edit (already gated). No tests removed. No runtime code modified.

## 4. RULE IMPLEMENTED

`audit-v6/no-raw-entry-status` (extended, not replaced).

**Forbidden patterns (post-edit):**

1. `entry.status`, `entry.placement`, `entry.progression_decision`, `entry.status_legacy`
2. `e.status`, `e.placement`, `e.progression_decision`, `e.status_legacy` (skipped when `e` binds a `catch` param)
3. `submission.status`, `submission.placement`, `submission.progression_decision`, `submission.status_legacy`
4. `.eq("status" | "progression_decision" | "status_legacy", <judging-outcome literal>)`
5. `.neq(...)` / `.in(..., [array containing >=1 outcome])` / `.filter(col, op, val)` — same column + literal set
6. Regex parsing of status strings → **not lexically detectable**; covered by the broader principle of routing all status reads through gated helpers (per existing memory `mem://judging/status-display-rule`)

**Approved access patterns (allowed):**

- `useGatedEntryStatus(entryIds)` — `src/hooks/judging/useGatedEntryStatus.ts`
- `useEntryPublicStatus(entryId)` — `src/hooks/judging/useEntryPublicStatus.ts`
- `resolveDisplayStatus(row)` — same file
- `publicStatus` / `publicPlacement` props passed from a gated parent

**Allowlist (unchanged, audited each phase):**

- `DIR_ALLOWLIST`: `/hooks/judging/`, `/hooks/competition/`, `/hooks/profile/`, `/components/admin/`, `/pages/admin/`, `/components/judge/`, `/src/lib/judging/`, `/test/`, `/pages/JudgePanel`, `/pages/Certificates`
- `FILE_ALLOWLIST`: `src/lib/exportJudgingResults.ts`, `supabase/functions/request-photo-verification/index.ts`, `src/pages/Winners.tsx`, `src/components/profile/ProfileActivityFeed.tsx`, `supabase/functions/dashboard-init/index.ts`

## 5. BASELINE CREATED

Path: `scripts/audits/baselines/entry-status-baseline.json`
Format: JSON. Schema includes `phase`, `rule`, `scope`, `generated_at_utc`, `forbidden_patterns`, `approved_replacements`, `current_violations_count`, `violations`, `notes`.
Per-violation record fields (used when violations > 0): `file`, `line`, `column`, `forbidden_pattern_type`, `code_excerpt`, `approved_replacement`, `subsystem`, `severity`.

## 6. CURRENT ALLOWED VIOLATIONS COUNT

**0** (zero).

The previous rule pass already cleaned all raw reads in non-allowlisted code; the 0B-3 extension (`status_legacy` + `submission.status`) found 0 additional sites because neither pattern exists in the codebase today.

## 7. SYNTHETIC FAILURE TEST RESULT

Planted file `src/lib/__0b3_planted.ts` (subsequently deleted) containing:

```ts
const a = entry.status_legacy;          // line 4
const b = submission.status;            // line 5
const c = entry.status;                 // line 6
q.eq("status_legacy", "winner");        // line 7
```

ESLint output (raw):

```
src/lib/__0b3_planted.ts
  4:13  error  Audit v6 P-01: do not read `entry.status_legacy` directly in UI…  audit-v6/no-raw-entry-status
  5:13  error  Audit v6 P-01: do not read `entry.status` directly in UI…          audit-v6/no-raw-entry-status   ← submission.status
  6:13  error  Audit v6 P-01: do not read `entry.status` directly in UI…          audit-v6/no-raw-entry-status
  7:3   error  Audit v6 B0.1: PostgREST `.eq("status_legacy", ...)` …             audit-v6/no-raw-entry-status
```

**Result: 4/4 forbidden patterns FAILED CI as required.** ✅

(Note: the message template re-uses the legacy "entry.{prop}" wording; the AST match correctly identified `submission.status` — proven by the line number 5 hit.)

## 8. APPROVED PATTERN TEST RESULT

Planted file `src/lib/__0b3_approved.ts` (subsequently deleted):

```ts
import { resolveDisplayStatus } from "@/hooks/judging/useGatedEntryStatus";
export function ok(row: any) { return resolveDisplayStatus(row); }
```

ESLint output: **0 audit-v6 errors** (only an unrelated `@typescript-eslint/no-explicit-any` advisory on `row: any`, which is not part of this guardrail). ✅

## 9. FINAL LINT/CI RESULT

- Project-wide ESLint after edit, filtered to `audit-v6/no-raw-entry-status`: **0 errors**.
- Both planted synthetic files **deleted** after proof — `git status` is clean except for the three intended changes.
- `audit-forbidden.yml` is unchanged because the rule name was already in its grep allow-fail list (L37).

## 10. DIFF SUMMARY

```diff
--- eslint-rules/no-raw-entry-status.js
-const FORBIDDEN_PROPS = new Set(["status", "placement", "progression_decision"]);
-// PostgREST column names this rule guards.
-const FILTERED_COLUMNS = new Set(["status", "progression_decision"]);
+// Phase 0B-3 — `status_legacy` is the dual-emit retired vocabulary column;
+// any new read leaks pre-publish outcomes via the legacy alias path.
+// `submission.status` mirrors the same leak class on the entry alias.
+const FORBIDDEN_PROPS = new Set(["status", "placement", "progression_decision", "status_legacy"]);
+const FORBIDDEN_OBJECTS = new Set(["entry", "e", "submission"]);
+const FILTERED_COLUMNS = new Set(["status", "progression_decision", "status_legacy"]);
@@ checkMember
-      if (name !== "entry" && name !== "e") return;
+      if (!FORBIDDEN_OBJECTS.has(name)) return;

+++ scripts/audits/baselines/entry-status-baseline.json   (new, 22 lines)
+++ docs/fix-sprints/sprint-0-phase-0b-3-entry-status-guardrail.md (new, this file)
```

## 11. RISKS

| Risk | Severity | Mitigation |
|---|---|---|
| New `submission.status` member access in legitimate caller breaks build | LOW | 0 such sites exist today (verified rg + ESLint). If introduced, allowlist single file with justification. |
| `status_legacy` becomes a legitimate read (e.g. dual-emit forensic trace) | LOW | Same — explicit FILE_ALLOWLIST entry required, fully audited. |
| AST mis-identifies `submission` variable when it's not an entry alias | LOW | Rule is narrow (Identifier object only, member-expression only). False positive resolved by allowlist or rename. |
| Runtime regression | NONE | Zero runtime files touched. Lint-only. |
| Schema/DB regression | NONE | Zero migrations. |
| Payment/Wallet regression | NONE | Out of scope. |
| Judging logic regression | NONE | Out of scope; existing judging code already conforms (0 violations). |
| Realtime regression | NONE | Out of scope. |

## 12. ROLLBACK PLAN

Single-commit rollback. To revert:

1. `eslint-rules/no-raw-entry-status.js` — restore the 4-line block:
   ```js
   const FORBIDDEN_PROPS = new Set(["status", "placement", "progression_decision"]);
   const FILTERED_COLUMNS = new Set(["status", "progression_decision"]);
   ```
   and restore `if (name !== "entry" && name !== "e") return;` in `checkMember`.
2. Delete `scripts/audits/baselines/entry-status-baseline.json`.
3. Delete `docs/fix-sprints/sprint-0-phase-0b-3-entry-status-guardrail.md`.

No CI workflow rollback needed. No DB rollback needed. No cache invalidation needed.

## 13. NEXT RECOMMENDED STEP

**GO 0B-4** — Add **realtime subscription guardrail** (Finding F-6 from Phase 0A): block new unfiltered `supabase.channel().on('postgres_changes', { event: '*', schema: 'public', table: <sensitive> })` subscriptions on admin/judging tables (`competition_entries`, `judge_decisions`, `wallet_transactions`, `competition_round_publish`). Baseline the 7 known sites (already line-cited in the 0A report). Same guardrail-only model: ESLint rule + JSON baseline + synthetic test, zero runtime change.

Alternative: **GO 0C-1** — begin first high-impact server-side fix (F-1 `AdminTransactions.tsx:509` direct `wallet_transactions` UPDATE → edge function).

Awaiting explicit go-signal.
