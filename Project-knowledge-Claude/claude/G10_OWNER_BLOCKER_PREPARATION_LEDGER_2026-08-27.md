# G10 — OWNER-BLOCKER PREPARATION LEDGER

**2026-08-27. Read-only. No writes, no dispatch, no T change. Prepared while B20/B17 remain blocked.**
`main` = `b671e1f` · T = `e2e05fb` · PR #103 unmerged · AF-03 unapplied · RC NOT APPROVED.

---

## B8 — D-2 · **RECOMMENDATION: ACCEPT AS DOCUMENTED DEVIATION**

**Scope is larger than recorded — it is 8 files, not 4, plus a 9th orphan.**

| # | Current filename | Proposed filename |
|---|---|---|
| 1 | `supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql` | `20260824000000_admin_user_list_pagination.sql` |
| 2 | `supabase/migrations/UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql` | `20260825060000_certificate_types_and_admin_search.sql` |
| 3 | `supabase/migrations/UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql` | `20260825120000_certificate_delete_removes_notifications.sql` |
| 4 | `supabase/migrations/UNAPPLIED_20260825170000_certificate_custom_heading.sql` | `20260825170000_certificate_custom_heading.sql` |
| 5 | `supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql` | drop `UNAPPLIED_` |
| 6 | `supabase/rollback/UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql` | drop `UNAPPLIED_` |
| 7 | `supabase/rollback/UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql` | drop `UNAPPLIED_` |
| 8 | `supabase/rollback/UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql` | drop `UNAPPLIED_` |
| **9** | `supabase/rollback/UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` | **ORPHAN — no forward migration in this RC. Separate disposition required.** |

**Dependency scan — what references these filenames:**

| Consumer | Depends on the name? |
|---|---|
| `.github/workflows/apply-migration.yml` | **NO** — takes the path as a free-text dispatch input, validated only by the glob `supabase/{migrations,rollback}/*.sql`. No manifest, no hardcoded list. |
| Any CI workflow | **NO** — no workflow enumerates migration filenames |
| Rollback file internal headers | **YES** — each rollback's comment block names its forward file, e.g. *"ROLLBACK for UNAPPLIED_20260824000000_admin_user_list_pagination.sql"*. Renaming migrations without editing these comments creates fresh inconsistency. |
| `supabase_migrations.schema_migrations` | **NO** — keyed on version integers, not filenames. Already holds all five on both lanes. |

### Why the recommendation is ACCEPT, not RENAME

Renaming is **technically safe** — nothing machine-readable depends on the names. But renaming files
**changes the tree**. T would no longer be `e2e05fbb…`, and that invalidates in one step: the staging-lane
CI run `32976271438`, the 21/21 mutant result from `32982588154`, the 122/122 schema-guard result, and
the tree-equality proof that the promotion conflict resolves exactly to T.

**A rename is therefore a candidate rebaseline, not a tidy-up.** Under the standing freeze that must be
escalated as a decision, not implemented. The defect is documentary and the cost of carrying it for one
release is a paragraph in the RC record; the cost of renaming is re-earning every CI artifact.

**RECOMMENDED: ACCEPT AS DOCUMENTED DEVIATION for RC-20260826-01; execute the 9-file rename in G11**,
where it costs nothing and the orphan can be dispositioned at the same time.

---

## B6 — N1/N2 · **OWNER DISPATCH ONLY — and the runbook's N1 design is unsafe as written**

### Workflow anatomy (`.github/workflows/apply-migration.yml`)

Inputs: `target` (choice: staging|production) · `migration` (path) · `confirm` (same path retyped).
Job binds `environment: ${{ inputs.target }}`; `DB_URL` comes from that Environment's `SUPABASE_DB_URL`.

**Gate order — all four run BEFORE psql:**

| # | Gate | Refusal condition |
|---|---|---|
| 1 | Branch ↔ target | `production` must be dispatched from `main`; `staging` from `staging` |
| 2 | Credential present | `SUPABASE_DB_URL` non-empty |
| 3 | **REF ASSERTION** | parses `postgres.<ref>` from the URL username; refuses if `ref != expected` for the target. Also refuses a direct (non-pooler) URI, which parses to `postgres` and matches neither |
| 4 | Path validation | `migration == confirm`; path under the two allowed dirs; no `..`; file must exist |

`psql` executes only at the later **"Run it"** step. **A mismatch refusal therefore executes ZERO SQL.**
That is the safety fact N1/N2 depend on, and it is confirmed by reading the file.

### ⚠ The structural problem with N1/N2 as the runbook words them

