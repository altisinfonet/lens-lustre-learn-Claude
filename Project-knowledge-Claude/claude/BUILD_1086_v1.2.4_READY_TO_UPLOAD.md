# Build 1086 / v1.2.4 — green, ready for you to upload

**Run:** Android Build **#86** · commit `86afb8d` · 7m 3s · **Success**
https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31764901932

**versionCode 1086** (1000 + run number) · **versionName 1.2.4**
Live production before this is 1073 / 1.2.2.

## Artifacts

| Artifact | Size | Use |
|---|---|---|
| `app-debug-apk-SIDELOAD-THIS` | 13.9 MB | **Install this on a phone first.** |
| `app-release-aab` | 8.42 MB | Upload to Play **after** the phone check. |

## What passed

Security gate (0 critical / 0 high) → typecheck → 1,335 tests → build →
Capacitor pin verification (a step that *fails* the build if a pin did not
take) → APK content proof (the app and the plugin are really inside the
binary) → AAB.

Two runs appear in the list. **#85 was cancelled** — it was a duplicate fired
by the version-bump commit. **#86 is the one to use**, and it has the higher
versionCode, so Play will accept it.

## Before you promote to production

Install the debug APK and spend a few minutes on:

1. **Scroll the feed hard, then scroll back up.** `FeedCardWindow` is new
   hand-rolled code. Watch for blank cards or the scroll position jumping.
2. **Author names and avatars** — they should appear with the post, never as
   a placeholder.
3. **Type a comment and edit one.** Text must not reverse.
4. **Categories** and the **contributor score** still render.
5. **Like a post** — the count must go up by exactly one.

If all five are clean, upload the AAB.

## What is NOT in this build

- The Instagram-style in-app photo picker — picker screens are unchanged.
- The image derivative pipeline — phones still download originals.
- Resumable / chunked uploads.

Full build notes are in `ANDROID_BUILD_TRIGGER` at the repo root.

## Known warnings (not blockers)

- `ANDROID_KEY_ALIAS` does not name any alias in the keystore, so CI falls
  back to the keystore's own single alias `upload` — which is what every
  build up to 75 effectively did. Harmless; worth fixing at leisure.
- Node.js 20 deprecation notices from GitHub's own actions, and
  `setup-java@v4` deprecation. Neither affects the artifact.
