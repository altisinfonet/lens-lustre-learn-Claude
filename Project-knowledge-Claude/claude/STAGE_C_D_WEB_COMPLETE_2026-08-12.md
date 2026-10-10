# Stage C + D — WEB COMPLETE, verified live (2026-08-12)

Owner sequence: **Stage C DB → Web LIVE → owner tests → owner approves → Android → B2 last.**
B2 remains INACTIVE. No Android release.

---

## The defect this closes

Stage C first shipped the 46-chip category picker **inline in the feed composer**, under the Post
button. The three-step Create post modal existed as `src/components/post/CreatePostModal.tsx` but
was **imported by zero files** — Vite tree-shook it out and it never reached the bundle. The feed
showed a wall of chips instead of a Create screen.

Owner, verbatim: *"This was my sample. What you did"* … *"check my chat post screen modal scren all
shared but what you did here…"*

Root cause class: **a component that is built, tested and merged but never mounted is not shipped.**
A green test suite proves the module works, not that anything renders it. Grep for the import.

---

## Commits on `main` (all byte-verified via raw.githubusercontent SHA-256)

| SHA | What |
|---|---|
| `382f66f` | Create post is the three-step modal, not a chip grid on the feed |
| `3ae9bee` | Delete `CreatePostModal.tsx` — unreferenced, never bundled |
| `8e55f8d` | Category strip moves **above** the stories row |
| `e86fd4b` | All 46 categories reachable — desktop arrows + full grid |

Verified byte counts: `WallPosts.tsx` 84,378 · `Feed.tsx` 17,847 · `CategoryStrip.tsx` 11,205.

Deployed bundles confirmed on 50mmretina.com: `assets/WallPosts-CD8WwBaA.js` (Create post strings),
`assets/Feed-Cik1p-O3.js` (`All categories`, `border-amber-500`, desktop-only arrows).

---

## Owner's decisions, recorded (2026-08-12)

| Question | Decision |
|---|---|
| Categories placement | **Option B** — chips directly on the details/settings screen. No `Categories ›` sub-screen. |
| At 5 selected | Every **unselected** chip disables. The chosen 5 stay tappable so one can be swapped. |
| App photo picker | **Build the in-app gallery grid** — Recents ▾, multi-select, live preview. |
| Drafts | **Both** web and app. |
| Screen count | **Each as drawn**: app = 2 screens, web = 3 screens. |

---

## Web — what is live

1. **Feed** — category strip **above** the stories row, active state **amber** (was below stories,
   blue). Sticky. "All" is the default and applies no predicate, which is what keeps the 205
   pre-category posts visible.
2. **All 46 reachable, three ways** — swipe (phone/app); **‹ ›** arrows, desktop-only and shown only
   while there is overflow in that direction; **grid button** opening every category on one screen.
   Owner: *"Categories scrolling after visible 46, who will do"* — a bare `overflow-x-auto` row is a
   trap on desktop: no touch, and the wheel scrolls the page, so 38 categories were unreachable.
   Do not remove the grid and leave only arrows — eleven clicks to reach a category is the same
   defect wearing a button.
3. **Collapsed composer row** — avatar + "What's on your mind?" + photo icon + `Drafts (n)`.
   **No picker on the feed page.**
4. **Create post** (step 1) — name + audience dropdown, caption, photo previews/dropzone,
   "Add to your post" (photos, tag people), **Next** disabled until caption or photo.
5. **Post settings** (step 2) — Post preview, Post audience ›, Scheduling options ›, **category
   chips**, search-engine opt-out, footer **Save** / **Post**.

Posting pipeline unchanged: same `uploadPhotos()` with stale-handle recovery, same `post_tags` with
coordinates, same scheduled-post path, same Post-button predicate. **Closing writes nothing** —
`decidePersistence({type:"close"})` returns an empty action and there is no autosave-on-unmount.

---

## The 5-limit rule — do not "simplify" this

```ts
const isDisabled = atLimit && !isSelected;   // NEVER plain `atLimit`
```

Disabling every chip at 5 traps the member with no way to swap one out. `toggleCategory` returns
the **identity** array when the cap is hit, so an over-limit tap is a no-op rather than a silent
swap.

---

## Gates / quality

- Typecheck clean. `vite build` succeeds.
- 1,283 tests pass. **2 pre-existing failures** in `complete-round-progression-decisions.spec.ts`
  (edge-function judging, unrelated — confirmed failing on `git stash` before these changes).

---

## Still open

1. **Android app** — 2-screen flow per the owner's mock:
   - Screen 1 "New post": live preview, **Recents ▾**, **Drafts** tab, **Select** multi-pick,
     in-app gallery grid, POST/STORY/REEL/LIVE strip, **Next**.
   - Screen 2 "New post": thumbnail, "Add a caption…", Tag people ›, audience, scheduling,
     **category chips inline (Option B)**, full-width **Share**.
   - Needs a Capacitor media plugin to read the device gallery + native read permission. Must use
     `window.Capacitor` runtime globals — **a static `@capacitor/*` import breaks the WEBSITE
     build**, because those packages exist only in the Android CI job.
2. **APK for phone testing** — CI runs `bundleRelease` only and an **AAB cannot be sideloaded**.
   Needs `assembleRelease` + `upload-artifact`, or Firebase App Distribution.
   Play upload step is skipped (`PLAY_SA` unset), so merging to `main` releases nothing to Android.
3. **Stage B2** (`POST-CAT-002`, the 1–5 minimum) — only after Stage C verified, new Android build
   published, adoption measured via `client_errors.app_build`, scheduled queue confirmed clear.
4. The scheduled-post publisher (edge fn v21) has **never executed** in production — queue empty,
   still unproven in the wild.

---

## Standing constraints (unchanged)

- `git push` is proxy-blocked (403). Every file goes through GitHub's web editor/Upload page and
  **must be byte-verified** (gzip+base64 chunk → `DecompressionStream` → SHA-256 compare).
- Owner does SQL review; only the owner uploads App builds.
- It is a **live site**.
- ❌ Guesswork ❌ Assumptions ❌ Implicit behavior ❌ Hidden operations ❌ Auto-fix behavior
  ❌ "Probably safe" logic.
- Hashtags and `post_tags` people-tagging are untouched.
