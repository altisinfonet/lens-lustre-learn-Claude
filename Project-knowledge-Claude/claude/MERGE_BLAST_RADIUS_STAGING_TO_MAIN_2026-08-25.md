# BEFORE MERGING `staging` → `main` — where damage can happen, and what is proven safe
**2026-08-25 · staging `c92d534` vs main · every claim below was measured, none inferred**

---

## 1. THE HEADLINE — the merge is not what you asked for

You asked to ship **certificates + admin User pagination**. That is **17 files**.

A `staging → main` merge ships:

```
111 files changed, +5654 / −560, across 21 commits
```

**17 are your certificate + pagination work. 94 are a different workstream** (G5b/G7/G8/G9/G10 lane isolation, SEO, CORS, storage, email) that another session put on staging. Merging the branch ships all of it, together, in one deploy.

| Group | Files | Ships to production on merge? |
|---|---|---|
| Your certificate + pagination work | 17 | **Yes** |
| Tests, CI workflows, build scripts | 23 | No — CI only, no runtime effect |
| Supabase Edge Functions + email templates + `config.toml` | 44 | **No** — nothing in CI deploys Edge Functions; they stay inert until someone runs `supabase functions deploy` by hand |
| **Front-end / CDN / headers / SEO — deploys with Pages** | **27** | **Yes** |

So the real live surface is **17 + 27 = 44 files**, not 111. But those 27 are the dangerous ones, because they include the CSP, robots.txt and sitemap.xml.

---

## 2. HARD BLOCKERS — these break production the moment the code lands

### 2.1 🔴 Admin → Certificates dies unless the DB migrations go **first**

I queried the **production** database just now. It does **not** have the certificate changes:

| Needed by the merged code | Production today |
|---|---|
| `certificates.heading` column | ❌ **missing** |
| RPC `admin_list_certificates` | ❌ **missing** |
| RPC `admin_search_certificate_recipients` | ❌ **missing** |
| `certificates_type_check` allowing `achievement` + `custom` | ❌ only the **14** old types |
| BEFORE DELETE trigger removing notifications | ❌ **missing** |
| `certificates.description` | ✅ present |

Consequence if code merges before migrations:

- The Certificates list calls `admin_list_certificates` → **404, empty screen**.
- Recipient lookup calls `admin_search_certificate_recipients` → **404, cannot issue anything**.
- Save/Create sends `heading:` → **"column heading does not exist" → "Create failed"**.
- Choosing type `achievement` or `custom` → **CHECK violation**.
- Deleting a certificate still leaves its notification orphaned (the fix is the trigger).

**Order is mandatory: three migrations to production DB → verify → then merge the code.**

### 2.2 ✅ Admin → Users is already safe

`admin_search_users_v2` **exists in production** (applied 2026-08-25 09:21 by another session), and it returns `total_count`, which is exactly what the paged screen reads. This half needs no DB step.

### 2.3 ✅ The member `/certificates` page degrades safely

