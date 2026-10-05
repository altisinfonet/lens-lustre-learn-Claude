# F-D3-3 · Why the live sitemap is thin: traced to its cause

**Finding (P17 decision, 2026-10-04):** "Live sitemap: 12 static apex URLs, no journal/course/competition URLs (cause not traced)."
**This file traces it. It fixes nothing:** it is D3 evidence, and it ends with a proposed fix for D2/D1 and the SEO owner. · **Date:** 2026-10-05 · **Lane:** D2 (D3 session, docs only) · **Path:** `docs/evidence/d2/phase5/F-D3-3/`

> **OWNER SIGN-OFF (only for the fix proposal in §4):** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

---

## 1 · What is served (live, 2026-10-05 06:05 UTC, curl)

| URL | answer |
|---|---|
| `https://www.50mmretina.com/sitemap.xml` | 200, 1,433 B, **12 `<loc>`**, all `https://50mmretina.com/...`, `Cache-Control: no-store …` |
| `https://50mmretina.com/sitemap.xml` | 200, 1,433 B, the same file |
| `https://www.50mmretina.com/robots.txt` | `Sitemap: https://50mmretina.com/sitemap.xml` |
| `https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/sitemap` (the production Supabase function, `verify_jwt = false`) | 200, 266,415 B, **730 `<loc>`**, all `https://50mmretina.com/...`, plus 710 `<image:loc>` |

**The 730 URLs from the function, by kind** (counted, not listed, because member usernames are not copied into the repo):

| kind | URLs |
|---|---:|
| static routes | 13 |
| `/journal/:slug` | 4 |
| `/courses/:slug` | 3 |
| `/featured-artist/:slug` | 1 |
| `/page/:slug` | 7 |
| `/competitions/:id` | **0** |
| `/:custom_url` (member profiles, `indexing_disabled = false`) | 132 |
| `/post/:id` (`privacy = 'public'`, `indexing_disabled = false`) | 570 |

## 2 · The cause (read from staging `b2aa236`)

The project has **three sitemap generators**, and the one crawlers get is the thinnest.

1. **Served: a static template.**
   - `public/sitemap.xml` is a hand-written list of 12 routes with the placeholder `__SITE_ORIGIN__`. It was last changed by `9a89aad` (2026-08-22, "de-hardcode every lane-specific address"), which only templated the host.
   - At build, `scripts/generate-seo-assets.mjs` copies it to `dist/sitemap.xml` and substitutes the origin. It has **no step that adds content URLs**.
   - **This is why the live sitemap has no journal, course or competition URLs.**
2. **Deployed but not wired: the dynamic generator.**
   - `supabase/functions/sitemap/index.ts` builds the full sitemap (static routes + competitions + journal + courses + featured artists + pages + public profiles + public posts, each capped).
   - It is deployed on production and answers publicly, but **nothing routes `/sitemap.xml` to it**.
   - **History:** it was meant to be wired by a `_redirects` 200-proxy (`/sitemap.xml → https://<ref>.supabase.co/functions/v1/sitemap 200`). Cloudflare rejects a cross-origin 200-proxy, and every deploy log read "Parsed 0 valid redirect rules". So the dynamic sitemap **never** went live.
   - The inert rule was removed on 2026-08-24 (`9f3d20a`, G9). Its header comment in `scripts/generate-redirects.mjs` already says that the correct mechanism is "a Pages Function or a Worker route", and that was never built.
   - `robots.txt` advertises the static file.
3. **A third copy: the Admin SEO page.** `src/components/admin/AdminSEO.tsx:318` `generateSitemap()` builds yet another list in the browser, with its own static route list and no posts or profiles, as a preview. It is not served either.

**Why the host is the apex (`50mmretina.com`) and not www:**
- **This is by design in code, and it now contradicts the signed P17 decision (D4: canonical = www).**
- **(a) Static template:** `generate-seo-assets.mjs` writes `displayOrigin = https://${apexHost || siteHost}`, with the comment "Canonical URLs have always named the apex… Keep production byte-identical". `src/lib/env.ts` `SITE_DISPLAY_ORIGIN` does the same, and the SPA's `PageSEO` canonical uses it.
- **(b) The Supabase function:** `siteOrigin()` reads `SITE_ORIGIN` from the function's env. Its output says that variable is the apex on production.
- **(c) The dashboard Worker** `seo-edge-injector` also writes apex canonicals.
- **The exception:** the Pages Functions (`functions/_seo.ts`) use the Pages `SITE_ORIGIN`, which is **www**.
- **Four writers with two hosts is the root of F-D3-1** (the canonical flips per request).
- **The script's own comment** "the apex redirects to www" **is false live:** the apex answers 200 (F-D3-2, re-confirmed on 10-04).

**Smaller defects in what is served:**
- **`/feed` is listed but redirects an anonymous visitor to `/login`** (`src/pages/Feed.tsx:97` `if (!authLoading && !user) navigate("/login")`; already recorded as F-83 for the vitals harness).
- **`/login` and `/signup` are listed.** They are app screens with no search value.
- **The function lists 0 competitions.** Either no competition is in the listed statuses, or the select failed. The function discards Supabase errors (`const { data } = …`, no `error` check), so it cannot say which. The live `/competitions` page also showed no competition links on 10-04, so "none public" is plausible. **Not determined.**

## 3 · Security note, for SEC (not a new defect; recorded because it is now visible)

- **Service role with code-only filters:** the sitemap function uses `SUPABASE_SERVICE_ROLE_KEY`, so RLS does not apply. What it exposes is decided only by its `.eq("privacy","public")` / `.eq("indexing_disabled", false)` filters. Today it publicly lists 132 member profile URLs and 570 post ids. That is the intended behaviour for public content, but **one wrong filter would publish private ids.**
- **Proposal:** read through the anon key + RLS (the same rows are public), or have SEC confirm the filters as T1 when the fix in §4 lands.

## 4 · Proposed fix (one D2 unit, plus a one-line Supabase env change; for the SEO owner = Owner, per P17 D5)

1. **Serve the dynamic sitemap at `/sitemap.xml`:** a Pages Function `functions/sitemap.xml.ts` (D2 lane) that fetches the Supabase `sitemap` function, cached at the edge for 1 h with SWR. **The static template is kept as the fallback** when the function fails: it is never an empty 200, and never a 5xx to a crawler.
2. **One host:** set the Supabase function's `SITE_ORIGIN` to `https://www.50mmretina.com` (an Owner/D1 env change). Change `generate-seo-assets.mjs` and `SITE_DISPLAY_ORIGIN` to www **in the same PR as P17's one-renderer unit**, so every canonical, `og:url`, sitemap `<loc>` and `robots.txt` `Sitemap:` line says www at once. The apex then 301s to www (F-D3-2, a Cloudflare dashboard step).
3. **Drop from all generators:** `/feed`, `/login` and `/signup`.
4. **The function returns 500 on a failed select** instead of silently omitting a section, so the fallback in step 1 is used and the failure is visible.
5. **Retire `AdminSEO.generateSitemap()`'s private route list:** it should preview the served sitemap, not build a third one.
6. **Proof** (P17 D6's SEO check, fail-first):
   - `/sitemap.xml` on www lists more than 13 URLs, including every published journal article and course;
   - every `<loc>` host is www;
   - each listed URL answers 200 with a canonical equal to itself;
   - no listed URL redirects to `/login`.

## 5 · Status

**F-D3-3: CAUSE TRACED** (static template served; dynamic generator deployed but unwired; apex host by design). The fix is open (§4) and belongs with P17's implementation unit in D2's queue.
