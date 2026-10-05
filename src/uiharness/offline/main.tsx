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
 * The JS bundle itself still comes from the dev server: this harness proves the
 * DATA path offline. Loading the web shell offline is the app-shell question
 * (P22 superseded by OFF; the Capacitor app ships its shell on the device).
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy } from "react";
import { onlineManager } from "@tanstack/react-query";
import { installFakeBackend } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
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
(window as unknown as { __off6: unknown }).__off6 = { phase, withBridge };

const AppShell = lazy(() => import("../AppShell"));
const Feed = lazy(() => import("@/pages/Feed"));
const Bridge = lazy(() => import("@/components/OfflineDeviceStoreBridge"));

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading harness…</p>}>
    <AppShell route="/feed" path="/feed">
      <>
        {withBridge && <Bridge />}
        <Feed />
      </>
    </AppShell>
  </Suspense>,
);
