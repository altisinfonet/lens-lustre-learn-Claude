# PHASE 2 — ANDROID WRITE-PATH CLOSURE (BUILD 1111 / v1.2.16)

**Date:** 2026-08-21 · **Phase 2:** 96%, unchanged until the behavioural acceptance below

## What was diagnosed

The app bundles its web assets at build time (`capacitor.config.ts`: `webDir: 'dist'`,
no `server.url`). Every installed build through 1110 (v1.2.15, cut 2026-08-19)
therefore runs a composer from **before** the write path shipped (2026-08-20 15:51 UTC)
— which is exactly why the 18:16 UTC member post from the app landed legacy-only with
no MEDIA-4xxx trace, and why `delta_growing` flipped TRUE. No app-side code was wrong;
the app was simply frozen in time.

## What was built — ✅ BUILD 1111 / v1.2.16, all gates green

- **PR #84** merged (all 7 CI checks green) → `main` = `9160b75`.
- **android-build run 111**: security gate ✅ → UI gate (reachability + screenshot
  sweep) ✅ → build-aab ✅. Signed release bundle proven signed.
- **versionName 1.2.16** (1.2.15 was spent by build 1110), **versionCode 1111**.
- Carries today's `dist` unchanged from production web: RED-1 fixed at both write
  sites, classified fallback (MEDIA-4009/4010, D-005), RED-2, `__APP_BUILD 2026-08-20-2`.
  No native change.

## ⚠ The one step only you can do — RELEASE IT

The Play upload step was **skipped in run 111 — and in run 110 too**: the
`PLAY_SERVICE_ACCOUNT_JSON` secret has never been set, so auto-publish has never been
active. The established path (as with 1102, which went live) is manual:

1. Open **https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/32438058103**
2. Download the **`app-release-aab`** artifact (8.9 MB, signed).
3. Play Console → 50mm Retina World → Production → Create release → upload → roll out.

**Faster verification, no Play review wait:** the same run has
**`app-debug-apk-SIDELOAD-THIS`** (14.6 MB). Sideload it on any Android device, sign
in, publish one photo — that is the acceptance test, minutes from now instead of after
store review.

(If you add the `PLAY_SERVICE_ACCOUNT_JSON` secret once, every future green build
uploads itself to Play as a production draft automatically — the workflow already
supports it.)

## What "done" means — the acceptance is behavioural

After the new build is on a device and one real photo is posted from the app:

1. the post has `post_media` + `media_objects` rows (I will verify owner, sha256, ord,
   readiness, derived `image_urls`, idempotency_key — same 12-point check as the web
   proof);
2. `delta_growing` returns to **FALSE**.

**Two honest caveats on the delta flag:** (a) the 18:16 legacy post stays inside the
detector's 24-hour window until ~18:16 UTC today, so `delta_growing` can read TRUE
until then even with the fix on devices; (b) members still on old app versions keep
posting legacy-only until they update — a staged rollout means a tail, and the detector
will keep truthfully reporting it. Option available later: that 18:16 post's photo is
already in R2 under the class-A layout, so it is migratable by the existing engine if
you ever want the backlog at zero.

## Sequence status

| step | state |
|---|---|
| fix Android write path | ✅ (it was the bundle age; today's dist carries the fix) |
| build/release Android | ✅ built + signed (run 111) · ⚠ **release = your Play upload** |
| one real Android post | ⏳ waiting on rollout/sideload |
| verify post_media + media_objects | ⏳ I verify the moment a post appears |
| delta_growing = FALSE | ⏳ after acceptance + window ages out |
| D-002/D-003 | unchanged, next after this closes |

Phase 2 remains **96%** until the acceptance post is observed. Phase 3 not started.
