# P32 · money/account-control batch — evidence, 2026-09-17

Covers `supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql`,
its rollback, and `PROBE_p32_money_account_control_closed.sql`. First named
batch of P32. Read-only investigation and dry-run validation only — **nothing
in this document was applied to the live staging database.** The real apply
goes through `apply-migration.yml` after this PR is reviewed, per the
project's standing convention (see `2026-09-15-phase1-status-done-vs-pending.md`
in the project docs on the "process debt" of the four P30/P31 migrations
that were applied directly via a database connection instead).

## 1 · Reconciling "eight" against the live catalogue

`docs/ADDENDUM_A_EXECUTION_MASTER.md` states P32's gate as "the eight
unauthenticated volatile functions each closed, rate-limited, or justified
with a test." That figure is the Addendum's original planning estimate and
the Auditor's own frozen list, `docs/gates/P1-revocation-list.md` §0,
already corrected it once — correction C-58, 2026-09-04: "D1 measured 33
VOLATILE anon-executable functions where the register says eight... A sweep
sized for eight leaves twenty-five behind."

A fresh count against the live staging catalogue today, filtering to
non-trigger, VOLATILE, anon-executable functions in `public` (the same
method the census used):

```
{"total_anon_volatile":225,"trigger_fns":137,"rpc_reachable":88}
```

88, not 33 and not 8. The growth since 2026-09-04 is explained, not
mysterious: `docs/gates/GATE_REGISTER.md` F-62 and the project's Revision-3
draft (F-65) both establish that `ALTER DEFAULT PRIVILEGES` cannot subtract
from Postgres's built-in default ACL, only add to or retract its own
additions — so every function created since without an explicit REVOKE in
its own migration lands anon-executable by default. This file follows the
live catalogue over the Addendum's original headcount, exactly as the
Auditor's own C-58 correction already did once, and works the 88 in the
census's named groups rather than as a blind sweep.

## 2 · The group: 11 functions, zero anon-reachable callers

```
admin_delete_auth_user(uuid)
admin_purge_orphan_user_data(uuid)
admin_reject_wallet_transaction(uuid,uuid,text)
admin_wallet_credit(uuid,uuid,numeric,text,text,uuid,text,jsonb)
approve_deposit(uuid,uuid)
create_pending_deposit(uuid,numeric,text,text,jsonb,text)
expire_gift_credit(uuid)
request_withdrawal(numeric,jsonb)
soft_void_wallet_transactions(uuid[],text,uuid)
wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)
wallet_transaction(uuid,text,numeric,text,uuid,text,jsonb)
```

Fresh `grep -rn` across `src/`, `supabase/functions/` and `functions/`,
2026-09-17 — full caller inventory in the migration file's own header.
Summary: admin-panel UI (gated by the panel's own `has_role` checks),
authenticated member wallet hooks (`useWallet.ts`, `useWalletWithdrawals.ts`),
and `service_role` edge functions only. No caller reachable by a logged-out
visitor exists for any of the eleven.

**One finding along the way:** `docs/fix-sprints/phase-1a-wallet-authority-backlog.md:271`
(a PLAN-ONLY doc, zero migrations executed) claims `wallet_ledger_apply_v2`'s
"GRANT EXECUTE [is] restricted to service_role." The live catalogue disagreed
— PUBLIC and anon both held EXECUTE. Standing Rule 21: asserted from the
system, not the document; the function is in this batch because of what the
catalogue showed, not skipped because of what the doc claimed.

**Also confirmed not in conflict:** the separate, larger, unexecuted "Phase
1A canonical wallet authority convergence" plan
(`docs/fix-sprints/phase-1a-canonical-wallet-authority-plan.md`) eventually
intends to revoke `wallet_transaction` from `authenticated`/`service_role`
entirely (step `1A-E-1`) once a new canonical helper exists. This batch does
not touch, build toward, or conflict with that plan — it is strictly
narrower (public/anon only) and leaves `authenticated`/`service_role` for
that later, separate, structural work to revoke if and when it proceeds.

## 3 · Measured ACL, live staging `fpszggreishhuvdpkmdr`, 2026-09-17

All eleven, identical:

```
proacl = {=X/postgres,postgres=X/postgres,anon=X/postgres,
          authenticated=X/postgres,service_role=X/postgres}
aclexplode grantee=0 (PUBLIC) EXECUTE entries = 1
prosecdef = true, provolatile = 'v'
```

F-62 applies to all eleven: `REVOKE ... FROM anon` alone would be a no-op,
because PUBLIC holds the grant and anon inherits through it. Every statement
in the migration revokes PUBLIC first.

## 4 · Dry-run validation — fail-first, then pass, nothing left applied

All of the following ran via read/write SQL wrapped in an explicit
transaction that ended in `ROLLBACK`, against staging `fpszggreishhuvdpkmdr`.

**4a. Signatures resolve and match the live catalogue exactly** — every one
of the eleven `to_regprocedure(...)` calls resolved to a real oid; confirms
the argument-type lists in the migration file are byte-correct against the
actual function signatures, not transcribed from memory.

**4b. Fail-first — the probe's C2 check on the current, un-revoked state:**

```
ERROR:  P0001: C2 FAILED — anon can still EXECUTE
  public.admin_delete_auth_user(uuid) (oid 20386).
  acl = {=X/postgres,postgres=X/postgres,anon=X/postgres,
         authenticated=X/postgres,service_role=X/postgres}
```

The probe correctly detects the pre-revoke state and fails loudly on the
first function checked — a test that could not have failed is not evidence
(C-34); this one just failed, on the real object, before any change.

**4c. Pass-after — the migration's REVOKE statements plus the full probe
(C1 through C5, all eleven functions), inside the same rolled-back
transaction:** ran to completion with no exception and `checked = 11`. Every
one of C1 (signature resolves), C2 (anon closed), C3 (PUBLIC closed, no NULL
acl), C4 (authenticated and service_role retained), C5 (still SECURITY
DEFINER, still VOLATILE) passed for all eleven functions.

**4d. Confirmed no lasting change** — a fresh, separate read after both dry
runs shows all eleven functions still `anon_exec = true` on live staging:
nothing was applied outside the transactions above, and both transactions
ended in `ROLLBACK`.

## 5 · What this batch does not close

Remaining P32 scope, separate later migrations: identity/enumeration (9
functions), mail (5), competition-integrity (10), the three needing D2's
ruling (`get_broadcast_feed` × 3 overloads, `log_client_error`,
`log_app_event` — `increment_managed_page_view` was struck from this group
by the project's Revision-3 draft §2.2), and a written disposition for the
24 functions with zero callers anywhere in the tree.
