# S3 "Media" — design note (S3-a)

2026-10-28 · builder: cloud session (S3) · status: design, docs-only.
Everything below was read from the code on `staging` at `abf8b40`; nothing here
was measured on a live database (the supervisor measures).

## 1. What exists today (found in code)

| Piece | Where | Today |
|---|---|---|
| Photo bytes | R2 photo bucket per lane, served by the bucket's custom domain (`cdn.` / `cdn-staging.`) | key `post-images/<owner>/posts/<name>-w{W}h{H}[-l3].webp` (+ six older legacy key shapes) |
| Who can fetch a photo | anyone with the URL | bucket public, no check (D-002). `PrivacyGapNotice` discloses it |
| Media graph | `media_objects` (+`derivatives jsonb`, only `original` recorded) → `post_media(post_id, ord, media_id)` | no client grant; read via `post_media_for(uuid[])` (SECURITY DEFINER, `can_view_post`, cap 50) |
| What the client renders | `posts.image_urls` / `thumbnail_urls`, overlaid by `post_media_for` in `src/lib/posts/postAttachments.ts` → `resolvePostImageUrls` | per post, graph when present, `image_urls` otherwise |
| Ladder | `src/lib/imageLadder.ts`: client encodes `-thumb` (600), `-r1080`, `-r1440` beside `-l3` uploads only | legacy posts: no rungs → originals in the feed |
| Ladder use | only `PostMedia` (feed, wall, PostDetail via `PostCard`) builds a srcset | profile grid, hashtag, notifications, comments overlay, landing preview, drafts, scheduled: plain `<img>` of thumb or original |
| Video private delivery | `cloudflare/media-authz` Worker on route `<cdn>/video/*`, R2 binding `MEDIA` (video bucket, no public domain), prefix play tokens signed in Pages (`functions/api/video/play-token.ts`, `MEDIA_TOKEN_KEY`) | live on staging; the pattern S3-d extends |
| Switches | `feature_access` (VID-7: off / selected / everyone), `feature_allowed(feature, uid)`, client `useFeatureAllowed` | `feature_allowed` is false for signed-out viewers |
| Orphan sweep | `detect-orphan-files` counts every string value of `media_objects.derivatives` as referenced (`_shared/referenceSet.ts`) | so every derivative this stage writes is recorded there, or it would read as an orphan |

## 2. The plan in one picture

```
 worker (Node + sharp; supervisor machine or converter VM)
   │ JWT of an admin or the converter account
   ▼
 Pages /api/media/derivatives/{claim,source,put}  ──RPC as that JWT──▶ media_derivative_* (SQL, admin|converter only)
   │ PHOTOS binding (photo bucket)          │ MEDIA binding (video bucket, no public domain)
   ▼                                        ▼
 post-images/<owner>/d/<media>/w{600,1080,1440}.webp      photo/<owner>/<media>/w{600,1080,1440}.webp
   public posts — served as today by the bucket domain     friends-only / only-me posts — served ONLY by the
                                                           media-authz Worker on <cdn>/photo/* with a token
```

* Derivatives are **new keys in a new folder** (`/d/` or `photo/`). No original
  key is ever a target; the Pages writer refuses any key the SQL did not compute,
  refuses to overwrite an existing object, and never deletes.
* "No upscaling": rung R is `min(R, long edge)`; a 900 px photo gets 600 and two
  900 px copies (1080 and 1440 point at real ≤1440 files, never the original).
* The SQL computes key, width and height; the Pages writer checks the WebP header
  dimensions against them before storing.

## 3. Old-app compatibility (1.2.24 / 1.2.25 and the web today)

Old builds read `posts.image_urls` / `thumbnail_urls` and `<img src>` them with no
token. **Nothing in this stage changes those columns, those objects or the bucket's
public access.** Every URL that works today keeps working. New paths are used only
by a build that has the new code AND a member for whom the switch is on.

