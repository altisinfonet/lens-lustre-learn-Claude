---
name: ESLint forbidden-pattern coverage R6
description: audit-v6/no-raw-entry-status now scans src/lib/** and supabase/functions/**, with file-precise allowlist for the two legitimate raw readers
type: constraint
---
**Rule:** `audit-v6/no-raw-entry-status` runs against `src/**/*.{ts,tsx}` AND `supabase/functions/**/*.ts`. The previous broad `src/lib/**` directory allowlist is **gone** — replaced by a per-file allowlist.

**Allowlisted single-purpose readers (do not expand without audit):**
- `src/lib/exportJudgingResults.ts` — admin CSV export.
- `src/lib/judging/` (whole dir) — judging-internal helpers.
- `supabase/functions/request-photo-verification/index.ts` — server-side gate.

**Why:** Lint catches a planted raw `entry.status` / `entry.placement` / `entry.progression_decision` read anywhere in `lib/` or edge functions. Old leak bugs cannot be re-introduced. Proven via planted-then-removed violation files in R6 (see `scripts/audits/eslint_forbidden_extension_r6.md`).

**How to apply:** When adding new `lib/` or edge-function code, never read raw `entry.status|placement|progression_decision`. Use `useGatedEntryStatus` (UI) or accept already-gated values as parameters. If a new file legitimately needs raw access, add it to `FILE_ALLOWLIST` in `eslint-rules/no-raw-entry-status.js` with a one-line justification comment — never widen `DIR_ALLOWLIST`.

**Out of scope (R6):** Forbidden patterns #11 and #12 — undefined in repo, deferred per Mandate Rule 2.
