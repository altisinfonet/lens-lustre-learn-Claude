# App build shipped + PENDING list (2026-08-12)

> **SUPERSEDED IN PART — see `claude/SESSION_COMPLETE_BUILD80_2026-08-12.md` for the
> evening session:** typing bugs fixed on all comment surfaces, edit-caret fix, Apple
> sign-in hidden, CI signing permanently fixed (builds #76–79 root-caused), content
> proofs added, and **build #80 SUCCESS — signed AAB delivered to owner** (run
> 31631155658, versionName 1.2.3). This doc's pending items remain live and are
> restated there.

Web approved by owner. App code is on `main`. This doc is the running pending list —
**owner asked that nothing here be forgotten and that he not be asked to re-send images.**

---

## PENDING — owner-raised, NOT yet done

### P1. Verified badge missing next to a TAGGED name (owner, 2026-08-12)

Owner's screenshot: a post header reads **"Sophia Agarcia with 50mm Retina World"** — the
tagged account **50mm Retina World** renders with NO blue tick.

Owner's rule, verbatim: *"my rule was always badge will show with name everywhere"*.

So the badge is missing specifically on the **tagged-people name** in the post header. It is
present on the author name elsewhere. The fix is to render the verification badge for the
tagged profile in the "with X" segment too — and then sweep for any OTHER place a profile name
is printed without its badge, because the rule is *everywhere*, not *this one spot*.

Status: **not started.** Owner: *"Note this task. will complete after this work."*

### P2. The App build must carry every completed feature

Owner: *"Note in this App build Contributor score and other all done work must be there."*

**Now enforced by CI, not just by construction** (added 2026-08-12 evening): the workflow
step "Prove the synced app is TODAY'S app" greps the synced bundle for
`get_contributor_scores`, `Top Contributor`, `All categories`, `Photojournalism`,
`Pinned comment`, `caretPlaced` and FAILS the build if any is missing. Build #80 passed all.
Still: **verify on the device** after the Play rollout; "proved in CI" beats "should be
there" but "seen on the phone" beats both.

### P2b. CriteriaSliders (`src/components/judge/MobileJudgeView.tsx`) — added 2026-08-12 evening

4th instance of the declared-inside-render bug class (same family as the "sknaht" comment
bug, fixed everywhere else). Affects typing in mobile judge scoring. CANNOT use the
render-function fix — it calls `useState` and renders conditionally — needs a module-scope
hoist with explicit props. Tracked by name in the `noComponentDefinedInRender.test.ts`
allowlist; remove the entry when fixed. Also minor same-class: `Toggle` in
`AdminPerformance.tsx` (admin-only, hoist opportunistically).

### P3. Stage B2 — the 1–5 category minimum (`POST-CAT-002`)

Still INACTIVE. Migration `20260812090000_post_categories_enforce_minimum.sql` is written and
tested, not applied. Apply only after: Stage C verified on web ✅, new Android build published,
adoption measured via `client_errors.app_build`, scheduled queue confirmed clear.

### P4. The scheduled-post publisher (edge fn v21) has never executed in production

Queue has always been empty. Unproven in the wild.

### P5. R8 full mode — owner deferred to the NEXT release (normal R8 is ON in build #80).

### P6. Secrets `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` hold wrong values — now
harmless (CI resolves alias+password from the keystore itself since `1fcd745`), but owner
may correct them at leisure.

---

## NO REELS, NO LIVE

Owner, 2026-08-12: *"LIVE REEL is not relavant with us, dont write this options on anywhere"*.

The app mock was a screenshot of another product and carried a POST/STORY/REEL/LIVE strip.
It has been removed from the visual guide and the rule is written into `WallPosts.tsx` so it
does not get copied back in. Photos and Stories are the whole surface.

---

## What shipped for the App (all byte-verified on `main`)

| SHA | What |
|---|---|
| `29b3aa0` | picked photos become real `File`s for the upload path |
| `ebc2675` | tripwire: fail when a module has no production importer |
| `3333870` | two-screen New post — Android's picker, then caption + categories + Share |
| `0fb101b` | Android CI: install `@capacitor/camera`, build a sideloadable debug APK |

(Evening session added 12 more commits through `1fcd745` — full table in
`claude/SESSION_COMPLETE_BUILD80_2026-08-12.md`.)

