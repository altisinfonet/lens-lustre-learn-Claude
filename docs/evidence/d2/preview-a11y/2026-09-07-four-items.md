# The four items from the deployed preview — D2, 2026-09-07

**Branch:** `d2/preview-a11y-four-20260907` off **`23f0332`** (`d2/preview-a11y-five-20260907`), which is `main` + the two promotion commits + the five-item accessibility fix.
**Reported by:** the Auditor, from live DOM/accessibility-tree checks on `https://0e30d46e.lens-lustre-learn-claude.pages.dev`, tip **`6bc9d2f`**.
**Classification:** VERIFIED (real Chromium, the repository's own UI harness, real screens with the deterministic fake backend). Not device-attested; the Auditor re-verifies against the deployed preview.

---

## 0. The base, and why it is not bare `main`

| ref | sha | contains |
|---|---|---|
| `origin/main` | `4ddff61` | — |
| `d2/main-promotion-preview-20260906` | `6bc9d2f` | main + `c96e9c6` (readable profile URLs, client half) + `6bc9d2f` (eight stale test files) |
| `d2/preview-a11y-five-20260907` | `23f0332` | the above **+ the five-item accessibility fix** |
| this work | 1 commit on `23f0332` | the above + the four items below |

`23f0332`'s tree is byte-identical to the commit this lane produced (`02b8065`): `git diff 02b8065 23f0332` is empty. **That is item 4's whole answer** — see §4.

The patch is emitted as the series `origin/main..HEAD`, so it applies to **a fresh branch off `main`** and produces a tree containing the promotion, the five-item fix and these four. Nothing is rebased and nothing is retyped.

---

## 1. `/discover` — controls that act on a person now say which person

**Live (Auditor):** 11 "Add Friend" + 11 "Remove" announcing identically; one button on the page with no accessible name at all.
**Harness (`screen-discover`, 1440×900, before):** 6 cards, 12 buttons, every one announcing `"Add Friend"` or `"Remove"`; **1** nameless button.

`src/components/discover/DiscoverCard.tsx` — all seven buttons (Add Friend, Request Sent, Accept, Unfriend, ×3 Remove) gain `aria-label={named(action)}`, built from the same `profile.full_name || "Photographer"` fallback the card's own name block renders, so the button can never announce a different name from the one printed above it. The visible label does not change: sighted members read the name from the card, and the owner has signed off that layout.

**The nameless button, identified by measurement rather than by guess:** `src/components/MobileBottomNav.tsx:153` — the profile-sheet button. It is the only `<button>` in that nav, and its three possible children are an `<img alt="">`, two initials, or a bare icon. None is a name. The cause is dated: the owner had the captions taken off this bar on 2026-08-10 ("Instagram's bar has no words under the icons"), and that instruction was about pixels — the captions were the only thing naming these controls, so removing them from the screen also removed them from the accessibility tree. `tab.label` / `tab.labelKey` were never deleted; they are announced now and painted nowhere.

**Also fixed, and stated rather than slipped in:** the six icon-only *links* beside that button, same file, same cause, three lines away. They were not in the order. Leaving them is the exception list this codebase already warns about — `.tap-44`'s own comment: "Enlarging controls one at a time is an exception list by another name, and an exception list is what missed the sidebar and then missed Notifications."

**After:** every card button announces `"Add Friend — Ranjana Bhattacharya Chowdhury"` etc.; **0** nameless buttons on the page.

---

## 2. People You May Know — the Add button

**Live (Auditor):** 5 buttons, text "Add", `aria-label` null, 57×27.
**Harness (`screen-feed`, 1440×900, before):** 3 buttons, name `"Add"`, painted **55.4×27.4**, hit region **55.4×27.4** — no region at all.

`src/components/FeedRightSidebar.tsx` — the button gains `aria-label={`${t("fr.addFriend")} — ${s.full_name || "Photographer"}`}` (the same translated string the Discover card uses for the same action, so the two surfaces cannot drift) and the `tap-44` class. The visible "Add" is unchanged: the column is 8px type and the owner sized it.

### F-109 — the direction was measured, not assumed

F-109's ruling is that a symmetric region is the wrong *default* next to text, and that clearance is "a claim to be measured, not assumed". Measured, in this row:

| probe | before | after |
|---|---|---|
| `elementFromPoint` 6px **above** the painted button | `<DIV>` — the row itself, not a link | `<BUTTON>` — the button |
| `elementFromPoint` 6px **below** | `<DIV>` — the row itself, not a link | `<BUTTON>` — the button |
| rect intersection of the enlarged region with each of the **7 links** in the widget | n/a (no region) | **0 overlaps** |
| two adjacent enlarged regions overlapping each other | n/a | **0** |

The name link in this row sits to the **left**, not above: it is a three-column row, not a caption over a control. The row is ~60px tall around a 27px button, so a 44px region centred on it lands 8px inside the row's own padding. That is precisely the case `.tap-44`'s comment reserves for itself — "where there is clearance on every side". `.tap-44-down` would push 17px past the bottom edge into the divider and is the worse choice here; a test asserts the symmetric one is kept, so swapping them is a deliberate act with a measurement behind it.

**After:** hit region **55.4×44.0**, name `"Add Friend — <person>"`.

---

## 3. The @mention list, sliced by the edge above it

**Live (Auditor):** typing "@san" into a comment box on `/feed` produced a popup "rendered visually cut in half, sliced by the post content above it". Reproduced twice.

**Cause, found by walking the ancestor chain from the painted list:** `src/components/PostCommentsSection.tsx` — the comments panel is a `motion.div` that animates its height, and a height animation must clip. The `overflow-hidden` was a **class**, so it went on clipping for as long as the comments stayed open. The one thing it clipped is the one thing that must escape it: `MentionInput` opens its list **upward** (`forceSuggestionsAboveCursor`, because the composer sits at the bottom of a thread and a downward list lands off the screen), and upward from a composer near the top of that panel means straight through this edge.

**Measured, on a post with no comments yet** — where the composer sits at the top of the panel, which is where a member writing the first comment on a photograph actually stands:

| width | before | after |
|---|---|---|
| 1440×900 | list 327.8 → 635.8, clip edge at 515.8 → **188px hidden of 308 = 61%** | **0px** |
| 390×844 | list 334.5 → 642.5, clip edge at 522.5 → **188px hidden = 61%** | **0px** |

(An earlier probe opened the *first* fixture post, which already carries a thread; that pushes the composer down and leaves a 3.6px hairline above the edge. Reproducing a fault at its mildest is not reproducing it — noted so the number is not read as a discrepancy.)

**Fix:** the clip is bound to the animation instead of to the class list — `overflow-hidden` while `rolling` is true, nothing once `onAnimationComplete` has fired, and hidden again the instant `exit` starts. Applied to **both** animated panels that host this composer: `PostCommentsSection.tsx` (the feed) and `ImageEngagement.tsx` (the competition/entry viewers, where the composer sits at the *top* of the panel and the slice is worse still). `CommentsSection.tsx:511` and `CommentThread.tsx:479` carry the same class but host the *report* panel, not a composer, and are untouched.

**A green that could not be explained was rejected.** This was first written as framer's declarative `transitionEnd: { overflow: "visible" }`, and one probe run appeared to pass on it. Measured directly, the element's inline style read `height: auto; opacity: 1; overflow: hidden` at 200ms, 600ms, 1200ms **and** 2500ms after opening — the end-value never applied in framer-motion 12.34.3 under this configuration. The callback form does, verified the same way. C-34: the apparent green was discarded rather than banked.

### Why not `suggestionsPortalHost`

react-mentions can portal that overlay to `<body>`, escaping every clipping ancestor at once, and that is the more structural-looking answer. **Rejected on a measurement, not a preference:** the overlay carries `zIndex: 50`, and this same composer renders inside `CompetitionLightbox` — `fixed inset-0 z-[100]` — so at body level the list would land *underneath* that viewer. That is exactly the fault the owner reported on 2026-08-31 ("during tagging in a coments, options are hiding not coming in fornt"), reintroduced one stacking context higher. The list stays in flow, where its z-50 still beats the send button and still sits inside the card that owns it.

**F-101's guard is still armed.** The right-edge check runs in the same probe at both widths, before and after: 0px off-screen in every run. The Auditor is right that no file with "mention" in its name is in this branch's diff against main — `MentionInput.tsx` is unchanged here and needs no change; the fault was in the box around it, not in the list.

---

## 4. The feed lightbox — this one is a merge, and it is already done

The Auditor's finding is that `PostMedia.tsx`'s accessibility work "never made it into this branch", and the instruction was explicit: **"That fix needs to be merged into this branch, not redone from scratch."**

It is on `d2/preview-a11y-five-20260907` as **`23f0332`**, whose parent is **`6bc9d2f`** — the exact tip the preview was built from. So the promotion branch is one commit short, and every symptom follows from that.

This branch is cut **from `23f0332`**, so the work arrives by ancestry, byte-identical. Measured here on the unfixed tree — i.e. **before** any of the three repairs above — the feed lightbox already reports:

```
role="dialog" · aria-modal="true" · aria-label="Photograph by Avijit Sheel — full size"
buttons: ["Download photo", "Close photo viewer"]   anchors: ["Avijit Sheel"]
```

Five checks, green before and after. That is the receipt that item 4 is a merge and not a repair, and the test file asserts those attributes so a future rebase that drops `23f0332` goes red here rather than on a member's screen.

---

## 5. The checks, and both runs

**`tools/uishot/a11y-four-items.mjs`** — real Chromium against `npm run ui:harness`, twelve checks over the four surfaces, non-zero exit on any failure.

| | before | after |
|---|---|---|
| checks failing | **6** | **0** |

Full transcripts: `2026-09-07-four-items-before.txt` and `2026-09-07-four-items-after.txt` beside this file. Only the five product files changed between the two runs; the harness changes (§6) were present in both, or `/discover` could not have been rendered at all to fail.

**`src/components/__tests__/PreviewA11yFourItems.test.ts`** — 14 source-level assertions, run in the ordinary vitest suite where Chromium is not available. Shown failing on the unfixed input: **9 failed | 5 passed**; after: **14 passed**. (The 5 that pass in both are item 4's — which is the point — plus the two negative assertions about the portal and `tap-44-down`.)

Reading source rather than rendering is this repository's existing convention for exactly this class of truth, for the reason `MentionSuggestionsFitOnScreen.test.ts` records: jsdom reports every element as 0×0 and computes no accessible name, so a rendered assertion about a 44px region or a clipped popup would pass at any size. The pixel proof is the Chromium probe; this file catches the silent regression — an `aria-label` tidied away, or `overflow-hidden` put back on a panel because it looks like it belongs beside a height animation.

**Whole suite:** 184 files passed, 1 skipped, **2541 tests passed, 0 failed**. **`npx tsc -b tsconfig.json`:** exit 0 (F-52 form, both projects). **ESLint on every touched file:** 39 problems before, 39 after — none added, none removed; the new test file is clean.

---

## 6. Two harness changes, and why they are not cheating

`/discover` had never been rendered here, at any width, in any mode — the same hole `screen-wall-visitor` closed on 2026-08-16, one page over. Two additions were needed before the fault could be reproduced at all, and both make the harness *more* faithful, not more forgiving:

- **`src/uiharness/realScreens.tsx`** — a `screen-discover` scene mounting the real `Discover` page in the real `Layout`. Everything it reads already had a fixture.
- **`src/uiharness/fixtures.ts`** — `profiles_public_data` gains `is_suspended: false` and `is_banned: false`. The real view carries both (`types.ts:4097-4098`) and `Discover.tsx` filters on both (BUG-088). The harness drops any row missing a filtered key, so **every** profile was filtered out and the page photographed "No people found matching your criteria" — a tidy empty state, which is precisely the lie `fakeBackend.ts`'s own header exists to prevent, produced by a fixture that was two columns short rather than by anything wrong with the page.

Neither change can make a failing check pass: the before-run had both, and failed six checks.

---

## 7. Paths touched

```
src/components/discover/DiscoverCard.tsx        item 1  — seven aria-labels
src/components/MobileBottomNav.tsx              item 1b — the nameless button + six nameless tabs
src/components/FeedRightSidebar.tsx             item 2  — name + tap-44
src/components/PostCommentsSection.tsx          item 3  — the clip follows the animation
src/components/ImageEngagement.tsx              item 3  — the same panel, one screen over
src/components/__tests__/PreviewA11yFourItems.test.ts   new
tools/uishot/a11y-four-items.mjs                new — the Chromium probe
src/uiharness/realScreens.tsx                   new scene
src/uiharness/fixtures.ts                       two columns the real view has
docs/evidence/d2/preview-a11y/2026-09-07-four-items{,-before.txt,-after.txt}   new
```

Nothing under `supabase/**`, `scripts/db-*.mjs`, `scripts/lane-config.*`, `docs/gates/**`, the ledger, or `package*.json` (the dependency window is closed and nothing new was needed). `src/components/MentionInput.tsx` is **not** changed. `src/components/post/PostMedia.tsx` is **not** changed by this commit — it arrives from `23f0332`.

## 8. Reported, not fixed

- **The feed photograph carries `alt=""`.** `ProgressiveImage` renders the post's main image as decorative, so a screen reader on `/feed` is told there is no picture. Out of scope for these four items and a larger decision — the caption, the photographer's name and the alt text are three different strings and someone has to choose which one an image announces.
- **`PostCard.tsx:422`** (the ⋮ menu) and the album's prev/next buttons are icon-only with no `aria-label`. Same class as item 1, different surface, not in this order.
- **Push authority:** none on this side. The git proxy refuses a credential for this repository entirely (verbatim, 07:29:27Z: "not in this session's authorized repository set"), and a local safety check refuses `git push` for the rest of this conversation. Delivered as a patch.
