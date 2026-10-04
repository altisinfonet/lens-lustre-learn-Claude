# P17 · First-paint and SEO decision

**Unit:** P17 · **Lane:** D2 (written by the D3 session, docs only) · **Date:** 2026-10-04 · **Status:** waiting for the Owner's signature · **Path:** `docs/evidence/d2/phase5/P17/` (MASTER R-82 rule 2 restricts D3 to `phase5/**`. GATE_REGISTER names `docs/evidence/d2/P17/`; the Auditor reconciles the two)

**Gate (GATE_REGISTER.md, verbatim):** "a written decision on server-side rendering or prerendering for public pages, with first-paint measured on a mid-range device; SEO given an owner and a gate."

> **OWNER SIGN-OFF:** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

To sign, tick the box and fill in the line in GitHub's editor, or comment `P17 approved` on this PR. A signature with changes ("approved, but SEO owner = X") counts too. The Auditor records whichever you choose.

---

## 1 · The decision

| # | Decision |
|---|---|
| D1 | **No full server-side rendering.** The app stays a Vite SPA. A Next/Remix-style migration would mean rewriting the router and data layer and running two runtimes, and the Capacitor Android/iOS apps need a static bundle. That cost buys nothing the next row can't deliver. |
| D2 | **Prerender the public content routes at the edge, body as well as head.** The Pages Functions that already inject `<head>` for `/journal/:slug`, `/courses/:slug`, `/competitions/:id`, `/featured-artist/:slug`, `/page/:slug` and `/profile/:id` (public profiles only) will also write a plain-HTML summary inside `#root`: the h1, the intro text and the hero image with width/height. React replaces it on mount. This is a **separate implementation unit (D2 lane, Phase 5)**. It is not part of this PR. |
| D3 | **One SEO renderer.** Pages Functions (`functions/_seo.ts`) are the only thing that writes SEO tags: they live in git, they are lane-aware, and they are tested. The dashboard-deployed Worker `seo-edge-injector` is retired, or cut down to one job: the apex → www 301. See F-D3-1 and F-D3-2. |
| D4 | **Canonical host = `https://www.50mmretina.com`**, the same value as production's `SITE_ORIGIN`. The apex answers with a 301 to www. Every canonical tag, `og:url` and sitemap `<loc>` uses www. |
| D5 | **Named SEO owner: Neil Basu (Owner)**, accountable for this decision. The work is done in the D2 lane. Change the name in the sign-off line if someone else should hold it. |
| D6 | **SEO gate** (a new D2 check, built with D2's implementation unit and run on every promotion): for every URL in the production sitemap → HTTP 200 · exactly one `<link rel="canonical">` · canonical host = www · canonical equals the requested URL · `og:url` equals the canonical. Apex `/` → 301 to www. `staging.50mmretina.com/robots.txt` = `Disallow: /`. Any miss **fails the check**; it does not just warn. |
| D7 | **First-content target for D2's implementation unit:** throttled time-to-content on the public content routes **≤ 3.0 s** (it is 5.5–10.1 s today, §2). P18 tracks the real-device figure per release. |

## 2 · First paint, measured 2026-10-04 on production `www.50mmretina.com`

**Instrument:** `scripts/web-vitals-report.mjs` 0.5.0, profile `android-mid-2026`: emulated Samsung A53 (SM-A536B) UA, 360×800 @3x, CPU 4× throttle, Slow 4G (150 ms / 209 715 B/s down / 96 000 B/s up). **`realDevice: false`.** 3 runs per route; medians shown.

```
node scripts/web-vitals-report.mjs --url=https://www.50mmretina.com \
  --routes="/,/journal,/journal/art-of-golden-hour-photography,/competitions,/courses/documentary-photography-masterclass" \
  --runs=3 --chromium=/opt/pw-browsers/chromium-1194/chrome-linux/chrome --out=docs/evidence/d2/phase5/P17
```
Run with `--out=docs/evidence/d2/P17`. The file was then moved unchanged into `phase5/P17/` (MASTER R-82 rule 2). File `web-vitals-2026-10-04T07-49-50-877Z-4bc009aa.ndjson`: 21 records, run 07:47:29 → 07:49:50 UTC.

Time-to-content uses the same profile, a separate Playwright probe (source in §5), file `time-to-content-2026-10-04T07-50-20Z.ndjson`, 07:50:20 → 07:52:16 UTC. It is the time from navigation until the page's real heading is visible.

| route | TTFB | FCP = LCP | **time to real content** (median of 3) |
|---|---:|---:|---:|
| `/` | 407 ms | 2412 ms | **6673 ms** |
| `/journal` | 402 ms | 2336 ms | **6900 ms** |
| `/journal/art-of-golden-hour-photography` | 374 ms | 2588 ms | **9436 ms** |
| `/competitions` | 365 ms | 2304 ms | **5676 ms** |
| `/courses/documentary-photography-masterclass` | 383 ms | 3548 ms | **8186 ms** |

**What the numbers say:** the server answers in about 0.4 s. The member sees the boot loader at about 2.3–3.5 s, and the actual article 5.5–10 s after they tap. The gap is the SPA: download, parse, then fetch the content. D2 (prerendered body) removes exactly that gap for the public routes.

**Caveat, stated plainly (F-D3-4):** in all 15 samples the "LCP" element is `IMG /images/logo-fallback.webp`, the boot loader's logo. So the harness's LCP measures the loader, not the content, and FCP = LCP everywhere. Time-to-content is the honest figure for this decision.

**Real-device leg:** not taken in this session (no device). It is **deferred to P18** (real-device Core Web Vitals per release) under Owner rule 9. **The Auditor rules** whether this emulated mid-range reading satisfies P17's "measured on a mid-range device".

## 3 · Findings from the running system (2026-10-04)

- **F-D3-1 · Two SEO renderers in production, and the canonical host flips between requests.** 07:47:02 UTC: 8 fetches of `/journal/art-of-golden-hour-photography`. Some came back `x-seo-edge: injected:journal` with canonical `https://50mmretina.com/...` (the Worker); others came back `x-seo-edge: fallback` with canonical `https://www.50mmretina.com/...` (`functions/_seo.ts`, `s-maxage=1800`). The same request on the same host gives a different canonical. Search engines treat that as two candidate URLs per page.
- **F-D3-2 · The live Worker does not match git.** `cloudflare/seo-edge-injector/worker.js` (commit `0018271`, 2026-08-05) issues a 301 from apex to www. Live, `https://50mmretina.com/journal` answered **200, no Location** at 07:46 UTC. The Worker is paste-deployed in the dashboard, so git does not describe what is running.
- **F-D3-3 · The sitemap is thin and on the apex.** Shortly before 07:46 UTC, live `/sitemap.xml` held **12** `<loc>` entries, all `https://50mmretina.com/...`, all static routes. It has no journal articles, courses or competitions, and its `/feed` and `/login` entries are app screens. The cause was not traced in this session (`scripts/generate-seo-assets.mjs` derives the host from `VITE_SITE_ORIGIN`). This is the SEO owner's first item.
- **F-D3-4 · The baseline LCP is the loader's logo** (see §2). It affects how P13/P18 read LCP. Recommendation to D2: measure a content element, or record the LCP element beside every figure.
- Crawler-visible body today: `#root` holds only the boot loader (920 characters of loader markup, the same on every route checked at 07:46 UTC). Non-JS crawlers and unfurlers get the head tags only.

## 4 · What happens after signature

1. Auditor: mark P17 closed on this signed decision (the gate closes on the decision, not on D2's implementation unit).
2. D2: one implementation unit (D2 + D3 + D4 + D6), staging first, with before/after time-to-content measured using §5.
3. Owner (dashboard, once D2's PR is ready): retire the `seo-edge-injector` routes, or replace its code with the 301-only version from git. This is a click in Cloudflare; no session can do it.

## 5 · Time-to-content probe (as run, not committed as a script)

Run from the repo root with Playwright installed. For each route and selector it does 3 runs, each in a new context: `Network.emulateNetworkConditions{latency:150, down:209715, up:96000}` + `Emulation.setCPUThrottlingRate{rate:4}`, then `goto(waitUntil:'commit')` → `waitForSelector(sel, visible)`. The figure is the elapsed ms.
Selectors: article/course `h1` · `/journal` `a[href^="/journal/"]` · `/competitions` and `/` `main h1, main h2`. Each sample records the matched text, so a wrong element shows up in the file.
