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
6. Settings → Domains & Routes → add route `<lane cdn host>/*` → this Worker.
7. Verify (all must hold, else remove the route — step 6 is the only reversible switch):
   - the same photo: same status, ETag and Content-Type as step 5;
   - `curl -sI https://<lane cdn host>/video/x` → `403`;
   - `curl -sI https://<lane cdn host>/upload/x` → `404`;
   - the bucket's own `r2.dev` public URL is **disabled** (R2 → bucket → Settings → Public access).
8. Only then the Pages variable `VIDEO_DELIVERY_PRIVATE=1` may be set on that lane (uploads stay 503 until it is).

## Assumption to confirm at step 7
For non-video paths the Worker calls `fetch(request)`, which on a route reaches the hostname's origin — here the
bucket's custom domain — exactly as before. Step 7's photo comparison is the proof; if it differs, remove the route.