Because the job binds `environment: ${{ inputs.target }}`, **the credential is bound to the target by
construction — a mismatch cannot occur naturally.** To produce one you must deliberately mis-set an
Environment's secret to point at the other lane. The two directions are **not** equally risky:

| Test | Setup | Failure mode if gate 3 fails |
|---|---|---|
| **N2** — staging URL, production target | production Environment temporarily holds the **staging** URL | SQL hits **staging**. **Benign.** |
| **N1** — production URL, staging target | staging Environment temporarily holds the **production** URL | **SQL hits PRODUCTION live member data.** **Catastrophic.** |

**Recommendation: execute N2 as written. Do NOT execute N1 as written.**

**Safe N1 substitute — same control class, zero production risk:** dispatch `target=staging` from branch
**`main`**. This trips **gate 1** and refuses *before the credential is ever read*, producing a genuine
recorded refusal for the wrong-lane case without ever placing a production credential in a staging
Environment.

### Exact dispatch configurations for the owner

**N2 (ref-assertion, real mismatch):**
1. Temporarily set the **production** Environment's `SUPABASE_DB_URL` to the **staging** pooler URI.
2. Actions → *Apply a database migration* → Run workflow from **`main`**:
   `target = production` · `migration = supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql` · `confirm =` same
3. **Expected:** step *"The credential must point at the target database"* fails with
   `::error::secret points at 'ztzutckwdhetphwghuzj', target is 'production' — refusing`
4. **Restore the production secret immediately.** Capture run ID + that literal line.

**N1-substitute (branch↔target gate):**
1. No secret change at all.
2. Actions → Run workflow from **`main`**: `target = staging` · same file path in both boxes.
3. **Expected:** step *"The branch must match the target"* fails with
   `::error::target='staging' must be dispatched from 'staging', but this run is on 'main'. Refusing.`
4. Capture run ID + literal line.

**I cannot execute either.** No workflow-dispatch tooling is available to this session, and the workflow
is owner-only by its own design (§19). **B6 stays OPEN until run evidence exists. Not claimed VERIFIED.**

---

## B7 — §5.3 SECRET ISOLATION · **OWNER ONLY — the plan says so explicitly**

MEP §5.3 read verbatim. Method: throwaway branch outside both lanes → a workflow that echoes **only**
empty/non-empty (never the value, never a masked value) → **push from a session that holds push rights —
"this session does not (§19)"** → observe the run → record run ID + literal log line → delete branch
(owner action, §19) → **re-run at G10 immediately before promotion, as a separate timestamped record**.

**State:** branch `scratch/g10-53-secret-isolation-20260826` exists at `9478cf7`. **No probe workflow
exists in T's `.github/workflows/`** — the probe must live on the throwaway branch itself.

**⚠ Timing matters:** §5.3.6 requires the re-run **immediately before promotion**. Executing it now would
go stale by Phase 8 and need repeating. **Schedule it as a Phase-8 pre-merge step, not now.**

**Owner action:** push the probe workflow to the scratch branch at the promotion window; return the run ID
and the literal line showing the reference resolved **EMPTY**; delete the branch. Evidence must show
*empty*, not a masked value — §5.3 states masking is not proof of absence.

---

## B10 — ANDROID versionCode · **RECOMMEND: NOT APPLICABLE, WITH REASONING**

**Why it is absent from T — and this is correct, not a defect:** there is no `android/` directory in the
repository at any commit. Capacitor generates it at build time; `.github/workflows/android-build.yml`
then does `sed -i "s/versionCode 1/versionCode ${VC}/" android/app/build.gradle`.

**Formula:** `versionCode = 1000 + github.run_number` (monotonic) · `versionName` hardcoded, currently `1.2.16`.

**⚠ NEW FINDING AF-13 — the repository's own Android version records contradict each other:**

| Source | Claim |
|---|---|
| `android-build.yml` inline comment | Play production on **1073 (1.2.2)** as of 2026-08-12 |
| `android-build.yml` echo line | "**1.2.11 / build 1102 went public**" |
| `android-build.yml` comment | build **1110** cut as 1.2.15, uploaded to Play production **as a draft** |
| `ANDROID_RELEASE_RUNBOOK.md` §4 | versionName **1.1.1**; latest built **1010**; live on Play **1005** |

Four sources, four different answers. **No repository source is authoritative.**

**Disposition:** RC-20260826-01 is a **WEB-ONLY** release — it produces no Android artifact and cannot
change any versionCode. Recommend recording §8.9 as **NOT APPLICABLE — web-only release, no Android
artifact produced**, rather than leaving it OPEN indefinitely.
**If a baseline is still wanted:** the only authoritative source is the **Play Console** production track.
Owner returns the integer plus a screenshot/timestamp. AF-13 is logged for G11 regardless.

