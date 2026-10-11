# VID-1 · CSP media-src / worker-src — real Chrome proof

**Symptom (Owner, staging, 2026-10-11):** a plain H.264 + AAC MP4 (ffprobe: h264 High, aac LC, 720x1280) showed "this file is not a video we can play"; preview stuck at 0:00.

**Cause:** public/_headers CSP had no media-src, so media fell back to default-src 'self' and Chrome refused every blob: video — the composer preview, readVideoFacts, the web encoder's hidden <video>, and hls.js feed playback (MediaSource blob: URL).

**Change:** media-src 'self' blob: https://__CDN_HOST__ (Safari native HLS loads the playlist from the CDN host). worker-src 'self' only: hls.js is given workerPath = its own dist/hls.worker.js emitted to /assets/ (hashed), so no blob: worker is needed. Correction (independent review of #396): before this PR worker-src fell back through child-src to script-src ('self' + listed hosts), not to default-src; same-site workers were already allowed, blob: workers were not and still are not.

**Instrument:** csp-proof.mjs — Playwright + installed Google Chrome (channel chrome), Windows 11, 2026-10-11T08:22:14Z. Page served with the staging CSP exactly (__CDN_HOST__ = cdn-staging.50mmretina.com). OLD = origin/staging, NEW = this PR.

```
OLD  | preview/encoder: BLOCKED (error code 4) | feed player (MediaSource): MSE BLOCKED | hls worker (/assets): SAME-SITE WORKER OK | blob worker refused
NEW  | preview/encoder: LOADED 1280x720 3.0s | feed player (MediaSource): MSE OPEN | hls worker (/assets): SAME-SITE WORKER OK | blob worker refused
```

Build check: vite build emits assets/hls.worker-<hash>.js (118,233 B, under the 160 KiB default chunk ceiling) and a 63 B module exporting its URL.

Tests: cspMediaSrc.test.ts (media-src red before the change; worker-src asserted to be exactly 'self' + FeedVideoCard passes workerPath), FeedVideoCard + certificatePreview green; tsc -b 0. Independent security review: ACCEPT-WITH-CONDITIONS, both conditions met here.
