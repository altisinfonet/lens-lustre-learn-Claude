# G10 strict reconciliation — D1, D2, certificate migrations — 2026-08-26

Read-only. Nothing applied, committed, promoted, revoked, deleted or deployed. Every database
call was a `select`; every git operation was a fetch or a read. Files were written only to
`/home/claude/prepared/` in this session's sandbox, which is discarded when the session ends.

---

## 1. D1 — `admin_user_lookup_by_email`

### 1.1 ⚠ CORRECTION TO THE PREVIOUS LEDGER

`MIGRATION_RECONCILIATION_LEDGER_2026-08-26` recorded this as **OUTSIDE REPO — "no file
anywhere in the repository"**. That was wrong, and the error was in the method: the earlier
search enumerated **branch tips only**.

An exhaustive scan of the git object database — 10,728 objects, **3,899 blobs**, across all
branches **and all 101 fetched `refs/pull/*/head` refs** — finds exactly **two** blobs in the
entire history mentioning either function name:

| Blob | Path |
|---|---|
| `e25c3e7ebb338274e9b1518579755ba7239078a3` | `supabase/migrations/20260824145345_admin_user_lookup_by_email.sql` |
| `4c704d839dc09f02376f258d62fc9c946f42e940` | `supabase/functions/send-gift-credit/index.ts` |

**The migration file exists.** It is on branch **`origin/gift-credit-user-lookup`**, commit
`03ba3cf43a2b7713d46fcc468653f557b79b4bf6` *"fix: lookup migration (2 of 2)"*, 2026-08-24
20:54 IST. It is on **no other ref**, and not on `main` or `staging`.

Note the filename carries **no `UNAPPLIED_` prefix** and uses **production's** version stamp
`20260824145345`.

### 1.2 VERIFIED facts about the live objects (both lanes, read this turn)

| Property | `admin_lookup_user_id_by_email(_email text)` | `admin_emails_for_user_ids(_ids uuid[])` |
|---|---|---|
| returns | `uuid` | `TABLE(user_id uuid, email text)` |
| language | `sql` | `sql` |
| SECURITY DEFINER | **yes** | **yes** |
| volatility | `STABLE` | `STABLE` |
| strict | no | no |
| `search_path` | `public, auth` | `public, auth` |
| owner | `postgres` | `postgres` |
| ACL | `postgres=X/postgres, service_role=X/postgres` | `postgres=X/postgres, service_role=X/postgres` |
| `pg_get_functiondef` md5 | `6c64b6f09026a9d73ebeab916e3657f7` | `8a3cf2ef581825b36c612d10daccfe91` |

**Identical on staging and production, every field.** No `anon`, no `authenticated`.

### 1.3 Ledger rows

| | Staging | Production |
|---|---|---|
| version | `20260824144927` | `20260824145345` |
| name | `admin_user_lookup_by_email` | same |
| `created_by` | `50mmretinaworld@gmail.com` | same |
| `idempotency_key` | null | null |
| `rollback` array | empty | empty |
| statement count | **1** (one string carrying both `create or replace` blocks and all 8 grant/revoke lines) | same |
| raw md5 of statements | `737484cfdd834ab8323c2ac8f97527d5`, 1306 bytes | **identical**, 1306 bytes |

**Both functions were created by ONE migration.** Unlike the three certificate migrations
(which differ by a single leading/trailing whitespace character between lanes), this one is
**byte-identical** in both ledgers.

### 1.4 Four-way comparison

Normalisation: strip `--` comments · collapse whitespace runs · trim ends.

| Source | md5 | length |
|---|---|---|
| LIVE PRODUCTION stored statement | `8d3ec4b1eaf882f324b441bdde3f67df` | 1281 |
| LIVE STAGING stored statement | `8d3ec4b1eaf882f324b441bdde3f67df` | 1281 |
| Repository blob `e25c3e7e…` | `8d3ec4b1eaf882f324b441bdde3f67df` | 1281 |
| Proposed repository migration (verbatim copy of that blob, md5 `09948baf…`) | `8d3ec4b1eaf882f324b441bdde3f67df` | 1281 |

**No byte or semantic difference across all four.** The repository file already reproduces the
deployed behaviour exactly; nothing had to be reconstructed.

### 1.5 One documented contradiction — NOT resolved

The migration file's own header states:
*"APPLIED: production 20260824145345 · staging **20260824145121**"*.
Staging's live ledger records **`20260824144927`**. The header and the database disagree by
about two minutes. **NEED EVIDENCE** — I am not resolving it. Production's stamp in the header
is correct.

### 1.6 ⚠ NEW FINDING — a live production edge function is not in `main` or `staging`

Read from the Supabase Functions API this turn:

| | Production `send-gift-credit` | Staging `send-gift-credit` |
|---|---|---|
| version / status | **v23, ACTIVE** | **v4, ACTIVE** |
| calls `admin_lookup_user_id_by_email` | **YES** (and `admin_emails_for_user_ids`) | **NO** — still `supabase.auth.admin.listUsers()` |
| matching repo blob | `4c704d83…`, present **only** on `origin/gift-credit-user-lookup` | `bcbc98dd…`, the version on `main` and `staging` |

