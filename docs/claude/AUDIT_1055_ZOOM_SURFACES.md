# AUDIT — build 1055 image zoom. SPEC §3 answered. 2026-08-06.

Measured against `main` at **`6b6bfc4`** ("build: cut 1054"). **No code written,
nothing pushed, no build cut.** This is the audit SPEC_1055_IMAGE_ZOOM.md §3
requires before any implementation starts.

---

## The headline: SPEC §3 #3 assumed ONE lightbox. There are SIX.

And the feed's is dead code. This is the single fact that changes the shape of
the work.

| # | Surface | Reached from | State |
|---|---|---|---|
| 1 | `src/components/post/PostMedia.tsx` → `CarouselLightbox` (L400–460) | Feed, Wall (via `PostCard`) | ⚠️ **UNREACHABLE.** `setLightboxOpen` declared L330, called **only** with `false` at L395. `setLightboxOpen(true)` exists nowhere in the file. |
| 1b | `src/components/post/PostMedia.tsx` → `SingleImagePost` | Feed, single-photo posts | ⚠️ **No lightbox at all.** The image div's only `onClick` is `handleDoubleTap` (double-tap-to-like). |
| 2 | `src/components/FacebookPhotoGrid.tsx` (L100–140) | `PostDetail`, `HashtagFeed`, `EntryDetail` | ✅ Works — `openLightbox(index)` on tap. Near-identical copy of #1. |
| 3 | `src/components/Lightbox.tsx` | `MyPhotos` only | ✅ Works |
| 4 | `src/components/CompetitionLightbox.tsx` · `src/components/VotingLightbox.tsx` | `FeedLeftSidebar`, `CompetitionDetail` | ✅ Works. Carry `PhaseWatermark surface="lightbox"` + anti-download `onContextMenu` guards — **must be preserved**. |
| 5 | `src/components/profile/FeaturedPhotos.tsx` (L131–145) | Profile sidebar | ✅ Works — inline `fixed inset-0` overlay |
| 6 | `src/components/judge/CinemaFullView.tsx` | Judge only | ✅ **Already has its own zoom/pan** — `onWheel` L856 (0.5×–3×), `panOffset` clamped to `500 * (zoom-1)`, `animate={{ scale }}` L890. No touch/pinch path. |

**None of 1–5 has any zoom implementation.** No transform state, no pinch
handler, no pan, no double-tap-zoom. Each renders a plain `<img>` /
`motion.img` with `object-contain` and a fixed `max-w`/`max-h`.

`src/components/profile/PhotoAlbums.tsx` is **not** a lightbox — it is a
`Dialog`-based album grid that drills into `AlbumView`, never fullscreen.

---

## The other four audit questions

**1. Viewport meta — `index.html:5`, the whole tag:**

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

No `user-scalable`, no `maximum-scale`, no `minimum-scale`, no `viewport-fit`.
Only one `index.html` in the repo. The page is fully scalable by default.

**2. Global `touch-action` CSS — NONE.** `grep` for `touch-action` /
`touchAction` across every `.css`, `.ts`, `.tsx`, `.html`: **zero hits**.
`src/index.css` has no `html`/`#root` touch rule; the only related global is
`-webkit-text-size-adjust: 100%` on `body` (L210).

Five Tailwind touch utilities exist, all on individual controls, none global:
`post/PostCard.tsx:428`, `:433` and `ReactionPicker.tsx:175`
(`touch-manipulation`); `ui/scroll-area.tsx:26` and `ui/slider.tsx:12`
(`touch-none`). **A plain `touch-action` grep misses these — search the
Tailwind utility names too.**

**4. Existing `preventDefault` on `touchmove` / `gesturestart` — NONE.**
87 `preventDefault` calls in non-test source; **zero** on `touchmove`,
`touchstart`, `gesturestart`, `gesturechange`, `gestureend`. All are
`onContextMenu`, `onKeyDown`, `onDragOver`, `onPointerDown`, form `onSubmit`,
plus one `onWheel` (`CinemaFullView.tsx:856`).

