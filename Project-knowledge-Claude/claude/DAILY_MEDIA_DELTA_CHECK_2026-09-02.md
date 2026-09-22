# DAILY MEDIA-DELTA HEALTH CHECK — 2026-09-02

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: ALERT (defect-shaped, not tail)**
**DB clock at run:** 2026-09-02 03:35:34 UTC (24h window covers 2026-09-01 03:35 → 2026-09-02 03:35)

## Claim

The raw tail shrank — and the failure got worse. Distinct legacy members fell from eight to three
and app-channel legacy posts from ten to two, which on the mechanical reading is TAIL-ONLY. It is
not. **The canonical write path ran, produced a verified media object, and the post was still
written legacy-only.** Both media objects created in the window are orphaned, zero canonical posts
were written, and the last canonical post on the whole system is **2026-08-31 11:14:42 UTC —
40h21m before this run**, with **nine consecutive legacy-only posts since**. MEDIA-4009 and
MEDIA-4010 remain zero, so the named alert codes did not fire; the evidence that this is a defect
comes from the object/post join, not from the error table. This run notified the owner.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, via the Supabase MCP connector
against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution for the three
legacy-only posts with per-member canonical history, post-go-live `media_objects` counts and
last-seen `app_build`; a 14-day legacy/canonical/total/distinct-member breakdown; a 48-hour
`client_errors` dump with full diagnostic fields plus a 24-hour code census; a per-day
`media_objects` census by visibility/state with linked-vs-orphaned counts since 2026-08-14; and a
72-hour post-by-post `post_media` row count.

## Result

| metric | value | vs 09-01 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | **3** | 12 → 3 |
| `new_legacy_only_posts` | **3** | 13 → 3 |
| MEDIA-4009 (24h) | **0** | unchanged (10th consecutive day) |
| MEDIA-4010 (24h) | **0** | unchanged (10th consecutive day) |
| app-channel legacy posts (24h) | **2** | 10 → 2 |
| canonical posts (24h) | **0** | 2 → 0 |

`new_unexplained` equals `new_legacy_only` at 3. There is **no benign avatar floor in this window** —
no MEDIA-4007, no profile-update post. All three are real `/post-images/` posts. That is a change
in kind from every recent cycle, where the floor absorbed one row.

## The finding: a verified object, and a legacy-only post anyway

Member **`c270d9d9`**, `last_platform='web'`, on build **`2026-08-20-2`** (post-go-live), 7 posts
of which 5 canonical:

- **10:47:24.496** — `media_objects` row `d13a4a09` created. `state='ready'`, `mime=image/webp`,
  1769×2560, 525,638 bytes. **`verified_at` 10:47:29.824.** The media engine ingested and verified
  the photograph.
- **10:49:10.518** — `MEDIA-4006` / `PHOTO_NOT_DESCRIBABLE`, `severity=warn`,
  `fn=registerUploadedPhoto`, reason **"No StoredObjectFacts for this slide, so nothing could be
  declared."**
- **10:49:27.729** — post `dd7ace0e` created. One legacy image URL, **zero `post_media` rows**.
  The verified object `d13a4a09` is linked to **no post**.

This is not a member on an old build falling back to a legacy path. The new path ran to completion,
produced a ready and verified canonical object two minutes before the post, and the post-creation
step then could not see it. The object and the post exist side by side, unjoined. MEDIA-4006 is a
`warn`, not one of the two codes this monitor alerts on, which is exactly why the error table reads
clean while the data does not.

Against the abort conditions carried forward from the 09-01 report, two fired on this member alone:
a legacy-only post from a member with post-go-live canonical evidence that is **not** an
avatar/MEDIA-4007 post, and a further **web**-channel legacy-only post with a real `/post-images/`
URL. The 09-01 report predicted a second, drain-resistant legacy-only source. This is it, with a
mechanism attached.

## Orphaning is new, and it is total

`media_objects` created per day, all `state='ready'`, linked vs orphaned:

08-19 228 objects / 224 linked / 4 orphaned (public) · 08-20 36 public 36 linked, plus 1 private
0 linked · 08-21 8/7/1 · 08-22 5/5/0 · 08-25 4/4/0 · 08-27 1/1/0 · 08-28 17/17/0 · 08-29 3/2/1 ·
08-30 3/3/0 · 08-31 2/2/0 · **09-01 2 objects / 0 linked / 2 orphaned, 2 distinct members**

Every day since go-live linked all or nearly all of its objects. 09-01 linked none. Two objects,
two different members, both `ready`, both `verified_at` set within six seconds of creation, both
attached to nothing.

