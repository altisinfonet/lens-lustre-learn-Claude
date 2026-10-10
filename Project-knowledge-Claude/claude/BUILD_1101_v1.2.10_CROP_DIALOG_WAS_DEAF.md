# BUILD 1101 / v1.2.10 — THE CROP DIALOG WAS DEAF

Date: 2026-08-16
Run: Android Build **#101** — https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31960551823
Commit: `2858dc7`, preceded by `5354da6` (versionName bump)
Status: **SUCCESS**, 7m 30s.

Artifacts: `app-debug-apk-SIDELOAD-THIS` (13.9 MB) · `app-release-aab` (8.48 MB)

Gates: typecheck 0 · **1,865 tests pass** · production build 0 · 0 layout problems
**AND verified on the LIVE SITE before the build was cut** — at the owner's
instruction, and the first time that has been done.

## The fault

Owner, on 1.2.9: *"after uploadling any image clicked crop after that any of
option any fuction not wokring even not in web too, no cross, no mirror, no
moving the selection nothing - its like Screen is freezed - web and app."*

The giveaway was **"no cross"**. The close button is a plain `<button onClick>`.
If that is dead, nothing about cropping is wrong — the dialog is receiving no
input at all.

`WallPosts` renders `ImageCropModal` as a **sibling** of the composer's Radix
`<Dialog>`, which is open when Crop is pressed. A Radix modal makes the rest of
the page inert by setting `pointer-events: none` on `<body>`. This overlay sits
outside the dialog's content, so it inherited that — painted perfectly, laid out
perfectly, completely deaf.

| | body pointer-events | controls |
|---|---|---|
| Crop dialog alone | `auto` | all reachable |
| **Behind the open composer** | **`none`** | **Cancel, Close, 4:5, Mirror — all dead** |

Fix: `pointer-events-auto` on the dialog root. One class. z-[100] already sat
above Radix's z-50, so paint order was never the problem.

## Live-site verification (www.50mmretina.com, signed in as the owner)

Photo picked → **Crop** pressed → composer dialog open behind it:

| Control | Result |
|---|---|
| 4:5 aspect chip | highlighted, frame reshaped to portrait, After preview updated |
| Zoom in | 100% → **125%** |
| Mirror | toggled on, highlighted |
| Drag the frame | frame moved, preview followed |
| **X (the dead one)** | **closed the dialog** |

Cleaned up afterwards — photos removed, composer closed, **nothing posted**.

## The lesson, which matters more than the fix

All three crop screenshot scenes mount `ImageCropModal` **alone**, and alone it
has always worked. Every measurement reported to the owner across three builds —
*"4:5 → 190×238, never null"*, *"pinch 100% → 350%"* — was **true about a screen
no member ever reaches**. The fault was in the **arrangement**, not the
component, and isolation was read as proof three times running.

`crop-modal-behind-dialog` now reproduces the arrangement. Removing the fix
kills all four tested controls; that mutation is the proof.

Two other harness blind spots were closed the same day:
- it could only render **one page**, so a two-page bug (Create Post from the
  wall) could not be tested — `journey-` scenes added.
- it never rendered the build label beside Logout, so the footer row being
  photographed was not the row members see.

## Still open, and NOT claimed

- **Create Post from pages other than the Feed.** The 1.2.9 "fix" was measured
  to change nothing and is recorded as such in the source comment. The owner's
  own instruction is the design answer: *"as top menu icon is fix it should be
  from single uploader while standing on any page"* — the button should open the
  composer where the member already is, deleting the navigation, the URL flag,
  the second reader and the race together.
- **Journal / Featured-artist PDF.** Cause unknown; instrumented so the next
  failure names itself. Certificates, Wallet and Admin transactions ARE fixed.
- Pinch on a real device — unreproducible in Chromium, hardened only.

## Standing

Play production is still **1073 / v1.2.2**. Nothing from 1.2.5 → 1.2.10 reaches
a member until the owner promotes a build.
