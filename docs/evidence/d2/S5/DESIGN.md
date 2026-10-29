# S5 · Upload reliability: design note (v2 Phase 3)

Gate (master plan, verbatim): *"v2 8-point kill test: at all 8 kill points →
exactly 1 post, 0 orphans, 0 duplicate media"*. The kill points come from
`ENGINEERING_PLAN_V2_APPROVED_ARCHITECTURE.md` §4. The harness is built against
exactly those 8.

## 1. Upload paths today (inspected 2026-10-29 on `staging` b886e68)

| Path | Steps | Gaps |
|---|---|---|
| **Photo post** (`WallPosts.tsx` → `imageUpload.ts` → `s3Upload.ts` → `postMediaWrite.ts`) | encode WebP on the main thread → presign (`s3-presign-upload`, 300 s) → `fetch` PUT ×(full, thumb, rungs) → `media_begin_upload` (UNIQUE owner+sha256) → `media-register-upload` (server re-hash) → `post_publish_with_media` (UNIQUE user+idempotency_key, replay returns the first post) | object key = `Date.now()+random`, so every retry or re-post writes **new** objects and strands the old ones. Nothing is kept on the device: a kill loses the post. No byte progress, no timeout (a dead link hangs), fixed retry delays with no jitter. The **legacy fallback insert carries no idempotency key**, so a publish that committed but lost its answer, followed by the fallback, makes **two posts**. |
| **Video** (`video/uploadJobs.ts` + `jobDeps.ts`) | job + encoded files in IndexedDB `retina-video-uploads`; keys made once; `video_begin_upload` / `video_publish_post` idempotent; XHR PUT with progress, abort and stall watchdog; re-ask URLs on 403; backoff from the outbox | already resumable. The XHR PUT lives in `jobDeps.ts` only, so photos cannot use it. |

## 2. The 8 kill points (v2 §4), mapped to this pipeline

| # | v2 kill point | Here: state on disk when killed | Recovery on relaunch |
|---|---|---|---|
| 1 | before presign | job + encoded bytes in IndexedDB, nothing sent | resume from presign |
| 2 | after presign | as 1, presign answered (URL may expire) | re-presign the **same keys**; nothing was written |
| 3 | 10 % uploaded | interrupted PUT to a known key (an S3/R2 PUT is atomic: no partial object is ever visible) | re-PUT the same key |
| 4 | 50 % | same | same |
| 5 | 90 % | same | same |
| 6 | after original uploaded | all objects stored, no `media_objects` row | `media_begin_upload` with the same bytes |
| 7 | after derivatives / media ready | `media_objects` ready, no post | `post_publish_with_media` |
| 8 | after DB post creation | post committed, answer lost | the same key returns the same post (media path; on the legacy fallback via `recoverPostByKey`, §3), then the job is deleted |

## 3. The state machine (one layer, photo and video)

`src/lib/upload/` holds the shared transport: one XHR PUT (byte progress,
AbortController, stall timeout), one retry policy (exponential backoff with
±20 % jitter, `backoffMs` from the outbox, the only copy), and re-presign on
403/expiry. Video's `jobDeps.xhrPut` becomes a re-export of it, not a copy.
The photo job reuses video's IndexedDB store pattern (`retina-photo-uploads`)
and runs:

```
encoded ─presign/PUT (per object, resumable)─▶ stored ─begin+register─▶ ready ─publish─▶ published (deleted)
any refusal (4xx that is not 403/408/429) ─▶ failed (said out loud, bytes kept until the member discards)
```

* **Idempotency key = client upload id**, made once when the member taps Post
  and stored with the job. It is the post's `idempotency_key`, so one upload id
  can never make two posts (`posts_user_idempotency_key`).
* **Deterministic object keys**: `post-images/<uid>/posts/<uploadId>-<slot>-w…h…[-l3].webp`.
  A retry, a resume or a re-presign lands on the same address, so no orphan is
  possible from a kill.
* **The encoded bytes are stored, before the job record** (so a job on disk always has its bytes; a kill during encode loses only the tap, and nothing was sent). **A resume never re-encodes**: a resume re-PUTs the
  exact same bytes, so `media_begin_upload` gets the same sha256 and the same
  media row (no duplicate media).
* sha256 runs in a Web Worker (main-thread fallback, same digest). **Decision
  (S5-b):** WebP *encoding* stays on the main-thread canvas: an OffscreenCanvas
  encoder produces different bytes and quality (a visible change that needs
  its own switch and measurement). It is also off the resume path, because
  bytes are encoded once and stored.
* The legacy fallback insert also carries the key; a 23505 on it means the
  post exists, and the existing id is used.

## 4. What the server must guarantee (already true unless marked)

1. `UNIQUE (user_id, idempotency_key)` on posts, and `post_publish_with_media`
   returns the existing post for a replayed key. Live since `20260815041256`.
2. `UNIQUE (owner_id, sha256)` on media_objects; `media_begin_upload` returns
   the same row. Live since `20260814084711`.
3. The presign signs any key carrying the caller's own uid as a path
   segment (or a shared prefix), and a PUT to an existing key overwrites it (R2). No change needed.
4. **Abandoned jobs** (a member who never reopens the app) leave objects and a
   `pending` media row. These are the only orphans the design allows. They are
   reclaimed by a reference-counted sweep older than a window (S5-c, only if
   the harness shows it is needed for the gate). The kill test always
   relaunches, so abandoned jobs are outside the gate by its own definition.

## 5. Switch

The resumable photo job is user-visible (a post can appear after a relaunch),
so it ships behind `site_settings.photo_upload_resume = "on"`, default OFF.
Off = today's path, plus the pure reliability fixes: shared PUT
retry/timeout/progress, and the key on the fallback insert.
