# G10 — SIGNATURE TEXTS, READY TO EXECUTE

**2026-08-29. Consolidated from the 08-27 preparation ledger and signing pack, re-checked against
live state today. Read-only: nothing signed, merged, dispatched or written to produce this.**

`main` = `b671e1fb` · candidate **T** = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`
(staging commit `b8535fe7`) · **RC-20260826-01** · tags = **0** · RC **NOT APPROVED**

> **⚠ These are YOUR declarations, not mine.** Each asserts facts as true. I have pre-filled them
> from measured evidence and named the source for every claim, but **you are the one attesting**.
> Where a text says *"I have read X"*, read X first — a signature on an unread basis is worthless,
> and the plan says so itself. **I do not sign any of these, and I have not marked any gate closed.**

---

## 0 · STATE CHANGES SINCE THE 08-27 PACK — three items no longer need signing

Verified today, 2026-08-29:

| Item | 08-27 status | **Now** |
|---|---|---|
| **HS-12 / OA-8** branch protection | "never configured" | ✅ **DONE** — ruleset `protect-main` **Active**, targets `main`, **bypass list empty**, rules: *Require a pull request before merging* · *Block force pushes* · *Restrict deletions*. Re-verified by me today. |
| **OA-1** repository secret scope | assumed | ✅ **DONE** — `SUPABASE_DB_URL` exists **only** as a `production` **Environment** secret. Repository secrets = 4, all `ANDROID_*`. Re-verified today. |
| **OA-12 / D-3** staging deployment ID | "rule N/A — no deployment exists" | ✅ **VOID — no ruling needed.** Deployment **`3a6f3df9-639b-444f-846a-b17be22cde73`** exists and serves `staging.50mmretina.com` from `staging b8535fe`. The N/A ruling drafted in the execution pack is obsolete; **do not sign it.** |
| **OA-6 / G5b** Pages variables | OPEN, "code half needs a new candidate" | ✅ **GREEN** per the 08-27 signing pack — defaults removed, guard scans `functions/`, all three Pages variables present. |

**OA-8, OA-1, OA-12 and OA-6 require no signature. Four items closed off the list.**

---

## 1 · OA-13 · CHG-G10-005 — **ALREADY RULED, NEEDS ONLY A SIGNATURE**

The ruling text is **already written and recorded** in `claude/G10_CHANGE_LEDGER_CLOSED_2026-08-27.md`.
It reclassifies the entry TEST/HARNESS and waives it. **The signature line at the foot of that
document is blank.** Nothing new to draft — sign it there, or sign the restatement below.

**Measured:** `stories` rows = 1 · `expires_at` = 2026-08-28T05:19:25Z (**now passed**) · expiry
function in `public` = **0** · cron jobs referencing `stories` = **0**. `expires_at` governs display
filtering only. **There is no reaper — the row persists until deleted.**

> **RULING — CHG-G10-005.**
> §9.4 defines UNINTENDED as *"any difference between `main` and the RC."* The Story row is a
> **staging database artefact** created during QA. It is not in the tree, not in any commit, and not
> in production, and is therefore **not** a difference between `main` and the release candidate. It
> does not meet §9.4's definition of UNINTENDED.
>
> **CHG-G10-005 is reclassified TEST/HARNESS and waived.** The row remains in the staging database.
> This is a definitional correction, not a waiver of substance. The entry is **not** deleted from the
> ledger and the circumstances of its creation remain recorded in full.
>
> Carried to G11: the duplicate-file-input hazard that let a QA upload reach the Story composer.
>
> Signed: ______________________  Date (UTC): ____________

*Alternative if you prefer it gone: say so and I will delete the single staging row — it is a staging
write and I will not do it unasked.*

---

## 2 · OA-14 · B12 — CHANGE LEDGER CLOSURE (resolves the AF-14 deadlock)

**The deadlock, stated plainly:** §11 requires *"Change Ledger closed, none UNINTENDED"* before
**Phase 7** approval. The ledger cannot close while **CHG-G10-003** (PR #103) is unmerged — and that
merge happens at **Phase 8, after approval.** This is a **sequencing contradiction in the plan**, not
an execution failure. It needs your ruling.

**Note on PR #103:** its head `704ad57` is **not** an ancestor of `staging`, so it is **not in the
candidate tree**. Its own description says *"Do not merge — opened for review only."* Merging it now
(Option A) would be an explicit freeze exception **and would change what gets promoted**.

> **RULING — AF-14, CHANGE LEDGER CLOSURE.**
> CHG-G10-003 (PR #103, arming the production-lane isolation host rules) is recorded as
> **PREPARED — PENDING PROMOTION**, a documented terminal state that is **not** UNINTENDED under
> §9.4. It is not part of candidate tree `e2e05fbb…` and is not merged by this release.
>
> With CHG-G10-005 dispositioned (§1 above), **all nine ledger entries are terminal and none is
> UNINTENDED. The Change Ledger for RC-20260826-01 is CLOSED.**
>
> §11 prerequisite 2 — *"Change Ledger closed, none UNINTENDED"* — is satisfied.
>
> Signed: ______________________  Date (UTC): ____________

*(This is Option B of the three the preparation ledger set out. Option A merges #103 before Phase 7
— a freeze exception that changes the promoted tree. Option C withdraws #103 to G11. **B is the only
one that neither breaks the freeze nor drops the work.**)*

---

## 3 · OA-9 · B8 / D-2 — THE NINE `UNAPPLIED_` FILES

**Measured:** 9 files = **4 migrations + 5 rollbacks**. The ninth,
`UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql`, is an **orphan** with no forward
migration in this RC.

**Why accept rather than rename:** nothing machine-readable depends on these filenames — the
migration workflow takes a free-text path, no CI enumerates them, and
`supabase_migrations.schema_migrations` is keyed on version integers, not names. **But renaming
changes the tree.** T would cease to be `e2e05fbb…`, invalidating in one step: staging CI run
`32976271438`, the 21/21 mutant result (`32982588154`), the 122/122 schema-guard result, and the
tree-equality proof. **A rename is a candidate rebaseline, not a tidy-up.**

All five corresponding migrations are **already applied to production** under different version
stamps — so §12.4 step 12 is a genuine no-op, and **the approved manifest must be explicitly empty,
not assumed empty.**

> **DEVIATION D-2 — MIGRATION FILENAME PREFIX. DISPOSITION: ACCEPTED AS DOCUMENTED DEVIATION.**
> I accept for RC-20260826-01 that these nine files retain their `UNAPPLIED_` prefix while the
> migrations they name are applied in production:
> 1. `supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql`
> 2. `supabase/migrations/UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql`
> 3. `supabase/migrations/UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql`
> 4. `supabase/migrations/UNAPPLIED_20260825170000_certificate_custom_heading.sql`
> 5–8. the four corresponding `supabase/rollback/UNAPPLIED_…_ROLLBACK.sql` files
> 9. `supabase/rollback/UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` — **orphan,
>    no forward migration in this RC; separate disposition deferred to G11**
>
> The defect is **documentary**. Renaming would rebaseline the candidate and cost every CI artifact
> already earned against tree `e2e05fbb…`. **The 9-file rename and the orphan's disposition are
> deferred to G11**, where they cost nothing.
>
> I further note that the approved migration manifest for §12.4 step 12 is **explicitly EMPTY**.
>
> Signed: ______________________  Date (UTC): ____________

---

## 4 · OA-11 · B11 — DATABASE ROLLBACK BINDING

> **DATABASE ROLLBACK COMPONENT — RC-20260826-01.**
> The database rollback for RC-20260826-01 (tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`) is the
> following five files, executed in **reverse migration order (5 → 1)** via
> `.github/workflows/apply-migration.yml` with `target = production`, dispatched from `main`:
>
> 1. `supabase/rollback/UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql`
> 2. `supabase/rollback/UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql`
> 3. `supabase/rollback/UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql`
> 4. `supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql`
> 5. `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql`
>
> `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` is **NOT** part of this set.
>
> **I acknowledge this rollback set has been prepared and reviewed but NEVER EXECUTED.** It is
> untested against a live database. §17-9's Pages-deployment rollback does not cover schema.
>
> Signed: ______________________  Date (UTC): ____________

