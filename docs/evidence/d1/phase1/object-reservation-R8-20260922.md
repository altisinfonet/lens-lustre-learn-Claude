# D1 · OBJECT RESERVATION — P32 CORRECTION UNIT UNDER AUDITOR RULING R-8

**Author:** D1, 2026-09-22. **Posted before any SQL in this unit was written** (skill §3).
**Branch base:** `origin/staging` @ `0869a94bf7d61a625cb031995574013db031b05b`, fetched
2026-09-22T08:41:42Z — the commit that merged PR #274.
**Ordinals:** `0038` and `0039`, allocated by the Auditor under **R-8**. None self-selected.
`0032`–`0037` are released back to free and are **not** used by this unit.

---

## 0 · Re-verification before writing anything — §3, all five checks

Live staging `fpszggreishhuvdpkmdr`, `SELECT` only, **2026-09-22T08:42Z**:

| check | measured | expected by R-8 §0/§1 | |
|---|---|---|---|
| `schema_migrations` row count | **8**, latest `20260915130151` | 8, latest `20260915130151` | ✅ |
| `0027`/`0028`/`0029` dispatched | **0** | 0 — nothing from #274 has run | ✅ |
| hook: PUBLIC holds EXECUTE | **true** | true | ✅ |
| hook: `supabase_auth_admin` **NAMED** entry | **false** | false | ✅ |
| hook: `supabase_auth_admin` **effective** | **true** | true, *via PUBLIC* | ✅ |

```
password_verification_hook(jsonb) proacl, 2026-09-22T08:42Z
=X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
                                                                    ↑ no supabase_auth_admin= entry anywhere
```

**Nothing differs from §0/§1, so no STOP condition fired.** There is no race: `0029` has not been
dispatched, and this unit withdraws it before it can be.

---

## 1 · §3.1 — the generalised named-entry audit of merged `0027` and `0028`

The `0029` defect generalises to: *an effective privilege read as if it were a named grant.* Run
against the ACL array — not `has_function_privilege` — for **all 16 objects** in the two merged
migrations, 2026-09-22T08:42Z:

| unit | objects | `authenticated` named | `service_role` named | `anon` named | PUBLIC entries |
|---|---|---|---|---|---|
| `0027` | 11 of 11 | **true** | **true** | true | 1 |
| `0028` | 5 of 5 | **true** | **true** | true | 1 |

**No object in `0027` or `0028` carries the `0029` defect.** Every role either migration intends
to retain holds an entry of its own, so the revokes cannot take it away. Reported clean.

### 1.1 · But the *reasoning pattern* is the same, and that is worth recording

`0027` contains **zero `GRANT` statements**. It revokes PUBLIC and `anon` and retains
`authenticated` and `service_role` **by not revoking them** — retention by omission, which is
exactly the shape that failed in `0029`. It is correct here only because those named entries
happen to exist. `0028` does it the safe way: it revokes and then re-grants explicitly, so it would
be self-healing even if a named entry were missing.

The difference is not stylistic. **`0027` is correct by the shape of today's ACL, not by
construction.** Recorded for the Auditor; not fixed here (§8 — a defect outside this unit is
recorded, not fixed), and it is not a defect today.

One consequence of both, stated so it is not later mistaken for a fault: revoking PUBLIC on those
16 objects also removes `supabase_auth_admin`'s reach to them, because that role reaches them
through PUBLIC too. GoTrue calls exactly one function in this whole population — the hook — and
`0038` gives that one its named grant back. The other 16 are correct to lose it.

Minor, recorded: `0027` carries no `BEGIN;`/`COMMIT;` while `0028` does.

---

## 2 · Reservation table

### 2.1 · New applies — one object

| object + full signature | unit | ordinal | Set | lane profile | dispatch status |
|---|---|---|---|---|---|
| `password_verification_hook(event jsonb)` | corrected auth-hook closure | **`0038`** | **C** | staging-only | **NOT AUTHORIZED** — Owner Decision 1 |

### 2.2 · Prepared only — one object, ordinal reserved and **not** consumed

