/**
 * L1 · THE NAVIGATION HARNESS — navharness.html, driven by
 * tools/uishot/nav-harness.mjs in Chromium, Chrome, Edge, Firefox and WebKit.
 *
 * The REAL Feed and the REAL PostDetail inside the REAL Layout (which mounts
 * the one CommentsOverlay), fed by the harness fake backend — on the page's
 * REAL history stack (`AppShell history="browser"`), so the browser's own
 * Back/Forward are what is measured. F-REV4-7 lived entirely in how many
 * history entries exist and where Back lands; a MemoryRouter cannot show that.
 *
 * `?start=<path>` is where the journey begins. The page is served as
 * /navharness.html, so the start path is written into the address bar with
 * replaceState BEFORE the router mounts; every move after that is the app's
 * own pushState, so the dev server never has to serve /feed or /post/<id>.
 *
 * `/below` is a stand-in for "the page the member came from": a plain page
 * with in-app links, so "Back lands on the page below" is observable. `/` is a
 * stand-in for the app's start screen (a cold start). The links on /feed stand
 * in for the notification bell (an in-app navigate to /post/<id>, exactly what
 * getNotifLink returns); `window.__nav.navigate` does the same without a click,
 * so a journey can leave the feed WITHOUT scrolling it (a click scrolls its
 * target into view, which would spoil a scroll measurement).
 *
 * `?native=1` (navharness.html's stub) makes the app believe it is the Android
 * APK: the REAL PushNotificationsGate registers its tap listener and the REAL
 * AndroidBackButton its `backButton` listener, and the stub hands both to the
 * journey as `window.__navNative.tap(data)` / `.pressBack()`. It is a stub, not
 * a phone: it proves the ROUTING of a tap and of Back, not the gesture's feel.
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy, useEffect } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { installFakeBackend, type FakeRoute } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import { posts } from "../fixtures";
import PushNotificationsGate from "@/components/PushNotificationsGate";
import { Toaster } from "@/components/ui/toaster";
import "../../index.css";

if (!import.meta.env.DEV) throw new Error("navigation harness is development-only");

/**
 * L1 · B1 — THE FAKE FEED DEALS BY SEED, AS THE REAL ONE DOES.
 *
 * The shared fixture answers `get_broadcast_feed` with the same fixed list
 * whatever it is asked, so a feed that was RE-DEALT behind the member's back
 * looked identical to one that was kept — and "Back restores the scroll
 * offset" passed while the member landed on posts they had never seen (PR #434
 * review, B1). Here, as in production, each new `_session_seed` is a new deal:
 * the n-th distinct seed this page has been asked for rotates the posts by n,
 * so a new seed never puts first the post the previous seed put first. The same seed always
 * gives the same order (load more, a refetch of a held page). Like the real
 * function it never deals a post the session has already been handed
 * (`_exclude_ids`), so the short fixture feed ENDS instead of loading the same
 * three posts forever (a feed that never stops loading is a page whose "what
 * is on screen" can never be read).
 *
 * Only this harness: the screenshot gate's scenes keep the fixed order (a seed
 * is random per refresh, and a screenshot must be the same every run).
 */
const seedOrder = new Map<string, number>();
/** S6-a · get_feed_page's server-side delivery log: session → ids dealt, in order. */
const deliveryLog = new Map<string, string[]>();
const dealBySeed: FakeRoute = ({ method, path, body }) => {
  const cursor = path === "/rest/v1/rpc/get_feed_page";
  if (method !== "POST" || (!cursor && path !== "/rest/v1/rpc/get_broadcast_feed")) return undefined;
  const seed = String((body as { _session_seed?: unknown } | null)?._session_seed ?? "hour");
  if (!seedOrder.has(seed)) seedOrder.set(seed, seedOrder.size);
  const n = seedOrder.get(seed)! % posts.length;
  const w = window as unknown as { __navDeals: number; __navFeedCalls?: number };
  w.__navDeals = seedOrder.size;
  w.__navFeedCalls = (w.__navFeedCalls ?? 0) + 1;
  const req = (body ?? {}) as { _exclude_ids?: string[] | null; _limit?: number; _after?: number };
  const after = Number(req._after ?? 0);
  const held = cursor ? (deliveryLog.get(seed) ?? []).slice(0, after) : [];
  const exclude = new Set(cursor ? held : req._exclude_ids ?? []);
  const dealt = [...posts.slice(n), ...posts.slice(0, n)].filter((p) => !exclude.has(p.id));
  const page = dealt.slice(0, Number(req._limit ?? dealt.length));
  if (!cursor) return { body: page };
  deliveryLog.set(seed, [...held, ...page.map((p) => p.id)]);
  return { body: page.map((p, i) => ({ source: null, caught_up_after: false, ...p, feed_pos: after + i + 1 })) };
};
installFakeBackend({ routes: [dealBySeed, ...fixtureRoutes], signedIn: true });

const start = new URLSearchParams(window.location.search).get("start") || "/below";
window.history.replaceState(null, "", start);

const POST_ID = posts[0].id;
type NavHandle = { postId: string; navigate?: (to: string) => void };
const handle: NavHandle = { postId: POST_ID };
(window as unknown as { __nav: NavHandle }).__nav = handle;

const AppShell = lazy(() => import("../AppShell"));
const Feed = lazy(() => import("@/pages/Feed"));
const PostDetail = lazy(() => import("@/pages/PostDetail"));

/** Hands the router's own `navigate` to the journey — an in-app PUSH with no click. */
const Bridge = () => {
  const navigate = useNavigate();
  useEffect(() => {
    handle.navigate = (to: string) => navigate(to);
  }, [navigate]);
  return null;
};

const Links = () => (
  <nav data-testid="harness-links" style={{ display: "flex", gap: 16, padding: 8 }}>
    <Link to="/feed" data-testid="to-feed">Go to the feed</Link>
    <Link to={`/post/${POST_ID}`} data-testid="to-post">Open the post (as the notification bell does)</Link>
  </nav>
);

/**
 * ONE splat route whose element never unmounts, with the pages nested inside —
 * so Bridge and PushNotificationsGate are mounted once for the whole journey,
 * as App.tsx mounts the gate once for the whole app. `Toaster` is the app's
 * own (App.tsx mounts it; AppShell does not), so a notice can be SEEN.
 */
const Pages = () => (
  <>
    <Bridge />
    <PushNotificationsGate />
    <Toaster />
    <Routes>
      <Route path="/" element={<main data-testid="app-start"><h1>App start</h1><Links /></main>} />
      <Route path="/below" element={<main data-testid="below"><h1>The page below</h1><Links /></main>} />
      <Route path="/feed" element={<><Links /><Feed /></>} />
      <Route path="/post/:postId" element={<PostDetail />} />
    </Routes>
  </>
);

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading harness…</p>}>
    <AppShell history="browser" routes={[{ path: "*", element: <Pages /> }]} />
  </Suspense>,
);
