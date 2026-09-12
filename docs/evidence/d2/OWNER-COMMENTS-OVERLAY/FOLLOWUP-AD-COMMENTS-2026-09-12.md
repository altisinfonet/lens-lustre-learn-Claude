# Follow-up — the sponsored ad's thread now opens in the SAME overlay a post's does

**Unit type:** Owner-directed fix, same unit as `README.md` in this directory
(OWNER-COMMENTS-OVERLAY) — D2 lane only, no `supabase/**` touched, no
migration involved.

**Owner, 2026-09-12, looking at the Ads section after the overlay shipped:**
*"In the Ads section same type of commenting not happening exactly like
posts."*

**Gate sentence:** Tapping the comment icon on a sponsored story-card ad opens
the SAME dialog/sheet CommentsOverlay renders for a post — the ad's own
picture beside its thread (`ad_creative_comments`, unchanged), never an inline
strip expanding the card in place — while `/ad/<id>`'s always-open thread (the
page IS the thread, same as PostDetail) is untouched; `npm run typecheck`, the
full `vitest run` suite, and eslint on every touched file are all clean.

**Branch:** `d2/ad-comments-overlay-20260912` off `origin/staging` at `3adb9d0`
(the tip that already carries the original overlay work, PR #230).

## What was wrong

The original overlay (README.md, above) replaced PostCard's inline
`commentsExpanded` strip. It shipped **before** anyone circled back to
`AdEngagementBar.tsx` — the sponsored story card's comment icon still called a
local `setOpen((v) => !v)`, rendering `<AdComments>` inline underneath the ad,
pushing every post below it down the feed. Exactly the pattern the overlay
replaced for posts, left standing on the one surface nobody had touched since
8-11.

## What changed, and why it is safe to reuse everywhere

Nothing about **who may load, post, edit or delete an ad comment** changed —
`ad_creative_comments`, `adEngagement.ts`'s reads/writes, and the blocklist
trigger are untouched. This is the same client-only relocation the original
overlay work was.

1. **`src/contexts/CommentsOverlayContext.tsx`** — `post` became a discriminated
   `subject: { kind: "post"; post } | { kind: "ad"; creativeId; imageUrl }`.
   `openComments` split into `openPostComments` (same signature, same
   `?comments=<postId>` URL mirror) and the new `openAdComments(creativeId,
   imageUrl, onCommentsChanged?)`, which mirrors `?comments=ad:<creativeId>`
   instead — the `ad:` prefix keeps the two id spaces apart in the one URL
   param and in the back/forward re-open check, without a second query param.
   `notifyCommentCountChange` (posts, delta-based) and the new
   `notifyAdCommentsChanged` (ads, a bare re-fetch — see point 3) are separate
   callbacks stored in separate refs, because AdEngagementBar's own count
   refresh (`reload`, an RPC re-fetch) takes no delta and never did.

2. **`src/components/comments/CommentsOverlay.tsx`** — branches on
   `subject.kind` once, near the top, to a `coverImage`/`thread` pair reused by
   both the Dialog and Drawer paths (this also de-duplicated the two identical
   `<PostCommentsSection>` calls the file had before). The ad path hands off to
   `<AdComments creativeId={subject.creativeId} onCountChange=
   {notifyAdCommentsChanged} />` — the SAME thread component
   `AdEngagementBar`'s old inline render used, not a new one. Chrome (Dialog
   vs. Drawer, ESC, focus trap, backdrop, scroll lock) is unaffected; it was
   already subject-agnostic.