---

## B11 — ROLLBACK BINDING · **PREPARED, EXACT**

Five rollback files, 1:1 with the five migrations. Each file's header names its forward migration
explicitly, and each states it is **prepared, not run** — correct for a rollback set.

| # | Migration (version applied both lanes) | Rollback file | Header names its forward file |
|---|---|---|---|
| 1 | `20260824145345_admin_user_lookup_by_email` | `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql` | ✅ |
| 2 | `admin_user_list_pagination` | `supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql` | ✅ — *"purely ADDITIVE… safe to run at any time"* |
| 3 | `certificate_types_and_admin_search` | `supabase/rollback/UNAPPLIED_20260825060000_..._ROLLBACK.sql` | ✅ — *"reverses, in reverse order of creation"* |
| 4 | `certificate_delete_removes_notifications` | `supabase/rollback/UNAPPLIED_20260825120000_..._ROLLBACK.sql` | ✅ |
| 5 | `certificate_custom_heading` | `supabase/rollback/UNAPPLIED_20260825170000_..._ROLLBACK.sql` | ✅ — revision 2, two draft defects corrected 2026-08-26 |

**EXCLUDED from the binding:** `supabase/rollback/UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql`
— orphan, no corresponding forward migration in this RC.

### Binding statement for owner signature

