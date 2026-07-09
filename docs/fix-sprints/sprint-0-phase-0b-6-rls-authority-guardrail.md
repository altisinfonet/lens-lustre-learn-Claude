# Sprint 0 — Phase 0B-6: RLS / SECURITY DEFINER Authority Guardrail

> **Status:** ✅ GUARDRAIL ACTIVE — non-runtime, detection only.
> **Mandate:** Forensic Engineering Mandate (Rules 1–5) fully enforced. Zero
> policy edits, zero migration edits, zero DB permission changes.

---

## 1. VERIFIED FINDINGS

A read-only forensic scan of every SQL file under `supabase/migrations/**` and
`supabase/functions/**/*.sql` (466 migration files at scan time) was executed
via `scripts/audits/rls-authority-scan.mjs`. The scan looks for **eight**
forbidden RLS / SECURITY DEFINER authority patterns and emits a frozen
baseline. Re-run on a clean tree returns **0 NEW violations** (proof below).

| Pattern | Type token | Baseline count |
|---|---|---:|
| 1. `SECURITY DEFINER` without auth guard | `SECDEF_NO_AUTH_GUARD` | **258** |
| 2. `SECURITY DEFINER` w/ writes but no audit path | `SECDEF_NO_AUDIT_PATH` | **18** |
| 3. `USING (true)` on sensitive table | `PERMISSIVE_USING_TRUE` | **1** |
|    `WITH CHECK (true)` on sensitive write policy | `PERMISSIVE_WRITE_TRUE` | 0 |
| 4. anon/public WRITE GRANT on protected table | `ANON_WRITE_GRANT` | 0 |
|    anon READ GRANT on sensitive table | `ANON_READ_GRANT_SENSITIVE` | **4** |
| 5. dangerous `::app_role` cast of user-controlled input | `DANGEROUS_ROLE_CAST` | 0 |
| 6. `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` | `RLS_DISABLED` | 0 |
| 7. public storage bucket on sensitive name | `PUBLIC_SENSITIVE_BUCKET` | 0 |

**Total baseline findings: 281** (severity: 0 CRITICAL · 259 HIGH · 22 MEDIUM ·
0 LOW). Subsystem distribution: judging 77 · competition 45 · admin 19 ·
certificates 13 · wallet 9 · notifications 7 · other/shared 111.

The dominant `SECDEF_NO_AUTH_GUARD` count reflects historical helper functions
(triggers, view-backing fns, stage-catalog readers) that legitimately operate
without a per-call `auth.uid()` check because they are invoked from inside
already-authenticated trigger contexts or are read-only utilities. **No new
finding may join this set without explicit review** — that is the contract.

---

## 2. NOT VERIFIED ITEMS

- **Per-finding intent classification** ("legitimate trigger helper" vs
  "actually-bug") is OUT OF SCOPE for Phase 0B-6. This phase is detection +
  freeze only. Reviewing each of the 281 baseline entries belongs to a later
  Phase 0C-* remediation pass.
- **Live DB policy state** was not queried — scan is migration-source-of-truth
  only. Drift between source migrations and live policies is also out of
  scope here.
- The scanner's "sensitive table" set is regex-based (substring match on
  domain keywords). It MAY underflag exotic table names. Adding new sensitive
  fragments is intentionally a one-line edit in the script.

---

## 3. FILES TOUCHED

| File | Action |
|---|---|
| `scripts/audits/rls-authority-scan.mjs` | **created** (320 lines, read-only scanner) |
| `scripts/audits/baselines/rls-authority-baseline.json` | **created** (281 frozen findings) |
| `.github/workflows/audit-forbidden.yml` | **edited** (+15 lines: new step "RLS / SECURITY DEFINER authority guardrail (Phase 0B-6)") |
| `docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md` | **created** (this report) |

**No** SQL migration was created or modified. **No** ESLint config, runtime
code, hook, edge function, or RLS policy was touched.

---

## 4. RULE IMPLEMENTED

`scripts/audits/rls-authority-scan.mjs` enforces the eight forbidden patterns
listed in §1. Each scanner is a focused regex over CREATE FUNCTION /
CREATE POLICY / ALTER TABLE / GRANT / `storage.buckets` blocks. The auth-guard
detector requires one of: `auth.uid()`, `has_role(...)`, `current_setting('request.jwt...')`,
`current_user`, `session_user`, or `app.current_admin`. The audit-path
detector requires writes into `db_audit_logs`, `activity_logs`,
`notification_emit_log`, `wallet_reconciliation_log`, or a call to
`emit_notification(...)`.

The "sensitive table" oracle matches against `judge*`, `wallet/ledger/payment`,
`notification`, `admin/role/audit`, `certificate`, `competition_entries`,
plus the `verification-originals`, `wallet-receipts`, and `judge-*` storage
bucket names.

---

## 5. BASELINE CREATED

`scripts/audits/baselines/rls-authority-baseline.json` — 281 entries, sorted
by stable key `file:line:type:name`. Schema:

