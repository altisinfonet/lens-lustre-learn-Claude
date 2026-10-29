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
import { fixtureImage, posts, postComments, siteSettings } from "../fixtures";
import { notificationEntryState } from "@/lib/navigationContract";
import PushNotificationsGate from "@/components/PushNotificationsGate";
import NotificationBell from "@/components/NotificationBell";
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
/**
 * S4-a · "MORE POSTS FROM <name>" NEEDS AN AUTHOR WITH MORE THAN ONE POST.
 * The shared fixture gives every author exactly one, so here — and only here,
 * the screenshot gate keeps its fixed set — the first post's author has two
 * more (copies of the other fixture posts, re-authored, with their own ids).
 * They are answered for the author's wall read and for their own /post/<id>;
 * they are never dealt into the feed, so every feed journey is unchanged.
 */
const morePosts = posts.slice(1).map((p, i) => ({
  ...p,
  id: `aaaaaaa1-0000-4000-8000-00000000010${i + 1}`,
  user_id: posts[0].user_id,
  created_at: new Date(Date.parse(posts[0].created_at) - (i + 1) * 86_400_000).toISOString(),
}));
const authorWall: FakeRoute = ({ method, path, params }) => {
  if (method !== "GET" || path !== "/rest/v1/posts") return undefined;
  if (params.get("user_id") === `eq.${posts[0].user_id}`) return { body: [posts[0], ...morePosts] };
  const extra = morePosts.find((p) => params.get("id") === `eq.${p.id}`);
  return extra ? { body: extra } : undefined;
};
/**
 * S4-b · A COMMENT NOTIFICATION LANDS ON ITS COMMENT, EVEN DEEP IN A THREAD.
 * The first post's thread is made long here (30 more comments), and the
 * comment a "post_comment" notification names is a REPLY whose parent is not
 * in the first page either: they are answered only when asked for by id —
 * exactly how a comment past the first 200 reaches the screen. The member's
 * own notification rows (user_notifications, RLS-own) carry the dedup_key
 * naming the comment, as the database writes it.
 */
const FAR_PARENT = "ccccccc1-0000-4000-8000-000000000900";
const FAR_REPLY = "ccccccc1-0000-4000-8000-000000000901";
const filler = Array.from({ length: 30 }, (_, i) => ({
  ...postComments[0],
  id: `ccccccc1-0000-4000-8000-000000000${String(100 + i)}`,
  content: `Comment ${i + 1} on the long thread.`,
  created_at: new Date(Date.parse(postComments[0].created_at) + (i + 1) * 60_000).toISOString(),
}));
const farComments = [
  { ...postComments[0], id: FAR_PARENT, content: "An early question, long scrolled away.", created_at: "2026-08-14T04:40:00.000Z" },
  { ...postComments[1], id: FAR_REPLY, parent_id: FAR_PARENT, content: "The answer the notification is about.", created_at: "2026-08-15T09:00:00.000Z" },
];
const longThread: FakeRoute = ({ method, path, params }) => {
  if (method !== "GET" || path !== "/rest/v1/post_comments") return undefined;
  const byId = farComments.find((c) => params.get("id") === `eq.${c.id}`);
  if (byId) return { body: [byId] };
  if (params.get("post_id") === `eq.${posts[0].id}` && !params.has("id")) return { body: [...postComments, ...filler] };
  return undefined;
};
const ownNotifications: FakeRoute = ({ method, path, params }) => {
  if (path !== "/rest/v1/user_notifications") return undefined;
  if (method !== "GET") return { body: [] }; // marking read

  const type = params.get("type");
  if (type === "eq.post_comment") return { body: [{ dedup_key: `post_comment:${FAR_REPLY}:owner` }] };
  if (type === "eq.comment_reply") return { body: [{ dedup_key: `post_comment:${postComments[1].id}:reply` }] };
  return { body: [] };
};
(window as unknown as { __navComments: Record<string, string> }).__navComments = { far: FAR_REPLY, reply: postComments[1].id };

/**
 * S4-c · THE REAL BELL AND THE REAL NOTIFICATIONS PAGE, each holding one comment
 * notification about the first post (the row a member taps). Unread, so the
 * bell has a badge and the tap marks it read, as on a phone.
 */
const BELL_ACTOR = "Noor Abadi";
const commentGroup = {
  group_key: "g-nav-comment",
  type: "post_comment",
  notification_ids: ["nav-n1"],
  actor_ids: ["99999999-9999-4999-8999-999999999999"],
  actor_names: [BELL_ACTOR],
  actor_usernames: [""],
  actor_avatars: [""],
  actor_known: [true],
  actor_count: 1,
  event_count: 1,
  unread_count: 1,
  total_unread: 1,
  reference_id: posts[0].id,
  thumbnail_url: null,
  title: "New Comment",
  message: `${BELL_ACTOR} commented on your post`,
  latest_at: "2026-08-15T09:00:00.000Z",
};
const notificationGroups: FakeRoute = ({ method, path }) => {
  if (method !== "POST") return undefined;
  if (path === "/rest/v1/rpc/get_my_unread_notifications_grouped" || path === "/rest/v1/rpc/get_my_notifications_grouped") {
    return { body: [commentGroup] };
  }
  return undefined;
};
(window as unknown as { __navBellActor: string }).__navBellActor = BELL_ACTOR;

