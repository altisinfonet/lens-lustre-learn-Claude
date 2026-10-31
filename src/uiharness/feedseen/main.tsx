/**
 * STAGE L2 · the feed-seen harness page. Development only (served by the Vite
 * dev server at /feedseenharness.html; never part of a build — vite builds only
 * index.html).
 *
 * The REAL Feed screen inside the REAL provider stack (AppShell) with the REAL
 * OutboxBridge, in a real browser — because the three things L2 is about cannot
 * be seen in jsdom at all: an IntersectionObserver that fires, a list whose
 * pixels do or do not move, and the order of requests on the wire.
 *
 * The server is a stand-in, and says so:
 *   · `get_broadcast_feed` deals from a pool of 36 posts by seed, honours
 *     `_exclude_ids`, leads with the newest posts ONLY until seen, and sends
 *     seen posts to the back — the rule of migration 20261013_0005, written
 *     small. It is NOT the database: the SQL is proven on PGlite against
 *     production's own function bodies (docs/evidence/d1/L2-feed-freshness).
 *     This page proves the CLIENT drives it correctly.
 *   · `feed_events` writes go to fakeTables.ts, which enforces the primary key
 *     the way the database does (a resend with the same id is the same row) and
 *     can lose answers (`__l2.server.loseAnswers(n)`).
 *   · the watermark and the 60-second count read the same pool.
 *
 * `window.__l2` is what tools/uishot/feed-seen-harness.mjs drives and reads:
 *   log            every feed RPC, seen-write and count, in the order sent
 *   server         the fake tables (rows("feed_events"), loseAnswers, log)
 *   addPosts(n)    n new posts by other members, newer than everything
 *   fail(on)       the feed RPC answers 500 (the DB-3004 fallback then serves)
 *   setHidden(on)  the tab is hidden / shown again (visibilitychange)
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy } from "react";
import { installFakeBackend, HARNESS_USER_ID, type FakeRoute } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import { fixtureImage, profiles } from "../fixtures";
import { createFakeTables, toResponse } from "../fakeTables";
import "../../index.css";

if (!import.meta.env.DEV) throw new Error("feed-seen harness is development-only");

type Row = Record<string, unknown>;
interface LogEntry { n: number; kind: "rpc" | "events" | "count" | "watermark" | "fallback"; [k: string]: unknown }

const authors = profiles.filter((p) => p.id !== HARNESS_USER_ID).slice(0, 6);
const T0 = Date.UTC(2026, 9, 13, 6, 0, 0);
let made = 0;
function makePost(minutesAfterT0: number, label: string): Row {
  const i = made++;
  const a = authors[i % authors.length];
  return {
    id: `c0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    user_id: a.id,
    content: `${label} ${String(i + 1).padStart(2, "0")}`,
    image_url: fixtureImage(i + 1),
    image_urls: [fixtureImage(i + 1)],
    thumbnail_urls: [fixtureImage(i + 1)],
    privacy: "public",
    created_at: new Date(T0 + minutesAfterT0 * 60_000).toISOString(),
    likes_count: 0,
    comments_count: 0,
    shares_count: 0,
    author_name: a.full_name ?? "Photographer",
    author_avatar: null,
    categories: [],
  };
}
const pool: Row[] = Array.from({ length: 36 }, (_, i) => makePost(i, "L2 harness post"));

const server = createFakeTables();
const log: LogEntry[] = [];
const put = (e: Omit<LogEntry, "n">) => { log.push({ n: log.length, ...e } as LogEntry); };
let failRpc = false;

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const newestFirst = (a: Row, b: Row) => String(b.created_at).localeCompare(String(a.created_at));

/** The rule of 20261013_0005, small: newest until seen → unseen by seed → seen last. */
function deal(body: Row): Row[] {
  const exclude = new Set((body._exclude_ids as string[] | null) ?? []);
  const seen = new Set(server.rows("feed_events").filter((r) => r.event_type === "view" && r.user_id === HARNESS_USER_ID).map((r) => String(r.post_id)));
  const seed = String(body._session_seed ?? "hour");
  const limit = Math.min(Math.max(Number(body._limit ?? 10), 0), 50);
  const visible = pool.filter((p) => !exclude.has(String(p.id)));
  const newest = [...visible].sort(newestFirst).slice(0, Math.max(Number(body._newest_first ?? 0), 0)).filter((p) => !seen.has(String(p.id)));
  const rest = visible.filter((p) => !newest.includes(p));
  const byScore = (a: Row, b: Row) => hash(String(a.id) + seed) - hash(String(b.id) + seed);
  const unseen = rest.filter((p) => !seen.has(String(p.id))).sort(byScore);
  const recycled = rest.filter((p) => seen.has(String(p.id))).sort(byScore);
  return [
    ...newest.map((p) => ({ ...p, feed_tier: "newest" })),
    ...unseen.map((p) => ({ ...p, feed_tier: "unseen" })),
    ...recycled.map((p) => ({ ...p, feed_tier: "recycled" })),
  ].slice(0, limit);
}