Three components listen to touch and none prevents default:
`PullToRefresh.tsx:22–45` (reads `clientY` only), `ReactionPicker.tsx:65–79`
(long-press timer), `NotificationBell.tsx:169` (`{ passive: true }`).

`src/main.tsx` has exactly one global listener: `window.addEventListener("load", …)`
at L104. Nothing touch-related.

**5. `ImageCropModal` — YES, a separate zoom surface, and NOT admin-only.**
10 call sites, two member-facing: `WallPosts.tsx:1028` (post composer) and
`EditProfile.tsx:698` (profile photo). Also `JournalEditor`, `CourseEditor`,
`CompetitionsModule`, `AdminOnPageImages`, `AdminFeaturedArtist`,
`EmailRichTextToolbar`, `CropTest`.

Its zoom is **not a transform** — it is
`style={{ width: `${zoom * 100}%`, maxWidth: "none" }}` on the `<img>` at L418,
driven by +/− buttons (L334/L346), inside `<ReactCrop>` from
`react-image-crop@^11.0.10`, which does its own pointer-based drag for the crop
rectangle. **A global `touch-action` on the app root would be inherited by it.**
Whether that breaks the crop drag must be measured on a device, not assumed.

---

## Root cause of the current zoom behaviour

Two separate causes, both established from code.

**A — why the app pinch-zooms.** Nothing in this codebase suppresses it. The
viewport meta is fully scalable, there is no `touch-action` anywhere, no
`preventDefault` on any touch or gesture event, and (SPEC §2, verified
2026-08-06) `capacitor.config.ts` carries no zoom configuration. The pinch
behaviour is the **Android WebView default under a scalable viewport** — and
because it is *browser page zoom*, it scales the whole document: feed,
comments, chrome and lightbox alike. Same mechanism as "page jumping" and "the
close button moves".

**B — why a photo does not zoom the way the owner wants.** Not one of the five
member-facing lightboxes has any zoom implementation. The only zoom that exists
is browser page zoom, which by definition takes the surrounding UI with it.
`CinemaFullView` is the sole exception and it is judge-only and wheel-driven.

**NOT established:** the WebView's actual default was not measured on a
handset — the sandbox cannot reach it. The code facts above are certain; the
on-device default is inferred from them and from there being nothing that could
override it.

---

## Owner decisions taken 2026-08-06 (all three were his, none assumed)

1. **Gestures:** `@use-gesture/react` for recognition + the already-installed
   `framer-motion` for the transform. Not `react-zoom-pan-pinch`, not
   hand-rolled.
   - Registry facts, measured: latest is **10.3.1**, single dependency
     `@use-gesture/core@10.3.1`, **last published 2024-03-21**. Mature and
     stable rather than actively developed — recorded so nobody later claims it
     was presented as freshly maintained.
   - ⚠️ A bundle-size figure of "~10kB" was quoted while presenting the option
     and was **never measured**. It must be measured before the dependency is
     committed. Recorded because quoting an unverified number breaks the
     project's own rule.
2. **Scope:** ONE shared zoomable lightbox, routed through **all member-facing
   surfaces** (1, 1b, 2, 3, 4, 5). Judge `CinemaFullView` is out of scope and
   must not be touched.
3. **Feed tap:** wire it. Tapping a feed photo — single-image *and* album —
   opens the lightbox. New member-facing behaviour, must coexist with
   double-tap-to-like without a tap ever firing an accidental like.

---

## Catalog state

`grep -c '^  {$' src/lib/errorCodes.ts` → **69 codes** (matches
`STATE_2026-08-06.md`). UI band is 8000–8999, currently UI-8001…UI-8006.
**Next free: UI-8007 and UI-8008** — the two SPEC §5 asks for (high-res
lightbox image failed to load; gesture handling threw).

> `LOGGING_STANDARD.md` still states the catalog holds 27 codes. That figure is
> stale — it is 69. Corrected here rather than by editing that doc mid-task.

---

## Status

**Audit complete. Implementation NOT started — awaiting the owner's explicit
GO.** 1054 is still unverified on his handset; per SPEC §8, 1055 is not to be
cut until he confirms 1054.