/**
 * ADS BUG 1 (2026-10-29) · THE FEED'S SPONSORED CARD — only with `?ads=…`, so
 * every other journey reads the same feed as before.
 *
 * Production's shape: ads on, the story-card zone has ONE library picture AND
 * a single picture of its own. `?ads=flaky` makes every library read fail (503)
 * for the first 3 s, as a weak or missing network does. Owner, latest Android app: "From
 * Feed ad comment and like section vanished" — the failed read showed the
 * zone's single picture, which has no like / comment bar.
 */
const ADS = new URLSearchParams(window.location.search).get("ads");
const AD_CREATIVE_ID = "adadadad-0000-4000-8000-000000000001";
const adSettings: Record<string, unknown> = {
  ad_zones_v2_enabled: true,
  ad_zones_v2: {
    "story-card": {
      zone: "story-card", mode: "own", devices: ["desktop", "mobile", "tablet"], start_date: "", end_date: "",
      own: { image_source: "upload", image_url: fixtureImage(21, "single"), ad_code: "", click_url: "", alt_text: "Zone single picture",
        creative_headline: "", creative_subtext: "", creative_cta: "" },
      google: { adsense_slot_id: "", adsense_format: "auto", admob_unit_id: "" },
    },
  },
};
let adLibraryReads = 0;
/** `?ads=flaky`: every library read fails for this long after the first one — a weak link, not one lost packet. */
const AD_NETWORK_DOWN_MS = 3000;
let adNetworkDownUntil: number | null = null;
const adsRoute: FakeRoute = ({ method, path, params }) => {
  if (!ADS) return undefined;
  // By table name, as fixtureRoutes.ts answers tables: this ANSWERS requests, it reads nothing.
  const table = path.startsWith("/rest/v1/") ? path.slice("/rest/v1/".length) : "";
  if (method === "GET" && table === "site_settings") {
    const f = params.get("key") ?? "";
    const wanted = f.startsWith("eq.") ? [f.slice(3)] : (f.match(/^in\.\((.*)\)$/)?.[1] ?? "").split(",").map((k) => k.replace(/^"|"$/g, ""));
    const rows = [
      ...siteSettings.filter((r) => wanted.includes(r.key) && !(r.key in adSettings)),
      ...Object.entries(adSettings).filter(([k]) => wanted.includes(k)).map(([key, value]) => ({ key, value })),
    ];
    return { body: rows };
  }
  if (method === "GET" && path === "/rest/v1/ad_creatives") {
    adLibraryReads++;
    (window as unknown as { __adLibraryReads: number }).__adLibraryReads = adLibraryReads;
    if (ADS === "flaky") adNetworkDownUntil ??= Date.now() + AD_NETWORK_DOWN_MS;
    if (adNetworkDownUntil !== null && Date.now() < adNetworkDownUntil) {
      return { status: 503, body: { code: "PGRST000", message: "upstream connect error", details: null, hint: null } };
    }
    return { body: [{ id: AD_CREATIVE_ID, zone: "story-card", image_url: fixtureImage(22, "advert"), click_url: "", alt_text: "Library advert",
      headline: "", subtext: "", cta: "", advertiser_name: null, advertiser_logo_url: null, sort_order: 1 }] };
  }
  if (method === "GET" && path === "/rest/v1/ad_videos") return { body: [] };
  if (method === "POST" && path === "/rest/v1/rpc/get_ad_engagement") return { body: [] };
  if (method === "POST" && path === "/rest/v1/ad_impressions") return { status: 201, body: [] };
  return undefined;
};

installFakeBackend({ routes: [adsRoute, dealBySeed, authorWall, longThread, ownNotifications, notificationGroups, ...fixtureRoutes], signedIn: true });

const start = new URLSearchParams(window.location.search).get("start") || "/below";
window.history.replaceState(null, "", start);

const POST_ID = posts[0].id;
type NavHandle = { postId: string; navigate?: (to: string) => void };
const handle: NavHandle = { postId: POST_ID };
(window as unknown as { __nav: NavHandle }).__nav = handle;

const AppShell = lazy(() => import("../AppShell"));
const Feed = lazy(() => import("@/pages/Feed"));
const PostDetail = lazy(() => import("@/pages/PostDetail"));
const Notifications = lazy(() => import("@/pages/Notifications"));

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
    {/* S4-c: the REAL bell, on every page with links — a dropdown over the page the member is on. */}
    <NotificationBell />
    <Link to="/below" data-testid="to-below">Go to the page below</Link>
    <Link to="/feed" data-testid="to-feed">Go to the feed</Link>
    <Link to={`/post/${POST_ID}`} data-testid="to-post">Open the post (as the notification bell does)</Link>
    {/* S4-b: a COMMENT notification row — the same link and the same entry state the bell and the Notifications page give it. */}
    <Link to={`/post/${POST_ID}`} state={notificationEntryState("post_comment")} data-testid="to-post-comment">A comment notification</Link>
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
      <Route path="/notifications" element={<Notifications />} />
    </Routes>
  </>
);

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading harness…</p>}>
    <AppShell history="browser" routes={[{ path: "*", element: <Pages /> }]} />
  </Suspense>,
);
