# VERIFY — HOTFIXES A / B / C / D / E (live revalidation)

**Mode:** READ-ONLY. All facts pulled live from `pg_proc.proacl`, `pg_policy`, `pg_roles` at report time. No writes, no migrations, no edits.

## Role OID decode (used below)

| OID | Role |
|---|---|
| 10 | supabase_admin |
| 16384 | postgres |
| 16480 | anon |
| 16481 | authenticated |
| 16482 | service_role |
| 36672 / 42907 | sandbox_exec\* (platform sandbox roles) |
| `0` | PUBLIC |

`PUBLIC` (oid 0) does **not** appear in any ACL row below ⇒ no public grant.

---

## HOTFIX-A — `public.wallet_transaction(...)` ACL

**Source query (live):** `aclexplode(pg_proc.proacl)` for `public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)`.

**Live ACL:** `postgres:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE, sandbox_exec*:EXECUTE`

| Grantee | Live | Expected (HOTFIX-A) |
|---|---|---|
| PUBLIC | absent | absent ✅ |
| anon | absent | absent ✅ |
| authenticated | **present** | expected absent ❌ |
| service_role | present | present ✅ |

- Unrelated objects changed: none observed for this function row.
- Rollback SQL: trivially `GRANT EXECUTE ON FUNCTION ... TO anon, PUBLIC;` (not needed unless reverting).
- **Verdict: HOLD — partial.** `anon`/`PUBLIC` are correctly revoked (containment objective met), but `authenticated` EXECUTE remains. This matches earlier "PARTIAL" classification, contradicts any report calling HOTFIX-A fully GREEN.

---

## HOTFIX-B — `public.competition_votes` DELETE policy removal

**Source query (live):** `pg_policy` joined to `competition_votes`.

**Live policies on `public.competition_votes`:**

| polname | cmd | roles | USING | WITH CHECK |
|---|---|---|---|---|
| no_self_vote | INSERT (`a`) | authenticated | — | `user_id=auth.uid() AND NOT EXISTS(self-entry)` |
| View vote counts (phase-gated) | SELECT (`r`) | authenticated | phase-gated expr | — |

- DELETE policy count: **0**.
- Unrelated objects changed: none observed on this table this turn.
- Rollback SQL: re-create the prior DELETE policy if it must return.
- **Verdict: GREEN.** HOTFIX-B holds — no DELETE policy is present; participants cannot delete vote rows via PostgREST. Server-side unvote must continue via `cast-photo-vote` edge fn (already required by `mem://features/wallet/unvote-penalty-ux`).

---

## HOTFIX-C — `public.emit_notification(...)` ACL

**Live ACL:** `postgres:EXECUTE, service_role:EXECUTE, sandbox_exec*:EXECUTE`

| Grantee | Live | Expected |
|---|---|---|
| PUBLIC | absent | absent ✅ |
| anon | absent | absent ✅ |
| authenticated | absent | absent ✅ |
| service_role | present | present ✅ |

- Unrelated objects changed: none observed.
- Rollback SQL: `GRANT EXECUTE ... TO authenticated, anon;` (not needed).
- **Verdict: GREEN.**

---

## HOTFIX-D — `public.send_notification_email()` ACL

**Live ACL:** `postgres:EXECUTE, service_role:EXECUTE, sandbox_exec*:EXECUTE`

| Grantee | Live | Expected |
|---|---|---|
| PUBLIC | absent | absent ✅ |
| anon | absent | absent ✅ |
| authenticated | absent | absent ✅ |
| service_role | present | present ✅ |

- Unrelated objects changed: none observed.
- **Verdict: GREEN.**

---

## HOTFIX-E — `public.backfill_judging_notifications(_window_days int, _dry_run bool)` ACL

**Live ACL:** `postgres:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE, sandbox_exec*:EXECUTE`

| Grantee | Live | Expected |
|---|---|---|
| PUBLIC | absent | absent ✅ |
| anon | absent | absent ✅ |
| authenticated | **present** | expected absent ❌ |
| service_role | present | present ✅ |

- Unrelated objects changed: none observed.
- Rollback SQL: `GRANT EXECUTE ... TO authenticated;` (not needed unless reverting).
- **Verdict: HOLD — partial.** Any logged-in user can currently invoke this admin/backfill function via PostgREST RPC. Containment for `anon` is met; containment for `authenticated` is **not** met. Contradicts any report marking HOTFIX-E fully GREEN.

---

## Summary table

| Hotfix | Containment from anon/PUBLIC | Authenticated-tight | Verdict |
|---|---|---|---|
| A wallet_transaction | ✅ | ❌ | **HOLD (partial)** |
| B competition_votes DELETE | n/a (policy removed) | n/a | **GREEN** |
| C emit_notification | ✅ | ✅ | **GREEN** |
| D send_notification_email | ✅ | ✅ | **GREEN** |
| E backfill_judging_notifications | ✅ | ❌ | **HOLD (partial)** |

No writes performed. No unrelated objects altered during this audit.