The repository copy of that edge function on **both** `main` and `staging` (`bcbc98dd…`) does
**not** mention either RPC. So production is running edge-function source that exists on one
unmerged branch and nowhere else in the release lanes.

**A second, unrelated drift was visible in the same read, and is recorded here because it was
observed, not because it was sought:** the `_shared/secureHeaders.ts` bundled into
**production's v23** is the **old prefix-matching** implementation
(`ALLOWED_ORIGINS.some(o => requestOrigin.startsWith(o))`, wildcard fallback, 5 origins), while
**staging's v4** carries the **hardened equality-matching** implementation. **This was observed
for ONE function only and MUST NOT be generalised** to production's other edge functions — no
sweep was performed. Bounding it is outstanding work.

### 1.7 Branch state

`origin/gift-credit-user-lookup` is based on `32930e7` — the old `main`, which is also the
§17-9 rollback-target commit. It has never been rebased. Its diff against current `main` shows
it *deleting* everything merged since, including all four certificate/pagination migrations and
the pagination rollback. **It is not mergeable as it stands.**

No rollback file for this migration exists on that branch or anywhere else.

---

## 2. D2 — staging vs production function ACLs

### 2.1 ⚠ CORRECTION TO THE PREVIOUS LEDGER: the number is 76, not 100

The earlier "100 functions" used a textual test (`proacl` does not contain `anon=`) that
**mis-classifies functions whose `proacl` is NULL**. A NULL `proacl` means PostgreSQL default
privileges, which for a function is `EXECUTE TO PUBLIC` — and PUBLIC includes `anon`.

Production has **24** such functions; **all 24 are `plpgsql_check` / `plpgsql_profiler` /
`plpgsql_show_dependency_tb` extension functions**. Staging has **0**.

Corrected, comparing only functions carrying an EXPLICIT ACL:

| Role | Production denies | Staging denies | **Real delta** |
|---|---|---|---|
| `anon` | 82 | 6 | **76 functions** |
| `authenticated` | 55 | 3 | **52 functions** |
| `service_role` | 0 real (the 24 are PUBLIC-covered) | 0 | **none** |

Staging's 6 anon-denied functions are exactly the six created by the 2026-08-24/25 migrations,
and all six are also anon-denied on production. **There is no function where production grants
a role and staging denies it.** The divergence is strictly one-directional: staging is more
permissive.

### 2.2 Whole-schema comparison, for context

| Fingerprint over `public` | Same? |
|---|---|
| tables 146 · columns 1483 · constraints 382 · indexes 439 · triggers 149 · policies 686 · RLS flags | **identical md5** |
| function signatures (387) `49e2fd0b…` | **identical** |
| function bodies `500adb5e…` | **identical** |
| **function ACLs** | **DIFFERENT** — production `98cf2ceb…` / staging `9beca764…` |

Structure and code match exactly. Privileges are the only difference found.

### 2.3 Classification

| Class | Items |
|---|---|
| **1 — clearly intentional and documented** | The 6 functions staging denies anon on. Their forward migrations contain the explicit `revoke … from anon/authenticated` lines; both lanes match. |
| **2 — clearly accidental** | None can be placed here on evidence. Reachability was **not** probed and must not be assumed. |
| **3 — unexplained / needs owner decision** | All **76** anon differences and all **52** authenticated differences. |

**No migration explains the difference.** The hardening `revoke` statements live inside
production's applied migrations; staging's ledger holds only 5 rows, none of which is a
hardening migration, so those revokes were never applied to staging.

### 2.4 Root cause — measured in part, NEED EVIDENCE in part

