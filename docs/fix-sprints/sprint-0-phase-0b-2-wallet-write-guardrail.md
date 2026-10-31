# Sprint 0 — Phase 0B-2: Wallet/Ledger Direct-Write Guardrail

**Status:** ✅ Implemented · guardrail-only · zero runtime change
**Mandate:** Forensic Engineering Mandate (`docs/forensic-engineering-mandate.md`)
**Predecessor:** Sprint 0 Phase 0B-1 (`no-as-any-in-protected-dirs`)
**Date:** 2026-05-12

---

## 1. VERIFIED FINDINGS

Repo-wide scan with `rg '\.from\("(<protected_table>)"\)'` (8 tables) located **8 call sites**, of which **4 are writes** (insert/update/delete). All 4 baselined.

| # | File | Line | Table | Op | Severity | 0A ID |
|---|------|------|-------|-----|----------|-------|
| W-1 | `src/hooks/wallet/useWalletWithdrawals.ts` | 56 | `withdrawal_requests` | insert | MEDIUM | — |
| W-2 | `src/hooks/wallet/useWalletWithdrawals.ts` | 73 | `withdrawal_requests` | delete | MEDIUM | — |
| W-3 | `src/components/AdminGiftCredit.tsx` | 193 | `gift_credits` | insert | HIGH | F-7 |
| W-4 | `src/components/admin/AdminTransactions.tsx` | 509 | `wallet_transactions` | update | **CRITICAL** | F-1 |

The remaining 4 protected-table call sites are pure `.select(...)` reads — **not** in scope for this rule.

## 2. NOT VERIFIED ITEMS

- Live RLS behaviour of W-1…W-4 (intentional — Phase 0C territory).
- Direct REST/PostgREST calls bypassing the JS SDK chain (rule is AST-based and only catches `.from("…").(insert|update|delete|upsert)(…)`).
- Edge functions (`supabase/functions/**`) — **deliberately exempt**; server-side mutations are the sanctioned path.
- Tests (`*.test.ts(x)` / `*.spec.ts(x)`) — exempt; fixture inserts are allowed.
- Whether F-1's `.update({ status:"rejected" })` call ever succeeds in production (RLS probe deferred).

## 3. FILES TOUCHED

| File | Change |
|------|--------|
| `eslint-rules/no-direct-wallet-ledger-writes.js` | **created** — custom ESLint rule (AST chain walker) |
| `scripts/audits/baselines/wallet-write-baseline.json` | **created** — 4-entry allowlist of existing writes |
| `eslint.config.js` | +3 lines — import + plugin registration + rule enable (browser + edge-fn blocks) |
| `.github/workflows/audit-forbidden.yml` | +1 token in grep regex (`no-direct-wallet-ledger-writes`) |
| `docs/fix-sprints/sprint-0-phase-0b-2-wallet-write-guardrail.md` | **created** — this report |

**No runtime files touched. No DB / RLS / edge-fn / payment / wallet logic touched.**

## 4. RULE IMPLEMENTED

`audit-v6/no-direct-wallet-ledger-writes`

**Scope:** all `*.{ts,tsx}` outside `supabase/functions/**` and outside test files.
**Detects:** any `CallExpression` whose callee identifier is `insert`, `update`, `delete`, or `upsert`, where the receiver chain contains `.from("<table>")` and `<table>` ∈ protected set.
**Suppression:** baseline match on `{file (repo-relative posix), line}`. Excerpt is informational.
**Failure message:** explicit Sprint reference + table + op + remediation guidance ("route through edge fn / RPC, or re-baseline in a follow-up phase").

Protected tables (8): `wallet_transactions`, `wallets`, `withdrawal_requests`, `wallet_reconciliation_log`, `competition_payment_details`, `competition_orders`, `gift_credits`, `raw_commitments`.

## 5. BASELINE CREATED

`scripts/audits/baselines/wallet-write-baseline.json` — 4 entries (W-1…W-4 above), each carrying file/line/table/operation/excerpt/severity/0A-finding-id/note.

## 6. CURRENT ALLOWED VIOLATIONS COUNT

**4 baselined sites · 0 unbaselined errors** in repo (`bunx eslint src/ supabase/functions/`).

## 7. SYNTHETIC FAILURE TEST RESULT

Created `src/lib/_synthetic_wallet_violation.ts` with three writes:
```ts
await supabase.from("wallet_transactions").insert(...);
await supabase.from("wallets").update(...);
await supabase.from("gift_credits").delete()...;
```
ESLint output (relevant lines):
```
5:9  error  …NEW client-side `insert` on protected table `wallet_transactions`…
6:9  error  …NEW client-side `update` on protected table `wallets`…
7:9  error  …NEW client-side `delete` on protected table `gift_credits`…
```
**Result: 3/3 expected violations fired. Synthetic file deleted. Re-lint clean (0 violations).**

## 8. FINAL LINT/CI RESULT

`bunx eslint src/ supabase/functions/ | grep no-direct-wallet-ledger-writes` → **empty (0 hits).**
CI grep gate (`audit-forbidden.yml`) updated to fail on the new rule ID.
No other audit-v6 rule, regression test, or vocabulary gate is impacted.

## 9. DIFF SUMMARY

```
A  eslint-rules/no-direct-wallet-ledger-writes.js          (+158 lines, new)
A  scripts/audits/baselines/wallet-write-baseline.json     (+50 lines,  new)
M  eslint.config.js                                        (+3  lines)
M  .github/workflows/audit-forbidden.yml                   (+0 net, regex extended)
A  docs/fix-sprints/sprint-0-phase-0b-2-wallet-write-guardrail.md
```

## 10. RISKS

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| False positive on a legitimate new write that should be allowed | LOW | Add to baseline with rationale + 0A finding link; require Phase tag in commit message |
| Rule misses a write phrased as `supabase['from']('wallet_transactions').insert(…)` (computed property) | LOW | Documented limitation; computed-property writes are non-idiomatic and reviewable |
| Rule misses raw-SQL / RPC mutations (`.rpc('wallet_transaction')`) | KNOWN / OUT OF SCOPE | RPC path is the sanctioned channel |
| Baseline line drift from unrelated edits to W-1…W-4 lines | MEDIUM | Drift fires the rule — intentional; treat as "edit = re-review" |
| ESLint version / plugin compat | LOW | Mirrors existing 0B-1 rule shape, already proven on this CI |

## 11. ROLLBACK PLAN

Single-commit revert. Specifically:
```
rm eslint-rules/no-direct-wallet-ledger-writes.js
rm scripts/audits/baselines/wallet-write-baseline.json
# revert eslint.config.js (remove import + 2 rule entries)
# revert audit-forbidden.yml regex (remove "|no-direct-wallet-ledger-writes")
# delete this report file
```
No DB, RLS, runtime, payment, or wallet behaviour to restore.

## 12. NEXT RECOMMENDED STEP

**Phase 0B-3 — `audit-v6/no-unfiltered-admin-realtime-on-sensitive-tables`** (read-only guardrail mirroring Sprint 0A finding F-6: 7 unfiltered realtime subscriptions on `user_roles`, `profiles`, etc.). Same shape as 0B-1 and 0B-2 — zero runtime change, baseline the existing 7, block new ones.

Alternative high-value path: **Phase 0C-1 — fix W-4 (F-1 CRITICAL)** — migrate `AdminTransactions.tsx:509` `wallet_transactions` UPDATE to a server-side `admin-update-deposit-status` edge function with reconciliation log entry. Requires explicit GO and is the highest-impact wallet-integrity fix surfaced by Sprint 0A.

Awaiting explicit **"GO 0B-3"** or **"GO 0C-1"**.
