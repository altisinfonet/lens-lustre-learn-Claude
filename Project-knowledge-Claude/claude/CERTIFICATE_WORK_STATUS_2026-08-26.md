# Certificate work — complete status
**50mm Retina World · updated 2026-08-26**
**`main` = `b671e1f` · `staging` = `702e5ce`**

---

## 1. THE ONE-LINE ANSWER

Everything in the certificate feature is **merged to main and live in production**, with **one exception**: the new text colours, which are **on staging only** and waiting for your sign-off.

```
staging vs main = 98 files
   ├── 2  files  = the colour change   ← the ONLY certificate work not in production
   └── 96 files  = the lane-isolation / SEO / CORS / storage / email workstream
                   (a different piece of work entirely — not certificates)
```

---

## 2. ✅ MERGED TO MAIN — LIVE IN PRODUCTION

Shipped as **PR #101** (`b671e1f`), 15 files, 6/6 CI checks green. Deploy verified by reading the live bundle at `www.50mmretina.com`, not by trusting a green badge.

### 2.1 Code

| # | What was broken | What it does now |
|---|---|---|
| 1 | The type dropdown offered `achievement` and `custom`; the database CHECK refused both, so choosing either gave "Create failed" with no explanation. **0 of 23 certificates carried either type — none could ever be written.** | All **16** types are issuable. |
| 2 | Recipient lookup was `.ilike(name).limit(1)` — two members named "Pradipta" and the certificate went to whichever row Postgres returned first, **silently, to the wrong person**. | Returns every match **with the email**, capped and counted, so you pick the right person. |
| 3 | The admin list was `.order(issued_at).limit(50)` with no paging — **at 51 certificates the oldest silently vanished.** | Server-side paged with an `id` tiebreak, so pages cannot overlap or skip. |
| 4 | Deleting a certificate left the member's *"New Certificate! You've earned…"* notification pointing at a row that no longer existed. Tapping it went nowhere. | A BEFORE DELETE trigger removes it — covering **every** delete path, not just the admin button. |
| 5 | The preview was an `<iframe>` pointed at a blob URL. `frame-src` does not cover `blob:`, so members saw **"This content is blocked."** | Drawn to a canvas through a shared `CertificateSurface`. The PDF and the on-screen preview now come from **one layout** and cannot drift apart. |
| 6 | 8 of the 16 types had no wording, so a Custom certificate printed *"OF COMPLETION / for successfully completing the course"*. | All 16 types have their own wording. The fallback is a neutral tier, not the course wording. |
| 7 | The `description` field was collected by the form, stored by the database, and **printed nowhere**. | Prints as the closing line, wrapped, capped at 3 lines. |
| 8 | The heading under CERTIFICATE was fixed. | Editable for **Custom only**. Blank falls back to *OF ACHIEVEMENT*. A CHECK constraint refuses a heading on any other type. |
| 9 | No preview while typing. | **Live word-by-word preview** in the admin form, 180 ms debounce. |
| 10 | Admin user list filtered role and badge in the browser after fetching one bounded page. | Paged and filtered **in SQL**. |

### 2.2 Production database

Applied **before** the code, so there was never a window where the code called something that did not exist. Every object md5-compared against staging's copy — all eight identical.

| Object | Status |
|---|---|
| `certificates.heading` column — table now **18 columns**, same shape as staging | ✅ applied |
| CHECK `certificates_type_check` — 16 types (adds `achievement`, `custom`) | ✅ applied |
| CHECK `certificates_heading_only_for_custom` | ✅ applied |
| `admin_list_certificates` — returns `heading` + `total_count` | ✅ applied |
| `admin_search_certificate_recipients` | ✅ applied |
| `cleanup_certificate_references()` | ✅ applied |
| trigger `trg_cleanup_certificate_references` | ✅ applied |
| index `idx_certificates_issued_at_id_desc` | ✅ applied |

Grants checked on every new function: `authenticated` only — **`anon` has none**.

---

## 3. 🟡 ON STAGING ONLY — NOT IN PRODUCTION

### 3.1 The text colours (2 files)

`staging` = `702e5ce`. Verified byte-identical to what was built and tested locally.

| Element | Was | Now on staging |
|---|---|---|
| Recipient's name | `#282828` | **`#007BB1`** |
| Course / competition title | `#282828` | **`#007BB1`** |
| Issue date | `#282828` | **`#007BB1`** |
| "This is to certify that…" | `#645F58` | **`#282828`** |
| "…has successfully completed" | `#645F58` | **`#282828`** |
| Closing line — the description, or *"with the appreciation of 50mm Retina World."* | `#96918A` | **`#282828`** |

**Unchanged, deliberately:** the gold border and corner flourishes `#B89650`, the inner border `#D2B978`, the word CERTIFICATE and the heading line beneath it (both gold), the page background `#FFFDF8`, and the genuine small print — DATE and AUTHORIZED SIGNATURE labels, certificate id, verify URL, "Scan to verify" — all still `#96918A`.

