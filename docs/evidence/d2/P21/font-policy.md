# P21 — Font policy · stated, enforced, first paint measured throttled

**Gate (GATE_REGISTER, verbatim):** "font strategy stated — subset, preload, `font-display` — and first-paint
text measured with the network throttled."
**Proof type (R-82):** structural guard in CI + a synthetic, deterministic throttled harness with a mutant.

## 1 · The strategy (what ships today, now written down and enforced)
| question | policy | why |
|---|---|---|
| families | **Inter 400/500/600/700 + Space Mono 400/700**, one Google Fonts `css2` request | Lora was dropped 2026-08-07 (loaded everywhere, used nowhere) |
| **font-display** | **`swap`** (`&display=swap`; any local `@font-face` must declare swap/optional/fallback) | text paints at once in the fallback; the web font swaps in |
| blocking | **non-blocking**: `media="print" onload="this.media='all'"` + `<noscript>` twin | a blocking font stylesheet puts a Google round trip before first paint (measured below) |
| **preload** | **no font `<link rel=preload>`; preconnect to `fonts.googleapis.com` and `fonts.gstatic.com crossorigin`** | Google's font URLs are versioned and per-subset, so a hard-coded preload goes stale silently and double-downloads; preconnect is the stable equivalent. `crossorigin` because font fetches are CORS |
| **subset** | Google's per-script `unicode-range` subsets; the browser fetches only ranges a page uses | no self-hosting, no build step. **Inter and Space Mono have no Devanagari/Bengali**: Hindi, Marathi and Bengali render in the system font by design (relevant to P24) |
| fallbacks | every `--font-*` stack ends in a generic family | "font not loaded" is never "no text" |
| boot loader | its text is `font-family:system-ui` inline | first-paint text never waits on a web font |
| forbidden | CSS `@import` of a web font | the 2026-08-07 render-blocking regression |

Enforced by `scripts/web-font-policy.mjs` (static mode) in `.github/workflows/d2-font-policy.yml` and
`src/__tests__/fontPolicy.test.ts`.

## 2 · Guard proofs
| instrument | reading | UTC |
|---|---|---|
| `--self-test` | 10/10 shapes (policy clean; render-blocking, display=block, extra family, gstatic without crossorigin, font preload, CSS @import, @font-face without display, stack without generic, no noscript → each a violation) | 2026-10-04 ~09:05 |
| static on this branch | 0 violations, PASS | 2026-10-04 ~09:05 |
| `fontPolicy.test.ts` | 5/5 — incl. three REAL-file mutants (index.html made blocking, `display=swap` removed, `src/index.css` stack stripped) each red | 2026-10-04 ~09:06 |

## 3 · First paint, network throttled (`--measure`)
Profile `android-mid-2026` from `scripts/web-vitals-report.mjs` (**emulated, `realDevice: false`**): 360×800 @3x,
**4× CPU, Slow 4G** (150 ms latency, 1.6 Mbps down). Build: origin/staging 64a0d66, staging lane. `dist/` is served
locally; the server also plays the font host and answers the font stylesheet and file **after a chosen delay**.
Every other host is unresolvable (`--host-resolver-rules`) — no backend, no third party. (Playwright `route()` is not
used: routed responses bypass the throttled network stack.) 3 runs per variant, median.

| variant | FCP median (samples) | font stylesheet arrives |
|---|---|---|
| policy, font delay 0 ms | **4,092 ms** (4092, 4112, 4064) | 367 ms |
| policy, font delay 8,000 ms | **4,064 ms** (4064, 4068, 4056) | 8,213 ms |
| **MUTANT** stylesheet made render-blocking, delay 8,000 ms | **8,276 ms** (8264, 8276, 8300) | 8,211 ms |

Reading 2026-10-04T09:04:53Z — `first-paint-throttled.json`.
**Result:** under the policy, first paint does not move when the font is 8 s late (4.09 → 4.06 s); the
render-blocking mutant's first paint waits for the font stylesheet (8.28 s). The measurement can fail, and the
policy is what keeps it from failing. The ~4.1 s floor is the app's own boot cost under this profile (entry
chunk, F-D2-10 / P13), not fonts.
Limits, stated: the synthetic font is DejaVu Sans TTF (~700 KB), far larger than a Google woff2 subset, so its
arrival time is not representative and is not reported as a result; FCP is the metric the gate names.
