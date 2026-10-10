# Image derivative pipeline — Step 2a measurements

**Date:** 2026-08-13 · `origin/main` = `8259c5b` (code `eb12243`) · nothing written, nothing shipped.
This is the read-only measurement pass the status doc demanded before choosing sizes
("choose the sizes from real device measurements, not round numbers").

---

## 1. Which hosts transform TODAY (trap #1 re-verified)

Probed with a real `<img>` from a page on **www.50mmretina.com**, 2026-08-13:

| Request | Result |
|---|---|
| direct `cdn.50mmretina.com/...webp` | **200, 2000×1333** |
| `https://50mmretina.com/cdn-cgi/image/...` (apex) | **FAILS** (`onerror`) |
| `https://www.50mmretina.com/cdn-cgi/image/...` | **200, 900×599** |
| `https://cdn.50mmretina.com/cdn-cgi/image/...` | **200, 900×599** |

Identical to what `src/lib/cdnImage.ts` recorded on 2026-08-10. The zone rules have
**not** moved since. The host `cdnImage.ts` hardcodes (`cdn`) is correct today.

Every requested width was honoured exactly: 600, 900, 1080, 1200, 1440, 1600, 2000.

⚠ **NOT yet tested from the Android WebView origin.** That is the third origin and it
is the one that showed no photos at all for builds 1035–1051. It must be tested there
before anything ships.

## 2. NEW FINDING — `/cdn-cgi/image/` responses carry no CORS headers

Measured from a www page, same session:

- `fetch()` of any transformed URL → `TypeError: Failed to fetch` (all 7 widths).
  `fetch()` of the **stored** original and thumbnail → succeeds (335 KB / 15 KB).
- `new Image(); img.crossOrigin = "anonymous"` → **stored original loads and the
  canvas is untainted; the transformed URL fails to load at all.**

This matters because `src/lib/imageCompression.ts:150-157` (`loadImageFromUrl`) sets
`crossOrigin = "anonymous"`, and it is what `downloadImageAsJpeg()` → `DownloadButton`
uses. **A transformed URL must never reach the download or save-file path.** Today it
does not — the viewer and the download button are handed the original `src` — and that
must stay true. Failure mode if it ever changes: `loadImageFromUrl` rejects,
`useDownloadImage` catches and falls back to `window.open(url)`, so "Download" silently
stops saving a file and just opens a tab.

Second consequence: **delivered byte size of a transform is not measurable from a
page** (no CORS, no `Timing-Allow-Origin`, `transferSize` is 0). Real savings have to
be read from the Cloudflare dashboard.

## 3. What production actually serves (queried, not assumed)

210 posts, **258 image slides**:

| | count |
|---|---|
| slides on `cdn.50mmretina.com` | 230 |
| slides on Supabase storage | 28 |
| with a usable stored thumbnail | 221 |
| with `-w<W>h<H>` in the filename | **105** |
| **rendering with NO `srcset` at all** | **153 / 258 = 59%** |

`buildThumbFirstSrcSet()` bails unless `intrinsicFromName()` finds `-wWhH`, so **59% of
all slides download the full original on every device, phone included** — regardless of
whether a thumbnail exists. 116 slides *have* a thumbnail that cannot be offered
because the dimensions are missing from the name. This is larger than the status doc
states and it is a backfill problem, not a sizing one.

Original widths (the 105 that declare them): min 720 · p25 1080 · **median 1620** ·
p75 2048 · p90 2560 · max 2560. 70 landscape / 34 portrait / 1 square.

## 4. Live feed, measured (desktop, www, logged in, innerWidth 1536, DPR 1.25)

- Sharp image slot: **exactly one value, 590 CSS px** → 738 device px at this DPR.
- `sizes` = `(max-width: 768px) 100vw, 600px` — correct against that 590.
- **5 of 10 sharp images had a `srcset`; 5 had none.** Matches the 59% above.
- One card with `srcset` `600w, 2000w` at a 738-device-px slot was **displaying the
  600px copy — 0.81× the slot.** That is the owner's "quality getting very poor",
  visible on the live site right now.
- A second slot family exists at **117 CSS px** (strip/grid), with no `srcset` at all.

**Phone slot — read from CSS, NOT measured on a device.** `.bleed-phone` inside
`@media (max-width: 767.98px)` sets `width: 100vw`, so the slot equals the viewport
width exactly. Window resize in the remote Chrome did not change the page's layout
viewport (`innerWidth` stayed 1536), so this could not be confirmed live here. A real
device check is still owed — it is already backlog item 7.

Derived phone need: 360–430 CSS px × DPR 2.0–3.5 = **720–1505 device px, clustered
around 1080**.

## 5. Byte curve — APPROXIMATION, clearly labelled

Because §2 makes the delivered size unreadable, the 2000×1333 original was re-encoded
locally in the browser (canvas → WebP) at the same widths. This gives the *shape* of
the curve, not Cloudflare's exact output.

| width | q82 | q75 |
|---|---|---|
| 600 | 22 KB | 16 KB |
| 800 | 31 | 23 |
| 900 | 36 | 27 |
| 1080 | **56** | 41 |
| 1200 | 65 | 48 |
| 1440 | **83** | 61 |
| 1600 | 96 | 70 |
| 2000 | 157 | 111 |

Measured for real: stored 600px thumbnail = **15 KB**; stored original as served =
**335 KB**.

⚠ Side finding: the stored original is 335 KB where a local q82 re-encode of the same
pixels is 157 KB. **The originals are roughly twice as heavy as their own resolution
requires.** That is an upload-encoder question, separate from this pipeline.

## 6. Slot → tier mapping this produces

| Surface | CSS slot | device px needed |
|---|---|---|
| strip / grid | 117 | 117–410 |
| feed card, desktop | 590 | 590 (DPR 1) · 738 (1.25) · 1180 (2) |
| feed card, phone | 100vw = 360–430 | 720–1505, clustered ~1080 |
| lightbox / zoom | full viewport | up to 2560; must stay CORS-clean |

Ladder these numbers argue for — **600 / 1080 / 1440 / original**, not the round
600/1200/2000 in the status doc:

- **600** already exists; covers the 117px grid at every DPR and the 590 slot at DPR 1.
- **1080** is the phone feed card at the dominant DPR cluster, and desktop 590@DPR2
  (1180) sits within 10% of it.
- **1440** covers 412×3.5 phones and gives desktop retina headroom.
- **original** for zoom and download only — unchanged, and it must stay the
  untransformed URL for the CORS reason in §2.

Approximate effect on a phone feed card: 335 KB → 56 KB, about **83%** — consistent
with the 89% measured when transforms were briefly live in August.

## 7. The open decision (owner)

How the new tiers are produced:

- **A. Cloudflare transform at read time.** Cheapest to build. But this is zone
  configuration living outside the repository, no test here can see it change, and it
  *has* changed once — that is the whole of trap #1. Also carries the free-plan 5,000
  unique-transform monthly ceiling already noted in `PostMedia.tsx:428`.
- **B. Generate derivatives at upload, store them in R2.** Permanent, CORS-clean,
  testable, no external switch. Costs an upload-pipeline change and a backfill for
  210 existing posts.
- **C. B for new uploads, A as the fallback for legacy posts**, always with the
  per-image `originalOnError` fallback from `cdnImage.ts`.

Separately: the **59% with no dimensions in the filename** need those dimensions
recovered (or width columns added) before any `srcset` can be built for them at all.