It reads `select("*")`, so a missing `heading` column is not an error — `cert.heading` is simply `undefined` and the certificate falls back to its normal heading. Members see no breakage even in the gap between merge and migration. (Still: don't rely on it, do the migrations first.)

---

## 3. THE 27 FILES THAT ARE NOT YOURS AND DO SHIP

### 3.1 🔴 The single largest risk in the whole merge: `public/_headers`

On `main`, `public/_headers` is **the real, shipped file** — CSP, HSTS, CORS.
On `staging` it has been turned into a **template with `__CDN_HOST__` / `__SITE_DISPLAY_ORIGIN__` placeholders**, filled at build time by `scripts/generate-headers.mjs`, which `package.json`'s `build` script now chains.

**I tested this rather than trusting it.** Running the generators with **no lane variables set** (which is what a production build is):

```
generate-headers   OK  cdn=cdn.50mmretina.com  acao=https://50mmretina.com
generate-seo-assets OK  origin=https://50mmretina.com

dist/_headers    ✅ BYTE-IDENTICAL to what main ships today
dist/robots.txt  ✅ BYTE-IDENTICAL
dist/sitemap.xml ✅ BYTE-IDENTICAL
```

So the design is correct — **on one condition**:

> ⚠ **The production Cloudflare Pages build command must invoke `package.json`'s `build` script** (`npm run build` / `bun run build`, with or without a `&& …` suffix).
> If it is set to `vite build` or anything that bypasses the script chain, Vite copies `public/_headers` into `dist/` verbatim and **production ships a CSP containing the literal string `https://__CDN_HOST__`** — which blocks every image from `cdn.50mmretina.com` site-wide, and sends `Access-Control-Allow-Origin: __SITE_DISPLAY_ORIGIN__`. Silent, total, and it would look like a CDN outage.

**I cannot read your Pages settings from here.** This is the one thing you must check in the dashboard before merging: *Workers & Pages → production project → Settings → Build → Build command*.

Two related settings to check on the same screen (**Variables**):

- If `VITE_CDN_HOST` or `VITE_SITE_ORIGIN` is set to an **empty string**, the build **fails on purpose** (by design — empty is treated as a config error, not a default). Unset is what you want.
- If `VITE_SITE_ORIGIN` is set to the **apex** `https://50mmretina.com` instead of `https://www.50mmretina.com`, the apex→www redirect in `index.html` computes an empty apex and **switches itself off** — reopening the 2026-08-05 incident where members on the bare domain got a logged-out copy of the site.

### 3.2 `index.html` — the apex→www redirect was rewritten

Hardcoded `50mmretina.com` → `www.50mmretina.com` became a `%VITE_SITE_ORIGIN%`-derived version. With production defaults it behaves identically. **Check after deploy: open `https://50mmretina.com` and confirm it still lands on `https://www.50mmretina.com` logged in.**

### 3.3 `src/lib/env.ts` — new, and deliberately has **no fallback value**

Thirteen files that held `cdn.50mmretina.com` or the site origin as literals now import from here, and the values are injected by Vite `define`. **15 files import it; 25 files import `publicUrl` on top of that.** The defaults resolve to production when nothing is set — verified above. But if the `define` map were ever missing, these come out `undefined`, not wrong-but-plausible.

**Screens to eyeball after deploy** (these are what those two modules feed):

- Every **share button** (post, entry, competition, journal, featured artist, profile, referral link) — links must say `https://50mmretina.com/...`
- **Profile** and **Edit Profile** — avatar loading, public address shown
- **Post media / feed images** — `PostMedia.tsx`, `cdnImage.ts`, `postMediaRead.ts` all changed
- **QR code card** on the profile — the domain printed on it
- **Article PDF** (`generateArticlePdf.ts`) — the domain stamped into it
- **Admin → SEO**, **Admin → Email Templates**, **Admin → Employee**, **Cloudflare Edge Checklist** — all four changed

### 3.4 `robots.txt` + `sitemap.xml` — proven unchanged

Both are now templates. Generated output is **byte-identical** to what main serves today, including the apex form (`https://50mmretina.com/...`, not `www.`). **No SEO change is being smuggled in** — I checked specifically because the origin default is the `www.` host and it would have been an easy silent rewrite.

### 3.5 The 7 Cloudflare Pages Functions (`functions/*.ts`) — these DO deploy

`_seo.ts` plus the five crawler routes (`journal/[slug]`, `competitions/[id]`, `courses/[slug]`, `featured-artist/[slug]`, `page/[slug]`). They serve rewritten `<head>` metadata to crawlers. **Check after deploy:** a journal article and a competition page still render normally to a human, and their OG/canonical tags still name `50mmretina.com`.

### 3.6 The 44 Supabase Edge Function files — inert

None of the 7 CI workflows deploys Edge Functions. `submit-judge-decision`, all four `s3-*`, the email pipeline, `_shared/s3.ts` and `_shared/secureHeaders.ts` change in the repo but **the running functions in production keep their current code** until deployed by hand. Good news for this merge; it also means the repo and the live functions will be **out of sync** afterwards, which is worth writing down.

---

## 4. WHERE **I** COULD HAVE SILENTLY DAMAGED SOMETHING — my 17 files

I traced the import graph rather than guessing who consumes my code.

| What I changed | Who else touches it | Damage possible |
|---|---|---|
| `src/lib/generateCertificatePdf.ts` (rewritten around a shared `CertificateSurface`) | Only `AdminCertificates.tsx` + `src/pages/Certificates.tsx` | Certificate PDF layout / member download only |
| `src/lib/certificateCanvas.ts` (new) | Only `generateCertificatePdf.ts` | Preview image only |
| `src/components/CertificatePreviewModal.tsx` | Only `src/pages/Certificates.tsx` | Member certificate view only |
| `src/components/admin/AdminCertificates.tsx` | Nothing imports it | Admin → Certificates only |
| `src/components/admin/AdminUsers.tsx` | Nothing imports it | Admin → Users only |
| `src/components/admin/certificateTypes.ts` (new) | Admin certificates only | — |
| `src/integrations/supabase/types.ts` | Whole app (types only) | **Compile-time only**, 3 added lines, no runtime output |
| 4 test files | CI only | — |
| 4 migrations + 1 rollback | Not auto-applied — `apply-migration.yml` is `workflow_dispatch` only | Nothing happens on merge |

**✅ Confirmed untouched: the public certificate verification pages.** Neither `VerifyCertificate.tsx` nor `CertificateVerifyByToken.tsx` imports a single file I changed. Public verification cannot regress from this work.

**Things to test yourself in the admin panel after production migration + merge** — these are the exact places my changes could bite:

1. Issue a certificate of **each** type — especially `achievement` and `custom` (the two new ones)
2. **Custom** type: leave the heading blank → must print *OF ACHIEVEMENT*; type something → must print that
3. **Live preview** while typing the title / description / heading
4. **Delete**, **Revoke**, **Restore** — all three go through the confirm dialog I broke and fixed once already; test all three
5. Delete a certificate → confirm the member's **notification disappears** too
6. Recipient search by name and by email
7. The certificates list past page 1 (paging is now server-side)
8. Admin → **Users**: paging, role filter, badge filter, search — all now filtered in SQL, not in the browser
9. Member side: open `/certificates`, view and **download** a certificate — check the logo and signature actually appear

---

## 5. WHAT I RECOMMEND

**Do not merge the branch.** Ship a **cherry-picked PR containing only your 17 files**, in this order:

1. **Read the Pages build command** in the Cloudflare dashboard (§3.1). Two minutes, and it is the only unknown left.
2. Apply the **three certificate migrations** to the production DB, verify each object exists.
3. Open a PR from a branch off `main` carrying **only** the 17 files (5 code + 4 tests + 4 migrations + 1 rollback + `types.ts` + `certificateTypes.ts`).
4. Merge, wait for the Pages deploy, run the 9 checks in §4.
5. **Then** decide separately, with its own review, whether the 94-file lane-isolation workstream ships.

That way the certificate work reaches production **without** dragging the CSP, the SEO assets and the Pages Functions along with it — and if something does break, there are 17 suspects, not 111.

---

### Proofs behind this document
- `git diff --stat origin/main origin/staging` → 111 files, +5654/−560, 21 commits
- File split computed by set difference against the 5 commits `6d6aa6c cba8dae 7380e28 5dbfcf7 c92d534`
- Generators run with production defaults; `dist/_headers`, `dist/robots.txt`, `dist/sitemap.xml` diffed against `origin/main:public/*` → identical
- Production DB queried live: `pg_proc`, `information_schema.columns`, `pg_trigger`, `pg_constraint` on `public.certificates`
- Import graph read from the staging tree, not assumed
