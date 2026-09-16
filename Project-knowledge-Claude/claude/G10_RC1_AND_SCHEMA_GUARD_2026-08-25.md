# G10 · expand-then-deploy adopted · permanent schema guard built

**Date:** 2026-08-25 · Nothing promoted, nothing applied, `origin/main` unchanged at `32930e75…`.

---

## A · RC-1 — schema expansion

**PREPARED, NOT EXECUTED.** RC-1 carries exactly two files:

```
supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql
supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql
```

Verified additive before proposing the order — the only DDL verbs present:

```
create or replace function public.admin_search_users_v2(...)
create index if not exists idx...
revoke all ... from public / from anon
grant execute ... to authenticated
```

No `DROP`, no `ALTER TABLE`, no DML. Rollback is `drop function if exists` + `drop index if exists`.

The migration's own header already anticipated this ordering: *"CREATE OR REPLACE cannot add a
column to a function's return type… v1 is therefore left untouched and keeps serving until the UI
moves."* Applying it to production under the current UI is invisible to every user.

**Cannot be executed from this session**: it requires a push, a PR merge into protected `main`, and
an `apply-migration.yml` dispatch. The command block and the exact dispatch inputs are delivered.

## B · RC-2 — application promotion

**BLOCKED BY DESIGN** until RC-1 is verified on production. Re-verification of the application tree
was completed in this run and stands:

| check | result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Vitest | 168 files, **2327 passed**, 1 skipped, 0 failed |
| Mutation harness (isolation) | 21/21 held |
| SEO harness | 15/15 killed |
| Isolation guard, production lane, host rules active | PASS — 385 assets / 3 roots |
| robots.txt with `VITE_SITE_ORIGIN` **unset** | **indexable**, origin `https://50mmretina.com` |

## C · Permanent schema-dependency gate

Three files delivered: `verify-schema-dependencies.mjs`, `test-schema-dependencies.mjs`,
`verify-schema-dependencies.yml`.

**Credentials reused, not invented.** Reads `SUPABASE_DB_URL` from the target GitHub Environment —
the same secret `apply-migration.yml` consumes — and shells to the same `psql`. The workflow carries
the same ref assertion, for the same reason: a schema check against the wrong database is worse than
none, because it produces a green line.

**It checks argument names, not just function names.** PostgREST resolves an RPC by the argument
names in the JSON body, so a same-named overload with different parameters is a runtime 404 and a
PASS to any name-only check.

### Harness — 15 cases, all passing

`GREEN-1/2` · `RED-1` missing RPC (the incident) · `RED-2` multiline cast shape · `RED-3` multiple
references reported with file:line · `RED-4` overload/signature mismatch · `RED-5` planted new
reference · `RED-6` empty source tree refuses rather than passing · `CTRL-1` test files excluded ·
`CTRL-2/3` parser false-positive controls · `CTRL-4/5/6` regressions (below) · `CRED-1` absent
credentials refuse.

### Two parser defects the harness did NOT catch, found by pointing it at real source

The first version, harness-green, produced two false blockers against `src/`:

1. **`rest`** — matched `.rpc` inside a *comment* quoting supabase-js internals. Fixed with a
   comment-stripping state machine that preserves character offsets (so line numbers stay true) and
   understands that `"https://x"` is a string, not a comment.
2. **`get_my_certificate_entries` INCOMPATIBLE** — the call is `.rpc("name" as any)` with no
   arguments; the parser adopted an unrelated mapping literal several lines below. Fixed by
   requiring the argument object to be in the actual argument position: after the name, skip an
   optional cast, then a comma must follow, then `{`. A `)` means no arguments.

Both are now regression cases (`CTRL-4/5/6`). Recorded rather than fixed silently: **a harness earns
trust by growing every time reality beats it.**

### A near-miss worth recording

The guard's inventory (102 names) is strictly better than the throwaway scan used during triage
(100): it found `get_top_contributors_v2`, which the crude scan missed, and correctly excluded
`get_x`, which exists only in `.spec.ts`. On first run the guard reported `get_top_contributors_v2`
as missing from production — **that was a hole in my hand-built catalog file, not in the database.**
Checked directly: it exists on both lanes. Reported here because it is exactly the class of false
blocker that destroys trust in a gate.

Separately, an early lane-comparison showed differing signature hashes. That was the **OID-ordering
artefact recorded during G9** — `string_agg(... order by p.oid)` orders overloads by an internal id
that legitimately differs between databases. Re-run with deterministic ordering, both lanes hash
identically: `b9d7859760b22a98df7c60260807c728`, 104 overload rows. The same trap, caught twice.

### Verdict against both real lanes

Catalogs built from live queries against each project (input arguments only, via
`proargnames[1:pronargs]`):

```
PRODUCTION  jtdtehuqtinjxropkkcn   exit 1   FAIL
  MISSING  admin_search_users_v2
    called at src/components/admin/AdminUsers.tsx:264
    arguments used: _badge, _by, _limit, _offset, _query, _role

STAGING     ztzutckwdhetphwghuzj   exit 0   PASS
  102 distinct RPC names across 119 call sites — all present, parameters compatible
```

Exactly the discrimination required: it reproduces the G10 blocker against production and passes
against the lane the code was built on.

### Demonstrated, not asserted

```
staging, unmodified tree      -> exit 0  PASS
plant deliberately_absent_rpc_for_demo
staging, planted              -> exit 1  FAIL
     MISSING deliberately_absent_rpc_for_demo
     called at src/lib/__schema_guard_plant__.ts:4
     arguments used: _planted
remove plant
staging, restored             -> exit 0  PASS
git status --porcelain        -> 0 lines, before and after
```

**Capability boundary, stated once:** the shipped guard's `psql` path could not be exercised from
this session — no `SUPABASE_DB_URL` for either lane, and 5432/6543 are blocked from this container.
The comparison logic above ran against **real catalogs from both lanes**, obtained over the Supabase
MCP transport. The psql path itself is first exercised by the workflow's first run.

## D · G10 status

**BLOCKED**, unchanged, and now blocked in the correct place: RC-1 has not been applied.

## E · Remaining blockers

| # | blocker | owner |
|---|---|---|
| 1 | RC-1 not pushed, merged or applied — needs push, PR merge to `main`, `apply-migration.yml` dispatch | owner / code session |
| 2 | §5.3 secret-isolation re-test — never executed; §12.4 step 7 forbids inheriting G3's evidence | needs push |
| 3 | Branch protection on `main` — OWNER-ATTESTED by §17; the code session's token lacks `administration` | owner |
| 4 | §11 approval naming tree `3515b9a6…`, signed before the merge | owner |
| 5 | §17 check 4 wants CI run IDs for both lanes; local runs only from this session | needs CI |

The guard is **not** part of RC-1 or RC-2. Adding tooling mid-promotion is the improvisation the
brief forbids; it lands as its own change once the release is out.
