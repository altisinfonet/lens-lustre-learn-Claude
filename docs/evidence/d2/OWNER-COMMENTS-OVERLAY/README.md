# OWNER-COMMENTS-OVERLAY — Comments open as a dedicated surface, not inline in the card

**Unit type:** Owner-directed fix, outside Addendum A's F-/P- numbering (same
class as prior OWNER-01/OWNER-02-style units) — D2 lane only, no `supabase/**`
touched, no migration involved.

**Gate sentence:** Tapping the comment icon on any post opens the SAME
comments this app has always read and written (post_comments,
post_comment_reactions, comment_reports, the same optimistic
useAddComment mutation and AI moderation call) in a dedicated overlay — a
modal on web/desktop, a bottom sheet on the installed app — instead of
expanding the post card in place; the feed/wall/post-detail list underneath
is never restructured and its scroll position is preserved, and
`npm run typecheck`, the full `vitest run` suite, and eslint on every touched
file are all clean.

**Branch:** `d2/comments-overlay-20260909` off `origin/staging`
(HEAD at branch time: `d93a97b`).

## What was wrong

`PostCard.tsx` held local `commentsExpanded` state and, when true, rendered
`PostCommentsSection` inline via `AnimatePresence` — a height-animated strip
at the bottom of the card. That pushed every post below it down the feed,
gave comments no dedicated surface on either web or the app, and had no
modal/sheet/overlay anywhere in the codebase to mirror the Instagram pattern
the product is built to match.

## What changed, and why it is safe to reuse everywhere

Nothing about **who may load, post, edit, delete, like, pin or report a
comment** changed. The Supabase tables, the `useAddComment` mutation
(optimistic insert, AI moderation call, error rollback), and every RLS
policy behind them are untouched — this is a client-only UI relocation.

1. **`src/hooks/feed/usePostComments.ts`** (new) — the data half of
   `PostCommentsSection.tsx`, extracted verbatim (same queries, same
   `resolveBadges`/`resolveName` calls, same tree-building) plus stale-post-
   switch guards: a `postId` change resets local state, and every async step
   checks the id it was fetched for is still current before writing state —
   needed because the overlay can now show Post A, close, and show Post B
   while A's fetch might still be in flight.

2. **`src/components/comments/CommentThread.tsx`** — exported the local
   `Avatar` component and added `hideComposer?: boolean` (default `false`,
   so every existing caller — the post's old inline thread, the sponsored ad
   thread — is unchanged). Reply and edit boxes are unaffected; only the
   trailing "new comment" composer is omitted when `hideComposer` is set.

3. **`src/components/comments/CommentComposer.tsx`** (new) — the same
   composer box `CommentThread` has always drawn at its own bottom, extracted
   so it can be pinned OUTSIDE the scrolling thread (the modal and the sheet
   both need the list to scroll independently while the composer stays put).

4. **`src/components/PostCommentsSection.tsx`** (rewritten, same path) — now
   a two-band layout: `usePostComments()` for data, a scrollable
   `<CommentThread hideComposer />`, and a pinned `<CommentComposer />`
   below it with `env(safe-area-inset-bottom)` padding (harmless 0px on web,
   correct on the app). No longer expands/collapses in place — the overlay
   around it now owns open/close, so the old `motion.div` height animation
   and `expanded` prop are gone.

