# G10 PHASE 5 — QA RUN #3 · ROOT-CAUSE TRIAGE + RELEASE-FEATURE VERIFICATION

**Executed 2026-08-27, ~05:45–06:15 UTC.** Read-only throughout — **zero staging writes this round.**

**FREEZE INTACT — `main` = `b671e1f` · T = `e2e05fb` · PR #103 unmerged · production unwritten ·
AF-03 NOT applied (`af03_keys_still_present = 6`) · RC NOT APPROVED.**

---

# 0. WRITE GATE — ENFORCED, NOT JUST RESTATED

Per instruction 10, the production session was **verified before any further write flow**:

```
lane: PRODUCTION   role: "authenticated"   → PRODUCTION SESSION STILL ACTIVE
```

**The gate therefore held: no staging write flow was performed this round.** Everything below is
read-only — navigation, DOM/bundle inspection, git comparison, and read-only SQL.

Consequences: Flow 9 (profile edit), Flow 3 (delete execution) and Flow 7 (notification delivery)
**remain OPEN**, blocked on **B20**, not on any technical obstacle.

---

# 1. RELEASE-FEATURE VERIFICATION — THE STRONGEST EVIDENCE IN G10 SO FAR

RC-20260826-01 is *"Certificates, admin pagination, schema-dependency guard"*. Until now nothing had
verified the **actual product content** of the release. This round did.

## 1.1 Admin user pagination — VERIFIED against database ground truth

`/admin/users` invokes **`rpc/admin_search_users_v2`** live.

**Paging:** controls render `Prev | 1 2 3 4 5 6 | Next`, "of 6". Clicking page 6 **re-invoked
`admin_search_users_v2`** and the result set changed (page text 8387 → 1765 chars).
Page 6 reports **"13 users found"**.

> **513 profiles = 5 × 100 + 13.** The arithmetic closes: all 513 users are pageable.
> Under v1 the list was capped at `LIMIT 100` — a single page.

**Role filters — the exact v1 defect, now correct:**

| Filter chip | DB ground truth | UI result | v1 behaviour (recorded 2026-08-24) |
|---|---|---|---|
| `⚖ Judge` | 4 | **4** ✅ | **0 visible of 4** |
| `✎ Editor` | 1 | **1** ✅ | **0 visible of 1** |
| `🛡 Admin` | 1 | **1** ✅ | **0 visible of 1** |
| `All` (positive control) | 513 | **100** (page 1 of 6) ✅ | 100 (capped, no paging) |
| `🎓 Student` (negative control) | 0 holders | no count rendered ✅ | — |

**All three role filters that returned nothing under v1 now return counts matching the database
exactly.** This is behavioural verification of the migration's stated purpose, through the UI,
against ground truth, with positive and negative controls.

⚠ **Method note:** two earlier attempts at this test were **discarded**. The first matched buttons by
exact text and did not click (`clicked: false`) while still reporting a stale "13". The second matched
by substring and hit sidebar items ("Judge Monitor", "Editorial"), navigating away. Only the third —
exact emoji-prefixed labels — actually activated the filters. **The first two results were thrown out,
not reported.**

## 1.2 Certificates — VERIFIED, with a negative control

| Surface | Evidence |
|---|---|
| `/verify/:token` valid token | renders, **"verified"** ✅ |
| `/verify/<invalid token>` | **"invalid / not found", `saysValid: false`** ✅ **discriminating** |
| `/certificate/:token` | renders, verified ✅ |
| `/admin/certificates` | renders, invokes **`rpc/admin_list_certificates`**, 0 production calls ✅ |

## 1.3 Schema-dependency guard
Preserved from earlier: **122/122 argument-level, 0 name-only, exit 0.** Not re-run, not downgraded.

**All three headline features of RC-20260826-01 now have behavioural evidence.**

---

# 2. AF-08 — ROOT-CAUSED, RECLASSIFIED, PRE-EXISTING

My run-#2 framing ("post edits don't bump `updated_at`") was **too broad**. Tracing corrected it.

`posts` carries **10 triggers**; **none** is a generic `set_updated_at`/`moddatetime`. The relevant one
is `trg_enforce_post_caption_only_update`:

```sql
IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;                  -- ← ADMIN RETURNS EARLY. updated_at NEVER STAMPED.
END IF;
IF auth.uid() = OLD.user_id THEN
    ... column-change validation ...
    NEW.updated_at := now();     -- ← ONLY the author branch stamps it
    RETURN NEW;
END IF;
```

