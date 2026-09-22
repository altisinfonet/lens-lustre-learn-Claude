# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-26

**Run:** scheduled monitoring slice (G3) · **Mode:** read-only · **Verdict: TAIL-ONLY (24h window) — with a missed ALERT recovered from 2026-08-23**

## Claim

The 24-hour window is clean: no MEDIA-4009/4010, and the three legacy-only posts are the
old-build rollout tail, which shrank. Separately, and materially: a genuine MEDIA-4010 defect
fired on **2026-08-23 16:01:13 UTC** and was never surfaced, because no daily check ran on
08-24 or 08-25.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution
for every legacy-only post in the window (with each author's canonical history, latest
`media_objects.created_at`, and a count of media objects created *after* the write path went
live at 2026-08-20 15:51 UTC); a 10-day legacy/canonical/client-error breakdown; a 7-day
`client_errors` code census; and full row detail for the 08-23 16:01 error cluster.

## Result

| metric | value | vs 08-23 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 3 | 4 → 3 |
| `new_legacy_only_posts` | 3 | 4 → 3 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **3** | 4 → 3 |
| canonical posts (24h) | **4** | 0 → 4 |

The three legacy-only posts come from three members, all `last_platform='app'`: `c2f9619d`
(08-25 13:56 UTC), `01c5059c` (08-25 17:55) and `0f41ef16` (08-25 19:58).

## Regressions

None in the 24h window. The abort condition — a legacy-only post from a member with a *live*
canonical post behind them — was tested directly this time by counting each author's
`media_objects` rows created after the 2026-08-20 15:51 UTC go-live, rather than by inspecting
the max timestamp alone. All three authors return **zero** live media objects; their canonical
histories (13, 25 and 7 posts) are entirely migration backfill. No member who has the code has
produced a legacy-only post.

## The finding: an unreported MEDIA-4010 on 2026-08-23

The 7-day `client_errors` census surfaced exactly one MEDIA-4010 in the week, at
**2026-08-23 16:01:13 UTC** — outside today's 24h window, and therefore invisible to today's
headline counters. It is part of a three-row cluster written in the same 8 milliseconds by
member `0a41ed5e` on **web**, build `2026-08-20-2`, correlation id `682584a4`:

| code | severity | event | what it says |
|---|---|---|---|
| MEDIA-4002 | warn | `MEDIA_BEGIN_UPLOAD_REFUSED` | the server would not open a media record; `reason: TypeError: Failed to fetch` |
| MEDIA-4001 | warn | `POST_PUBLISHED_LEGACY_ONLY` | the post published with `image_urls` only |
| MEDIA-4010 | **error** | `MEDIA_WRITE_PATH_FAILED` | every photograph was describable and the media path still did not complete |

The corresponding post is `7652b6b6`, created `2026-08-23 16:01:13.030949+00`, legacy-only.
By the instrument's own words this is **a defect, not a legacy slide** — it must not be counted
into the permanent floor.

Two things narrow it. First, the root cause recorded in MEDIA-4002 is `TypeError: Failed to
fetch` — a transport failure reaching the begin-upload endpoint, not a schema refusal and not
the in-flight upload cap. Second, `0a41ed5e` has six canonical posts but **zero** media objects
created after go-live, so this was a first live attempt that failed, not a regression from a
working state. It has not recurred: one MEDIA-4010 in seven days, and on 08-25 member
`41e124e2` wrote nine live media objects across four canonical web posts, so the web write path
is working.

This is also the **first web-channel legacy-only post**. Both prior reports recorded that every
web post in their windows was canonical; the old-build tail explanation covers `app` only and
does not cover this post.

## Monitoring gap

There is no `DAILY_MEDIA_DELTA_CHECK` document for **2026-08-24** or **2026-08-25**. The 08-23
error fell squarely inside the 24h window of the 08-24 run, which would have raised it as an
ALERT on the day. The gap, not the defect, is why this took three days to reach the owner — and
it is the more serious of the two, because it means the slice was not standing watch.

## Tail trend

Per-day legacy-only counts: 08-17 1, 08-18 1, 08-19 0, 08-20 1, 08-21 5, 08-22 4, 08-23 3,
08-24 4, 08-25 3, 08-26 0 so far. The tail is flat-to-declining and did not grow day over day,
so under G4 it stays a decay curve rather than a defect. Note that the 08-23 count of 3 includes
the defect post `7652b6b6`, which should be subtracted from the tail population — it is not an
old-build post.

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 is live (no Play Console access from this
session), so the "tail must not grow after rollout" clause still cannot be armed. Whether the
08-24/08-25 runs failed, were never scheduled, or ran without writing a document — trigger
history is not readable from here.

## Abort condition for the next run

Unchanged, plus one addition: escalate if a **second** MEDIA-4010 or any MEDIA-4009 appears, if
a legacy-only post appears from a member with a live canonical post behind them, if the tail
resumes growing once build 1111 is confirmed live on Play, or if **another daily run is
missing** — the gap is now a monitored condition in its own right.
