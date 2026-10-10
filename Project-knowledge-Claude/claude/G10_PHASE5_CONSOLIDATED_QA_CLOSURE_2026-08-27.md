# G10 PHASE 5 — CONSOLIDATED QA CLOSURE

**Read-only round completed 2026-08-27 ~06:15–06:45 UTC. ZERO staging writes.**
**`main` = `b671e1f` · T = `e2e05fb` · PR #103 unmerged · production unwritten ·
AF-03 NOT applied (`af03_keys_still_present = 6`) · RC NOT APPROVED.**

Write gate verified before starting: production origin returned `role: "authenticated"` →
**session still active → no staging write performed.**

---

# 1. ROUTES — 55 EXECUTED / 2 BLOCKED / 3 RECLASSIFIED

| Class | Count | Detail |
|---|---|---|
| **Executed & rendered** | **55** | render-asserted at ≥5 s; **prod-apex 0 · prod-Supabase 0 · console errors 0** across all |
| **Blocked** | **2** | `/login`, `/signup` |
| **Inventory correction** | — | `/admin/*` is **one route pattern**, tab-driven (~30 tabs → paths); 5 exercised |

**`/login` and `/signup` — final determination.** Both redirect (`→ /feed`, `→ /dashboard`) while a
session exists. A genuinely anonymous context requires either signing out (destroys the owner's
session — not permitted) or a **separate browser profile**. The toolset exposes no incognito/private
context. **Recorded OPEN once; not retried.** Resolvable as a side-effect of B20 if a third profile is used.

**Structurally untestable (data absent), tested as negative cases instead:**
`/journal/:slug` — 0 `journal_articles`; **correctly reports not-found** ✅
`/ad/:creativeId` — 0 `ad_creatives`; **renders without reporting not-found** ⚠ (AF-11)

---

# 2. FLOWS — 7 VERIFIED / 3 BLOCKED ON B20

| # | Flow | Status | Evidence |
|---|---|---|---|
| 1 | Upload | ✅ **VERIFIED** | post `acf65044…`, `image_host = cdn-staging`, 2×2 CDN controls |
| 2 | Edit | ✅ **VERIFIED** | toast "Caption updated"; DB content changed |
| 3 | Delete | 🔴 **BLOCKED (B20)** — root cause known | see §4 |
| 4 | Comment | ✅ **VERIFIED** | `post_comments` 1→2, exact text, counter |
| 5 | Like | ✅ **VERIFIED** | `post_reactions` 4→5 + `likes_count` |
| 6 | Follow | ✅ **VERIFIED** | `friendships` +1 pending, UI "Sent" |
| 7 | **Notification** | ✅ **VERIFIED** (upgraded) | **generation**: 513 rows, `new_post_from_following`, 513 recipients · **display**: heading "Notifications/New", item *"A member started following you"*, **18 "Follow back" buttons**, badge 99+, RPCs `get_my_notifications_grouped` + `get_my_unread_notifications_grouped` |
| 8 | Search | ✅ **VERIFIED** | `@yuki.tanabe` returned, filter tabs, `search_recents` |
| 9 | Profile edit | 🔴 **BLOCKED (B20)** | form confirmed: 26 inputs, 1 file input; submit requires a write |
| 10 | Article path | 🔴 **STRUCTURALLY UNTESTABLE** | `journal_articles` = 0 |

⚠ **Flow 7 caveat:** delivery to the *specific* recipient of my post was observed at DB level (513 rows),
not inside that user's session. The display mechanism itself is proven with real data in the admin's own
list. Recorded as such, not inflated.

⚠ **Method note:** an initial probe reported `itemLikeCount: 0` on `/notifications`. That was a
**selector artifact** (items are not `<li>` and carry no "notification" class). I declined to conclude
"empty" from it and re-probed via headings/buttons, which found the populated list.

---

# 3. EDGE FUNCTIONS — 5 / 74 ACTUALLY INVOKED (NOT INFLATED)

| Function | Trigger | Lane |
|---|---|---|
| `dashboard-init` | nearly every route | staging |
| `s3-presign-upload` | Flow 1 | staging |
| `media-register-upload` | Flow 1 | staging |
| `moderate-comment` | Flow 4 | staging |
| **`get-wallet-summary`** | **`/wallet` (NEW, read-only)** | **staging** |

**Production function-endpoint calls across all rounds: 0.**