Verified byte counts: `WallPosts.tsx` 91,612 · `gallery.ts` 7,729 ·
`nativeGalleryWired.test.ts` 7,103.

### Owner's decision: Option A, Android's own picker

Presented as two options; owner chose **A**.

- **A (chosen)** — `@capacitor/camera` `pickImages()`. Android draws the picker. On Android 13+
  this needs **no permission and no Play declaration** — the route Google actively recommends.
- **B (rejected)** — `@capacitor-community/media` to enumerate the library and draw our own grid.
  Matches the mock exactly but needs `READ_MEDIA_IMAGES`, a Play justification form, and a
  permission-refused fallback.

Consequence, accepted knowingly: screen 1 is Android's UI, so no Recents ▾ album dropdown.
Drafts moved onto the feed row and screen 2.

### The app flow now

1. Tap the composer row (or the photo icon) → **Android's picker** opens immediately.
2. Cancel → **nothing opens**. No half-composer stranded on screen.
3. Pick → **New post**: photo, "Add a caption…", Tag people ›, audience ›, scheduling ›,
   **category chips inline (Option B placement)**, Save draft, full-width **Share**.

Web is untouched: still the three-step Create post → Post settings modal.

---

## TWO DEAD MODULES FOUND — and the guard that now prevents a third

Both were written, unit-tested, reviewed and merged — **and imported by nothing.**

1. `src/components/post/CreatePostModal.tsx` — the entire three-step Create post screen. Vite
   tree-shakes unreferenced modules, so it never entered the bundle. The owner saw a 46-chip
   grid dumped on the feed and said *"Bloody fucker, Where is the change ??"*. Tests were green
   the whole time.
2. `src/lib/native/gallery.ts` — the Android photo path. Zero callers, **and** `@capacitor/camera`
   was not installed by the CI job at all, so `window.Capacitor.Plugins.Camera` was `undefined`
   in every APK ever built. The app was using the WebView's plain `<input type="file">`.

**The lesson is not "be more careful".** A green test suite proves a module works, not that
anything renders it. Import-count was the missing assertion, so `nativeGalleryWired.test.ts`
now asserts it: every module in `mustBeReachable` must have at least one **non-test** importer.
Tests are excluded from the count deliberately — both dead modules were imported by their own
tests and nothing else, which is exactly the state that must fail.

If you delete a feature on purpose, delete its entry from that list too. That is the moment to
notice the module is dead and should go.

---

## Gates

- Typecheck clean · `vite build` clean.
- **1,305 tests pass** (evening count; was 1,297 — +6 guard tests, +2 fixed stale
  assertions in `complete-round-progression-decisions.spec.ts`, which now PASSES).

---

## Getting it onto a phone

CI builds an **AAB, which cannot be sideloaded** — it is a publishing format Play unpacks into
per-device APKs. So `android-build.yml` now also runs `assembleDebug` and uploads
**`app-debug-apk-SIDELOAD-THIS`** as a workflow artifact. Debug variant on purpose: a release
APK is unsigned unless the keystore secrets are set and Android refuses to install unsigned
APKs; the debug variant is self-signed with the standard debug key. Testing only — never to Play.

Both APK steps are `continue-on-error` so a debug-variant problem can never block the release
bundle.

Pushing the workflow file **triggers the Android build** (the workflow watches its own path).
Play upload step is still gated on `PLAY_SERVICE_ACCOUNT_JSON`, which is not set —
**owner downloads the AAB from Actions and uploads to Play manually** (his explicit choice).

---

## Standing constraints (unchanged)

- `git push` is proxy-blocked (403). Every file goes through GitHub's web Upload page and
  **must be byte-verified** (gzip+base64 chunks → `DecompressionStream` → SHA-256).
  This run caught a **corrupted chunk in transit** — chunk 2 of `WallPosts.tsx` arrived with the
  right length and the wrong contents. The per-chunk rolling hash found it. Do not skip that step.
- Owner reviews SQL; only the owner uploads App builds.
- It is a **live site**.
- ❌ Guesswork ❌ Assumptions ❌ Implicit behavior ❌ Hidden operations ❌ Auto-fix behavior.
- Hashtags and `post_tags` people-tagging untouched.
- NEVER handle keystore files, passwords, or the Play service-account JSON — owner's domain.
