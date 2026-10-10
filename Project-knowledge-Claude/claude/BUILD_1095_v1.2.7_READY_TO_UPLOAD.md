# BUILD 1095 / v1.2.7 — READY TO UPLOAD

Date: 2026-08-16
Run: Android Build **#95** — https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31946351268
Commit: `bd9c231` (`ANDROID_BUILD_TRIGGER`), preceded by `2667a7b` (versionName bump)
Status: **SUCCESS**, 6m 14s. Security gate green, build-aab green.

## Verified from the build log, not assumed

```
versionCode=1095 versionName=1.2.7 (live production is 1073 / 1.2.2)
        versionCode 1095
        versionName "1.2.7"
```

## Artifacts

| Name | Size | Use |
|---|---|---|
| `app-debug-apk-SIDELOAD-THIS` | 13.9 MB | sideload on the owner's phone to check BEFORE promoting |
| `app-release-aab` | 8.48 MB | the file the owner uploads to Play. **Owner only.** |

Both are on the run page under **Artifacts**.

## Why 1.2.7 and not 1.2.6

Build **#93** already carried versionName 1.2.6. This is different code. Two
artefacts sharing one version string is how the Play Console, the crash reports
and the About screen stop agreeing with each other. Version was bumped first
(`2667a7b`) so the trigger commit would carry the right name.

## What is in it

Root cause of everything the owner found on his phone: **the screenshot checker
had never once rendered the app.** `isNativeCapacitorApp()` reads
`window.Capacitor`; nothing in the harness ever set it, so all 63 prior
screenshots were the WEBSITE. Fixed permanently — `app-360` viewport with a
Capacitor stub, plus scenes for the wall and for the visitor-view of a wall.

Owner-reported, all fixed:

1. **App composer** — picking a photo went straight to a 160×160 thumbnail. No
   crop, no cover, no reorder. Now renders the SAME `PostComposerPreview` the
   website does. Not a copy — one funnel.
2. **Blank gap in the feed** — an empty advert slot drew an ADMIN placeholder
   (only admins saw it) that inherited the story-card frame, reserving ~450px
   for two words of grey text. Now a compact strip.
3. **The wall** — rebuilt against his real Instagram screenshot, measured off
   the image: name over counts, kebab top-right, white bio, thin "+" story
   rings, icon-only tabs with a white underline, 4:5 tiles that touch, and ONE
   18px left edge where there had been four.
4. **Top bar** — icons were 20/16/16px. All 24px now, in 44×44 targets.
5. **Grid counts** — likes/comments on wall tiles were hover-only, so on a phone
   they did not exist. First tap reveals, second opens.

Three he never saw, all shipping, found only because the app was finally
photographed:

- **An infinite render loop on every profile** — "Maximum update depth
  exceeded", 4× per page load, burning battery the whole time the page was
  open. `extData?.entries || []` built a new array every render and was an
  effect dependency that called setState. Verified 4 before → 0 after.
- a long name rendering UNDERNEATH the ⋮ menu.
- "mutual friends" printing with NO NUMBER in front of it.

## Gates, run against ORIGIN (branch reset to GitHub, re-run from there)

- typecheck: 0
- tests: **1,841 pass**
- production build: exit 0
- screenshots: **92, zero real problems** — web, 360, 390, desktop AND app mode

## What only the phone can answer

1. Post a photo. After picking you must now get the full composer — photo at
   publishing size, thirds guide, Crop, Cover badge, reorder. **This is the
   change.** No test here can drive a native gallery.
2. Your wall: one straight left edge down the whole screen, photos touching.
3. Tap a wall photo once → counts appear. Tap again → it opens.
4. Someone else's profile: Follow and Message should look like buttons.
5. Scroll the feed: no blank hole between posts.

## Not done, not claimed

- His reference has four content tabs; ours has two. **NO REELS, ever.**
- `svgo` absent from both lockfiles, SVGs ship unoptimised. Pre-existing,
  deliberately not touched beside a build.
- Harness has no fixtures for the Works tab — test scaffolding, not an app fault.

## Open owner decisions

- 4 content tabs vs 2 (no reels either way).
- Whether to hide the Story/Highlight band when it is empty.
