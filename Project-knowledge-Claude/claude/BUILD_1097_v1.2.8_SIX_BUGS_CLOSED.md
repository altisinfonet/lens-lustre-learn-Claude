# BUILD 1097 / v1.2.8 — SIX REPORTED BUGS CLOSED

Date: 2026-08-16
Run: Android Build **#97** — https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31954179563
Commit: `065abb6`, preceded by `1730afd` (versionName bump)
Status: **SUCCESS**, 7m 58s.

Artifacts: `app-debug-apk-SIDELOAD-THIS` (13.9 MB) · `app-release-aab` (8.48 MB)

Gates: typecheck 0 · **1,861 tests pass** · production build 0 ·
**112 screenshots, ZERO layout problems, zero non-fixture errors**

## The owner's six, in his order

**1. Log out screen not coming properly, huge space at top.** Measured, bottom
of Logout vs bottom of screen: 360×592 → **145px below**, 360×640 → 104px below,
360×740 → 19px below, 360×800+ → fine. On any phone under ~780px usable height
a member **could not log out**. Cause was structural — 85vh cap, three bands,
nothing scrollable — so the footer was what got pushed off. Grid scrolls now,
footer pinned. Top gap 56–64px → 14–16px.

His follow-up ("all buttons are not showing some hiding") was also right: the
first fix hid actions. Tiles tightened instead — nothing hidden at 640 and above
with no scrolling at all. Labels went **up** 9px → 10px, out of all-caps.
5 columns was tried and rejected: it fitted at 592 but broke "Dashboard" and
"Notifications" mid-word.

**2. Create Post many times not working.** His answer: "(A) nothing opens at
all." That is one `catch`. Android's picker rejects both when a member backs out
and when it cannot open; the code returned "nobody chose anything" for both, and
the composer closes on that. Only a message containing "cancel" counts as
cancelling now; anything else says so and falls back to the OS file browser
(which does not use the Camera plugin). Second silent path also closed: photos
handed over but unreadable now reports `picked` vs `files`.

**3 + 4. The crop dialog.** "Any of options not working" was **18 tap targets
under 44px** — close 16×16, every zoom/rotate/mirror button 20×20, chips 35×27.

And underneath it, the serious one:

**ZOOM SILENTLY CROPPED THE WRONG PART OF THE PHOTOGRAPH.**

| zoom | element box | picture | scale used | true |
|---|---|---|---|---|
| 100% | 270×480 | 270×480 | 3.33 | 3.33 |
| **200%** | **540×480** | **270×480** | **1.67** | **3.33** |

`max-h-[60vh] object-contain` + `width: zoom*100%` let the element box grow away
from the picture; every crop coordinate derives from that box. At high zoom the
read area leaves the image entirely and nothing is drawn — the blank "After"
panel. One cause, two reports. Verified correct at 100/200/400% on portrait,
landscape and square.

Also: body scroll lock, back gesture closes the dialog, pinch-to-zoom, thirds
guide, and corner handles split into a 14px viewfinder bracket over a 44px
invisible target.

**5 + 6. Wall About panel and the account page.** 370px of screen for an email
address and a join date. Thirteen outlined cards on one, nine boxes on the
other, a 36px grey disc behind every 16px glyph, a caption under each value, and
**the bio printed twice** on the same screen. One 44px row per fact now, no
outlines anywhere.

## The pattern under all six

Every fault was on a screen the sweep had never rendered. The crop dialog is
mounted from nine places and had no scene. The account sheet is an overlay. The
About tab opens from a menu into component state, so 100% of this project's
screenshots of that page were the photo grid.

New scenes: `crop-modal-tall` / `-wide` / `-avatar`, `screen-account-sheet`,
`screen-wall-about`. `?section=about|works` added, which also makes About
linkable.

## The checker was wrong three times — each found by using it

1. Called a modal's backdrop a navigation bar → reported 74 items "hidden". It
   compared rectangles and could not see z-order.
2. Read a button mid-animation as 35×35 when layout says 44 (0.9 scale, 1.6%
   opacity).
3. Never rendered the build label beside Logout — the Capacitor stub had no App
   plugin, so the footer row being photographed had Logout at full width instead
   of half.

All three fixed, each broken deliberately afterwards to prove the alarm fires.

## Owner must check on the phone

1. Account sheet on a short phone — every action visible, Logout at the bottom,
   build label to its left.
2. **Post a photo, crop and ZOOM IN before uploading.** The saved crop must be
   the part framed. This is the fix that matters most.
3. Pinch in the crop dialog; back gesture should close the dialog, not the page.
4. If Create Post fails, there should now be a **message** and the file browser
   should open. Send that message.
5. Wall About panel and Profile page: no boxes, no repeated bio.

## Not done, not claimed

- Does not stop Android failing to read a photo — stops it being silent.
- Still not Instagram's crop model (frame moves over photo, not photo under
  frame). That is a rewrite.
- `svgo` absent from both lockfiles; SVGs ship unoptimised. Pre-existing.
- Harness has no Works-tab fixtures — the reason 108 sweep reports are data noise.
- **NO REELS. NO LIVE.**

## Open owner decisions

- Whether the stories band should appear on both the wall and the account page.
- 4 content tabs vs 2.
