# GATE 2 — AUTHORITATIVE STAGING SCHEMA BASELINE: **APPLIED AND VERIFIED**

Date: 2026-08-22
Workstream: Web Staging — Gate 2 — Option A
Target: staging `ztzutckwdhetphwghuzj` (`50mmretinaworld-staging`, ap-northeast-2, PostgreSQL 17.6)
Source: production `jtdtehuqtinjxropkkcn` (PostgreSQL 17.6), schema-only, no data

## VERDICT: **GREEN**

Definition-level equivalence achieved and proven on **thirteen** independent
dimensions by digest, not by count. Production was not modified. Staging
contains zero rows.

---

## 1. What was actually done

1. The validated dump was published to the public tool branch by CI
   (commit `98228232b9f3a6fb8fec3916d25e9a3c46bb3e51`, 1,110,844 bytes,
   sha256 `e675ca950d8b4a771e8baf1f8356b82e8db10139b95f59aacab9de5bb390e946`),
   gated on the pinned sha256 so a drifted dump could not be published.
2. The Cowork session fetched the branch by `git fetch` and verified the blob's
   sha256 independently of CI's report.
3. Ten production extensions were installed on staging (five already present).
4. **Staging fetched the file itself** from `raw.githubusercontent.com` via
   `pg_net`, and verified it **inside the database**: HTTP 200,
   `octet_length = 1110844`, `sha256 = e675ca95…e946`.
5. The file was applied in a single `DO` block with one `EXECUTE`, inside one
   transaction, with four refusal gates evaluated in that same transaction.

**No SQL passed through the model.** The bytes travelled
GitHub → Supabase directly. The transcription-corruption failure mode that made
Option B BLOCKED was structurally impossible on this path.

## 2. Pre-flight rehearsal (before staging was touched)

A local PostgreSQL 16 instance was built in the session sandbox with
Supabase-like prerequisites (platform roles, `auth`/`extensions`/`vault`/
`storage`/`pgmq` schemas, `auth.uid()`/`auth.role()` stubs, `auth.users`, the
`supabase_realtime` publication) and the real dump was applied to it twice:

- once with `psql -f`, and
- once through **the exact mechanism used on staging** — a single `DO` block
  reading the whole 1.1 MB file and running it as one `EXECUTE` string.

Both produced 146 tables / 10 views / 357 functions / 686 policies /
148 triggers / 238 standalone indexes / 146 RLS / 29 publication tables.

The only rehearsal errors were two known local-only artefacts: 275
`unrecognized privilege type "maintain"` (MAINTAIN is PostgreSQL **17**; the
sandbox runs 16, staging and production run 17.6) and 30
`publication "supabase_realtime" does not exist` before the publication was
created. Neither can occur on staging.

The rehearsal also mapped the dump's entire cross-schema dependency surface:
`auth.uid()` ×445, `auth.users(id)` ×18 foreign keys, `auth.role()` ×16 —
and nothing else. All exist on a fresh Supabase project.

## 3. Parity — digests over sorted sets, both sides computed independently

| Dimension | Count | Production digest | Staging digest | |
|---|---|---|---|---|
| Tables | 146 | `e0a9fd12328343f0359bbc73568a787b` | `e0a9fd12328343f0359bbc73568a787b` | ✅ |
| Table columns (name:type:notnull) | 1405 | `f01658a93fac875cb4f0045d4916d832` | `f01658a93fac875cb4f0045d4916d832` | ✅ |
| Functions (`pg_get_functiondef`, extension-owned excluded) | 357 | `7c0d085b47f2288e7e71831f33c8adb1` | `7c0d085b47f2288e7e71831f33c8adb1` | ✅ |
| RLS policies (name, cmd, USING, WITH CHECK, roles) | 686 | `7266212acb3df89e33d9f15e2c4ec0ed` | `7266212acb3df89e33d9f15e2c4ec0ed` | ✅ |
| Indexes (`indexdef`, incl. constraint-backed) | 437 | `c31508c31ca4b712aefd23c9d48a078b` | `c31508c31ca4b712aefd23c9d48a078b` | ✅ |
| Triggers (`pg_get_triggerdef`) | 148 | `c6cb07626988b113c9690ee3458a4314` | `c6cb07626988b113c9690ee3458a4314` | ✅ |
| Views (`pg_get_viewdef`) | 10 | `e50228d94fb2d25e2692018c3e14aca3` | `e50228d94fb2d25e2692018c3e14aca3` | ✅ |
| Constraints (`pg_get_constraintdef`) | 381 | `ec0c1a08240da2bd0786a826ff1c9919` | `ec0c1a08240da2bd0786a826ff1c9919` | ✅ |
| RLS-enabled tables | 146 | `e0a9fd12328343f0359bbc73568a787b` | `e0a9fd12328343f0359bbc73568a787b` | ✅ |
| Realtime publication membership | 29 | `f7a2b692b19c5e3fd856b5d14817ef01` | `f7a2b692b19c5e3fd856b5d14817ef01` | ✅ |
| Materialized views (`pg_get_viewdef`) | 1 | `42a66a87d52aab2aaf26c1b9404bd6e3` | `42a66a87d52aab2aaf26c1b9404bd6e3` | ✅ |
| Sequences | 3 | `ec49783b8e6caa17e17041c0b759eafc` | `ec49783b8e6caa17e17041c0b759eafc` | ✅ |
| Enum types and labels | 2 | `014c05336ce6fe8fec9c55777744f18e` | `014c05336ce6fe8fec9c55777744f18e` | ✅ |