> **DATABASE ROLLBACK COMPONENT — RC-20260826-01.**
> The database rollback for release candidate RC-20260826-01 (tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`)
> is the following five files, to be executed in reverse migration order (5 → 1) via
> `.github/workflows/apply-migration.yml` with `target = production` dispatched from `main`:
> 1. `supabase/rollback/UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql`
> 2. `supabase/rollback/UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql`
> 3. `supabase/rollback/UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql`
> 4. `supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql`
> 5. `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql`
>
> `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` is **not** part of this set.
> This rollback set has been **prepared and reviewed but never executed**. It is untested against a live
> database; §17-9's Pages-deployment rollback does not cover schema.
>
> Signed: ______________________  Date: ____________

---

## B13 — §14 G9 COUNTERSIGNATURE · **PREPARED, NOTHING MISSING**

Source: `claude/G10_S14_G9_EXCLUSION_RULING_AND_EXECUTION_2026-08-26.md`.
Prerequisite check: measured basis present (71 functions: **21 MATCH · 21 differing only in
`_shared/secureHeaders.ts` · 29 DRIFT · 0 UNKNOWN**), three named findings, four named residual risks,
and the attached conditions. **No prerequisite is missing.**

### Countersignature block for owner execution

> **§14 RULING — COUNTERSIGNATURE. Control C4.**
> I countersign the ruling **G9 IS EXCLUDED FROM G10**; G10 proceeds with G9 blocked and G9 becomes its
> own release. I have read the measured basis (71 production edge functions compared byte-for-byte
> against the candidate tree on 2026-08-26) and I accept, explicitly, these four residual risks for the
> duration of this release:
> 1. **Pre-G9 CORS in production — all 71 functions** (deployed `_shared/secureHeaders.ts` byte-identical, md5 `58b9f45d…`, prefix matching with a `.lovable.app` wildcard).
> 2. **Wildcard CORS** — `submit-judge-decision` v23 answers `Access-Control-Allow-Origin: *`, and shipping `secureHeaders.ts` would not fix it.
> 3. **Storage-lane guard absent in ten functions** — `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`, `detect-orphan-files`, `backfill-image-dims`, `media-register-upload`.
> 4. **Lane-config drift in eight functions**, including all three email functions.
>
> I accept the attached conditions: **no production edge function is redeployed during G10; Phase 10
> does not run; step 4.11 is NOT APPLICABLE.**
>
> Signed: ______________________  Date: ____________

---

## B12 — CHANGE LEDGER · **CLOSURE IS STRUCTURALLY BLOCKED — NEW FINDING AF-14**

| ID | Change | Class | State |
|---|---|---|---|
| CHG-G10-001 | PR #102 → staging (9 files) | INTENDED | ✅ applied & verified |
| CHG-G10-002 | ACL remediation, 252 statements | INTENDED | ✅ applied & verified |
| CHG-G10-003 | PR #103 — arm production isolation host rules | INTENDED | 🟡 **PREPARED, NOT MERGED** |
| CHG-G10-004 | Flow 6 friendship +1 | INTENDED | ✅ QA evidence |
| **CHG-G10-005** | **Story +1** | **⚠ UNINTENDED** | auto-expires 2026-08-28 05:19 UTC |
| CHG-G10-006 | Flow 1 test post +1 | INTENDED | ✅ QA evidence |
| CHG-G10-007 | Flow 5 like +1 | INTENDED | ✅ |
| CHG-G10-008 | Flow 4 comment +1 | INTENDED | ✅ |
| CHG-G10-009 | Notification fan-out +513 | INTENDED consequence of CHG-006 | ✅ |

**CHG-G10-005 is confirmed the ONLY UNINTENDED entry.** All RLS write tests were rolled back with zero
residue. No production row was written at any point.

### ⚠ AF-14 — LEDGER-CLOSURE DEADLOCK

§11 makes **"Change Ledger closed, none UNINTENDED"** a prerequisite for **Phase 7 approval**.
The ledger cannot close while **CHG-G10-003 is unapplied**. CHG-003 is a merge into `main`, which the
standing freeze forbids and which otherwise happens at **Phase 8 — after approval.**

**Therefore Phase 7 cannot open under the current rules.** This is a sequencing contradiction in the plan,
not an execution failure, and it needs an owner ruling. Three resolutions:

| Option | Effect |
|---|---|
| **A** | Merge PR #103 into `main` before Phase 7 — an explicit, recorded freeze exception |
| **B** | Close the ledger with CHG-003 recorded as **PREPARED — PENDING PROMOTION**, a documented non-UNINTENDED state |
| **C** | Withdraw CHG-003 from this RC entirely and ship the production-lane arming in G11 |

**Exact closure condition:** the ledger closes when CHG-G10-003 reaches a terminal state (merged, or
formally recorded as pending under option B, or withdrawn under option C) **and** CHG-G10-005 is
dispositioned (kept as documented QA evidence, or purged). Everything else is already terminal.

---

## B14 — AF-03 · **RECORDED AS OPTION D. NO MUTATION PERFORMED.**

`af03_keys_still_present = 6` — unchanged. No staging data modified, no R2 object copied, no URL
rewritten, no SEO field nulled, no change to T.

### Ledger language for the RC record

> **DEVIATION D-5 — DATA-BORNE PRODUCTION-CDN REFERENCES IN STAGING CONFIGURATION.
> DISPOSITION: ACCEPTED (Option D). Owner decision, 2026-08-27.**
>
> Staging `public.site_settings` holds **46 references** to `https://cdn.50mmretina.com`, resolving to
> **12 distinct production objects**, across six keys: **37 live** (`managed_pages` 17 — 6 `og_image`
> plus 11 inside `json_ld`; `seo_pages` 7; `ad_slots` 9; `ad_zones_v2` 3; `seo_global` 1) and
> **9 backup-only** (`ad_slots_backup_20260723`).
>
> Measured with positive and negative controls on both origins: the 12 objects **exist in production R2**
> and are **absent from staging R2**; requested from a staging page the **production CDN refuses them**
> (they exist, yet error). **There is therefore no cross-lane data leak — staging cannot obtain
> production assets, and the refusal is the production CDN's origin policy working correctly.**
>
> The residual defects accepted are: (a) §15 row 1's negative criterion literally fails, since an asset
> does resolve to `cdn.50mmretina.com`; (b) staging renders broken ad and OG images on 29 routes.
>
> **Remediation was declined deliberately.** Nulling the SEO keys would remove `og:image` and
> `json_ld` entirely, converting a visible failure into a **vacuous pass** on §15 row 8 — the precise
> anti-pattern this gate exists to prevent. Copying the 12 objects into staging R2 (the only remediation
> that would yield honest passes on rows 1 and 8) requires the R2 write capability blocked at B5.
>
> **CONTROL GAP — carried to G11.** The bundle isolation guard scans **built code**. These references
> live in **database rows** and are invisible to every R-rule, every mutant and every CI run. The guard's
> 21/21 mutant result is unaffected and is not downgraded. **A data-side isolation scan is required to
> close this class and is deferred to G11**; the scanner used here (all `text`/`varchar`/`jsonb`/`ARRAY`
> columns in `public`, with a positive control) is recommended as the standing check.

---

## NEW FINDINGS THIS RUN

| ID | Finding |
|---|---|
| **AF-13** | Android version records contradict across four repository sources (1005/1010/1073/1102/1110; 1.1.1 vs 1.2.16). No repository source authoritative. |
| **AF-14** | **Ledger-closure deadlock** — §11 requires a closed ledger for Phase 7, but the ledger cannot close until CHG-003 merges, which occurs at Phase 8 after approval. |

---

*No secret, token, cookie or session value requested, displayed or recorded.
Zero writes. Zero dispatches. T unchanged.*