## Reachability classification of all 74 (tree T: `supabase/functions/*` = 74 + `_shared`)

| Class | Count | Basis |
|---|---|---|
| **VERIFIED (invoked)** | **5** | above |
| **Write-flow only — blocked by B20** | ~28 | judging (`submit-judge-*`, `cast-photo-vote`, `complete-round`, `publish-round`, `evaluate-round2`, `entry-final-votes`), media (`s3-upload`, `s3-delete`, `media-verify-upload`, `migrate-*`), notifications (`send-push`, `send-broadcast-push`, `manage-notifications`), account (`delete-my-account`, `delete-user`), gifts/credits |
| **POLICY-PROHIBITED — will not be tested** | **5** | `create-payment-session`, `paypal-capture-order`, `razorpay-verify-payment`, `submit-deposit`, `admin-process-withdrawal`. `/wallet` exposes "Add Money"/"Withdraw"; **executing a financial transaction is outside what this session will do at any approval level** |
| **Cron / scheduled / webhook — browser-unreachable** | 9 | `apply-scheduled-boosts`, `backfill-image-dims`, `backfill-image-hashes`, `backfill-media-objects`, **`backfill-thumbnails`**, `brevo-webhook`, `process-email-queue`, `publish-scheduled-posts`, `send-reengagement-emails` |
| **Email — no staging send path (row 9 vacuous)** | 8 | `auth-email-hook`, `handle-email-suppression`, `handle-email-unsubscribe`, `preview-transactional-email`, `send-transactional-email`, `verify-email-provider`, +2 above |
| **Admin/ops, data-dependent or server-side** | ~19 | `admin-export-db`, `admin-secure-settings`, `ga-report`, `purge-s3-orphans`, `detect-orphan-files`, `seo-*`, `sitemap`, `rank-feed`, `ask-anything`, `translate-text`, … |

`rank-feed` did **not** fire on `/feed` or `/discover` even under repeated infinite-scroll — either
server-side or unused by the current feed implementation. **Not claimed as covered.**

---

# 4. AF-08 → AF-12 FINAL CLASSIFICATIONS

## AF-08 — `updated_at` — **PRE-EXISTING / DEFERRED to G11**

| Question | Answer |
|---|---|
| **Author edit → timestamp** | `NEW.updated_at := now()` **is** executed. Correct. |
| **Admin edit → timestamp** | Trigger hits `IF has_role(admin) THEN RETURN NEW;` and **returns before** the stamp. **Never set.** |
| **Trigger identity prod vs staging** | **BYTE-IDENTICAL** — md5 `894a93636fcec55549f8bb6859b88014`, length 1255, stamp at offset 1174, both lanes |
| **T involvement** | **NONE.** The trigger lives in the database, not the tree. T neither adds nor modifies it. |

**Secondary observation:** the admin branch also bypasses **all** column-change validation, so an admin
may alter `image_url`, `privacy`, `created_at`, `content_hash`. Presumably intentional override —
undocumented and unlogged. Raised for G11, **not a G10 blocker.**

## AF-09 — missing thumbnail — **NOT A DEFECT. CLOSED.**

| Lane | posts | with image | `thumbnail_url` populated | missing |
|---|---|---|---|---|
| **Production** | 288 | 288 | **0** | **100 %** |
| Staging | 17 | 17 | 12 | 29 % |

**Production populates `thumbnail_url` on ZERO of 288 posts.** Staging has *more* thumbnails than
production, not fewer. My uploaded post's null `thumbnail_url` **matches production's universal
behaviour exactly.**

**Mechanism identified:** tree T contains a dedicated **`backfill-thumbnails`** edge function — thumbnails
are produced by a **batch backfill job, not by the upload path**. Staging's 12 populated rows are the
residue of a backfill run; production has never run one.

**Verdict: expected behaviour, pre-existing, not candidate-specific, not a media-pipeline defect.**
The original observation ("uploaded post has no thumbnail") was correct but the inference "defect" was
wrong — corrected by production comparison.

## AF-10 — "Move to trash" inert — **PRE-EXISTING / G11. CLOSED, no further clicking.**

Chain: `PostDetail.tsx` → `<PostCard>` **without `onDelete`** → `handleDelete()` → `onDelete?.(post.id)`
→ **`undefined` → silent no-op.** `Feed.tsx` and `WallPosts.tsx` **do** pass it.