The second is member **`ac6e4fe1`** — object `f9d3de78`, created 17:44:51, verified 17:44:56,
2560×1920 — orphaned, and created 59 minutes *after* that member's legacy-only post `e46a0d5b`
(16:45:49). Note this member was recorded on 08-31 as having **zero** post-go-live `media_objects`
and was classified old-build tail on build `2026-08-10-3`. They now demonstrably produce verified
canonical objects. The old-build explanation no longer covers them cleanly.

## What still does read as tail

Member **`c2f9619d`** (post `bb1c5da2`, 09-01 04:35:47, app, build `2026-08-10-3`, zero post-go-live
`media_objects`, last canonical 2026-08-20 07:08:49). Unchanged old-build signature. One post, one
member. On its own this would be TAIL-ONLY and unremarkable.

Tail breadth genuinely improved: distinct legacy members 8 → 3, app-channel legacy 10 → 2. The
09-01 abort condition "distinct legacy members stay above four for a second consecutive day" did
**not** fire. Neither did ">10 app-channel legacy posts". The volume-share test is not met either —
3 posts is far below the 10-post floor. Nothing in the tail series is what makes this an ALERT.

## The rollout question, with new evidence

**Nine `SYS-9008` / `APP_UPDATE_CHECK_FAILED`** rows on 09-01 between 05:40 and 09:37, all
`severity=warn`, `fn=checkForUpdate`, all from a single device on build `2026-08-20-2`. Reasons
alternate between `-10: Install Error(-10): The app is not owned by any user on this device` and
`Failed to bind to the service`. The code's own `next_step` reads: *"Harmless once; persistent hits
mean members are stranded on [old builds]."* Nine hits in four hours is persistent by that
definition.

This does not confirm the rollout state, but it is the first direct evidence of a **mechanism** by
which members would fail to receive v1.2.16 even if it did ship: the update check itself is failing.
It is worth checking whether this is one misconfigured device or the Play integration generally.

**Play Console access remains unavailable — eighth consecutive cycle.** This scheduled run has no
access to the owner's computer. Confirming the rollout state by hand is still the one action that
would resolve the ambiguity, though it now matters less than it did: the `c270d9d9` finding is a
defect regardless of what Play is doing.

## Out-of-slice observations

A second consecutive day of web chunk staleness: `SYS-9002` / `ROUTE_CRASHED_BOUNDARY_CAUGHT`,
`severity=fatal`, at 09-01 06:10:20 for member `4c200b33`, preceded 53ms earlier by
`TypeError · Failed to fetch dynamically imported module`. One member, one crash, on build
`2026-08-20-2`.

The AUTH-1010 cluster did **not** recur — zero in this window, against four on 08-31 afternoon.

The undecodable `.nef` at `/avatars/ac6e4fe1-…/stories/` produced no new failures in this window
(its last hits were 08-31 06:42 and earlier). Still unfixed, but quiet.

Remaining noise: one `image_load` failure on the site logo fallback (09-01 09:21).

## What to look at first

1. **`registerUploadedPhoto` and StoredObjectFacts.** Member `c270d9d9`, post `dd7ace0e`, object
   `d13a4a09`, 2026-09-01 10:47–10:49 UTC. The object was ready and verified before the post was
   written. Find why the slide had no StoredObjectFacts at post time when the upload had already
   succeeded. This is the whole finding.
2. **The two orphaned objects.** `d13a4a09` (`c270d9d9`) and `f9d3de78` (`ac6e4fe1`) — both ready,
   both verified, both linked to nothing. If these can be joined to their posts after the fact,
   that is a repair path; if not, understand what is missing.
3. **40 hours with no canonical post.** Last canonical: `9cc1b954`, 2026-08-31 11:14:42. Nine
   legacy-only posts since, no canonical. Volume is low, so this is not conclusive alone — but
   combined with 2/2 orphaning it is the shape of a write path that stopped joining.
4. **`SYS-9008` ×9.** One device or the Play integration? Decides whether the tail can drain at all.

## Abort condition for the next run

Escalate if any MEDIA-4009 or MEDIA-4010 appears; if **any** further legacy-only post appears from a
member on a post-go-live build; if any further `media_objects` row is created and left orphaned; if
another MEDIA-4006 fires; if canonical posts remain at zero for a third consecutive day while
legacy-only posts continue; if distinct legacy members return above four; if app-channel legacy
posts exceed 10; or if a daily run is missing. Also watch: `SYS-9008` frequency and whether it
spreads beyond one device, further `SYS-9002` chunk-staleness crashes, and any return of AUTH-1010
clustering.

## Notification

**Sent.** The canonical write path produced a verified object and the post was written legacy-only
anyway — a defect, not the rollout tail, and the first cycle where the mechanism is visible.
