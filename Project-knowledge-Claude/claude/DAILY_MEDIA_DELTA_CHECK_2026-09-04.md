# DAILY MEDIA-DELTA HEALTH CHECK — 2026-09-04

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: ALERT**
**DB clock at run:** 2026-09-04 03:35:28 UTC (24h window covers 2026-09-03 03:35 → 2026-09-04 03:35)

## Claim

Two things, and the second is the more serious.

First, inside today's window the headline counters read clean — MEDIA-4009 and MEDIA-4010 both
zero, tail flat at 2, and nine canonical posts from five members, so the write path is
demonstrably working for most traffic. But one of the two legacy-only posts is **not** the
rollout tail: member `0f41ef16` is on the post-go-live build `2026-08-20-2`, uploaded a photograph
that the media engine ingested and verified, raised **MEDIA-4006**, and then published legacy-only
with the verified object left orphaned. That is the identical mechanism documented on 09-02, now
on a third member.

Second, and the reason this run pages the owner: **there is no daily report for 2026-09-03.** The
window that run would have covered contained **six MEDIA-4010** and six MEDIA-4001 between
2026-09-02 11:58 and 13:05 UTC, across two members on two channels. Six firings of the one code
this monitor is built to alert on went unreported, and they have now aged out of the 24-hour
headline counters — which is exactly why today's `media_4010_24h` reads 0.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution for
both legacy-only posts with per-member canonical history and post-go-live `media_objects` counts; a
3-day `media_objects` row dump with linked-vs-orphaned resolution; a 10-day `media_objects`
linked/orphaned/verified census; a 72-hour `client_errors` dump with full diagnostic fields; a 7-day
per-day code census; a 7-day legacy/canonical breakdown; and post-by-post `post_media` row counts
across the 09-02 error cluster. Project docs were searched for the missing 09-03 report; `project_read`
on `claude/DAILY_MEDIA_DELTA_CHECK_2026-09-03.md` returns no such doc.

## Result

| metric | value | vs 09-02 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 2 | 3 → 2 |
| `new_legacy_only_posts` | 2 | 3 → 2 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged *in-window only — see below* |
| app-channel legacy posts (24h) | **2** | unchanged |
| canonical posts (24h) | **9** | 0 → 9 |

`new_unexplained` equals `new_legacy_only` at 2 — no benign MEDIA-4007 avatar floor in this window.

## The unreported cluster: six MEDIA-4010 on 2026-09-02

Between 11:58:34 and 13:05:40 UTC on 09-02, six posts were published legacy-only after the atomic
publish refused them. Every one carries the full defect triple — MEDIA-4004 (`ATOMIC_PUBLISH_REFUSED`),
MEDIA-4010 (`MEDIA_WRITE_PATH_FAILED`, severity `error`) and MEDIA-4001 (`POST_PUBLISHED_LEGACY_ONLY`)
— and every one has zero `post_media` rows:

`edb74887` 11:58:34 (`4c200b33`, web, 1 image) · `fd64061e` 12:16:01 (`4c200b33`, web, 2) ·
`b2876619` 12:42:08 (`4c200b33`, web, 3) · `d052e346` 12:53:18 (`39759f18`, **app**, 1) ·
`8ad5c2d9` 12:53:36 (`4c200b33`, web, 3) · `d54fa520` 13:05:40 (`4c200b33`, web, 2).

The refusal reason is nearly uniform. Five of six read **`MEDIA-2113 N thumbnail url(s) are neither
the photograph nor its -thumb sibling`** (N = 1, 1, 2, 3, 1); the sixth (13:05:40) reads **`the same
photograph appears more than once in this post`**. This is a content-shape refusal in
`publishViaMedia`, not an infrastructure failure — the same member published six *canonical* posts
in the same hour (`4d9201a0`, `cfbe4935`, `ed24bc51`, `0b21659f`, `c961b646`, `04f0ed95`, 12:56–13:04,
all with matching `post_media` rows). So the path works; it refuses a specific class of post and
falls back silently.

MEDIA-4010's own `next_step` is explicit: *"⚠ THIS IS A DEFECT, NOT A LEGACY SLIDE — do not treat it
as part of the permanent floor."* Under this monitor's own interpretation rules, MEDIA-4010 > 0 is an
unconditional ALERT. It fired six times and nobody was told.

## Today's window: one tail post, one defect post

**`72a52e9d`** — 2026-09-03 09:42:08, member `316b47ee`, `last_platform='app'`, one image. Textbook
old-build tail: 10 posts, 8 canonical, last canonical **2026-08-19 04:52:19** (before the 08-20 15:51
go-live), and **zero** `media_objects` after go-live. Their only client error in the window
(DB-3004, 10:44:51) reports `app_build=2026-08-10-3` — a pre-go-live build. This one is the tail and
needs nothing.

**`1c18b57b`** — 2026-09-03 19:40:24, member `0f41ef16`, `last_platform='app'`, one image. This one
is the defect, and the sequence is tight:

- **19:37:36** — upload lands at the CDN. The post's image URL is
  `…/posts/1788464256395-uehqc2ps46-w2000h1333-l3.webp`; the embedded epoch decodes to
  2026-09-03 19:37:36.395 UTC.