| File | T vs main |
|---|---|
| `src/components/post/PostCard.tsx` | **IDENTICAL** (md5 `664910914edb234391341870ebce9eae`, 830 lines) |
| `src/pages/PostDetail.tsx` | **IDENTICAL** |
| `src/pages/Feed.tsx` | **IDENTICAL** |
| `src/components/WallPosts.tsx` | **IDENTICAL** |

Database layer is healthy: BEFORE DELETE trigger present; RLS test AD3 proved admin hard-delete returns
1 row. **Delete works from Feed/WallPosts; it is inert on PostDetail only.**

## AF-11 — inconsistent not-found handling — **PRE-EXISTING**

`/journal/<bad slug>` ✅ reports not-found · `/ad/<bad id>` ❌ does not · `/IDverification/<bad id>` ❌ does not.
`AdDetail.tsx`, `IDVerification.tsx`, `JournalArticle.tsx` all **IDENTICAL T vs main**. Minor. G11.

## AF-12 — "Move to trash" is an irreversible hard DELETE — **PRE-EXISTING. Data-loss hazard.**

**There is no trash anywhere in the system:**
- no `deleted_at` / `is_deleted` column on `posts`
- no trash table (`%trash%` → 0)
- no trash/soft-delete/archive RPC (`%trash%`, `%soft_delete%`, `%delete_post%`, `%remove_post%`, `%archive%` → 0)
- **`deleted_at` appears 0 times in the entire 1.5 MB client bundle**

The only implementation is `from("posts").delete().eq("id",…).eq("user_id",…)` — a **permanent delete**,
with **no confirmation dialog** in either bundle or source.

**A control labelled "Move to trash" that irreversibly destroys a post with no confirmation and no
recovery path is a genuine data-loss hazard.** Pre-existing (`PostCard.tsx` identical T vs main).
**Recorded for G11; not a G10 blocker.**

> **Every one of AF-04, 05, 07, 08, 09, 10, 11, 12 is PRE-EXISTING. T caused none of them.
> No candidate rebuild is warranted on any finding to date.**

---

# 5. AF-03 — COMPLETE REMEDIATION MATRIX (NO WRITE PERFORMED)

All **46** references reconciled exactly: 41 string leaves, 5 extra occurrences inside multi-reference
`json_ld` blobs.

| Key | Exact JSON path | Reference type | Live/Backup | Why it breaks staging | Safe remediation |
|---|---|---|---|---|---|
| `ad_slots` | `$[0..8].image_url` (9) | **Advertisement** | **LIVE** | 9 ad creatives absent from staging R2 → broken ad images site-wide | **C** defensible — ads are not a §15 criterion |
| `ad_slots_backup_20260723` | `$[0..8].image_url` (9) | **Advertisement** | **BACKUP** | Not rendered — restore point only | **LEAVE UNTOUCHED** in all options |
| `ad_zones_v2` | `$.sidebar.own.image_url`, `$.lightbox.own.image_url`, `$.rewarded.own.image_url` (3) | **Advertisement** | **LIVE** | Zone ads broken; this is the `/discover` "Ad - Sidebar" failure | **C** defensible |
| `managed_pages` | `$[0..5].og_image` (6) | **SEO: OG image** | **LIVE** | `og:image` per managed page points at production | **D** — nulling fakes row 8 |
| `managed_pages` | `$[0..5].json_ld` (**11**) | **SEO: JSON-LD structured data** | **LIVE** | schema.org payloads embed production image URLs; **search engines read these** | **D** — nulling removes structured data entirely |
| `seo_pages` | `$[0..6].og_image` (7) | **SEO: OG image** | **LIVE** | per-route OG image → production | **D** |
| `seo_global` | `$.default_og_image` (1) | **SEO: site-wide OG default** | **LIVE** | every route without a specific OG image falls back to a production URL | **D** |

**Total: 9 + 9 + 3 + 6 + 11 + 7 + 1 = 46 ✓**

## Category split (as requested)

| Category | Refs | Affects rendered staging UI? | Affects SEO metadata? |
|---|---|---|---|
| **Advertisements (live)** | **12** | **YES** — broken ad images on 29 routes | no |
| **SEO OG images** | **14** | no (meta only) | **YES** — row 8 negative criterion |
| **SEO JSON-LD structured data** | **11** | no | **YES** — structured data |
| **Site logo / page body** (`managed_pages[0].og_image` = `portfolio-images/site_logo`) | included above | **YES** — `/page/about-us` renders 18 images, exactly **1 broken** = the logo | — |
| **Backup only** | **9** | **NO** | **NO** |

