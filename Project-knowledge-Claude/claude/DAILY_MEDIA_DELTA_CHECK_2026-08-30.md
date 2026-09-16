# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-30

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: TAIL-ONLY**
**DB clock at run:** 2026-08-30 03:34:44 UTC (24h window covers 2026-08-29 03:34 → 2026-08-30 03:34)

## Claim

The 08-28 spike did not persist. The tail fell 10 → 2 app-channel legacy posts, distinct tail
members fell 4 → 2, and MEDIA-4009 / MEDIA-4010 are both zero for the seventh consecutive day.
Two canonical posts landed in the same window from two different members, so the write path is
demonstrably live. Neither tail member has a canonical post or a `media_objects` row after
go-live — the old-build signature holds for both. This run closes out the escalation raised on
08-29; no notification-worthy defect exists.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution
for both legacy-only posts, per-member canonical history and post-go-live `media_objects` count
against the 2026-08-20 15:51 UTC go-live, a 15-day legacy/canonical/total/distinct-member
breakdown, a 7-day `client_errors` code census, and per-member attribution of the canonical posts
in the window.

## Result

| metric | value | vs 08-29 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 2 | 10 → 2 |
| `new_legacy_only_posts` | 2 | 11 → 2 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **2** | 10 → 2 |
| canonical posts (24h) | **2** | 17 → 2 |

The two legacy-only posts are `34e8f0bf` (2026-08-29 04:17:05 UTC, one image, member `496d3cb9`)
and `d09ac292` (2026-08-29 05:12:28 UTC, one image, member `c2f9619d`). Both members are on
`last_platform='app'`. Note that `new_legacy_only_posts` and `new_unexplained_legacy_posts` are
equal again at 2 — the MEDIA-4007 profile-picture floor post that separated them on 08-29 has
aged out of the window, and no new explained legacy post replaced it.

## No defect in the window

Both alerting codes are zero. The 7-day census shows nothing new in the media slice: the single
2026-08-23 16:01:13 cluster (MEDIA-4010 ×1, MEDIA-4002 ×1, MEDIA-4001 ×1) is unchanged and now
sits well outside the 24h window, and MEDIA-4007 ×1 from 08-28 05:14 is the documented benign
floor already adjudicated in the 08-29 report. Out of slice: SYS-9008 ×2 (08-27, the known
`checkForUpdate` warning), AUTH-1010 ×2, and three uncoded rows, the most recent 2026-08-29 17:47.
Nothing has fired in the media write path since 08-28.

## Abort condition: not met on the load-bearing test

Neither tail member has any evidence of the new write path. `496d3cb9`: 6 posts, 5 canonical,
last canonical 2026-08-11 14:46 — nine days before go-live — zero canonical and zero
`media_objects` after go-live. `c2f9619d`: 22 posts, 13 canonical, last canonical 2026-08-20
07:08 — eight hours before go-live — zero canonical and zero `media_objects` after go-live. The
`media_objects` query returned an empty set for both. Their clients never invoked the write path;
it did not fail for them.

`496d3cb9` is new to the tail population and fits the dormant-return pattern established on
08-29 rather than a new install: profile created 2026-07-29, posting canonically through
2026-08-11, then silent for eighteen days and back on 08-29 with a legacy-only post. A client
that slept through the entire rollout window is the expected source of tail entrants at this
stage. `c2f9619d` is a long-standing tail member (08-25, 08-26, 08-27, 08-28, now 08-29).

## The write path is live

Two canonical posts in the window: `569aa88e` at 2026-08-29 16:08:22 and `83f6d083` at 16:33:58.
Both members have posted canonically on prior days as well. Canonical volume falling 17 → 2
tracks total volume falling 28 → 4; it is a quiet-day effect, not a write-path signal.

## The 08-29 share clause fired, and it should be retired at low volume

The 08-29 abort spec included "tail holds above ~35% of daily volume for two consecutive days."
Strictly read, that has now fired: 08-28 was 11/28 legacy-only (39%) and 08-29 is 2/4 (50%). It
is being recorded here rather than escalated, because at n=4 the ratio carries no information —
the same series contains 08-23 (3/3, 100%), 08-24 (4/4, 100%) and 08-26 (1/1, 100%), all days the
prior reports correctly read as decay, not expansion. Every other reading moved the right way
this cycle: absolute count 10 → 2, distinct tail members 4 → 2, no defect codes, canonical posts
still landing from multiple members.

Per-day legacy-only / canonical / total / distinct-legacy-members since 08-15: 08-15 0/3/3/0,
08-16 0/5/5/0, 08-17 1/16/17/1, 08-18 1/5/6/1, 08-19 0/12/12/0, 08-20 1/1/2/1, 08-21 5/7/12/3,
08-22 4/5/9/3, 08-23 3/0/3/3, 08-24 4/0/4/2, 08-25 3/4/7/3, 08-26 1/0/1/1, 08-27 3/1/4/2,
08-28 11/17/28/5, 08-29 2/2/4/2.

Read as absolute counts the series is 5, 4, 3, 4, 3, 1, 3, 11, 2 — the 08-28 reading stands out
as a single high-volume day dominated by one member's bursts, and the series returned to its
running level immediately after. The 08-29 report's reading of that step as noise rather than a
trend break is supported by this cycle.

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 is live still cannot be established — no Play
Console access, and this scheduled run has no access to the owner's computer either. The "tail
must not grow after rollout is live" clause stays unarmed for a fifth cycle. Per the 08-28
finding, `client_errors.app_build` is error-conditioned and stale and offers no DB-side path to a
build reading; that line was not re-run.

This remains the load-bearing gap in the monitoring slice. It is less acute than it was on 08-29
now that the tail has reverted, but the slice still cannot distinguish "decaying as expected
because the rollout shipped" from "flat because it never shipped." Confirming the rollout state
once, by hand, would arm the only clause that can actually close this monitor out.

## Notification

**Sent** (push + email). All-clear closing the 08-29 escalation: the tail reverted 10 → 2, both
alerting codes remain zero, and no action is needed. Sent rather than held because the owner was
paged on 08-29 about a series-high tail and may otherwise carry that state forward.

## Abort condition for the next run

Escalate if any MEDIA-4009 or a second MEDIA-4010 appears; if a legacy-only post appears from a
member with a canonical post or `media_objects` row dated after the 2026-08-20 15:51 go-live; if
app-channel legacy posts exceed 10 in a window again; if more than four distinct app members
appear in the tail on one day; if the tail exceeds ~35% of daily volume for two consecutive days
**on days with at least 10 total posts** (volume floor added this cycle — the unqualified share
test is not diagnostic at single-digit volume); or if another daily run is missing.