**MEASURED (`pg_default_acl`, both lanes):** both carry the stock Supabase rule
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated,
service_role`. Every new public function is anon-executable on creation in **both** lanes.

Staging additionally carries a **duplicate** rule from grantor `supabase_admin` for
`public.functions`; production does not. Production's `postgres` rule omits `postgres=X`;
staging's includes it. Minor, recorded.

**The repository already documents this**, in `PHASE_0_DESIGN_REVIEW.md:26`: *"ALTER DEFAULT
PRIVILEGES grants EXECUTE on every function created in public to anon and authenticated,
automatically. This is Supabase's stock configuration… every future function is anon-executable
the moment it is created, unless explicitly revoked."*

**So the cause is NOT that staging has extra grants.** It is that production accumulated ~76
explicit REVOKEs through its hardening migrations and staging never received them — staging's
project was created 2026-08-21 and its ledger begins 2026-08-24.

**NEED EVIDENCE — how staging's schema was seeded.** `harness/cg2/01_schema_seed.sql:992`
contains `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;` and is
present on both branches, but **there is no artefact showing it was ever run against the
staging project.** It is named as a candidate and explicitly not asserted as the cause.

### 2.5 Proposed remediation — PREPARED, NOT APPLIED

`/home/claude/prepared/acl/GENERATE_staging_acl_remediation.sql` — a **read-only generator** to
be run against **production**, whose output is the REVOKE script for **staging**. Generating it
from production at the moment of use makes production the definition of the target, so it cannot
go stale. Measured output: **76** `revoke … from anon` + **52** `revoke … from authenticated`.

The 24 NULL-proacl extension functions are excluded: resetting an explicit ACL back to
"PostgreSQL default" is not directly expressible, and the difference is cosmetic. Recorded as
post-G10 technical debt.

---

## 3. Certificate migrations — independently re-verified

| Check | `certificate_types_and_admin_search` | `certificate_delete_removes_notifications` | `certificate_custom_heading` |
|---|---|---|---|
| repo forward file present on `staging` and `main` | YES | YES | YES |
| stored SQL staging = production (normalised) | YES `2af5ab02…` | YES `df2095bb…` | YES `36aaea09…` |
| stored SQL = repository file (case-sensitive, normalised) | **exact** | **exact** | **exact** |
| live objects identical staging vs production | YES | YES | YES |
| rollback committed | **NO** | **NO** | **NO** |
| rollback verified against forward | **YES** — 16→14 type set-diff is exactly `{achievement, custom}`, no extras | **YES** — trigger dropped before function | **YES** — recreated 11-column function is line-for-line identical (50/50) to the predecessor defined by the `…060000` forward migration |

Live object evidence, identical on both lanes: `certificates` = 18 columns including
`heading text NULL`; `certificates_type_check` carries all 16 values;
`certificates_heading_only_for_custom` = `CHECK ((heading IS NULL) OR (type='custom' AND
length(btrim(heading)) BETWEEN 1 AND 60))`; index `idx_certificates_issued_at_id_desc` present;
4 triggers on `certificates` including `trg_cleanup_certificate_references BEFORE DELETE`;
`admin_list_certificates` md5 `10d5b0a1…`, `admin_search_certificate_recipients` `4015ab92…`,
`cleanup_certificate_references` `c2afabeb…`, all with `authenticated`-only client grants.

### Contradictions — carried forward, NOT resolved

1. The `…120000` forward migration records *"Already present before this migration: staging 3
   orphans, PRODUCTION 1"*; its rollback baseline records *"0"*. **NEED EVIDENCE** — not
   retroactively reconstructable.
2. The heading rollback never drops `certificates_heading_only_for_custom`. Inspected on
   production: that constraint's `conkey` covers `type, heading`, so `DROP COLUMN heading`
   removes it implicitly. **Documentation gap confirmed; behaviour NOT EXECUTED** — no
   PostgreSQL server exists in this sandbox and testing on a live lane is not authorised.
3. All three rollback baseline blocks are stale (certificates 23→0, user_notifications
   3401→3432, certificate-referencing rows 11→0).

### Destructive operations in the prepared rollbacks

- `…060000` rollback step 4 restores the 14-value constraint — **will refuse** if any
  certificate carries `achievement` or `custom`. Production currently holds 0 certificates.
- `…170000` rollback step 2 `DROP COLUMN heading` — destroys every heading value. Currently 0
  non-null.
- `…120000` rollback cannot restore notification rows already deleted by the trigger.
- `20260824145345` rollback **would break production edge function `send-gift-credit` v23**.

---

## 4. Migration-history reconciliation — the minimum rule for G10

| Item | Classification |
|---|---|
| 3 certificate rollbacks not committed | **G10 BLOCKER** (§13.1) |
| `admin_user_lookup_by_email` forward file exists only on an unmerged branch; no rollback | **G10 BLOCKER** if the RC includes it; otherwise a recorded out-of-band change — **OWNER DECISION** |
| Production edge function `send-gift-credit` v23 source not in `main`/`staging` | **G10 BLOCKER** — an undocumented production artefact whose database dependency is in the RC's schema |
| 76 anon + 52 authenticated staging ACL divergences | **G10 BLOCKER** (§17-3, lane isolation) |
| 604 repository migrations with no rollback file | **post-G10 technical debt** — historical, outside the RC, must not be rewritten to make counts look better |
| Orphan rollback `UNAPPLIED_20260820140000_classF_repoint_originals` | **post-G10 technical debt** |
| Production ledger 37 rows vs 633 repo files; staging 5 rows | **NOT ACTIONABLE for G10** — explained: staging's project was created 2026-08-21, production's 2026-07-09, and the ledger records only what the newer tooling applied. Pre-ledger history reached both lanes by a route that wrote no rows. |
| 24 NULL-proacl `plpgsql_check` extension functions on production vs explicit on staging | **post-G10 technical debt**, cosmetic |
| Postgres minor 17.6.1.141 (prod) vs 17.6.1.155 (staging) | **NOT ACTIONABLE** |
| `20260824000000_admin_user_list_pagination` still named `UNAPPLIED_` though applied to both | **post-G10 technical debt** (§12.4 step 4 manifest hygiene) |
