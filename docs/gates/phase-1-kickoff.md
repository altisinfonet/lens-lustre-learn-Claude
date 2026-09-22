# PHASE 1 KICKOFF — task 1-AU-01

**Auditor-owned. Authored 2026-09-22.**

**Basis:** `main` `96c9d91d` · `staging` `f0377afa` — both verified against GitHub 2026-09-21T14:31Z.
All catalogue readings from Supabase project `fpszggreishhuvdpkmdr` (staging), `SELECT` only.

> **Standing deviation, recorded not backdated.** 1-AU-01 requires this file *"on staging before
> either developer branches."* Phase 1 branching began no later than 2026-09-05; at least six D1
> branches and twenty pull requests have been cut since. This kickoff is **retrospective**.

---

## 1 · Units and owners

| Unit | Title | Owner | Gate Register status |
|---|---|---|---|
| P30 | Account enumeration closed | D1 SQL · D2 client | `NOT STARTED` (Rev 7, 2026-09-03) |
| P31 | Certificate and staff-ID search surface narrowed | D1 SQL · D2 client | `NOT STARTED` |
| P32 | Unauthenticated write and compute endpoints closed | D1 · D2 Pages-side | `NOT STARTED` |
| P33 | Compromised-password protection; catalogue tidied | D1 · Owner toggle | `NOT STARTED` |

The register's recorded status and the repository's actual state disagree materially. The
disagreement is published in §5 rather than resolved by rewriting either.

---

## 2 · Migration block

**Phase 1 block: `20260910_0001_*` – `20260910_0099_*`** (Addendum A §3.2). No ordinal outside this
block. No developer selects an ordinal independently.

### Ordinal state, read from `origin/staging` 2026-09-21T14:35Z

| Ordinal | State | Ruling |
|---|---|---|
| `0001`–`0018`, `0020`–`0022` | present on staging | closed |
| **`0019`** | **DUPLICATED** — `0019_f105d_process_referral_reward_authorize.sql` and `0019_f93_production_handle_backfill.sql` | Run order undefined. **BLOCKED**, see §2.1 |
| `0023` | **absent from staging**; on `main` only as `UNAPPLIED_20260910_0023_*` | **BLOCKED**, see §2.1. Interim: treat as burned |
| **`0024`** | **collides across lanes** — staging `0024_p32mail_delete_email_revoke.sql`, main `0024_f105de_referral_reward_production_close.sql` | Both legitimate on their own lane. Neither is reconciled |
| `0025`, `0026` | on staging via #258 | merged, **not applied** — §4.1 |
| `0027`–`0029` | reserved to PR #274 | — |
| `0030` | reserved to PR #276 | — |
| `0031`–`0039` | **free** | unallocated |
| `0040`, `0041` | reserved to PR #275 | — |
| `0042`–`0099` | **free** | unallocated |

### 2.1 · Ordinal rulings owed but not made

Both require `apply-migration.yml` run history, which the authoring session could not read (no
GitHub API access from that session). Recorded **BLOCKED**, not guessed:

- **`0019` run order.** Neither file appears in `supabase_migrations.schema_migrations`.
- **`0023` burned or reusable.** Withdrawn under PR #237. Until ruled, no developer allocates it.

### 2.2 · Allocation rule, in force from this kickoff

The Auditor allocates a **disjoint ordinal range per unit** in this file before any SQL is written.
Two ordinals in this block have already collided with no parallel workers running; independent
selection is the cause.

---

## 3 · Dependency window

**CLOSED.** No `package.json` / `package-lock.json` change is in scope for Phase 1.

---

## 4 · Interface rule — the revocation list

Per 1-AU-02 the list is frozen after D2's call-site inventory and **before** D1's SQL.

**Currently signed authority: `docs/gates/P1-revocation-list.md`, REVISION 2, 2026-09-04**, last
commit `3b06310` (2026-09-05). Verified 2026-09-21T14:35Z: no Revision 3 exists anywhere in the
repository — `grep -rl "REVISION 3" docs/` returns 0 files.

Revision 2 §2.1 clears exactly one object, `email_exists(text)`, extended to
`{public, anon, authenticated}` by AUDITOR-RULING-2026-09-05-01. Its closing line: *"Nothing else is
cleared for revocation in this issue of the list."*

§2.4 additionally **defers** two things that open pull requests act on:

- `get_public_role_user_ids` — deferred; the body raises `42501` outside `('admin','judge')`.
- the fourteen `admin_*` / `fix_*_admin` / `backfill_*` / `get_*_admin` functions — *"anon-executable
  **and guarded in the body** … **It is not an open door, and the phase is not to be re-planned as
  though it were.**"*

### 4.1 · Merged is not applied — VERIFIED 2026-09-21T14:33Z

