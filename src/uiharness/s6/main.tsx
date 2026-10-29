/**
 * S6-d · THE PAGING & REALTIME HARNESS (development only).
 *
 * The real /feed against a fake backend with a pool deep enough for 100 pages
 * (1,200 posts). It answers BOTH ways of paging — the old get_broadcast_feed
 * (`_exclude_ids`) and S6-a's get_feed_page (`_after`, server-side log) — and
 * records, per feed request, how many ids the client UPLOADED. The fake
 * realtime socket records every frame the client sends, so the tool can count
 * the feed-live channels joined and every postgres_changes binding's filter.
 * The tool (tools/uishot/s6-paging-harness.mjs) judges the S6 gate:
 *   ≤ 15 mounted cards after 30 pages · `_exclude_ids` at page 100 = 0 ·
 *   1 feed-live channel · 0 unfiltered hot bindings.
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy } from "react";
import { installFakeBackend, HARNESS_USER_ID, type FakeRoute } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import { fixtureImage, profiles } from "../fixtures";
import "../../index.css";

if (!import.meta.env.DEV) throw new Error("S6 harness is development-only");

type Row = Record<string, unknown>;
const authors = profiles.filter((p) => p.id !== HARNESS_USER_ID).slice(0, 6);
const T0 = Date.UTC(2026, 9, 13, 6, 0, 0);
const pool: Row[] = Array.from({ length: 1200 }, (_, i) => {
  const a = authors[i % authors.length];
  return {
    id: `d6000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    user_id: a.id,
    content: `S6 harness post ${i + 1}`,
    image_url: fixtureImage(i + 1),
    image_urls: [fixtureImage(i + 1)],
    thumbnail_urls: [fixtureImage(i + 1)],
    privacy: "public",
    created_at: new Date(T0 - i * 60_000).toISOString(),
    likes_count: 0, comments_count: 0, shares_count: 0,
    feed_tier: "unseen",
    author_name: a.full_name ?? "Photographer",
    author_avatar: null,
    categories: [],
  };
});

const requests: Array<{ fn: string; uploaded: number; after: number | null }> = [];
const deliveryLog = new Map<string, string[]>();
const feed: FakeRoute = ({ method, path, body }) => {
  if (method !== "POST") return undefined;
  const b = (body ?? {}) as Row;
  const limit = Math.min(Math.max(Number(b._limit ?? 10), 0), 50);
  const uploaded = Array.isArray(b._exclude_ids) ? (b._exclude_ids as string[]).length : 0;
  if (path === "/rest/v1/rpc/get_broadcast_feed") {
    requests.push({ fn: "get_broadcast_feed", uploaded, after: null });
    const ex = new Set((b._exclude_ids as string[] | null) ?? []);
    return { body: pool.filter((p) => !ex.has(String(p.id))).slice(0, limit) };
  }
  if (path === "/rest/v1/rpc/get_feed_page") {
    const after = Number(b._after ?? 0);
    requests.push({ fn: "get_feed_page", uploaded, after });
    const key = `${b._tab}|${b._session_seed}`;
    const held = (deliveryLog.get(key) ?? []).slice(0, after);
    const ex = new Set(held);
    const rows = pool.filter((p) => !ex.has(String(p.id))).slice(0, limit);
    deliveryLog.set(key, [...held, ...rows.map((r) => String(r.id))]);
    return { body: rows.map((r, i) => ({ source: null, caught_up_after: false, ...r, feed_pos: after + i + 1 })) };
  }
  if (path === "/rest/v1/rpc/feature_allowed_me") return { body: false };
  return undefined;
};

installFakeBackend({ routes: [feed, ...fixtureRoutes], signedIn: true });
(window as unknown as { __s6: unknown }).__s6 = { requests };

const AppShell = lazy(() => import("../AppShell"));
const Feed = lazy(() => import("@/pages/Feed"));

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading harness…</p>}>
    <AppShell route="/feed" path="/feed">
      <Feed />
    </AppShell>
  </Suspense>,
);
