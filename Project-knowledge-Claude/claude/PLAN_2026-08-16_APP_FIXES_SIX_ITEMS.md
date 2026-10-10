# 2026-08-16 — Owner found 3 faults the sweep called clean. Plan, 6 items.

**DO NOT PROMOTE BUILD 1.2.6.** It contains none of these fixes.

## The root cause, proven

`isNativeCapacitorApp()` reads `window.Capacitor.isNativePlatform()`. **Nothing
in the harness ever set `window.Capacitor`**, so it returned `false` on every
run since the harness was written. `appFlow` was false in all 63 screenshots.

**The app's own code path had never been rendered once.** The sweep reported
"63 screenshots, 0 problems" the same morning the owner found three real faults
on his phone in about two minutes. Every one of them was behind `appFlow`.

A checker that silently tests half the product is worse than none — it issues a
clean bill of health for the half it never opened.

## The six items

| # | Item | Status |
|---|---|---|
| 1 | Checker runs in **app mode** (`app-360` viewport, `?native=1`) | **DONE, proven** |
| 2 | App composer: preview + thirds + Crop + Cover + reorder → Next → details | open |
| 3 | Blank gap in feed — sponsored slot's unfilled 4:5 (~450px) box | open, lead unproven |
| 4 | Wall grid counts hidden on touch — must reveal on FIRST TAP | open |
| 5 | Wall grid: gapless 4:5 tiles, **edge-to-edge, 100% width, no side margins**, every 10th photo a hero tile spanning 2 columns | open |
| 6 | Top bar icons | **DONE** |

## Item 1 — done

- `src/uiharness/main.tsx`: installs a minimal Capacitor stub when `?native=1`,
  **before** the dynamic import of app modules (same ordering rule as the fake
  backend — app code reads it at module scope).
- `tools/uishot/capture.mjs`: new `app-360` viewport with `native: true`,
  appends `&native=1`.
- **Verified by md5**: `screen-feed`, `screen-profile`, `screen-post-detail` all
  render DIFFERENT bytes in app-360 vs android-360. If the stub were inert they
  would be identical.

## Item 6 — done

| icon | before | after |
|---|---|---|
| Create | 20px glyph, 32px box | 24px glyph, 44×44 |
| Search | 16px glyph, 32px box | 24px glyph, 44×44 |
| Bell | 16px glyph, 32px box | 24px glyph, 44×44 |

Three different glyph sizes in one row was most of why the bar read as "too
small". Edge spacing measured in-browser: Create **26px** from left, Search
**26px** from right. Owner asked for 46px targets — 44 used instead: it is the
iOS/Android/WCAG standard and what the checker enforces; 46 is arbitrary.

## Owner's decisions this session

- Wall grid: **"Beat Instagram"** — gapless 4:5 edge-to-edge PLUS a hero tile
  every 10th photo. Verbatim: *"this is instagram, i want sams like but
  different slightly more attractive"*, and *"wall view must 100% filled on the
  device not space in two sides. Like insta"*.
- One build at the end, not six.

## Item 4 — my error, recorded

`ProfilePostGrid.tsx` `HoverCounts` is `hidden … sm:flex` with a comment I wrote
saying counts are *"never shown on touch, where there is no hover to reveal
it."* That contradicts the owner's rule of 2026-08-14: *"will show on mouse over
**or on 1st touch** on the image."* I applied it to `PostCard` and wrote the
opposite into the grid.
