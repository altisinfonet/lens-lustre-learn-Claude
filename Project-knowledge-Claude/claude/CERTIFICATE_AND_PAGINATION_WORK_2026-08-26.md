# Certificate work + Admin User Pagination — full record
**50mm Retina World**
**Updated 2026-08-26 · `main` = `b671e1f` · `staging` = `702e5ce`**

---

## 0. THE SHORT ANSWER

| | Status |
|---|---|
| **Certificates — the feature** | ✅ **Merged to main, live in production** |
| **Certificates — DB migrations** | ✅ **Applied to production**, verified against staging |
| **Admin User Pagination** | ✅ **Merged to main, live in production** |
| **Certificate text colours** | 🟡 **Staging only — not merged** |
| Purge the 23 test certificates | ⛔ Waiting on you |
| Build-marker bump | ⛔ Waiting on you (my miss) |
| Excellence / Testimonials | ⛔ Waiting on your decision |
| The other 96 files on staging | 🟡 Different workstream — own review |

```
staging vs main = 98 files
   ├──  2 files = the colour change    ← the ONLY certificate/pagination work not in production
   └── 96 files = lane isolation / SEO / CORS / storage / email  (not this work)
```

---

# PART A — MERGED TO MAIN, LIVE IN PRODUCTION

Shipped as **PR #101** → `b671e1f`. 15 files. **6/6 CI checks green.** Deploy confirmed by reading the live JavaScript at `www.50mmretina.com` — not by trusting a green badge.

Deliberately a **cherry-picked** PR, not a branch merge: `staging → main` would have dragged 96 unrelated files (the CSP, robots.txt, sitemap.xml, all 7 CI workflows, every Pages Function) into a production deploy alongside it.

---

## A1 · ADMIN USER PAGINATION

### What was actually broken — and it was worse than "no paging"

`admin_search_users` (v1) ended its empty-search branch with:

```sql
ORDER BY p.created_at DESC LIMIT 100
```

That keeps the hundred **newest** profiles. Nothing in the UI could reach row 101.

