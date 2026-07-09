# NEXT SAFE ACTION ONLY

**Mode:** READ-ONLY recommendation. No writes performed.

## Recommended next action

**Close the `authenticated`-EXECUTE leg of HOTFIX-A on `public.wallet_transaction(...)`.**

Specifically: a single, narrowly-scoped migration that issues
```
REVOKE EXECUTE ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) FROM authenticated;
```
and nothing else.

## Why this is next

- It is the **smallest, highest-impact** containment gap of all live-verified items: financial ledger writer is currently RPC-callable by any logged-in user (R-OPEN-1).
- The complementary leak (`anon`/`PUBLIC`) is already closed, so this fix only removes the remaining direct-access role.
- It does **not** touch frontend, edge fns, RLS policies, or any other function. Edge fns that call `wallet_transaction` use `service_role` (unaffected).
- It is reversible in one line.

## Evidence supporting "next"

- `pg_proc.proacl` aclexplode (this session) shows `authenticated:EXECUTE` still present on `public.wallet_transaction`.
- No frontend caller of `supabase.rpc("wallet_transaction", …)` was found under `src/` in prior scans; all wallet writes go through edge fns under service role (`cast-photo-vote`, deposit handlers, etc.). A pre-write `rg` will reconfirm before applying.

## What must NOT be done yet

- **Do not** apply HOTFIX-F (judge_decisions view) — still pre-check only.
- **Do not** touch HOTFIX-E's `authenticated` leg in the same migration — bundle one risk per migration.
- **Do not** sweep the 173 anon-executable DEFINER functions — requires per-function triage.
- **Do not** modify `photo_verification_requests` workflow until R-OPEN-7 is investigated separately.
- **Do not** edit any frontend file in this step.
- **Do not** run any bulk `REVOKE … FROM authenticated` on schema-wide function lists.

## Operation classification

- Type: **WRITE** (single REVOKE; SECURITY DEFINER function ACL).
- Scope: 1 function signature.
- Dry-run availability: a pre-migration `rg "rpc(\"wallet_transaction\"" src/` and `pg_proc.proacl` snapshot suffice as dry-run.
- Rollback: `GRANT EXECUTE ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) TO authenticated;`

## Required approval phrase

Reply with **exactly**:

```
GO HOTFIX-A-CLOSE — APPLY REVOKE authenticated ON wallet_transaction
```

Until that phrase arrives, no write will be performed.
