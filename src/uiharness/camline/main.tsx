/**
 * CAMERA LINE VISUAL HARNESS (development only) — camlineharness.html.
 *
 * The REAL PostCard (the feed card the website and the app both use) with the
 * REAL CSS, against the harness fake backend: the switch photo_set_v2 on, one
 * post with camera details (a Nikon as live stores it) and one without. It is
 * what tools/uishot/camline-visual.mjs photographs and compares with the
 * Owner-approved baseline PNGs (tools/uishot/camline-baseline/), so the screen
 * the Owner approved is the screen that ships.
 *
 *   ?post=a|b    a = with camera details, b = a new photo with none
 *   ?admin=1     the viewer is a site admin (user_roles role = admin)
 *   ?app=1       the Android shell (window.Capacitor, set before the app loads)
 *   ?w=phone     a 390 px card (else 560 px, the desktop feed column)
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy } from "react";
import { installFakeBackend, HARNESS_USER_ID, type FakeRoute } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import "../../index.css";
import { CommentsOverlayProvider } from "@/contexts/CommentsOverlayContext";
import type { UnifiedPost } from "@/types/post";

if (!import.meta.env.DEV) throw new Error("camera line harness is development-only");

const q = new URLSearchParams(location.search);
// ?off=1 — the switch photo_set_v2 OFF (as on live since 3 Nov): no camera line at all.
(globalThis as { __harnessFeatures?: string[] }).__harnessFeatures = q.get("off") === "1" ? [] : ["photo_set_v2"];
if (q.get("admin") === "1") (globalThis as { __harnessRoles?: string[] }).__harnessRoles = ["admin", "member"];
if (q.get("app") === "1") {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
}

/**
 * A NEW (v2, `-l4`) photo, so the card takes the real v2 path: its 600 / 1080
 * copies in the feed, and the line's height held while its camera details are
 * read. The host is not real — tools/uishot/camline-visual.mjs answers every
 * copy with a fixed picture (a grey wall and a red floor, as in the mockup).
 */
const photo = (seg: string) => `https://cdn.harness.test/post-images/u1/posts/${seg}-w1200h800-l4.webp`;

/** What live stores for a Nikon today (EXIF Make + Model joined at upload). */
const NIKON = { camera: "NIKON CORPORATION NIKON Z 6_2", lens: "NIKKOR Z 24-70mm f/4 S", focal_length: 24, aperture: 7.1, shutter: "1/125", iso: 5000, taken_at: "2023-04-08T10:00:00" };
const WITH = "aaaaaaaa-0000-4000-8000-000000000001";
const WITHOUT = "aaaaaaaa-0000-4000-8000-000000000002";
const AUTHOR = "22222222-2222-4222-8222-222222222222";

const camera: FakeRoute = ({ method, path, body }) => {
  if (method === "POST" && path === "/rest/v1/rpc/post_photo_camera_for") {
    const ids = (body as { p_post_ids?: string[] } | null)?.p_post_ids ?? [];
    return { body: ids.includes(WITH) ? [{ post_id: WITH, ord: 0, info: NIKON, hidden: false }] : [] };
  }
  return undefined;
};
installFakeBackend({ routes: [camera, ...fixtureRoutes], signedIn: true });

/** 21 minutes old, as in the Owner's screenshot — "21m" whatever the clock says. */
const post = (id: string, content: string, img: string) =>
  ({
    id, user_id: AUTHOR, content, image_url: img, image_urls: [img], thumbnail_urls: [img],
    created_at: new Date(Date.now() - 21 * 60_000).toISOString(), privacy: "public", like_count: 12, comment_count: 3, share_count: 0,
    author_name: "Dipannita Sen", author_handle: "dipannita", author_avatar: null, user_reaction: null, reaction_counts: { like: 12 }, tagged_people: [],
  }) as unknown as UnifiedPost;

// ?post=c — an ALBUM of three photos (the slider dots), with camera details on photo 1.
const album = (): UnifiedPost => {
  const imgs = ["1762000000000-prayer", "1762000000000-river", "1762000000000-prayer2"].map(photo);
  return { ...post(WITH, "Three frames", imgs[0]), image_urls: imgs, thumbnail_urls: imgs } as UnifiedPost;
};
const p = q.get("post") === "c" ? album() : q.get("post") === "b"
  ? post(WITHOUT, "Evening by the river", photo("1762000000000-river"))
  : post(WITH, "After the Prayer", photo("1762000000000-prayer"));
const phone = q.get("w") === "phone";

const AppShell = lazy(() => import("../AppShell"));
const PostCard = lazy(() => import("@/components/post/PostCard"));

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading…</p>}>
    <AppShell route="/feed" path="/feed" withLayout={false}>
      <CommentsOverlayProvider>
        <div id="cardwrap" style={{ width: phone ? 390 : 560, margin: phone ? "0" : "16px auto", background: "hsl(var(--card))" }}>
          <PostCard post={p} currentUserId={HARNESS_USER_ID} onReact={() => {}} onUnreact={() => {}} />
        </div>
      </CommentsOverlayProvider>
    </AppShell>
  </Suspense>,
);
