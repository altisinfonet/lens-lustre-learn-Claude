# BUILD 1055 — Instagram-style image zoom. PUSHED TO main. 2026-08-06.

Written against `main` at `6b6bfc4`; **`main` is now `d751e26`.** All 15 files
are on `main`, byte-verified, and CI at HEAD is green. **The Android build 1055
has NOT been cut.** The audit that preceded this is in
`claude/AUDIT_1055_ZOOM_SURFACES.md`.

> ⚠️ **This work is invisible on the handset until 1055 is built and
> installed.** `webDir: 'dist'`, no `server.url`.

---

## 0. PUSH RECORD — 12 commits, 15 files, all byte-exact

`6b6bfc4` (1054) → **`d751e26`**

| # | Commit | Files |
|---|---|---|
| 1 | `b04f95f` the one zoomable photograph | `media/ZoomableImage.tsx` |
| 2 | `ea0256a` pin the six viewers, the lock and the feed tap | `media/__tests__/zoomSurfaces.test.ts` |
| 3 | `553fc9e` a feed photograph opens fullscreen | `post/PostMedia.tsx` |
| 4 | `d6b052c` featured photos zoom | `profile/FeaturedPhotos.tsx` |
| 5 | `47a1021` post, portfolio and voting viewers | `FacebookPhotoGrid.tsx`, `Lightbox.tsx`, `VotingLightbox.tsx` |
| 6 | `429c92d` competition viewer, outside judging only | `CompetitionLightbox.tsx` |
| 7 | `e47da04` lock pinch-zoom in the app only | `lib/native/zoomPolicy.ts` |
| 8 | `805467f` the lock applies in the app, never on web | `lib/native/__tests__/zoomPolicy.test.ts` |
| 9 | `485a36f` catalog 69 → 72 | `lib/errorCodes.ts` |
| 10 | `507b7c6` regenerate the catalog | `docs/error-codes.md` |
| 11 | `46fbf75` apply the lock at boot; marker `2026-08-06-9` | `index.css`, `main.tsx` |
| 12 | `d751e26` add the gesture dependency | `package.json` |

`git show origin/main:<path> | diff - <path>` → **15 identical, 0 mismatched.**
`package-lock.json` confirmed byte-identical to 1054 — see §5.

### 🔧 PROCESS LESSON, worth not repeating

**`package.json` was pushed LAST, and that made 11 of the 12 intermediate
commits fail CI.** Every tree between commit 1 and commit 11 contained a file
importing `@use-gesture/react` while `package.json` had not yet declared it.
Typecheck #486–#496 are red on `main` for that reason alone. Only **#497 at HEAD
matters and it passed** — but the history now reads as a run of failures.

**Next time the dependency commit goes FIRST**, before any file that imports it.
Three-files-per-commit forces a sequence; the sequence has to start with what
everything else needs.

## 1. What was built

| File | Status | What |
|---|---|---|
| `src/components/media/ZoomableImage.tsx` | **NEW** | The one zoomable photograph. `@use-gesture/react` for recognition, framer-motion motion values for the transform, applied to the `<img>` and nothing else. |
| `src/lib/native/zoomPolicy.ts` | **NEW** | Adds `app-zoom-locked` to `<html>` only inside the installed app. Idempotent, never throws. |
| `src/index.css` | modified | `html.app-zoom-locked { touch-action: pan-x pan-y }` — the only new rule. |
| `src/main.tsx` | modified | Calls `installZoomPolicy()` before React mounts. `__APP_BUILD` bumped `2026-08-06-8` → **`2026-08-06-9`**. |
| `src/lib/errorCodes.ts` · `docs/error-codes.md` | modified | **69 → 72 codes.** UI-8007, UI-8008, UI-8009. Doc regenerated with the script, never hand-edited. |
| `src/components/post/PostMedia.tsx` | modified | `useDoubleTap` → `useTapOrDoubleTap`; feed tap wired for single photos **and** albums; viewer swapped to `ZoomableImage`. |
| `FacebookPhotoGrid.tsx` · `Lightbox.tsx` · `VotingLightbox.tsx` · `CompetitionLightbox.tsx` · `profile/FeaturedPhotos.tsx` | modified | Each swaps its bare `<img>` for `ZoomableImage`, keeping its own chrome. |
| `src/components/media/__tests__/zoomSurfaces.test.ts` | **NEW** | 19 source-level pins. |
| `src/lib/native/__tests__/zoomPolicy.test.ts` | **NEW** | 4 behaviour pins. |

## 2. The three decisions that shaped it

**Gestures — `@use-gesture/react@10.3.1` + framer-motion.** Measured bundle
cost of the WHOLE feature (dependency + all new code), built both ways:

| | Baseline `6b6bfc4` | With 1055 | Delta |
|---|---|---|---|
| dist JS, raw | 6,102,684 B | 6,145,600 B | **+42,916 B (+41.9 kB)** |
| dist JS, gzip -9 | 1,629,644 B | 1,644,121 B | **+14,477 B (+14.1 kB)** |

The "~10kB" quoted while presenting the option was never measured and was
retracted before the owner chose. **14.1 kB gzipped is the real figure.**

**Scope — one shared component, every member-facing surface.** One shared *zoom*
component, six *existing* viewers. Each viewer keeps its own chrome, counter,
watermark and vote controls and swaps only its `<img>`. Replacing six working
viewers with one would have been a rewrite of competition voting inside a build
about pinch gestures.

