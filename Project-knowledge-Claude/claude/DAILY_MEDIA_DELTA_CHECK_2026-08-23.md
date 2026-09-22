# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-23

**Run:** scheduled monitoring slice (G3) · **Mode:** read-only · **Verdict: TAIL-ONLY**

## Claim

The media write path is healthy. The legacy-only population continues to come only from the
old-build (pre-1111) rollout tail, and the tail did not grow day over day.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution
for every legacy-only post in the 24h window (with each author's canonical history and latest
`media_objects.created_at`), an 8-day legacy/canonical/client-error breakdown, a 7-day
`client_errors` code census, and per-post attribution for the canonical posts in the window.

## Result

| metric | value | vs 08-22 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 4 | 5 → 4 |
| `new_legacy_only_posts` | 4 | 5 → 4 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **4** | 5 → 4 |
| canonical posts (24h) | **5** | 8 → 5 |

The four legacy-only posts come from three members: `ba812284` (two posts, 08-22 06:57 and
16:43 UTC), `39759f18` (08-22 11:01) and `c2f9619d` (08-22 04:58). All are `last_platform='app'`.

## Regressions

None found. The abort condition that mattered — a legacy-only post from a member with a *live*
canonical post behind them — was checked per author and did not fire. `ba812284` and `39759f18`
have zero canonical posts ever and no `media_objects` rows at all; `c2f9619d` has thirteen
canonical posts but their most recent `media_objects` row was created 2026-08-20 07:59 UTC,
before the write path went live at 15:51 UTC on 08-20, i.e. migration backfill, exactly as
established yesterday. No member who has the code has produced a legacy-only post.

`39759f18` is new to the tail (yesterday's three were `ba812284`, `c2f9619d`, `0f41ef16`), but
with no canonical history they are an ordinary pre-1111 member, not a regression.

## Tail trend

The 24h tail count moved 5 → 4, so it did not grow. Per-day legacy-only counts for the last
week: 08-16 0, 08-17 1, 08-18 1, 08-19 0, 08-20 1, 08-21 5, 08-22 4, 08-23 0 so far. The 08-21
step up coincides with the write path going live, which is the expected shape: posts that were
always legacy only became *visible* as legacy once canonical writes started. Under G4 this is
still not a defect — the gate is "zero legacy-only posts from builds ≥ 1111".

## Correction to yesterday's caveat

Yesterday's document recorded that `client_errors` had taken no rows of any code since
2026-08-21 04:27 UTC, and therefore treated the zero MEDIA-4009/4010 reading as weak evidence.
That is no longer true: the table has rows on 08-21 (4) and 08-22 (1), the most recent at
08-22 08:18 UTC. Client error reporting is alive, so today's zeros are real zeros rather than a
silent pipeline. The 7-day code census shows no MEDIA-4009 or MEDIA-4010 at all; the only
MEDIA-family row in the week is a single MEDIA-4007 at 2026-08-21 04:27 UTC, outside today's
window and outside the alert rules.

## Possible early rollout signal

Both canonical app-channel posts in the window (08-22 14:20 and 14:22 UTC) came from
`060170a3`, a different member from the sideloaded build-1111 device (`cc691988`) that produced
the Android acceptance posts. That is consistent with build 1111 having reached at least one
member through Play, which would be the first sign of the tail acquiring a decay mechanism.
Not confirmable from here — see below.

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 has been performed (no Play Console access
from this session). The `060170a3` canonical posts are suggestive but a second sideload would
look identical.

## Abort condition for the next run

Unchanged: escalate to ALERT if MEDIA-4009 or MEDIA-4010 becomes non-zero; if a legacy-only
post appears from a member who has previously produced a *live* canonical post; or if the tail
resumes growing once build 1111 is confirmed live on Play.
