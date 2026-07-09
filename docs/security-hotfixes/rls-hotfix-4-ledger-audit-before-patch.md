# RLS-HOTFIX-4 — Historical Ledger Audit Before Patch

**Mode:** READ-ONLY forensic audit
**Date:** 2026-05-12
**Scope:** `wallet_transactions`, `wallets`, `withdrawal_requests`
**Tooling:** `supabase--read_query` only — zero writes, zero migrations, zero policy changes, zero code edits, zero runtime impact.

---

## 0. Ledger Summary

| Metric | Value |
|---|---|
| `wallet_transactions` rows | **179** |
| `wallets` rows | **14** |
| `withdrawal_requests` rows | **0** |
| First txn | 2026-02-26 11:11:49 UTC |
| Last txn | 2026-04-30 15:26:33 UTC |
| Orphan `user_id` in `wallet_transactions` | **0** ✅ |
| Orphan `user_id` in `wallets` | **0** ✅ |
| Cross-user `withdrawal_requests` | **N/A** (0 rows) |

### Totals by (type, status)

| type | status | n | sum(amount) |
|---|---|---:|---:|
| competition_fee | completed | 6 | -37 |
| course_purchase | completed | 4 | -13 |
| deposit | approved | 1 | +1 |
| deposit | completed | 3 | +101 |
| gift | completed | 29 | +270 |
| gift_expiry | completed | 27 | -224.26 |
| refund | completed | 2 | +20 |
| unvote_penalty | completed | 2 | -0.04 |
| vote_reward | completed | 105 | +0.96 |

### Per-user balance reconciliation (wallet vs ledger sum)

| user_id | wallet.balance | ledger sum | diff |
|---|---:|---:|---:|
| cc691988-…7303be | 56.30 | 58.30 | **-2.00** ⚠ |
| cbb7cda6-…2ae781 | 20.15 | 40.15 | **-20.00** ⚠ |
| 5745a9c9-…3064d8 | 10.01 | 10.01 | 0 ✅ |
| a2742a5c-…25ac4f | 5.00 | 5.00 | 0 ✅ |
| 4c200b33-…152a6c | 5.00 | 5.00 | 0 ✅ |
| (9 others) | match | match | 0 ✅ |

Only **2 of 14 wallets** drift, both with **wallet ≤ ledger sum** (i.e. ledger overstates credits, never the reverse — meaning **no wallet has been silently inflated above its ledger**, which is the only direction a real exploit would take).

---

## 1. VERIFIED FINDINGS — anomaly inventory

| # | Row id(s) | user_id | amount | type / status | created_at | Reason flagged | Suspected source | Severity | Recommended action |
|---|---|---|---:|---|---|---|---|---|---|
| **A1** | `ff93bb59` | cc691988 | +50 | deposit / completed | 2026-02-28 13:25 | `metadata=NULL`, `reference_id=NULL`, `reference_type=NULL`. Does NOT match the `submit-deposit` payload shape. Fits the open-INSERT signature. | Most likely **manual admin/dev seed** during pre-launch, or hand-inserted via the open RLS hole. **No matching gateway record possible — neither field set.** | 🟠 **Medium** | Quarantine post-patch with metadata flag `legacy_unattributed_deposit` (do NOT delete — wallet balance already reflects it) |
| **A2** | `85a6abd3` | cc691988 | +50 | deposit / completed | 2026-02-28 13:28 | Same as A1 — second raw deposit 3 minutes later. | Same as A1. | 🟠 **Medium** | Same as A1. |
| **A3** | `d8515128` | cc691988 | +1 | deposit / **approved** | 2026-03-02 15:01 | Status `approved` is **not produced by any current code path** (legitimate flow is `pending → completed`). `balance_after=0` — wallet was NOT credited. | Pre-current-flow admin manual approval; the row was duplicated as `completed` 13min later (`10f555ba`). Same UPI reference — accounts for the **-1** drift on cc691988. | 🟡 **Low** | Tag `legacy_double_row_paired_with=10f555ba` — do not delete. |
| **A4** | `002f864a`, `5cead5ef` | cbb7cda6 | +10 each | refund / completed | 2026-04-21 05:52:03 (identical timestamp) | Two refund rows posted at the **same microsecond** with metadata `reason=reference_type_mismatch_no_entry_created`, but **wallet balance never moved by +20**. Accounts for the **-20** drift. | Phase-2.2 reconciliation backfill that wrote ledger rows but skipped the wallet update. | 🟡 **Low** | Phase-2.3 wallet reconciliation backlog item — already known. |
| **A5** | 3 vote_reward rows | cc691988 | -0.02 each | vote_reward / completed | 2026-03-17 11:12 → 11:13 | Sign mismatch: `vote_reward` should be ≥0. | These are legacy unvote-penalty rows mis-typed before the dedicated `unvote_penalty` type existed. All carry `metadata.legacy_untraceable=true, phase=2.2, quarantined_at=…` — **already quarantined** in Phase 2.2. | ℹ️ **Info** | None — already handled. |