**Corrected finding:** `updated_at` **is** stamped for author edits. It is **not** stamped for **admin**
edits, because the admin branch returns before reaching it. I edited as admin, hence the flat timestamp.

**This is worse than a missing timestamp in one respect:** the actor whose edits most need an audit
trail — an administrator editing another user's content — is precisely the actor who leaves none. The
admin branch also bypasses **all** column-change validation (`image_url`, `privacy`, `created_at`,
`content_hash` are all mutable by an admin). That is presumably intentional override, but it is
undocumented and unlogged.

## Production comparison — BYTE-IDENTICAL

| Lane | md5 of `pg_get_functiondef` | length | `NEW.updated_at := now()` offset |
|---|---|---|---|
| **staging** | `894a93636fcec55549f8bb6859b88014` | 1255 | 1174 |
| **production** | `894a93636fcec55549f8bb6859b88014` | 1255 | 1174 |

**AF-08 = PRE-EXISTING. Database-layer, not application-layer. Not candidate-specific. T untouched.**
Defer to G11.

---

# 3. AF-09 — RESOLVED, PRE-EXISTING PATTERN, NOT A DEFECT OF THIS UPLOAD

| Measure | Value |
|---|---|
| posts total | 17 |
| posts with an image | 17 |
| posts **with** `thumbnail_url` | 12 |
| posts with image but **no** thumbnail | **5** |
| of those, **created before today** | **4** |

**4 of the 16 pre-existing staging posts (25%) already had an image and no thumbnail.** My uploaded post
is the fifth instance of an existing pattern, not a new failure. `thumbnail_url` is nullable with no
default, and the caption trigger explicitly protects it from author edits — consistent with it being
populated asynchronously by the media pipeline for some paths only.

**AF-09 → PRE-EXISTING PATTERN. Not a G10 blocker.** Worth an owner note (why do ~25% of posts lack
thumbnails?), not a release gate.

---

# 4. AF-10 — FULLY ROOT-CAUSED. NOT A BROKEN FEATURE — A MISSING PROP.

Traced through four independent layers rather than by repeated clicking.

