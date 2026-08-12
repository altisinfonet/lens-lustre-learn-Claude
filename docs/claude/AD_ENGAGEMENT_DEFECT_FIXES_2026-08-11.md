# Three defects I shipped with ad engagement — fixed, awaiting upload

Found by auditing my own work when the owner asked what I had broken silently.
All three were mine, all three shipped the same day.

**STATE: fixed and gated locally, commit `09ccb0f`. NOT yet on origin/main.**
Push is blocked; these five files still have to go through GitHub's web editor,
**source files first and the test file LAST** — the test asserts on all four.

Files: `src/pages/AdDetail.tsx`, `src/lib/ads/adEngagement.ts`,
`src/components/ads/AdEngagementBar.tsx`,
`src/components/admin/AdminCommentReports.tsx`,
`src/__tests__/adEngagement.test.ts`

## 1. A hidden ad was still a public page

`AdDetail.tsx` selected `is_active` and never read it. Switching a creative to
Hidden in the admin panel took it out of the feed and left `/ad/<id>` serving it
to anyone holding the link. Now `!creative.is_active && !isAdmin` returns the
"no longer available" page; admins still preview.

## 2. The batch was possible, not actual

`adEngagement.ts` promised "one round trip, not sixty-four" and the RPC always
took an array — but every caller was one ad card asking about itself, so 16 ads
meant 16 requests. Ids requested inside the same microtask are now collected and
sent as ONE query, and all callers in that tick share the flight. No change to
Feed or AdZone; nothing waits longer than before.

## 3. A flagged ad comment reached the admin queue unreadable

The trigger filed flagged ad comments into `comment_reports` via the new
`ad_comment_id`, but `AdminCommentReports` only knew `post_comment_id`, so they
arrived as rows with no text. It now loads them from `ad_creative_comments`,
labels them "ad comment", links to `/ad/<creative_id>`, and — the part that
would have silently failed — **deletes from the right table**.

Also removed: the unused `linkToPage` prop on `AdEngagementBar`.

## Gates

tsc clean · `vite build` ✓ · vitest **1128 pass / 2 fail** (the two known
judging tests) · security PASS · four mutations each turning exactly one test
red, including a strengthened batching test that now fails when the variable is
merely renamed (the first version of that assertion did not).

## Build 1072

Cut and running BEFORE these fixes
(`actions/runs/31473495863`). **1072 does not contain any of the three.**
Owner to decide: ship 1072 and take the fixes in the next build, or re-cut
(which becomes 1073).