---

## 5 · OA-10 · B13 — G9 EXCLUSION COUNTERSIGNATURE

> **⚠ READ FIRST:** `claude/G10_S14_G9_EXCLUSION_RULING_AND_EXECUTION_2026-08-26.md`. The four
> residual risks are restated below, but the measured basis is in that document. **Signing without
> reading it makes the signature worthless.**

**Measured basis:** 71 production edge functions compared byte-for-byte against the candidate tree
on 2026-08-26 — **21 MATCH · 21 differing only in `_shared/secureHeaders.ts` · 29 DRIFT · 0 UNKNOWN.**

> **§14 RULING — COUNTERSIGNATURE. Control C4.**
> I countersign the ruling **G9 IS EXCLUDED FROM G10**; G10 proceeds with G9 blocked, and G9 becomes
> its own release. I have read the measured basis and I explicitly accept these **four residual
> risks** for the duration of this release:
>
> 1. **Pre-G9 CORS in production — all 71 functions.** Deployed `_shared/secureHeaders.ts` is
>    byte-identical (md5 `58b9f45d…`), using prefix matching with a `.lovable.app` wildcard.
> 2. **Wildcard CORS** — `submit-judge-decision` v23 answers `Access-Control-Allow-Origin: *`, and
>    shipping `secureHeaders.ts` would **not** fix it.
> 3. **Storage-lane guard absent in ten functions** — `s3-delete`, `s3-presign-upload`,
>    `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`,
>    `detect-orphan-files`, `backfill-image-dims`, `media-register-upload`.
> 4. **Lane-config drift in eight functions**, including all three email functions.
>
> I accept the attached conditions: **no production edge function is redeployed during G10; Phase 10
> does not run; step 4.11 is NOT APPLICABLE.**
>
> Signed: ______________________  Date (UTC): ____________