**Trade-off (Owner decision O-1).** While old builds exist, the ORIGINAL of a
friends-only photo stays public at its old URL (D-002 stays open for originals and
`PrivacyGapNotice` stays shipped). What S3-d closes: the friends-only *derivatives*
the new client shows are served only with a token (anonymous fetch = 403/404). A
later contract stage (not S3) moves friends-only originals into the private bucket
and rewrites their old URLs, once the Owner accepts that 1.2.24/1.2.25 will then
stop showing those friends-only photos.

## 4. Switches (existing VID-7 pattern, both created `off` on both lanes)

| Switch | Part | When on, for that member |
|---|---|---|
| `media_ladder_feed` | S3-c | the client replaces `post_media_for` with `post_media_resolved_for` and renders the 600/1080/1440 WebP derivatives on every post-media surface; the original is used only for zoom/download |
| `media_private_photos` | S3-d | for non-public posts the resolved URLs point at `<cdn>/photo/…`; the client fetches a short-lived token (`/api/media/photo-token`) and appends it |

Server read `post_media_resolved_for(uuid[])` returns only
`post_id · ord · media_id · width · height · mime · url` (one row per rung; URL
built server-side from the lane's CDN host in `site_settings`). Never sha256,
derivatives, state, verified_at, quarantine reason. It returns nothing for a media
object whose ladder is incomplete, so that post falls back to today's path.

**Decision D-S3-1 (recorded, conservative).** The four feed RPCs
(`get_broadcast_feed`, `get_personal_feed`, `get_following_feed`,
`get_favourites_feed`) are **not** redefined. "Feed returns resolved media" is
delivered by the one companion RPC above, called with the page's post ids in place
of today's `post_media_for` call (same round trip count). Reason: changing a feed
RPC's return shape is a DROP + CREATE of the riskiest functions on the platform
for a presentation detail; the companion keeps the same `can_view_post` control and
can be switched off without touching the feed.

## 5. Backfill (S3-b)

* Queue = ready media referenced by a post whose derivative set for its post's
  current audience is incomplete. Resumable by construction (the queue is the
  missing work), idempotent (server refuses overwrite; a re-sent identical file is
  "already done"), rate-limited (`--rate-ms`, default 500 ms between writes;
  ≤ 20 media per claim, far under 1,000 subrequests per invocation: each Pages call
  does ≤ 2 R2 operations).
* Run order: `--dry-run` on staging → run on staging → coverage PROBE on staging
  = 100 % → production dry-run → run → PROBE. New uploads: the same worker in
  `--loop` mode (converter VM timer) — until then a new photo simply falls back.
* Legacy-only posts (no `post_media`, today's fallback population) are outside the
  queue; the coverage PROBE counts them separately. They keep today's rendering.

## 6. Rollback per step

| Step | Rollback |
|---|---|
| SQL 0100 (derivative RPCs) | rollback file drops the functions; derivative objects stay (harmless, referenced by `derivatives`) |
| backfill run | stop the worker; nothing reads the new keys until a switch is on |
| SQL 0101 (resolved read + `media_ladder_feed`) | switch to `off` (instant); rollback file drops the RPC and the switch row |
| client S3-c | switch `off` → the client calls `post_media_for` exactly as today |
| Worker route `<cdn>/photo/*` (S3-d) | remove the route; `photo/` keys are unreachable (fail closed) |
| SQL 0102 + `media_private_photos` | switch `off` → non-public posts get no resolved rows and fall back to today's path (§7) |

## 7. Safe switch-on order (supervisor, per lane, staging first)

1. Apply 0100 → run backfill → coverage 100 %.
2. Apply 0101 → turn `media_ladder_feed` to *selected* (test members) → check
   every surface → *everyone*.
3. Owner deploys the Worker update + route `<cdn>/photo/*` + Pages binding/vars
   (S3-d click list) → curl proofs → apply 0102 → `media_private_photos` *selected*
   → *everyone*. With the switch off, a friends-only post's resolved rows are
   withheld (fallback to today), never pointed at a public copy.

`PrivacyGapNotice` and its test stay through the whole stage.
