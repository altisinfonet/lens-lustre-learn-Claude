# BUILD 1099 / v1.2.9 — SECOND ROUND FROM HIS PHONE

Date: 2026-08-16
Run: Android Build **#99** — https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31957631105
Commit: `68e9083`, preceded by `c0a0be2` (versionName bump)
Status: **SUCCESS**, 7m 59s.

Artifacts: `app-debug-apk-SIDELOAD-THIS` (13.9 MB) · `app-release-aab` (8.48 MB)

Gates: typecheck 0 · **1,863 tests pass** · production build 0 ·
**112 screenshots, ZERO layout problems, zero non-fixture errors**

## The five he found on 1.2.8

**1. "unable to move selection / any upper menu section not working / anything
editing not working."** The dialog was not frozen — **one tap on an aspect chip
deleted the crop frame** and nothing rebuilt it. The only code that ever created
a frame was the image's load event.

```
start        [100, 372, 211, 211]
after 4:5    null
```

After that: nothing to drag, the px readout blanks, and Crop & Upload **silently
sends the whole image**. It hid behind ROTATE, which reloads the image and so
re-seeded the frame — so rotating "fixed" it and nothing else did. Now any change
to the frame's shape re-seeds it. Verified: 4:5 → 190×238, Free → 211×211,
Reset → 211×211, never null.

**2. Create Post only worked from the Feed.** `WallPosts` is mounted twice — Feed
and wall — and **both** watched the URL for `?compose=1`. From the wall, the
still-mounted wall copy read the flag first and **stripped it from the URL**, so
Feed arrived to find nothing. Only the dedicated composer answers it now.

**3. Theme toggle overlapping his name.** His 2026-08-12 rule, which I overrode
that morning to reclaim 40px, arguing it was honoured "a stronger way". It could
not be *pushed*, so his name ran *underneath* it. Back on its own line. Measured
with his real name at 360×640 and 412×892: no overlap, Logout visible, nothing
hidden at 640+.

**4. Zoom.** Wheel zoom on web never existed — added. Pinch: **not claimed as
fixed**. The handler fires here (100% → 350% on a synthetic gesture); the likely
device cause is timing — the crop library captures the first finger before the
second lands — so every active pointer now gets a `pointercancel`.

**5. PDF downloads.** Two faults.

Three of four paths still used jsPDF's `doc.save()`, which clicks an
`<a download>` that an Android WebView silently swallows. The rule was
established **2026-08-05 from his own report** and written at the top of
`saveFile.ts` — and applied to **one of four** call sites:

| Path | Status before |
|---|---|
| Certificates | **broken, 11 days live** |
| Wallet ledger | **broken, 11 days live** |
| Admin transactions | **broken, 11 days live** |
| Journal / Featured artist | converted in August |

A test now walks every `.ts/.tsx` under `src/` and fails on any `doc.save(`.
Mutated to prove it.

And the journal path's handler was `catch {` with no argument and one fixed
sentence, so every possible cause arrived as the same four words.

**⚠ THE JOURNAL / FEATURED-ARTIST PDF IS NOT FIXED.** Cause still unknown;
instrumented so the next failure names itself.

## What only the phone can answer

1. Crop a photo. Tap 1:1, 4:5, Free, Reset — the frame must survive all of them,
   and Crop & Upload must send what was framed.
2. Create Post from the **wall**, from Journal, from anywhere.
3. Account sheet: sun icon on its own line, clear of the name.
4. Download a **certificate** and a **wallet ledger** — the share sheet should open.
5. Download a **journal PDF**. If it fails there is now a **second line** under
   the error. That line is the missing piece.
6. Pinch in the crop dialog.

## Standing

Play production is still **1073 / v1.2.2**. Nothing from 1.2.5 through 1.2.9
reaches a member until the owner promotes a build.
