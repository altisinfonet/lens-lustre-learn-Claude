# VID-1 · Video upload, data model and the three-mode access switch (Cloudflare Stream)

**Unit:** VID-1 (with the data-model half of VID-2 and the rules of VID-7; workstream VID, MASTER R-91) · **Lane:** D2 + D1 (written by the D3 session; docs only. No SQL, no code) · **Date:** 2026-10-04 · **Status:** waiting for the Owner's signature · **Path:** `docs/evidence/d2/phase5/VID-1/` (R-82 rule 2)

**Inputs, verbatim from MASTER R-91:**
- VID-0: "A = Cloudflare Stream (managed transcoding, adaptive HLS, signed URLs, thumbnails, direct creator uploads with tus resume)".
- VID-1: "resumable upload that survives poor network (chunked/tus; continues after drop or offline, via the OFF-2 outbox). Size and duration limits".
- VID-7: three modes, "OFF (default; app exactly as today) · SELECTED USERS · EVERYONE", "Enforced on the server … The client only hides the button", "Changes take effect without a new app release".

> **OWNER SIGN-OFF:** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

To sign, tick the box or comment `VID-1 approved` on the PR (merging also counts, R-88). The limits in §4 are the most likely thing to change; write the changes on the same line.

**Build order** (R-91): after OFF-1 and OFF-2. This file freezes the shapes so D1 and D2 can build in parallel against them. Like `P1-interface.md`, **neither side changes a shape here without the Auditor reopening it.**

---

## 1 · Who holds which secret (nothing in the repo, nothing in the browser)

