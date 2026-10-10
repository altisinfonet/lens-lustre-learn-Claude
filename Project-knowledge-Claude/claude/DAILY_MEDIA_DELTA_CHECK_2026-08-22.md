# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-22

**Run:** scheduled monitoring slice (G3), 05:15 UTC · **Mode:** read-only · **Verdict: TAIL-ONLY**

## Claim

The media write path is healthy; the legacy-only population is growing only through the
old-build (pre-1111) rollout tail, not through a defect.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase
MCP connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: an 8-day
per-day legacy/canonical breakdown, per-post attribution for every legacy post in the last
48 hours, per-user canonical history, and `media_objects.created_at` versus `posts.created_at`
to separate migration backfill from live writes.

## Result

| metric | value |
|---|---|
| `delta_growing` | **true** |
| `new_unexplained_legacy_posts` | 5 |
| `new_legacy_only_posts` | 5 |
| MEDIA-4009 (24h) | **0** |
| MEDIA-4010 (24h) | **0** |
| app-channel legacy posts (24h) | **5** |
| canonical posts (24h) | **8** |

The five legacy-only posts come from three members, all on pre-1111 builds:
`ba812284` (three posts: 06:43, 10:30, 13:11 UTC on 08-21), `c2f9619d` (06:18 on 08-21 and
04:58 on 08-22) and `0f41ef16` (18:23 on 08-21). In the same window the sideloaded build-1111
device (`cc691988`) produced the two canonical app posts recorded in the Android acceptance,
and every web-channel post in the window was canonical.

## Regressions

None found. The one candidate signal — `c2f9619d` and `0f41ef16` each having a canonical
history and then posting legacy-only — was falsified: their earlier `media_objects` rows were
created on 2026-08-19 (and 2026-08-20 07:59, still before the write path went live at 15:51
UTC on 08-20), i.e. they are migration backfill, not live writes. No member has produced a
live-canonical post and subsequently regressed to legacy-only. The write path is not failing
for anyone who has the code.

## Tail trend

Yesterday's Master Plan §4.1 recorded three tail posts in the 24h window; today's window holds
five, and one more member has joined the tail — `ba812284` registered on 08-20 and every post
they have made (four) is legacy-only. Under G4 this is still **not a defect**: the gate is
"zero legacy-only posts from builds ≥ 1111", and growth counts against the tail only *after*
the Play rollout is live. Per `PHASE2_ANDROID_WRITEPATH_BUILD1111_2026-08-21.md` the Play
upload of build 1111 / v1.2.16 is a manual owner step that had not been performed as of that
document. The tail therefore has no mechanism to decay yet, and should be expected to keep
accumulating at roughly this rate until 1111 reaches the fleet.

## Could not verify

Whether the Play rollout has been performed since yesterday's document (no Play Console access
from this session). Also note that `client_errors` has recorded **no rows of any code** since
2026-08-21 04:27 UTC, so today's `MEDIA-4009 = 0` / `MEDIA-4010 = 0` is weak evidence rather
than strong — it is consistent with the documented behaviour that pre-1111 builds emit no
MEDIA-4xxx trace at all, but it would look identical if client error reporting were down.

## Abort condition for the next run

Escalate to ALERT if any of: MEDIA-4009 or MEDIA-4010 becomes non-zero; a legacy-only post
appears from a member who has previously produced a *live* canonical post; or the tail keeps
growing once build 1111 is confirmed live on Play.