- **19:37:43.539** — `media_objects` row **`9bc5b710`** created. `state='ready'`, `image/webp`,
  **2000×1333** (matching the URL's `w2000h1333`), 819,254 bytes.
- **19:37:45.593** — **`verified_at`** set. The media engine ingested and verified the photograph.
- **19:38:24.255** — **MEDIA-4006** / `PHOTO_NOT_DESCRIBABLE`, `severity=warn`,
  `fn=registerUploadedPhoto`, `platform=app`, **`app_build=2026-08-20-2`**, reason *"No
  StoredObjectFacts for this slide, so nothing could be declared."*
- **19:40:24.361** — post `1c18b57b` created. One legacy image URL, **zero `post_media` rows**.
  Object `9bc5b710` is linked to nothing.

**The benign branch of MEDIA-4006 does not apply here.** Its `next_step` says the null is correct if
the slide came from a resumed draft — but the upload happened 48 seconds before the error and 2m41s
before the post, in the same composing session, and the object it produced is ready and verified.
This is the other branch: *"describeStoredObject could not measure the encoded file — check the
encoder output and `crypto.subtle` availability."*

Three of the abort conditions carried forward from the 09-02 report fire on this post alone: a
legacy-only post from a member on a post-go-live build; a further `media_objects` row created and
left orphaned; and another MEDIA-4006. A fourth — "if a daily run is missing" — fires independently.

## What did improve

The 09-02 report's central alarm was that canonical writing had stopped: zero canonical posts, both
objects orphaned, 40 hours since the last canonical post. That has recovered. Objects created and
linked per day: 09-01 **2 / 0 linked / 2 orphaned**; 09-02 **31 / 19 / 12**; 09-03 **13 / 12 / 1**.
Nine canonical posts landed on 09-03 from five members (`ba812284`, `01c5059c`, `c2f9619d`,
`ac6e4fe1`, `581963f3`), several with multi-image posts joining correctly. The single orphan on 09-03
is `9bc5b710`, the MEDIA-4006 case above. The 09-02 orphan count of 12 belongs to the refusal cluster
and to `4c200b33`'s repeated re-attempts.

So the write path is not down. It leaks: once on 09-01, six times on 09-02, once on 09-03.

## Out of slice, noted

`SYS-9008` ×2 on 09-03 (`ERROR_APP_NOT_OWNED`, `app_build=2026-08-20-2`) — the known sideload signal.
`DB-3004` on 09-03 10:44:51 (`316b47ee`, build `2026-08-10-3`): the broadcast feed RPC timed out and
fell back to chronological, so fairness ordering was silently off for that member. `AUTH-1010` ×2.
`MEDIA-3001` on 09-02 07:38 (`0f41ef16`) — media *read* path fell back to `image_urls`, not
user-visible. One `SYS-9002` chunk-staleness crash on 09-02 22:06 (`CustomUrlProfile` module),
matching the documented blank-page cause. Three uncoded rows, including a journal image that failed
to load.

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 is live — no Play Console access, and this scheduled
run has no access to the owner's computer. Ninth consecutive cycle with this gap. Also could not
determine *why* the 09-03 run did not happen; that requires the scheduler's own history.

## What to look at first

1. **The MEDIA-2113 thumbnail-sibling check.** Five of the six 09-02 refusals died on it. Posts
   `fd64061e`, `b2876619`, `8ad5c2d9`, `edb74887`, `d052e346`. Find out what thumbnail URL the
   composer is submitting that is neither the photograph nor its `-thumb` sibling — the same member
   published canonically minutes later, so the difference is in the post payload, not the environment.
2. **Why no 09-03 run.** Six MEDIA-4010 went unreported for two days. The monitor's blind spot is
   that the headline counters are 24-hour windows: one missed run makes a defect invisible forever.
   Consider widening the alert counters to 72 hours, or having each run assert that its predecessor
   exists.
3. **`registerUploadedPhoto` / StoredObjectFacts.** Member `0f41ef16`, post `1c18b57b`, object
   `9bc5b710`, 2026-09-03 19:37–19:40 UTC. Third occurrence of the same shape (`c270d9d9` 09-01,
   `ac6e4fe1` 09-01). Check encoder output and `crypto.subtle` availability on `2026-08-20-2`.
4. **The orphans.** `9bc5b710`, plus the 12 from 09-02 and the two from 09-01. Ready, verified, joined
   to nothing. If they can be joined to their posts retroactively that is a repair path.

## Abort condition for the next run

Escalate if any MEDIA-4009 or MEDIA-4010 appears in a **72-hour** lookback, not just 24 hours; if any
further legacy-only post appears from a member on a post-go-live build; if another MEDIA-4006 fires;
if any `media_objects` row is created and left orphaned; if the MEDIA-2113 refusal reason recurs; if
distinct legacy members return above four; if app-channel legacy posts exceed 10; or if a daily run
is missing again.

## Notification

**Sent.** Six unreported MEDIA-4010 defects from 09-02, plus a third occurrence of the
verified-object-orphaned-anyway defect on 09-03.
