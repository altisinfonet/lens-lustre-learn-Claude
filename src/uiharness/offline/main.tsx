/**
 * OFF-6 · the offline harness page. Development only (served by the Vite dev
 * server at /offlineharness.html; never part of a build — vite builds only
 * index.html).
 *
 * The REAL Feed screen inside the REAL provider stack (AppShell), fed by the
 * harness fake backend, with the OFF-1 bridge mounted exactly as App.tsx mounts
 * it. Phases, by query string:
 *   ?phase=seed      online: the feed loads from the fake backend and OFF-1
 *                    writes it to IndexedDB.
 *   ?phase=offline   the app STARTS with no data network: every Supabase call
 *                    fails like a dead link, React Query is told it is offline,
 *                    `navigator.onLine` reads false. Whatever the feed shows now
 *                    came from the device.
 *   &nobridge=1      the same, WITHOUT the OFF-1 bridge — the control that must
 *                    show no posts (the pre-OFF-1 app, offline).
 *   ?phase=reconnect OFF-6 leg 2: online again. Writes to post_reactions /
 *                    post_comments / reports go to a fake PostgREST that
 *                    ENFORCES the staging unique constraints (fakeTables.ts),
 *                    and `&lose=N` makes the first N writes commit and then
 *                    lose their answer (the fetch throws), forcing resends.
 *                    `window.__off6server` exposes its rows and log.
 * The JS bundle itself still comes from the dev server: this harness proves the
 * DATA path offline. Loading the web shell offline is the app-shell question
 * (P22 superseded by OFF; the Capacitor app ships its shell on the device).
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy } from "react";
import { onlineManager } from "@tanstack/react-query";
import { installFakeBackend } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import { createFakeTables, CONSTRAINTS, toResponse } from "../fakeTables";
import "../../index.css";

if (!import.meta.env.DEV) throw new Error("offline harness is development-only");

const params = new URLSearchParams(window.location.search);
const phase = params.get("phase") ?? "seed";
const withBridge = params.get("nobridge") !== "1";

installFakeBackend({ routes: fixtureRoutes, signedIn: true });

if (phase === "offline") {
  const fakeFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/supabase\.co/.test(url) || url.startsWith("/config/")) throw new TypeError("Failed to fetch");
    return fakeFetch(input, init);
  };
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  onlineManager.setOnline(false);
}
if (phase === "reconnect") {
  const server = createFakeTables();
  server.loseAnswers(Number(params.get("lose") ?? "0"));
  const inner = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const m = url.match(/supabase\.co\/rest\/v1\/([a-z_]+)/);
    const writesHere = m && m[1] in CONSTRAINTS && method !== "GET";
    const readsBack = m && m[1] in CONSTRAINTS && method === "GET" && /idempotency_key=/.test(url);
    if (!writesHere && !readsBack) return inner(input, init);
    const u = new URL(url);
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    const headers = new Headers(init?.headers);
    const reply = server.handle({ method, table: m![1], params: u.searchParams, headers, body });
    if (writesHere && server.consumeLoss()) throw new TypeError("Failed to fetch");
    return toResponse(reply, headers);
  };
  (window as unknown as { __off6server: unknown }).__off6server = server;
}
(window as unknown as { __off6: unknown }).__off6 = { phase, withBridge };

const AppShell = lazy(() => import("../AppShell"));
const Feed = lazy(() => import("@/pages/Feed"));
const Bridge = lazy(() => import("@/components/OfflineDeviceStoreBridge"));
const Outbox = lazy(() => import("@/components/OutboxBridge"));

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading harness…</p>}>
    <AppShell route="/feed" path="/feed">
      <>
        {withBridge && <Bridge />}
        <Outbox />
        <Feed />
      </>
    </AppShell>
  </Suspense>,
);
