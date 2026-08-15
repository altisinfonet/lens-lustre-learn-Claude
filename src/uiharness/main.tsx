/**
 * DEV-ONLY SCREENSHOT HARNESS — the thing that lets UI be LOOKED AT before it
 * ships, instead of reasoned about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER INSTRUCTION, 2026-08-15: "execute it highly polished way not like
 * 10000000000 visual bugs. and find out a way to check the app by you before
 * uploading blindly."
 *
 * That is a fair charge. Client code was being written, tested for LOGIC by
 * vitest, and shipped, with nobody's eyes ever on the pixels — because the app
 * only rendered on the owner's device. Vitest asserts that a function returns
 * the right string; it says nothing about a button sitting half off the screen.
 *
 * WHAT THIS IS: a second Vite entry (`/uiharness.html`) that mounts ONE
 * component at a time with fixed mock props, no network, no auth, no router
 * dependency on real data. Deterministic, so a screenshot of it is comparable
 * run to run, and a headless Chromium in the build container can capture it at
 * real phone sizes and the image can be inspected before anything is pushed.
 *
 * WHY IT CANNOT REACH A MEMBER, two independent reasons:
 *   1. Vite's default build input is `index.html` ALONE. vite.config.ts
 *      overrides only rollupOptions.OUTPUT (manualChunks) and never .input, so
 *      `uiharness.html` is dev-served and never compiled into a release.
 *   2. The guard below. Even if a future config change swept extra HTML entries
 *      into the build, this refuses to mount outside development.
 *
 * WHY MOCK DATA RATHER THAN THE REAL DATABASE: this container cannot reach
 * supabase.co directly (verified — the websocket and REST calls fail with
 * ERR_CONNECTION_RESET; the MCP connector is a separate path). Even if it
 * could, screenshots driven by live data would change every time somebody
 * posts, and a comparison that changes on its own is not a comparison.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installFakeBackend } from "./fakeBackend";
import { fixtureRoutes } from "./fixtureRoutes";
import { isSignedOutScene, providesOwnShell } from "./sceneConfig";
import "../index.css";

if (!import.meta.env.DEV) {
  throw new Error("uiharness is development-only and must never be bundled for release");
}

const params = new URLSearchParams(window.location.search);
const name = params.get("scene") ?? "";

/**
 * ORDER MATTERS MORE THAN ANYTHING ELSE IN THIS FILE.
 *
 * `installFakeBackend` must run BEFORE a single app module is evaluated,
 * because `src/integrations/supabase/client.ts` creates its client at module
 * scope — the client captures `fetch` and reads the session out of
 * localStorage right there. An ordinary `import { SCENES } from "./scenes"`
 * would be HOISTED above this call by the module loader, the client would be
 * built against the real `window.fetch`, and every real-screen scene would sit
 * in a loading state for ever while trying to reach a host this container
 * cannot route to.
 *
 * Hence the dynamic import below. The three static imports above are safe
 * precisely because none of them touches app code.
 */
installFakeBackend({ routes: fixtureRoutes, signedIn: !isSignedOutScene(name) });

const { SCENES } = await import("./scenes");
const scene = SCENES[name];

/** Retries and refetching would make two runs of the same scene differ. */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: Infinity },
    mutations: { retry: false },
  },
});

function Index() {
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="mb-1 text-lg font-semibold">UI harness</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Development only. Append <code>?scene=&lt;name&gt;</code>.
      </p>
      <ul className="space-y-1">
        {Object.keys(SCENES).sort().map((k) => (
          <li key={k}>
            <a className="text-primary underline" href={`?scene=${encodeURIComponent(k)}`}>
              {k}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A `screen-` scene brings its own router, auth, theme and query client (see
 * AppShell.tsx), so wrapping it again throws "You cannot render a <Router>
 * inside another <Router>" and photographs as a blank page — which is exactly
 * what the first run of the real screens did.
 */
const ownShell = providesOwnShell(name);

createRoot(document.getElementById("harness-root")!).render(
  ownShell && scene ? (
    <StrictMode>{scene()}</StrictMode>
  ) : (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* MemoryRouter: components that use navigate()/Link must mount, but a
          harness must never depend on the real route table or on history. */}
      {/* The future flags are set to keep the harness console CLEAN. A capture
          run reports every console warning as a problem, and a warning that is
          always there is one nobody reads — which is how a real one gets past. */}
      <MemoryRouter
        initialEntries={["/harness"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {scene ? scene() : <Index />}
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>
  ),
);
