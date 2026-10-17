# media-authz-staging — live proof on cdn-staging.50mmretina.com (F-D3-18, VID-1 §9 README step 7)

**Lane:** staging · **Date:** 2026-10-10 · **Instrument:** `curl` from the Owner's PC; `wrangler` 4.40.0 read-only listings · **Worker source:** `cloudflare/media-authz/worker.js` at `db2dc8ea` (#393, merged as `83139a9`)

## Setup as deployed (names only, no values)
| Item | Value |
|---|---|
| Worker | `media-authz-staging`, route `cdn-staging.50mmretina.com/*` (zone `50mmretina.com`), failure mode **fail closed** |
| Worker bindings | `MEDIA` → R2 `50mm-staging-video` · `VIDEO_REVOKED` → KV `media-authz-staging-revoked` · `ALLOWED_ORIGINS` (text) · `MEDIA_TOKEN_KEY` (secret) |
| Video bucket | `50mm-staging-video` (own bucket, Owner decision 2026-10-10): no custom domain, `r2.dev` disabled; CORS = PUT from `https://staging.50mmretina.com`, `https://localhost`, `capacitor://localhost`, headers `content-type`, `x-amz-checksum-sha256` |
| Photos | still served from bucket `50mm-staging` via its custom domain `cdn-staging.50mmretina.com` (Worker passes non-video paths through) |
| Pages `lens-lustre-learn-claude-staging` | `R2_ACCOUNT_ID`, `R2_BUCKET`, `MEDIA_CDN_HOST`, `VIDEO_ATTEST_LANE` (text); `MEDIA_TOKEN_KEY`, `VIDEO_COMPLETE_ATTEST_KEY`, `R2_UPLOAD_KEY_ID`, `R2_UPLOAD_KEY_SECRET` (secret); binding `MEDIA` → `50mm-staging-video` |
| Supabase staging vault | `video_complete_attest_key` present — `PROBE_vid2_upload_attest` run #168: "PROBE PASS VID-2A: lane staging; attest key configured t; previous key none; switches … all off" |

`MEDIA_TOKEN_KEY` was rotated once on 2026-10-10 before go-live: the first value was briefly stored as a plain-text Worker variable (visible), so it was replaced on both Pages and the Worker. No video existed under the old key.

## Proof (README step 5 → 7)
Photo key: `post-images/25d4916c-d399-4c5d-87ad-84dd5e4fa071/posts/1787808114159-ejr5mm8hiy7-w240h140.webp`

| Check | Before route (15:52:52 UTC) | After route (16:16:18 UTC) | Result |
|---|---|---|---|
| Photo | 200 · `image/webp` · 3252 B · ETag `"997ff166dc54ea82a95c09a0396f6dc6"` | identical | **PASS** — no photo regression |
| `video/x`, no token | 404 (27,150 B origin page) | **403, 0 bytes** | **PASS** (Worker live, key loaded: a missing key would be 503) |
| `upload/x` | 404 (27,150 B) | **404, 0 bytes** | **PASS** (SEC-VID-1) |
| `video%2Fa/b/v1/x.m4s` | — | **400, 0 bytes** | **PASS** (SEC-VID-12) |
| well-formed `video/<owner>/<video>/v1/240p_0.m4s`, no token | 404 | **403, 0 bytes** | **PASS** |
| Video bucket public URL | `r2.dev` disabled, no custom domain | same | **PASS** |

Per README step 8 this satisfies the precondition for `VIDEO_DELIVERY_PRIVATE=1` on the staging Pages project (set by the Owner after this proof). Admin switches `video_posts`, `video_ads`, `copyright_music_check` remain **off** (A1.5 gate).
