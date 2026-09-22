# D1 · OBJECT RESERVATION — P32 #274 RE-CUT UNDER AUDITOR ALLOCATION R-7

**Author:** D1, 2026-09-22. **Posted before any migration SQL in this unit was written** (skill §3).
**Branch base:** `origin/staging` @ `f0377afa29d61ea44cbed38b7ed6d38e296df225`, fetched
2026-09-22T06:44:30Z.
**Ordinals:** allocated by the Auditor under **R-7**. None self-selected.

---

## 0 · ⚠ FILENAME COLLISION WITH AN OPEN PR — RAISED, NOT WORKED AROUND

**PR #278** (`d1/P1-phase1-p32-forensics-20260922` @ `73483fd`, open, base `staging`) already adds a
file at **this exact path**. Verified 2026-09-22T06:45Z:

```
$ git ls-tree origin/d1/P1-phase1-p32-forensics-20260922 docs/evidence/d1/phase1/object-reservation-20260922.md
100644 blob bc355f2...    docs/evidence/d1/phase1/object-reservation-20260922.md
$ git ls-tree origin/staging docs/evidence/d1/phase1/
(empty — neither is on staging yet)
```

They are **different documents**: #278's is the *read-only analysis* reservation covering Sets A, B
and C (76 names, no ordinals, nothing dispatchable). This one is the *implementation* reservation
for 18 objects under R-7 ordinals. Both are legitimate; both want the same name.

**Whichever PR merges second will conflict.** This is exactly the two-author collision the
file-ownership rule exists to prevent, arriving via two in-flight PRs from one author rather than
two people.

**D1 has not resolved it**, because the path was named in the work order and renaming a file the
Auditor specified is not D1's call, and because a new naming convention is an Auditor decision
(work order §10 says so for rollbacks; the same logic holds here). Recorded as **BLOCKER-A**.
Two clean options, both the Auditor's: merge #278 first and have this branch rebase onto it, or
rename one of the two.

---

## 1 · Reservation table — all 18 objects

Lane profile and Set are taken from the **live staging catalogue**, re-verified by `SELECT` at
**2026-09-22T06:45Z**, not inherited from PR #274. `prosecdef = true` on all 18.

| # | object + full signature | unit | ordinal | Set | lane profile | dispatch status |
|---|---|---|---|---|---|---|
| 1 | `admin_delete_auth_user(_uid uuid)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 2 | `admin_purge_orphan_user_data(_uid uuid)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 3 | `admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 4 | `admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 5 | `approve_deposit(_admin_id uuid, _txn_id uuid)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 6 | `create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 7 | `expire_gift_credit(_gift_id uuid)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 8 | `soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 9 | `wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 10 | `wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)` | money / account-control | `0032` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 11 | `request_withdrawal(_amount numeric, _bank_details jsonb)` | withdrawal | `0033` | **B** | **both lanes** | prepared, not dispatched |
| 12 | `admin_list_certificates(_query text, _type text, _limit integer, _offset integer)` | identity group 2 | `0034` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 13 | `admin_search_certificate_recipients(_query text, _limit integer)` | identity group 2 | `0034` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 14 | `admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer)` | identity group 2 | `0034` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 15 | `generate_custom_url(_full_name text, _user_id uuid)` | identity group 2 | `0034` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 16 | `admin_search_users(search_query text, search_by text)` | admin user search | `0035` | **B** | **both lanes** | prepared, not dispatched |
| 17 | `password_verification_hook(event jsonb)` | auth hook | `0036` | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |
| 18 | `get_public_role_user_ids(_role text)` | — | `0037` **RESERVED, NOT CONSUMED** | **neither** | — | **no migration authorized** — Owner Decision 6 |

**18 objects. 17 in migration units, 1 prepared-only.** No object appears in two units.

---

## 2 · Measured starting ACL — staging, `SELECT` only, 2026-09-22T06:45Z

All **18** objects, without exception:

```
=X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

