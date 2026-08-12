# The root fix: the image retry is now bounded (2026-08-07)

Owner, after the second recurrence in three days:
> *"if same issues happens again and again then no point of solving the issues
> from root level."*
> *"after sreach issues resolve didn't touch still not working why?"*

He was right on both counts, and the second question has a precise answer.

## Search was never a separate bug

The SAME visible failure — search hangs, backspace does nothing, app freezes —
was produced twice by two DIFFERENT image bugs:

| date | trigger | what was fixed | what was left alone |
|---|---|---|---|
| 2026-08-05 | recycled `<img>` nodes inheriting stale retry state | the trigger | **the amplifier** |
| 2026-08-07 | a GUESSED thumbnail address (1 post in 3 dead) | the trigger | **the amplifier** |

Both times the trigger was fixed and the amplifier survived, so the next image
mistake reproduced the identical symptom. That is exactly the pattern the owner
called out.

**The amplifier is `src/lib/imageFallback.ts`.** Per failed image it fired up to
2 extra requests, each carrying a `__r=` cache-busting parameter that
deliberately defeats every cache — and NOTHING limited how many ran at once. A
feed of broken photos became hundreds of simultaneous uncacheable requests,
which saturates a phone connection and starves the main thread. Search is simply
where it is felt first, because it re-renders (and re-fails) on every keystroke.

So: image failure → request flood → frozen typing. Search hanging is a SYMPTOM
of image failure on this app, not an independent fault.

## The two bounds (commit 7b0ef52)

1. **Concurrency cap** — `MAX_CONCURRENT_RETRIES = 3`. At most 3 retry requests
   in flight ever; the rest queue (capped at 60) and are released as each
   settles. Recovery still happens, the flood does not. Slots are released on
   EVERY exit path (unmounted node, stale retry, load, error) — a leak here
   would silently disable retrying for the whole session.
2. **Circuit breaker** — `STORM_THRESHOLD = 10` failures inside
   `STORM_WINDOW_MS = 10s` means the failure is systemic (bad deploy, dead CDN,
   no connectivity). Retrying cannot cure any of those and makes all of them
   worse, so retries stand down for `STORM_COOLDOWN_MS = 60s` and failures go
   straight to the placeholder. Members see the same grey box they would have
   seen anyway — but the app keeps working and search keeps typing.

**Deliberately unchanged:** a single failed image on a healthy app still gets its
two cache-busting retries. That is the behaviour that rescues a photo lost to one
dropped packet, and it is pinned by test.

## Proof — behavioural, and mutation-checked

`src/lib/__tests__/imageRetryBounded.test.ts` (NEW) drives real `<img>` elements
and real error events rather than reading source, because "the app must not flood
the network" is a runtime claim. 6 tests:

- 8 simultaneous failures → exactly 3 requests in flight (was 8)
- a settled retry hands its slot to a queued one
- unmounted images release their slots (no leak)
- past the storm threshold, later failures go straight to placeholder
- a single failure still retries (rescue path intact)
- a genuinely dead image still ends at the placeholder

**Mutation check:** with `MAX_CONCURRENT_RETRIES=9999` and
`STORM_THRESHOLD=999999`, exactly the 4 bound tests go red and the 2
preserved-behaviour tests stay green. The tests have teeth.

Gates: `tsc` exit 0 · full suite 911 passed / 25 failed (the documented
pre-existing set: PhaseWatermark, ProfilePhotoPrompt, JudgeGuideModal,
complete-round-progression) / 1 skipped — zero new · eslint clean on all changed
files · every pushed file byte-diffed against origin/main.

Note: `imageFallbackRecycle.test.ts` pinned two guards by their exact literal
`... ) return;`, which now read `return releaseRetrySlot();`. Relaxed to match
the condition rather than the statement ending — the guards themselves are
unchanged and still ordered.

## Shipped as build 1058 (run #58, commit 877a254)

1058 carries both halves: the stored-thumbnail fix (see
INCIDENT_BROKEN_IMAGES_2026-08-07.md) and this bound. Verified before cutting:
**178 of 178 posts' stored thumbnails load** (probed as real `<img>` loads
through the owner's browser, since cdn.50mmretina.com 403s datacenter IPs), and
the old derived address failed on **27%** of a 60-post sample.

## The rule this establishes

**Any image-loading change must be considered against this global handler.**
A component-level fallback and a global retrier both writing `src` on the same
element is what produced the 2026-08-07 incident. The bounds make that class of
mistake survivable; they do not make it impossible.

**And the standing principle:** when the same symptom returns from a new cause,
fix the multiplier, not just the trigger.