| object + full signature | unit | ordinal | Set | lane profile | dispatch status |
|---|---|---|---|---|---|
| `get_public_role_user_ids(_role text)` | — | **`0039` RESERVED, NOT CONSUMED** | **neither** — `provolatile = 's'` (STABLE) | — | **no migration authorized** — Owner Decision 6 |

### 2.3 · Withdrawal — no ordinal, no rollback

`20260910_0029_p32_auth_hook_and_role_enum_revoke.sql` → `UNAPPLIED_20260910_0029_…`.
A rename plus a header. The SQL body is **not** edited. Covers
`password_verification_hook(jsonb)` and `get_public_role_user_ids(text)`; the withdrawal returns
both to their pre-#274 file state.

### 2.4 · Rollback-only coverage — 16 objects, **no new applies, no new ordinals**

These rollbacks attach to the **merged** applies at their existing stems. The apply files are not
modified.

**`0027` — 11 objects:**
`admin_delete_auth_user(_uid uuid)` · `admin_purge_orphan_user_data(_uid uuid)` ·
`admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text)` ·
`admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)` ·
`approve_deposit(_admin_id uuid, _txn_id uuid)` ·
`create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)` ·
`expire_gift_credit(_gift_id uuid)` · **`request_withdrawal(_amount numeric, _bank_details jsonb)` — Set B** ·
`soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)` ·
`wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)` ·
`wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)`

**`0028` — 5 objects:**
**`admin_search_users(search_query text, search_by text)` — Set B** ·
`admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer)` ·
`admin_list_certificates(_query text, _type text, _limit integer, _offset integer)` ·
`admin_search_certificate_recipients(_query text, _limit integer)` ·
`generate_custom_url(_full_name text, _user_id uuid)`

**Total reserved: 18 objects** — 1 new apply, 1 prepared-only, 16 rollback-only (2 of which are
also covered by the `0029` withdrawal, counted once).

---

## 3 · Production — RELAYED, NOT MEASURED

`list_projects` returns one project, `fpszggreishhuvdpkmdr` (staging). Production
`jtdtehuqtinjxropkkcn` is not attached to this session's Supabase connector, and a developer
session never handles a connection string, secret or token (skill §10). Relayed from the Auditor's
two-lane diff:

| object | production ACL (relayed) | PUBLIC? | `supabase_auth_admin` named? |
|---|---|---|---|
| `password_verification_hook(jsonb)` | `postgres \| service_role \| supabase_auth_admin` | **NO** | **yes** |
| `request_withdrawal(numeric, jsonb)` | `postgres \| authenticated \| service_role \| anon` | **NO** | — |
| `admin_search_users(text, text)` | `postgres \| anon \| authenticated \| service_role` | **NO** | — |
| the 14 other Set C objects | already closed | — | — |

**This inversion is the whole reason `0038`'s rollback is hard**: staging has PUBLIC and no named
auth-admin grant; production has a named auth-admin grant and no PUBLIC. One file must be safe on
both. Carried forward as **BLOCKER-B**.

---

## 4 · Objects explicitly NOT reserved

- The 16 objects' **apply** files — merged, and §8 forbids editing them. Rollback only.
- `0029`'s SQL body — the withdrawal is a rename and a header, nothing else.
- `judging_write_decision_atomic`, the judging-lock functions, PR #276, PR #277's `0040`/`0041`,
  P33's `0031` — forbidden by §8 or owned by another unit.
- `src/**`, `docs/gates/**`, `docs/PROMOTION_LEDGER.md`, `useJudgingLock.ts` — not D1's, or
  forbidden.
- `package.json` / `package-lock.json` — dependency window CLOSED for Phase 1.
- `0002` (never created; reserved for the Revision 2 §4.2 re-cut) and `0023` (withdrawn,
  burned-or-reusable unruled).

---

## 5 · Ordinal state

`0038` and `0039` unused on `origin/staging` and `origin/main`, checked 2026-09-22T08:41Z.
`0032`–`0037` released by R-8 and unused — this unit writes none of them.
`0031` is P33's production `plpgsql_check` move. `0040`/`0041` belong to open PR #277.
Free after this unit: `0032`–`0037`, `0042`–`0099`.
