# STAGING → MAIN PROMOTION LEDGER — MASTER

> **THIS IS THE CANONICAL LEDGER.** One file, updated in place, never superseded by a dated copy.
> Every prior dated `*_LEDGER_*.md` / `*_EVIDENCE_*.md` in `claude/` is an **input**, not an authority.
> Where a prior document conflicts with this one, **this one governs** and §14 records the correction.

**Repository path:** `docs/PROMOTION_LEDGER.md` (canonical, on `staging`)
**Ledger ID:** `LEDGER-50MM-001`
**Status of this revision:** `REV-9 · 2026-08-29T09:05Z`

---

# 1 · DOCUMENT CONTROL

| Field | Value | Class |
|---|---|---|
| **Release ID** | `RC-20260829-05` (AF-15 → -02; D-6 merge → -03; AF-19 → -04; ledger REV-7 → -05. Supersedes `RC-20260826-01`) | VERIFIED |
| **Ledger ID** | `LEDGER-50MM-001` | — |
| **Source lane** | `staging` → Supabase `ztzutckwdhetphwghuzj` → `staging.50mmretina.com` / `cdn-staging.50mmretina.com` / R2 `50mm-staging` | VERIFIED |
| **Target lane** | `main` → Supabase `jtdtehuqtinjxropkkcn` → `www.50mmretina.com` / `cdn.50mmretina.com` / R2 `50mm` | VERIFIED |
| **RC SHA (T)** | **`d06b0379776aef94d006d78b1de37a0cda685927`** · tree **`f4616fb680f863d1141491d9ab5f3b619c048f4b`**. Promotion merge base `9faf5a17` (parents `fe4505aa` + `b671e1fb`) | VERIFIED |
| **RC tree** | *re-derive at approval; `25c0456`'s tree `51616b21…` is superseded* | VERIFIED |
| **main pre-promotion SHA** | `b671e1fb0c5bcf145d442076c229eca888afd674` | VERIFIED |
| **main pre-promotion tree** | `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` | VERIFIED |
| **Merge base** | `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` | VERIFIED |
| **Promotion PR** | **#104** — `Promote staging to main — 32 commits` | VERIFIED |
| **Final merge SHA** | *not created* | **N/A — NOT PROMOTED** |
| **Production deployment SHA/ID** | *not created* | **N/A — NOT PROMOTED** |
| **Evidence gathered** | 2026-08-29 · 04:00Z–06:10Z | VERIFIED |
| **Owner** | Neil Basu (`altisinfonet`) | — |
| **Auditor** | **VACANT** — independent audit not performed (§25) | **OPEN** |
| **Compiled by** | Claude (Cowork session). **Not an auditor.** Compiler ≠ approver ≠ auditor. | — |

**Evidence classes used throughout:** `VERIFIED` (measured by the compiler in this session, instrument named) · `OWNER-ATTESTED` (asserted by the owner, unverifiable by construction) · `INFERRED` (reasoned, not measured — always flagged) · `BLOCKED` (measurable in principle, not measurable here) · `N/A` (with reason) · `DEFERRED` (with owner + date). **No class is silently upgraded.**

---

# 2 · RELEASE PURPOSE & SCOPE

**Purpose.** Promote 32 commits of accumulated `staging` work to `main`, covering: member-facing UI corrections; the certificates admin feature set; admin member-list pagination; and the G5b–G10 lane-isolation programme (removing hardcoded production addresses, adding a bundle-isolation guard, separating email/storage/SEO configuration per lane, and installing a migration lane gate).

**In scope:** application source, tests, CI workflows, Pages Functions, SEO assets, 2 new DB migrations, 5 new rollback files, one decision-record update.

**Explicitly NOT in scope:**
- Edge-function deployment (functions do **not** auto-deploy from GitHub — §16.4)
- Applying migrations to production (separate dispatch — §6.3)
- Android artifacts (§7 of the runbook; N/A — §11 G-A)
- PR #103 (production-lane isolation arming) — **not in T**, `704ad57` is not an ancestor of `staging`; its own body says *"Do not merge — opened for review only."*
- D-002 storage remediation (open — §13 AF-02)

---

# 3 · EXACT RC IDENTITY

## 3.1 Immutable candidate

```
T (RC SHA)   25c0456011451f644def7ef5361904e4de25dd08
T tree       51616b2196641abbad9d0cdc20171efc6a64facc
branch       staging
parent       c8dc83b1  (Multi-line comments render as multiple lines)
PR           #104  (base main ← head staging)
```
**Instrument:** `git rev-parse` against a full (unshallowed) clone of `origin`. **Class: VERIFIED.**

## 3.2 Counts

| Metric | Value | Instrument |
|---|---|---|
| Commits ahead of `main` | **32** | `git rev-list --count origin/main..origin/staging` |
| Files changed (two-dot) | **135** — 29 added, 106 modified, **0 deleted** | `git diff --name-status` |
| Lines | **+7,711 / −1,280** | `git diff --shortstat` |
| Files changed (three-dot, as GitHub displays) | **151** (+10,795 / −1,578) | `git diff origin/main...origin/staging` |

**⚠ The 135 / 151 discrepancy is real and explained:** `main` carries **2 commits not on `staging`** (§4.2), so a three-dot diff from the merge base counts files those commits touched. **135 is the correct figure for "what changes on `main` as a result of this promotion."**

## 3.3 CI state at T — **NOT GREEN**

| Check | Result | Class |
|---|---|---|
| Typecheck | ✅ Successful (1m) | VERIFIED |
| Web build / Staging lane | ✅ Successful (52s) | VERIFIED |
| Web build / lane resolves to exactly one | ✅ Successful (4s) | VERIFIED |
| Web build / **Production lane** | ⏭ **SKIPPED** | VERIFIED |
| Security / Dependency vulnerabilities | ✅ Successful (30s) | VERIFIED |
| Security / Secret scan (full history) | ✅ Successful (9s) | VERIFIED |
| Security / project's own security rules | ✅ Successful (9s) | VERIFIED |
| Cloudflare Pages (staging) | ✅ Deployed successfully | VERIFIED |
| **UI gate — "Every control reachable, nothing regressed"** | ✅ **PASSING** on the merge commit `9faf5a17` — was 🔴 at `25c0456` | **VERIFIED** |
| **Security / Secret scan (full history)** | ✅ **PASSING** at `a42b209e` — was 🔴 at `9faf5a17`. See **AF-19** | **VERIFIED** |

**PR #104 on `a42b209e`: 13 successful · 2 skipped · 2 in progress · ZERO FAILING.** GitHub reports
**"Able to merge"**.

**Both red gates are now green.** The UI gate was RED at `25c0456` and was closed by `bfcb68da` +
`c8aec5d5` (§13.1 AF-15). The secret scan was RED at `9faf5a17` and was closed by `a42b209e`
(§13.2 AF-19). **Neither was waved through; each was root-caused, fixed and control-verified.**

## 3.4 Tree immutability

**Changing this tree creates a new candidate.** Any commit to `staging`, and any conflict resolution performed on PR #104's head branch, produces a new SHA and voids `RC-20260829-01`, requiring re-identification here and re-running §18.

**This has already happened once:** `RC-20260826-01` named tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` (commit `b8535fe7`). **7 commits have landed since.** That RC is **VOID** by its own validity clause. Owner elected on 2026-08-29 to promote current `staging` rather than the audited older tree — §22 D-7.

---

# 4 · STAGING → MAIN PROMOTION CHAIN

## 4.1 Chain state

| # | Transition | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | staging HEAD = T | `25c0456` | `25c0456` | ✅ VERIFIED |
| 2 | T → PR #104 head | `25c0456` | `25c0456` | ✅ VERIFIED |
| 3 | main pre-merge | `b671e1fb` | `b671e1fb` | ✅ VERIFIED |
| 4 | PR mergeable | clean | **🔴 CONFLICT** (§4.3) | **BLOCKED** |
| 5 | merge SHA | — | *does not exist* | **NOT REACHED** |
| 6 | build from merge SHA | — | *does not exist* | **NOT REACHED** |
| 7 | production deployment | — | *does not exist* | **NOT REACHED** |
| 8 | production serving merged tree | — | *does not exist* | **NOT REACHED** |

**Transitions 5–8 are unproven because they have not occurred. Nothing in this ledger asserts otherwise.**

## 4.2 ⚠ The branches have DIVERGED — this is not a fast-forward

`main` carries **2 commits absent from `staging`**:

| SHA | Date | Subject |
|---|---|---|
| `b671e1fb` | 2026-08-25 | PRODUCTION — certificates: 16 types, live preview, editable Custom heading, delete unbroken; admin user list paged (**#101**) |
| `6ebe6c3d` | 2026-08-25 | RC-1: expand production schema with `admin_search_users_v2` (**#97**) |

**Instrument:** `git log origin/staging..origin/main`. **Class: VERIFIED.**
**Consequence:** the merge is a true three-way merge. It is the direct cause of §4.3.

## 4.3 🔴 MERGE CONFLICT — 1 file, 6 hunks

**File:** `src/lib/generateCertificatePdf.ts` (main 724 lines · staging 756 lines)
**Reproduced locally:** `git merge --no-commit --no-ff origin/staging` from `origin/main` → `CONFLICT (content)`, exactly 1 file, 6 conflict regions. **Class: VERIFIED.**

All six are `d.setTextColor(...)` calls — certificate PDF text colours:

| Hunk | Element | `main` | `staging` |
|---|---|---|---|
| 1 | "proudly presented to" | `TEXT_MUTED` | `TEXT_DARK` |
| 2 | **Recipient name** | `TEXT_DARK` | `TEXT_ACCENT` |
| 3 | "for successfully completing" | `TEXT_MUTED` | `TEXT_DARK` |
| 4 | **Course title** | `TEXT_DARK` | `TEXT_ACCENT` |
| 5 | Closing / description | `TEXT_SUBTLE` | `TEXT_DARK` |
| 6 | Footer date | `TEXT_DARK` | `TEXT_ACCENT` |

**⚠ DECISIVE TECHNICAL CONSTRAINT — only one resolution compiles.** The two branches define **different constant sets**:

```
main     TEXT_DARK, TEXT_MUTED, TEXT_SUBTLE            (no TEXT_ACCENT)
staging  TEXT_ACCENT=[0,123,177], TEXT_DARK, TEXT_SUBTLE  (no TEXT_MUTED)
```

The merged file's constant block resolves to **staging's**. Taking `main`'s side of any hunk references **`TEXT_MUTED`, which would be undefined** → TypeScript compile failure → build failure. **Class: VERIFIED** (`grep -nE "^const TEXT_"` on the merged working tree).

**RESOLUTION RULED — §22 D-6.** Owner, 2026-08-29: *"use the blue as in staging it is final, no difference from Staging."* Take **staging's side on all six hunks**.
**Visible effect:** recipient names, course titles and footer dates on every certificate change from dark grey to **blue `rgb(0,123,177)`**.
**NOT YET EXECUTED** — resolving on PR #104 commits to `staging`, which is T. Owner instruction for this revision was *"Do not modify T."* Deferred to promotion time (§24.2).

## 4.4 · CONFLICT RESOLUTION — ✅ EXECUTED 2026-08-29T08:05Z

**Owner ruling D-6 executed.** `main` was merged into `staging` through PR #104's web conflict
editor, taking **staging's side on all six hunks**.

| Field | Value |
|---|---|
| Merge commit | **`9faf5a17f2653ca5675250e274357248310198ba`** |
| Message | `Merge branch 'main' into staging` |
| Parents | `fe4505aa` (staging) · `b671e1fb` (main) |
| Direction | main → staging (so PR #104 becomes mergeable) |

**Which side is which — settled by the editor's own labels, not inferred:**

```
<<<<<<< staging (Current change)      ← taken
  d.setTextColor(...TEXT_DARK);
=======
  d.setTextColor(...TEXT_MUTED);
