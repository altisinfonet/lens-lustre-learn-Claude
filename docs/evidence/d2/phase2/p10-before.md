# P10 · the BEFORE reading on the device

**Owner-attested, 2026-09-27. Recorded by D2 under AUDITOR R-64.**

This is the "before" half of the runbook at `docs/evidence/d2/runbook-android.md`,
taken on the **unfixed** staging site — staging `9d7f992`, which does not contain
2-D2-04. It is the reading the AFTER session will be compared against, and it has
to be read with the limits the Auditor attached to it, which are below and are
not optional context.

## The reading

| | |
|---|---|
| Site | staging `9d7f992` — **before** 2-D2-04 |
| Browser | Chrome |
| Session | the runbook's feed session |
| **Battery** | **95 % → 80 % = 15 percentage points** |
| Sessions run | **one** |
| Jank (frame bars) | **not taken** |

Attested by the Owner. D2 did not measure this and does not present it as its own
measurement.

## What the Auditor ruled about it (R-64)

Verbatim Owner decision on the jank screenshots: *"screenshiot does not required.
go head"*.

1. **The jank clause of P10 is DEFERRED, not VERIFIED.** Frame bars on the device
   were not captured, so the runbook's jank leg has no reading on either side.
   Nothing in this unit may be described as having improved jank on a device.
2. **The device battery leg is one session per side, not three.** The runbook asks
   for three because one session has no noise band; with one, there is no negative
   control and the spread is unknown.
3. **Therefore the battery comparison is INDICATIVE, not VERIFIED.** A
   single-session difference **smaller than about 3 percentage points cannot be
   claimed as an improvement**. 15 → 13 is noise. 15 → 8 is a signal.
4. **The Phase 0 CI harness readings remain the primary performance evidence for
   P10** — they are VERIFIED, they run on the same build, and they are the row the
   runbook now points at for Web Vitals after R-62.

## Why this file exists rather than a line in the report

The runbook was written so that it *can* come back worse (R-62 accepted it on
exactly that basis). A BEFORE reading that lives only in a session report is a
number nobody can re-read when the AFTER arrives, and the temptation then is to
compare against whatever is remembered. So the reading, its date, who attested it,
the commit it was taken on, and the three limits above are committed together, in
the repository, before the AFTER session happens.

**The one thing this file must not be used for:** it must not be quoted as
"P10 saved 7 points of battery" once the AFTER reading exists. With one session per
side and no jank leg, the honest sentence has the word *indicative* in it.

## AFTER

The Owner repeats the same session once, on staging, after 2-D2-04 (#310) and the
P1 client half have merged. The result goes in
`docs/evidence/d2/runbook-android-RESULTS-TEMPLATE.md` and is compared here.
