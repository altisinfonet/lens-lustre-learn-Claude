# D2 · video-player-meta (2026-10-18)

The Owner tested Android app 1.2.23 on his phone. Video plays after a tap. He reported two problems:

1. The progress bar must work like Meta's: thin, translucent and hidden until a tap.
2. The video must autoplay in the app, with sound, like the Instagram app.

Branch `d2/video-player-meta-20261018`, based on `origin/staging` 61bad639 (#447).

## Why autoplay did not start in the app: what is proven, and what is not

| Candidate | Verdict | Evidence |
|---|---|---|
| WebView `setMediaPlaybackRequiresUserGesture` | **Ruled out.** Capacitor 8.5.0 already sets it to `false` (Bridge.java:586), and android-build.yml does not override it. | `capacitor-8.5.0-Bridge.initWebView.txt`; `grep` of android-build.yml found no WebView setting |
| play() called before `muted` is set | **Ruled out as the cause.** React sets the property at mount, and staging autoplays muted in Chromium (`journey-staging-61bad639*.json`, E_autoplay_without_tap = true). It is now set directly before every play() call anyway. | journey |
| IntersectionObserver threshold | **Ruled out off-device.** Staging autoplays in a 420×900 viewport. | journey |
| hls.js attach/play timing | **Not the path the app takes**, as the next row shows. | — |
| **The app takes the platform's own HLS player, and a refused play() was swallowed** | **Proven in code and in Chromium's source.** Chromium registers the HLS MIME types whenever its HLS demuxer is built in. `enable_hls_demuxer = proprietary_codecs`, which is true for Chrome and WebView builds. So the Android WebView answers `canPlayType("application/vnd.apple.mpegurl")` with `"maybe"`. FeedVideoCard checked canPlayType **before** hls.js, so in the app it set `v.src = master.m3u8` on a `preload="none"` element and called play() in the same task. `catch {}` then turned **any** refusal into the Play button, with no retry and no log (staging FeedVideoCard.tsx lines 109–111 and 156–164). Even Playwright's Chromium takes this branch: staging shows `engine` null and src = the .m3u8 URL in both journey modes. | `chromium-mime_util_internal.cc-hls.txt`, `chromium-media_options.gni-hls.txt`, journey JSON `state.videoSrc` |
| The exact DOMException on the Owner's phone | **NOT observed.** There is no device or adb here, and desktop Chromium's native HLS plays the test stream. The card now records the reason in `data-play-error`, `data-engine` and `data-autoplay-hold` (reduced-motion / offline) and logs it with `console.warn`, so the next phone test can read it. If the phone has *Remove animations* switched on, autoplay stays off by the existing reduced-motion rule. | — |

## The fix (src/lib/video/playback.ts, src/components/video/FeedVideoCard.tsx — the one player)

- **Engine:** hls.js is used whenever the browser has MSE. That covers the Android app, so it takes the same path as every browser journey. The platform's own player is used only on Apple WebKit, or where there is no MSE (`pickHlsEngine`).
- **Start (`startPlayback`):** `muted` is set before play(). If sound is refused, the video starts again muted. An AbortError gets one more try on `canplay`. Only after that does the Play button appear, with the reason kept.
- **Sound (`autoplayWithSound`):**
  - **App:** sound is on by default. Muting is remembered for the session.
  - **Web:** autoplay is muted. The member's first unmute is remembered for the session (sessionStorage, guarded). Later videos start with sound once `navigator.userActivation.hasBeenActive`. If the browser refuses sound, the video falls back to muted.
- **Playback rules (unchanged):** one video at a time, and a pause when the tab or app is hidden. Pausing on `pagehide` was added.
- **Controls:** hidden by default. A tap on the picture shows them, and they fade after 2.5 s while the video plays. The progress bar is 3 px and `bg-white/30`/`/80`, with a 44 px invisible range input on top. The buttons are 44 px and keep their aria-labels. The mute button changes only the sound.
- **android-build.yml:**
  - versionName is 1.2.24, because 1.2.23 is spent (versionCode 1126).
  - A new step asserts that Capacitor's Bridge.java still contains `setMediaPlaybackRequiresUserGesture(false)` and that nothing sets it to `true`. It passed on the real 8.5.0 source and failed on a copy doctored to `true` (`workflow-assert-*.log`).

## Fail-first (new tests run against staging 61bad639: `fail-first-staging-61bad639.txt`)

- **`playbackSound.test.ts`:** 22 of 23 fail on staging. These rules do not exist there. The one-at-a-time test already passed.
- **`FeedVideoCard.meta.test.tsx`:** 11 of 12 fail on staging, on behaviour. The card autoplays muted in the app, takes the native branch, has no retry, has no hidden-by-default controls and has no 44 px targets. Muted web autoplay already passed.
- **Journey** (`tools/uishot/app-video-cors-journey.mjs`, extended with E and F and a real VP9 fMP4 HLS stream encoded in-browser):
  - On staging, these checks fail in both modes: `E_app_autoplays_with_sound`, `F_controls_hidden_by_default`, `F_tap_shows_controls` and `F_controls_fade_again`. `E_autoplay_without_tap` passes on staging in desktop Chromium, for the reason given in the table above.
  - With the fix, all checks pass in both modes (`journey-fix.json`, `journey-fix-plain.json`, with screenshots).

## Size (P13)

The entry chunk grew from 1,709,813 B to 1,713,480 B, which is **+3,667 B**. That is under the 1,754,112 B ceiling, with 40,632 B of headroom left (`budget-*.txt`, same env for both builds).