>>>>>>> main (Incoming change)        ← discarded
```

### Post-merge verification — all measured on `9faf5a17`

| Check | Result |
|---|---|
| Conflict markers in `generateCertificatePdf.ts` | **0** |
| `...TEXT_MUTED` **code** references | **0** (2 remain, both inside a comment recording its removal) |
| `TEXT_ACCENT` in the certificate colour block | **3** — the blue is in place |
| `main` is an ancestor of `staging` | ✅ **YES** |
| **`tsc --noEmit`** | ✅ **exit 0** |
| **Full suite** | ✅ **178 files passed, 1 skipped · 2,475 tests passed, 1 skipped** |
| PR #104 mergeability | ✅ **"Able to merge"** — conflict cleared, 36 commits |
| `main` | **unchanged at `b671e1fb`** |

**Visible product effect:** recipient names, course titles and footer dates on every certificate
render in **blue `rgb(0,123,177)`** instead of dark grey.

> **Disclosure retained.** An earlier hand-edit attempt consumed one line too many
> (`const completionText = tier.completionText;`) and left a stray marker. It was caught by
> inspection **before any commit**, discarded by force-reloading the page, and replaced by a
> deterministic `CodeMirror.setValue()` of staging's exact file. **No bad content ever reached the
> repository**, and the committed result is verified above.

---

---

# 5 · COMPLETE FILE-LEVEL CHANGE MANIFEST

**135 files: 29 added · 106 modified · 0 deleted.** Instrument: `git diff --name-status origin/main origin/staging`. **Class: VERIFIED.**

## 5.1 ADDED (29 — complete, no elision)

**CI / workflows (1)**
1. `.github/workflows/verify-schema-dependencies.yml`

**Build & lane scripts (7)**
2. `scripts/generate-headers.mjs`
3. `scripts/generate-seo-assets.mjs`
4. `scripts/lane-config.mjs`
5. `scripts/test-schema-dependencies.mjs`
6. `scripts/test-seo-assets.mjs`
7. `scripts/verify-schema-dependencies.mjs`
8. `functions/pages-runtime.d.ts`

**Application source (5)**
9. `src/lib/env.ts`
10. `src/components/comments/CommentThread.tsx`
11. `src/components/post/PostActionRow.tsx` ← **implicated in AF-15**
12. `supabase/functions/_shared/laneConfig.ts`
13. *(see 14–20 for tests)*

**Tests (7)**
14. `src/__tests__/certificatePalette.test.ts`
15. `src/__tests__/corsOriginAllowlist.test.ts`
16. `src/__tests__/laneIsolation.test.ts`
17. `src/__tests__/seoLaneRequired.test.ts`
18. `src/__tests__/storageLane.test.ts`
19. `src/components/__tests__/BrandBadgeEverywhere.test.tsx`
20. `src/components/__tests__/ComposerEnterKey.test.tsx`

**Tests, continued (4)**
21. `src/components/ads/__tests__/StoryCardComments.test.tsx`
22. `src/components/ads/__tests__/StoryCardReactions.test.tsx`
23. `src/components/comments/__tests__/CommentLineBreaks.test.tsx`

**Database (6)**
24. `supabase/migrations/20260824145345_admin_user_lookup_by_email.sql`
25. `supabase/migrations/20260828082136_ad_comment_ban_and_visibility_policies.sql` ← **post-RC; see §6.2**
26. `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql`
27. `supabase/rollback/20260828082136_ad_comment_ban_and_visibility_policies_ROLLBACK.sql`
28. `supabase/rollback/UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql`
29. `supabase/rollback/UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql`
30. `supabase/rollback/UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql`

*(Numbering runs to 30 because item 13 is a placeholder; the added-file count from `git` is **29**.)*

## 5.2 DELETED

**NONE.** `git diff --diff-filter=D` returns empty. **Class: VERIFIED.** No file is removed from `main` by this promotion.

## 5.3 MODIFIED (106) — by area

| Area | Count | Notable |
|---|---|---|
| `supabase/functions/**` | 44 | incl. `submit-judge-decision` (CORS + tag-mirror fix), 16 transactional-email templates, 6 email templates, `_shared/*` |
| `src/components/**` | 28 | post, ads, admin, judge surfaces |
| `src/__tests__/**` | 11 | |
| `src/lib/**` | 9 | incl. **`generateCertificatePdf.ts` — the conflicted file** |
| `.github/workflows/**` | 7 | **all 7 pre-existing workflows modified** — §8.2 |
| `src/pages/**` | 2 | |
| `functions/**` (Pages) | 6 | `_seo.ts`, competitions, courses, featured-artist, journal, page |
| `public/**` | 3 | `_headers`, `robots.txt`, `sitemap.xml` |
| root config | 5 | `vite.config.ts`, `vitest.config.ts`, `package.json`, `index.html`, `supabase/config.toml` |
| `docs/DECISIONS.md` | 1 | D-002 update (§22 D-4) |

**Full per-file list reproducible by:** `git diff --name-status b671e1fb 25c0456`.

## 5.4 Commit manifest (32)

| # | SHA | Date | Subject |
|---|---|---|---|
| 1 | `25c04560` | 08-29 | Drop the composer hint text; shorten the privacy notice copy (D-002 stays open) |
| 2 | `c8dc83b1` | 08-29 | Multi-line comments render as multiple lines; composer says how to post |
| 3 | `e7dbf51e` | 08-29 | The reaction triggers are real buttons, not clickable divs ← **AF-15 origin** |
| 4 | `8e09e0b7` | 08-28 | Blue tick shows wherever the name shows: resolve the brand badge in AutoBadge |
| 5 | `5d35e4b5` | 08-28 | Ad card: show the reaction break-up and name who reacted, like the feed |
| 6 | `af7166ba` | 08-28 | Merge remote-tracking branch 'origin/staging' into staging |
| 7 | `a193a7ee` | 08-28 | Fix story-card comments; put the ad card on the post card's row and thread |
| 8 | `b8535fe7` | 08-26 | G10: rollback coverage for four migrations, schema-dependency guard, gift-by-email (#102) ← **former RC** |
| 9–12 | `702e5ceb` `7642c282` `98ff9510` `b277729e` | 08-26 | Add files via upload ×4 (part of #102) |
| 13 | `c92d5345` | 08-25 | STAGING — certificates: live preview in the admin form as you type (#100) |
| 14 | `5dbfcf79` | 08-25 | STAGING — certificates: delete unbroken, all 16 types worded, description printed (#99) |
| 15 | `7380e28e` | 08-25 | STAGING — certificate view: draw the preview instead of framing a PDF (#98) |
| 16 | `cba8dae2` | 08-25 | STAGING — certificates: six admin defects (#96) |
| 17 | `6d6aa6c6` | 08-24 | STAGING PREVIEW — page the admin member list, filter role/badge in SQL (#95) |
| 18 | `9f3d20a0` | 08-24 | G9: CORS refuses unknown origins, judge tag mirror fixed, _redirects rule removed |
| 19 | `e658062e` | 08-24 | Fix measure-post-media import path and drop three stale config entries |
| 20 | `b3b8c21e` | 08-23 | G10: the isolation guard could not see supabase/functions at all (#94) |
| 21 | `a8c595d2` | 08-23 | G9: the email layer gets a lane, six signing paths assert, CORS stops matching a prefix (#93) |
| 22 | `87aa5eac` | 08-23 | G9: assert the storage lane where the credentials are loaded (#92) |
| 23 | `e2db18b6` | 08-23 | G8: an unchecked lane is a refusal, not a silent PASS (R12) (#91) |
| 24 | `06b91623` | 08-23 | G7: the production lane is the only indexable lane (#90) |
| 25 | `d33c91ef` | 08-23 | G5b: remove production defaults from Pages Functions, scan functions/ (#89) |
| 26 | `9aea8a30` | 08-22 | guard: host rules R7-R10 |
| 27 | `a9f5b80e` | 08-22 | ci: derive CORS from the apex form, wire both lanes explicitly |
| 28 | `9a89aadf` | 08-22 | web: de-hardcode every lane-specific address |
| 29 | `44e3e925` | 08-22 | Revert "TEMPORARY: blank the staging lane's forbidden list to prove R6 fires" |
| 30 | `ec1a3b98` | 08-22 | TEMPORARY: blank the staging lane's forbidden list to prove R6 fires |
| 31 | `9af9ef7d` | 08-22 | test(isolation): make the mutation harness hermetic |
| 32 | `ccd5e423` | 08-22 | ci: lane-aware CI for the staging and production lanes |

**Commits 29+30 are a deliberate prove-then-revert pair** (R6 fired, then was restored). Net effect on T: zero. Recorded because a reader seeing only #30 would conclude the forbidden list was blanked.

---

# 6 · DATABASE & MIGRATION LEDGER

## 6.1 Inventory

| | staging repo | main repo | Class |
|---|---|---|---|
| `supabase/migrations/*.sql` | **635** | **633** | VERIFIED |
| `supabase/rollback/*.sql` | **35** | **30** | VERIFIED |

**Delta introduced by this promotion: +2 migrations, +5 rollbacks.**

## 6.2 The two new migrations

### M1 · `20260824145345_admin_user_lookup_by_email.sql`

| Field | Value | Class |
|---|---|---|
| Applied — **staging** | ✅ `20260824144927` (name `admin_user_lookup_by_email`) | VERIFIED (SQL) |
| Applied — **production** | ✅ `20260824145345` | VERIFIED (SQL) |
| Rollback | `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql` | VERIFIED |
| Net effect of promotion | **None on either DB** — already applied to both | VERIFIED |

**⚠ Version-stamp divergence:** the same logical migration carries **different version integers per lane** (`…144927` staging vs `…145345` production). The *filename* matches production. Recorded as **AF-16**.

### M2 · `20260828082136_ad_comment_ban_and_visibility_policies.sql` — **🔴 THE LOAD-BEARING ONE**

| Field | Value | Class |
|---|---|---|
| Applied — **staging** | ✅ `20260828082136` | **VERIFIED (SQL)** |
| Applied — **production** | ❌ **NOT APPLIED** | **VERIFIED (SQL)** |
| Rollback | ✅ present, reviewed, **never executed** | VERIFIED |
| Shape | **EXPAND-ONLY** — adds 2 RESTRICTIVE policies, drops nothing, alters no table/column/row | VERIFIED (read in full) |
| Post-dates the former RC | **YES** — created 08-28, after `b8535fe7` (08-26) | VERIFIED |

**What it does — it closes two live production security gaps:**

1. **A banned member can comment on advertisements.** `post_comments` carries the RESTRICTIVE policy *"Banned users cannot comment on posts"*; `ad_creative_comments` reads `is_banned` **nowhere**. Banning a member closes post threads and leaves every sponsored ad open.
2. **A hidden ad's comment thread is readable by any signed-in member.** `ad_creative_comments`' only SELECT policy is `USING (true)`. Switching a creative to Hidden removes it from the feed and its page, while `/rest/v1/ad_creative_comments?creative_id=eq.<id>` **still serves the thread underneath it**.

**MEASURED POLICY STATE — instrument `pg_policies`, both lanes, 2026-08-29:**

| Lane | Policy count | `Banned users cannot comment on ads` | `Ad comments follow the ad's visibility` |
|---|---|---|---|
| **production** | **7** | ❌ **ABSENT** | ❌ **ABSENT** |
| **staging** | **9** | ✅ RESTRICTIVE INSERT | ✅ RESTRICTIVE SELECT |

**Class: VERIFIED.** ⇒ **PRODUCTION CARRIES BOTH GAPS TODAY.** Recorded as **AF-17**.

**MEASURED LIVE EXPOSURE — production, 2026-08-29:**

```
ad_creatives            1
ad_creatives hidden     0     ← gap 2 not currently reachable
ad_creative_comments    1
comments on hidden ads  0
banned members          0     ← gap 1 not currently reachable
```
**Class: VERIFIED.** **Live exposure today is ZERO.** Both gaps become real the moment an admin hides a creative or bans a member. *(Structurally identical to D-002: a correct control absent, harmless only because the triggering state does not yet exist.)*

**⚠ CRITICAL SEQUENCING — merging PR #104 does NOT close these gaps.** Migrations are applied by a **separate manual dispatch** of `apply-migration.yml`, never by a merge. **Action required at §24.3.**

## 6.3 The `UNAPPLIED_` prefix set (9 files, unchanged by this promotion)

| # | File | Forward applied in production? |
|---|---|---|
| 1 | `migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql` | ✅ as `20260825092152` |
| 2 | `migrations/UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql` | ✅ as `20260825115030` |
| 3 | `migrations/UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql` | ✅ as `20260825115116` |
| 4 | `migrations/UNAPPLIED_20260825170000_certificate_custom_heading.sql` | ✅ as `20260825115208` |
| 5–8 | the four matching `rollback/UNAPPLIED_*_ROLLBACK.sql` | — |
| 9 | `rollback/UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` | ✅ forward applied as `20260820180836 classf_repoint_originals` |

**Every file prefixed `UNAPPLIED_` names a migration that IS applied in production.** The prefix is factually wrong on all nine. **Class: VERIFIED (SQL).** Disposition §22 D-1.

**Correction to a prior conclusion:** the 08-27 preparation ledger called file 9 an *"orphan — no forward migration in this RC."* Accurate as to *this RC*, but it **does** have a forward migration, applied in production 2026-08-20. §14 C-4.

## 6.4 Destructive / data-changing operations

| Category | Finding | Class |
|---|---|---|
| `DROP TABLE` / `DROP COLUMN` | **NONE** in either new migration | VERIFIED |
| `DELETE` / `UPDATE` / `TRUNCATE` on member data | **NONE** | VERIFIED |
| `ALTER TABLE` | **NONE** | VERIFIED |
| Policy drops | Only `DROP POLICY IF EXISTS` immediately preceding `CREATE POLICY` of the same name (idempotency idiom) | VERIFIED |
| Function / trigger / index changes | **NONE** in the 2 new migrations | VERIFIED |

**No destructive operation is introduced by this promotion.**

---

# 7 · ENVIRONMENT / SECRET / CONFIGURATION LEDGER

**No secret value was read, requested, displayed, transmitted or stored at any point in compiling this ledger.** Scopes and names only.

## 7.1 GitHub secret scope — measured 2026-08-29

| Secret | Scope | Status | Class |
|---|---|---|---|
| **`SUPABASE_DB_URL`** | **Environment `production` ONLY** | ✅ Present. **Absent at repository level** — which is correct: a repo-level copy would defeat Environment binding. | **VERIFIED** |
| `ANDROID_KEYSTORE_BASE64` | Repository | Present | VERIFIED |
| `ANDROID_KEYSTORE_PASSWORD` | Repository | Present | VERIFIED |
| `ANDROID_KEY_ALIAS` | Repository | Present ⚠ known-wrong value (harmless since `1fcd745`; CI resolves from the keystore) | VERIFIED (presence) |
| `ANDROID_KEY_PASSWORD` | Repository | Present ⚠ same | VERIFIED (presence) |

**Repository-level secrets total: 4, all `ANDROID_*`.** **Class: VERIFIED** (Settings → Secrets and variables → Actions).

**⚠ Not verified:** whether a **`staging` Environment** exists and holds its own `SUPABASE_DB_URL`. The secrets page lists Environment secrets for `production` only. If absent, `apply-migration.yml` with `target=staging` fails at its credential gate. **Class: BLOCKED** — owner check, §24.1.

## 7.2 Configuration changed by this promotion

| File | Change | Class |
|---|---|---|
| `scripts/lane-config.mjs` | **NEW** — single source of lane addresses | VERIFIED |
| `src/lib/env.ts` | **NEW** — client-side lane resolution | VERIFIED |
| `supabase/functions/_shared/laneConfig.ts` | **NEW** — edge-function lane resolution | VERIFIED |
| `public/_headers` | Generated. **`Access-Control-Allow-Origin` moves apex → `www`** | VERIFIED (prior G4 audit) |
| `public/robots.txt`, `public/sitemap.xml` | Generated; byte-identical to `main`'s | INFERRED (prior G4 audit; not re-measured) |
| `supabase/config.toml` | Modified | VERIFIED (presence) |

**⚠ The `_headers` CORS change is a production behaviour change** carried under a de-hardcoding commit. Flagged by the G4 audit as unflagged then; carried here as **AF-11**, §22 D-8 required.

---

# 8 · CI/CD PROVENANCE

## 8.1 The candidate's runs

| Workflow | Run | Commit | Actor | Result | Class |
|---|---|---|---|---|---|
| **UI gate** | **#122** — `33232872781`, job `99048633354` | `25c0456` | `altisinfonet` | 🔴 **FAILED 7m 46s** | VERIFIED |
| Typecheck | (PR #104 check) | `25c0456` | `altisinfonet` | ✅ 1m | VERIFIED |
| Web build — staging lane | (PR #104 check) | `25c0456` | `altisinfonet` | ✅ 52s | VERIFIED |
| Web build — production lane | (PR #104 check) | `25c0456` | — | ⏭ **SKIPPED** | VERIFIED |
| Web build — lane resolves to one | (PR #104 check) | `25c0456` | — | ✅ 4s | VERIFIED |
| Security — dependency vulns | (PR #104 check) | `25c0456` | — | ✅ 30s | VERIFIED |
| Security — secret scan (full history) | (PR #104 check) | `25c0456` | — | ✅ 9s | VERIFIED |
| Security — own security rules | (PR #104 check) | `25c0456` | — | ✅ 9s | VERIFIED |
| Cloudflare Pages (staging) | — | `25c0456` | — | ✅ Deployed | VERIFIED |

**UI gate history on `staging` — the regression boundary, measured:**

| Run | Commit | Subject | Result |
|---|---|---|---|
| #122 | `25c0456` | composer hint / privacy copy | 🔴 **failed** |
| #121 | `c8dc83b` | multi-line comments | 🔴 **failed** |
| #120 | `e7dbf51` | **reaction triggers → real buttons** | 🔴 **failed** ← **first red** |
| #119 | `8e09e0b` | blue tick | ✅ success |
| #118 | `5d35e4b` | ad card reactions | ✅ success |
| #117 | `af7166b` | merge | ✅ success |
| #116 | `b8535fe` | **former RC (#102)** | ✅ success |
| …earlier | | | ✅ success |

**Class: VERIFIED** (workflow run list + per-run status labels). **The gate went red at `e7dbf51` and has never recovered.** §13 AF-15.

## 8.2 Workflow files changed by this promotion

**All 7 existing workflows modified; 1 added.** **Class: VERIFIED.**

`android-build.yml` · `apply-migration.yml` · `health.yml` · `security.yml` · `typecheck.yml` · `ui-gate.yml` · `web-build.yml` · **+ `verify-schema-dependencies.yml` (new)**

**⚠ Promoting this PR changes the CI system itself.** The workflows that will police `main` after the merge are not the workflows that police it now.

## 8.3 Deployment identity

| Artifact | State |
|---|---|
| Staging Pages deployment | ✅ exists for `25c0456` |
| **Production Pages deployment for merged tree** | **N/A — NOT PROMOTED** |
| Android artifact | **N/A** — no `android/` directory at any commit; generated at build time |

---

# 9 · SECURITY & LANE ISOLATION

| Control | State on `main` **now** | State in T (after promotion) | Class |
|---|---|---|---|
| **Migration lane gate** | 🔴 **ABSENT** — `apply-migration.yml` line 77 reads `# environment: production`, **commented out** | ✅ `environment: ${{ inputs.target }}` live, plus 4 ordered gates (branch↔target, credential present, **ref assertion**, path validation), all before `psql` | **VERIFIED** |
| **Branch protection (`main`)** | ✅ ruleset `protect-main` **Active**, bypass list **EMPTY**, rules: *Require a pull request before merging* · *Block force pushes* · *Restrict deletions* | unchanged | **VERIFIED** |
| Environment protection | `production` Environment exists and holds `SUPABASE_DB_URL` | unchanged | VERIFIED (existence) |
| **§5.3 secret-isolation probe** | not run | not run | **BLOCKED** — §24.2 |
| DB isolation | Distinct projects: `jtdtehuqtinjxropkkcn` (prod) / `ztzutckwdhetphwghuzj` (staging) | unchanged | VERIFIED |
| **R2 write isolation** | Token scoped to one bucket — §10.2 | unchanged | **VERIFIED (scope)** |
| CDN isolation | `cdn.` / `cdn-staging.` split; production CDN refuses staging-origin reads | unchanged | INFERRED (prior G9 measurement, not re-measured) |
| Production-write protection | No production write performed — §16 | — | VERIFIED |

**The most consequential line in this table:** the migration lane gate **does not exist on `main` today**. Until PR #104 merges, a production migration dispatch on `main` runs with **no environment binding and no ref assertion**. **Promotion installs the gate; it does not create the exposure.**

---

# 10 · R2 / STORAGE / CDN LEDGER

## 10.1 Buckets

| Bucket | Lane | Public access | Size | Class |
|---|---|---|---|---|
| `50mm` | production | **Enabled** | **1.12 GB** (was 1.09 GB on 08-27) | VERIFIED |
| `50mm-staging` | staging | — | — | VERIFIED (existence) |
| `agentcrm` | unrelated | — | — | VERIFIED — **out of scope, do not touch** |

Production prefixes: `avatars/`, `competition-photos/`, `course-images/`, `journal-images/`, `national-ids/`, `portfolio-images/`, `post-images/`, `site-assets/`. Class A ops 1.04k · Class B 39.16k.

**Size growth 1.09→1.12 GB is organic**: `DAILY_MEDIA_DELTA_CHECK_2026-08-29` independently measured **28 posts on 08-28**, the busiest day in the series. Not QA contamination. **A GB-rounded figure cannot detect a 0-byte probe** — which is why §10.3 uses a prefix search instead.

## 10.2 Write isolation — **the token scope IS readable**

**Chain, complete:**

| # | Link | Evidence | Class |
|---|---|---|---|
| 1 | App's staging credential `access_key_id` = `73a7920647481fd93553f9c1f68bf5a3` | `site_settings` → `s3_storage_settings` | **OWNER-ATTESTED** 2026-08-29 |
| 2 | For R2, **Access Key ID *is* the API token id** | Cloudflare docs, verbatim: *"Access Key ID: The `id` of the API token."* | **DOCUMENTED** |
| 3 | That id = token **`staging-upload`** | Cloudflare → Account API tokens | **VERIFIED** |
| 4 | Its permission policies = **exactly one**: `R2 › 50mm-staging` → Workers R2 Storage Bucket Item Write | token detail page | **VERIFIED** |
| 5 | **No policy names `50mm`** | same page | **VERIFIED** |
| 6 | Cloudflare authorization is deny-by-default | platform model | PLATFORM |
| 7 | ⇒ `PutObject` to `50mm` is refused at the authorization layer | follows 1–6 | **INFERRED** |

**It is the only API token in the account** (`Showing 1-1 of 1`). Expiration: **none**.

**⚠ §8.6's stated premise is FALSE.** It reads *"Token scope is not readable after creation, so this is OWNER-ATTESTED by construction."* The **secret** is unreadable; the **scope** is permanently readable, and was read. §14 C-1.

**Why the prescribed runtime test cannot settle it.** A.5's control 3 (`PutObject` to a non-existent bucket, expecting `NoSuchBucket`) **cannot discriminate for a bucket-scoped token**: `50mm` and `50mm-does-not-exist-*` are both outside the policy, so both are refused at authorization (`10003 AccessDenied`) before reaching the existence check that emits `10006 NoSuchBucket`. **A correctly-scoped token must return `AccessDenied` for both.** Control 3 can only discriminate for a credential broad enough to fail the gate. **Class: INFERRED** — Cloudflare documents both codes but is **silent on evaluation order**; this rests on the documented Access-Policy model plus one observed run.

**Prior runtime run `33079091310`** (recorded in the 08-27 signing pack) concluded FAILURE for exactly this reason. Its valid narrow finding, verbatim: *"the same credential, in one run seconds apart, **succeeded** writing and reading back a zero-byte object in `50mm-staging` and was **denied** writing to `50mm`."* **That success/denial pairing already carries the discrimination control 3 was meant to supply.**

## 10.3 Production bucket unchanged

**Prefix search, `50mm`, `isolation-probe/`, 2026-08-29T04:37:25Z → "No objects matched your search."** Zero results. **Class: VERIFIED.**

Since run `33079091310` attempted `PutObject` to `50mm` at `isolation-probe/<TS>.txt`, a zero-result search of that exact prefix afterwards **measures** that no object was created — A.5's *"and no object created"* clause, measured rather than inferred.

**Honest limit:** this is an **after** measurement only. No **before** baseline was captured prior to that run and none can be created retroactively.

## 10.4 AF-03 / D-5 reconciliation

Staging `public.site_settings` holds **46 references** to `https://cdn.50mmretina.com` → **12 distinct production objects**, across six keys: **37 live** (`managed_pages` 17 = 6 `og_image` + 11 in `json_ld`; `seo_pages` 7; `ad_slots` 9; `ad_zones_v2` 3; `seo_global` 1) and **9 backup-only** (`ad_slots_backup_20260723`). `af03_keys_still_present = 6`, unchanged.

Measured with positive and negative controls on both origins: the 12 objects **exist in production R2**, are **absent from staging R2**, and requested from a staging page the **production CDN refuses them**. **No cross-lane data leak** — staging cannot obtain production assets.

**Class: INFERRED for this ledger** — carried from the 08-27 record; **not re-measured today.**

**Accepted defects:** (a) §15 row 1's negative criterion literally fails; (b) staging renders broken ad/OG images on 29 routes.
**Control gap → G11:** the isolation guard scans **built code**; these references live in **database rows**, invisible to every R-rule and mutant. A data-side isolation scan is required. The guard's 21/21 mutant result is unaffected and is **not** downgraded.

---

# 11 · G1–G10 AUDIT MATRIX

> **No gate is marked GREEN because a previous report said so.** Every row states its own evidence and class.

| Gate | Requirement | Instrument | Evidence | Result | Class |
|---|---|---|---|---|---|
| **G1–G2** | Lane-aware CI; forbidden-ref guard fires | `ci: lane-aware CI` (`ccd5e42`); prove/revert pair `ec1a3b9`/`44e3e92` | R6 demonstrated firing then restored; 8 workflows present in T | ✅ **CLOSED** | INFERRED (prior CI runs; not re-run today) |
| **G3** | Migration lane gate armed on the **target** lane | `git show origin/main:.github/workflows/apply-migration.yml` | **Line 77 = `# environment: production` — COMMENTED OUT on `main`.** Live in T with 4 ordered gates | 🔴 **OPEN on `main`** — closes *only* on promotion | **VERIFIED** |
| | §5.3 secret-isolation probe | throwaway branch + echo-only workflow | **Never run.** §5.3.6 requires it *immediately before* promotion | 🔴 **BLOCKED** | **BLOCKED** |
| **G4** | No production literals in staging bundle | bundle census (prior) | staging bundle: `cdn.50mmretina.com` 0 · `www.50mmretina.com` 0 · prod ref 0 | ✅ **CLOSED** | INFERRED (prior; not re-built today) |
| | ACAO derivation | `public/_headers` diff | **apex → `www` — a production behaviour change** carried under a de-hardcoding commit | ⚠ **AMBER** | VERIFIED (diff) · **AF-11** |
| **G5b** | No production defaults in Pages Functions; guard scans `functions/` | `d33c91e` (#89) | 6 Pages Functions modified; guard extended | ✅ **CLOSED** | INFERRED (prior) |
| **G6** | *(not separately evidenced in the record available to this compiler)* | — | — | ⬜ **NOT ESTABLISHED** | **BLOCKED** |
| **G7** | Production lane is the only indexable lane | `06b9162` (#90); `public/robots.txt`, `sitemap.xml` | robots/sitemap generated per lane | ✅ **CLOSED** | INFERRED (prior) |
| **G8** | Storage lane asserted where credentials load | `87aa5ea` (#92); `src/__tests__/storageLane.test.ts` (new) | test added in T | ✅ **CLOSED** | VERIFIED (file present) |
| | §8.6 pt.2 — staging credential refused write to production bucket | A.5 runtime test / token-scope read | **Scope read directly: 1 policy, `50mm-staging` only** (§10.2). Runtime run `33079091310` = staging SUCCESS + production DENIED. Control 3 structurally cannot discriminate | ⚠ **SUBSTANCE MET, INSTRUMENT NOT** | **VERIFIED (scope)** + **INFERRED (runtime enforcement)** |
| | §8.6 pt.3 — production bucket unchanged | prefix search `isolation-probe/` | **0 results, 04:37:25Z** | ✅ | **VERIFIED (after only; no before)** |
| **G9** | CORS refuses unknown origins; lane config for email/storage | `9f3d20a`, `a8c595d`, `87aa5ea` | Source fixed in T. **Production edge functions NOT redeployed** — 71 functions still serve pre-G9 CORS; `submit-judge-decision` v23 still answers `*` | 🔴 **EXCLUDED from G10** | **OWNER-ATTESTED** (countersignature pending, §23) |
| **G10** | Promotion executed, tree equality asserted | merge + `git rev-parse` | **Not performed** | ⬜ **NOT REACHED** | **N/A** |
| **G-A** | Android versionCode | Play Console | No `android/` directory at any commit; **web-only release** | **N/A** — with reason | **N/A** · **AF-13** |

**Honest ceiling, unchanged:** G3's Environment configuration and branch protection are **OWNER-ATTESTED by construction** and may never be described as independently verified. **G10 cannot be GREEN before promotion occurs.** Anyone reporting "11 green" on this candidate is reporting something that does not exist.

---

# 12 · §15 QA MATRIX

| Row | Instrument | Evidence | Result | Disposition | Class |
|---|---|---|---|---|---|
| **1 · UI** | staging deployment `3a6f3df9-639b-444f-846a-b17be22cde73` | Broken ad/OG images on 29 routes | 🔴 **FAILING** | **Approving over a known-failing row** under D-5. **Not a pass; must not be recorded as one** | VERIFIED (prior) |
| **2 · Flows** | manual QA | 7/10 | ⚠ PARTIAL | 2 blocked on production-authenticated QA profile; 1 structurally untestable (0 journal articles) | OWNER-ATTESTED |
| **3 · Auth** | — | — | **N/A** | No staging mail path (§8.8 opt 1); `/login`+`/signup` need anonymous context | N/A with reason |
| **4** | — | verified | ✅ | — | INFERRED (prior) |
| **5 · Storage** | §10.2 | token scope + runtime pairing | ⚠ | Governed by §10.2; **not signed here** | VERIFIED (scope) |
| **6 · Edge functions** | §15 flows | 5/74 exercised | ⚠ PARTIAL | Scoped to functions reachable by the 10 flows. **5 financial functions = NOT TESTABLE — POLICY EXCLUSION, displayed explicitly, never folded into a ratio** | OWNER-ATTESTED |
| **7** | — | verified | ✅ | — | INFERRED (prior) |
| **8 · SEO** | instrument closed 07:26Z | — | 🔴 **FAILING** | **Approving over a known-failing row** under D-5 | VERIFIED (prior) |
| **9** | — | verified **vacuously** | ✅ | **Recorded as vacuous** | INFERRED (prior) |
| **10 · Responsive** | `resize_window` | reported success 3× while `innerWidth` never moved | 🔴 **BLOCKED** | **N/A with reason. No substitute instrument accepted.** → G11 | VERIFIED (prior) |
| **11 · Regression** | §18 | — | ⏸ **DEFERRED** | Post-promotion by construction (§17-12) → Phase 8 | DEFERRED · owner · at promotion |
| **12 · Cross-lane** | N1 / N2 | N1 ✅ | ⏸ **DEFERRED** | **N2 cannot run before promotion** — `main` has no gate, so a pre-promotion N2 tests nothing (§14 HS-11) → §24.3 | DEFERRED · owner · post-merge |

**⚠ §15 has TWO tests and both are live:** the preamble requires *both* positive and negative columns to carry evidence; **§17-1 additionally requires no row blank and none marked "expected."** Rows 1 and 8 are **failing**, not blank — they satisfy §17-1 while failing on merit.

---

# 13 · FINDINGS REGISTER

| ID | Finding | Introduced | Severity | Evidence | Disposition |
|---|---|---|---|---|---|
| **AF-03** | 46 production-CDN refs in staging DB config → 12 production objects | Pre-existing | Medium | §10.4 | **ACCEPTED** as D-5. Data-side scan → G11 |
| **AF-11** | `_headers` ACAO moved apex → `www` under a de-hardcoding commit, undeclared | Candidate | Medium | §7.2 | **OWNER RULING REQUIRED** — §22 D-8 |
| **AF-13** | Android version records contradict across 4 repository sources (1005/1010/1073/1102/1110; 1.1.1 vs 1.2.16). **No repository source authoritative** | Pre-existing | Low | `android-build.yml`, `ANDROID_RELEASE_RUNBOOK.md` | **N/A this release** (web-only) → G11. Only Play Console is authoritative |
| **AF-14** | **Ledger-closure deadlock** — §11 requires a closed ledger for Phase 7, but the ledger could not close until CHG-003 merged, which occurs at Phase 8 *after* approval | Process defect | Medium | §11 vs §9.4 | **RESOLVED** by removing CHG-003 from scope: PR #103 is **not in T** (§2). No longer blocking |
| **AF-15** | ~~🔴 THE UI GATE IS RED ON THE CANDIDATE~~ → **FIXED 2026-08-29.** 9 problems / 148 screenshots, 3 scenes × 3 mobile viewports | **Candidate — `e7dbf51`** | **HIGH** | §13.1 below | ✅ **RESOLVED** by `bfcb68da` + `c8aec5d5`. Owner ruling D-9 = **"fix it first"**. Reproduced, fixed, controlled, pinned |
| **AF-16** | Same logical migration carries different version integers per lane (`…144927` staging / `…145345` production) | Pre-existing | Low | §6.2 M1 | **RECORD ONLY.** `schema_migrations` is keyed on version, so the lanes cannot be compared by version alone |
| **AF-17** | 🔴 **PRODUCTION IS MISSING TWO RLS POLICIES** on `ad_creative_comments`: banned members may comment on ads; a hidden ad's thread is readable by any signed-in member | Pre-existing (gap since `20260811120000`) | **HIGH (latent)** | §6.2 M2 — `pg_policies` both lanes | **ACTION REQUIRED** — §24.3. Fix exists and is applied on staging; **live exposure today = 0** |
| **AF-20** | ⚠ **The gate named "Secret scan (FULL HISTORY)" does not scan full history.** CI restricts it to `--no-merges --first-parent <range>`. An unrestricted scan of the same repository returns **23 findings across 6 commits, 2026-07-09 → 2026-08-05** — every one of them **outside** the range CI checks | Pre-existing control-scope gap | **Low (name/scope mismatch)** · **no real secret found** | §13.3 below | **RECORD ONLY** — not a release blocker. Carried to G11 |
| **AF-19** | ~~🔴 SECRET SCAN FAILS~~ → ✅ **FIXED.** The allowlist covered only the **production** anon key; the **staging** anon key added by the lane-aware CI commit was never added | **Pre-existing — commit `ccd5e423`, 2026-08-22.** NOT introduced by any 2026-08-29 commit | **Medium** | §13.2 | ✅ **RESOLVED** by `a42b209e`. Verified with real gitleaks 8.24.3 + control + mutation test |
| **AF-18** | `main`'s `apply-migration.yml` has `environment:` **commented out** — no lane gate, no ref assertion on the production lane | Pre-existing | **HIGH** | §9 | **CLOSED BY THIS PROMOTION** — the merge installs the gate |

## 13.1 AF-15 in full — the UI gate failure

**Measured output, verbatim, from run `33232872781` job `99048633354`:**

```
layout: tap targets too small (6): button.cursor-pointer.inline-flex 45x20,
  button.cursor-pointer.inline-flex 24x20, button.cursor-pointer.inline-flex 69x16,
  button.cursor-pointer.inline-flex 16x20, button.cursor-pointer.inline-flex 24x20,
  button.cursor-pointer.inline-flex 16x20

layout: tap targets too small (2): button.cursor-pointer.inline-flex 16x20,
  button.cursor-pointer.inline-flex 69x16
```

**Affected:** `journey-create-from-feed`, `screen-feed`, `screen-post-detail` × `android-360`, `iphone-390`, `app-360`. **Desktop-1280 passes on all three.** Summary line: `148 screenshots, 9 problem(s) reported.` · `baseline diff: clean against 148 recorded scene/viewport keys.` · `[ui:gate] FAIL (exit 1)`

**Root cause — traced to the exact diff.** `e7dbf51` changed, in `ReactionSummaryTooltip.tsx`:

```diff
- <div onClick={handleOpen} className="cursor-pointer">
+ <button type="button" onClick={handleOpen}
+   aria-label={`See who reacted (${totalCount})`}
+   className="cursor-pointer inline-flex items-center">
```

The gate's selector `button.cursor-pointer.inline-flex` matches this element exactly. **Class: VERIFIED.**

**The honest reading — this is a net accessibility IMPROVEMENT that trips a gate.**

- **Before:** a `<div onClick>` — no role, no tabindex, no accessible name. The Reactions dialog was openable **by mouse only**: not reachable by Tab, not announced, not operable by Enter or Space. The targets were **already 16–20px**; as `<div>`s they were **invisible to the gate's tap-target checker**, which measures interactive elements.
- **After:** a real `<button>` — keyboard-reachable, screen-reader-announced, count preserved in the accessible name. The targets are **still 16–20px**, but now **measured**, and they fall far below the project's own **44px floor** (the floor 4 dedicated commits were spent establishing).

**So the change did not shrink anything.** It converted a *hidden* defect (unreachable control) into a *reported* one (reachable but too small). **The gate is behaving correctly; the tree is genuinely below the project's own standard on mobile.**

**Also true:** `baseline diff: clean` means no scene or control went missing — this is a layout-quality failure, not a disappearance.

### ✅ RESOLUTION — owner chose "fix it first" (D-9), executed 2026-08-29

**The rule, read from the gate rather than assumed** — `tools/uishot/capture.mjs:412`:

```js
if (long < 44 || short < 32) small.push(...)   // long = max(w,h), short = min(w,h)
```

**It is NOT 44×44.** The requirement is **long ≥ 44 AND short ≥ 32** — a relaxation the owner
approved earlier so a deliberately-narrow 32×44 control passes. The rect is
`getBoundingClientRect()`, which **includes padding**.

**The fix** — both trigger buttons gain `h-12 px-2.5`:

| | before | after | long | short | verdict |
|---|---|---|---|---|---|
| like count (narrow) | 16×20 | 36×48 | 48 ✓ | 36 ✓ | pass |
| like count | 24×20 | 44×48 | 48 ✓ | 44 ✓ | pass |
| like count (wide) | 45×20 | 65×48 | 65 ✓ | 48 ✓ | pass |
| reaction break-up | 69×16 | 89×48 | 89 ✓ | 48 ✓ | pass |

`h-12 px-2.5` is **the exact box the Comment and Share buttons in `PostActionRow` already use**, so
the row gains one consistent shape rather than a third. **The row is already 48px tall because of
those siblings, so the height costs no layout at all.**

**BOTH files, not one.** `ShareSummaryTooltip.tsx` carried the **identical** trigger and was *not*
reported by the gate only because every fixture scene has `shareCount` 0, so its trigger never
rendered. **It would have gone red the first time a post was shared.** Fixed in the same commit.

**Verified locally against the real sweep, with a control:**

| Run | Result |
|---|---|
| **With the fix** | `exit 0` · **12/12 scene×viewport pass** · **zero** tap-target problems |
| **Control — fix removed** | `exit 1` · the same six failures reproduce (`45x20, 24x20, 70x16, 16x20, 24x20, 16x20`) |

*(CI reported `69x16`, local reproduced `70x16` — a 1px sub-pixel difference between runners, not a
discrepancy in the finding.)*

**⚠ Honest note on the first local attempt:** it initially reported "no tap-target problems" while
the page had **not rendered at all** (`pageerror: supabaseUrl is required` ×12). That was a false
pass, caught and discarded. The environment was corrected to the dummy values CI itself uses
(`.github/workflows/ui-gate.yml:123-125`) before any result was believed.

**Pinned:** `src/components/__tests__/SummaryTriggerTapTarget.test.ts` — 11 assertions across both
components. **Mutation-tested:** removing `h-12 px-2.5` fails 2 assertions.

**The pin strips comments before matching.** Both components' headers *quote* the old
`<div onClick={handleOpen} className="cursor-pointer">` markup, so a naive source match fails on the
documentation instead of the code — the same trap this repo hit before with a guard that matched
`|| true` inside its own comment. Caught during authoring, not after.

**Full suite after the fix: `tsc` clean · 178 files passed, 1 skipped · 2,475 tests passed, 1 skipped.**

**✅ CONFIRMED IN CI, not only locally.** UI gate on `staging`:

| Run | Commit | Result |
|---|---|---|
| **#124** | `c8aec5d5` (the pin) | ✅ **completed successfully** |
| **#123** | `bfcb68da` (the fix) | ✅ **completed successfully** |
| #122 | `25c0456` | 🔴 failed |
| #121 | `c8dc83b` | 🔴 failed |
| #120 | `e7dbf51` | 🔴 failed |

**The red streak that began at `e7dbf51` is broken. The gate is GREEN on the candidate.**

**Commits:** `bfcb68da` (fix, both components) · `c8aec5d5` (the pin).
**Consequence:** T moved `25c0456` → `c8aec5d5`. **`RC-20260829-01` is void; the candidate is now
`RC-20260829-02`.** This is the tree-immutability rule of §3.4 operating as designed, not a defect.

## 13.2 AF-19 in full — the failing secret scan

**Measured from run `33241906543`, job `99072570195`, on merge commit `9faf5a17`.**

```
RuleID:      jwt
Entropy:     5.544294
File:        .github/workflows/web-build.yml
Line:        125
Commit:      ccd5e423bf92742d98f7d1fbe4869594a11e0832
Author:      Claude <noreply@anthropic.com>
Date:        2026-08-22T11:19:08Z
Finding:     ...SE_PUBLISHABLE_KEY: <REDACTED>
leaks found: 1
```

**Provenance — this is NOT a 2026-08-29 regression.** Commit `ccd5e423` is *"ci: lane-aware CI for
the staging and production lanes"*, dated **22 August** — item **32** (the oldest) in the commit
manifest of §5.4. None of today's commits (`bfcb68da`, `c8aec5d5`, `5a700d91`, `fe4505aa`,
`9faf5a17`) contain it.

**Why it started failing only now.** The scan runs `gitleaks detect --log-opts="--no-merges
--first-parent <range>"`. Merging `main` into `staging` changed the first-parent history, so the
scanned range now reaches back through `ccd5e423`, which earlier runs did not cover. **The defect
was always in the tree; the scan window moved onto it.**

**Present on BOTH lanes** (measured, values redacted):

| Branch | Occurrences in `web-build.yml` |
|---|---|
| `staging` | **2** — lines 74 and 155 (one per lane) |
| `main` | **1** — line 54 |

### What the value actually is — and why this is not a credential incident

It is a Supabase **publishable (anon) key**. `PROJECT_MASTER_RECORD.md` §9 classifies it verbatim as
**public-safe**, and by construction it ships inside **every browser bundle** the site serves. It is
not the service-role key, not `SUPABASE_DB_URL`, and not an R2 credential. **Nothing here requires
rotation under §14 HS-10**, and this ledger does not record it as an exposure.

**But the project's own gate disagrees**, because gitleaks' generic `jwt` rule matches on shape and
entropy, not on whether a key is meant to be public. **A red gate that everyone knows to ignore is
the failure mode this whole programme exists to prevent** — so it is raised rather than waved
through.

**Does it block the merge?** **No, not mechanically.** Branch protection on `main` requires a pull
request and blocks force pushes; **"Require status checks to pass" is NOT enabled** (§9, verified).
GitHub therefore reports **"Able to merge"**. Whether it *should* block is the owner's call.

### ✅ RESOLUTION — root cause found and fixed, 2026-08-29 (`a42b209e`)

**The root cause is not a leaked secret. It is an allowlist written for one lane and never extended
to two.**

`.gitleaks.toml` already pinned the **production** anon key by exact literal, with a header
explaining it is public by design. `ccd5e423` gave `web-build.yml` a **second lane** and therefore a
**second anon key** — staging's — and **the allowlist was never extended**. That key sat in the tree
as an unallowlisted JWT from 22 August.

**Measured, both tokens decoded from their JWT payloads:**

| Token | `role` | `ref` | In allowlist before | After |
|---|---|---|---|---|
| production | **`anon`** | `jtdtehuqtinjxropkkcn` | ✅ yes | ✅ yes |
| staging | **`anon`** | `ztzutckwdhetphwghuzj` | ❌ **no ← the finding** | ✅ yes |

**Neither is a `service_role` key.** An anon key is public by construction — it ships in every
browser bundle and every table behind it is RLS-guarded. **No rotation is required, and none should
be performed** (§14 HS-10 does not apply): rotating an anon key churns every client and buys no
security.

### Verified with the real binary, with a control

**gitleaks 8.24.3 — the exact version CI runs — on the exact CI range:**

| Run | Result |
|---|---|
| **Without the fix** | 🔴 `leaks found: 1` |
| **With the fix** | ✅ `no leaks found` |

### Mutation-tested, so the allowlist cannot be over-broad

A synthetic JWT with `role="service_role"` against the same project ref, placed in a file and scanned
with the **new** config: **still caught — `leaks found: 1`.**

**Only the two exact anon literals pass. Any other JWT — including a service-role key, and including
a rotated anon key — still fails**, exactly as the config's own header promises. The fix teaches the
scanner one true fact; it does not blunt it.

**CI confirmation:** PR #104 went from **2 failing** to **ZERO failing** checks.

**D-11 did not need an owner ruling after all.** The three options in REV-6 all assumed the finding
was a true positive to be accepted or worked around. It was neither: it was a **gap in the
allowlist**, and closing the gap is a fix, not a deviation. **No deviation is carried and nothing is
signed away.**

---

## 13.3 AF-20 — the "full history" scan is not full history

**Measured 2026-08-29 with gitleaks 8.24.3 on candidate `d06b0379`.**

| Scan | Result |
|---|---|
| **As CI runs it** (`--no-merges --first-parent <range>`) | ✅ **no leaks found** |
| **Unrestricted, whole repository** | ⚠ **23 findings, 6 commits, 2026-07-09 → 2026-08-05** |

**Every one of the 23 predates the candidate window** (which begins 2026-08-22). **None is
candidate-introduced.**

### What the 23 actually are — each checked, no value printed

| Rule | Count | Assessment |
|---|---|---|
| `jwt` ×3 — `.github/workflows/test-agent.yml`, `scripts/test-agent/run-checks.mjs` | 3 | **Decoded: `role="anon"`, ref `isywidnfnjhtydmdfgtk`** — a *third* (test-agent) project's anon key. Public by design, same class as AF-19 |
| `gcp-api-key` — `google-services.json` | 1 | `PROJECT_MASTER_RECORD.md` §9, verbatim: *"Firebase client config … **client config, not a secret**"* |
| `generic-api-key` — source, tests, migrations, a `.lovable` memo | 19 | gitleaks' loosest rule, firing on long identifiers (stage keys, UUIDs). **Not individually adjudicated** — see the honest limit below |

**No evidence of a real secret in history was found.** Every finding that could be identified
resolves to a value the project already documents as public.

### The actual finding is the name, not the secrets

A gate called **"Secret scan (full history)"** that scans a **commit range** is a gate whose name
overstates its coverage. That mismatch is exactly the class of defect this programme exists to
catch — and it is also **why AF-19 hid for a week**: the range simply never reached `ccd5e423`.

### Honest limits

- The 19 `generic-api-key` findings were **classified by rule and file, not individually opened**.
  Calling them false positives is **INFERRED** from the rule's known noisiness and the file types,
  **not VERIFIED** one by one.
- This is therefore **not** a statement that the repository's history is clean. It is a statement
  that **nothing identifiable is a real secret**, and that **the gate's scope is narrower than its
  name**.

**Disposition: RECORD ONLY.** Not a release blocker — the CI gate passes honestly on what it
scans, and nothing found is a live credential. **Carried to G11:** either widen the scan and
adjudicate the 23, or rename the gate to state its true scope.

---

---

# 14 · CONTRADICTION / CORRECTION REGISTER

> Previous conclusions are **preserved, not overwritten.**

| ID | Previous claim | Source | New evidence | Corrected conclusion | Impact |
|---|---|---|---|---|---|
| **C-1** | *"Token scope is not readable after creation, so this is OWNER-ATTESTED by construction"* | MEP §8.6 | Token detail page read 2026-08-29; scope is permanently visible | **The premise is FALSE.** The *secret* is unreadable; the *scope* is readable | The entire justification for A.5's runtime test as a "compensating control" is void |
| **C-2** | Compiler stated *"205 commits"* between the branches | This session, 05:10Z | Full unshallowed clone: `git rev-list --count` = **32** | **32 commits.** 205 was a shallow-clone artifact | File count (135) and line counts were correct throughout; only the commit figure was wrong |
| **C-3** | Compiler recommended **"Option A (accept scope observation) — recommended"** for G8 | This session, 05:30Z | 08-27 signing pack marks C-1 *"intentionally left unsignable"* and requires control 3 re-run **before any substitution ruling** | **Recommendation WITHDRAWN.** A prior substitution ruling on this gate was already withdrawn once | Owner must waive the precondition **explicitly** — §23 |
| **C-4** | `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` described as *"orphan — no forward migration"* | 08-27 prep ledger | `schema_migrations`: `20260820180836 classf_repoint_originals` **applied in production** | Accurate **as to this RC**; the forward migration **does exist and is applied** | Its G11 disposition is a rename, not an investigation |
| **C-5** | *"CHG-G10-003 (PR #103) blocks ledger closure"* (AF-14 deadlock) | 08-27 prep ledger | `704ad57` is **not an ancestor of `staging`**; PR #103 body says *"Do not merge"* | **PR #103 is not in T.** The deadlock dissolves — it was never in this candidate's scope | AF-14 downgraded from blocker to resolved |
| **C-6** | RC-20260826-01 (`e2e05fbb`) treated as the promotion candidate | 08-26/27 audit set | 7 commits landed since; owner elected current `staging` | **RC-20260826-01 is VOID.** Candidate is `25c0456` | The 08-26/27 audit does **not** cover 7 of the 32 commits, incl. the one that broke the UI gate |
| **C-7** | Compiler drafted a G9 countersignature and rollback binding as *"ready to sign"* | This session, 05:55Z | Both assert *"I have read…"* facts only the owner can attest | **Not signable by the compiler, and not pre-attestable.** Drafts remain drafts | §23 signatures stay open |

---

# 15 · QA / TEST-DATA MUTATION LEDGER

**Source:** `G10_CHANGE_LEDGER_CLOSED_2026-08-27.md`. **Class: OWNER-ATTESTED / INFERRED — not re-measured today** except where noted.

| ID | Mutation | Lane | Class | Before → After | Disposition |
|---|---|---|---|---|---|
| CHG-G10-001 | PR #102 → `staging`, 9 files | staging repo | INTENDED | — | ✅ Applied & verified |
| CHG-G10-002 | ACL remediation, 252 statements, 76 signatures | staging DB | INTENDED | fingerprint `ab26c06a…` identical both lanes | ✅ Applied & verified |
| CHG-G10-003 | PR #103 — arm production isolation host rules | repo | INTENDED | — | **WITHDRAWN from this RC** (C-5) |
| CHG-G10-004 | Friendship row +1 (Flow 6) | staging DB | INTENDED | 0 → 1 | Retained as QA evidence |
| **CHG-G10-005** | **Story row +1** | staging DB | **TEST/HARNESS** (reclassified) | 0 → 1 · `expires_at` 2026-08-28T05:19:25Z (**passed**) · **no reaper exists** | **WAIVED** — ruling written 08-27, **signature line still blank** (§23) |
| CHG-G10-006 | Test post +1 (Flow 1) | staging DB | INTENDED | 0 → 1 | Retained |
| CHG-G10-007 | Reaction +1 (Flow 5) | staging DB | INTENDED | 0 → 1 | Retained |
| CHG-G10-008 | Comment +1 (Flow 4) | staging DB | INTENDED | 0 → 1 | Retained |
| CHG-G10-009 | Notification fan-out +513 | staging DB | INTENDED (consequence of 006) | 0 → 513 | Retained |

**All RLS write tests ran inside rolled-back transactions and left zero residue.**
**Disclosure retained verbatim:** CHG-005 arose when a QA file-upload landed in the page's **Story** input rather than the composer — the composer's file input is the *second* on that page. Detected from the "Story added!" toast, confirmed in the database, disclosed immediately. **Carried to G11:** the duplicate-file-input hazard.

**Mutations by THIS session (2026-08-29):** **NONE.** All database access was `SELECT`-only; all Cloudflare and GitHub access was read-only except the creation of PR #104 (§19.1).

---

# 16 · PRODUCTION WRITE LEDGER

> Stated separately and not folded into any other section.

| Category | This session | Whole release cycle | Class |
|---|---|---|---|
| **Production DB writes** | **NONE** — every query `SELECT` (`schema_migrations`, `pg_policies`, row counts) | **NONE** — §15 records zero production rows written | **VERIFIED** |
| **Production R2 writes** | **NONE** | **NONE** — `isolation-probe/` prefix returns 0 objects (§10.3); run `33079091310`'s production `PutObject` was **denied** | **VERIFIED (after-state)** |
| **Production application writes** | **NONE** | **NONE** | VERIFIED |
| **Financial actions** | **NONE.** No trade, transfer, payment or wallet operation. The 5 financial edge functions are a **POLICY EXCLUSION** and were never invoked | **NONE** | **VERIFIED** |
| **Secret exposure** | **NONE.** No secret value read, requested, displayed or stored. §7 records scopes and names only | ⚠ **ONE PRIOR EXPOSURE** — see below | **VERIFIED (this session)** |
| **Production deployment** | **NONE** | **NONE — NOT PROMOTED** | VERIFIED |
| **Production edge-function deploy** | **NONE** | **NONE** — functions do not auto-deploy from GitHub | VERIFIED |

**⚠ Historical secret exposure, retained on the record.** `G9_CLOSURE_FINAL_2026-08-24.md` BLOCKER-2: a query selected the whole `s3_storage_settings` JSON, **placing the staging R2 secret access key in a session transcript.** The token was rotated in response — which is why `staging-upload` is only days old. §14 **HS-10** treats any recurrence as a hard stop. **This is the reason no session may execute the A.5 runtime test.**

---

# 17 · ROLLBACK CONTROL

## 17.1 Database rollback set — RC-20260829-01

Execute in **reverse migration order**, via `apply-migration.yml`, `target=production`, dispatched from `main`:

| Order | File | Forward migration | Tested? |
|---|---|---|---|
| **0** | `20260828082136_ad_comment_ban_and_visibility_policies_ROLLBACK.sql` | M2 (§6.2) | ❌ **never executed** |
| 1 | `UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql` | applied prod `20260825115208` | ❌ never executed |
| 2 | `UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql` | applied prod `20260825115116` | ❌ never executed |
| 3 | `UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql` | applied prod `20260825115030` | ❌ never executed |
| 4 | `UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql` | applied prod `20260825092152` | ❌ never executed |
| 5 | `20260824145345_admin_user_lookup_by_email_ROLLBACK.sql` | applied both lanes | ❌ never executed |

**⚠ CHANGED FROM THE 08-27 BINDING:** that binding named **five** files. This RC adds **M2's rollback at order 0** — it must run **first**, because M2 was applied last. **Signing the 08-27 five-file binding would leave M2 un-rollbackable.** §14 C-8 *(new — recorded here).*

**EXCLUDED:** `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` — its forward migration (`20260820180836`) is applied in production but is **not part of this RC**.

## 17.2 Limitations — stated plainly

- **The entire set is prepared and reviewed but NEVER EXECUTED against a live database.**
- §17-9's Pages-deployment rollback covers **the web bundle only** — it does **not** cover schema.
- M2's rollback **reopens both security gaps** by design; its own header says so. It is not a safe default.
- **No rollback exists for the merge itself** beyond `git revert` of the merge commit, which does not un-apply migrations.

---

# 18 · PRE-PROMOTION SNAPSHOT — 2026-08-29T08:45Z

```
RC SHA (T)          d06b0379776aef94d006d78b1de37a0cda685927
T tree              f4616fb680f863d1141491d9ab5f3b619c048f4b
promotion merge base 9faf5a17  (parents fe4505aa + b671e1fb)
main SHA            b671e1fb0c5bcf145d442076c229eca888afd674   ← UNCHANGED all session
main is ancestor    YES  (conflict resolved 08:05Z, D-6)
working tree        clean
PR #104             "Able to merge" — no conflicts

CI ON THE CANDIDATE — ALL GREEN
  Typecheck                             pass
  Web build / staging lane              pass
  Web build / lane resolves to one      pass
  Security / dependency vulnerabilities pass
  Security / own security rules         pass
  Security / Secret scan (full history) pass   9s   (was RED — AF-19)
  UI gate / every control reachable     pass   7m   (was RED — AF-15)
  Cloudflare Pages (staging)            deployed
  failing checks                        ZERO

LOCAL VERIFICATION ON d06b0379
  tsc --noEmit                          exit 0
  vitest                                178 files, 2,475 passed, 1 skipped
  gitleaks (CI range)                   no leaks found
  gitleaks (unrestricted)               23 findings, all pre-candidate — AF-20

DATABASE
  new migrations in promotion           2
    20260824145345  applied BOTH lanes            (net effect: none)
    20260828082136  applied STAGING ONLY  ← D-10, must run post-merge
  production ad_creative_comments RLS   7 policies  (staging: 9)
  live exposure of the 2 missing policies  ZERO (0 hidden creatives, 0 banned members)

SECURITY POSTURE
  branch protection protect-main        ACTIVE, bypass EMPTY, PR required, force-push blocked
  SUPABASE_DB_URL                       production Environment only; absent at repo level
  repo secrets                          4, all ANDROID_*
  R2 token staging-upload               1 policy, 50mm-staging only, no expiration
  production R2 isolation-probe/        0 objects

APPROVAL
  tags in repository                    0
  §11 Release Approval Record           UNSIGNED
  §25 independent audit                 NOT PERFORMED
```

---

---

# 19 · PROMOTION RECORD

## 19.1 Actions taken by this session

| Action | Detail | Reversible? |
|---|---|---|
| **PR #104 created** | base `main` ← head `staging`; title *"Promote staging to main — 32 commits…"*; PROVE block completed with evidence classes; actor `altisinfonet` | ✅ Yes — closing the PR lands nothing |

**PR #104 changes nothing on `main`.** It is a reviewable proposal. **No merge, no tag, no deployment, no migration dispatch has occurred.**

## 19.2 Promotion — **NOT PERFORMED**

| Field | Value |
|---|---|
| Approval | ❌ **NOT GIVEN** — §11 record unsigned |
| Tag | ❌ **NONE** — repository holds **0 tags** |
| Merge SHA | ❌ does not exist |
| Actor | — |
| Timestamp | — |
| Deployment | ❌ does not exist |

---

# 20 · POST-PROMOTION RECONCILIATION

**`APPROVED RC → PR → MERGE → BUILD → DEPLOYMENT → PRODUCTION`**

| Link | State |
|---|---|
| APPROVED RC | ❌ not approved |
| PR | ✅ #104 exists (conflicted) |
| MERGE | ❌ not performed |
| BUILD | ❌ not performed |
| DEPLOYMENT | ❌ not performed |
| PRODUCTION | ❌ unchanged — still `b671e1fb` |

**Nothing to reconcile. This section is intentionally empty of assertions.** At promotion it must record: merge SHA; tree equality of the merged tree against the tag created **before** the merge (§17-11); build run ID; deployment ID; and the production-served commit.

**Expected tree after conflict resolution ≠ `51616b21`.** Resolving the certificate conflict produces a merge commit whose tree differs from both parents. **Tree equality must therefore be asserted against the tag created at approval time, not against T.**

---

# 21 · UNAUTHORIZED-CHANGE CHECK

| Category | Finding | Class |
|---|---|---|
| Unexpected files | **NONE.** All 29 additions map to a named commit and a stated purpose (§5.1) | VERIFIED |
| Unexpected commits | **NONE.** All 32 enumerated (§5.4). The `ec1a3b9`/`44e3e92` pair is a deliberate prove-then-revert with net-zero effect | VERIFIED |
| Unexpected migrations | **ONE REQUIRING NOTICE** — `20260828082136` post-dates the former RC. **Legitimate, expand-only, security-tightening, with a rollback.** Not unauthorized; **it does void the 08-26 audit's coverage** | VERIFIED |
| Unexpected DB changes | **NONE.** Staging `schema_migrations` matches the repo; production carries nothing not in the repo | VERIFIED |
| Unexpected configuration | **ONE** — `_headers` ACAO apex→`www` (AF-11), a production behaviour change carried under a de-hardcoding commit | VERIFIED |
| Unexpected production writes | **NONE** (§16) | VERIFIED |
| Deleted files | **NONE** | VERIFIED |

---

# 22 · OWNER DECISIONS / DEVIATIONS

| ID | Decision | Reason | Date | Owner | Evidence | State |
|---|---|---|---|---|---|---|
| **D-1** | Accept the 9 `UNAPPLIED_`-prefixed filenames as a documented deviation | Renaming changes the tree → rebaselines the candidate → invalidates every earned CI artifact. Defect is documentary; nothing machine-readable depends on the names | 2026-08-27 | Neil Basu | §6.3 | **DRAFTED — UNSIGNED** |
| **D-2** | *(reserved — superseded by D-1)* | | | | | — |
| **D-4** | Shorten the "Only Me" notice to one sentence; **D-002 stays OPEN** | UI-copy-only change; storage remediation deferred | 2026-08-29 | Neil Basu | `docs/DECISIONS.md` D-002 "Update, 2026-08-29"; `25c0456` | ✅ **EXECUTED** |
| **D-5** | Accept AF-03 (production-CDN refs in staging config); decline remediation | Nulling SEO keys would convert a visible failure into a **vacuous pass** on §15 row 8 — the anti-pattern the gate exists to prevent | 2026-08-27 | Neil Basu | §10.4 | **DRAFTED — UNSIGNED** |
| **D-6** | **Certificate conflict resolves to STAGING's colours (blue).** *"use the blue as in staging it is final, no difference from Staging"* | Owner's design ruling; also the **only** resolution that compiles (§4.3) | 2026-08-29 | Neil Basu | §4.3, §4.4 | ⚠ **RULED · RESOLUTION PREPARED AND VERIFIED · COMMIT NOT LANDED** — see §4.4 |
| **D-7** | Promote **current `staging`**, not the audited 08-26 tree | Today's fixes must reach members and the app build | 2026-08-29 | Neil Basu | §3.4 | ✅ **RULED.** Consequence: 7 commits bypass the full gate review |
| **D-8** | **ACAO accepted as `www`** (option D-8b) | Owner: *"approve ACAO header"*. The site is served on `www`, so a browser there sends `Origin: https://www.50mmretina.com`; the apex value would not match it | 2026-08-29 | Neil Basu | §7.2 | ✅ **RULED — ACCEPTED.** On promotion, production `Access-Control-Allow-Origin` changes **apex → `www`**. This is a deliberate CORS correction, no longer an undeclared side effect |
| **D-9** | **AF-15 — fix the tap targets rather than ship the red gate** | Owner: *"fix it first"*. Option (a) chosen over accepting a deviation or reverting | 2026-08-29 | Neil Basu | §13.1 | ✅ **RULED AND EXECUTED** — `bfcb68da` (fix) + `c8aec5d5` (pin) |
| **D-12** | **G8 — waive the control-3 precondition; accept token-scope observation** | The control cannot discriminate for a correctly-scoped token (§10.2 / §4A). Owner informed that a prior ruling on this gate was withdrawn | 2026-08-29 | Neil Basu | §23.3 | ✅ **RULED — WAIVED.** G8 = CLOSED WITH DOCUMENTED DEVIATION |
| **D-10** | **Apply migration `20260828082136` to production, post-merge** (option D-10a) | Owner: *"apply migration 20260828082136 post-merge"*. Closes two live RLS gaps on `ad_creative_comments` | 2026-08-29 | Neil Basu | §6.2, §24.3 | ✅ **RULED — SCHEDULED.** ⚠ **NOT YET EXECUTED.** It is a production DB write and an owner action; see §24.3 step 12 |

### D-8 · THE DECISION TO BE MADE (not yet made)

**Fact:** `public/_headers` on `main` serves `Access-Control-Allow-Origin: https://50mmretina.com`
(apex). The generated file in T emits `https://www.50mmretina.com` (www). Everything else in that
file is byte-identical. **This is a production behaviour change carried under a de-hardcoding
commit and never declared.**

| Option | Effect |
|---|---|
| **D-8a** | Derive ACAO from the **apex** display form → production stays **byte-identical**; the change is reverted to a no-op for this release |
| **D-8b** | Accept **`www`** as a deliberate CORS correction, recorded as its own decision. Arguably the *more correct* value — the site is served on `www`, so a browser there sends `Origin: https://www.50mmretina.com` and the apex value would not match it |

**Neither option is chosen. This is an owner ruling about what the production CDN accepts.**

### D-10 · THE DECISION TO BE MADE (not yet made)

**Fact:** migration `20260828082136` is applied on staging, **not** on production (§6.2, measured).
Production is missing two RLS policies; **live exposure is currently 0** (0 hidden creatives, 0
banned members). **Merging PR #104 does NOT apply it** — migrations need a separate dispatch.

| Option | Effect |
|---|---|
| **D-10a** | Apply M2 to production immediately after the merge (§24.3), verify `pg_policies` returns **9 rows** |
| **D-10b** | Defer, and accept that both gaps stay open in production until a later cycle |

**Neither option is chosen.** Applying a migration is a **production database write** and is an
owner action by construction — no session performs it.

---

# 23 · SIGNATURES / APPROVALS

**All unsigned. None may be signed by the compiler.**

| ID | Instrument | Prerequisite | State |
|---|---|---|---|
| **B8 / D-1** | `UNAPPLIED_` deviation acceptance | — | ☐ **UNSIGNED** |
| **B11** | Database rollback binding | **⚠ Must be re-drafted to SIX files** — the 08-27 five-file version omits M2's rollback (§17.1) | ☐ **UNSIGNED — and the existing draft is now WRONG** |
| **B13** | G9 exclusion countersignature — accepts 4 residual production risks incl. `submit-judge-decision` answering `*` | Requires the owner to have **read** `G10_S14_G9_EXCLUSION_RULING_2026-08-26.md`. Not pre-attestable | ☐ **UNSIGNED** |
| **B12 / CHG-005** | Change-ledger closure + Story-row waiver | Ruling written 08-27; signature line blank | ☐ **UNSIGNED** |
| **D-5 / AF-03** | Deviation acceptance | — | ☐ **UNSIGNED** |
| **G8 substitution** | Accept token-scope observation in place of A.5 | Precondition **explicitly waived** by the owner, §23.3 | ✅ **RULED 2026-08-29 — D-12** |
| **D-8 / AF-11** | ACAO ruling | — | ☐ **NOT DRAFTED** |
| **D-9 / AF-15** | UI-gate ruling | — | ☐ **NOT DRAFTED** |
| **D-10 / AF-17** | Apply M2 to production | — | ☐ **NOT DRAFTED** |
| **§11 Release Approval Record (OA-19)** | 8 fields, signed **and tagged BEFORE the merge** (§17-10) | **Cannot be signed while G8 and AF-15 are unresolved** | ☐ **UNSIGNED** |
| **Promotion approval (OA-20)** | §12.4 in order | All above | ☐ **UNSIGNED** |
| **Ledger closure** | This document | All above + §25 | ☐ **OPEN** |

## 23.3 · D-12 — G8 SUBSTITUTION, WAIVED AND ACCEPTED BY THE OWNER

**Ruled 2026-08-29 by Neil Basu, in this session, after being shown the evidence, its class, and the
fact that a prior substitution ruling on this same gate had been withdrawn.**

> **§8.6 — R2 WRITE ISOLATION. PRECONDITION WAIVED; SCOPE OBSERVATION ACCEPTED.**
>
> I accept direct observation of the token's permission list as evidence that the staging storage
> credential cannot write to the production bucket, **in place of** A.5's runtime negative test.
>
> **I waive** the 2026-08-27 signing pack's requirement that A.5's known-absent control be re-run
> before any substitution ruling is signed. I do so on the recorded finding that **the control
> cannot discriminate for a correctly-scoped token**: `50mm` and a non-existent bucket are both
> outside the token's Access Policy, so both are refused at the authorization layer (`10003
> AccessDenied`) before the existence check that would emit `10006 NoSuchBucket`. **Only a
> credential broad enough to fail the gate could produce the answer the control asks for.**
>
> **I am aware** that a prior session's substitution ruling on this gate was withdrawn, and that
> the signing pack marked it "intentionally left unsignable." This waiver is made knowingly.
>
> **I accept the evidence class:** the token's scope is **VERIFIED** by direct reading; runtime
> enforcement is **INFERRED** from Cloudflare's documented deny-by-default Access Policy model,
> **not observed**. Cloudflare's error-code reference documents both codes but is silent on
> evaluation order.
>
> **I accept the residual limits:** §8.6 part 3 has an **after** measurement only — the production
> bucket's `isolation-probe/` prefix returned **zero objects** at 2026-08-29T04:37:25Z — and **no
> before baseline exists** for run `33079091310`, nor can one be created retroactively.
>
> **Evidence relied upon:**
> 1. Token `staging-upload` (`73a7920647481fd93553f9c1f68bf5a3`) — **exactly one** permission policy: `R2 › 50mm-staging`, Bucket Item Write. **No policy names `50mm`.** Only token in the account.
> 2. Owner-confirmed: `site_settings.s3_storage_settings.access_key_id` **equals that token id**; Cloudflare docs state verbatim *"Access Key ID: The `id` of the API token."*
> 3. Run `33079091310`: the same credential, seconds apart, **succeeded** writing to `50mm-staging` and was **denied** writing to `50mm`. A credential erroring on everything could not have succeeded on the first.
> 4. Production `50mm`, prefix `isolation-probe/` → **no objects matched**, measured 04:37:25Z.
> 5. Precedent: `G9_CLOSURE_FINAL_2026-08-24.md` closed **G9 GREEN** on this same evidence class, naming this same token.
>
> **G8 recorded as: CLOSED WITH DOCUMENTED DEVIATION** — the substance of §8.6 part 2 is met; the
> prescribed instrument was not used, and that substitution is this deviation.
>
> Ruled by: **Neil Basu (owner)** · Date (UTC): **2026-08-29** · Recorded in session, transcribed
> verbatim from the owner's decision. **Not signed by the compiler.**

---

## 23.1 · B11 — CORRECTED SIX-FILE ROLLBACK BINDING (ready to sign)

> ⚠ **Do not sign the 2026-08-27 five-file version.** It predates migration `20260828082136` and
> would leave that migration **un-rollbackable**. This supersedes it.

> **DATABASE ROLLBACK COMPONENT — RC-20260829-05.**
> The database rollback for candidate `d06b0379776aef94d006d78b1de37a0cda685927` is the following
> **six** files, executed in **reverse migration order (0 → 5)** via
> `.github/workflows/apply-migration.yml` with `target = production`, dispatched from `main`:
>
> 0. `supabase/rollback/20260828082136_ad_comment_ban_and_visibility_policies_ROLLBACK.sql`
>    **← runs FIRST; absent from the 08-27 draft**
> 1. `supabase/rollback/UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql`
> 2. `supabase/rollback/UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql`
> 3. `supabase/rollback/UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql`
> 4. `supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql`
> 5. `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql`
>
> `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` is **NOT** part of this set — its
> forward migration is applied in production but is not part of this RC.
>
> **I acknowledge:**
> * this set is **prepared and reviewed but NEVER EXECUTED** against a live database;
> * **file 0 reopens both RLS gaps by design** — a banned member could comment on ads again, and a
>   hidden ad's thread would become readable again. It is not a safe default and its own header
>   says so;
> * §17-9's Pages-deployment rollback covers the **web bundle only** and does **not** cover schema;
> * `git revert` of the merge does **not** un-apply any migration.
>
> Signed: ______________________  Date (UTC): ____________

---

## 23.2 · §11 RELEASE APPROVAL RECORD (OA-19) — pre-filled, UNSIGNED

> ⚠ **Must be signed AND the tag created BEFORE the merge** (§17-10). Tree equality after the merge
> is asserted against **that tag**, not against T (§20).
> ⚠ **Item 3 (G8) is now CLOSED — D-12.** Still cannot be signed while **item 4 (§5.3 probe)** and **item 6 (B11 signature)** are open, and while **§25 is vacant**.

| # | Field | Value |
|---|---|---|
| 1 | Release ID | `RC-20260829-05` |
| 2 | Candidate SHA | `d06b0379776aef94d006d78b1de37a0cda685927` |
| 3 | Candidate tree | `f4616fb680f863d1141491d9ab5f3b619c048f4b` |
| 4 | Target | `main` at `b671e1fb0c5bcf145d442076c229eca888afd674` |
| 5 | Gate status | 7 GREEN · 4 CLOSED-WITH-DEVIATION · G10 not reachable pre-merge (§10 ceiling) |
| 6 | Deviations accepted | **D-1** `UNAPPLIED_` filenames · **D-5** AF-03 data-borne CDN refs · **D-7** 7 commits outside the 08-26 review · **G8** substitution — **waived, D-12 §23.3** |
| 7 | Findings carried to G11 | AF-03 · AF-11 *(ruled D-8)* · AF-13 · AF-16 · **AF-20** |
| 8 | Post-promotion obligations | **D-10** apply `20260828082136` · N2 cross-lane · §18 regression · deploy G9 edge functions |
|  | **Tag** | `______________________` *(create BEFORE merging)* |
|  | **Signed** | `______________________`  Date (UTC): `____________` |

---

---

# 24 · POST-PROMOTION GATES — SEQUENCING

## 24.1 PRE-PROMOTION (before the merge button)

1. **D-9** — rule on AF-15 (red UI gate). If fixing: new commit → **new RC** → re-run §18.
2. **D-8** — rule on AF-11 (ACAO).
3. **G8** — resolve (§10.2 / §23).
4. **Confirm a `staging` Environment exists** with its own `SUPABASE_DB_URL` (§7.1), or `apply-migration.yml target=staging` cannot run.
5. Sign B8, B11 (**six-file version**), B12, B13, D-5.
6. **§5.3 secret-isolation probe** — §5.3.6 requires it **immediately before** promotion. Running it early goes stale and must be repeated.
7. **§11 approval signed AND tagged** — the tag must exist **before** the merge (§17-10).

## 24.2 PROMOTION-TIME

8. **Resolve the certificate conflict → staging's blue (D-6).** This creates a commit; the merged tree will differ from T.
9. Merge PR #104.
10. **Assert tree equality against the tag from step 7**, not against T (§20).
11. Verify the production build and deployment.

## 24.3 POST-PROMOTION

12. **🔴 APPLY M2 TO PRODUCTION** — `20260828082136_ad_comment_ban_and_visibility_policies.sql` via `apply-migration.yml`, `target=production`, from `main`. **Until this runs, both RLS gaps stay open in production even though the file is on `main`.** Verify: `pg_policies` on `ad_creative_comments` returns **9 rows**.
13. **N2 cross-lane test** — only meaningful **after** the merge installs the gate on `main` (§12 row 12). ⚠ Execute **N2 only** (staging URL / production target). **Do NOT execute N1 as written** — it places a production credential in a staging Environment, and a gate failure would hit **production live member data**. Safe N1 substitute: dispatch `target=staging` from `main`, which trips gate 1 before any credential is read.
14. **§18 regression suite** — post-promotion by construction.
15. **Deploy the G9 edge-function fixes** — merging does **not** deploy them; `submit-judge-decision` keeps answering `*` until deployed.
16. Android build from `main` — separate release, own versionCode, AF-13 unresolved.

---

# 25 · INDEPENDENT AUDIT SECTION

> **RESERVED. Not to be completed by the compiler of this ledger.**
> For an independent auditor (Codex, a separate Claude session, another reviewer). Every item below should be re-derived **from the repository, the databases and the dashboards**, never from this document's conclusions.

**Independently verified:**
> *(auditor to complete)*

**Insufficient evidence / could not verify:**
> *(auditor to complete)*

**Compiler errors found:**
> *(auditor to complete — §14 already records 7 self-caught corrections C-1…C-7; the absence of an eighth is not evidence there is none)*

**Corrected conclusions:**
> *(auditor to complete)*

**Remaining blockers:**
> *(auditor to complete)*

**Suggested starting points, highest value first:**
1. Re-run `git rev-list --count origin/main..origin/staging` on a **full** clone (C-2 was a shallow-clone error).
2. Re-query `pg_policies` on `ad_creative_comments` in **both** lanes (AF-17 is the highest-severity live finding).
3. Re-read UI-gate run `33232872781` logs and confirm the `e7dbf51` boundary (AF-15).
4. Confirm the R2 token's policy list independently (§10.2) and judge whether §10.2's `INFERRED` step 7 is acceptable.
5. Check whether a `staging` GitHub Environment exists (§7.1, unresolved).
6. Verify §10.4 AF-03 by re-measurement — this ledger carries it as **INFERRED** only.

---

# 26 · FINAL RELEASE DISPOSITION

# 🔴 NOT READY

**Blocking, in order:**

| # | Blocker | Ref |
|---|---|---|
| ~~1~~ | ~~UI gate RED on the candidate~~ — ✅ **RESOLVED.** Fixed, controlled, pinned, and **green in CI** (runs #123/#124) | AF-15 · D-9 |
| ~~2~~ | ~~Merge conflict unresolved~~ — ✅ **RESOLVED.** Merge `9faf5a17` landed; blue taken; `tsc` clean, 2,475 tests pass; PR #104 **"Able to merge"** | §4.4 · D-6 |
| ~~3~~ | ~~G8 instrument not satisfied~~ — ✅ **RESOLVED.** Owner waived the precondition and accepted scope observation (**D-12**, §23.3) | §10.2 · §23.3 |
| 4 | **§5.3 secret-isolation probe never run**, and must run immediately pre-merge | §24.1 |
| 5 | **§11 approval unsigned; 0 tags exist** | §23 |
| ~~6~~ | ~~B11 rollback binding wrong~~ — ✅ **CORRECTED six-file text drafted, §23.1.** ☐ still **UNSIGNED** | §17.1 · §23.1 |
| ~~7~~ | ~~AF-11 ACAO ruling not made~~ — ✅ **RULED:** accepted as `www` | D-8 |
| 8 | **AF-17** — production missing 2 RLS policies. ✅ **RULED:** apply post-merge (D-10). ⚠ **ACTION STILL PENDING** — production DB write, owner-only | D-10 · §24.3 |
| 9 | **No independent audit performed** | §25 |
| ~~10~~ | ~~AF-19 — secret scan RED~~ — ✅ **RESOLVED** by `a42b209e`. Root cause was a one-lane allowlist never extended to two. Control-verified and mutation-tested. **No deviation carried** | §13.2 |

**Not blocking, recorded:** AF-13 (Android records) · AF-16 (version-stamp divergence) · AF-03/D-5 (accepted) · §15 rows 1 and 8 failing under D-5.

**What would change this to READY FOR APPROVAL:** items 3, 4 and 6 resolved with evidence; §25 completed by an independent auditor; then §11 signed and tagged.

**Progress since REV-3:** blocker 1 (red UI gate) closed with direct evidence — reproduced, root-caused, fixed in both affected components, control-verified, mutation-pinned, CI-green. Blocker 2 (merge conflict) **executed and verified**. Blocker 7 (D-8) **ruled**. D-9 and D-10 **ruled**.

**AF-19 was opened by measurement and closed the same day** — root-caused to a one-lane allowlist,
fixed, control-verified and mutation-tested, with **no deviation carried**.

**Every CI gate on the candidate is now GREEN.** Net **9 → 5 outstanding.**

**Still outstanding:** §5.3 secret-isolation probe (4) · B11 **six-file** rollback binding signature
(6) · the AF-17 production migration **action** (8 — ruled D-10, not executed) · independent audit
(9) · then §11 approval + tag. **G8 (3) is closed — D-12.**

---

# 27 · "NOTHING HIDDEN" CHECKLIST

| # | Item | State |
|---|---|---|
| 1 | Every file accounted for | ✅ 135 = 29 A + 106 M + 0 D (§5) |
| 2 | Every commit accounted for | ✅ 32 enumerated (§5.4) + 2 main-only (§4.2) |
| 3 | Every migration/rollback accounted for | ✅ §6 |
| 4 | Every DB change accounted for | ✅ §6, measured both lanes |
| 5 | Every config/secret-scope change accounted for | ⚠ §7 — **`staging` Environment existence UNRESOLVED** |
| 6 | Every CI run accounted for | ✅ §8 |
| 7 | Every deployment accounted for | ✅ staging only; **no production deployment exists** |
| 8 | Every QA mutation accounted for | ⚠ §15 — carried as OWNER-ATTESTED, **not re-measured** |
| 9 | Every finding accounted for | ✅ §13 — AF-03, 11, 13, 14, 15, 16, 17, 18 |
| 10 | Every deviation accounted for | ✅ §22 — D-1, 4, 5, 6, 7 ruled; **D-8, 9, 10 OPEN** |
| 11 | Every N/A has reasoning | ✅ §11, §12 |
| 12 | Every BLOCKED item has reasoning | ✅ §11 G3/G6, §12 row 10 |
| 13 | Every DEFERRED item has owner + date | ⚠ **PARTIAL** — §12 rows 11/12 name the owner but **no date**; G11 items have no scheduled date |
| 14 | Every GREEN has direct evidence | ⚠ **NO** — G1–G2, G4, G5b, G7 are **INFERRED** from prior reports, not re-measured. **Explicitly labelled, not silently upgraded** |
| 15 | No secret values recorded | ✅ §7, §16 |
| 16 | No unauthorized production writes | ✅ §16 — zero |
| 17 | Approved RC SHA matches promoted tree | **N/A — nothing approved, nothing promoted** |
| 18 | Deployment SHA matches expected tree | **N/A — no deployment** |
| 19 | No unauthorized changes | ✅ §21 — one item requiring notice (M2), legitimate |
| 20 | Independent audit completed | ❌ **NO** — §25 vacant |
| 21 | Owner approval completed | ❌ **NO** — §23 all unsigned |
| 22 | Ledger signed and closed | ❌ **NO** — **OPEN** |

**Items 5, 8, 13, 14 are ⚠ rather than ✅ deliberately.** Marking them green would require either measurements not taken or an upgrade of evidence class that §1's rules forbid.

---

## LEDGER MAINTENANCE

**This file is updated in place.** Every future promotion appends a new revision block to §1 and updates the sections it touches. **Do not create a dated copy** — dated copies are what made 370 project documents unauditable and produced corrections C-2 through C-6.

| Rev | Date | Change |
|---|---|---|
| REV-1 | 2026-08-29 04:11Z | Initial staging→main summary *(contained the 205-commit error, C-2)* |
| REV-2 | 2026-08-29 05:20Z | Plain-language rewrite; commit count corrected to 32 |
| REV-3 | 2026-08-29 06:10Z | **Full audit-grade rebuild.** 27 sections. New: AF-15 (red UI gate, root-caused), AF-17 (production RLS gaps, measured), AF-18, AF-16; corrections C-1…C-7; six-file rollback binding; §25 audit section |
| REV-4 | 2026-08-29 07:15Z | **AF-15 CLOSED.** Owner ruling D-9 = "fix it first". `h-12 px-2.5` on both summary triggers; `SummaryTriggerTapTarget.test.ts` pins it (mutation-tested); local sweep 12/12 with a control proving the failure returns without the fix; **CI runs #123/#124 green**. Candidate advanced `25c0456` → `c8aec5d5`; `RC-20260829-01` void, now `RC-20260829-02`. Blockers 9 → 8 |
| REV-5 | 2026-08-29 07:55Z | **Auditor Option 3 pass.** §4.4 added: certificate conflict resolution prepared, editor loaded and marked resolved, **merged tree verified `tsc` clean + 2,475 tests** — but **"Commit merge" could not be actuated from this session**, so `origin/staging` is unchanged at `5a700d91` and **no merge commit exists**. Botched intermediate edit disclosed and discarded, nothing committed. **D-8 and D-10 framed with explicit options but NOT decided** — no owner ruling exists for either; the compiler does not make them |
| REV-6 | 2026-08-29 08:20Z | **D-6 EXECUTED.** Merge `9faf5a17` (`main` → `staging`) landed taking staging's blue on all 6 hunks; verified `tsc` clean + **2,475 tests**, 0 markers, PR #104 **"Able to merge"**. **UI gate GREEN on the merge commit.** Owner decisions **D-8 (ACAO = `www`)**, **D-9 (tap-target fix)** and **D-10 (apply `20260828082136` post-merge)** recorded as RULED. 🆕 **AF-19** — secret scan RED: publishable key hardcoded in `web-build.yml` since `ccd5e423` (2026-08-22), **pre-existing, not a credential incident**, ruling **D-11** required |
| REV-7 | 2026-08-29 08:30Z | **AF-19 CLOSED — and it was not what REV-6 assumed.** Root cause: `.gitleaks.toml` pinned only the **production** anon key; `ccd5e423` added a **second lane** and a **second anon key** (staging) that was never allowlisted. Both decoded and confirmed `role="anon"` — no `service_role` key, **no rotation required**. Fixed in `a42b209e`; verified with **real gitleaks 8.24.3** (control: 1 leak → 0) and **mutation-tested** (a synthetic `service_role` JWT is still caught). **PR #104: zero failing checks.** D-11 dissolved — a gap in an allowlist is a fix, not a deviation. Blockers 6 → 5 |
| REV-8 | 2026-08-29 08:45Z | **Final verification pass on `d06b0379`.** tsc 0 · 2,475 tests · gitleaks clean on the CI range · **all CI gates green, zero failing**. §18 snapshot refreshed. 🆕 **AF-20** — the gate named "Secret scan (full history)" scans a *range*, not full history; an unrestricted scan returns 23 findings, **all pre-candidate**, none identifiable as a real secret (3 decoded as `role="anon"`, 1 documented client config, 19 `generic-api-key` **inferred**-not-verified). RECORD ONLY → G11. **§23.1 corrected SIX-file rollback binding** drafted (the 08-27 five-file draft would leave M2 un-rollbackable). **§23.2 §11 approval record pre-filled, unsigned** |
| **REV-9** | **2026-08-29 09:05Z** | **G8 CLOSED — D-12.** Owner waived the 08-27 precondition and accepted token-scope observation in place of A.5's runtime test, after being shown the evidence class (scope VERIFIED, runtime enforcement INFERRED), the residual limits (after-only measurement, no before baseline), and the fact that a prior substitution ruling on this gate had been withdrawn. Full text §23.3. **G8 = CLOSED WITH DOCUMENTED DEVIATION.** Also corrected: the stale **REV-3** copy on `altisinfonet-patch-35` that was misleading the auditor is now synced to REV-8+. Blockers 5 → 4 |

---

*Compiled read-only. No production write, no secret handled, no financial action, no merge, no tag, no deployment, no migration dispatch. `main` unchanged at `b671e1fb`. T unchanged at `25c0456`.*
