# VID-1 · Firefox can post videos (AAC from WASM) + clear message for undecodable formats

**Found by:** cross-browser run on LIVE staging (1c87c42), 2026-10-11: Chrome/Edge read 10/10 test videos and encode H.264+AAC; **Firefox 157 reads 10/10 but has no AAC encoder** (WebCodecs AudioEncoder: opus yes, mp4a.40.2 no) → every Firefox upload was refused "use the app". WebKit (Playwright Windows build) has no media at all — not representative of Safari.

**Change**
- `src/lib/video/aacWasm.ts` + `aacWasm.worker.ts`: FFmpeg's AAC-LC encoder in WASM (`@mediabunny/aac-encoder@1.61.3`, MPL-2.0; core = FFmpeg libavcodec LGPL-2.1), used ONLY when the browser has no native AAC. Worker is a module emitted by Vite to /assets/ (CSP keeps `worker-src 'self'`; the package's own bundle would have needed `blob:`).
- `scripts/web-aac-core-esm.mjs`: the core mixes CJS + ESM; this plugin rewrites it to ESM and FAILS the build if the file changes shape.
- CSP: `script-src` gains `'wasm-unsafe-eval'` (WASM compile only; `'unsafe-eval'` still absent). Core checked: no `eval(`, no `new Function`.
- `limits.ts readVideoFacts`: proves one frame decodes (8 s) and, if the header reads but frames do not, says why and what to do (VID-META-003). `webEncoder.ts`: 10 s no-frame watchdog (VID-ENC-004). Before: Firefox + HEVC / 10-bit **hung forever**.
- Bundle budget: named ceiling `aacWasm.worker.js` 716,800 B (measured 699,195 B). Loaded only by browsers without native AAC, only when a video is posted — never on page load.

## Results (real browsers, this PC, production encoder, judged by /api/video/complete's rules)
| Browser | 10 formats | Notes |
|---|---|---|
| Chrome | 10/10 encode, 0 problems | enc-chrome.txt |
| Edge | 10/10 encode, 0 problems | enc-msedge.txt |
| Firefox 157 | 7/10 encode, 0 problems (AAC via WASM) | 3 refused **immediately with the clear message**: H.265 MP4, H.265 MOV (iPhone), 10-bit H.264 — Firefox cannot decode these at all (enc-firefox.txt) |

**Under the exact staging CSP + 'wasm-unsafe-eval'** (dev harness served with the policy; csp-encode-output.txt): Firefox, Chrome, Edge — H.264 MP4, MOV, WebM encode with audio, 0 problems, **0 CSP violations**; HEVC: Chrome/Edge encode, Firefox clear message.

**Not testable here:** real Safari/iOS (needs an Apple device). Safari 26+ has native WebCodecs AAC; if not, the same WASM fallback applies.

Tests: `aacFallback.test.ts` 12 — fail-first: 3 red on the old encoder/CSP (Firefox support ×2, wasm CSP), 12/12 after; video suite 46/46; `tsc -b` 0; budget 262 checks PASS.

## Security review (independent sub-agent) — ACCEPT-WITH-CONDITIONS; LOW findings fixed in this PR
- **Background tab:** browsers stop frame callbacks in a hidden tab while the muted video keeps playing (lost frames / false "can't play"). Now the encoder pauses while hidden and resumes on return; it also handles a tab hidden *before* the video stage starts. Proof `tabswitch-output.txt` (12 s hidden mid-encode): Firefox and Chrome both finish, 0 problems (before the fix: 3 problems).
- **Stuck worker:** per-request time limits (init 60 s, frame 15 s) + `messageerror` handler → clear VID-ENC-003 instead of a hang.
- **Autoplay refused:** NotAllowedError no longer reported as "can't play this format"; `v.load()` releases the decoder.
- **Licences:** `public/third-party-notices.txt` (FFmpeg LGPL-2.1, mediabunny MPL-2.0, hls.js Apache-2.0, mp4-muxer MIT).
- Supply chain (LOW, accepted): 1.61.3 is 6 days old, single maintainer; pinned exactly, sha512 from registry.npmjs.org, no install scripts.

Re-run after the fixes: Chrome 10/10, Edge 10/10, Firefox 7/10 + 3 clear refusals (enc-*.txt).
