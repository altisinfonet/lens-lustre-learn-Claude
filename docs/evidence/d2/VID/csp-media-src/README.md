# VID-1 · CSP media-src / worker-src — real Chrome proof

**Symptom (Owner, staging, 2026-10-11):** a plain H.264 + AAC MP4 (ffprobe: h264 High, aac LC, 720x1280) showed "this file is not a video we can play"; preview stuck at 0:00.
**Cause:** public/_headers CSP had no media-src → default-src 'self' → every blob: video refused (preview, readVideoFacts, encoder, hls.js MediaSource); no worker-src → hls.js blob: worker refused.

**Instrument:** csp-proof.mjs — Playwright + installed Google Chrome (channel chrome), Windows 11, 2026-10-11T08:15:27Z. The page is served with the staging CSP exactly (template with __CDN_HOST__ = cdn-staging.50mmretina.com), OLD = origin/staging, NEW = this PR.

```
OLD  | preview/encoder: BLOCKED (error code 4) | feed player (MediaSource): MSE BLOCKED | hls worker: WORKER BLOCKED
NEW  | preview/encoder: LOADED 1280x720 3.0s | feed player (MediaSource): MSE OPEN | hls worker: WORKER OK
```

Test: src/lib/video/__tests__/cspMediaSrc.test.ts — 2 of 3 red before the change, 3/3 after.
