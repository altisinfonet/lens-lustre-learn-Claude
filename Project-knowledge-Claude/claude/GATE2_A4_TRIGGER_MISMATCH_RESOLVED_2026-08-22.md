# GATE 2 / OPTION A — A4 TRIGGER MISMATCH: RESOLVED

Date: 2026-08-22
Workstream: Web Staging — Gate 2 — Option A (authoritative schema-only dump)
Status: **RESOLVED — mechanism proven, verification instrumented, not yet re-run in CI**

---

## 1. The open item

Run 4 of `.github/workflows/schema-dump.yml`
(run `32557147063`, artifact `prod-schema` id `9471773669`,
sha256 `e675ca950d8b4a771e8baf1f8356b82e8db10139b95f59aacab9de5bb390e946`,
1,110,844 bytes) reported:

    TRIGGERS: 0        expected 148

Six of seven corrected-baseline expectations matched exactly. This was the only
mismatch, and it blocked the GREEN verdict on the dump.

The code session proposed that `pg_dump` emits `CREATE TRIGGER` with leading
whitespace and the workflow's `grep -c '^CREATE TRIGGER'` therefore matched
nothing. It explicitly flagged the explanation as **unverified** — the sandbox
proxy blocks `blob.core.windows.net`, so the artifact could not be downloaded
and inspected.

## 2. That explanation is wrong

Verified by direct experiment in this session, not by reasoning:

1. Installed PostgreSQL 16.13 locally.
2. Built a fixture schema in `public`: 2 tables, 1 trigger function, **3 triggers**,
   1 RLS policy, 1 view, 1 index.
3. Ran `pg_dump --schema-only --schema=public`.

Result:

    CREATE TABLE:   2
    TRIGGERS(^):    3      <- '^CREATE TRIGGER' matches fine
    TRIGGERS(ws):   3
    line 173: CREATE TRIGGER trg_t1_updated BEFORE UPDATE ON public.t1 ...

`pg_dump` writes `CREATE TRIGGER` at column 0, exactly like `CREATE TABLE`.
The whitespace theory is disproved, and the proposed whitespace-tolerant grep
would have returned 0 as well — it would have looked like a confirmed failure.

## 3. The actual mechanism

`supabase db dump` is not bare `pg_dump`. It executes
`apps/cli-go/pkg/migration/scripts/dump_schema.sh` (Supabase CLI, read from
source), which runs

    pg_dump --schema-only --quote-all-identifier --role "postgres" --exclude-schema "<internal>"

and pipes the output through 19 `sed` substitutions. One of them is:

    sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/'

So every trigger in the artifact reads:

    CREATE OR REPLACE TRIGGER "trg_name" BEFORE UPDATE ON "public"."tbl" FOR EACH ROW ...

`grep -c '^CREATE TRIGGER'` cannot match that string. **TRIGGERS: 0 is a defect
in the counter, not in the dump.**

Reproduced end to end by replaying the CLI's exact sed chain over the fixture dump:

    TRIGGERS (workflow pattern)     : 0     <- reproduces the reported value
    TRIGGERS (whitespace-tolerant)  : 0     <- the proposed fix would also fail
    TRIGGERS (^CREATE OR REPLACE T) : 3     <- the true count

## 4. Audit of every other counter

The CLI rewrites six statement heads. All twelve workflow patterns were checked
against those rewrites:

| CLI rewrite | workflow pattern | verdict |
|---|---|---|
| `CREATE TABLE "` -> `CREATE TABLE IF NOT EXISTS "` | `^CREATE TABLE` | safe (prefix survives) |
| `CREATE SEQUENCE "` -> `... IF NOT EXISTS "` | `^CREATE SEQUENCE` | safe |
| `CREATE SCHEMA "` -> `... IF NOT EXISTS "` | not counted | n/a |
| `CREATE VIEW "` -> `CREATE OR REPLACE VIEW "` | `^CREATE (OR REPLACE )?VIEW` | safe |
| `CREATE FUNCTION "` -> `CREATE OR REPLACE FUNCTION "` | `^CREATE (OR REPLACE )?FUNCTION` | safe |
| `CREATE TRIGGER "` -> `CREATE OR REPLACE TRIGGER "` | `^CREATE TRIGGER` | **BROKEN — the only one** |