`supabase_migrations.schema_migrations` holds **8 rows**, all `20260915`, against **661** migration
files in the staging tree.

| Function | Revoke merged on staging | Live ACL | Applied? |
|---|---|---|---|
| `delete_email` | `0024`, PR #258 | `=X/postgres \| anon=X/postgres` | **NO** |
| `emit_notification` | `0025`, PR #258 | `=X/postgres \| anon=X/postgres` | **NO** |
| `move_to_dlq` | `0026`, PR #258 | `=X/postgres \| anon=X/postgres` | **NO** |
| `set_write_path` | media pipeline, PR #262 | `=X/postgres \| anon=X/postgres` | **NO** |
| `enqueue_email` | not among the 8 recorded | `postgres=X \| service_role=X` | **closed** |
| `read_email_batch` | not among the 8 recorded | `postgres=X \| service_role=X` | **closed** |
| `media_quarantine` | not among the 8 recorded | `postgres=X \| service_role=X` | **closed** |

**Ruling.** `schema_migrations` is an **incomplete** dispatch log and cannot be used as evidence of
closure in either direction. The boring explanation is that `apply-migration.yml` dispatches a
reviewed `.sql` file and need not write that table at all. The authoritative dispatch log is the
workflow run history. **Until a session can read it, the catalogue is the only admissible source of
closure state.**

---

## 5 · Register / reality disagreement, published unresolved

| | Gate Register Rev 7 (2026-09-03) | Measured 2026-09-21 |
|---|---|---|
| P32 scope | "**Eight functions**, each dispositioned individually" | **75** non-trigger VOLATILE anon-executable, all `SECURITY DEFINER`, all `PUBLIC`-granted |
| P30 | `NOT STARTED` | `email_exists` closed on staging; client call removed (PR #252, merged) |
| P31 | `NOT STARTED` | `search_certificates` closed; `verify_staff_id` **still open** |
| P33 | `NOT STARTED` | `plpgsql_check` already in `extensions`; `get_primary_admin_user_id` already closed; both RLS tables `anon SELECT = false` |

The register is **18 days stale**. It is **not** corrected here: a row moves only on the Auditor's
own instrument run against **both** lanes, and the production project `jtdtehuqtinjxropkkcn` is not
attached to any session's Supabase connector. Revision 3 §6.4 concedes the same: *"No gate closes
VERIFIED on one lane."*

---

## 6 · Entry conditions — status, not assertion

| Condition | State |
|---|---|
| Phase 0 closed, P-0 promoted, compare zero | P-0 promoted (REV-25). **compare reads 8 files, not zero** — Owner decision pending |
| H-4 staging credential probe green | not re-verified — **INFERRED at best** |
| H-5 required reviewer on production Environment | not readable from any current session — **BLOCKED** |
| This kickoff committed, naming block and window | **satisfied by this file** |
| All three sessions loaded `50mm-security-reviewer` | Auditor: yes. Developers: unverified |

**Phase 1 opens with two entry conditions unmet and one unverifiable.**

---

## 7 · Standing correction — Revision 2 §2.2's block on `increment_managed_page_view` is stale

**Recorded 2026-09-22. Revision 2's text is NOT edited; this correction sits beside it.**

Revision 2 §2.2 still carries: *"`ManagedPageView.tsx:34` fires `.then(() => {})` with no rejection
handler. A revoke turns it into an unhandled rejection on a public page. Client handler first."*

**Both halves were false before Revision 2 was committed.**

| Claim | Measured 2026-09-22 | Instrument |
|---|---|---|
| call site is `ManagedPageView.tsx:34` | call site is **`src/pages/ManagedPageView.tsx:69`** | `grep -rn` on `origin/staging` |
| a revoke yields an unhandled rejection | a revoke yields a **resolved** `{data:null, error, status:0}` | `src/pages/__tests__/managedPageViewCounter.test.tsx`, measuring the installed `@supabase/postgrest-js`: `PostgrestBuilder.then()` attaches its own `.catch()` when `throwOnError()` was not called |

The fix landed in commit `01fdf16` (PR #148), **2026-09-04 16:55:39 +0530** — *before* Revision 2
was committed on 2026-09-05 13:02. The test additionally asserts that a `42501`/403 refusal
produces exactly one counter warning, so the behaviour is pinned.

§2.2's discharge covers `search_certificates` only (AUDITOR-RULING-2026-09-05-02). The
`increment_managed_page_view` row was never discharged and still stands on a disproved premise.

**Effect.** A Standing Rule 21 finding — an instructing comment disagreeing with its code. It does
**not** authorise a revoke. The object's disposition remains an open Owner decision (silent loss of
signed-out view counts versus an edge replacement). It removes only the client error-handling
ground, which is no longer a reason for anything.