- `profiles` crossed 100 rows on **2026-08-21 05:14 UTC** (signup #101).
- At that instant the **oldest** profile — `50mm Retina World`, created 2026-02-25, **your own account and the only holder of the `admin` role** — fell off the bottom of the list and became invisible.
- `Dipannita Sen` followed on **2026-08-22 09:48 UTC**.

**The role filter failed for the same reason, one layer down.** `AdminUsers.tsx` read `user_roles` for a role's holders, then intersected that id set with whatever `admin_search_users` returned — **client-side, against the truncated hundred**. The only admin was not in the hundred, so the intersection came back empty and the screen rendered *"no users found"* for a role that plainly had a holder.

Measured at the time: 102 profiles · role `admin` 1 holder, **1 invisible** · badge `verified` 6 holders, **1 invisible** · role `user` 102 holders, **2 invisible**.

Production is now at **103 members** — so this was actively biting.

### What it does now

`admin_search_users_v2(_query, _by, _role, _badge, _limit, _offset)`:

1. **Paging** — `_limit` / `_offset` (clamped 1–200), so the UI offers numbered pages.
2. **Filtering moved INTO the SQL** — role and badge applied **before** the limit, never after it. *This was the actual defect, not the limit.*
3. **`total_count`** returned on every row via `count(*) over ()` — the count of the **filtered** set before limit/offset — so the UI can say "showing 20 of 103" instead of implying 20 is everyone.
4. `ORDER BY created_at DESC, id DESC` — a **total** order. Without the `id` tiebreak, rows with equal timestamps can appear on two pages or on neither.
5. Index `idx_profiles_created_at_id_desc` matches that ordering.

### Why a new function instead of replacing v1

`CREATE OR REPLACE` cannot add a column to a function's return type, and this one had to return `total_count`. Replacing v1 in place meant `DROP` + `CREATE`, which would have broken the live admin page in the window between the migration and the UI deploy. **v1 was left untouched and kept serving until the UI moved.**

### ⚠ Open item from this — `admin_search_users` v1 is now dead code with a stale grant

Verified in production just now:

```
admin_search_users      →  anon, authenticated, postgres, service_role   ← anon should not be here
admin_search_users_v2   →  authenticated, postgres, service_role         ← correct
```

**This is untidiness, not an open door.** v1 is `SECURITY DEFINER` **and** carries the `has_role(auth.uid(), 'admin')` gate inside — I confirmed both — so an anonymous caller gets `Not authorized`, no data. But the grant serves no purpose and the function itself is now unused by any screen.

**Recommended follow-up:** one migration that revokes `anon` and drops v1. Not done — it is a separate change with its own blast radius and it was never in scope for #101.

---

## A2 · CERTIFICATES — TEN DEFECTS FIXED

| # | What was broken | What it does now |
|---|---|---|
| 1 | The type dropdown offered `achievement` and `custom`; the CHECK constraint refused both. "Create failed", no explanation. **0 of 23 certificates carried either type — none could ever be written.** | All **16** types issuable. |
| 2 | Recipient lookup was `.ilike(name).limit(1)` — two members named "Pradipta" and the certificate went to whichever row Postgres returned first. **Silently, to the wrong person.** | Returns every match **with the email**, capped and counted, so you choose. |
| 3 | Admin list was `.order(issued_at).limit(50)`, no paging. **At 51 certificates the oldest silently vanished** — same family of bug as A1. | Server-side paged, `id` tiebreak, `total_count`. |
| 4 | Deleting a certificate left the member's *"New Certificate! You've earned…"* notification pointing at a deleted row. Tapping it went nowhere. | BEFORE DELETE trigger removes it — covers **every** delete path, not just the admin button. |
| 5 | Preview was `<iframe src={blobUrl}>`. `frame-src` does not cover `blob:` → members saw **"This content is blocked."** | Drawn to a canvas via a shared `CertificateSurface`. PDF and preview come from **one layout** and cannot drift. |
| 6 | 8 of 16 types had no wording, and the fallback was the *course* wording — so a Custom certificate printed *"OF COMPLETION / for successfully completing the course"*. | All 16 types worded. Fallback is a neutral tier, not course wording. |
| 7 | `description` was collected by the form, stored by the database, and **printed nowhere**. | Prints as the closing line, wrapped, capped at 3 lines. |
| 8 | The heading under CERTIFICATE was fixed text. | Editable for **Custom only**; blank → *OF ACHIEVEMENT*; a CHECK refuses a heading on any other type. |
| 9 | No preview while typing. | **Live word-by-word preview**, 180 ms debounce. |
| 10 | **My own regression:** `CertificatesList` destructured `dialogProps` but never rendered `<ConfirmDialog>`, silently killing Delete, Revoke **and** Restore. | Mounted. All 19 components using that hook were swept; this was the only unbalanced one. |

## A3 · PRODUCTION DATABASE — applied BEFORE the code

So there was never a window where the code called something that did not exist. Every object md5-compared against staging's copy — all eight identical.

| Object | Status |
|---|---|
| `certificates.heading` column — table now **18 columns**, same shape as staging | ✅ |
| CHECK `certificates_type_check` — 16 types (adds `achievement`, `custom`) | ✅ |
| CHECK `certificates_heading_only_for_custom` | ✅ |
| `admin_list_certificates` — returns `heading` + `total_count` | ✅ |
| `admin_search_certificate_recipients` | ✅ |
| `cleanup_certificate_references()` | ✅ |
| trigger `trg_cleanup_certificate_references` | ✅ |
| index `idx_certificates_issued_at_id_desc` | ✅ |
| `admin_search_users_v2` (from PR #97) + `idx_profiles_created_at_id_desc` | ✅ |

Grants on every new function: **`authenticated` only — `anon` has none.**

## A4 · VERIFICATION THAT WAS ACTUALLY RUN

- `npm run typecheck` — clean.
  *(Note: `npx tsc --noEmit` checks **nothing** in this repo — root `tsconfig.json` is `"files": []`. Every earlier "TSC clean" I reported was vacuous. Proved by deliberately breaking a file.)*
- `npm run test` — **2,345 passed, 1 skipped, 0 failed**.
- 15 files on `main` diffed against `staging`: **byte-identical, all 15**, no extras.
- Live bundle read back from production: the canvas adapter (`certificateCanvas` / `toPngDataUrl` / `PT_TO_MM`) is present. **It did not exist before this release**, so that is proof, not inference.
- Public verification pages untouched: neither `VerifyCertificate.tsx` nor `CertificateVerifyByToken.tsx` imports any changed file.

---

# PART B — DONE ON STAGING, **NOT** MERGED TO MAIN

## B1 · Certificate text colours — 2 files

`staging` = `702e5ce`, blob-verified byte-identical to what was built and tested.

| Element | Was | Now on staging |
|---|---|---|
| Recipient's name | `#282828` | **`#007BB1`** |
| Course / competition title | `#282828` | **`#007BB1`** |
| Issue date | `#282828` | **`#007BB1`** |
| "This is to certify that…" | `#645F58` | **`#282828`** |
| "…has successfully completed" | `#645F58` | **`#282828`** |
| The line under the title — description, or the type's own wording | `#96918A` | **`#282828`** |

**The line under the title is unconditional — it applies to all 16 types**, not only Custom. One `setTextColor` runs for every certificate; the type only decides the words, never the colour.

**Unchanged, deliberately:** gold border `#B89650`, inner border `#D2B978`, CERTIFICATE and the heading beneath it (gold), background `#FFFDF8`, and the genuine small print — DATE / AUTHORIZED SIGNATURE labels, certificate id, verify URL, "Scan to verify" — still `#96918A`.

`TEXT_MUTED` `#645F58` was **removed**, not left unused — an orphaned palette entry gets re-applied by accident later.

**Contrast:** `#007BB1` on cream = **4.6:1**; `#282828` = **14.5:1**. Both pass WCAG AA.

**Files:** `src/lib/generateCertificatePdf.ts` and a new `src/__tests__/certificatePalette.test.ts` (14 tests pinning every element to its colour). Five deliberate mutations were run against that test — revert the name to grey, revert a connector line, change GOLD without the QR, revert the closing line, darken the footer by mistake. **All five failed the test**, and it went green again when restored.

**Local gate:** typecheck clean, **2,409 tests passed, 0 failed**.
**Deployed to staging and verified in the running bundle:** `[0,123,177]` present, `[40,40,40]` present, `[150,145,138]` present for the footer, old `[100,95,88]` **gone**.

**To ship:** cherry-picked PR to `main`, blob-verified, CI green before merge — same as #101. Awaiting your go.

## B2 · The other 96 files on staging — NOT this work

Lane isolation / SEO / CORS / storage / email, from a separate session. Includes `public/_headers` (the CSP), `robots.txt`, `sitemap.xml`, all 7 CI workflows, every Cloudflare Pages Function, all email templates. **Needs its own review — do not let it ride along with a certificate merge.**

⚠ **Read this before that workstream ships:** `public/_headers` is now a template with `__CDN_HOST__` placeholders filled at build time by `scripts/generate-headers.mjs`. I proved the generated output is byte-identical to what production serves today — **but only if the production Cloudflare Pages build command invokes `package.json`'s `build` script.** If it is bare `vite build`, production ships a CSP containing the literal string `https://__CDN_HOST__` and **every CDN image is blocked site-wide.** I cannot read your Pages settings; you can.

---

# PART C — NOT DONE, WAITING ON YOU

## C1 · The 23 test certificates are still in production

Backup taken: `PRODUCTION_CERTIFICATES_BACKUP_2026-08-25.json` — 23 certificates, 11 notifications, 12 audit rows, full row JSON, restorable.
Script written: `PRODUCTION_CERTIFICATE_PURGE.sql`.

**Needs you** — my environment refuses mass deletes against a production database, and I did not route around that.

The evidence backs your read: production has **zero competitions**, so all 16 competition certificates point at competitions that no longer exist. Five are course certificates tied to courses still live.

⚠ The script clears `db_audit_logs` as a **second step**, and that step is the point: the `audit_certificates` trigger writes a **full JSON copy of every deleted row**. A plain `DELETE` would take you from 12 stored copies to **35** — leaving more behind than it removed.

## C2 · Build marker not bumped — my mistake

`src/main.tsx` still reads `__APP_BUILD = "2026-08-20-2"`, confirmed live in the browser. Its own comment sets the rule: bump on every release that changes what the client sends to the database. #101 does exactly that — new `heading` field, two new RPCs, two new type values.

Nothing is broken (Vite rehashed the changed chunks, caching is fine), but the marker can no longer distinguish "new bundle" from "stale bundle" — the exact ambiguity it exists to remove, and the failure this repo got burned by on 2026-08-20.

**Fix: one line → `2026-08-25-1`.**

## C3 · Retire `admin_search_users` v1

Revoke `anon`, drop the function. See A1. Untidiness rather than exposure, but it should go.

## C4 · Excellence Featured / Testimonials

8 bugs analysed in `EXCELLENCE_TESTIMONIALS_ANALYSIS_2026-08-25.md`. Headline: **no consumer exists anywhere** — production has 0 testimonials, 0 featured certificates, 0 quotes, tiers never saved. You deferred it; it needs your decision on where the feature should appear before any code is written.

---

# PART D — WHAT TO TEST

**Staging** (the colours): issue a certificate of **any** type — name, title and date blue; the line under the title dark on every type; footer still light grey; border still gold.

**Production** (the merged feature):
1. Issue one of each type — especially `achievement` and `custom`
2. Custom: blank heading → *OF ACHIEVEMENT*; typed heading → your text
3. Live preview while typing
4. Delete, Revoke, Restore — all three
5. Delete → the member's notification goes too
6. Recipient search by name **and** by email
7. The list past page 1
8. **Admin → Users:** paging, role filter, badge filter, search — and confirm your own admin account is visible again
9. Member side `/certificates` — view and download; logo and signature present

---

# PART E — HONEST NOTE ON PROCESS

`git push` is proxy-blocked in my environment, so every file goes up through the GitHub web UI. That path has a failure mode I hit **repeatedly**: the upload succeeds, the "Commit changes" button swallows the click, and **nothing tells you**. It is caught only by fetching the branch afterwards and comparing blob SHAs — which is why I do that after every upload, and why one `types.ts` came back carrying main's content before I re-sent it.

It also briefly left staging red once: a test committed without the code it tests, for about four minutes.

None of it changed what shipped. It is why several steps took longer than they should have.
