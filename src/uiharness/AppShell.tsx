/**
 * THE REAL PROVIDER STACK, so a scene mounts the real screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A scene that renders `<Feed />` on its own is not rendering the Feed a member
 * sees. The screen a member sees is the page INSIDE `Layout` — under the real
 * navbar, above the real bottom navigation, inside the real theme, with the
 * real translated strings and the real `useAuth()` telling it who is signed in.
 * Most of the faults worth catching live exactly there: a bar under the status
 * bar, a floating button behind the tab strip, a heading that only wraps once
 * the German string is used.
 *
 * So this mirrors `App.tsx`'s provider stack rather than inventing a smaller
 * one. Where it differs from App.tsx, it differs for a stated reason:
 *
 *  • `MemoryRouter` instead of `BrowserRouter` — the harness is one page and
 *    must not write to the address bar, which carries `?scene=`.
 *  • No `SplashScreen`, no `GoogleAnalytics`, no `PushNotificationsGate`,
 *    no `AppUpdatePrompt` — each is a timed overlay or a side effect that would
 *    photograph differently run to run. They are chrome, not the screen.
 *  • `retry: false`, `staleTime: Infinity` — a retry means a screenshot might
 *    catch a loading state on one run and content on the next.
 *
 * Everything else — Auth, Theme, i18n, Tooltip, CookieConsent, Helmet, and the
 * real `Layout` — is the app's own.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/core/useAuth";
import { ThemeProvider } from "@/hooks/core/useTheme";
import { CookieConsentProvider } from "@/hooks/core/useCookieConsent";
import { I18nProvider } from "@/i18n/I18nContext";
import Layout from "@/components/Layout";

/** One client per mount: shared cache across scenes would leak one scene's
 *  data into another's screenshot. */
function harnessQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
}

export interface AppShellProps {
  children: ReactNode;
  /** The url the page believes it is at — some screens read it. */
  route?: string;
  /**
   * The ROUTE PATTERN, when the page reads `useParams()`. `/post/:postId` with
   * `route="/post/aaa…001"` is what makes `PostDetail` fetch the fixture post
   * instead of rendering its "not found" state — which would photograph as a
   * tidy empty screen and pass for a checked one.
   */
  path?: string;
  /** false mounts the page bare, to isolate a fault to the page or the shell. */
  withLayout?: boolean;
}

/**
 * `Layout` is a react-router layout route: it renders an `<Outlet />`, so it
 * only works with a real nested route underneath it. Hence the two-level
 * Routes rather than simply wrapping the child in `<Layout>`.
 */
export default function AppShell({
  children, route = "/", path = "*", withLayout = true,
}: AppShellProps) {
  const page = <Routes><Route path={path} element={children} /></Routes>;

  return (
    <HelmetProvider>
      <QueryClientProvider client={harnessQueryClient()}>
        <I18nProvider>
          <TooltipProvider>
            {/* The future flags keep the console CLEAN. The capture sweep
                counts every console warning as a problem, and a warning that
                is always there is one nobody reads — which is how a real one
                gets past. Measured: without these, all five real screens
                reported two router warnings at all three widths. */}
            <MemoryRouter
              initialEntries={[route]}
              future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            >
              <AuthProvider>
                <ThemeProvider>
                  <CookieConsentProvider>
                    {withLayout ? (
                      <Routes>
                        <Route element={<Layout />}>
                          <Route path={path} element={children} />
                        </Route>
                      </Routes>
                    ) : (
                      page
                    )}
                  </CookieConsentProvider>
                </ThemeProvider>
              </AuthProvider>
            </MemoryRouter>
          </TooltipProvider>
        </I18nProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}
