# S7-c · VID-5 ad rules + direct video upload in the ad library

**Plan (S7):** "ad rules + direct video upload in ad library (VID-5)". **Spec:** VID-1 DECISION §5 (R-97 as amended by Owner A3.2). **Builder:** S7 cloud session, 2026-10-30.

## Ad rules — already enforced, unchanged
| Rule | Where it is enforced |
|---|---|
| admin only, and only while `video_ads` is on for that admin | `video_begin_upload` (SQL), `ad_videos` policy + link guard; UI hides the buttons |
| 500 MB, no time limit (Owner A3.2), no daily cap | `VIDEO_LIMITS.ad` (`shared/rules.ts`), `video_begin_upload` |
| same story-card spots (2, 5, 10, 15, then every 10) | `feedAdPlacement.ts` — unchanged |
| like / comment / share like a post | existing ad engagement (`adEngagement.ts`) — unchanged |
| library order: spots stay put / Replace picture / Move up/down | `adSpotOrder.ts` — **unchanged**; the new path calls `spotsForNew` |

## What was missing
A video could only be *added to an existing picture ad* ("Add video" on a row). There was no way to make a new ad straight from a video.

## What this adds
- **"Add a video ad"** in Admin → Advertisements → picture library (story-card zone, shown only while Video ads is on for the admin). Pick one video →
  1. a frame (1 s in, else the first frame; `cover.ts coverFromVideoAt`) becomes the ad's picture, stored like every library picture;
  2. the new ad takes the next spot by `spotsForNew` (a freed spot first);
  3. the existing video dialog (`AdVideoButton`) opens for that ad with the video already picked — categories, then the ONE existing pipeline (device encoder or server converter, upload jobs).
- `src/lib/ads/videoAdCreate.ts` (pure, tested) + `initialFile` prop on `AdVideoButton`. No second upload path, no SQL.

## Decisions
- **D-S7c-1** The new ad shows its frame until the video is ready, and keeps it if the video is ever removed or taken down — the same rule as "Add video".
- **D-S7c-2** Closing the dialog without uploading leaves a picture-only ad in that spot (visible, like any new picture); the admin can delete it or add the video later with "Add video".
- **D-S7c-3** No new switch: the button exists only for admins with `video_ads` on (default Off on both lanes).