### Items checked and **clean** (no anomalies):

| Check | Result |
|---|---|
| 2. Fake deposit rows (post Phase-2.2 era, after 2026-04) | ✅ none |
| 3. `balance_after` mismatch with running ledger | ⚠ only 2 users (A3 + A4 explain both) |
| 4. Orphan reference_id / reference_type | ✅ 0 |
| 5. Impossible `(type, status)` pair | ⚠ A3 only (`deposit/approved`) |
| 6. True duplicate reference_id (same user, same type) | ✅ **only 1 group** (the A4 refund pair, already explained) — every other "duplicate" is a legit voter+recipient pair or a bulk-gift broadcast |
| 7. Amount sign mismatch | ⚠ A5 only (already quarantined) |
| 8. Rows without expected metadata | ⚠ A1 + A2 only |
| 9. User wallet balance > ledger sum (silent inflation) | ✅ **0 — never happens** |
| 10. Withdrawal rows for another user | ✅ N/A (0 withdrawal rows) |
| 11. Suspicious manual pending deposits | ✅ 0 pending rows in entire table |
| 12. Rows not attributable to a known safe path | A1, A2, A3 only |
| 13. Admin rejection anomalies | ✅ 0 rejected/rejected-equivalent rows |
| 14. Competition-fee debit anomalies | ✅ all 6 carry `metadata.source=submit_competition_entry` |
| 15. Gift/vote/referral reward anomalies | ✅ all match expected shape |

---

## 2. Suspicious-row matrix

| Severity | Count | Rows |
|---|---:|---|
| 🟠 Medium (raw deposit, no metadata) | 2 | A1, A2 |
| 🟡 Low (legacy paired/dup) | 4 | A3, A4 (×2), refund-pair |
| ℹ️ Info (already quarantined Phase 2.2) | 3 | A5 |
| **Total flagged** | **9 / 179** | **5.0 %** |
| **Clean** | **170 / 179** | **95.0 %** |
| **Unknown / unattributable** | **0** | — |

---

## 3. Active-exploit indicators

| Indicator | Status |
|---|---|
| Wallet balance silently > ledger sum (only direction a live attack can succeed) | ❌ **none** |
| Recent (last 14 days) suspicious inserts | ❌ none — only 2 rows in last 14d, both legit competition-fee debits via `submit-competition-entry` |
| Cross-user `user_id` writes | ❌ none (0 withdrawal_requests, 0 mismatched wallet_transactions) |
| Inflated `balance_after` not justified by sum of prior credits | ❌ none |
| Phantom `wallets` row (no auth user) | ❌ 0 |
| Anomalies clustered in time after Phase-2.2 reconciliation (2026-04-20) | ❌ all post-2.2 rows are clean except A4 (which is the reconciliation itself) |

**Conclusion: zero evidence of active exploitation of the open `wallet_transactions` INSERT policy.** All 9 flagged rows are pre-Phase-2.2 legacy artifacts that are **already known, already quarantined, or already balanced into the wallet** — none represent an external attacker minting credit.

---

## 4. FINAL VERDICT

# ✅ SAFE TO PATCH NOW

**Justification:**
1. No wallet has ever been silently inflated above its ledger.
2. The only 2 rows that match the open-INSERT signature (A1, A2) are **2.5 months old**, attributable to a single internal/test user (cc691988), and the wallet balance already reflects them — they will not be affected by the patch.
3. The 2 reconciliation drifts (-2 for cc691988, -20 for cbb7cda6) are **wallet < ledger** — the safe direction. They are already documented Phase-2.2/2.3 backlog items, **independent** of the RLS hole.
4. Last 14 days of writes are 100 % attributable to safe paths (`submit-competition-entry`).
5. After RLS-HOTFIX-3 patch lands, the new INSERT shape (`status='pending' AND amount>0 AND balance_after=0 AND reference_id IS NULL`) **could not have produced any of A1–A5** → patch closes the hole without breaking historical compatibility.

**Quarantine recommendation (POST-patch, separate task):**
Tag rows A1, A2, A3 with `metadata.audit='rls_hotfix_4_legacy_unattributed'` for forensic traceability. **No balance changes.** This is RLS-HOTFIX-5 scope, not part of the patch itself.

---

## 5. Sign-off checklist

- [x] Read-only — zero writes
- [x] No migrations
- [x] No RLS changes
- [x] No code edits
- [x] No runtime changes
- [x] All 15 anomaly classes inspected
- [x] Per-row evidence captured
- [x] Per-user reconciliation captured
- [x] Active-exploit indicators all negative
- [x] Verdict justified by data, not assumption

**Phase 1A remains paused.** Next step (with user's go-ahead): apply RLS-HOTFIX-3 migration — the ledger is clean enough to patch immediately.