`^CREATE POLICY`, `^CREATE (UNIQUE )?INDEX`, `^CREATE EXTENSION`, `^ALTER TABLE`
and `^GRANT ` are untouched by both the sed chain and `--quote-all-identifier`.
No other reported number is suspect.

## 5. Production-side expectations, re-derived live (read-only)

| Quantity | Value |
|---|---|
| `public` non-internal triggers | **148** |
| of which constraint triggers | 0 |
| of which on non-ordinary relations | 0 |
| internal (FK-backing) triggers, correctly excluded | 340 |
| trigger `name|table` digest, C collation | **`d289eafea3cb2c73094a2bd1c3d338fd`** |
| trigger definition digest | `c6cb07626988b113c9690ee3458a4314` |
| `public` standalone indexes | **238** — matches the dump exactly |
| `public` indexes including constraint-backed | 437 (199 emitted as `ALTER TABLE ADD CONSTRAINT`) |
| schemas the dump actually covers | `public` only |

The 238/437 split independently confirms the `INDEXES: 238` line and closes the
earlier "lower than 437" prediction with an exact number rather than an
inequality.

## 6. Event triggers — checked, and not a gap

The CLI also comments out `CREATE EVENT TRIGGER`. Production has 6 event
triggers. All 6 are owned by `supabase_admin` with functions in the `extensions`
schema:

`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`,
`issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`.

Staging `ztzutckwdhetphwghuzj` was queried and already carries the **identical
six**. There are zero application-owned event triggers. The CLI's suppression
therefore removes nothing the staging baseline needs.

## 7. Staging precondition re-confirmed

Queried at the same time as the above:

    ztzutckwdhetphwghuzj  public tables         : 0
    ztzutckwdhetphwghuzj  public user triggers  : 0
    ztzutckwdhetphwghuzj  event triggers        : 6 (platform)

The A5 apply gate's "staging must have 0 tables" refusal condition still holds.

## 8. What is still NOT proven

The mechanism is proven and the expectations are exact, but **no one has yet
counted the triggers inside the actual artifact.** That is a file-level fact and
it has not been observed. Under the standing rule that nothing is marked
complete on the strength of an explanation, this item is RESOLVED-PENDING-RERUN,
not GREEN.

The verification is instrumented in
`PASTE_CODE_SESSION_A4_TRIGGER_VERIFY.md`: a replacement `GUARD + VALIDATION
COUNTS` step that
  - pins and compares `sha256` against run 4's `e675ca95...` so a byte-identical
    re-dump proves the counts describe that exact artifact,
  - counts triggers with `^CREATE (OR REPLACE )?TRIGGER `,
  - extracts `name|table` pairs and asserts the digest equals
    `d289eafea3cb2c73094a2bd1c3d338fd` — set equality, not a count,
  - asserts `CREATE CONSTRAINT TRIGGER` is 0,
  - fails the run on any of those three, rather than printing and continuing.

The shell digest and the Postgres digest were proved to agree on the fixture
(`printf '%s' "$(cat pairs)" | md5sum` == `md5(string_agg(p, E'\n' order by p
collate "C"))`, both `dfcaf477a5449b5d269f70494e63e043`), so the CI assertion is
comparing like with like, including collation.

## 9. Method note

The artifact remains undownloadable from this session (`blob.core.windows.net`
blocked; the GitHub REST API returns 403 for this repository). `git fetch` over
the proxy does work, which is how the workflow source was read. The Supabase CLI
could not be run locally either — `public.ecr.aws`, `ghcr.io` and
`registry-1.docker.io` all return 403 for `supabase/postgres:17.6.1.159`. The
CLI's behaviour was therefore established from its source and reproduced with a
local PostgreSQL 16 instance and the identical sed chain.

## 10. Net effect on the Gate 2 verdict

With TRIGGERS reinterpreted, run 4's artifact matches the corrected baseline on
every axis measured so far:

    tables 146 / functions 357 / policies 686 / indexes 238 /
    views 10 / sequences 3 / extensions 9 / RLS 146 / triggers 148 (pending re-count)

No evidence of a defective dump remains. The blocker is now a one-line CI
re-count, not a schema problem.
