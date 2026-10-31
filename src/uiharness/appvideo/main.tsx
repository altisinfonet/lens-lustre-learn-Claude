/**
 * The app-video CORS journey's page (tools/uishot/app-video-cors-journey.mjs).
 *
 * BUILT, not served by the dev server: the journey runs `vite build` on it and
 * serves the bundle from https://localhost — the origin the Android app's
 * WebView has (capacitor.config.ts, androidScheme "https") — with the
 * Capacitor bridge present, exactly as inside the app. It shows:
 *   · the REAL FeedVideoCard for one video (play token → hls.js source,
 *     muted autoplay when in view), and
 *   · the REAL site-settings read (siteSettingsCache → /config/site-settings),
 *     the other Pages Function the app calls.
 * Nothing here knows where the API lives: that is the code under test.
 */
import { createRoot } from "react-dom/client";
import FeedVideoCard from "@/components/video/FeedVideoCard";
import { getSiteSetting } from "@/lib/siteSettingsCache";
import { postMedia } from "@/lib/posts/subjectMedia";
import "../../index.css";

// The bridge Capacitor injects before any app code runs (deliberately minimal,
// like src/uiharness/main.tsx's).
(window as unknown as { Capacitor: unknown }).Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => "android",
  Plugins: {},
};

// hasAudio: the app plays it WITH sound (Owner 2026-10-18) — the journey checks the element is unmuted.
const VIDEO = { id: "33333333-3333-4333-8333-333333333333", width: 720, height: 1280, durationS: 6, hasAudio: true };
/** The same path every real surface takes (sameMediaEverywhere.test.ts). */
const media = postMedia({ video: VIDEO, image_urls: [], image_url: null });

function Page() {
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 16 }}>
      <p data-testid="site-setting">loading</p>
      {media.video && <FeedVideoCard video={media.video} />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);

void getSiteSetting("journey_marker").then(
  (v) => { document.querySelector("[data-testid=site-setting]")!.textContent = `setting:${JSON.stringify(v)}`; },
  (e) => { document.querySelector("[data-testid=site-setting]")!.textContent = `error:${String(e)}`; },
);