**Zero mismatches on any dimension.**

Two of these were found only because the check was widened mid-verification:
**materialized views** and **sequences/enums** were invisible to both the CI
counter and the first parity query (`relkind='v'` excludes `relkind='m'`). The
matview surfaced by throwing `materialized view "entry_vote_counts" has not been
populated` during the row-count sweep. Had that sweep not been run, a whole
object class would have gone unverified.

## 4. Isolation — staging holds no production content

| Check | Staging |
|---|---|
| Tables in `public` | 146 |
| **Total rows across all 146 tables** | **0** |
| `auth.users` | 0 |
| `vault.secrets` | 0 |
| `cron.job` | 0 |
| `storage.buckets` / `storage.objects` | 0 / 0 |

## 5. Production — unchanged

Re-verified after the apply against the A2 baseline:

| Quantity | A2 baseline | Now |
|---|---|---|
| `public` tables | 146 | 146 ✅ |
| `auth.users` | 101 | 101 ✅ |
| `vault.secrets` | 4 | 4 ✅ |
| `cron.job` | 16 | 16 ✅ |
| `storage.buckets` | 11 | 11 ✅ |
| Migration ledger rows / max | 32 / `20260820181949` | 32 / `20260820181949` ✅ |
| `public.posts` | 262 → 265 → 267 | 267 — live members posting, not a regression |

Every production statement issued in this workstream was a `SELECT`.

## 6. Deviations, recorded rather than hidden

1. **`entry_vote_counts` arrived unpopulated.** A schema-only dump creates
   matviews `WITH NO DATA`, and any read then raises an error that production
   never raises. It was refreshed on staging: now populated, **0 rows**
   (its base tables are empty). Definition digest unaffected.
2. **`pg_net` is 0.20.4 on staging, 0.20.3 on production.** Platform-managed
   extension; the dump pins no version; no `public` object depends on it.
3. **Extensions were pre-created by this session** rather than left to the
   dump's `CREATE EXTENSION IF NOT EXISTS` lines, so that an extension failure
   would be isolated from the schema apply. The dump's lines then no-op'd.
   Final state: 10 extensions on staging, the same 10 as production.
4. **`pg_cron` created two policies** on `cron.job` and `cron.job_run_details`
   at install time. The first apply attempt refused because its policy gate was
   not schema-scoped and counted them. The gate was corrected to `public` scope —
   the same class of error as the earlier 730→686 policy-count correction.
   Both policies are extension-owned and match production.
5. **One `net._http_response` row (1.1 MB) is retained** on staging holding the
   fetched SQL. `pg_net` expires responses after ~6 hours. The content is the
   public schema dump, already public in the repository.

## 7. What this baseline deliberately does NOT carry

By Supabase CLI design and by instruction: no rows, no `auth.users`, no storage
objects or buckets, no cron job rows, no vault secrets, no `CREATE EVENT TRIGGER`
(all 6 production event triggers are `supabase_admin`-owned platform triggers and
staging already carries the identical six), and no replay of the 629 historical
migrations. Staging's `supabase_migrations` ledger remains absent, so staging has
a clean migration history rather than a forged one.

## 8. Open items

- Delete branch `staging/schema-dump-tool` (now at `98228232`) once no longer
  needed. Ref deletion is blocked from the Cowork session; the code session can
  do it.
- `ISOLATION_FORBIDDEN_REFS = ztzutckwdhetphwghuzj` on the production Pages
  project (Gate 2 Step 1, still AMBER).
- Staging Pages project, edge functions, and seed data.
- Method note for future sessions: **`relkind='v'` is not "views".** Any
  schema-parity check must cover `r`, `v`, `m`, `S`, enum types, constraints and
  publication membership, or it will silently pass over whole object classes.
