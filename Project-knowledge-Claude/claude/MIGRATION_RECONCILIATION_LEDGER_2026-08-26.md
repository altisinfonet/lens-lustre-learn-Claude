# Staging → Production migration reconciliation ledger — 2026-08-26

Read-only audit. Nothing was modified: no migration applied, no schema changed, no git write,
no push, no rollback executed. Every Supabase call was a `select`.

**Method.** Migrations are matched by the **content of the applied SQL**, never by filename or
timestamp. For each database the stored `supabase_migrations.schema_migrations.statements` was
normalised (strip `--` comments · collapse whitespace runs · trim ends) and md5'd, and the same
normalisation was applied to the repository file. Objects were then compared directly out of
`pg_proc` / `pg_constraint` / `pg_indexes` / `pg_trigger` / `pg_policies` /
`information_schema.columns` on both databases.

**Caveat on the normaliser:** `--` sequences inside string literals would be stripped as
comments. None of the five migrations contains one.

---

## A. THE LEDGER

### A1 — identity, repository and git

| # | Change | Repository file | Entered repo (staging) | Entered repo (main) | On `staging` | On `main` | Rollback file |
|---|---|---|---|---|---|---|---|
| 1 | `admin_user_list_pagination` | `supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql` | `6d6aa6c` 2026-08-24 18:59 IST (#95) | `6ebe6c3` 2026-08-25 13:25 IST (#97) | YES | YES | **YES** — `supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql` (both branches) |
| 2 | `admin_user_lookup_by_email` | **NONE — no file anywhere in the repository** | — | — | NO | NO | **NO** |
| 3 | `certificate_types_and_admin_search` | `supabase/migrations/UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql` | `cba8dae` 2026-08-25 13:00 IST (#96) | `b671e1f` 2026-08-25 18:17 IST (#101) | YES | YES | **NO** (drafted, never committed) |
| 4 | `certificate_delete_removes_notifications` | `supabase/migrations/UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql` | `cba8dae` 2026-08-25 13:00 IST (#96) | `b671e1f` 2026-08-25 18:17 IST (#101) | YES | YES | **NO** (drafted, never committed) |
| 5 | `certificate_custom_heading` | `supabase/migrations/UNAPPLIED_20260825170000_certificate_custom_heading.sql` | `c92d534` 2026-08-25 16:19 IST (#100) | `b671e1f` 2026-08-25 18:17 IST (#101) | YES | YES | **NO** (DRAFT only, never committed) |

### A2 — ledger versions, content match, and status

There is **no `inserted_at` / applied-at column** in `supabase_migrations.schema_migrations`
on either database (columns: `version, statements, name, created_by, idempotency_key,
rollback`). The version string is the only time evidence; it decodes as UTC. Actual wall-clock
apply time beyond the version stamp is **NEED EVIDENCE**.

| # | Change | Staging version (UTC) | Production version (UTC) | Normalised SQL: staging = production? | Normalised SQL: DB = repo file? | DB object matches migration? | Status |
|---|---|---|---|---|---|---|---|
| 1 | `admin_user_list_pagination` | `20260824120321` → 08-24 12:03:21 | `20260825092152` → 08-25 09:21:52 | **YES** md5 `948658c6…` both | **YES**, exact | YES — `admin_search_users_v2(…)` def md5 `e782b980…` and `idx_profiles_created_at_id_desc` present, identical on both | **VERIFIED** |
| 2 | `admin_user_lookup_by_email` | `20260824144927` → 08-24 14:49:27 | `20260824145345` → 08-24 14:53:45 | **YES** md5 `8d3ec4b1…` both | **N/A — no repo file to compare** | Objects exist and are identical on both: `admin_lookup_user_id_by_email(_email text)` md5 `6c64b6f0…`, `admin_emails_for_user_ids(_ids uuid[])` md5 `8a3cf2ef…` | **OUTSIDE REPO** |
| 3 | `certificate_types_and_admin_search` | `20260825054031` → 08-25 05:40:31 | `20260825115030` → 08-25 11:50:30 | **YES** md5 `2af5ab02…` both | **YES**, exact | YES — `certificates_type_check` carries the 16 values, `admin_search_certificate_recipients` md5 `4015ab92…`, `idx_certificates_issued_at_id_desc` present; identical on both | **VERIFIED** |
| 4 | `certificate_delete_removes_notifications` | `20260825070751` → 08-25 07:07:51 | `20260825115116` → 08-25 11:51:16 | **YES** md5 `df2095bb…` both | **YES**, exact | YES — `cleanup_certificate_references()` md5 `c2afabeb…` + `trg_cleanup_certificate_references` BEFORE DELETE; identical on both | **VERIFIED** |
| 5 | `certificate_custom_heading` | `20260825101651` → 08-25 10:16:51 | `20260825115208` → 08-25 11:52:08 | **YES** md5 `36aaea09…` both | **YES**, exact | YES — `certificates.heading text NULL`, `certificates_heading_only_for_custom`, 12-column `admin_list_certificates` md5 `10d5b0a1…`; identical on both | **VERIFIED** |

**The three differing timestamps for one migration are fully explained.** The repository
filename carries the *authored* `UNAPPLIED_<ts>` name; each database stamps its **own**
version at apply time. The applied SQL is byte-identical in all three places.

**Expand-then-deploy, confirmed by timestamp:**

- `certificate_*` applied to production 11:50:30 / 11:51:16 / 11:52:08 UTC; `b671e1f` (the code
  that calls them) merged 18:17 IST = **12:47 UTC** — schema **55 minutes ahead** of the code.
- `admin_user_list_pagination` applied to production 09:21:52 UTC; `#97` carried only the
  migration; the calling UI arrived in `b671e1f` at 12:47 UTC — schema ahead of the caller.

---

## B. UNRECONCILED ITEMS

### B1 — `admin_user_lookup_by_email` — **OUTSIDE REPO**

Applied to **both** databases (staging `20260824144927`, production `20260824145345`), byte
identical on both, and **has no migration file anywhere in the repository** — not on `staging`,
not on `main`, not on any of the 120+ remote branches. It creates
`admin_lookup_user_id_by_email(_email text)` and `admin_emails_for_user_ids(_ids uuid[])`, both
`service_role`-only. No rollback file exists. §13.1 is unsatisfied and §12.4 step 4 cannot
reconcile it against a manifest that does not contain it.

### B2 — the databases are **NOT** schema-identical: function grants diverge

Structure and code are identical. **Privileges are not.**

| Fingerprint over `public` | Production | Staging | Same? |
|---|---|---|---|
| tables / columns / constraints / indexes / triggers / policies / RLS flags | 146 / 1483 / 382 / 439 / 149 / 686 | identical | **YES** — every md5 matches |
| function signatures | 387 | 387, md5 `49e2fd0b…` | **YES** |
| **function bodies** (`pg_get_functiondef`) | md5 `500adb5e…` | md5 `500adb5e…` | **YES** |
| **function ACLs** | md5 `98cf2ceb…` | md5 `9beca764…` | **NO** |

Breaking the ACL difference down:

| Measure | Production | Staging |
|---|---|---|
| functions with **no explicit ACL** (implicit `PUBLIC EXECUTE`) | 24 | **0** |
| functions granting `anon` EXECUTE | 281 | **381** |
| functions granting `authenticated` EXECUTE | 308 | **384** |
| functions granting `service_role` EXECUTE | 363 | **387** |
| functions **without** `anon` EXECUTE | **106** | **6** |

Staging's six are exactly the six created by the 2026-08-24/25 migrations:
`admin_emails_for_user_ids`, `admin_list_certificates`, `admin_lookup_user_id_by_email`,
`admin_search_certificate_recipients`, `admin_search_users_v2`, `cleanup_certificate_references`.

**Staging therefore grants `anon` EXECUTE on 100 functions that production denies**, including
`admin_delete_auth_user`, `admin_purge_orphan_user_data`, `admin_wallet_credit`,
`admin_reject_wallet_transaction`, `approve_deposit`, `create_pending_deposit`,
`wallet_transaction`, `wallet_ledger_apply_v2`, `soft_void_wallet_transactions`,
`publish_post_draft`, the `media_*` write path, and the `judge_*` lock functions.

**Exploitability is NEED EVIDENCE and was NOT probed.** Most of these are `SECURITY DEFINER`
with an internal `has_role(auth.uid(),'admin')` gate — the project record confirms that pattern
for `admin_search_users` v1 — in which case an anonymous caller receives `Not authorized` and no
data. That has **not** been verified for all 100, and this is a read-only audit; probing a
production-shaped privilege surface is not in scope for this pass.

### B3 — the repository's migration history is not the databases' history

633 migration files exist under `supabase/migrations/`, dating back to 2026-02-24. Production's
ledger holds **37** rows; staging's holds **5**. Neither database's ledger is a record of the
repository. §13.1 rollback coverage across the repository is **604 migrations with no rollback
file**; one orphan rollback exists with no matching migration
(`UNAPPLIED_20260820140000_classF_repoint_originals`).

### B4 — the two contradictions carried forward from the rollback drafts

- The `…120000` forward migration records *"Already present before this migration: staging 3
  orphans, PRODUCTION 1"*; its rollback's baseline records *"pre-existing orphaned certificate
  notifications … 0"*. Cannot be reconstructed retroactively — **NEED EVIDENCE**, not resolved.
- The DRAFT heading rollback never drops `certificates_heading_only_for_custom`. Inspected on
  production: that constraint's `conkey` covers `type, heading`, so `DROP COLUMN heading`
  removes it implicitly. **Documentation gap confirmed; functional behaviour NOT EXECUTED** — no
  PostgreSQL server exists in this sandbox and testing it on a live lane is not authorised.

### B5 — minor lane difference

Postgres minor version: production `17.6.1.141`, staging `17.6.1.155`. Not a schema difference.
Recorded for completeness.

---

## C. WHY STAGING HAS 5 LEDGER ROWS AND PRODUCTION HAS 37

Measured, not inferred:

| Fact | Value |
|---|---|
| Production project created | **2026-07-09T04:52:01Z** |
| Staging project created | **2026-08-21T15:38:26Z** |
| Production's earliest ledger row | `20260813171159` (2026-08-13) |
| Staging's earliest ledger row | `20260824120321` (2026-08-24) |
| `created_by` on **every** row, both databases | `50mmretinaworld@gmail.com` |
| Oldest repository migration file | `20260224160300_…` (2026-02-24) |

The ledger is **not** a history of the repository in either database; it is a log of migrations
applied through the tooling that writes `supabase_migrations.schema_migrations`, from the date
that tooling started being used.

- Staging's project **did not exist** before 2026-08-21, so it cannot hold a row older than
  that. Its 5 rows are every migration applied to it since 2026-08-24.
- Production carries 37 rows from 2026-08-13 onward, while its schema plainly contains objects
  created long before that (the repository's files start 2026-02-24, before the production
  project itself existed on 2026-07-09).
- The whole-schema fingerprints being identical proves the pre-ledger history reached **both**
  databases by a route that wrote **no** ledger rows.

**The mechanism of that seeding is NEED EVIDENCE.** A dump/restore or platform-side provisioning
would explain both the missing rows and staging's blanket function grants (§B2), but this audit
has no artefact proving it and I am not asserting it.

---

## D. IS THE CHANGE PART OF THE INTENDED G10 RELEASE?

| # | Change | In the intended G10 release? |
|---|---|---|
| 1 | `admin_user_list_pagination` | Already shipped in `#97`/`#101`. Not part of the pending RC. |
| 2 | `admin_user_lookup_by_email` | **UNKNOWN — OWNER DECISION.** Live in production, absent from the repository, never declared in any RC. |
| 3–5 | the three `certificate_*` migrations | Already applied to production and shipped in `#101`. Their **rollback files** are the outstanding G10 step-1 item. |

No RC is declared: the repository holds **0 tags of any kind**, so no `approved/*` tag exists,
and no §10 RC record naming a tree exists. `staging` = `702e5ce`, tree
`30ed9e585c13d493ad253adc3de1d9e9152405e7`, 98 files ahead of `main`. Whether that tree is the
intended RC is an **OWNER ACTION**; it is not inferable.
