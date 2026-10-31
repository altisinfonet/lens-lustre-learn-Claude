# VID-1 · one picker for photos and videos (Owner 2026-10-11)

**Symptom (Owner):** "in post video not able to post mp4 files — not supported showing … keep the same formats as Instagram/Facebook."
**Cause (read from code):** the composer's photo picker / drop zone / native gallery sent every file to `processFile`, which only accepts images and toasted "File format not supported — MP4 can't be used". The separate video button is hidden while `video_posts` is off for the member, so a picked MP4 could never reach the video uploader.

**Fix:** every picked/dropped file goes through `routePickedFiles` (`src/lib/video/pickRouting.ts`). A video opens `VideoPostComposer` with that file when `video_posts` is on; when it is off the member is told exactly that. Photos are unchanged. The picker offers `video/*` when the feature is on. A video post holds one video; extra files are counted in a toast, never lost silently.

## Formats proven in real Chrome 2026-10-11 (Windows 11, this PC; production H.264 + AAC encoder; result judged by the same rules /api/video/complete applies)
| File | Read | Encoded | Server rules |
|---|---|---|---|
| MP4 H.264 + AAC 720p | ✅ | ✅ 3.7 s | 0 problems |
| MP4 H.265/HEVC (Android default) | ✅ | ✅ | 0 problems |
| MOV H.264 (iPhone "Most Compatible") | ✅ | ✅ | 0 problems |
| MOV H.265 portrait 1080×1920 (iPhone default) | ✅ | ✅ | 0 problems |
| MP4 1080p 60 fps, 44.1 kHz audio | ✅ | ✅ | 0 problems |
| MP4 10-bit, MP4 rotated, MP4 no sound | ✅ | ✅ | 0 problems |
| WebM VP9 + Opus, MKV H.264 | ✅ | ✅ | 0 problems |
Fixtures: 3 s ffmpeg 6.0 testsrc2 clips. Edge reports the same encoder support as Chrome (H.264 + AAC + VP9 + Opus).

## Tests
`src/lib/video/__tests__/pickRouting.test.ts` — 20 tests. Fail-first: before the WallPosts change, the 3 WallPosts tests fail; after, 20/20 pass. `tsc -b` 0 errors.
