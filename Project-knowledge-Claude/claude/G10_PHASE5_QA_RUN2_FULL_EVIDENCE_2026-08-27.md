# G10 PHASE 5 — FULL INTERACTIVE QA RUN #2 · COMPLETE EVIDENCE

**Executed 2026-08-27, ~05:05–05:35 UTC.** Lane `staging.50mmretina.com` / `ztzutckwdhetphwghuzj`.
Driven through the owner's already-authenticated Chrome as the seeded staging **admin** (`25d4916c-…`).
**No credential requested, displayed, or recorded.**

**FREEZE INTACT — `main` = `b671e1f` · T = `e2e05fb` · PR #103 unmerged · zero production writes · RC NOT APPROVED.**

---

# 1. STEP 0 — PRODUCTION COMPARISON (read-only). ALL THREE PRE-EXISTING.

Identical probes, both lanes. The Chrome profile is admin on **both**, so the AF-04 comparison is like-for-like.

| Finding | Staging | Production | Verdict |
|---|---|---|---|
| **AF-04** `/referrals` | → `/admin/health`, h1 "Admin Panel" | **→ `/admin/health`, h1 "Admin Panel"** | **PRE-EXISTING** |
| **AF-05** `<meta robots>` | `index, follow` ×2 | **`index, follow` ×2** | **PRE-EXISTING** — tag is not lane-aware |
| **AF-07** duplicate meta | 24 metas | **23 metas, 11 duplicated keys, 2 canonicals** | **PRE-EXISTING** |

**None is a regression introduced by T. T is NOT modified. No candidate re-baseline required.**

**AF-06 RESOLVED — working as designed, not a defect.** Production: `sitemap.xml` = **12 `<loc>` entries**,
`robots.txt` = allow-list with per-path `Disallow` (`/admin`, `/dashboard`, `/wallet`, `/judge`,
`/referrals`, …). Staging: **0 entries**, `Disallow: /`. **The generator is lane-aware.**
Row 8's sitemap criterion → **N/A (by design)**, evidenced by production's working 12-URL sitemap.

That isolates AF-05 precisely: **`robots.txt`/`sitemap.xml` are lane-aware; the `<meta robots>` tag is not.**

> ⚠ **SAFETY:** the QA browser profile is signed in to **production as an administrator**. All production
> access this run was read-only navigation, and I returned to staging immediately. **Before further
> write-flow QA, that production session should be signed out or moved to another Chrome profile.**

---

# 2. STEP 2 — AF-03 COMPLETE BEFORE-STATE (PRESERVED, NOTHING APPLIED)

## 2.1 All 46 references, mechanically enumerated

| Key | Folder | Refs | Distinct URLs | Live config? |
|---|---|---|---|---|
| `managed_pages` | site-assets | 10 | 1 | **LIVE** |
| `managed_pages` | portfolio-images | 7 | 1 | **LIVE** |
| `ad_slots` | journal-images/ads | 9 | 9 | **LIVE** |
| `ad_slots_backup_20260723` | journal-images/ads | 9 | 9 | **BACKUP — dated restore point** |
| `seo_pages` | site-assets | 7 | 1 | **LIVE** |
| `ad_zones_v2` | journal-images/ads | 3 | 2 | **LIVE** |
| `seo_global` | site-assets | 1 | 1 | **LIVE** |

10+7+9+9+7+3+1 = **46** ✓ · **37 live · 9 backup**

## 2.2 The 12 distinct objects — all genuine 50mm production assets, ZERO third-party

| Object | Occurrences | Keys |
|---|---|---|
| `site-assets/seo/…rusybos.jpg` | **18** | managed_pages, seo_global, seo_pages |
| `portfolio-images/on-page/site_logo-….webp` | **7** | managed_pages |
| `journal-images/ads/…47fc31-….webp` | 4 | ad_slots, backup, ad_zones_v2 |
| 8 further ad creatives | 2 each (16) | ad_slots, backup |
| `journal-images/ads/…t048of2o9dd.webp` | 1 | ad_zones_v2 |

## 2.3 Existence test — first instrument DISCARDED, second controlled