/** S6-a · get_feed_page's server-side delivery log: session → ids dealt, in order. */
const deliveryLog = new Map<string, string[]>();
const l2: FakeRoute = ({ method, path, params, body }) => {
  if (method === "POST" && path === "/rest/v1/rpc/get_feed_page") {
    // The same deal, paged by cursor: the server excludes what this session was
    // dealt before `_after`. `exclude` is that server-side list's length (what
    // the old call uploaded); `uploaded` is what the client actually sent (0).
    const b = (body ?? {}) as Row;
    const seed = String(b._session_seed ?? "hour");
    const after = Number(b._after ?? 0);
    const held = (deliveryLog.get(seed) ?? []).slice(0, after);
    put({ kind: "rpc", seed: b._session_seed ?? null, exclude: held.length, uploaded: ((b._exclude_ids as string[]) ?? []).length, cursor: after, newest: b._newest_first, failed: failRpc });
    if (failRpc) return { status: 500, body: { code: "XX000", message: "harness: the feed RPC is failing" } };
    const rows = deal({ ...b, _exclude_ids: held });
    deliveryLog.set(seed, [...held, ...rows.map((r) => String(r.id))]);
    return { body: rows.map((r, i) => ({ source: null, caught_up_after: false, ...r, feed_pos: after + i + 1 })) };
  }
  if (method === "POST" && path === "/rest/v1/rpc/get_broadcast_feed") {
    const b = (body ?? {}) as Row;
    put({ kind: "rpc", seed: b._session_seed ?? null, exclude: ((b._exclude_ids as string[]) ?? []).length, newest: b._newest_first, failed: failRpc });
    if (failRpc) return { status: 500, body: { code: "XX000", message: "harness: the feed RPC is failing" } };
    return { body: deal(b) };
  }
  if ((method === "GET" || method === "HEAD") && path === "/rest/v1/posts") {
    const select = params.get("select") ?? "";
    const others = pool.filter((p) => p.user_id !== HARNESS_USER_ID).sort(newestFirst);
    if (select === "created_at") {
      put({ kind: "watermark" });
      return { body: others.slice(0, 1).map((p) => ({ created_at: p.created_at })) };
    }
    if (select === "id,user_id" && (params.get("created_at") ?? "").startsWith("gt.")) {
      const after = (params.get("created_at") ?? "").slice(3);
      const found = others.filter((p) => new Date(String(p.created_at)).getTime() > new Date(after).getTime());
      put({ kind: "count", found: found.length });
      return { body: found.map((p) => ({ id: p.id, user_id: p.user_id })) };
    }
    if (select.startsWith("id,user_id,content")) {
      // the DB-3004 chronological fallback
      put({ kind: "fallback" });
      return { body: [...pool].sort(newestFirst).slice(0, 10).map(({ author_name: _n, author_avatar: _a, categories: _c, ...row }) => row) };
    }
  }
  return undefined;
};

installFakeBackend({ routes: [l2, ...fixtureRoutes], signedIn: true });

// feed_events writes: the fake that enforces the primary key (and can lose answers).
const inner = window.fetch;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  if (!/\/rest\/v1\/feed_events(\?|$)/.test(url) || method === "GET" || method === "HEAD") return inner(input, init);
  const u = new URL(url, "http://harness.invalid");
  const headers = new Headers(init?.headers);
  const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  const rows = (Array.isArray(body) ? body : [body]) as Row[];
  const reply = server.handle({ method, table: "feed_events", params: u.searchParams, headers, body });
  const lost = server.consumeLoss();
  put({ kind: "events", posts: rows.map((r) => r.post_id), ids: rows.map((r) => r.id), types: rows.map((r) => r.event_type), status: reply.status, lost, onConflict: u.searchParams.get("on_conflict"), prefer: headers.get("prefer") });
  if (lost) throw new TypeError("Failed to fetch");
  return toResponse(reply, headers);
};

let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });

(window as unknown as { __l2: unknown }).__l2 = {
  log,
  server,
  me: HARNESS_USER_ID,
  poolIds: () => pool.map((p) => p.id),
  addPosts(n: number) {
    const base = (Math.max(...pool.map((p) => new Date(String(p.created_at)).getTime())) - T0) / 60_000;
    const added = Array.from({ length: n }, (_, i) => makePost(base + 1 + i, "L2 NEW post"));
    pool.push(...added);
    return added.map((p) => p.id);
  },
  fail(on: boolean) { failRpc = on; },
  setHidden(on: boolean) { hidden = on; document.dispatchEvent(new Event("visibilitychange")); },
};

const AppShell = lazy(() => import("../AppShell"));
const Feed = lazy(() => import("@/pages/Feed"));
const Outbox = lazy(() => import("@/components/OutboxBridge"));

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading harness…</p>}>
    <AppShell route="/feed" path="/feed">
      <>
        <Outbox />
        <Feed />
      </>
    </AppShell>
  </Suspense>,
);