## 4.1 Database layer — DELETE works
- `trg_posts_unsync_hashtags` **BEFORE DELETE** trigger exists → hard DELETE is a supported operation
- RLS test **AD3** (run #1): admin DELETE of another user's post → **1 row**. Admin delete works.
- **No** `deleted_at` / `is_deleted` column · **no** trash table · **no** trash/soft-delete/archive RPC
  (searched `%trash%`, `%soft_delete%`, `%delete_post%`, `%remove_post%`, `%archive%` → **0 results**)

## 4.2 Client bundle — delete code exists, `deleted_at` does not
1.5 MB bundle: `.delete()` ×21 · `from("posts")` ×5 · **`deleted_at` ×0** · `trash` ×2.
A real delete path exists:
```js
from("posts").delete().eq("id",ee).eq("user_id",r.id); if(ye) ve({title:"Failed to delete", …})
```

## 4.3 Source — the handler is wired but delegates to an OPTIONAL prop

`src/components/post/PostCard.tsx`:
```jsx
<DropdownMenuItem onClick={handleDelete} disabled={actionLoading} …>
  <Trash2 /> Move to trash
</DropdownMenuItem>
```
```js
const handleDelete = async () => {
  if (!currentUserId) return;
  setActionLoading(true);
  onDelete?.(post.id);      // ← OPTIONAL CHAINING. No prop ⇒ silent no-op.
  setActionLoading(false);
};
```

## 4.4 The parent that doesn't pass it

| Parent rendering `<PostCard>` | passes `onDelete`? |
|---|---|
| `src/components/WallPosts.tsx` | ✅ yes |
| `src/pages/Feed.tsx` | ✅ yes |
| **`src/pages/PostDetail.tsx`** | ❌ **NO** — props are `onReact`, `onUnreact`, `onCommentCountChange`, `onShareCountChange`, `onContentChange` |

**Root cause: on `/post/:id`, "Move to trash" renders enabled, calls `handleDelete`, which calls
`onDelete?.(…)` → `undefined` → silent no-op.** No error, no toast, no request, no DB change —
exactly the observed behaviour, now explained.

## 4.5 Pre-existing?

| File | T vs `main` |
|---|---|
| `src/components/post/PostCard.tsx` | **IDENTICAL** (md5 `664910914edb234391341870ebce9eae`, 830 lines) |
| `src/pages/PostDetail.tsx` | **IDENTICAL** |
| `src/pages/Feed.tsx` | **IDENTICAL** |
| `src/components/WallPosts.tsx` | **IDENTICAL** |

**AF-10 = PRE-EXISTING. Not candidate-specific. T untouched.** Defer to G11.

**Classification against the requested list:** ❌ wrong DOM target · ❌ disabled action ·
**✅ missing handler wiring (optional prop not supplied by this parent)** · ❌ navigation/state ·
❌ RLS rejection · ❌ missing DB mechanism · ❌ unimplemented feature.
**Delete is implemented and works — from Feed and WallPosts. It is inert on PostDetail only.**

## 4.6 AF-12 (NEW) — the label is wrong, and the action is irreversible

There is **no trash anywhere**: no `deleted_at`, no trash table, no trash RPC, `deleted_at` ×0 in the
bundle. The only implementation is `from("posts").delete()` — a **hard, irreversible delete**, with
**no confirmation dialog** (`hasConfirm: false` in both the bundle context and the source).

**A menu item labelled "Move to trash" that permanently destroys a post with no confirmation and no
recovery path is a data-loss hazard.** Pre-existing; raised for G11.

---

# 5. AF-03 — DEEPER CLASSIFICATION (STILL NOT APPLIED)

| Key | JSON role | Refs | Live? | What it drives |
|---|---|---|---|---|
| `managed_pages` | page body assets | 10 (site-assets) + 7 (portfolio-images) | **LIVE** | `/page/:slug` bodies + site logo |
| `ad_slots` | ad creative URLs | 9 | **LIVE** | sidebar/inline ad slots |
| `ad_zones_v2` | ad creative URLs | 3 | **LIVE** | zone-based ads |
| `seo_pages` | per-page OG image | 7 | **LIVE** | `og:image`, `twitter:image` |
| `seo_global` | default OG image | 1 | **LIVE** | site-wide OG fallback |
| `ad_slots_backup_20260723` | dated backup | 9 | **BACKUP** | restore point only |

**Confirmed user-visible impact:** `/page/about-us` renders **18 images, of which exactly 1 is a broken
production-CDN reference** — the site logo. Ads and OG images are similarly broken across 29 routes.

**Does staging have a legitimate placeholder?** Investigated: **no**. There is no staging default OG
image and no placeholder ad creative — `cdn-staging` holds 51 `portfolio_images` and the seeded post
media, but none of the 12 referenced objects, and no substitute of the same role.

**Would Option C create misleading QA results?** **Yes, partially — and this now matters.**
Nulling `seo_global` and `seo_pages` would make `og:image`/`twitter:image` **absent** on staging.
§15 row 8's positive criterion asks that SEO metadata be *"generated from staging values"* — an absent
tag cannot demonstrate that. **Option C converts a visible failure into a vacuous pass**, which is the
exact anti-pattern this gate exists to prevent.

## Revised recommendation

**Option D (accept and record) is the more truthful QA state — with one narrow exception.**

- `seo_global`, `seo_pages`, `managed_pages` → **Option D**. Nulling them would fake row 8.
- `ad_slots`, `ad_zones_v2` → **Option C is defensible** (ads are not a §15 criterion), but the gain is
  cosmetic.
- `ad_slots_backup_20260723` → **leave untouched** in every scenario.

**No write performed. Owner decision stands at B14.** If the objects were copied into staging R2
(Option A), row 8's positive criterion could be genuinely satisfied — that is the only path that
converts row 1 and row 8 to honest passes, and it needs **B5's R2 write capability**.

---

# 6. ROUTES — 55 / 60 EXECUTED

**New this round (+9):** `/featured-artist/:slug` ✅ (title "Mukti Bhavan: Waiting for Liberation",
**0 prod-CDN**) · `/:customUrl` ✅ (**`sofia.duarte` → `/profile/54cafd09…`, "Sofia Duarte"** — custom-URL
resolution VERIFIED) · `/journal/:slug` ✅ **correctly reports not-found** (0 articles) ·
`/ad/:creativeId` ⚠ renders but does **not** report not-found · `/dashboard/submission/:c/entry/:e/photo/:i`
⚠ **redirects to `/dashboard/submission/:c`**, dropping the deep-link segments ·
`/admin/notifications_health` ✅ · `/admin/users` ✅ · `/admin/judge_monitoring` ✅ · `/admin/certificates` ✅

**Inventory correction:** `/admin/*` is **not** six routes. The admin panel is **tab-driven**, with tabs
mapping to paths (`/admin/health`, `/admin/users`, `/admin/certificates`, `/admin/judge_monitoring`,
`/admin/notifications_health`, …) — ~30 tabs, 5 exercised.

**Not executed — 2, both structurally blocked:**
`/login` and `/signup` redirect to `/feed` and `/dashboard` while a session exists. Testing them
requires an anonymous session, which cannot be created without destroying the owner's session.
**OPEN — B2.**

**Across all 55 routes: production-apex 0 · production-Supabase 0 · console errors 0.**

**AF-11 extended:** both `/ad/<nonexistent>` and `/IDverification/<nonexistent>` render without
reporting not-found, while `/journal/<nonexistent>` correctly does. Inconsistent not-found handling.

---

# 7. EDGE FUNCTIONS — 4 / 74 ACTUALLY INVOKED (UNCHANGED, NOT INFLATED)

`dashboard-init` · `s3-presign-upload` · `media-register-upload` · `moderate-comment` — all staging,
**0 production function calls**.

**No new edge functions were invoked this round** because every remaining flow that would trigger one
requires a **write**, and the write gate held. Coverage stays **4/74**. Not inflated.

**RPCs additionally observed (REST, not edge functions):** `admin_search_users_v2`,
`admin_list_certificates`, `get_public_role_user_ids`, `get_my_unread_notifications_grouped`,
`get_notification_drift_admin`, `get_notification_health_stats_admin`.

---

# 8. RESPONSIVE — B17 CLOSED AS BLOCKED, WITH EVIDENCE

Second independent verification:

| Requested | actual `innerWidth` | `innerHeight` | `outerWidth` |
|---|---|---|---|
| 1440×900 | **1536** | 639 | 1536 |
| 820×1100 | **1536** | 639 | 1536 |
| 390×844 | **1536** | 639 | 1536 |

`resize_window` returned "Successfully resized" **three times**; the viewport never changed.
No device-emulation capability is exposed in this toolset. `devicePixelRatio` 1.25.

**B17 → BLOCKED. Row 10 breakpoints → OPEN. No CSS or JS simulation substituted.**

---

# 9. §15 MATRIX — CURRENT

| # | Area | Status | Change |
|---|---|---|---|
| 1 | UI | 🔴 **FAILING** | 55/60 routes; AF-03 unresolved |
| 2 | Functional flows | 🟡 **PARTIAL** | 6/10; 3 blocked by write gate |
| 3 | Authentication | 🟡 **PARTIAL** | admin authz VERIFIED via admin panel; `/login`,`/signup` OPEN |
| 4 | Database / RLS | ✅ **VERIFIED** | — |
| 5 | Storage / R2 | 🟡 **PARTIAL** | upload chain VERIFIED; prod object count OPEN; B5 BLOCKED |
| 6 | Edge Functions | 🟡 **PARTIAL** | 4/74 |
| 7 | Security / isolation | ✅ **VERIFIED** | preserved |
| 8 | SEO / headers | 🟡 **PARTIAL** | og:image FAILS; **Option C would fake this** |
| 9 | Email | ✅ **VERIFIED (vacuous)** | preserved |
| 10 | Responsive | 🟡 **PARTIAL** | breakpoints **BLOCKED** |
| 11 | Regression | 🟡 **PARTIAL** | §18 dependency |
| 12 | Cross-lane | 🟡 **PARTIAL** | N1/N2 OPEN |

**3 VERIFIED · 7 PARTIAL · 1 FAILING · 1 VERIFIED-vacuous**

**Release-content verification (not a §15 row, but the substance of the RC): all three headline
features now behaviourally verified.**

---

# 10. FINDINGS LEDGER

| ID | Classification | T impact |
|---|---|---|
| AF-03 | **OPEN — owner decision (B14)**; revised toward **Option D** | none — data only |
| AF-04 | **PRE-EXISTING** | none |
| AF-05 | **PRE-EXISTING** | none |
| AF-06 | **RESOLVED — by design** | none |
| AF-07 | **PRE-EXISTING** | none |
| AF-08 | **PRE-EXISTING** — admin branch skips `updated_at`; byte-identical both lanes | none |
| AF-09 | **PRE-EXISTING PATTERN** — 4/16 prior posts also lack thumbnails | none |
| AF-10 | **PRE-EXISTING** — `onDelete` prop missing on PostDetail; 4 files identical T vs main | none |
| AF-11 | **NEW, minor** — inconsistent not-found handling | unassessed |
| AF-12 | **NEW** — "Move to trash" is an irreversible hard delete, no confirm, no recovery | pre-existing |

**Every one of AF-04, 05, 07, 08, 09, 10 is pre-existing. None requires rebuilding T.**

---

*No secret, token, cookie or session value requested, displayed or recorded.
Zero staging writes this round. `main` = `b671e1f` · T = `e2e05fb` · RC **NOT APPROVED**.*
