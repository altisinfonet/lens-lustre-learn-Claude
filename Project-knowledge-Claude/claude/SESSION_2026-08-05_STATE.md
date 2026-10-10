# State — end of session 2026-08-05. READ FIRST.

## ⚠️ NOT FINISHED. Three changes are written, tested and NOT pushed.

Sitting in the working tree, typecheck clean, 221 tests green:

| file | what it does | why it matters |
|---|---|---|
| `src/lib/unfreezeStuckOverlay.ts` (new) | clears a stuck `pointer-events:none` on `<body>` when no Radix layer is open | **the "Report content froze the whole app" bug** |
| `src/main.tsx` | calls `installOverlayUnfreeze()` | wires the above |
| `src/components/Layout.tsx` | drops `missingAvatar` from the onboarding-complete check; `setPhotoPromptOnly(false)` | the owner's **FINAL NOTICE**: nothing may block for DP |
| `src/components/__tests__/ProfilePhotoPrompt.test.ts` | superseded block rewritten to pin "the photo NEVER blocks" | old tests pinned the reversed rule |
| `src/lib/__tests__/imageFallbackRecycle.test.ts` (new) | pins the recycled-node guard | stops the search regression returning |

**Push these first thing.** Without Layout, the photo prompt still interrupts.

## The regression I caused and fixed today — do not repeat it

`imageFallback.ts` kept retry state in `data-*` on the `<img>`. **React reuses
those elements.** A search box re-renders per keystroke and hands the same node a
different person's photo, so the previous occupant's `fallbackApplied="1"` and
`retryCount="2"` carried over, and a pending 400ms/1200ms timer wrote the OLD
person's URL onto the NEW person's avatar. Every retry uses a `__r=`
cache-busting param, so fast typing became a burst of uncacheable requests —
**that is the "app hang after a search"**.

Owner reported it within the hour: *"search whatever we have developped all
malfucnting, app hang after a search, backspace not working."*

Fixed and **pushed** (`1d44531`): state is keyed on the URL (`stripRetryParam`),
reset when the url changes, and the timer re-reads the dataset before writing.

## LIVE AND VERIFIED on production

- **Text-only posts allowed.** Rehearsed as a real member with no photo: insert
  accepted. Before: **0 of 151 posts** in the site's history were text-only,
  because the composer refused them. The DB never required a photo.
- **Registration never waits for a photo.** `handle_new_user()` assigns a
  cartoon in the same statement that creates the profile — **default male**, per
  the owner's formula.
- **`trg_ensure_member_always_has_picture`** — any write that would blank
  `avatar_url` is turned into "assign the fitting stand-in". Members with no
  picture: **0**, and now structurally impossible.
- **`trg_sync_fallback_avatar_to_gender`** — answering He/She re-points the
  cartoon to the matching set, same slot (f3 → m3). Uploaded photos untouched
  (verified: 51 real photos intact).
- Avatar picker + He/She on Edit Profile; He/She on signup switches the shown
  face **instantly** (derived from state, not from the DB round-trip).

### A bug I shipped and repaired within minutes
Removing the photo requirement made `avatar_url: avatarUrl` write `""` and
**wipe** the assigned cartoon. It hit exactly one member — Leeza Basu, the
owner's test account — restored to `/avatars/fallback/f5.svg`. Fixed in
`OnboardingModal` (`...(avatarUrl ? { avatar_url: avatarUrl } : {})`) and made
impossible by the DB guard above.

## The freeze — evidence, not a guess

`capacitor.config.ts` has **no `server.url`**, so the Android app runs BUNDLED
assets. His phone is on build 1047/1050 and **cannot** contain today's web work.
The "Report content" freeze is pre-existing.

Mechanism: Radix locks the page with `pointer-events:none` on `<body>` while a
menu is open and removes it on close. "Report content" closes the dropdown AND
expands a panel inside the same card in one commit; if the close is interrupted
the style stays and **every tap is swallowed until reload**. That is the whole
symptom. `unfreezeStuckOverlay.ts` clears it, and only when no layer is open.

## Builds

- **1051 built and green** (run #51, versionCode 1051). NOT uploaded.
- **1052 NOT cut** — the owner said *"before buling app i want to test"*, and the
  trigger file was deliberately left untouched. Do not commit
  `ANDROID_BUILD_TRIGGER` until he says go. A 1052 changelog entry is drafted in
  the previous version of this doc's history if needed.

## Still open

- Owner's real female list (33 rows hold an assistant guess; the migration says so).
- He reports search issues beyond the image regression: *"backspace not working,
  after selecting a person that profile not opening"* — **not yet investigated**.
  Check `GlobalSearch.tsx` and the route-change dismissal noted in
  `claude/NOTIFICATIONS_SYSTEM.md`.
