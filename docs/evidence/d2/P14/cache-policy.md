# P14 — Cache policy per asset class · stated, simulated, verified by fetch

**Gate (GATE_REGISTER, verbatim):** "`Cache-Control`, `ETag` and `stale-while-revalidate` policy stated per
asset class and verified by fetch; the cache-hit target in M13 and V5 traced to the rules that produce it."
**Proof type (R-82):** structural — a model of the Pages `_headers` merge run in CI, plus one fetch per class.
Instrument: `scripts/web-cache-headers-check.mjs` (`--self-test`, `--static`, `<origin>`). Machine-readable
policy = its `POLICY` and `SOURCE_POLICY` tables; this file is the prose.

## 1 · The policy

| class | Cache-Control | ETag | set by | why |
|---|---|---|---|---|
| Document / SPA shell / deep links (staging) | `no-store, no-cache, must-revalidate, proxy-revalidate` | — | `public/_headers` `/*` | the shell names one deploy's hashed chunks; a cached shell asks for deleted chunks |
| Document (production) | `public, max-age=0, s-maxage=60` | yes | **zone Worker `seo-edge-injector`** (F-D2-12) | browser never caches; edge 60 s |
| Hashed build asset `/assets/*` | `public, max-age=31536000, immutable` | yes | `functions/assets/[[path]].ts` (sets it) | content-hashed names never change content |
| Missing hashed asset | `no-store, no-cache, must-revalidate` + **404** | — | same Function | a cached miss = the 30-day poisoned-chunk bug |
| Unhashed image `/images/*` | `public, max-age=86400, stale-while-revalidate=604800` | yes (304 on revalidate) | **`functions/images/[[path]].ts` (new)** | replaced in place (`logo.png`), so a day fresh, a week SWR — never `immutable` |
| Root public files (robots, manifest, sitemap, favicon, og-image, llms.txt) | `no-store, …` | yes | `/*` | tiny, must change the moment they are edited |
| Service-worker script `/sw-image-cache.js` | `no-store, …` | yes | `/*` | a cached SW script delays every SW update |
| Config Function `/config/site-settings` (P4, #328) | `public, max-age=60, stale-while-revalidate=600` | yes = sha256 of body, 304 on match | `functions/config/site-settings.ts` | versioned; an admin edit reaches members ≤ 60 s |
| SEO Functions (`/page`, `/journal`, `/courses`, `/competitions/:id`, `/featured-artist`) | `public, max-age=0, s-maxage=1800, stale-while-revalidate=86400` | — | `functions/_seo.ts` | crawlable HTML, edge 30 min, served stale a day while refreshing |
| Member media (Supabase Storage buckets) | `max-age=31536000` set at upload | — | `supabase/functions/fix-cache-headers` (**D1 lane**, re-uploads) | out of D2's lane; listed so the class is not missing — not measured here |

## 2 · What was wrong (measured by curl, both lanes, ~08:42 UTC 2026-10-04)

Pages gives a request **every** matching `_headers` rule and comma-joins a repeated header. `/*` sends
`no-store`, so every more specific Cache-Control rule was appended to it and lost:

```
GET /images/logo-fallback.webp   (staging and production)
cache-control: no-store, no-cache, must-revalidate, proxy-revalidate, public, max-age=2592000, immutable, public, max-age=31536000, immutable
cf-cache-status: BYPASS
GET /competitions   (staging)
cache-control: no-store, no-cache, must-revalidate, proxy-revalidate, public, max-age=300, s-maxage=600, stale-while-revalidate=86400
cf-cache-status: DYNAMIC
```
**F-D2-11:** nine rules in `public/_headers` (`/images/*`, `/*.webp`, `/*.woff2`, `/competitions`, `/discover`,
`/journal`, `/courses`, `/featured-artist`, `/certificates/*`, `/winners`) never took effect. The boot-loader logo
(the harness LCP element, F-D3-4) was re-downloaded on every page load. `/assets/*` escaped only because its
Function **sets** the header (that Function's own comment records the same defect, found in August).

## 3 · The change
- `functions/images/[[path]].ts` — same proven mechanism as `/assets/*`: pass the file through, **set** one
  Cache-Control; SPA-fallback HTML → uncached 404.
- `public/_headers` — the nine dead rules removed (template-only comment records why). On the wire this changes
  nothing for those page routes: they were already effectively `no-store`. `_headers` has no documented way to
  remove an inherited value inside the replacing rule (Pages docs, "Headers": detaching with `! ` exists but its
  order semantics are not documented), so no rule relies on it.

## 4 · Proofs
| instrument | reading | UTC |
|---|---|---|
| `--self-test` | PASS: 6 header shapes + the merge model flags the old `/images/*` template | 2026-10-04 08:44 |
| merge model on the **old** `public/_headers` (origin/staging `64a0d66`) | 6 of 13 sample paths contradictory; `/images/logo-fallback.webp` resolves **byte-identical** to the live header above | 2026-10-04 08:44 |
| `--static` on this branch | 13 sample paths, **0 contradictory**; 3 Function sources, 0 off-policy | 2026-10-04 08:45 |
| `src/__tests__/cacheHeadersPolicy.test.ts` | 9/9; mutants: old `_headers` → 1 red; images Function set to 1 year → 2 red | 2026-10-04 08:46 |
| by fetch, staging, **before** merge (`before-staging.json`) | 8 classes: 6 PASS, **1 FAIL = `/images/*`** (the defect), 1 ABSENT (`/config/site-settings`, #328 not deployed) | 2026-10-04 08:45:26 |
| by fetch, production, before (`before-production.json`) | same: 6 PASS, 1 FAIL `/images/*`, 1 ABSENT | 2026-10-04 08:45:31 |

After merge the same command must read `/images/*` PASS on staging; `d2-cache-headers.yml` (dispatch + daily
06:17 UTC) does exactly that — monitoring, never a merge gate (R-82).

## 5 · Cache-hit trace (M13, V5)
**M13 and V5 are not defined anywhere in the repository** (`grep -rnE "(M13|V5)" docs` → only the P14 row,
2026-10-04 08:43 UTC) nor found by a Project search. The rules that can produce a CDN hit are therefore traced,
and the numeric target is an ask:

| class | can the edge serve it without the origin? | measured cf-cache-status (staging, 08:44) |
|---|---|---|
| `/assets/*` | yes, 1 year, immutable | **HIT** |
| `/images/*` | yes after this PR (1 day + 7 days SWR) | BYPASS before |
| `/config/site-settings` | yes, 60 s + 600 s SWR, 304 on ETag | not deployed |
| SEO Functions | yes, 1800 s + 1 day SWR | — (per slug) |
| document / public root files | no (no-store) by design | DYNAMIC / BYPASS |

By bytes the hashed assets dominate (P15: 246 of 266 text responses, ~5.4 MB decoded), and they are the class
that HITs. **Ask:** the Auditor supplies the M13/V5 target sentence, or retires the reference.

## 6 · Findings
- **F-D2-11** dead `_headers` rules (above) — fixed here.
- **F-D2-12** production HTML caching is set by the zone Worker `seo-edge-injector` (`x-seo-edge: injected:…`,
  `cache-control: public, max-age=0, s-maxage=60`), source in `cloudflare/seo-edge-injector/worker.js`; staging has
  no such Worker, so the two lanes differ for the document. `cloudflare/**` has no lane owner. Same object as
  D3's F-D3-1/F-D3-2.