```json
{
  "generated_at": "ISO-8601",
  "description": "...",
  "total": 281,
  "by_type": { "SECDEF_NO_AUTH_GUARD": 258, ... },
  "by_severity": { "HIGH": 259, "MEDIUM": 22 },
  "by_subsystem": { "judging": 77, ... },
  "findings": [
    {
      "file": "supabase/migrations/<x>.sql",
      "line": 42,
      "type": "SECDEF_NO_AUTH_GUARD",
      "severity": "HIGH",
      "subsystem": "judging",
      "table": null,
      "name": "public.fn_name",
      "snippet": "CREATE OR REPLACE FUNCTION ...",
      "mitigation": "audit-only" | "auth-guard-present" | "none",
      "key": "supabase/migrations/<x>.sql:42:SECDEF_NO_AUTH_GUARD:public.fn_name"
    }
  ]
}
```

Regeneration (after intentional, reviewed change):
`node scripts/audits/rls-authority-scan.mjs --write`

---

## 6. CURRENT ALLOWED VIOLATIONS COUNT

**281** (= baseline). A subsequent clean-tree run returns:

```
[rls-authority-scan] ✅ 0 NEW RLS authority violations (baseline=281, current=281)
```

---

## 7. SYNTHETIC FAILURE TEST RESULT

A throwaway migration `99999999999999_synthetic_phase0b6_test.sql` containing
all three high-impact patterns was planted, scanned, then removed.

```
[rls-authority-scan] ❌ 3 NEW RLS authority violation(s) beyond baseline:

  HIGH     SECDEF_NO_AUTH_GUARD         .../99999999999999_synthetic_phase0b6_test.sql:2  (other)
           CREATE OR REPLACE FUNCTION public.synthetic_bad_secdef(_uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER ...
  CRITICAL PERMISSIVE_WRITE_TRUE        .../99999999999999_synthetic_phase0b6_test.sql:13 (judging)
           synthetic_bad_open ON public.judge_decisions
  CRITICAL ANON_WRITE_GRANT             .../99999999999999_synthetic_phase0b6_test.sql:18 (wallet)
           GRANT INSERT ON public.wallet_transactions TO anon
```

Exit code: **1** (CI would block). Synthetic file removed; clean re-scan
returned `✅ 0 NEW`. Three patterns proven detectable end-to-end.

---

## 8. APPROVED PATTERN TEST RESULT

A throwaway migration `99999999999998_synthetic_phase0b6_pass.sql` containing
a properly-guarded SECURITY DEFINER function (auth-guard via `has_role` + DML
followed by a write to `db_audit_logs`) was planted and scanned:

```
[rls-authority-scan] ✅ 0 NEW RLS authority violations (baseline=281, current=281)
EXIT=0
```

Approved pattern correctly **not flagged**. File removed.

---

## 9. FINAL LINT/CI RESULT

- `node scripts/audits/rls-authority-scan.mjs` → exit 0 on clean tree.
- New CI step wired into `.github/workflows/audit-forbidden.yml` immediately
  before the v3 Stage Catalog parity step. The job already runs on every
  push and PR.
- No existing CI step was renamed, removed, or reordered.

---

## 10. DIFF SUMMARY

```
A scripts/audits/rls-authority-scan.mjs                               (~320 lines)
A scripts/audits/baselines/rls-authority-baseline.json                (281 findings)
A docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md     (this file)
M .github/workflows/audit-forbidden.yml                               (+15 lines, 1 new step)
```

---

## 11. RISKS

| # | Risk | Mitigation |
|---|---|---|
| R1 | False positives on legitimate trigger-context SECDEF helpers add noise | Already absorbed into baseline; only NEW additions block CI |
| R2 | A real bug exists inside the 281 baseline entries today | Out of scope — Phase 0C will triage; guardrail explicitly preserves status quo per mandate |
| R3 | Regex-based parser may miss exotic SECDEF declarations using non-`$$` dollar-quoting tags | Detector handles `$tag$ ... $tag$` form generically; uncommon tags possible but rare in this repo |
| R4 | A future intentional baseline regeneration (`--write`) without review could whitewash a real violation | `--write` is explicit and prints count; PR review on the JSON diff is the gate |
| R5 | The "sensitive table" substring oracle could miss new domain tables | Single-line edit in `SENSITIVE_TABLE_FRAGMENTS`; documented at top of script |

**No runtime risk.** Scanner is read-only, runs only in CI, and never touches
`migrations/`, `functions/`, RLS state, or live DB.

---

## 12. ROLLBACK PLAN

Single-step rollback if needed:

```bash
rm scripts/audits/rls-authority-scan.mjs
rm scripts/audits/baselines/rls-authority-baseline.json
rm docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md
# In .github/workflows/audit-forbidden.yml: remove the
# "RLS / SECURITY DEFINER authority guardrail (Phase 0B-6)" step
# (single contiguous block immediately above the v3 Stage Catalog parity step).
```

Zero DB / runtime / policy state to revert. No migrations to roll back.

---

## 13. NEXT RECOMMENDED STEP

Two options, both still under the AUDIT-ONLY freeze:

1. **GO 0B-7** — add the next read-only guardrail: **storage bucket public-flag
   drift** scanner (covers `verification-originals`, `wallet-receipts`,
   `judge-*` buckets and any future bucket toggled `public = true`). Mirrors
   the pattern established here.

2. **GO 0C-1** — start the first remediation: pick the single highest-severity
   site from Phase 0B-2's wallet baseline (`AdminTransactions.tsx` direct
   `wallet_transactions` update) and migrate it behind a server-side edge
   function. Strictly diff-captured, single-target, under existing guardrails.

Awaiting explicit go-signal.