---

## 6 · OA-15 · B14 / D-5 — AF-03 PRODUCTION-CDN REFERENCES IN STAGING DATA

**Nothing was mutated to establish this:** `af03_keys_still_present = 6`, unchanged. No staging data
modified, no R2 object copied, no URL rewritten, no SEO field nulled, no change to T.

> **DEVIATION D-5 — DATA-BORNE PRODUCTION-CDN REFERENCES IN STAGING CONFIGURATION.
> DISPOSITION: ACCEPTED (Option D).**
>
> Staging `public.site_settings` holds **46 references** to `https://cdn.50mmretina.com`, resolving
> to **12 distinct production objects**, across six keys: **37 live** (`managed_pages` 17 — 6
> `og_image` plus 11 inside `json_ld`; `seo_pages` 7; `ad_slots` 9; `ad_zones_v2` 3; `seo_global` 1)
> and **9 backup-only** (`ad_slots_backup_20260723`).
>
> Measured with positive and negative controls on both origins: the 12 objects **exist in production
> R2** and are **absent from staging R2**; requested from a staging page the **production CDN refuses
> them**. **There is therefore no cross-lane data leak** — staging cannot obtain production assets,
> and the refusal is the production CDN's origin policy working correctly.
>
> **Residual defects accepted:** (a) §15 row 1's negative criterion literally fails, since an asset
> does resolve to `cdn.50mmretina.com`; (b) staging renders broken ad and OG images on **29 routes**.
>
> **Remediation was declined deliberately.** Nulling the SEO keys would remove `og:image` and
> `json_ld` entirely, converting a visible failure into a **vacuous pass** on §15 row 8 — the precise
> anti-pattern this gate exists to prevent.
>
> **CONTROL GAP — carried to G11.** The bundle isolation guard scans **built code**; these references
> live in **database rows** and are invisible to every R-rule, every mutant and every CI run. The
> guard's 21/21 mutant result is unaffected and is **not** downgraded. A **data-side isolation scan**
> is required to close this class and is deferred to G11.
>
> Signed: ______________________  Date (UTC): ____________

---

## 7 · OA-16 · B10 — ANDROID versionCode

**Why it is absent from T, correctly:** there is no `android/` directory at any commit. Capacitor
generates it at build time; `android-build.yml` then rewrites `versionCode` via `sed`.
Formula: `versionCode = 1000 + github.run_number`.

**⚠ AF-13 — the repository's own Android version records contradict each other:**

| Source | Claim |
|---|---|
| `android-build.yml` inline comment | Play production on **1073 (1.2.2)** as of 2026-08-12 |
| `android-build.yml` echo line | "**1.2.11 / build 1102** went public" |
| `android-build.yml` comment | build **1110** cut as **1.2.15**, uploaded to Play as a **draft** |
| `ANDROID_RELEASE_RUNBOOK.md` §4 | versionName **1.1.1**; latest built **1010**; live on Play **1005** |

**Four sources, four different answers. No repository source is authoritative.**

> **§8.9 ANDROID versionCode — NOT APPLICABLE, WITH REASON.**
> RC-20260826-01 is a **WEB-ONLY** release. It produces no Android artifact and cannot change any
> versionCode. §8.9 is recorded **NOT APPLICABLE — web-only release, no Android artifact produced.**
>
> **AF-13 (contradictory Android version records across four repository sources) is logged for G11**
> regardless of this disposition. The only authoritative source is the **Play Console** production
> track; no repository file may be treated as authoritative until reconciled against it.
>
> Signed: ______________________  Date (UTC): ____________

---

## 8 · §15 QA MATRIX DISPOSITIONS — one signature covering the set