**Discarded attempt:** returned ABSENT for all 13 paths **including the negative control** → no
discriminating power → thrown away, not reported.

**Controlled re-run:**

| Probe | From staging origin | From production origin |
|---|---|---|
| **POSITIVE CONTROL** (image already rendering) | **EXISTS** ✓ | **EXISTS** ✓ |
| **NEGATIVE CONTROL** (absent path) | **ERROR** ✓ | **ERROR** ✓ |
| ad asset | cdn-staging → **ABSENT** · cdn → **ERROR** | cdn → **EXISTS** |
| seo asset | cdn-staging → **ABSENT** · cdn → **ERROR** | cdn → **EXISTS** |

## 2.4 Conclusion — and it changes the severity

1. The 12 objects **exist in production R2, are absent from staging R2**.
2. From a staging page the production CDN **refuses** them — they exist yet error. That is the
   **production CDN rejecting the staging origin**: cross-lane read isolation *actively working*,
   consistent with N8.
3. **This is NOT a data leak.** Staging cannot obtain production assets. The boundary holds.
4. **A host rewrite `cdn.` → `cdn-staging.` would fix nothing** — the objects are not in the staging
   bucket. It would swap a broken production URL for a broken staging URL **and destroy the only
   reproduction of the control blind spot.**

**Remaining severity:** (a) §15 row 1's negative criterion literally fails — an asset *does* resolve to
`cdn.50mmretina.com`; (b) staging-fidelity defect — broken images on 8+ routes; (c) **the structural
point stands: no code-scanning control can see a data-borne reference.**

## 2.5 Proposed correction — NOT APPLIED, awaiting owner decision

| | Option | Consequence |
|---|---|---|
| A | Copy 12 objects to staging R2, then rewrite hosts | Correct. Needs R2 **write** — same capability blocked at B5/4.7b |
| B | Repoint to existing staging assets | Cheap; changes what staging displays |
| **C** | **Null the 5 LIVE keys; leave `ad_slots_backup_20260723` untouched** | **RECOMMENDED** — live production refs → **0**, invents no content, preserves the restore point |
| D | Accept as known staging-fidelity deviation | Zero risk; row 1 stays failing |

**Blast radius of C:** 37 live references across 5 `site_settings` rows. Ads and OG images become
absent on staging. Affects `/discover`, `/competitions`, `/verify`, `/friends`, `/certificates`,
`/help-support`, `/notifications`, `/edit-profile`, `/page/*`. **No code, no tree, no production.**
Reversible from the before-state captured above.

**STATUS: nothing applied. `af03_keys_still_present = 6`, unchanged.**

---

# 3. ROUTE COVERAGE — 46 / 60

All render-asserted (`#root` children > 0 **and** non-trivial text) at ≥5 s.
**Across all 46: production-apex hits 0 · production-Supabase hits 0 · console errors 0.**

**Clean (0 production-CDN):** `/`, `/home`, `/feed`, `/journal`, `/courses`, `/winners`, `/wallet`,
`/dashboard`, `/forgot-password`, `/reset-password`, `/admin` (→`/admin/health`), `/judge`,
`/journal/new`, `/courses/new`, `/courses/:slug`, `/courses/edit/:id`, `/courses/:slug/lessons/:id`,
`/journal/edit/:id`, `/referrals`(→admin), 404 control.

**Renders but carries production-CDN refs (AF-03):** `/discover` (3), `/competitions` (2),
`/certificates` (2), `/verify` (3), `/friends` (3), `/help-support` (3), `/notifications` (2),
`/edit-profile` (3), `/profile` (3), `/photos` (3), `/settings/notifications` (3), `/scheduled-posts` (3),
`/unsubscribe` (3), `/IDverification` (2), `/cookie-policy` (2), `/post/:id` (3), `/profile/:userId` (3),
`/competitions/:id` (3), `/hashtag/:tag` (3), `/page/:slug` (3), `/verify/:token` (3),
`/certificate/:token` (3), `/entry/:entryId` (3), `/competitions/:id/submit` (3),
`/dashboard/submission/:compId` (3), `/qa/watermark-matrix` (3), `/dev/phase7-badges` (3),
`/__crop-test` (3), `/competitions/:id/entry/:entryId/photo/:idx` (3).

