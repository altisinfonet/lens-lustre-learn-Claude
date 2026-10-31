# Promotion preview — the five remaining RED items

**D2 · 2026-09-07 · branch `d2/preview-a11y-five-20260907` off `d2/main-promotion-preview-20260906` (`6bc9d2f`)**

Auditor's DOM measurements on the live preview, 2026-09-06. Five items, six specs. Four are fixed here, one is fixed in **two** components rather than one, and **one is disputed with evidence**.

## 1–3 · The fullscreen photo viewer — and there are TWO of them

The Auditor measured one overlay. Grepping `fixed inset-0 z-[100]` across the tree and checking each for `role="dialog"` found the same defect in **two** components that a member reaches by the same gesture:

| Component | Reached from |
|---|---|
| `src/components/FacebookPhotoGrid.tsx` (`PostLightbox`) | `/post/:id`, `/entry/:id`, `/hashtag/:tag` |
| `src/components/post/PostMedia.tsx` (`CarouselLightbox`) | **every photograph in the feed** |

Both are repaired identically in this commit. Fixing only the measured one would have left the feed — the busiest surface in the product — exactly as it was.

**1 · Dialog semantics.** Both overlays were a bare `motion.div`: no `role`, no `aria-modal`, no accessible name. Added `role="dialog"`, `aria-modal="true"`, and a name that says whose photograph it is (`Photograph by <name> — full size`). `CompetitionLightbox`, `ImageCropModal` and `CinemaFullView` already declared `role="dialog"`; these two were the outliers.

**2 · The four controls.** Close, Previous, Next now carry `aria-label`. Download went through `DownloadButton`, which had only `title` — a tooltip, announced inconsistently and skipped entirely by some configurations, so the button announced as "button". `DownloadButton` gains an `ariaLabel` prop **defaulting to `title`**, so every other caller in the codebase gains a real accessible name without being touched.

**3 · The photographer's name — RED #5 and #8 together.** There was nothing in the dialog for a tap or a reader to land on. The name is now rendered **first in DOM order**, before the chrome, so a reader announces whose photograph this is before offering Close/Previous/Next, and the first Tab lands on the photographer rather than a chrome button. It is a real `ProfileLink` (the same component the post header uses), top-left in open space with nothing above it — so its 44px region can only grow into emptiness and cannot repeat F-109.

The author is threaded from the callers that already hold it: `PostCard` (`post.user_id`, `author_name`, `author_handle`), `EntryDetail`, `HashtagFeed`. The prop is optional: where a caller genuinely has no author, the viewer is no worse than before.

## 4 · Copy Photo Link — DISPUTED, with a measurement

**Spec:** *"measures 198.4px x 40px via getBoundingClientRect — 4px short. Needs height raised to at least 44px."*

**Not changed, because the number is measuring the wrong box.** That button carries `.tap-44-down`, whose hit region is an absolutely-positioned `::after` with `min-height: 44px` anchored at `top: 0` — a pseudo-element `getBoundingClientRect()` on the button cannot see. The instrument that *can* see it is `document.elementFromPoint`, which is what diagnosed F-109 in the first place.

Reduction of exactly that CSS, probed in Chromium (390×844):

```
button rect            266.8 x 17      (the box getBoundingClientRect reports)
elementFromPoint  top + 2   → the button
elementFromPoint  top + 43  → the button      ← 43 > 17, so the region really is 44 tall
elementFromPoint  3px BELOW the rect → the button
elementFromPoint  on the name's bottom edge → the NAME, not the button   ← F-109 stays fixed
```

The target is already 44 px and it grows **downward only**. Raising the element's own height to 44 would add ~27 px of whitespace under a 10 px uppercase label, move layout the Owner has already reviewed, and buy no accessibility — while re-opening the exact question F-109 answered last night ("the answer was direction, not size").

**Offered:** if the Auditor wants this settled on the real DOM rather than a reduction, run the same `elementFromPoint` probe at `rect.top + 43` on the deployed preview. If it returns anything other than the button, the finding stands and I will fix it that hour.

## 5 · The member's own name is now the page heading

`UserIdentityBlock` already had `nameAs` (added for `PublicProfile` under F-98, with the Auditor's own reasoning: *"A member's own name at the top of their own profile … is A PAGE HEADING"*). `Profile.tsx` had simply never passed it. Now `nameAs="h1"` on both name sites — the mobile and desktop layouts are **separate returns and only one ever mounts**, so the page has exactly one `h1`.

## 6 · Trending This Week tiles

Confirmed: a bare `<div>` per tile — no `<a>`, no `<button>`, no `tabindex`, no `role`. Keyboard could not reach them; a reader announced four decorative images. Now a real `<Link>` with a focus-visible ring and an `aria-label`, matching the feed's own pattern.

**One source cannot be linked honestly.** `dashboard-init` returns `{ id, image_url, title, reaction_count, source }`. `entry` → `/entry/:id` and `post` → `/post/:id` resolve; a **`portfolio`** row carries no owner id and there is no route that takes a portfolio image id. A `<button>` that navigates nowhere is worse than a plain tile — it announces itself as a control and then does nothing — so portfolio tiles stay figures (with real `alt`), and the missing field is **reported to D1**, whose function that is. Adding `user_id` to those rows would let all three link.

## Checks
`npx tsc -b tsconfig.json` exit 0 · `eslint` error counts **identical before and after** on every file touched (all pre-existing; none added) · `vitest` on `src/components/post`, `src/components/__tests__`, `src/pages/__tests__`: **383 passed (40 files)**.

**Classification: VERIFIED** for the code changes and the checks. **The five fixes are not yet proved in a browser** — jsdom is not a browser (F-53), and the Auditor's re-verification on a fresh preview build is the proof that counts.