**§15 preamble:** *"A row is complete only when **both** its positive and its negative column carry
recorded evidence."* **§17-1** passes when *"no row is blank and no row is marked 'expected'."*
These are two different tests and both are live.

| Row | State | Disposition being signed |
|---|---|---|
| **1 · UI** | 🔴 **FAILING** | **Approving over a known-failing row** under D-5. Deployment ID `3a6f3df9-639b-444f-846a-b17be22cde73` now supplies the instrument. **This is not a pass and must not be recorded as one.** |
| **2 · Flows** | 7/10 | 2 blocked on the production-authenticated QA profile, 1 structurally untestable (0 journal articles). Scope to the flows exercisable. |
| **3 · Auth** | partial | **N/A with reason** — no staging mail path (§8.8 Option 1); `/login` + `/signup` need an anonymous browser context. |
| **5 · Storage** | ⚠ **see G8 record** | **NOT signed here.** Governed by `claude/G8_R2_WRITE_ISOLATION_EVIDENCE_2026-08-29.md`. |
| **6 · Edge functions** | 5/74 | Scope to functions reachable by the ten §15 flows. **The 5 financial functions recorded NOT TESTABLE — POLICY EXCLUSION, displayed explicitly, never folded into a coverage ratio.** |
| **8 · SEO** | 🔴 **FAILING** | **Approving over a known-failing row** under D-5. Instrument closed 07:26Z. |
| **10 · Responsive** | blocked | **N/A with reason** — `resize_window` reported success 3× while `innerWidth` never moved. **No substitute instrument accepted.** → G11 |
| **11 · Regression** | deferred | §18 is post-promotion by construction (§17-12). Phase 8. |
| **12 · Cross-lane** | N1 ✅ | **N2 cannot run before promotion** — `main` has no gate, so a pre-promotion N2 tests nothing (§14 HS-11). Phase 8. |

Rows **4, 7, 9** are verified; nothing required. Row 9 is **verified vacuously and recorded as vacuous.**

> I accept the §15 dispositions above, including that **rows 1 and 8 are approved WHILE FAILING**
> under D-5 and are not to be recorded as passes.
>
> Signed: ______________________  Date (UTC): ____________

---

## 9 · WHAT REMAINS AFTER ALL OF THE ABOVE ARE SIGNED

**Signing every text in this document does NOT authorise promotion.** These clear §10 and §11's
prerequisites. Four things then remain, in this order:

| # | Item | Who |
|---|---|---|
| 1 | **G8** — Option B's one command, or a waiver signature (`G8_R2_WRITE_ISOLATION_EVIDENCE_2026-08-29.md` §8) | Owner |
| 2 | **B7 / §5.3 secret-isolation probe** — push probe workflow to a fresh scratch branch, confirm the log prints literal **EMPTY**, delete the branch. **§5.3.6 requires this IMMEDIATELY BEFORE promotion** — running it early goes stale and must be repeated | Owner |
| 3 | **OA-19 · §11 Release Approval Record** — all eight fields, signed **and tagged BEFORE the merge** (§17-10) | Owner |
| 4 | **OA-20 · promotion** — §12.4 in order; **tree-equality asserted AFTER the merge against the tag created BEFORE it** (§17-11). Conflict `src/lib/generateCertificatePdf.ts` → **take the candidate's version.** If the tree does not equal `e2e05fbb…`: **STOP — do not migrate, do not deploy** | Owner |

**The §11 approval (item 3) cannot be signed while G8 is unresolved** — the signing pack removed G8
from its accepted-deviations list precisely because there was no ruling to accept.

### ⚠ And the standing precondition on the whole RC

**Candidate T is 7 commits behind `staging` HEAD** (`25c0456` as of 2026-08-29), including today's
composer/privacy change. Per §11's own validity clause — *"Any further commit to `staging` voids it
and requires a new RC"* — **promoting T means promoting the 08-26 tree, not what is on `staging`
today.** That is the agreed scope for this cycle; today's UI change ships in the next one.

---

## 10 · HONEST CEILING — UNCHANGED

**Best legitimate end state: 7 GREEN + 4 CLOSED WITH DOCUMENTED DEVIATION. Never 11 GREEN.**

G3's Environments and HS-12 are **OWNER-ATTESTED by construction** and under §3.1 *may never be
described as independently verified*, regardless of how thoroughly they were done. G10 cannot be
GREEN before promotion occurs. **Anyone reporting eleven greens on this candidate is reporting
something that does not exist.**

---

*Nothing signed, merged, dispatched, tagged or deployed to produce this document.
`main` unchanged · T unchanged · production unwritten.*