5. **`src/contexts/CommentsOverlayContext.tsx`** (new) — the minimal global
   state: which post's comments are open, and the `onCommentCountChange`
   callback the opener already had (Feed's cache updater / PostDetail's
   local state / WallPosts', unchanged). Carries no comment data itself.
   Mirrors `?comments=<postId>` onto the CURRENT route (never navigates, so
   the feed/wall stays mounted and scroll position is free) so Back closes
   the panel and Forward reopens it from the post already cached in context —
   see the file's own header comment for the one thing this does NOT do
   (cold-load deep-linking), noted as a limitation below.

6. **`src/components/comments/CommentsOverlay.tsx`** (new) — the chrome.
   `useIsMobile()` (the app's existing 768px breakpoint, not a new one)
   picks Radix `Dialog` (web: ESC, focus trap/return, backdrop-click, scroll
   lock, all native to the primitive) with the post's photo beside the
   thread, or `vaul`'s `Drawer` (app: swipe-to-dismiss, rounded top, drag
   handle, scroll lock, likewise native) sized like `MobileProfileSheet`'s
   85vh sheet, with no photo of its own — the post stays visible above it,
   as on Instagram's app. Neither shape draws a comment row or a composer;
   both render `PostCommentsSection` for that.

7. **`src/components/post/PostCard.tsx`** — removed `commentsExpanded` state
   and the inline `AnimatePresence`/`PostCommentsSection` block; the comment
   icon now calls `openComments(post, onCommentCountChange)`. No other prop
   or behaviour of the card changed.

8. **`src/components/Layout.tsx`** — mounts `CommentsOverlayProvider` around
   `LayoutInner` and `<CommentsOverlay />` once, beside `GlobalComposer` and
   `GiftCelebrationModal` — the same "one shell-level mount, not one per
   page" pattern `GlobalComposer`'s own header comment documents.

**`src/pages/PostDetail.tsx` needed no changes.** It renders `<PostCard>`
directly (the "ONE FUNNEL" rule quoted in that file), so it inherited the new
behaviour automatically. Verified, not assumed — see Testing below.

## Tests

Four existing tests scanned `src/components/PostCommentsSection.tsx` by exact
path/source-text for logic that legitimately moved to
`usePostComments.ts` in this change (the `resolveBadges(` call, and the file's
place in the unbounded-query hot-path scan). Updated, each with a comment
naming the move, following the pattern already documented in this codebase
(`noComponentDefinedInRender.test.ts`: *"THE LIST FOLLOWED THE CODE"*):

- `src/components/__tests__/BrandBadgeEverywhere.test.tsx` — scan target
  `PostCommentsSection.tsx` → `usePostComments.ts`.
- `src/__tests__/queryCeilings.test.ts` — same move in `HOT_FILES`.
- `src/components/__tests__/ComposerEnterKey.test.tsx`,
  `src/__tests__/noComponentDefinedInRender.test.ts` — needed **no** change:
  `PostCommentsSection.tsx` still sets no placeholder of its own and still
  renders `<CommentThread>` directly, just inside the new two-band layout.

One test's premise changed because the architecture legitimately did:
- `src/components/post/__tests__/PostFullBleedAndTapTargets.test.ts` —
  "photo → icons → caption → **comments**" asserted a fourth in-card section
  that no longer exists by design. Narrowed the order check to
  media/actions/caption, and added a positive-control test asserting the
  action row now calls `openComments(post` and that neither
  `commentsExpanded` nor a directly-rendered `<PostCommentsSection>` is back
  inside the card.

New coverage added:
- `src/components/comments/__tests__/CommentsOverlay.test.tsx` — renders
  nothing until opened; opens as a `Dialog` with the post's photo on a
  desktop viewport; opens as a sheet with no photo of its own on a mobile
  viewport; ESC closes it; the overlay itself defines no second comment
  renderer or composer (source-text check, same class of guard as
  `noComponentDefinedInRender.test.ts`).

### Results

```
npm run typecheck        # tsc -b tsconfig.json — both projects — clean, 0 errors
npx vitest run            # 194 test files, 2664 passed, 1 pre-existing skip, 0 failed
npx eslint <every file this unit touched>   # 0 new errors, 0 new warnings
                                             # (pre-existing `no-explicit-any` in code
                                             #  moved verbatim, and the
                                             #  react-refresh/only-export-components
                                             #  warning every other Context+hook file
                                             #  in this codebase already carries —
                                             #  both confirmed pre-existing by running
                                             #  eslint against the pre-change git blob)
```

Full failing→green loop is on record: the first full suite run surfaced
exactly one failure (`PostFullBleedAndTapTargets.test.ts`'s stale
"comments" anchor, above); fixed, then two more full runs came back clean.

## Remaining limitations (stated, not hidden)

- **No cold-load deep link.** `?comments=<postId>` on the URL is a
  within-session mirror only (Back/Forward while the panel's post is already
  cached). A hard refresh, or a shared link, with that param present does
  **not** auto-open the panel — doing so would need a second full
  post-fetch path duplicating `PostDetail.tsx`'s, and the inline
  implementation this replaces had no URL state or deep-linking at all, so
  this is a net addition, not a regression.
- **Keyboard-avoidance on the app's on-screen keyboard** was not measured on
  a real device (D2's own standard: *"Measure before and after, on a real
  mid-range Android — not an emulator"*) — the composer sits in a `shrink-0`
  footer inside a `flex flex-col h-full` sheet, the same shape
  `MobileProfileSheet` already ships, but that shape has not been
  screenshotted with a keyboard open for THIS surface specifically.
- Two pre-existing, unrelated items were found and deliberately left alone
  (in scope only to note, not to fix under this unit): `PostDetail.tsx`
  carries a dead `showComments` state and a dead `PostCommentsSection`
  import, neither read anywhere in that file.

## Config / migration / API changes

None. No new dependency (Dialog, Drawer, `useIsMobile`, `useSearchParams`
were all already in the project), no Supabase schema or RLS change, no new
edge function, no environment variable.