| secret | where it lives | used by |
|---|---|---|
| Stream API token (Stream-only scope, one per lane) | Cloudflare **Pages secret** `STREAM_API_TOKEN` + `STREAM_ACCOUNT_ID`, staging and production projects separately | `functions/api/video/upload-url.ts` (D2): creates the one-time upload URL |
| Stream **signing key** (RS256 private key, one per lane) | Pages secret `STREAM_SIGNING_KEY_ID` / `STREAM_SIGNING_JWK` | `functions/api/video/play-token.ts` (D2): signs playback tokens locally, so no API call per view (Stream's `/token` endpoint is rate-limited and meant for under ~1,000 tokens a day) |
| Stream **webhook secret** | Supabase Edge Function secret `STREAM_WEBHOOK_SECRET` | `supabase/functions/stream-webhook` (D1): the only writer of processing status |

**Rule:** the Pages Functions act **as the member**, with the anon key + the member's JWT, so RLS decides everything. They never hold a service-role key. This is the lesson of Phase 1 Unit 2, which was held for needing an undeclared one. The only privileged writer is D1's webhook function, which already runs where Supabase's service role lives.

## 2 · Upload flow (resumable, survives drops and offline)

1. **The member picks a video.** The client checks the limits locally (§4) and shows the error at once if one fails. This check is UX only; the server re-checks.
2. **The client calls RPC `video_begin_upload(size_bytes, duration_s, mime, idempotency_key)`** (D1, SECURITY DEFINER, `search_path=''`). It checks, **on the server**:
   - (a) `feature_allowed('video_posts', auth.uid())` (§5);
   - (b) the limits;
   - (c) the member's daily quota (§4);
   - (d) that the idempotency key is new. If the key was seen before, it returns the same row (OFF-2 R8).
   It inserts a `videos` row `state='reserved'` and returns its `id`.
3. **The client calls `POST /api/video/upload-url {video_id}`** (Pages Function, D2). The function:
   - reads the row through RLS as the member, and requires owner + `state='reserved'`;
   - asks Stream for a tus direct creator upload (`?direct_user=true`, `Tus-Resumable: 1.0.0`, `Upload-Length`, `Upload-Metadata`: `maxDurationSeconds`, `requiresignedurls`, `expiry` = now + 6 h);
   - receives the one-time upload URL (the `Location` header) and the Stream uid (the response's `stream-media-id` header; **D2 confirms the header name against the live API in the first PR**);
   - stores the uid with RPC `video_attach_stream_uid(video_id, uid)`, which moves the row to `state='uploading'`;
   - returns the URL.
   This is the only call that touches the API token.
4. **The client uploads straight to Stream with tus** (chunk size 5 MiB, resume enabled). A drop, going offline or an app restart **resumes from the last confirmed byte**. The upload is an OFF-2 outbox item (kind `video_upload`), so it is retried with the OFF-5 back-off and is never lost. If the URL expires before the upload finishes, the outbox asks step 3 for a new one. The `videos` row and the idempotency key stay the same.
5. **Stream processes the video and calls the webhook** → `stream-webhook` (D1) verifies `Webhook-Signature` (`time=…,sig1=…`; HMAC-SHA256 of `<time>.<body>` with the webhook secret, compared in constant time; events older than 5 min are rejected). It then sets `state='ready'` (when `readyToStream` is true and `status.state='ready'`) or `state='failed'` with `failure_reason`, plus `duration_s`, `width`, `height` and `thumbnail_at_s` from Stream's answer. The webhook does not trust the client's duration; it overwrites it with Stream's.
6. **Posting:** the composer creates the post as today and links the video with `post_videos`. The link is **rejected unless `videos.state='ready'`** (a trigger, the same pattern as `trg_post_media_requires_ready` on `post_media`). Until then the composer shows "Processing…"; the post itself can wait in the outbox (OFF-5 §2 row 2).
7. **A reserved or uploading row** older than 24 h without completing → swept by a cron to `state='failed'`, `failure_reason='abandoned'`, and the Stream asset is deleted (D1; VID-6 budget).

## 3 · Data model (D1 builds it; names reserved here, migration numbers from D1's reservation)

**Expand only:** no existing table is altered. Video does not go into `media_objects`/`post_media`, so the image path and its guards stay untouched.

```
videos
  id               uuid pk default gen_random_uuid()
  owner_id         uuid not null references profiles(id) on delete cascade
  idempotency_key  uuid not null            -- unique (owner_id, idempotency_key)
  stream_uid       text unique              -- null until step 3
  state            text not null check (state in ('reserved','uploading','processing','ready','failed','deleted'))
  failure_reason   text
  size_bytes       bigint not null check (size_bytes > 0)
  duration_s       numeric(7,2)             -- from Stream on ready (client value only until then)
  width int, height int, thumbnail_at_s numeric(6,2)
  created_at, updated_at timestamptz not null default now()
  ready_at         timestamptz

post_videos
  post_id  uuid references posts(id) on delete cascade
  video_id uuid references videos(id) on delete restrict
  primary key (post_id)                     -- one video per post in v1
  -- trigger: video must be 'ready' and owned by the post's author
```

**State machine** (the only legal moves, enforced by a trigger):
`reserved → uploading → processing → ready` · any → `failed` · `ready|failed → deleted`.
`processing` is set by the webhook's first non-ready event, if Stream sends one. Otherwise the row goes from `uploading` straight to `ready`.

**RLS:**
- `videos`: the owner reads all their rows. Other members read a row only through a `post_videos` link to a post they may already see (the post's existing audience rule: public / friends / only-me), and only when `state='ready'`.
- No client INSERT/UPDATE/DELETE policy at all: every write goes through the RPCs in §2 or the webhook.
- `post_videos`: INSERT only by the post's author, through the composer path.

**What the client may read:** `id · stream_uid · state · duration_s · width · height · thumbnail_at_s` (plus `failure_reason` for the owner only). Never `idempotency_key` or `size_bytes` for other members. This follows the media-shape rule in the D2 skill.

**Playback (VID-3's input):** every video is uploaded with `requiresignedurls=true`, public posts included, so a uid copied out of the page is useless on its own. `POST /api/video/play-token {video_id}` reads the row **through RLS as the viewer**. If the row comes back, the function signs a JWT (RS256, `exp` = now + 2 h; Stream allows at most 24 h) for that uid. If not, it returns 404, never 403, so it doesn't reveal that the video exists.

## 4 · Limits (proposed; the Owner may change any value when signing)

| limit | value | enforced where |
|---|---|---|
| max duration | **3 min** for posts (ads: decided in VID-5) | client (UX) + `video_begin_upload` + Stream `maxDurationSeconds` + webhook overwrite |
| max size | **500 MB** | client + RPC + tus `Upload-Length` |
| formats | mp4, mov, webm (`video/*`, checked by the RPC on mime + by Stream on decode) | client + RPC + Stream |
| per member | **10 uploads / 24 h**, max **3 in progress** at once | RPC (counts the member's rows) |
| upload URL lifetime | 6 h (renewed through step 3 if it runs out) | Stream `expiry` |
| abandoned upload | 24 h → failed + Stream asset deleted | D1 cron |

## 5 · The three-mode switch (VID-7 rules; VID-1 is its first user)

```
feature_access
  feature      text pk check (feature in ('video_posts','video_ads'))
  mode         text not null default 'off' check (mode in ('off','selected','everyone'))
  updated_by   uuid, updated_at timestamptz

feature_access_members
  feature  text references feature_access(feature)
  user_id  uuid references profiles(id) on delete cascade
  added_by uuid not null, added_at timestamptz not null default now()
  primary key (feature, user_id)

feature_access_audit            -- append-only; no UPDATE/DELETE policy, no grant
  id bigint identity pk, at timestamptz default now(), actor uuid not null,
  feature text, action text check (action in ('mode','add','remove')),
  old_value text, new_value text, user_id uuid
```

- **Seeded:** `('video_posts','off')` and `('video_ads','off')`. With mode `off` the app behaves **exactly as today**.
- **One server function decides:** `public.feature_allowed(feature text, uid uuid) returns boolean`, STABLE, SECURITY DEFINER, `search_path=''`. It returns `mode='everyone'`, or `mode='selected' AND uid in members`. `video_begin_upload` calls it (§2 step 2a), and so will the ad-create path (VID-5). **This is the enforcement point.** The client only reads `feature_allowed` to decide whether to show the button.
- **Admin writes only through RPCs** `feature_set_mode`, `feature_add_member` and `feature_remove_member`. Each one checks `(select public.has_role(auth.uid(), 'admin'::public.app_role))` and writes one `feature_access_audit` row in the same transaction. The tables have no direct write grants.
- **No release needed:** the client asks `feature_allowed` at app start and on every return to the foreground (no polling timer; the timer rule in the D2 skill). A switch takes effect at the next open, and the server enforces it at once.
- **Switching off with uploads in flight:** `ready` videos stay playable (turning the switch off stops new uploads; it is not a takedown, which belongs to VID-4). Rows in `reserved`/`uploading` are allowed to finish, so a member does not lose a half-sent file.

## 6 · Lane split

| part | owner |
|---|---|
| `videos`, `post_videos`, `feature_access*`, the state trigger, RLS, the RPCs, `feature_allowed`, the sweep cron, `supabase/functions/stream-webhook` | **D1** (T1: SEC reviews) |
| `functions/api/video/upload-url.ts`, `functions/api/video/play-token.ts`, the tus client in the outbox, composer UI, admin switch screen | **D2** |
| Stream enabled, one Stream-only API token + one signing key per lane, webhook URL registered per lane, Pages/Supabase secrets set | **Owner** (Cloudflare dashboard / Supabase; no session can do it) |
| `tus-js-client` (MIT) as a dependency | D2, **dependency window** from the Auditor |

## 7 · Proof (R-82: CI/harness, each shown failing first)

1. **Mode off:** `video_begin_upload` as a normal member → rejected (SQL error 42501), even when called directly with a crafted request. (SEC writes this test. It fails first against a stub that returns true.)
2. **Mode selected:** a member on the list → allowed; a member not on it → rejected; remove the member → rejected on the next call. There is one audit row per change.
3. **Resume:** a harness upload of 20 MiB cut at 50 % (network killed, page reloaded) → completes, and Stream reports one asset (not two).
4. **The same idempotency key twice** → one `videos` row.
5. **Webhook:** a bad signature → 401 and no row change; a replay older than 5 min → rejected; a valid `ready` event → `state='ready'`, with `duration_s` from Stream.
6. **Private video:** a viewer who cannot see the post → `play-token` 404. A token minted for video A does not play video B.
7. **Link guard:** linking a `processing` video to a post → rejected by the trigger.

## 8 · Findings / open items

- **F-D3-14 · No feature-flag system exists today** (`git grep` over `supabase/migrations` for feature_flag/feature_access/allowlist finds none that do this). §5 is new, and it is generic, so `video_ads` and later features reuse it rather than adding a second mechanism.
- Open, for the Owner: is one video per post (v1) acceptable? Albums that mix photos and video would be a later unit.
- Open, for D2: confirm the `stream-media-id` response header and the tus `expiry` behaviour against the live Stream API in the first PR. This file states them from the Stream documentation read on 2026-10-04 (direct-creator-uploads, using-webhooks, securing-your-stream).
