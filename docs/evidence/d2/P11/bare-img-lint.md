# P11 (lint half) — a lint rule rejects a new bare `<img>`, failing first

**Gate (GATE_REGISTER, verbatim):** "`OptimizedImage` used on feed, profile and gallery surfaces; a lint rule rejects a bare
`<img>` in `src/components` and `src/pages`; feed bytes on a 3G profile measured before and after against M11's budget."
**This PR closes clause 2 only.** Clauses 1 and 3 are held with a reason (below) — not silently dropped.

## Clause 2 — the rule
- `eslint-rules/no-bare-img.js` — counts JSX `<img>` elements per file in `src/components/**` and `src/pages/**` (tests
  excluded) against `eslint-rules/no-bare-img.baseline.json`. **More than the baseline → an error on each element; fewer →
  "lower the baseline"** (a ratchet that only turns one way); a file not in the baseline has 0; an unreadable baseline is an
  error on every file.
- Baseline, read 2026-10-04 on staging `3408104` by the rule itself: **225 bare `<img>` in 110 files**. (A raw
  `grep "<img"` says 249/113; the difference is comments, test files and the string `"<img"` — the rule counts JSX only.)
- CI: `.github/workflows/d2-bare-img.yml` runs `eslint.bare-img.config.js` — this one rule, `noInlineConfig: true` so an
  `eslint-disable` comment cannot switch it off. A separate config because the main `eslint.config.js` reports ~1,860
  pre-existing errors and is not run in CI (so a rule only there would enforce nothing). It is also registered in the main
  config so editors show it.

## Fail-first (C-34), real files, 2026-10-04 11:04–11:06 UTC
| mutant | result |
|---|---|
| a 6th `<img>` added inside a `<div>` in `src/components/FeedRightSidebar.tsx` (baseline 5) | **6 errors** `Bare <img> (6 in this file, baseline 5)` |
| `src/components/EntryCard.tsx`'s only `<img>` changed to `<picture>` (baseline 1) | **error** `now has 0 … baseline allows 1: lower its entry` |
| a new file `src/components/p11tmp/New.tsx` with one `<img>` | **error** `(1 in this file, baseline 0)` |
| clean tree | 0 errors |

`src/__tests__/noBareImgRule.test.ts` (7, through ESLint's `Linter`): at baseline passes; over fails; unlisted file = 0;
fewer fails; `<picture>`/`<source>`/text not counted; unreadable baseline fails; committed baseline well formed. Rule
mutants: `count > allowed + 1` → 2 red; ratchet branch disabled → 1 red.

## Clauses 1 and 3 — held, with the reason (F-D2-17)
Read from the code, 2026-10-04: **`OptimizedImage` is imported by no file** (`grep -rn OptimizedImage src` → only its own
file). The three named surfaces already use purpose-built responsive components:
- feed — `src/components/post/PostMedia.tsx`: `srcSet` + `sizes={FEED_SIZES}`, a thumbnail-first fallback and `onError` recovery;
- gallery — `src/components/gallery/GalleryImage.tsx`: `srcSet` at 320/480/640 (960/1280 for heroes);
- profile — `src/components/profile/ProfilePostGrid.tsx`: thumbnails with a per-tile `onError` fallback.
`OptimizedImage` has **no `onError` path and no `srcSet` for remote images**; swapping it in would remove both — the 1×1-GIF
history in `public/sw-image-cache.js` is what a missing failure path costs here. So clause 1 needs a ruling: either the gate
means "the responsive image path" (met by the three components; then clause 3 is a 3G measurement of PostMedia), or
`OptimizedImage` must first gain `srcSet` + `onError` (its own unit) before being wired in. **M11 is defined nowhere** in the
repository or the Project, so clause 3 has no budget to measure against yet.