**Feed tap — wired, with a 300 ms cost that is deliberate.** A single tap and
the first half of a double tap are the same event. The open is scheduled and
cancelled if a second tap lands inside 300 ms. Acting on the first tap
immediately would open the viewer underneath every like a member gives. A swipe
through an album suppresses the tap for 400 ms.

## 3. ⚠️ Zoom is OFF during the judging phase — decided here, overrulable

`PhaseWatermark` is a **single centred label** (`absolute inset-0`, one line of
text, `pointer-events-none`, z-5) and a **sibling** of the photograph — it does
not move with it. Magnify an entry 4× and pan it and that one label covers a
quarter of what it used to.

So in `CompetitionLightbox`, when `competitionPhase === "judging"` the
photograph renders exactly as it did before 1055: plain `<img>`, no pinch, no
pan. Outside judging, zoom is on. Judges and admins are not special-cased even
though they bypass the watermark — they have the cinema viewer, which has had
its own zoom for far longer. `VotingLightbox` has no watermark and no phase, so
zoom there is unconditional.

**If zoom during judging is wanted, the honest fix is a watermark that tiles and
transforms with the photograph.** Competition integrity, owner's call.

## 4. `ImageCropModal` — verified untouched, not modified

Measured in the shipped stylesheet, `node_modules/react-image-crop/dist/ReactCrop.css`:

```css
.ReactCrop:not(.ReactCrop--disabled) .ReactCrop__child-wrapper>img { touch-action: none }
.ReactCrop:not(.ReactCrop--disabled) .ReactCrop__crop-selection   { touch-action: none }
```

`none` is narrower than `pan-x pan-y`, and the browser intersects from the
touched element upward, so the global lock cannot widen or disturb it. **The
crop drag is unaffected. No change was made to the file.**

## 5. 🔴 OPEN FINDING: `npm ci` is broken on `main`, and was before 1055

Reproduced against `origin/main` at `6b6bfc4` with nothing of 1055 present, and
again on a fresh clone of `d751e26`:

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
npm error Missing: react-mentions@4.4.10 from lock file
npm error Missing: @types/react-mentions@4.4.1 from lock file
npm error Missing: @testing-library/dom@10.4.1 from lock file          (+10 more)
```

Both workflows run `npm ci || npm install`, so every run silently falls through
to `npm install`. Running `npm install` locally repaired the lock as a side
effect — 369 lines, 15 packages, only 2 of them this build's. **That was
reverted and never pushed.** 1055 shipped `package.json` alone.

**Repairing the lock is worth doing and needs its own GO.** Not a 1055 concern.

## 6. Verification

Measured on a **fresh clone of `d751e26`**, not on the working tree:

- `npm ci` fails (pre-existing, §5) → `npm install` adds 943 packages cleanly.
- `npx vite build` — **✓ built in 34.8 s**.
- Built entry carries `__APP_BUILD="2026-08-06-9"`.
- Built CSS carries the `app-zoom-locked` rule; built JS carries the class.
  **Verified in the emitted assets, not in source.**
- Full suite on the pushed tree: **883 passing / 25 failing / 1 skipped**,
  identical to the sandbox run. Baseline was 860/25/1 → **+23 passing, zero new
  failures.** The 25 are the known ProfilePhotoPrompt ×4 + competition/judging ×21.
- GitHub **Typecheck #497 at HEAD — completed successfully.**
- `tsc --noEmit` clean; `eslint` — 13 problems, all confirmed present on `main`
  at identical positions.
- New tests against `main`: **18 of 19 fail** with named assertions. The 19th is
  labelled in the file as a FORWARD GUARD, green on main by design.

## 7. ⏳ The web deploy had NOT landed as of ~13 minutes after the last commit

Measured at origin from the owner's browser with `cache: 'no-store'`, not from a
cached page:

```
entry js  /assets/index-ZyaPcMG_.js   __APP_BUILD = 2026-08-06-8
entry css /assets/index-C9FeX2qt.css  app-zoom-locked → absent
```

Asset hashes unchanged from before the push, so this is not browser caching and
not a partial deploy — **no Cloudflare Pages build had published yet.** Checked
at +8 min and +13 min.

STATE §5 warns that deploys queue, and 12 commits landed in quick succession, so
this is consistent with a queue rather than a failure. **It was not confirmed
either way** — the Pages dashboard needs the owner's account.

**This does NOT block build 1055.** `android-build.yml` checks the repository
out and builds `dist` itself; it never reads the Cloudflare deployment. The
fresh-clone build above is the proof that the tree it will build is sound.

To confirm the web side later: reload `www.50mmretina.com` and read
`window.__APP_BUILD` — it must read **`2026-08-06-9`**.

## 8. Still to do

1. **Confirm the web deploy landed** — marker `2026-08-06-9`. If it has not
   after a reasonable wait, check Cloudflare Pages for a failed build.
2. **Cut build 1055** — owner's GO. Edit ONLY `ANDROID_BUILD_TRIGGER`, newest
   entry at the top, covering everything since 1054. Run #55 → versionCode 1055.
   Play "What's new" stays exactly `Bug fixes and improvements.`
3. **Run the 13-item device checklist in SPEC §7** and the four confirmations in
   SPEC §6. None of them can be judged on 1054.
4. **Open, unrelated:** repair `package-lock.json` (§5).
