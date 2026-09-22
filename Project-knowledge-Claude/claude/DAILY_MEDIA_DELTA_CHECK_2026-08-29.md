# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-29

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: TAIL-ONLY (elevated — see below)**
**DB clock at run:** 2026-08-29 03:35:09 UTC (24h window covers 2026-08-28 03:35 → 2026-08-29 03:35)

## Claim

No defect. MEDIA-4009 and MEDIA-4010 are both zero for the sixth consecutive day, and the write
path is demonstrably healthy — 17 canonical posts from six members, the highest canonical day
since 08-17. But the tail metric tripled, 3 → 10, its highest absolute reading since go-live,
and **two members entered the tail population who were not previously in it** (`316b47ee`,
`26fae852`). Both fit the old-build signature exactly: zero canonical posts and zero
`media_objects` after go-live. The verdict stays TAIL-ONLY, but the "new member enters the tail"
escalation condition carried forward from the 08-28 report has fired, so this run notified the
owner rather than closing silently.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution
for all eleven legacy-only posts, per-member canonical and `media_objects` history against the
2026-08-20 15:51 UTC go-live, a 14-day legacy/canonical/total breakdown, a per-day distinct
legacy-member census since go-live, a 7-day `client_errors` code census, the full row behind the
new MEDIA-4007, and profile-creation dates for the three members new to the legacy-only set.

## Result

| metric | value | vs 08-28 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 10 | 3 → 10 |
| `new_legacy_only_posts` | 11 | 3 → 11 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **10** | 3 → 10 |
| canonical posts (24h) | **17** | 1 → 17 |

## No defect in the window

Both alerting codes are zero. The one media code that fired, MEDIA-4007 at 2026-08-28 05:14:04,
is the documented benign floor and not a failure: `event=POST_PERMANENTLY_LEGACY_ONLY`,
`severity=warn`, `fn=createProfileUpdatePost`, raised by design because a profile-picture
announcement points at a mutable avatar object and so cannot carry stable content identity. Its
own `next_step` field reads "NOTHING TO FIX." It is the eleventh legacy-only post and the reason
`new_legacy_only_posts` (11) exceeds `new_unexplained_legacy_posts` (10) — the delta function
correctly classified it as explained. It came from `c6e25b42`, a web member whose profile was
created 05:10:15 the same morning, four minutes before the post; their only post ever.

The 7-day census otherwise shows the single 2026-08-23 16:01:13 cluster (MEDIA-4010 ×1,
MEDIA-4002 ×1, MEDIA-4001 ×1) unchanged, AUTH-1010 ×2 and SYS-9008 ×2 out of slice, and two
uncoded rows. Nothing new has fired in the media write path.

## The write path is healthy, and busier than it has been

17 canonical posts across six members — `cc691988` ×9, `83f6d083` ×3, `511a9922` ×2, and
`0a41ed5e`, `4c200b33`, `569aa88e` ×1 each — spread from 07:20 to 14:12 UTC. Total posting
volume was 28 posts on 08-28 against 4 on 08-27. This is the strongest positive proof of a
working write path in the monitoring series so far, and it means the raw tail count has to be
read against volume: the tail's share of daily posts **fell** from 75% (3 of 4) on 08-27 to 36%
(10 of 28) on 08-28.

## Abort condition: the "live canonical" clause is not met; the "new member" clause is

No legacy-only author has a canonical post or a `media_objects` row after the 2026-08-20 15:51
go-live. All five are clean on that test:

| member | platform | posts | canonical | last canonical | canonical after go-live | media_objects after go-live |
|---|---|---|---|---|---|---|
| `01c5059c` | app | 28 | 18 | 2026-08-19 11:44 | 0 | 0 |
| `c2f9619d` | app | 21 | 13 | 2026-08-20 07:08 | 0 | 0 |
| `316b47ee` | app | 9 | 8 | 2026-08-19 04:52 | 0 | 0 |
| `26fae852` | app | 1 | 0 | — | 0 | 0 |
| `c6e25b42` | web | 1 | 0 | — | 0 | 0 (MEDIA-4007 floor) |

So the write path did not fail for any of them — their clients never invoked it. That is the
old-build signature, not a defect.

The two new entrants are both dormant-account returns rather than new installs, which is the
benign reading. `316b47ee` registered 2026-07-29, posted canonically through 08-19, then went
quiet for nine days and returned on 08-28 — a client that slept through the rollout window.
`26fae852` registered 2026-07-29 and posted for the very first time on 08-28 at 20:54; an app
installed in July and never opened until now would not have the new build.

## Reading the 3 → 10 step honestly

Per-day legacy-only / canonical / total: 08-15 0/3/3, 08-16 0/5/5, 08-17 1/16/17, 08-18 1/5/6,
08-19 0/12/12, 08-20 1/1/2, 08-21 5/7/12, 08-22 4/5/9, 08-23 3/0/3, 08-24 4/0/4, 08-25 3/4/7,
08-26 1/0/1, 08-27 3/4, 08-28 11/17/28.

Ten app-channel legacy posts is the highest absolute count in the series, and it does represent
day-over-day growth. Three things argue against reading it as a trend break:

Seven of the ten came from `01c5059c` alone, in bursts (four posts inside two minutes at 14:01–14:02,
two more at 15:43–15:46, one of them a seven-image post). One member having a heavy posting day
moves this metric more than the tail population changing size. The other three app posts are one
each from `c2f9619d`, `316b47ee` and `26fae852`.

Distinct legacy-only app members per day since go-live runs 1, 3, 3, 2, 2, 3, 1, 2, **4**. Four
is the high, but only by one, and members entering the tail is not new — `0f41ef16`, `39759f18`,
`581963f3` and `01c5059c` all first appeared on days after go-live. The 08-28 report's phrasing
("no new member entered the tail this cycle") set a bar that the preceding week would also have
failed on four separate days. It is a signal worth watching, not by itself an abort.

The tail's share of volume fell, as noted above. If the population were genuinely re-expanding
rather than the day being noisy, the expectation would be share rising alongside count.

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 is live still cannot be established from this
session (no Play Console access), so the "tail must not grow after rollout is live" clause stays
unarmed for a fourth cycle — which is precisely why the 3 → 10 step cannot be adjudicated
properly here. Per the 08-28 finding, `client_errors.app_build` is error-conditioned and stale
and offers no DB-side path to a direct build reading; that line of inquiry was not re-run.

**This is now the load-bearing gap in the monitoring slice.** Three of the last four runs have
ended with the same unverifiable clause. If the rollout is live and has been for a week, a tail
that triples is a different event than if the rollout has not shipped at all.

## Notification

**Sent** (push + email). Not a defect page — a heads-up that the tail metric tripled to a series
high and two members newly entered the tail population, with the explicit note that MEDIA-4009
and MEDIA-4010 are zero and the write path is healthy.

## Abort condition for the next run

Escalate if a second MEDIA-4010 or any MEDIA-4009 appears; if a legacy-only post appears from a
member with a canonical post or `media_objects` row dated after go-live; if the tail exceeds 10
app-channel posts again, or holds above ~35% of daily volume for two consecutive days; if more
than four distinct app members appear in the tail on one day; or if another daily run is missing.
Replacing the 08-28 "any new member" clause with the count/share/distinct-member thresholds above,
since the per-day census shows single new entrants are normal background for this population.
