# BUILD 1104 / v1.2.13 — CROP & UPLOAD WAS CLOSING THE COMPOSER

Date: 2026-08-17 · Commit `7fd6f82` · Android Build run **#104** → versionCode **1104** · green in 6m 45s

Three things, all owner-directed, all verified before the build was cut.

---

## 1. THE BUG — traced, not guessed

Owner: *"If anyone click crop and upload, option for Tag and select category
screen is not opening, directly lightbox disappearing."* Web and app.

### How it was found

`tools/uishot/repro-crop-upload.mjs` drives the real composer on a real page
with a real router: open composer → add a photo → press Crop → press
**Crop & Upload** → then ask one question, *is the composer still there?*

The cause came back as a stack trace out of the browser:

```
closeComposer
  <- onOpenChange   (the composer Dialog)
  <- onDismiss
  <- DismissableLayer usePointerDownOutside
```

### Why it happened

The crop dialog is rendered **outside** the composer's Radix `Dialog` on
purpose — that is the 1.2.10 fix for the frozen crop screen, because Radix puts
`pointer-events: none` on `<body>` and anything inside the dialog's inert region
cannot be touched.

The cost of that fix went unnoticed for two releases: **every press inside the
crop dialog is a press outside the composer**, so Radix read "Crop & Upload"
as the member clicking away and dismissed the composer. The photo cropped
correctly and then had nowhere to go — the tag and category step never opened
because the composer was already gone.

### The fix, and the proof

`onInteractOutside`, `onPointerDownOutside` and `onEscapeKeyDown` on the
composer's `DialogContent` all refuse while `cropIndex !== null`. Guarded on
"is a crop dialog open", not on the event target: while any dialog sits on top,
nothing outside should close the one underneath.

**Mutation-tested both ways:**

```
guards removed  → FAIL — the composer disappeared.
guards restored → PASS — composer survived and the tag/category step opened.
```

The final run walks all the way through: Crop & Upload → composer intact →
Next → `Post settings · Categories 0/5 · Select 1 to 5 · Street, Portrait…`

**Proven on the website path only.** The app's flow starts in Android's own
photo picker, which does not exist in the harness, so it cannot be driven here.
The fix is on the *same* `<DialogContent>` both surfaces use — it is one code
path, not two — but the phone still needs a human press.

---

## 2. A HARNESS FAULT THAT HID IT

**Production has no StrictMode. The harness did.**

StrictMode double-invokes effects: run → clean up → run again. Harmless for
most components; not for one whose effect touches browser history. The crop
dialog pushes a history entry so the Android back gesture has something of its
own to consume; the StrictMode cleanup called `history.back()`, and the
re-registered `popstate` listener caught that back as if the member had pressed
it. The dialog closed itself the instant it opened — **in the harness only**.

That fake fault sat exactly on top of the real one. `?strict=0` now renders the
tree exactly as production does. Without it the owner's bug was unreachable.

---

## 3. THE TWO CORRECTIONS

**Inline-edit tap targets.** PostCard's Cancel and Save were 63×31 and 59×29,
under the 44px thumb floor. Both are `min-h-11` now. The harness scene keeps
PostCard's *real* classes — substituting a passing one would make the scene
agree with itself instead of with the product. The sweep now reports **0 layout
problems**, down from 3.

**@mentions in the app's caption box.** That box had no ref, so
`useCaptionMentions` was reading a textarea that was not on screen — the
mention list has never once appeared on a phone. Both boxes now share **one**
ref and **one** mention list.

One instance on purpose: two would have split the picked-name list, and only
the instance a name was picked from can convert `@Name` into `@[Name](id)` at
submit time. The dropdown would have looked fixed while the tag posted as plain
text. The two boxes are mutually exclusive by step — web box in `compose`, app
box in `settings`, and the website's settings step has no caption box at all —
which is what makes one ref correct rather than a shortcut.

---

## VERIFICATION

```
typecheck                0
tests                    1,897 passed, 1 skipped (7 new pins)
production build         0 errors
screenshots              140, 0 layout problems, 0 non-fixture errors
reproduction             PASS, and FAIL when the fix is removed
```

---

## STILL OPEN

- @mentions and the crop flow **on a real handset** — fixed in shared code,
  unproven on the phone.
- Journal / featured-artist PDF download — instrumented, cause not found.
- Pinch-to-zoom on a real handset — hardened, unproven.
- `svgo` is not a declared dependency, so SVGs ship unoptimised. Untouched:
  no background dependency changes.
- NO REELS. NO LIVE.
