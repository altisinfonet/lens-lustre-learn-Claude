# DAILY MEDIA-DELTA HEALTH CHECK — 2026-09-01

**Run:** scheduled monitoring slice (Phase-5) · **Mode:** read-only · **Verdict: ALERT (escalation, not a defect)**
**DB clock at run:** 2026-09-01 03:35:23 UTC (24h window covers 2026-08-31 03:35 → 2026-09-01 03:35)

## Claim

There is still no write-path defect. MEDIA-4009 and MEDIA-4010 are both zero for the ninth
consecutive day, and canonical writes demonstrably work on both channels inside the window. But
the tail stopped decaying and broke sharply in the wrong direction: **eight distinct members**
produced legacy-only posts on 08-31, against **one** on each of the two preceding days, and the
tail took 87.5% of the day's posting volume. Two members entered the tail who had never been in
it since go-live, one of them on **web** — a channel the Android-rollout-tail explanation does not
cover. Three of the abort conditions carried forward from the 08-31 report have fired. This run
notified the owner.

## Instrument

`public.media_write_path_delta()` plus the four supporting counters, run via the Supabase MCP
connector against `jtdtehuqtinjxropkkcn`. Supplementary read-only queries: per-post attribution for
all thirteen legacy-only posts with per-member canonical history and post-go-live `media_objects`
counts; first-image URL for every legacy-only post; a 12-day legacy/canonical/total/distinct-member
breakdown; a per-member first-appearance-in-tail census since the 2026-08-20 15:51 UTC go-live; a
72-hour `client_errors` row dump with full diagnostic fields; and last-seen `app_build` per tail
member.

## Result

| metric | value | vs 08-31 |
|---|---|---|
| `delta_growing` | **true** | unchanged |
| `new_unexplained_legacy_posts` | **12** | 6 → 12 |
| `new_legacy_only_posts` | **13** | 6 → 13 |
| MEDIA-4009 (24h) | **0** | unchanged |
| MEDIA-4010 (24h) | **0** | unchanged |
| app-channel legacy posts (24h) | **10** | 6 → 10 |
| canonical posts (24h) | **2** | unchanged |

`new_legacy_only_posts` exceeds `new_unexplained_legacy_posts` by exactly one. That one post is the
documented benign floor, identified below.

## No defect in the window

Both alerting codes are zero. The only media code that fired is **MEDIA-4007** at
2026-08-31 11:00:52, `event=POST_PERMANENTLY_LEGACY_ONLY`, `severity=warn`,
`fn=createProfileUpdatePost`, `next_step` = "NOTHING TO FIX" — the adjudicated floor. It belongs to
post `f65380ad` by member `569aa88e`, whose first image URL is
`/avatars/569aa88e…/avatar.webp?t=…`, a mutable avatar object that cannot carry stable content
identity. This post is why `569aa88e` superficially trips the strongest abort condition — a
legacy-only post from a member with post-go-live canonical evidence (5 `media_objects` after
go-live; a canonical post at 11:14:42, fourteen minutes *after* the legacy-only one). Checked
directly: the condition resolves benign. That member's write path is working; the product simply
cannot make an avatar announcement canonical.

That canonical post at 11:14:42, from web build `2026-08-20-2`, is also the positive proof that the
web write path is live today.

## What actually fired

Per-day legacy-only / canonical / total / distinct legacy members:

08-20 1/1/2/1 · 08-21 5/7/12/3 · 08-22 4/5/9/3 · 08-23 3/0/3/3 · 08-24 4/0/4/2 · 08-25 3/4/7/3 ·
08-26 1/0/1/1 · 08-27 3/1/4/2 · 08-28 11/17/28/5 · 08-29 2/2/4/2 · 08-30 5/2/7/1 ·
**08-31 14/2/16/8**

Against the 08-31 report's carried-forward abort list:

- **More than four distinct app members in the tail on one day — FIRED.** Six: `c2f9619d`,
  `ba812284`, `01c5059c`, `496d3cb9`, `581963f3`, `ac6e4fe1`.
- **A new member enters the tail after two consecutive single-member days — FIRED.** The
  first-appearance census shows two members with no legacy-only post at any point since go-live
  until 08-31: `5745a9c9` (web, 03:55:41 and 03:56:13) and `ac6e4fe1` (app, 05:42:50).
- **Tail share of daily volume — FIRED for one day, not two.** 14 of 16 posts is 87.5% on a day
  clearing the 10-post floor. 08-30 had only 7 posts, so the two-consecutive-day form of the test
  is not met. Recorded, not counted.
- App-channel legacy posts at **10**, exactly at the >10 threshold and not over it.
- No MEDIA-4009 and no second MEDIA-4010.
- No daily run missing — 08-31 ran and is on file.