3. **`src/components/ads/AdEngagementBar.tsx`** — added an `imageUrl?: string |
   null` prop (the creative's own picture, for the overlay's photo pane, same
   role a post's `image_urls[0]` plays). `onCommentClick` now branches: when
   `commentsAlwaysOpen` (the `/ad/<id>` page) it is byte-for-byte the old
   toggle, renamed `open` → `inlineOpen` only for clarity against the new
   overlay path; otherwise it calls `openAdComments(creativeId, imageUrl,
   reload)` — `reload` is the SAME re-fetch callback the inline render used to
   get via `onCountChange`, now delivered through the overlay instead.
   `<AdComments>` is only ever rendered inline when `commentsAlwaysOpen`.

4. **`src/components/ads/AdZone.tsx`** — one line: passes `imageUrl={cr.image_
   url || null}` to `<AdEngagementBar>` at its one call site (confirmed still
   the only call site — `adEngagement.test.ts`'s existing "only one
   `<AdEngagementBar`" guard still passes unmodified).

5. **`src/components/post/PostCard.tsx`** — its one call site renamed
   `openComments(post, …)` → `openPostComments(post, …)`. No other behaviour
   changed.

**`src/pages/AdDetail.tsx` needed no changes**, same as `PostDetail.tsx` in
the original unit — it never went through `openAdComments` in the first
place; its thread is, and remains, the page itself.

## Tests

- **`src/components/comments/__tests__/CommentsOverlay.test.tsx`** — existing
  post tests updated for the `openPostComments` rename. Added a new describe
  block, the ad-side mirror of the post one: opens as a Dialog with the ad's
  own picture on desktop, as a sheet with no photo on mobile, ESC closes it
  and clears state, and a same-overlay-one-subject-at-a-time check (opening
  the ad after the post replaces the panel rather than merging it).
  `AdComments` is mocked at the module boundary here — this suite is about
  the overlay's OWN job (which chrome, which thread it hands off to), not
  `AdComments`' data plumbing.
- **`src/components/ads/__tests__/StoryCardComments.test.tsx`** — this file's
  whole premise was the inline render, so `openStoryCardThread()` now mounts
  `CommentsOverlayProvider`/`CommentsOverlay` alongside `AdEngagementBar` (the
  same pairing `StoryCardComments`' post-side equivalent already used) and
  waits for the dialog the click actually opens, before running the SAME
  assertions as before (the real comment text reaches the DOM, no
  `renderRow`/`renderComment` leak, exactly one composer). Added the
  anti-drift pair: one dialog, not a second one of the card's own, and a
  source check that `AdEngagementBar` calls `openAdComments` rather than the
  old unconditional inline render.
- **`src/components/ads/__tests__/StoryCardReactions.test.tsx`** — unaffected
  behaviourally (never taps Comment); needed `CommentsOverlayProvider` added
  around it only because `AdEngagementBar` now calls `useCommentsOverlay()`
  unconditionally.
- **`src/__tests__/adEngagement.test.ts`** — the one exact-string regex
  asserting `AdZone`'s single `<AdEngagementBar>` call site, widened to also
  require the new `imageUrl={cr.image_url || null}`.
- **`src/components/post/__tests__/PostFullBleedAndTapTargets.test.ts`** —
  the one `openComments(post` string assertion renamed to
  `openPostComments(post`.

### Results

```
npx tsc -b tsconfig.json     # clean, 0 errors
npx vitest run                # 194 test files, 3120 passed, 189 pre-existing
                               # failures (11 files, ALL supabase/** migration
                               # and notification-catalog SQL parity checks —
                               # confirmed identical on origin/staging BEFORE
                               # this branch's changes, via git stash; none of
                               # the 11 files are touched by this unit), 1 skip
npx eslint <every file this unit touched>
                               # 0 new errors, 0 new warnings (the pre-existing
                               # no-explicit-any / react-refresh warnings in
                               # AdZone.tsx, PostCard.tsx, CommentsOverlayContext.tsx
                               # confirmed byte-identical on origin/staging)
LANE=staging npx vite build   # succeeds; the svgo image-optimizer errors in
                               # the log are a missing sandbox devDependency,
                               # pre-existing, and do not fail the build
npx tools/uishot/capture.mjs <all 37 baselined scenes, all 4 viewports>
                               # 148 screenshots, 0 problems, baseline diff
                               # clean against all 148 recorded keys — the two
                               # scenes that actually render a story-card ad
                               # (screen-feed, journey-create-from-feed) came
                               # back clean along with everything else
```

## Remaining limitations (stated, not hidden)

- Same cold-load-deep-link limitation as the original unit, now true of
  `?comments=ad:<creativeId>` too: a hard refresh or shared link with that
  param present does not auto-open the panel (would need a second full
  creative-fetch path duplicating `AdDetail.tsx`'s). Net addition over the
  inline implementation, which had no URL state at all.
- Keyboard-avoidance on the app's on-screen keyboard was not re-measured for
  the ad thread specifically — it reuses the exact sheet shape the original
  unit already left as a stated, unmeasured limitation for posts.

## Config / migration / API changes

None. No new dependency, no Supabase schema or RLS change, no new edge
function, no environment variable.
