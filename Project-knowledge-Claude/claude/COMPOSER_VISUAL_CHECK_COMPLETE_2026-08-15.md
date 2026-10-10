# Composer — through the visual checker, shipped 2026-08-15

**Status: complete, verified, on origin/main. Build still ON HOLD.**

Origin commits: `05a5ad2` · `88ee0be` · `3a6a787` · `ca5097c` · `6d69861`
All five files verified byte-identical (`git hash-object` == `git rev-parse origin/main:<path>`).
Local `main` reset to `origin/main`; trees identical; working tree clean.

## What looking at the screenshots found

**Sweep 1 — 42 screenshots, 7 problems.**

1. **Real bug — the remove ✕ could delete the WRONG photo.** It sat at
   `-right-1 -top-1`; the visible circle is 20px but the tap target is 44px, so
   half of it hung over the NEXT thumbnail. Tapping one photo's left edge would
   have removed the photo before it — unrecoverable in a composer. Moved inside
   the tile. *No unit test could find this: it is a coordinate, not a value.*
2. **Real bug — a preview url that fails rendered an empty rectangle.**
3. **False alarm in the checker** — 26 controls inside the `overflow-x-auto`
   strip reported "off-screen". They are reached by swiping. `capture.mjs` now
   walks ancestors to ask whether anything can scroll them into view.

**Sweep 2 — 3 problems, all in `composer-broken-src`,** and looking at that
screenshot showed fix (2) was itself half wrong: the message sat on a
translucent panel over the still-present `<img>`, so **Chromium drew its own
torn-page glyph on top**. On a photography app that reads as "your photograph
is corrupt" when the truth is "the browser released the temporary url".

- The broken `<img>` is **removed**, not covered (two branches of one ternary).
- Keyed on **which url failed**, not a boolean — a boolean survives the member
  tapping a different, good photo, so one bad file would look like a bad album.
- **Crop hidden** (the crop editor reads the same url) and the thirds guide
  hidden (nothing to compose).
- The **thumbnail** got the same treatment.

`composer-broken-src` is now self-checking: it reports zero problems **only
while the fallback works**.

**Sweep 3 — 42 screenshots, 0 problems.**

## Alarms

24 tests in `postComposerPreview.test.ts`. Five new ones, all mutation-tested:
M1 put the `<img>` back · M2 `failedSrc === active` → `failedSrc !== null` ·
M3 draw the guide over the error · M4 drop the Crop guard · M5 remove the
thumbnail's `onError`. **All five caught.**

**A mistake inside the alarms, caught before commit:** my first M1 test sliced
from `previewFailed ? (` to `SRC.indexOf(") : (")` — the *thumbnail's* ternary
appears earlier in the file, so the slice was the empty string and the
assertion examined nothing. Same failure mode as the vacuous typecheck, one day
later, in the test written to prevent it. Now searches from the ternary's own
index and asserts the slice is non-empty.

## Gates, real exit codes

`npm run typecheck` 0 · `npx vitest run` 0 (**1,767 passing, 1 skipped**) ·
`npm run build` 0 · `npm run ui:shot` 0 (**42 screenshots, 0 problems**).

None of the five files matches the Android workflow's `paths` filter
(`.github/workflows/android-build.yml`, `ANDROID_BUILD_TRIGGER`), so **no build
was triggered**.

## Not done, and not claimed

The six harness scenes are the composer only. The real screens — wall, feed,
login, post detail, settings — are **not in the checker yet**. That gap must
close before any build is considered, along with the plain-language test
worksheet for the owner.
