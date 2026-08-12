# BUILD 1055 — Instagram-style image zoom. SPEC, not yet implemented.

Owner instruction, 2026-08-06. **Nothing here is built.** This is the brief,
written while the requirement was fresh, so the next session can execute it in
one pass instead of re-deriving it.

**The ask in one line:** the app itself must never pinch-zoom; a photograph
opened fullscreen must pinch-zoom, pan and double-tap-zoom like Instagram.

---

## 1. What the owner asked for, verbatim in substance

**Globally (Android WebView):** no pinch zoom, no double-tap zoom, no accidental
zoom while scrolling. **Do not** affect desktop. **Do not** affect normal mobile
web unless explicitly configured.

**In the lightbox only:** pinch-to-zoom, pan while zoomed, double-tap to zoom in
and out, smooth gestures, zoom resets on close. **Only the image scales** — the
surrounding UI stays fixed. No lag on high-resolution photographs.

**Quality bar:** must feel native. No page jumping, no layout shift, no
accidental browser zoom. *"Match the interaction quality of Instagram, Facebook
and Google Photos."*

**Deliverables he expects:** root cause of current behaviour · implementation
approach · every file modified · a test checklist · and confirmation of four
specific outcomes (see §6).

---

## 2. What is already KNOWN — verified, do not re-check

**`capacitor.config.ts`** (read 2026-08-06, verbatim relevant parts):

```ts
webDir: 'dist',
server: { androidScheme: 'https' },        // ← NO server.url
android: { adjustMarginsForEdgeToEdge: 'auto' },
```

Two consequences that matter here:

1. **There is NO WebView zoom configuration at all.** No `allowsLinkPreview`, no
   zoom flags. Whatever zoom behaviour exists today comes from the **viewport
   meta tag and CSS**, not from Capacitor.
2. **The app bundles `dist` — it does not load the live site.** So this work
   reaches phones only when a build is cut. That has bitten this project all
   day; do not let the owner test it on 1054 and conclude it failed.

---

## 3. What must be AUDITED first — measure, do not assume

| # | Question | Where |
|---|---|---|
| 1 | What does the viewport meta tag currently say? | `index.html` — look for `user-scalable`, `maximum-scale`, `viewport-fit` |
| 2 | Is there any global `touch-action` CSS? | `src/index.css`, Tailwind base layer |
| 3 | **Which component is the lightbox?** Identify it before writing anything | Search for the fullscreen photo viewer used by the feed and profile |
| 4 | Does anything already call `preventDefault` on `touchmove` / `gesturestart`? | `src/main.tsx`, any global listener |
| 5 | Is `ImageCropModal.tsx` a separate zoom surface? | It exists and handles images — check it is not affected |

**Do not start writing until #3 is answered.** The whole spec hinges on there
being one clearly identified lightbox to make the exception for.

---

## 4. Implementation approach — the robust route, not CSS hacks

The owner explicitly asked for *"the most robust approach rather than quick CSS
hacks."* That rules out the common shortcut of `user-scalable=no` alone: modern
Android WebView and iOS Safari **ignore it** in many cases, and it is an
accessibility regression.

**Recommended shape:**

1. **Global suppression via `touch-action`, not the viewport tag.**
   `touch-action: pan-x pan-y` on the app root disables pinch zoom while leaving
   scrolling intact. It is the standards-based mechanism and it does not fight
   the browser.
2. **Double-tap zoom** is suppressed by the same property on most engines; if
   not, a targeted `dblclick`/rapid-`touchend` guard on the app root.
3. **The lightbox opts back IN** with `touch-action: none` on the image element,
   and implements its own gesture handling so it controls the transform.
4. **Transform the IMAGE only** — `transform: scale() translate()` on the `<img>`,
   never on a parent that contains UI. This is what keeps the surrounding
   chrome fixed. Use `will-change: transform` for smoothness on large photos.
5. **Reset on close** — clear the transform when the lightbox unmounts, so
   reopening never starts zoomed.
6. **Desktop untouched** — gate the global suppression on a coarse-pointer /
   native-app check, not on width. `isNativeCapacitorApp()` already exists in
   `src/lib/native/authDeepLink.ts` and is the established way to ask "are we in
   the app".

**Gesture library vs hand-rolled:** hand-rolling two-finger pinch with momentum
that feels like Instagram is genuinely hard. Check whether a small, well-
maintained dependency is acceptable before committing to hand-rolled maths —
raise it with the owner, do not decide silently. Note the standing rule about
third-party names: this is a dependency choice, not member-facing text.

---

## 5. Logging — the standing directive still applies

Every function written here needs structured logging with a catalog code. The
catalog is at **69 codes**; add these in the UI range and regenerate
`docs/error-codes.md`:

- a code for **the lightbox failing to load a high-resolution image**
- a code for **gesture handling throwing** (it must never break scrolling)

`deviceContext()` (`src/lib/deviceContext.ts`) already returns Android version,
device model and **viewport** — the viewport field exists precisely so a
rotation or a zoom bug can be read back out of a log. Use it.

---

## 6. The four confirmations the owner will check

Do not report done until each is demonstrated, on a real device, on 1055:

1. ✅ The app page cannot be pinch-zoomed.
2. ✅ Images inside the lightbox CAN be pinch-zoomed.
3. ✅ Feed, comments and UI never zoom.
4. ✅ Behaviour matches Instagram/Facebook as closely as practical.

## 7. Test checklist to hand back

- Pinch on the feed → nothing scales
- Pinch on comments → nothing scales
- Double-tap on the feed → no zoom
- Two-finger scroll → scrolls, does not zoom
- Open a photo → pinch → **only the photo scales**, the close button stays put
- Pan while zoomed → moves within bounds, does not scroll the page behind
- Double-tap in the lightbox → zooms in, again → zooms out
- Close and reopen → starts at 1x, not zoomed
- A very large photograph → no visible lag
- **Desktop browser → completely unchanged**
- **Mobile web browser → unchanged unless explicitly configured**
- Rotate the device while zoomed → no layout break
- Regression: normal scrolling everywhere still works

---

## 8. Sequencing note

**1054 must be tested first.** It carries the deleted-user sign-out, the
read-once photo pipeline and all 69 codes, and none of it has been verified on a
handset yet. If 1055 is cut before 1054 is tested, two unverified builds stack
up and neither can be judged.
