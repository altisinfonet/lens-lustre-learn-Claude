# DAILY MEDIA-DELTA HEALTH CHECK — 2026-08-31

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: TAIL-ONLY**
**24h window:** 2026-08-30 ~03:3x → 2026-08-31 ~03:3x UTC

## Claim

No defect. MEDIA-4009 and MEDIA-4010 are both zero for the eighth consecutive day. The tail
metric rose 2 → 6, but every one of the six legacy-only posts comes from a **single, already-known
tail member** (`01c5059c`), and the tail's *breadth* continued to contract: 5 distinct members on
08-28, then 2, then 1, then 1. Two canonical posts landed in the same window, so the write path is
demonstrably live. The abort condition — a legacy-only post from a member with a canonical post or
`media_objects` row after the 2026-08-20 15:51 UTC go-live — is not met.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution for
all six legacy-only posts with per-member canonical history and post-go-live `media_objects` counts;
a 10-day legacy/canonical/total/distinct-member breakdown; a per-day distinct tail-member census
since go-live; a 7-day `client_errors` code census; and full row detail for every `client_errors`
row in the last 3 days.

## Result

| metric | value | vs 08-30 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | 6 | 2 → 6 |
| `new_legacy_only_posts` | 6 | 2 → 6 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **6** | 2 → 6 |
| canonical posts (24h) | **2** | unchanged |

`new_legacy_only_posts` and `new_unexplained_legacy_posts` are equal at 6 — no explained
(MEDIA-4007 floor) post in the window.

## The whole tail is now one member

All six legacy-only posts belong to `01c5059c`: `cf53a940` (08-30 07:19:36), `4c82c768` (15:54:26),
`a6dc3cb1` (18:03:48), `ac10ba66` (18:04:54), `607683fd` (18:05:45) and `fcef903f` (08-31 01:51:18),
one image each, `last_platform='app'`. The 18:03–18:05 trio is a three-post burst inside two minutes.

The member's profile is the textbook old-build signature. 34 posts total, 18 canonical ever, last
canonical post **2026-08-19 11:44:39** — before go-live. Their most recent `media_objects` row is
**2026-08-20 07:58:33**, also before go-live, and they have **zero** `media_objects` created after
it. Their post history shows the clean break: canonical through 08-19, then legacy-only on 08-25,
08-27 (×2), 08-28 (×7), 08-30 (×5) and 08-31 (×1) — fifteen consecutive legacy-only posts since
08-27, without a single canonical write among them. That is a client that never picked up the new
write path, not a write path failing intermittently.

They were already in the tail population on 08-25, 08-27 and 08-28. **No new member entered the tail
this cycle.**

## Why the 2 → 6 step is not the growth the rule means

The instruction's escalation clause is "tail count grows day over day *after the Play rollout is
live*". Two things blunt this reading.

First, the rollout precondition still cannot be established (see below), so the clause remains
unarmed for a sixth cycle. Second, the count moved on one member's posting volume, not on tail
recruitment. The more diagnostic series is distinct tail members per day since go-live: 08-20 1,
08-21 3, 08-22 3, 08-23 3, 08-24 2, 08-25 3, 08-26 1, 08-27 2, 08-28 5, 08-29 2, 08-30 1, 08-31 1.
That series is contracting, and has been at its floor of one member for two consecutive days. The
per-day legacy/canonical/total counts for the same stretch: 08-27 3/1/4, 08-28 10/17/27, 08-29 2/2/4,
08-30 5/2/7, 08-31 1/0/1.

None of the 08-30 report's carried-forward abort conditions fired: no MEDIA-4009 and no second
MEDIA-4010; no tail post from a member with post-go-live canonical evidence; app-channel legacy
posts at 6, under the >10 threshold; one distinct tail member, under the >4 threshold; the ~35%
share test is not reached because neither 08-30 (7 posts) nor 08-31 (1 post) meets the 10-post
volume floor; and no daily run is missing — 08-30 ran and is on file.

There is a practical observation in this. The remaining tail is one member's device. If the Play
rollout is in fact live, a single nudge to that member to update the app would take the tail metric
to zero and let this monitor close.

## Out-of-slice observations from `client_errors`

The 7-day census: 7 uncoded rows, SYS-9008 ×2 (08-27, the known `checkForUpdate` warning),
FILE-5002 ×1 (new), MEDIA-4007 ×1 (08-28, the adjudicated benign floor), AUTH-1010 ×1. The
2026-08-23 16:01:13 MEDIA-4010 cluster has now aged out of the 7-day window entirely and has not
recurred.

**New this cycle, and worth a separate look — not a media-write defect.** Member `ac6e4fe1` (app
build `2026-08-10-3`) selected a Nikon RAW file for a story on 2026-08-30 12:19:02. It raised
FILE-5002 / `IMAGE_NO_DECODER` in `decodeImage` (`src/lib/imageCompression.ts`), whose `next_step`
says this is expected for HEIC and RAW and needs investigation only if the type is one we claim to
support. But the file nevertheless reached the CDN at
`/avatars/ac6e4fe1-…/stories/1788092342483-1000110078.nef`, and it has since failed to render three
times — 08-30 12:20, 08-31 00:15 (both `ac6e4fe1`) and 08-31 01:52 (`cc691988`, a different member
viewing `/feed`). So an undecodable RAW was accepted into storage and is now a persistent broken
image in the feed for anyone who scrolls past it. The decode failure is documented behaviour; the
part that is not obviously intended is that the upload proceeded anyway. Filed here for the owner,
outside the media-write slice.

The remaining uncoded rows are the known read-path noise: an `image_load` failure on a post-images
webp (08-29 17:47) and a `blank_page` dynamic-import failure on web (08-29 06:37).

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 is live. No Play Console access, and this
scheduled run has no access to the owner's computer. Sixth consecutive cycle with this gap. The
`client_errors.app_build` values remain date-stamped strings (`2026-08-10-3`, `2026-08-20-2`), not
the numeric build code, confirming the 08-28 finding that this column offers no DB-side path to a
build reading.

This is still the load-bearing gap. The slice cannot distinguish "tail decaying because the rollout
shipped" from "tail flat because it never shipped" — though the contraction to a single member is
weak evidence for the former. Confirming the rollout state once, by hand, arms the only clause that
can close this monitor out.

## Notification

**Held.** No alerting code fired, no abort condition was met, and the tail movement is one known
member's posting volume against a contracting member census. Nothing here needs the owner before
their next working session. (The 08-30 all-clear was sent only because the owner had been paged on
08-29 and would otherwise have carried that state forward; no such open page exists today.)

## Abort condition for the next run

Escalate if any MEDIA-4009 or a second MEDIA-4010 appears; if a legacy-only post appears from a
member with a canonical post or `media_objects` row dated after the 2026-08-20 15:51 go-live; if
app-channel legacy posts exceed 10 in a window; if more than four distinct app members appear in the
tail on one day; if a **new** member enters the tail after two consecutive single-member days; if
the tail exceeds ~35% of daily volume for two consecutive days on days with at least 10 total posts;
or if another daily run is missing. Also worth watching, out of slice: whether FILE-5002 recurs, or
whether more undecodable files reach the CDN.