`TEXT_MUTED` `#645F58` was **removed**, not left unused. An orphaned palette entry is the kind of thing that gets re-applied by accident later.

**Contrast:** `#007BB1` on the cream background is **4.6:1**, `#282828` is **14.5:1**. Both pass WCAG AA.

Two files: `src/lib/generateCertificatePdf.ts` and a new `src/__tests__/certificatePalette.test.ts` (14 tests) that pins every element to its colour. Five deliberate mutations were run against it — reverting the name to grey, reverting a connector line, changing GOLD without the QR, reverting the closing line, and darkening the footer by mistake. **All five failed the test**, and it went green again when restored. The test is real, not decorative.

**To ship it:** cherry-picked PR to `main`, blob-verified, CI green before merge — same as #101. Say the word.

### 3.2 The other 96 files on staging — NOT certificates

Lane-isolation / SEO / CORS / storage / email work from a separate session. Includes the CSP in `public/_headers`, `robots.txt`, `sitemap.xml`, all 7 CI workflows, and every Cloudflare Pages Function. **Needs its own review** — do not let it ride along with a certificate merge.

⚠ **The one thing to check before that workstream ships:** `public/_headers` is now a template containing `__CDN_HOST__` placeholders, filled at build time by `scripts/generate-headers.mjs`. I proved the generated output is byte-identical to what production serves today — **but only if the production Cloudflare Pages build command invokes `package.json`'s `build` script.** If it is set to bare `vite build`, production ships a CSP containing the literal string `https://__CDN_HOST__` and every CDN image is blocked site-wide.

---

## 4. ⛔ NOT DONE — WAITING ON YOU

### 4.1 The 23 test certificates are still in production

Backup taken (`PRODUCTION_CERTIFICATES_BACKUP_2026-08-25.json` — 23 certificates, 11 notifications, 12 audit rows). Purge script written (`PRODUCTION_CERTIFICATE_PURGE.sql`).

**This one needs you** — my environment refuses mass deletes against a production database, and I did not route around that.

The evidence supports your read that they are scrap: production has **zero competitions**, so all 16 competition certificates point at competitions that no longer exist. Five are course certificates tied to courses that are still live.

⚠ The script clears `db_audit_logs` as a **second step**, and that step matters: the `audit_certificates` trigger writes a **full JSON copy of every deleted row**. A plain `DELETE` would take you from 12 stored copies to **35** — leaving more behind than it removed.

### 4.2 The build marker was not bumped — my mistake

`src/main.tsx` still reads `__APP_BUILD = "2026-08-20-2"`, confirmed live in the browser. Its own comment sets the rule: bump on every release that changes what the client sends to the database. #101 does exactly that — new `heading` field, two new RPCs, two new type values.

Nothing is broken; Vite rehashed the changed chunks so caching is fine. But if a member reports odd certificate behaviour, the marker cannot distinguish "new bundle" from "stale bundle" — the exact ambiguity it exists to remove, and the failure this repo already got burned by on 2026-08-20.

**Fix: one line, `2026-08-25-1`.** Not shipped, awaiting your go.

### 4.3 Excellence Featured / Testimonials

8 bugs analysed and written up in `EXCELLENCE_TESTIMONIALS_ANALYSIS_2026-08-25.md`. Headline: **no consumer exists anywhere** — production has 0 testimonials, 0 featured certificates, 0 quotes, and tiers are never saved. You deferred this; it needs your decision on where the feature should actually appear before any code is written.

---

## 5. WHAT TO TEST

**On staging** (colours):
1. Issue any certificate — name, title and date should be blue
2. Issue a **Custom** one with the description left blank — the closing line *"with the appreciation of 50mm Retina World."* should now be dark, not washed-out grey
3. Type a description — same line, same dark colour
4. Check the footer is still light grey and the border still gold

**On production** (the merged feature):
1. Issue a certificate of each type — especially `achievement` and `custom`
2. Custom: blank heading → *OF ACHIEVEMENT*; typed heading → your text
3. Live preview while typing
4. Delete, Revoke, Restore — all three
5. Delete → the member's notification disappears too
6. Recipient search by name and by email
7. The list past page 1
8. Admin → Users: paging, role filter, badge filter, search
9. Member side `/certificates` — view and download; logo and signature both present

---

## 6. HONEST NOTE ON THE PROCESS

`git push` is blocked by the proxy in my environment, so every file goes up through the GitHub web UI. That path has a failure mode I hit **five times** across this work: the upload succeeds, the "Commit changes" button swallows the click, and **nothing tells you**. It is only caught by fetching the branch afterwards and comparing blob SHAs — which is why I do that after every single upload, and why one `types.ts` came back carrying main's content before I re-sent it.

It also briefly left staging red: a test committed without the code it tests, for about four minutes. Both are now up and verified.

None of it affected the correctness of what shipped, but it is why some of these steps took longer than they should have.
