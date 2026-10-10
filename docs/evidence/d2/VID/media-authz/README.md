# media-authz Worker · `video/` branch (D2; Owner deploys) — 2026-10-10 UTC

Spec: VID-1 DECISION §9.1/§9.3/§9.4, §12.14; D-003 handover §4. Token contract: `src/lib/video/shared/playToken.ts` (#385), imported, not copied.

- `before.txt`: the test set against today's behaviour (every key passed to the public bucket, F-D3-18) → **28 failed / 2 passed**
  (the 2 that pass are "photos go to the origin untouched" — they must, and still do after).
- `after.txt`: **31/31** (handler + the built `worker.js`).
- `mutants.txt`: **16/16 killed**.
- Bundle: `worker.js` 8869 bytes, no lane literals; `--check` exits 1 on a hand edit (verified).
- Not covered by unit tests, verified at deploy (README step 7): that `fetch(request)` on the route reaches the
  bucket's custom domain for photos; that `caches.default` behaves as the fake does.
