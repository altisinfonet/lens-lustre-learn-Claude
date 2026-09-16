# IMAGE DELIVERY — MEASURED, NOT GUESSED (2026-08-17)

Owner: *"Sometime photo half coming? sometimes many images loading very late,
sometimes blurr images. all being showing very slow. This CDN issues?? After
finish all these pending it will be solved??"*

**Answer: the CDN is healthy. The page asks it for the wrong file. And no — the
pending work does not touch image delivery.**

Report delivered: `CDN_Image_Delivery_Measured.docx`.

---

## THE CDN IS FINE

Same 184 KB file, four forced network trips: **137 / 224 / 223 / 226 ms**.
Thumbnails 5–68 KB, consistently ~100 ms. No errors, correct content-type.

## WHAT THE LIVE FEED ACTUALLY REQUESTS

51 CDN photos on one screen of `www.50mmretina.com/feed`, signed in:

| | count | share |
|---|---|---|
| photos from the CDN | 51 | 100% |
| **no srcset — one fixed address for every device** | **42** | **82%** |
| of those, pointing at the FULL-SIZE original | 32 | 63% |
| with a real set of sizes | 9 | 18% |
| **declaring width/height (reserved box)** | **3** | **6%** |

The 6% is the "half coming" and the jumping: 48 of 51 photos land in a box of
unknown height.

## THE COST, IN REAL BYTES

| small copy | full original | ratio |
|---|---|---|
| 12 KB | 184 KB | 15× |
| 20 KB | 144 KB | 7× |
| 34 KB | 573 KB | 17× |
| 68 KB | 1,353 KB | 20× |
| 5 KB | 114 KB | 23× |
| 33 KB | 1,363 KB | 41× |

19 no-srcset photos on one screen = **3.18 MB**, avg 171 KB, largest **716 KB**.

Worst named case: `…-w960h1440.webp`, **716 KB / 960×1440**, rendered in the
"Trending This Week" sidebar tile at roughly **148×148 CSS px**.

## THREE CAUSES

**A. Only `PostMedia` picks a size.** Sidebars, grids, journal/course/discover
covers pass the original address straight through. **117 files** contain a
plain `<img>`.

**B. 153 of 275 stored photos (56%) carry no dimensions in the filename**, so
`buildThumbFirstSrcSet` returns undefined even in `PostMedia` → original.

**C. The 1080/1440 ladder only started producing on 2026-08-16** (8 of 9 on the
17th; 0 on every day before the 16th). **266 of 275 photos have no rungs**, so
the browser chooses between a 600px thumb and the original. A 390pt slot at
DPR 3 needs ~1,170 device px → it takes the original, every time. That is the
blurry-then-sharp: thumb paints in ~100 ms, original replaces it.

## THE OPENING — TESTED LIVE

On-the-fly resizing works **right now** on the CDN host:

```
original                                    960×1440   716 KB   115 ms
cdn.50mmretina.com/cdn-cgi/image/width=320  320×480    works    101 ms
50mmretina.com/cdn-cgi/image/width=320      FAILS
```

The 2026-08-01 removal blamed the transformer; the real fault was calling it on
the **apex**. On the CDN's own host it works. **No re-upload, no migration.**

Honest limit: the resized copy's byte size could not be read — the CDN sends no
`Timing-Allow-Origin` and the transform response carries no CORS header. The
dimensions were confirmed directly (9× fewer pixels).

## FIXES, BY PAYOFF

1. Route every plain `<img>` through the CDN resizer at its displayed size.
   Biggest win, no re-upload.
2. Reserve the box (width/height or aspect-ratio) — kills the half-drawn photos
   and the jump.
3. Backfill the ladder for the 266 older photos.
4. Ask Cloudflare for `Timing-Allow-Origin` — the site is currently blind to its
   own image performance, which is why this went unnoticed.

**None of this is started. It is a separate job from the crop/hashtag/mention/PDF
list.**
