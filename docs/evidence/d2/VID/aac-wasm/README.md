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
