# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-27

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: TAIL-ONLY**

## Claim

The 24-hour window is clean. No MEDIA-4009 and no MEDIA-4010. One legacy-only post, from an
app-channel member with zero live media objects — the old-build rollout tail, which shrank
again (3 → 1). No new occurrence of the 2026-08-23 MEDIA-4010 defect, and no missing daily run
since the last report.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution
for the legacy-only post (author's canonical history and count of `media_objects` created after
the 2026-08-20 15:51 UTC go-live), an 11-day legacy/canonical breakdown, and a 7-day
`client_errors` code census including the uncoded rows.

## Result

| metric | value | vs 08-26 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 1 | 3 → 1 |
| `new_legacy_only_posts` | 1 | 3 → 1 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **1** | 3 → 1 |
| canonical posts (24h) | **0** | 4 → 0 |

The legacy-only post is `f96e3690`, created 2026-08-26 05:03:18 UTC, one image, by member
`c2f9619d` on `last_platform='app'` — the same member who produced one of the 08-25 tail posts.
That member has 13 canonical posts, all migration backfill, and **zero** `media_objects` created
after go-live. So the abort condition — a legacy-only post from a member with a live canonical
post behind them — is not met.

## Canonical count of zero is volume, not failure

`canonical_posts_24h` reads 0, but so does total posting volume: the 11-day breakdown shows
08-26 with one post (the legacy-only one) and 08-27 with none so far. There were no canonical
posts to lose. This gives no positive proof the write path ran today, but it is not evidence
against it — the last live canonical writes were on 08-25 (4 posts, 9 media objects).

## Regressions

None. The 7-day `client_errors` census still shows exactly one MEDIA-4010, one MEDIA-4002 and
one MEDIA-4001, all from the single 2026-08-23 16:01:13 UTC cluster already reported on 08-26.
Nothing new has fired since. MEDIA-4007 remains a single 08-21 occurrence.

The four uncoded `client_errors` rows in the week were checked and are outside this slice: two
`image_load` failures on the same CDN prefix (`ba812284…`) and two `blank_page` chunk-load
failures on web. The most recent, 2026-08-26 05:05:53, lands two minutes after the legacy-only
post but belongs to a different member (`cc691988`) on `/feed`, so it is a read-path image
failure, not a write-path one. Worth a separate look if it recurs; it is not a media-write
defect.

## Tail trend

Per-day legacy-only counts: 08-16 0, 08-17 1, 08-18 1, 08-19 0, 08-20 1, 08-21 5, 08-22 4,
08-23 3, 08-24 4, 08-25 3, 08-26 1, 08-27 0 so far. The tail has declined four days running from
the 08-21 peak of 5. It is not growing, so under the G4 rule it stays a decay curve. As noted
on 08-26, the 08-23 count of 3 includes the defect post `7652b6b6`, which is not an old-build
post and should be subtracted from the tail population.

## Monitoring gap

Closed for this cycle — the 08-26 run produced a document and this 08-27 run did too. No
consecutive-day gap remains.

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 is live (no Play Console access from this
session), so the "tail must not grow after rollout" clause still cannot be armed. The posting
client build for `c2f9619d` is not recorded on the post row, so "old build" remains an inference
from the zero live media objects rather than a direct build reading.

## Abort condition for the next run

Unchanged: escalate if a second MEDIA-4010 or any MEDIA-4009 appears, if a legacy-only post
appears from a member with a live canonical post behind them, if the tail resumes growing once
build 1111 is confirmed live on Play, or if another daily run is missing.