## Controls and notable route results

- **404 negative control:** unknown route → `/not-found`, renders (kids 7, len 943) ✓ discriminating
- **Certificate verification — VERIFIED WITH CONTROL:** valid token → verified; **invalid token →
  "invalid/not found", `saysValid: false`** ✓. This is the release's headline feature.
- **`/login` → `/feed` and `/signup` → `/dashboard`** — correct redirects for an authenticated user,
  but **these two routes cannot be tested while signed in → OPEN**
- **AF-04** `/referrals` → `/admin/health` (pre-existing, §1)
- ⚠ **`/IDverification/<nonexistent id>` does not report not-found** — weak negative control, minor finding

**14 routes NOT executed:** `/login`, `/signup` (blocked by session), `/journal/:slug` and
`/ad/:creativeId` (**0 rows on staging — structurally untestable**), `/featured-artist/:slug`,
`/IDverification/:idNumber` (positive case), `/:customUrl`, `/dashboard/submission/:c/entry/:e/photo/:i`,
and 6 admin sub-routes under `/admin/*`.

---

# 4. FUNCTIONAL FLOWS — 6 OF 10 VERIFIED

| # | Flow | Result |
|---|---|---|
| 1 | **Upload** | ✅ **VERIFIED** |
| 2 | **Edit** | ✅ **VERIFIED** |
| 3 | Delete | 🔴 **OPEN / INCONCLUSIVE** |
| 4 | **Comment** | ✅ **VERIFIED** |
| 5 | **Like** | ✅ **VERIFIED** |
| 6 | **Follow** | ✅ **VERIFIED** (run #1) |
| 7 | **Notification** | 🟡 **PARTIAL** — generation verified at scale, delivery OPEN |
| 8 | **Search** | ✅ **VERIFIED** |
| 9 | Profile edit | 🔴 **OPEN** — form confirmed (26 inputs, 1 file input), not exercised |
| 10 | Article path | 🔴 **OPEN — STRUCTURALLY UNTESTABLE**: `journal_articles` = **0 rows** |

## Flow 1 — Upload ✅ (action → expected → actual → evidence)

Created a 240×140 PNG in-page, injected into the composer, selected category *Landscape*, posted.

- **Post `acf65044-…`**, owner = QA admin, content exact, `privacy public`, `is_public true`,
  `categories {landscape}`, `n_images 1`
- **`image_host` = `cdn-staging` ✅**, `post_kind member`
- Edge functions invoked: **`s3-presign-upload`**, **`media-register-upload`** — both staging
- **Production Supabase calls: 0**

**Storage isolation re-proven on a NEW object, 2×2 with controls:**

| Probe | Result |
|---|---|
| Uploaded object on **cdn-staging** | **SERVED 240×140** ✅ (matches the canvas I generated — proves provenance) |
| Same object on **cdn PRODUCTION** | **ERROR** ✅ |
| Absent-path control on cdn-staging | **ERROR** ✅ |

⚠ `thumbnail_url` is **null** — no thumbnail generated for the uploaded post, while pre-existing posts
have `cdn-staging` thumbnails. Recorded as a candidate defect.

⚠ **The image initially appeared blank.** Investigation showed `loaded: true, naturalWidth 240,
loading: "lazy"` — a **lazy-load timing artifact, not a defect.** Correctly not reported as one.

## Flow 5 — Like ✅
Clicked 👍 → `post_reactions` 4→5 (`like by QA-admin` on the test post) **and** denormalised
`posts.likes_count` = 1. Both row and counter.

## Flow 4 — Comment ✅
Typed + Enter → UI shows the comment, 💬 1. DB: `post_comments` 1→2, text exact
(`"G10 QA comment - staging only"`), `posts.comments_count` = 1.
Edge function **`moderate-comment`** invoked — staging.

## Flow 2 — Edit ✅ (and a defect)
⋯ → *Edit caption* → replaced text → **Save** → toast **"Caption updated"**.
DB content = `"G10 QA test post - EDITED by flow 2 verification"` ✓

⚠ **`updated_at` == `created_at`, `updated_after_create = false`.** The edit did **not** bump
`updated_at` — **no audit trail of post modification.** New finding **AF-08**.

## Flow 3 — Delete 🔴 OPEN / INCONCLUSIVE
⋯ → *Move to trash* activated **three times** (coordinate ×3, DOM-targeted ×1). Result each time:
no state change, **no console error**, no confirmation dialog, post still present (`posts` = 17).
`posts` has **no `deleted_at`/`is_deleted` column and no trash table** — suggestive of an incomplete
feature, **but not proof**.

**I cannot separate "Delete is broken" from "my click did not land on the control"** — click-targeting
was a demonstrated confound this session. Recorded **OPEN**, flagged as a **candidate defect for manual
owner confirmation**. Not "FAILING", not "verified".

## Flow 7 — Notification 🟡 PARTIAL, with a scale finding
The single post generated **513 `user_notifications` rows**, type **`new_post_from_following`**,
**513 distinct recipients**. `user_notifications`: **547 → 1060**.
Generation **VERIFIED at scale**. Delivery/display to a recipient **OPEN** (needs another identity).

## Flow 8 — Search ✅
⌘K → typed "Yuki" → returned `@yuki.tanabe / Yuki Tanabe · 0 followers`, with filter tabs
(All/People/Competitions/Courses/Journal/Posts) and keyboard hints. APIs `rest:search_recents`,
`rest:profiles`, `rest:posts`. **Production hits: 0.**

---

# 5. EDGE FUNCTIONS — 4 OF 74 ACTUALLY INVOKED

| Function | Triggered by | Destination | Result |
|---|---|---|---|
| `dashboard-init` | nearly every route | **staging** | ✅ pages render with data |
| `s3-presign-upload` | Flow 1 upload | **staging** | ✅ presign issued, upload succeeded |
| `media-register-upload` | Flow 1 upload | **staging** | ✅ media registered, post created |
| `moderate-comment` | Flow 4 comment | **staging** | ✅ comment accepted |

**Production function-endpoint calls across the entire run: 0.**
**Coverage 4/74 → row 6 stays PARTIAL.** No claim is made for the other 70.

## Staging REST/API surface exercised: 49 distinct endpoints, 100% staging

`profiles, profiles_public_data, profile_stats, posts, post_drafts, post_reactions, post_comments,
post_comment_reactions, post_shares, post_tags, post_hashtags, follows, friendships, user_roles,
user_badges, user_devices, user_notifications, notification_preferences, admin_notifications,
badge_definitions, role_applications, role_display_config, site_settings, activity_logs, categories,
stories, highlights, featured_photos, photo_albums, portfolio_images, certificates, competitions,
competition_entries, competition_votes, competition_round_publish, courses, course_modules,
course_enrollments, lessons, lesson_progress, journal_articles, wallets, wallet_transactions,
wallet_ledger_v2_diff_log, support_tickets, system_flags, judge_scores, judge_decisions,
judging_rounds, scheduled_posts, search_recents, gift_announcements, ad_creatives, ad_impressions,
storage:bucket, auth:user` — **every one on `ztzutckwdhetphwghuzj`. Zero on `jtdtehuqtinjxropkkcn`.**

---

# 6. RLS — BEHAVIOURAL, 3 TIERS, 18 ASSERTIONS, 4 POSITIVE CONTROLS (run #1, preserved)

| Table | TOTAL | anon | member | admin |
|---|---|---|---|---|
| posts | 16 | 16 | 16 | 16 |
| profiles | 513 | **0** | **1** | **513** |
| user_roles | 513 | **0** | **1** | **513** |
| certificates | 3 | **0** | **0** | **3** |
| user_notifications | 546 | 0 | **0** | **513** |
| follows | 513 | 513 | 513 | 513 |
| comments | **0** | 0 | 0 | 0 (**vacuous**) |

**Member 7/7** incl. escalation refused (`new row violates row-level security policy for table
"user_roles"`), with 2 positive controls. **Anon 6/6** incl. escalation refused, 1 positive control.
**Admin 5/5.** Production anon comparison: **permission pattern identical on both lanes**; magnitude
parity OPEN (production reads blocked by the environment classifier — not worked around).

**Row 4 positive half: VERIFIED behaviourally.** Measured, never promoted from the fingerprint match.

---

# 7. SEO / HEADERS

| Check | Result | Status |
|---|---|---|
| `robots.txt` | `Disallow: /` + `# NON-PRODUCTION LANE — NOT FOR INDEXING` | ✅ **VERIFIED** |
| `sitemap.xml` | 0 URLs on staging / **12 on production** — generator is lane-aware | ✅ **N/A by design** |
| Canonical | staging-correct on all 10 routes probed at ≥5 s | ✅ **VERIFIED** |
| Security headers | **10**: CSP, HSTS, `X-Frame-Options: DENY`, nosniff, referrer-policy, permissions-policy, COOP/COEP/CORP, no-store | ✅ **VERIFIED** |
| `og:url` | `https://staging.50mmretina.com/` | ✅ |
| **`og:image` / `twitter:image`** | carry production references (AF-03) | 🔴 **FAILS negative criterion** |
| `<meta robots>` | `index, follow`, no `X-Robots-Tag` | 🟡 **AF-05, pre-existing** |

---

# 8. RESPONSIVE — INSTRUMENT PROVEN NON-FUNCTIONAL (TWICE)

| Requested | `innerWidth` | `innerHeight` | `outerWidth` |
|---|---|---|---|
| 1440×900 | **1536** | 639 | 1536 |
| 820×1100 | **1536** | 639 | 1536 |
| 390×844 | **1536** | 639 | 1536 |

`resize_window` reported **"Successfully resized"** all three times. Independent read of
`window.innerWidth` shows **no change whatsoever** (`devicePixelRatio` 1.25).
Verified twice, in two separate rounds.

**Row 10 breakpoints: OPEN. No CSS or JavaScript simulation was substituted.**
`server.url` negative **VERIFIED from T**. Android `versionCode` **unobtainable — no `android/`
project exists in tree T**.

---

# 9. SECURITY / ISOLATION — PRESERVED AT FULL STRENGTH, PLUS ONE NEW POSITIVE

Not re-run, not downgraded: schema guard **122/122 argument-level**; isolation mutants **21/21**;
staging-lane build on T (run `32976271438`); **N7** 2×2 JWT matrix; **N8** 2×2 object matrix.

**New, from this run:** a freshly uploaded object served from `cdn-staging` and **refused by the
production CDN**, with positive and negative controls on both origins — an independent re-proof of
storage isolation on an object created during the run.

## CONTROL BLIND SPOT (formal record)

> The bundle isolation guard scans **built code**. It cannot detect cross-lane references stored in
> **database rows**. AF-03's 46 production-CDN references sit in `site_settings` and are invisible to
> every R-rule, every mutant, and every CI run. **A data-side scan is required to close this class.**
> Recommended: adopt this run's scanner (all text/varchar/jsonb/ARRAY columns, with a positive control)
> as a standing check.

---

# 10. CHANGE LEDGER — ALL STAGING WRITES, BEFORE → AFTER

| ID | Change | Before | After | Δ | Class |
|---|---|---|---|---|---|
| CHG-G10-001 | PR #102 → staging | — | — | — | ✅ prior |
| CHG-G10-002 | ACL remediation | — | — | — | ✅ prior |
| CHG-G10-003 | PR #103 | — | — | — | 🟡 prepared, unmerged |
| **CHG-G10-004** | Flow 6 friend request | 0 | 1 | **+1** | INTENDED — evidence, retained |
| **CHG-G10-005** | **Story (UNINTENDED)** | 0 | 1 | **+1** | ⚠ **UNINTENDED** — auto-expires 2026-08-28 05:19 UTC |
| **CHG-G10-006** | Flow 1 test post | 16 | 17 | **+1** | INTENDED — retained (delete inconclusive) |
| **CHG-G10-007** | Flow 5 like | 4 | 5 | **+1** | INTENDED |
| **CHG-G10-008** | Flow 4 comment | 1 | 2 | **+1** | INTENDED |
| **CHG-G10-009** | **Notification fan-out** | 547 | **1060** | **+513** | INTENDED consequence of CHG-006 |
| — | AF-03 site_settings | 6 keys | **6 keys** | **0** | ✅ **nothing applied** |

**CHG-G10-005 disclosure:** while injecting the upload test file, the file landed in the page's
**Story** input rather than the composer's (the composer input is the *second* on the page). A Story
was created. Detected immediately from the "Story added!" toast, verified in the DB, and reported
rather than hidden. It **self-expires within 24 h**. It also yielded the first proof that the upload
pipeline writes to the staging bucket.

**All RLS write tests were rolled back and left zero residue. No production row was written at any point.**

Incidental: a click toggled the UI to **dark mode** — per-viewer cosmetic state, no data change.

---

# 11. AUDIT FINDINGS

| ID | Finding | Class | Status |
|---|---|---|---|
| AF-01 | Runbook described 4.3 as one-file; earlier audit accepted it unverified | process | recorded |
| AF-02 | §17-4 production-lane run is structurally Phase-8-only | structural | recorded |
| **AF-03** | 46 production-CDN refs in staging `site_settings`; row 1 negative criterion fails; **control blind spot** | **data / control gap** | **OPEN — owner decision** |
| **AF-04** | `/referrals` → `/admin/health` | product | **PRE-EXISTING — deferred** |
| **AF-05** | `<meta robots> index, follow` not lane-aware; no `X-Robots-Tag` | SEO | **PRE-EXISTING — deferred** |
| **AF-06** | Empty staging sitemap | — | **RESOLVED — by design** |
| **AF-07** | Duplicate SEO meta blocks | SEO | **PRE-EXISTING — deferred** |
| **AF-08** | **Post edit does not bump `updated_at`** — no modification audit trail | data integrity | **NEW — OPEN** |
| **AF-09** | Uploaded post gets **no thumbnail** (`thumbnail_url` null) | media pipeline | **NEW — OPEN** |
| **AF-10** | "Move to trash" produced no effect in 3 attempts; no soft-delete column exists | product | **NEW — INCONCLUSIVE** |
| **AF-11** | `/IDverification/<bad id>` does not report not-found | product | **NEW — minor** |

---

# 12. FALSE-GREEN AUDIT — EVERY INSTRUMENT PROVEN OR DISCARDED

| Instrument | Proof it measured the intended condition | Verdict |
|---|---|---|
| Console capture | Injected live `console.error` **and** thrown `TypeError`; both captured | ✅ **PROVEN** — pre-arming reads discarded |
| Route rendering | Unknown route → `/not-found` renders; distinguishes rendered vs blank | ✅ **PROVEN** |
| DB verification | Every write confirmed by row count **and** content match; 4 RLS positive controls | ✅ **PROVEN** |
| R2 / object existence | Positive + negative control on **both** origins; uploaded object's dimensions matched the canvas | ✅ **PROVEN** (first attempt **DISCARDED** — no discriminating power) |
| Certificate verification | Valid token → verified; **invalid token → invalid** | ✅ **PROVEN** |
| Cross-lane API | 49 endpoints classified by host; production counter present and read 0 | ✅ **PROVEN** |
| Canonical / meta | Async injection found at 5 s but absent at 2.5 s | ⚠ **CORRECTED** — all re-taken at ≥5 s |
| **Viewport resize** | Reported success ×3; `innerWidth` unchanged ×3, verified twice | ❌ **FAILED — evidence discarded, criterion OPEN** |
| Delete activation | Cannot distinguish broken feature from click miss | ❌ **INCONCLUSIVE — recorded OPEN** |
| CI / mutants / schema guard | Not re-run; prior evidence preserved unchanged | ✅ preserved |

---

# 13. §15 MATRIX — CURRENT

| # | Area | Status | Basis |
|---|---|---|---|
| 1 | UI | 🔴 **FAILING** | AF-03: assets resolve to `cdn.50mmretina.com` on 29 routes. 46/60 routes render, 0 console errors, 0 prod-apex, 0 prod-Supabase |
| 2 | Functional flows | 🟡 **PARTIAL** | 6/10 verified end-to-end with DB confirmation |
| 3 | Authentication | 🟡 **PARTIAL** | staging ownership + admin authz VERIFIED; sign-in/refresh/sign-out OPEN; reset structurally untestable |
| 4 | Database / RLS | ✅ **VERIFIED** | 18 behavioural assertions, 3 tiers, 4 positive controls, 2 escalations refused |
| 5 | Storage / R2 | 🟡 **PARTIAL** | upload → staging bucket → cdn-staging **VERIFIED** with 2×2 controls; **production object count OPEN**; raw R2 write-refusal **BLOCKED (B5)** |
| 6 | Edge Functions | 🟡 **PARTIAL** | 4/74 invoked, all staging, 0 production |
| 7 | Security / isolation | ✅ **VERIFIED** | preserved at full strength + new object-level re-proof |
| 8 | SEO / headers | 🟡 **PARTIAL** | robots/canonical/headers VERIFIED; sitemap N/A by design; og:image FAILS |
| 9 | Email | ✅ **VERIFIED (vacuous)** | no send path; preserved |
| 10 | Responsive / mobile | 🟡 **PARTIAL** | `server.url` VERIFIED; breakpoints **OPEN (instrument)**; versionCode unobtainable |
| 11 | Regression | 🟡 **PARTIAL** | §18 dependency retained |
| 12 | Cross-lane | 🟡 **PARTIAL** | N3–N8 preserved; **N1/N2 OPEN (B6)** |

**3 VERIFIED · 7 PARTIAL · 1 FAILING · 1 VERIFIED-vacuous · 0 blank**

---

# 14. BLOCKERS

| # | Blocker | Status | Resolver / evidence required |
|---|---|---|---|
| B1 | Routes + flows | 🟡 **PARTIAL** | 14 routes, 4 flows remain |
| B2 | Auth positives | 🔴 OPEN | anonymous session needed for `/login`, `/signup` |
| **B3** | **RLS behaviour** | ✅ **CLOSED** | this run |
| B4 | Production object count | 🔴 OPEN | count production R2 objects before/after |
| B5 | 4.7b R2 write refusal | 🔴 **BLOCKED** | **OWNER** — two scoped R2 tokens + object-level tooling |
| B6 | N1/N2 | 🔴 **OWNER ACTION** | dispatch `apply-migration.yml` ×2 mismatched → 2 run IDs + refusal text |
| B7 | §5.3 re-test | 🔴 **OWNER ACTION** | push scratch branch → run ID + literal EMPTY log line |
| B8 | D-2 migrations | 🔴 **OWNER ACTION** | rename 4 `UNAPPLIED_` files, or written acceptance |
| B9 | D-3 staging deployment ID | 🔴 OPEN | identify or rule N/A |
| B10 | Android versionCode | 🔴 **OWNER ACTION** | **not in the tree** — read from the store/build |
| B11 | DB rollback binding | 🔴 **OWNER ACTION** | bind the 5 rollback SQL files to the RC |
| B12 | Ledger closure | 🔴 **OWNER ACTION** | after CHG-003 |
| B13 | §14 countersignature | 🔴 **OWNER ACTION** | countersign G9 EXCLUDED |
| **B14** | **AF-03 decision** | 🔴 **OWNER ACTION** | choose A/B/**C**/D — mapping ready |
| B15 | AF-04 | ✅ **CLOSED** | pre-existing → deferred |
| B16 | AF-05/06/07 | 🟡 **PARTIAL** | AF-06 resolved; 05/07 pre-existing → deferred |
| B17 | Viewport instrument | 🔴 **OWNER ACTION** | un-maximise Chrome, or device emulation |
| B18 | Test-data residue | 🔴 **OWNER ACTION** | 5 rows + 513 notifications — retain or purge |
| **B19** | **AF-08 / AF-09 / AF-10** | 🔴 **NEW** | triage `updated_at`, thumbnail, trash |
| **B20** | **Production admin session in QA browser** | 🔴 **OWNER ACTION** | sign out before further write QA |

---

*No secret, token, cookie or session value requested, displayed or recorded.
`main` = `b671e1f` · T = `e2e05fb` · PR #103 unmerged · production unwritten · **RC NOT APPROVED**.*
