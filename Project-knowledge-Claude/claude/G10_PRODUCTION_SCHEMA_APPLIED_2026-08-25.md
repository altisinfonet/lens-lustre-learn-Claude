# G10 — Production schema expand APPLIED and verified (2026-08-25)

Status vocabulary: VERIFIED / OWNER-ATTESTED / BLOCKED / NOT APPLICABLE.

---

## 1. What happened before this

Workflow run **32829440334** (`apply-migration.yml`, branch `main`, job "Apply SQL to
production") **FAILED in 9s at step 3, "Refuse to start without the database credential"**:

```
Error: SUPABASE_DB_URL is not set.
Error: Process completed with exit code 1.
```

`psql` never installed, never connected. **Nothing was applied by that run.**

### My error, stated plainly
I had read `apply-migration.yml` on `main` and knew step 3 is a hard guard on
`secrets.SUPABASE_DB_URL`. I issued the dispatch instruction **without first having the
existence of that repository secret confirmed** — a check that costs seconds and needs no
secret value (Settings → Secrets and variables → Actions lists names only). That
precondition belonged in the RC-1 preconditions list and was not there. The failed run is
attributable to that omission, not to the browser session.

### Second finding from the same run
Production's applied-migration history (`supabase_migrations.schema_migrations`, latest
`20260824145345 admin_user_lookup_by_email`) shows migrations **have** been reaching
production. `apply-migration.yml` on `main` has never had its credential. Therefore the
audited workflow route has, to date, **never been the route production migrations take**.
The control exists in the repository but is not the control in force. — VERIFIED.

---

## 2. Route taken (owner decision, 2026-08-25)

Owner chose: **apply via the Supabase MCP connector now**, fix the workflow control after.
This is the same route the previous production migration evidently used. It bypasses the
workflow's two-field confirm gate; that gate remains BLOCKED until the secret is set.

## 3. What was applied

Source of truth: `supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql`
on the promotion tree, git blob **`0cbf09296c3f3be5cf510c025a7236fa161c32ff`** — re-hashed
from the working copy immediately before applying and matched. — VERIFIED.

Lines 1–44 are comments (`0` non-comment, non-blank lines — checked). Statements applied
were lines 45–166 verbatim:

1. `create index if not exists idx_profiles_created_at_id_desc on public.profiles (created_at desc, id desc)`
2. `create or replace function public.admin_search_users_v2(_query, _by, _role, _badge, _limit, _offset)`
3. `revoke all … from public` / `revoke all … from anon` / `grant execute … to authenticated`

No `INSERT / UPDATE / DELETE / TRUNCATE / ALTER / DROP` anywhere in the file — the only
occurrences of those words are inside comment prose (lines 30 and 41). — VERIFIED.

---

## 4. Post-apply verification (all read-only, executed directly)

| # | Check | Result | Status |
|---|---|---|---|
| 1 | `admin_search_users_v2` exists on production | args `_query, _by, _role, _badge, _limit, _offset` — exact | VERIFIED |
| 2 | SECURITY DEFINER + `search_path=public` | `prosecdef=true`, `proconfig={search_path=public}` | VERIFIED |
| 3 | v1 `admin_search_users` present and unaltered | `search_query text, search_by text`, def md5 `a99dad8ab65c4674123d3ed0ddb4d9ef` | VERIFIED |
| 4 | Definition identical across lanes | production md5 `e782b9806fb2b75f58082c7d9bcebecf` = staging md5 `e782b9806fb2b75f58082c7d9bcebecf` | VERIFIED |
| 5 | Grants | `authenticated` EXECUTE; **no `anon`, no `PUBLIC`**; `postgres`/`service_role` only — byte-identical grantee set to staging | VERIFIED |
| 6 | Authorization gate fires | unauthenticated caller → `P0001: Not authorized` (RAISE, line 8) | VERIFIED |
| 7 | Index created | `idx_profiles_created_at_id_desc` present on `public.profiles` | VERIFIED |
| 8 | No application data changed | auth.users 103, profiles 103, posts 278, user_roles 105, judge_decisions 0 — identical to the G10 pre-promotion baseline | VERIFIED |

### 4.1 Functional proof of the defect and the fix, on production

Admin-impersonated (`request.jwt.claims`, transaction-local, read-only):

```
rows_page1      = 5      (limit 5, offset 0)
rows_page2      = 5      (limit 5, offset 5)
total_count     = 103    ← the FILTERED total, from v2
admin_role_rows = 1      ← _role='admin' filtered IN SQL
v1_still_works  = 100    ← v1 returns its hard-capped 100
```