## Managed-page slug map

| idx | slug | og_image prod? | json_ld prod? |
|---|---|---|---|
| 0 | `about-us` | ✅ | ✅ |
| 1 | `refund-policy` | ✅ | ✅ (×2) |
| 2 | `terms-of-service` | ✅ | ✅ (×2) — ⚠ **`json_ld` contains a raw `<script>` tag** rather than bare JSON |
| 3 | `privacy-policy` | ✅ | ✅ (×2) |
| 4 | `contact-us` | ✅ | ✅ (×2) |
| 5 | `community-guidelines` | ✅ | ✅ (×2) |
| 6 | `brand-ownership` | **clean** | **clean** |

**`brand-ownership` proves the schema does not require these fields** — a managed page can exist with
neither `og_image` nor a production reference. That is the precedent for Option C on SEO keys, and also
shows what "nulled" would look like in practice.

## Findings that bear on the decision

1. **Staging has no legitimate placeholder** for any of the 12 objects — no staging default OG image, no
   placeholder ad creative. `cdn-staging` holds 51 `portfolio_images` and seeded post media, none of the
   same role.
2. **Option C on SEO keys converts a visible failure into a vacuous pass** — an absent `og:image` cannot
   demonstrate §15 row 8's *"generated from staging values"*. That is the anti-pattern this gate exists to catch.
3. **`json_ld` is a category I under-counted earlier** (11 of the 46). Nulling it removes structured data
   from six legal/policy pages entirely — a larger change than "removing an image".
4. **Only Option A makes rows 1 and 8 honest passes**, and it requires **B5's R2 write capability**.

## Recommendation (unchanged from last round, now fully evidenced)

- `seo_global`, `seo_pages`, `managed_pages` (og_image **and** json_ld) → **OPTION D — accept and record**
- `ad_slots`, `ad_zones_v2` → **OPTION C defensible** (12 refs, cosmetic gain only)
- `ad_slots_backup_20260723` → **untouched in every option**
- **OPTION A is the only path to honest passes on rows 1 and 8** — gated on B5

**NO ROW CHANGED. `af03_keys_still_present = 6`. Awaiting B14.**

---

# 6. HEADLINE RELEASE-CONTENT EVIDENCE (separate from §15)

## 6.1 Admin pagination — `admin_search_users_v2`
- RPC invoked live on `/admin/users`; **re-fires on every page change**
- Paging: `Prev | 1 2 3 4 5 6 | Next`, "of 6"
- **Page 6 = "13 users found"** · **513 = 5 × 100 + 13** — all 513 pageable
- Role filters vs DB ground truth: **⚖ Judge 4 = 4 ✅ · ✎ Editor 1 = 1 ✅ · 🛡 Admin 1 = 1 ✅**
- These are **exactly the three filters that returned 0 under v1**
- Controls: `All` → 100 (page 1 of 6) ✅ · `🎓 Student` (0 holders) → no count ✅
- ⚠ Two earlier attempts **discarded**: one never clicked while reporting a stale number, one hit
  sidebar items and navigated away. Only exact emoji-prefixed labels activated the filters.

## 6.2 Certificates
- `/verify/<valid token>` → **verified** ✅
- `/verify/<invalid token>` → **invalid, `saysValid: false`** ✅ **discriminating negative control**
- `/certificate/<valid token>` → verified ✅
- `/admin/certificates` → renders, invokes **`admin_list_certificates`**, 0 production calls ✅

## 6.3 Schema-dependency guard
**122/122 argument-level, 0 name-only, exit 0.** Preserved, not re-run, not downgraded.

**All three headline features of RC-20260826-01 now carry behavioural evidence.**

---

# 7. §15 MATRIX

