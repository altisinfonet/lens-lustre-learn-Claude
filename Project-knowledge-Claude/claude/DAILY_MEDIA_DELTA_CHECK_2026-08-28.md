# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-28

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: TAIL-ONLY**
**DB clock at run:** 2026-08-28 03:35:21 UTC (24h window covers 2026-08-27 03:35 → 2026-08-28 03:35)

## Claim

The 24-hour window is clean of defects. No MEDIA-4009 and no MEDIA-4010. Three legacy-only
posts from two app-channel members, both already known tail members, neither with a live
canonical post behind them — the old-build rollout tail. The raw tail count rose 1 → 3 against
08-27, but total posting volume rose with it (1 post → 4 posts), so the tail's share of volume
fell from 100% to 75%. One canonical post landed inside the same window, which is the positive
proof of a working write path that the 08-27 run could not obtain.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution
for the three legacy-only posts, per-member canonical and `media_objects` history against the
2026-08-20 15:51 UTC go-live, a 13-day legacy/canonical/total breakdown, a 7-day `client_errors`
code census, and — new this run — a 30-day `app_build` census from `client_errors`.

## Result

| metric | value | vs 08-27 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 3 | 1 → 3 |
| `new_legacy_only_posts` | 3 | 1 → 3 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **3** | 1 → 3 |
| canonical posts (24h) | **1** | 0 → 1 |

The three legacy-only posts are `c56893bb` (2026-08-27 05:15:38 UTC, one image, member
`c2f9619d`) and `f2398dd8` / `803158a9` (2026-08-27 16:00:41 and 16:02:41, one image each,
member `01c5059c`). Both members are on `last_platform='app'`.

## Abort condition is not met

Neither member has a live canonical post behind them. `c2f9619d` has 20 posts, 13 canonical,
last canonical 2026-08-20 07:08:49 — before go-live — and **zero** `media_objects` created after
go-live. `01c5059c` has 21 posts, 18 canonical, last canonical 2026-08-19 11:44:39 — also before
go-live — and **zero** `media_objects` after go-live. Their post histories show a clean break at
go-live: `01c5059c` was canonical through 08-19, then legacy-only on 08-25, 08-27 and 08-27.
That is the signature of a client that never picked up the new write path, not of a write path
that failed.

Both members were already in the tail population (`c2f9619d` on 08-26 and 08-25, `01c5059c` on
08-25). **No new member entered the tail this cycle.**

## The tail did not grow in the sense the rule means

Per-day legacy-only / canonical / total: 08-15 0/3/3, 08-16 0/5/5, 08-17 1/16/17, 08-18 1/5/6,
08-19 0/12/12, 08-20 1/1/2, 08-21 5/7/12, 08-22 4/5/9, 08-23 3/0/3, 08-24 4/0/4, 08-25 3/4/7,
08-26 1/0/1, 08-27 3/1/4.

The 1 → 3 step is a rebound off a single-post day, not a trend break. 08-26 had exactly one post
in total and it was legacy-only; 08-27 had four posts of which three were legacy-only. Against
the 08-21 peak of 5 the series is still 5, 4, 3, 4, 3, 1, 3 — noisy and flat-to-down, with the
noise dominated by daily posting volume in the low single digits. Under the G4 rule this stays a
decay curve, and the "must not grow after rollout" clause remains unarmed regardless (see below).

## Write path is confirmed live

`canonical_posts_24h` = 1: post `f50ad858` by member `569aa88e` at 2026-08-27 05:42:46 UTC, one
`post_media` row. That is 27 minutes after `c2f9619d`'s legacy-only post the same morning. Two
clients posting the same morning, one writing canonical media and one not, is the cleanest
available evidence that the divergence is client-build-borne and not a server-side write-path
failure. This closes the 08-27 report's open item that a zero canonical count gave no positive
proof the write path ran.

## Regressions

None in the media slice. The 7-day `client_errors` census shows MEDIA-4010 ×1, MEDIA-4002 ×1 and
MEDIA-4001 ×1, all still from the single 2026-08-23 16:01:13 UTC cluster, and MEDIA-4007 ×1 from
08-21. Nothing new has fired.

`SYS-9008` ×2 appears in the 7-day window (2026-08-27 13:24:56 and 13:25:31, `severity='warn'`,
`fn='checkForUpdate'`, message "The installed app could not ask Play whether an update exists",
`app_build='2026-08-10-3'`, no `user_id`). It is **not** a new code — 91 occurrences all-time,
first seen 2026-08-06 — it simply entered the 7-day window after the 08-27 report. Out of slice,
but noted because a failing in-app update check is a plausible brake on tail decay and is worth
a look if the tail stops shrinking.

## Could not verify — and a correction to yesterday's plan

Whether the Play rollout of build 1111 / v1.2.16 is live still cannot be established from this
session (no Play Console access), so the "tail must not grow after rollout" clause stays unarmed
for a third cycle.

The 08-27 report noted the posting client build is not on the post row. `client_errors` does
carry `app_build`, and it initially looked like a way to read tail members' builds directly.
**It is not, and this run rules it out.** The field is error-conditioned and therefore stale: a
member emits a build stamp only when their client reports an error. Of the six members who wrote
canonical posts after go-live — provably on the new write path — five have a `last_observed_build`
of `2026-08-10-3` or older, because their last error predates go-live. The two tail members'
readings (`2026-08-10-3`, last seen 08-17 and 08-13) are stale in exactly the same way and prove
nothing about what they were running on 08-27. Likewise, the fact that no client has reported a
build newer than `2026-08-20-2` is explained by low error volume, not by an absent rollout. Old
build remains an inference from the zero live `media_objects`, and no DB-side path to a direct
build reading exists. Do not re-run this line of inquiry.

## Notification

None sent. Verdict is TAIL-ONLY with no defect, no new tail members, no new error codes, tail
share of volume down, and no abort condition met — the expected steady state, which under the
monitoring slice does not warrant paging the owner.

## Abort condition for the next run

Unchanged: escalate if a second MEDIA-4010 or any MEDIA-4009 appears, if a legacy-only post
appears from a member with a live canonical post or a post-go-live `media_objects` row behind
them, if a member not already in the tail population enters it, if the tail resumes growing as a
share of daily volume once build 1111 is confirmed live on Play, or if another daily run is
missing.
