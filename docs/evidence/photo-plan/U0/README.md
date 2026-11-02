# Smart Photo Plan — U0 measure (read-only)

Measured 2026-11-02 10:34 UTC by the local photo-plan runner, on **production**
(`cdn.50mmretina.com`), from 40 public post photos spread over the 571 newest
photo posts (anon REST read of `posts.image_urls`, then GET/HEAD on the CDN).
Nothing was written anywhere except `measure-live.json` in this folder.
Script: `u0-measure.cjs` (this folder) — same numbers re-measure on any day.

## What is stored today (per photo, average of 40)

| Copy | Avg KB | Notes |
|---|---|---|
| "original" | 735 | already a WebP q0.92 re-encode capped at 2560 px (avg long edge 2,134 px) — no camera originals for posts |
| `-thumb` 600 | 37 | q0.7 |
| `-r1080` | 140 | only on `-l3` uploads (30 of 40) |
| `-r1440` | 240 | only on `-l3` uploads |
| **total stored** | **1,028** | |

## The new set (same 40 photos, re-encoded with sharp, no upscaling)

| Copy | Quality | Avg KB |
|---|---|---|
| 2048 (full screen + zoom) | 0.85 | 357 (0.92 would be 507) |
| 1080 (feed) | 0.82 (today's rung quality) | 127 |
| 600 (small screens / weak network) | 0.78 | 41 |
| 320 (grids) | 0.75 | 12 |
| **total stored** | | **537** |

## The true saving

* **Storage per photo: −47.7 %** (1,028 KB → 537 KB). Smaller than the 85–90 %
  the plan estimated, because posts never stored camera originals: today's
  "original" is already a 2560 px WebP. The saving comes from 2560 → 2048, q0.92 →
  q0.85 and dropping the 1440 rung.
* **Full-screen photo: −51.4 %** (735 KB → 357 KB per open).
* **Grid tiles: −66.8 %** (600 thumb 37 KB → 320 tile 12 KB).
* Feed card (1080): 140 → 127 KB (−9 %); feed was already on 1080 for `-l3` posts.
* Competition entries are not in this sample (they keep full resolution, no cap,
  until results + 30 days — decision 5); their saving is larger and is measured in U6.

The chosen qualities (0.85 / 0.82 / 0.78 / 0.75) are the ones U1 and U5 use.