`prosecdef = true` · `public_entries = 1` (the leading `=X/postgres` **is** the PUBLIC grant) ·
`anon`, `authenticated`, `service_role` EXECUTE all `true`.

**This matches the work order §3's expected staging state on every one of the 18.** Verified, not
inherited from #274.

### 2.1 · Two measurements that decide migration design, both confirmed

| claim under test | measured | consequence |
|---|---|---|
| `get_public_role_user_ids` is `STABLE`, so it is in neither Set B nor Set C | **`provolatile = 's'`** — confirmed | Sets B and C are defined by `provolatile = 'v'`. This object is outside both. `0037` is reserved and **not consumed**; §12 of the work order holds. |
| `supabase_auth_admin` has **no named grant** on `password_verification_hook` on staging | **`authadmin_named = 0`**, while `has_function_privilege('supabase_auth_admin', …) = true` — confirmed | GoTrue reaches the hook on staging **only through PUBLIC**. Revoking PUBLIC without first adding the named grant breaks password verification on staging. `0036` must **ADD** the grant. |

### 2.2 · A detail worth stating so it is not mistaken for an oversight later

`authadmin_named = 0` on **all eighteen**, and `has_function_privilege('supabase_auth_admin', …)`
is `true` on all eighteen — for the same reason: PUBLIC grants to every role. So revoking PUBLIC in
`0032` and `0034` also removes `supabase_auth_admin`'s reach to those fourteen objects. **That is
correct and intended**: GoTrue calls exactly one of them, the hook, and only the hook gets the named
grant back. Recorded because "the auth admin lost access to thirteen wallet and admin functions"
would otherwise read as a defect on a later audit.

---

## 3 · Production — RELAYED, NOT MEASURED

`list_projects` returns exactly one project, `fpszggreishhuvdpkmdr` (staging), re-verified
**2026-09-22T06:45Z**. Production `jtdtehuqtinjxropkkcn` is **not attached to this session's
Supabase connector**, and a developer session never handles a connection string, secret or token
(skill §10). So every production figure below is **relayed from the work order §3 and the Auditor's
two-lane diff** and is labelled as such wherever it is used:

| object | production ACL (relayed) | PUBLIC held? |
|---|---|---|
| `request_withdrawal(numeric, jsonb)` | `postgres \| authenticated \| service_role \| anon` | **NO** |
| `admin_search_users(text, text)` | `postgres \| anon \| authenticated \| service_role` | **NO** |
| `password_verification_hook(jsonb)` | `postgres \| service_role \| supabase_auth_admin` | **NO** |
| the 14 Set C objects | already closed | — |

This is **BLOCKER-B**, carried forward unchanged from the 2026-09-22 forensics session.

**It is the reason the two-fixture validation in §15 of the work order exists**, and the reason it
is not optional: the production lane shape cannot be observed from here, so it is *reproduced* in a
fixture and the rollback is proved against it. A fixture is a weaker instrument than the live lane
and is declared as one.

---

## 4 · Objects explicitly NOT reserved by this unit

- `judging_write_decision_atomic`, the four judging-lock functions, PR #276's objects — forbidden
  by work order §17.
- P33's `0031`, `0040`, `0041` — a different unit (`0040`/`0041` are on open PR #277).
- `docs/gates/**`, `docs/PROMOTION_LEDGER.md`, `src/**`, `useJudgingLock.ts` — not D1's, or
  forbidden by §17.
- `package.json` / `package-lock.json` — the dependency window is **CLOSED** for Phase 1.
- `0002` (never created; reserved for the Revision 2 §4.2 re-cut) and `0023` (withdrawn,
  burned-or-reusable unruled). Neither is touched.

---

## 5 · Ordinal collision check

`git ls-tree origin/staging supabase/migrations/` at 2026-09-22T06:45Z: the Phase 1 block on
staging runs `0001`–`0026` with `0002` absent and `0019` duplicated. **`0032`–`0037` are unused on
`origin/staging`, on `origin/main`, and on every open D1 branch.** No collision.

`0038`–`0039` and `0042`–`0099` remain free and are not touched by this unit.