**`total_count` 103 vs v1's 100 is the live production defect, measured.** Three members —
including the sole `admin` — are currently unreachable through the admin member list. v2
returns them; v1 cannot. v1 still answers, so nothing that calls it today breaks. — VERIFIED.

---

## 5. Schema-dependency guard vs production, after the apply

Promotion tree `/home/claude/repo/work`, tree **`3515b9a62e72ee5cdc56cac4cf2f3987930960f7`**
(commit `6d6aa6c`, "STAGING PREVIEW — page the admin member list, filter role/badge in SQL (#95)").

Inventory produced by the audited parser itself (empty-catalog probe, so every reference is
listed): **102 distinct RPC names, 119 call sites.** Each name+argument set checked against
production's live `pg_proc`:

- **MISSING: 0**
- **INCOMPATIBLE: 0**
- OK with full argument-name check: **81**
- OK, name-only (the call passes no arguments): **21**

`admin_search_users_v2` at `AdminUsers.tsx:264` — previously the single promotion blocker —
now resolves, with all six argument names matching. — VERIFIED.

### 5.1 DEFECT FOUND IN THE GUARD ITSELF — must be fixed before it is committed as a gate

The guard's argument extraction **silently degrades to a name-only check on some call
sites, and does not say so.** Two sites in this tree lose their arguments:

- `src/components/admin/AdminUsers.tsx:264` — `admin_search_users_v2`
- `src/lib/logger.ts:275` — `log_app_event`

Both are the `(supabase.rpc as <cast>)("name", {...})` form. Most of the 26 cast-form sites
in this tree **do** extract correctly (`get_client_error_stats_admin`, `global_search`,
`get_photo_r4_awards`, `log_client_error`, …), so this is a parser gap on particular object
shapes, not on the cast form as such.

Why this matters more than the parsing bug: PostgREST resolves an RPC by **argument names**,
so a name-only check is precisely the check the guard was written to replace. The guard
reported `MISSING admin_search_users_v2` with **no** `arguments used:` line and, in the
authoritative run, would have reported OK on name alone once the function existed — which
would have passed a same-named function with different parameter names.

**Root fix — two parts, and the second is the important one:**

1. Fix the extraction for these object shapes.
2. **Make the guard report its own coverage.** Print `N checked with arguments, M name-only`
   and list the name-only sites. A checker that cannot state its coverage cannot be trusted
   to mean PASS. Optionally fail the run when a name-only site is not on an allow-list.

For this promotion the gap was closed by hand: `admin_search_users_v2`'s six argument names
were taken from the source object literal at `AdminUsers.tsx:266–273` and checked against
production explicitly — full match. — VERIFIED, by manual substitution, not by the guard.

---

## 6. Rollback

`supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql`,
blob `78d15777f11b3ef3fa8030acfb9e29b430a75b38` — re-hashed and matched. Drops only
`admin_search_users_v2(...)` and `idx_profiles_created_at_id_desc`. Not executed. — NOT APPLICABLE (nothing to roll back).

---

## 7. State after this document

| Item | State |
|---|---|
| RC-1 branch `1f10fc3e…`, tree `25016e3a…` | VERIFIED on remote |
| PR #97 merged, `main` = `6ebe6c3d0378…` | VERIFIED |
| Production schema expand | **APPLIED and VERIFIED** |
| Production application code (RC-2) | NOT STARTED — the site still runs v1 and still hides 3 members |
| `apply-migration.yml` on `main` | **BLOCKED** — repository secret `SUPABASE_DB_URL` absent |
| §5.3 secret-isolation re-test | BLOCKED — never executed |
| `main` branch protection | OWNER-ATTESTED pending |
| §11 approval naming tree `3515b9a6…` | pending |
| G10 overall | **BLOCKED** on RC-2 + §5.3 + branch protection |

## 8. Open items carried forward

1. Repository secret `SUPABASE_DB_URL` (owner-only; session pooler port 5432, **not** 6543 —
   the pooler breaks the multi-statement transactions these migrations use).
2. Guard defect §5.1 — fix extraction **and** add coverage reporting, then commit the guard
   as a promotion gate.
3. RC-2 application promotion.
4. §5.3 secret-isolation re-test.
5. Post-G10: svgo, Node 20 EOL in the production builder, bun/npm lockfile split,
   6 branch-alias preview URLs, stale `Main` branch rule, rotate `sbp_417b…`.