| # | Area | Status | Basis |
|---|---|---|---|
| 1 | UI | 🔴 **FAILING** | 55/60 routes clean of prod-apex/prod-Supabase/console errors, but AF-03: assets resolve to `cdn.50mmretina.com` on 29 routes |
| 2 | Functional flows | 🟡 **PARTIAL** | **7/10 VERIFIED**; 2 blocked on B20; 1 structurally untestable |
| 3 | Authentication | 🟡 **PARTIAL** | staging ownership + admin authz VERIFIED; `/login`,`/signup` OPEN; reset structurally untestable |
| 4 | Database / RLS | ✅ **VERIFIED** | 18 assertions, 3 tiers, 4 positive controls, 2 escalations refused |
| 5 | Storage / R2 | 🟡 **PARTIAL** | upload → staging bucket → cdn-staging VERIFIED with 2×2 controls; prod object count OPEN; raw write-refusal **BLOCKED (B5)** |
| 6 | Edge Functions | 🟡 **PARTIAL** | **5/74** invoked, all staging, 0 production |
| 7 | Security / isolation | ✅ **VERIFIED** | 122/122 · 21/21 · N7 · N8 · + new object-level re-proof |
| 8 | SEO / headers | 🟡 **PARTIAL** | robots/canonical/10 headers VERIFIED; sitemap N/A by design; **og:image + json_ld FAIL** |
| 9 | Email | ✅ **VERIFIED (vacuous)** | no send path; 8 email functions unreachable |
| 10 | Responsive | 🟡 **PARTIAL** | `server.url` VERIFIED from T; breakpoints **BLOCKED (B17)**; versionCode not in tree |
| 11 | Regression | 🟡 **PARTIAL** | §18 dependency retained |
| 12 | Cross-lane | 🟡 **PARTIAL** | N3–N8 preserved; **N1/N2 OPEN (B6)** |

**3 VERIFIED · 7 PARTIAL · 1 FAILING · 1 VERIFIED-vacuous · 0 blank**

**B17 final:** `resize_window` returned success on three requests across two independent rounds while
`innerWidth` stayed **1536** every time. No emulation capability exists in this toolset.
**No functioning viewport instrument available; breakpoint criterion remains OPEN. No CSS substitution made.**

---

# 8. OWNER EXECUTION SHEET

| Blocker | Your exact action | Evidence to return | Parallel? |
|---|---|---|---|
| **B20** | Sign out of production in that Chrome profile, or move production to its own profile. A **third** profile would also unblock `/login`+`/signup`. | Say "done" — I re-verify by reading `role` on the production origin | ✅ **DO FIRST** |
| **B14** | Decide AF-03 per §5: D for SEO keys, C-or-D for ads, backup untouched. | One line per key group | ✅ |
| **B6** | Dispatch `apply-migration.yml` twice with mismatched target vs URL (prod-URL/staging-target, then the reverse). | 2 run IDs + verbatim refusal text from each | ✅ |
| **B7** | Push `scratch/g10-53-secret-isolation-20260826`, let CI finish, delete the branch. | Run ID + the literal log line showing the secret resolved EMPTY | ✅ |
| **B8** | Rename the 4 `UNAPPLIED_*.sql` files, or accept in writing. | Commit SHA of the rename, **or** signed one-line acceptance naming all 4 | ✅ |
| **B5** | Create 2 bucket-scoped R2 tokens (staging-only, production-only). Also the only path to AF-03 Option A. | Confirmation both exist + their scopes. **Never the token values.** | ✅ |
| **B10** | Read production Android `versionCode` from the Play listing or build output — **it is not in tree T**. | The integer + where you read it | ✅ |
| **B11** | Declare the 5 rollback SQL files to be the DB rollback for RC-20260826-01. | The 5 filenames + one-line statement | ✅ |
| **B12** | Close the Change Ledger once CHG-003 lands. | Signed closure naming CHG-001…009; CHG-005 flagged UNINTENDED | ❌ after B8/PR103 |
| **B13** | Countersign the §14 G9 EXCLUDED ruling. | Signature + date | ✅ |
| **B17** | Un-maximise the Chrome window, or confirm no emulation is available. | Say "done" — I re-verify `innerWidth` before testing | ✅ |
| **B18** | Keep or purge test data: 1 story (auto-expires today), 1 post, 1 like, 1 comment, 1 friendship, 513 notifications. | "keep" or "purge" | ✅ |

**After B20 only:** Flow 3 (delete, from **Feed** where `onDelete` is wired), Flow 9 (profile edit), and
the ~28 write-flow edge functions become executable. The 5 payment functions remain **out of scope at
any approval level.**

---

*No secret, token, cookie or session value requested, displayed or recorded.
Zero staging writes this round. RC **NOT APPROVED**. Phase 7 not started.*