Three fired conditions, one of them the breadth measure this monitor has been treating as its most
diagnostic series. The distinct-member count had contracted to a floor of one for two days running;
it went to eight in a single day.

## The app-channel majority still reads as old-build

All six app-channel tail members carry a last-seen `app_build` of `2026-08-10-3` or older, or none
at all (`ba812284` has never filed a client error). None has a single `media_objects` row created
after go-live. Their canonical histories all terminate before 2026-08-20:
`c2f9619d` last canonical 08-20 07:08:49, `01c5059c` 08-19 11:44:39, `496d3cb9` 08-11 14:46:11,
`581963f3` 08-18 13:28:45, `ba812284` and `ac6e4fe1` never canonical. That remains the old-build
signature, and on its own it would still be TAIL-ONLY.

`581963f3` alone posted five legacy-only images in a 28-minute burst (15:20–15:48), which is what
carries the raw count. `ac6e4fe1` is a member whose profile was created 08-30 12:13 — a *new*
member arriving on build `2026-08-10-3`, which is worth noting: new installs should not be landing
on a pre-go-live build if the rollout is live.

## The part that does not fit the tail story

Member **`5745a9c9`**, `last_platform='web'`, posted two legacy-only posts at 2026-08-31 03:55:41
and 03:56:13. These are **not** avatar posts — both first images are real
`/post-images/5745a9c9…/posts/…` objects. The member has 12 posts, 8 canonical, last canonical
**2026-08-19 10:34:31**, and zero `media_objects` after go-live. Their last recorded client error is
**2026-08-07**, on build `2026-08-06-11`.

A web member cannot be waiting on a Play rollout. Two readings fit: a stale cached web bundle (the
`blank_page` dynamic-import failure on 08-29 shows chunk staleness is live on web), or a
`last_platform` value that is misattributed and the member is actually on an old app build. The
first is more likely given the 08-06 build stamp, and it matters because it would mean a *second*
legacy-only source exists that the rollout will not drain. This is the single most useful thing to
look at first.

## Out-of-slice observations

The 08-30 FILE-5002 RAW upload has gotten worse, as flagged. The undecodable `.nef` at
`/avatars/ac6e4fe1-…/stories/1788092342483-1000110078.nef` failed to render **seven more times** in
the last 72 hours (08-30 12:20, 08-31 00:15, 02:10, 05:45 ×2, 06:02, 06:42), across three different
members including `cc691988` and `4c200b33` scrolling the feed. It is a persistent broken image for
everyone who passes it. Still not a media-write defect; still unfixed.

New this cycle: **four AUTH-1010 / `SESSION_ENDED`** rows on web build `2026-08-20-2` between
13:36 and 14:54 on 08-31, all `severity=error`, all `fn=AuthProvider.onAuthStateChange`, all with
null `user_id`. Four unexplained session terminations inside 78 minutes is a cluster, not the
background rate — the prior 7-day census had one. Out of this slice, but it wants an owner's eye.

Remaining noise: one `image_load` failure on the site logo fallback (09-01 02:11).

## Could not verify

Whether the Play rollout of build 1111 / v1.2.16 is live. No Play Console access, and this
scheduled run has no access to the owner's computer. **Seventh consecutive cycle with this gap**,
and it is now load-bearing in a way it was not before: the breadth of the tail expanding eightfold
in one day is what you would expect if the rollout never shipped, and a brand-new member landing on
build `2026-08-10-3` on 08-30 is weak independent evidence pointing the same way. Confirming the
rollout state by hand is the one action that turns this reading from ambiguous into decided.

## Notification

**Sent.** Three abort conditions fired, including the breadth measure, and a legacy-only source
appeared on a channel the tail explanation does not cover.

## What to look at first

1. `5745a9c9` — why is a web member producing legacy-only posts on 08-31 with a build stamp from
   08-06? Stale bundle, or misattributed `last_platform`? This decides whether there is a second
   drain-resistant source.
2. Play Console — is build 1111 / v1.2.16 actually rolled out? A new member landing on
   `2026-08-10-3` on 08-30 suggests it is not.
3. The AUTH-1010 cluster of four on 08-31 afternoon.
4. The `.nef` in `/avatars/ac6e4fe1-…/stories/` — still breaking the feed for third parties.

## Abort condition for the next run

Escalate if any MEDIA-4009 or a second MEDIA-4010 appears; if a legacy-only post appears from a
member with post-go-live canonical evidence that is **not** an avatar/MEDIA-4007 post; if distinct
legacy members stay above four for a second consecutive day; if any further **web**-channel
legacy-only post appears with a real `/post-images/` URL; if app-channel legacy posts exceed 10; if
the tail exceeds ~35% of daily volume for a second consecutive day on days with at least 10 total
posts; or if a daily run is missing. Also watch: further AUTH-1010 clustering, and whether more
undecodable files reach the CDN.
