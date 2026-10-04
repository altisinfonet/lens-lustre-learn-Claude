# P15 — Brotli or gzip on every text response · measured by fetch

**Gate (GATE_REGISTER, verbatim):** "Brotli or gzip confirmed active on every text response, measured, recorded once."
**Proof type (R-82):** structural — every text response the app can load is enumerated from the
deployed artefacts themselves and fetched; no traffic reading is involved.

## Instrument
`scripts/web-compression-check.mjs <origin>` — `curl -H 'accept-encoding: br, gzip'` (no `--compressed`, so
wire bytes are counted), decoded with Node zlib. The list is **derived, not typed**:
1. `/` and one SPA deep link (`/explore`);
2. every `/assets/*.js|css` named in the document, then every one named **inside the fetched JS**, walked to a
   fixed point — Vite writes each lazy chunk's file name into its importer, so this reaches every route chunk;
3. every text file in `public/` (read from the repo);
4. the text Pages Functions `/config/site-settings` (P4) and `/page/about`, marked **ABSENT** (never PASS) when
   the origin answers them with the SPA fallback.

Verdict: PASS = `br`/`gzip` and decodes; FAIL = identity-encoded text ≥ 1024 B, or any non-200;
TINY = identity text < 1024 B (printed, not failed — no CDN compresses a 23-byte body).

## Readings
| origin | UTC | responses | PASS | TINY | FAIL | ABSENT | text wire / decoded |
|---|---|---|---|---|---|---|---|
| staging.50mmretina.com | 2026-10-04T08:38:33.759Z | 266 | 263 | 1 | **0** | 2 | 1,639,184 / 5,526,211 B = 29.7 % |
| www.50mmretina.com | 2026-10-04T08:39:24.451Z | 266 | 264 | 1 | **0** | 1 | 1,645,589 / 5,540,230 B = 29.7 % |

Every compressed response on both origins is **Brotli** (265/266; gzip 0). Composition: 246 JS/CSS chunks,
16 `public/` text files, the document, one deep link, two Function routes.
Raw rows: `compression-staging.json`, `compression-production.json` (this folder).

- **TINY (1, both origins):** `/assets/storyTiming-*.js`, 23 B, identity. Below any compression threshold.
- **ABSENT:** `/config/site-settings` on both origins (P4 / #328 not merged yet); `/page/about` on staging only
  (production's page Function answered with its own injected HTML). Re-run after #328 lands to cover the route.

Largest responses on production (wire vs decoded):

| path | enc | wire B | decoded B | ratio |
|---|---|---|---|---|
| `/assets/index-DOsR0g45.js` | br | 480,255 | 1,593,171 | 30.1 % |
| `/assets/AdminAnalytics-RM_UNGTs.js` | br | 108,845 | 412,267 | 26.4 % |
| `/assets/jspdf.es.min-BA1NZ5Aa.js` | br | 125,460 | 385,165 | 32.6 % |
| `/assets/index-B_VetDRI.css` | br | 30,878 | 207,880 | 14.9 % |
| `/assets/index.es-Mop-qtl5.js` | br | 53,504 | 158,303 | 33.8 % |
| `/assets/CinemaJudgeView-wPMcPbYC.js` | br | 38,370 | 156,157 | 24.6 % |

## Fail-first (C-34)
- `--self-test`: 9/9 header shapes — identity text, identity JSON, identity SVG, deflate, a 404 chunk all FAIL;
  tiny text TINY; PNG SKIP; br and gzip PASS. `src/__tests__/compressionCheck.test.ts`: 14 tests incl. the
  exact 1024 B boundary and the lazy-chunk walk.
- Real response, real verdict: the entry chunk fetched with `accept-encoding: identity`
  (`/assets/index-D0t7eOh3.js`, staging, 2026-10-04 08:40:35 UTC) arrived with no `content-encoding`,
  1,593,167 B, and `classify()` returned **FAIL** `identity-encoded text, 1593167 B`. The checker fails on the
  thing it guards.

## Guard after the reading
`.github/workflows/d2-compression.yml` — PR: self-test. Push to staging/main + dispatch: re-measures the lane's
origin and fails on any FAIL row (monitoring after the record, R-82: never a wait).

## Finding for P13
**F-D2-10:** the entry chunk `index-*.js` is **1,593,167 B decoded** (Brotli on the wire keeps the
transfer down, but parse/compile cost is paid on the decoded size). P13's ceiling is set against this.
