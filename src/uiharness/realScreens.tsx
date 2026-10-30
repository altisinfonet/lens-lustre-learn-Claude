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
import { posts, HARNESS_USER_ID, dashboardInit } from "./fixtures";
import { mapSidebarVotingEntriesToVotingPhotos } from "@/lib/competitionVotingPhotos";
import { unmatched } from "./fakeBackend";
import { ServerJobsTray } from "@/components/video/ServerVideoJobs";
import { serverJob } from "./serverVideoFixtures";

/**
 * Pages are lazy in App.tsx and are imported the same way here, so a scene
 * exercises the same chunk boundary the app does. `Suspense` is the harness's
 * own, with a fallback that is deliberately UGLY: if a screenshot ever catches
 * it, it must be unmistakable rather than looking like a designed empty state.
 */
const Login = lazy(() => import("@/pages/Login"));
/** The home page (/home for a signed-in member) — where "Ask anything" lives. */
const Index = lazy(() => import("@/pages/Index"));
const Feed = lazy(() => import("@/pages/Feed"));
const Profile = lazy(() => import("@/pages/Profile"));
const PostDetail = lazy(() => import("@/pages/PostDetail"));
const NotificationSettings = lazy(() => import("@/pages/NotificationSettings"));
const PublicProfile = lazy(() => import("@/pages/PublicProfile"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const CustomUrlProfile = lazy(() => import("@/pages/CustomUrlProfile"));
const MobileProfileSheet = lazy(() => import("@/components/MobileProfileSheet"));
/*
 * F-98c — THE FIVE PAGES THIS HARNESS WAS BLIND TO.
 *
 * Before 2026-09-05 the harness had 42 scenes and they covered SIX routes:
 * /login, /feed, /profile, the wall, post detail and /settings/notifications.
 * The auditor counted dead member names on the deployed site name by name and
 * got /notifications 20, /owen.blake 7, /feed 7, /discover 6, /friends 6,
 * /dashboard 6, /winners 6. Only /feed and the wall were inside the 42, so a
 * full sweep reading "0 dead" was true and meaningless — a floor, never a pass.
 * These five close that, and they are added for exactly that reason.
 */
const Notifications = lazy(() => import("@/pages/Notifications"));
const Friends = lazy(() => import("@/pages/Friends"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Winners = lazy(() => import("@/pages/Winners"));
const Discover = lazy(() => import("@/pages/Discover"));
const CompetitionLightbox = lazy(() => import("@/components/CompetitionLightbox"));
/* P23 S10a-2 — the three a11y-only surfaces (see A11Y_ONLY_SCREENS below). */
const Signup = lazy(() => import("@/pages/Signup"));
const EditProfile = lazy(() => import("@/pages/EditProfile"));
const AdminPanel = lazy(() => import("@/pages/AdminPanel"));

/**
 * The voting lightbox, open, on the first fixture photograph. The images are
 * mapped through the SAME function the app uses (mapSidebarVotingEntriesToVotingPhotos)
 * from the SAME fixture rows the sidebar reads, so if that mapper stops carrying
 * photographerHandle this scene goes dead where a probe can see it.
 */
function VotingLightboxScene() {
  const images = mapSidebarVotingEntriesToVotingPhotos(dashboardInit.sidebar.voting_thumbnails, {
    sort: false,
  });
  return (
    <CompetitionLightbox
      images={images}
      currentIndex={0}
      isOpen
      onClose={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
      onVote={() => {}}
      /*
       * NOT "judging". The photographer line is hidden during judging on
       * purpose — anonymised scoring — so a scene set to that phase would
       * render no name at all and report a cheerful zero. "voting" is the
       * phase in which this lightbox actually shows a photographer.
       */
      competitionPhase="voting"
    />
  );
}

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

/**
 * A JOURNEY: several real pages registered at once, starting on one of them.
 *
 * Added 2026-08-16 for the Create-button bug, which does not exist on any
 * single screen — only in the move from one to another. See the note on
 * `AppShellProps.routes` for why that class of fault was invisible here.
 */
function journey(
  routes: Array<{ path: string; element: JSX.Element }>,
  startAt: string,
) {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <AppShell route={startAt} routes={routes} withLayout />
      </Suspense>
      <MissingDataBanner />
    </>
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
   * VID-7 · the same wall with `video_posts` switched ON for this member: the
   * "Add video" button appears beside "Add photo" (and only then — with the
   * switch Off, "screen-wall" above is unchanged). Set before the first render,
   * so the fixture answers true on the first ask.
   */
  "screen-wall-video-on": () => {
    (globalThis as { __harnessFeatures?: string[] }).__harnessFeatures = ["video_posts"];
    return screen(<PublicProfile />, `/profile/${HARNESS_USER_ID}`, "/profile/:userId");
  },

  /**
   * THE ABOUT TAB — added 2026-08-16, and it had never been photographed.
   *
   * `activeTab` starts at "wall", so every screenshot of this page for the
   * whole life of this harness has been the photo grid. The owner sent a
   * picture of THIS tab — "structure is very poor, not alignment, placing
   * fitting all bad use icon and less wasting space no use border" — and there
   * was no way to render it here to check the work against him.
   *
   * `?section=about` is what makes it reachable, and it earns its place in the
   * product too: About was reachable only from the ⋮ menu, so nothing could
   * ever link to it.
   */
  "screen-wall-about": () =>
    screen(
      <PublicProfile />,
      `/profile/${HARNESS_USER_ID}?section=about`,
      "/profile/:userId",
    ),

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

  /**
   * THE 404, SIGNED IN AND SIGNED OUT — added 2026-09-05 for F-89.
   *
   * It had never been photographed once, which is how it shipped rendering
   * inside the two-column feed shell with a "Sign Up Free" sidebar on one side
   * and "Learn Photography" on the other, wrapped around a dead end. The
   * Owner's verdict was "nonsense design, worthless".
   *
   * BOTH auth states are scenes because the page is auth-aware and the two are
   * genuinely different products: a stranger needs a way to join, a member does
   * not. One scene would certify half of it — the same lesson `screen-wall-visitor`
   * taught when every wall scene had been the owner's own profile.
   *
   * The route is a real dead path, registered against `*` so this is the
   * catch-all case exactly as App.tsx serves it.
   */
  "screen-not-found": () =>
    screen(<NotFound />, "/zzz-definitely-not-a-page-98765", "*"),

  "screen-not-found-signed-out": () =>
    screen(<NotFound />, "/zzz-definitely-not-a-page-98765", "*"),

  /**
   * THE 404 REACHED THE OTHER WAY — IN PLACE, THROUGH CustomUrlProfile.
   *
   * ⚠ NOT THE SAME SCENE AS ABOVE, and the incident that produced it is the
   * reason it exists. The two scenes above register NotFound against `*`, the
   * CATCH-ALL. The path the Owner actually photographed is a SINGLE-SEGMENT
   * url: it matches `/:customUrl`, mounts CustomUrlProfile, resolves nothing,
   * and renders <NotFound /> in place. Two different routes.
   *
   * F-89 shipped green on every check either side of the review and then hung
   * deployed staging in an unbounded remount loop — on this route and only this
   * route, because on the catch-all NotFound is a direct child of the Outlet
   * and nothing above it re-renders. Both instruments drove the catch-all, so
   * both were blind to it. This scene is that blindness closed.
   *
   * `resolve_custom_url` is fixtured empty (fixtureRoutes) so the lookup
   * COMPLETES and fails to match, rather than hanging as it does against a
   * database this container cannot reach.
   */
  "screen-not-found-in-place": () =>
    screen(<CustomUrlProfile />, "/zzz-definitely-not-a-page-98765", "/:customUrl"),

  "screen-not-found-in-place-signed-out": () =>
    screen(<CustomUrlProfile />, "/zzz-definitely-not-a-page-98765", "/:customUrl"),

  /** One post, open, with comments. `path` carries the id or the page
   *  renders its not-found state and photographs as a tidy empty screen. */
  "screen-post-detail": () =>
    screen(<PostDetail />, `/post/${posts[0].id}`, "/post/:postId"),

  /**
   * THE ACCOUNT SHEET, OPEN — added 2026-08-16.
   *
   * Owner, from live members: "the log out screen are not coming perfectly and
   * huge space water in top." Both halves of that are layout, both are provable
   * in a photograph, and neither had ever been photographed: this sheet is an
   * overlay, so no page scene renders it, and it had no scene of its own.
   *
   * It is the single most crowded surface in the product — twenty-one actions
   * plus a header plus a footer — and it is the one screen where being cut off
   * at the bottom means a member cannot LOG OUT.
   */
  "screen-account-sheet": () =>
    screen(<MobileProfileSheet open onOpenChange={() => {}} />, "/feed", "/feed"),

  /**
   * THE CREATE BUTTON, PRESSED FROM THE WALL — the owner's exact complaint.
   *
   * "create post is a static on the top menu bar but while on my or other
   *  pages, trying to uploaded - that is not happening. only from my feed
   *  section create post happening."
   *
   * Two real pages, starting on the wall, so the top bar's `navigate(
   * "/feed?compose=1")` has somewhere to land. Until this existed the
   * navigation went nowhere and the flow could not be observed at all — which
   * is how a fix for it shipped on reasoning alone.
   */
  "journey-create-from-wall": () =>
    journey(
      [
        { path: "/profile/:userId", element: <PublicProfile /> },
        { path: "/feed", element: <Feed /> },
      ],
      `/profile/${HARNESS_USER_ID}`,
    ),

  /** The same press, started from the FEED — the one place he says it works.
   *  Kept beside the wall journey so "works here, not there" is measurable
   *  rather than reported. */
  "journey-create-from-feed": () =>
    journey(
      [
        { path: "/profile/:userId", element: <PublicProfile /> },
        { path: "/feed", element: <Feed /> },
      ],
      "/feed",
    ),

  /** Settings — long forms, switches, and the tap-target rule. */
  "screen-notification-settings": () =>
    screen(<NotificationSettings />, "/settings/notifications", "/settings/notifications"),

  /*
   * ── THE FIVE THAT CARRY THE DEAD NAMES ────────────────────────────────────
   * See the note beside their imports. Each one is a route the auditor counted
   * dead names on and no instrument in this repository could render.
   */

  /** Twenty dead names, the most of any page. Its own defect, not the sidebar's. */
  "screen-notifications": () => screen(<Notifications />, "/notifications", "/notifications"),

  /** Six dead: the People You May Know sidebar, on a page nobody had rendered. */
  "screen-friends": () => screen(<Friends />, "/friends", "/friends"),

  /** Six dead, and the only page that shows the milestone anniversary names. */
  "screen-dashboard": () => screen(<Dashboard />, "/dashboard", "/dashboard"),

  /** Six dead, including the winners card's photographer name (source FIVE-B). */
  "screen-winners": () => screen(<Winners />, "/winners", "/winners"),

  /** Six dead. The page the owner found the regression on. */
  "screen-discover": () => screen(<Discover />, "/discover", "/discover"),

  /**
   * F-98c SOURCE FOUR — THE PHOTOGRAPHER'S NAME, WHERE IT ACTUALLY RENDERS.
   *
   * "by <photographer>" lives in CompetitionLightbox, which exists only after
   * somebody clicks a voting thumbnail. No still screenshot of any scene
   * contained it, so the name could not be walked and source four was
   * UNMEASURED — and the auditor's wire capture showed staging returning
   * voting_thumbnails EMPTY as well, so it could not be observed there either.
   * Two independent reasons it had never been looked at.
   *
   * It is stated plainly rather than glossed: this mounts the real component,
   * inside the real provider stack, with a row shaped exactly as
   * dashboard-init's toVotingPhoto() builds it — but opened DIRECTLY rather
   * than by a click. That is a real limitation of a still-screenshot harness
   * and it is the difference between measuring the component and measuring the
   * journey. It is not a claim that the click works.
   */
  "screen-voting-lightbox": () => screen(<VotingLightboxScene />, "/feed", "/feed"),

  /*
   * ── THE BOTTOM DOCK ON THE HOME PAGE (review of #423, 2026-10-13) ─────────
   * Owner: no overlapping UI. On a phone the server-video card sat over the
   * home page's "Ask anything" button. This is the REAL home page a signed-in
   * member reaches from the bottom bar's Home button — its real Layout, its
   * real "Ask anything" — with the card at the bottom of the app, as
   * VideoUploadBridge draws it. The button must sit ABOVE the card, never
   * under it (src/lib/ui/bottomDock.ts).
   */
  "screen-home-server-card": () => homeWithServerCard(),
  /**
   * The same, with the cookie banner still up — a member's first visit. Three
   * layers at the bottom of one phone screen: the banner, the card above it,
   * the button above both. None may sit on another.
   */
  "screen-home-server-card-consent": () => homeWithServerCard(),
  /**
   * The tightest a phone screen gets: the cookie banner up AND the folded line
   * tapped open. The list takes only the room that is left (it scrolls inside
   * its cap), so "Ask anything" above it is still wholly on the screen.
   */
  "screen-home-server-card-consent-open": () => homeWithServerCard(true),
  /** ONE video, no banner: the full card over the home page, "Ask anything" above it. */
  "screen-home-server-card-single": () => homeWithServerCard(false, 1),
};

/**
 * The card's two commonest states together: an upload under way, and one being
 * prepared. On a phone that is ONE slim line (Owner, 2026-10-13); `open` draws
 * it as it is after a tap, since the harness cannot tap.
 */
function homeWithServerCard(open = false, count = 2) {
  const jobs = [serverJob("up", { step: "source" }), serverJob("prep", { step: "converting" }), serverJob("ready", { step: "review", videoId: "v" })];
  return (
    <>
      {screen(<Index />, "/home", "/home")}
      <ServerJobsTray
        jobs={open ? jobs : jobs.slice(0, count)}
        progress={{ up: 42 }}
        defaultOpen={open}
        onPreview={() => {}} onCancel={() => {}} onDismiss={() => {}}
      />
    </>
  );
}

/**
 * ── P23 S10a-2 · THE THREE A11Y-ONLY SURFACES ───────────────────────────────
 *
 * docs/evidence/d2/phase5/P23/S10a-DECISION.md §2, decision S2. These are three
 * of the ten primary surfaces that had no scene. They are reachable by
 * `?scene=<name>` (main.tsx resolves them) but are deliberately NOT part of
 * `SCENES`, so the harness index does not list them — which keeps them OUT of
 * the visual sweep (capture.mjs reads its scene list from that index) and out
 * of `tools/uishot/baseline.json`. Measured 2026-10-29: all three fail the
 * sweep's 44 px tap-target rule on the phone widths and admin health has no
 * admin-RPC fixtures; clearing that is pixel / fixture work, not P23. Only
 * `tools/uishot/a11y-surfaces.mjs` addresses them, by name. They join the
 * visual sweep in a separate unit (a follow-up of F-103's tap-target ratchet).
 *
 * Each mounts the REAL page, inside the real provider stack, exactly as the
 * `screen-` scenes above do.
 */
export const A11Y_ONLY_SCREENS: Record<string, () => JSX.Element> = {
  /** Signed OUT (sceneConfig.ts) — /signup, mounted the way screen-login is. */
  "screen-signup": () => screen(<Signup />, "/signup", "/signup", false),

  /** /edit-profile, signed in as the harness member. */
  "screen-edit-profile": () => screen(<EditProfile />, "/edit-profile", "/edit-profile"),

  /**
   * /admin/health — the real AdminPanel on its "Site Health" tab, with the
   * harness member seeded as an admin (fixtureRoutes: `__harnessRoles`, read by
   * the dashboard-init fixture only when set). Decision S5: the admin RPCs the
   * tab calls are NOT fixtured — the missing-data banner says so in the
   * picture; the tab's controls (refresh, tabs, actions) render regardless.
   */
  "screen-admin-health": () => {
    (globalThis as { __harnessRoles?: string[] }).__harnessRoles = ["admin"];
    return screen(<AdminPanel />, "/admin/health", "/admin/*");
  },
};
