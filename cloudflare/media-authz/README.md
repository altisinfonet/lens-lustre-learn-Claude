# media-authz — CDN Worker, `video/` branch (VID-1 §9, D-003)

Written by D2, **deployed by the Owner** (Auditor ruling 2026-10-10 07:30 UTC).
Behaviour and reasons: header of `handler.ts`. Tests: `src/lib/video/__tests__/mediaAuthz.test.ts`.

## What changes when it is attached to a CDN host
| Path | Before (today) | After |
|---|---|---|
| `video/…` | served to anyone with the URL (F-D3-18) | play token required; revoked list; 403 zero bytes otherwise |
| `upload/…` | served to anyone with the URL | never served (404) |
| everything else (photos, avatars) | the bucket's custom domain | **the same request passed to the same origin, untouched** |

## Deploy (per lane — staging first; same copy-paste method as `seo-edge-injector`)
1. Cloudflare → Workers & Pages → Create Worker named `media-authz-staging` (production later: `media-authz`).
2. Edit code → delete the placeholder → paste the **whole** of `cloudflare/media-authz/worker.js` → Save and deploy.
   Never edit `worker.js` by hand: `node scripts/web-media-authz-build.mjs` builds it, CI fails if it is stale.
3. Settings → Bindings:
   - R2 bucket, variable name `MEDIA` → the lane's media bucket.
   - KV namespace, variable name `VIDEO_REVOKED` → a new, empty namespace for this lane.
4. Settings → Variables and Secrets:
   - Secret `MEDIA_TOKEN_KEY` → the **same** value as the Pages secret `MEDIA_TOKEN_KEY` on that lane (base64 of 32 bytes).
   - Text `ALLOWED_ORIGINS` → the lane's site origin and the app origins, comma-separated
     (staging: `https://staging.50mmretina.com, https://localhost, capacitor://localhost`).
5. **Before attaching the route**, note one photo's response: `curl -sI https://<lane cdn host>/<a photo key>` (status, ETag, Content-Type).
6. Settings → Domains & Routes → add route `<lane cdn host>/video/*` → this Worker. **Only `/video/*` — never `/*`.** Photos, avatars and every other path must never reach this Worker: on the free Workers plan a daily request cap would take every photo down, and the handler refuses unusual paths (`//`, `\`, `..`, bad %-encoding) that photos may have today.
7. Verify (all must hold, else remove the route — step 6 is the only reversible switch):
   - the same photo: same status, ETag and Content-Type as step 5 (it does not pass through the Worker at all);
   - `curl -sI https://<lane cdn host>/video/x` → `403`;
   - `curl -sI https://<lane cdn host>/%76ideo/x` → `403` or `404`, **never** `200` (an encoded `video` path skips a
     `/video/*` route and reaches the photo bucket directly — safe only while that bucket holds no `video/` objects);
   - `curl -sI https://<lane cdn host>/upload/x` → `404` (with a `/video/*` route this answer now comes from the photo
     bucket, not the Worker — safe only while that bucket holds no `upload/` objects);
   - **the photo bucket behind the CDN host holds no `video/` and no `upload/` objects** (R2 → that bucket → search the
     prefixes `video/` and `upload/` → 0 objects). Video and uploads live only in the lane's separate video bucket.
   - the bucket's own `r2.dev` public URL is **disabled** (R2 → bucket → Settings → Public access).
8. Only then the Pages variable `VIDEO_DELIVERY_PRIVATE=1` may be set on that lane (uploads stay 503 until it is).

## Staging today
Staging was first routed on `cdn-staging.50mmretina.com/*` (2026-10-12, `docs/evidence/d2/VID/media-authz/staging-live-proof.md`).
Narrow it: Worker `media-authz-staging` → Settings → Domains & Routes → change the route to `cdn-staging.50mmretina.com/video/*`,
then repeat step 7.

## Why the route is `/video/*` only
The handler still passes non-video paths to the origin (`fetch(request)`) as a safety net, but with the route limited to
`<lane cdn host>/video/*` no photo request ever reaches the Worker. Step 7's photo comparison is the proof; if it differs,
remove the route.

## S3-d · the `photo/` branch (friends-only / only-me photo derivatives)
Design: `docs/evidence/d2/S3/DESIGN.md` §10. Same Worker, same bindings (`MEDIA` = the lane's **video** bucket,
`MEDIA_TOKEN_KEY`), same copy-paste deploy of the rebuilt `worker.js`. Staging first.
1. Paste the new `worker.js` into `media-authz-staging` → Save and deploy. Re-run step 7 above (video unchanged).
2. Settings → Domains & Routes → **add** route `<lane cdn host>/photo/*` → this Worker (keep `/video/*`; never `/*`).
3. Verify (all must hold, else remove the `/photo/*` route):
   - `curl -sI https://<lane cdn host>/photo/x` → `404` (unknown key shape, from the Worker);
   - `curl -sI "https://<lane cdn host>/photo/<owner>/<media>/w1080.webp"` for a stored private derivative → **`403`**, zero bytes (anonymous fetch);
   - the same with `?t=<pass from /api/media/photo-token>` → `200 image/webp`, `cache-control: private, max-age=3600`;
   - `curl -sI https://<lane cdn host>/%70hoto/x` → `403`/`404`, never `200` (the photo bucket holds no `photo/` objects: R2 → photo bucket → prefix `photo/` → 0 objects);
   - one public photo: same status / ETag / Content-Type as before (it never reaches the Worker).
4. Only then the Pages variable `PHOTO_DELIVERY_PRIVATE=1` on that lane (the pass minter answers 503 until it is).
5. Only then may the supervisor turn the switch `media_private_photos` to *Selected members*.
Free plan: only friends-only / only-me derivative requests reach the Worker (100k requests/day cap).
