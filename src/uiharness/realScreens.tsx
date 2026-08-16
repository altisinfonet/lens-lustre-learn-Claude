/**
 * THE REAL SCREENS — the gap the owner asked about, closed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything in `scenes.tsx` mounts ONE component with invented props. That
 * catches a component's own faults and nothing else. These scenes mount the
 * PAGES a member actually opens — the real `Feed`, the real `Profile`, the
 * real `PostDetail` — inside the real `Layout`, with the real providers, fed by
 * the deterministic fake backend in `fakeBackend.ts`.
 *
 * WHAT THIS CAN PROVE: that the real screen, at 360px, with realistic and
 * deliberately awkward data, does not overflow, clip text, hide a control off
 * the side, leave a tap target under 44px, or throw while rendering.
 *
 * WHAT IT STILL CANNOT PROVE, and no screenshot in a container ever will:
 * that the real query returns those rows, that the WebView behaves like desktop
 * Chromium, that a gesture works in a hand, that a push notification arrives.
 * Those remain device questions and stay on the owner's worksheet. The line is
 * in docs/ui-checking-policy.md and it does not move because a new tool arrived.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Suspense, lazy, type JSX } from "react";
import AppShell from "./AppShell";
import { posts, HARNESS_USER_ID } from "./fixtures";
import { unmatched } from "./fakeBackend";

/**
 * Pages are lazy in App.tsx and are imported the same way here, so a scene
 * exercises the same chunk boundary the app does. `Suspense` is the harness's
 * own, with a fallback that is deliberately UGLY: if a screenshot ever catches
 * it, it must be unmistakable rather than looking like a designed empty state.
 */
const Login = lazy(() => import("@/pages/Login"));
const Feed = lazy(() => import("@/pages/Feed"));
const Profile = lazy(() => import("@/pages/Profile"));
const PostDetail = lazy(() => import("@/pages/PostDetail"));
const NotificationSettings = lazy(() => import("@/pages/NotificationSettings"));
const PublicProfile = lazy(() => import("@/pages/PublicProfile"));

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-red-950 text-lg font-bold text-red-200">
      HARNESS: this screen never finished loading
    </div>
  );
}

/**
 * A visible tally of everything the fake backend could not answer.
 *
 * The console already carries it and the capture sweep already counts console
 * errors — but a banner in the PICTURE means the person looking at the
 * screenshot cannot mistake a data-starved screen for an empty one. That
 * mistake is the single most likely way this whole harness could lie.
 *
 * It renders after the page, on top, and is not interactive, so it cannot
 * change the layout underneath it.
 */
function MissingDataBanner() {
  if (unmatched.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[99999] bg-red-700 px-3 py-2 text-[11px] font-semibold leading-tight text-white"
      data-testid="harness-missing-data"
    >
      HARNESS: {unmatched.length} request(s) had no fixture — this screen is missing data:{" "}
      {unmatched.slice(0, 3).join(" · ")}
    </div>
  );
}

function screen(node: JSX.Element, route: string, path = "*", withLayout = true) {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <AppShell route={route} path={path} withLayout={withLayout}>
          {node}
        </AppShell>
      </Suspense>
      <MissingDataBanner />
    </>
  );
}

export const REAL_SCREENS: Record<string, () => JSX.Element> = {
  /**
   * Signed OUT — see sceneConfig.ts. The one screen every member meets, and
   * the one where a 360px fault (a field under the keyboard, a link off the
   * edge) costs an account rather than a scroll.
   */
  "screen-login": () => screen(<Login />, "/login", "/login", false),

  /** The main feed, signed in, with the awkward fixture set. */
  "screen-feed": () => screen(<Feed />, "/feed", "/feed"),

  /** The ACCOUNT screen — About | Settings. Not the wall; see below. */
  "screen-profile": () => screen(<Profile />, "/profile", "/profile"),

  /**
   * THE WALL — Wall | Works | About, the photo grid, the Grid/Feed toggle.
   *
   * ADDED 2026-08-16, and its absence was a real hole. The owner sent a
   * screenshot of this page asking for the Instagram header, and I changed
   * `Profile.tsx` instead — the account screen, which shares neither its tabs
   * nor its content. Nothing caught that, because THIS PAGE HAD NO SCENE: the
   * sweep had never rendered it, on any width, in any mode.
   *
   * `screen-profile` being named "My Wall" in its old comment is very likely
   * how I talked myself into it. The two names are now accurate.
   */
  "screen-wall": () =>
    screen(<PublicProfile />, `/profile/${HARNESS_USER_ID}`, "/profile/:userId"),

  /**
   * SOMEONE ELSE'S WALL — the visitor view, and the ONLY place the Follow /
   * Add Friend / Message row exists.
   *
   * ADDED 2026-08-16 because the owner asked "Where is add frind Follow
   * button ??" and neither of us could answer from a screenshot: every wall
   * scene so far has been HIS OWN profile, where `isOwner` hides that entire
   * row. So the row had never been photographed once, and it was still
   * wearing 9px uppercase tracked text in a bordered pill.
   *
   * A second user id is all it takes. The lesson is the same one the app-mode
   * gap taught: a scene that only covers the happy path you happen to be
   * standing in is a scene that certifies half the screen.
   */
  "screen-wall-visitor": () =>
    screen(<PublicProfile />, "/profile/22222222-2222-4222-8222-222222222222", "/profile/:userId"),

  /** One post, open, with comments. `path` carries the id or the page
   *  renders its not-found state and photographs as a tidy empty screen. */
  "screen-post-detail": () =>
    screen(<PostDetail />, `/post/${posts[0].id}`, "/post/:postId"),

  /** Settings — long forms, switches, and the tap-target rule. */
  "screen-notification-settings": () =>
    screen(<NotificationSettings />, "/settings/notifications", "/settings/notifications"),
};
