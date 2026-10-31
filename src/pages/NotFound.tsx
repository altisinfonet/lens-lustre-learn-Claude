/**
 * THE 404 — BARE, CENTRED, AND WITH ITS OWN WAY BACK IN.
 *
 * The Owner's verdict on the previous version was "nonsense design, worthless",
 * and the fault was structural rather than decorative. Two things were wrong,
 * and only one of them was visible in his screenshot:
 *
 *  1. THE SHELL. Layout picks the two-column feed shell by matching `pathname`
 *     against a list. A 404 happens at an ARBITRARY path, so it can never be on
 *     that list, and the page rendered between a "Welcome / Sign Up Free /
 *     Popular Categories" sidebar and a "Competitions / Learn Photography" rail.
 *     Three competing calls to action wrapped around a dead end. `useBareShell`
 *     below fixes it from the page rather than from a route list — the only
 *     mechanism that also covers CustomUrlProfile rendering this in place.
 *
 *  2. NO WAY BACK IN — AND THIS ONE HIS SCREENSHOT COULD NOT SHOW. At 360px the
 *     sidebars are already hidden by responsive CSS, so a signed-out visitor on
 *     a phone had no Sign Up and no Log in anywhere in the page. On desktop those
 *     links existed ONLY because the sidebar happened to carry them — which is
 *     chrome, not a 404 affordance, and it disappears the moment the shell does.
 *     So the page now carries its own pair. The Owner's words: "nicely clean
 *     with signup and login link".
 *
 * INSTAGRAM IS THE REFERENCE FOR RESTRAINT, NOT A THING TO COPY. What theirs
 * gets right is subtraction: whitespace, one quiet mark, one short line, one
 * action. What is OURS and is kept is the aperture and "This frame is empty" —
 * photography-native, and better than a generic exclamation circle. What went:
 * the three tiles (three choices is a menu, not a decision) and the echoed path
 * in a monospace chip (developer-facing noise to a stranger who already knows
 * what they typed). The path is still recorded — in the UI-8006 log line, where
 * it is useful to us and invisible to them.
 *
 * THE ACTIONS ARE AUTH-AWARE, because a stranger and a member need opposite
 * things. Signed out: Sign Up Free, then Log in, then a quiet way home. Signed
 * in: home first, and exactly one onward link. Showing a member a signup button
 * — or a stranger a members-only path — is its own small insult.
 */
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Aperture } from "lucide-react";
import { useT } from "@/i18n/I18nContext";
import { useAuth } from "@/hooks/core/useAuth";
import { useBareShell } from "@/components/BareLayoutContext";

import { logger } from "@/lib/logger";

const FILE = "src/pages/NotFound.tsx";

/** Shared by every action so focus is always visible — keyboard and screen
 *  reader users reach this page the same way everyone else does. */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const NotFound = () => {
  const t = useT();
  const location = useLocation();
  const { user, loading } = useAuth();

  // Header and footer only — no left nav, no right rail, no feed chrome.
  useBareShell();

  useEffect(() => {
    logger.info({
      code: "UI-8006",
      event: "ROUTE_NOT_FOUND",
      fn: "NotFound",
      file: FILE,
      message: "A member reached a route that does not exist.",
      reason: "No route matched the requested path.",
      expected: "A matching route",
      actual: "404",
      nextStep:
        "Deliberately info, so it is never persisted — crawlers hit 404s constantly and would flood the Error Log. Compare the path against the navigation if a member reports a dead link.",
      detail: { path: location.pathname },
    });
  }, [location.pathname]);

  /**
   * While auth is still resolving, show the signed-OUT actions. They are the
   * safe default: a member who briefly sees "Sign Up Free" has lost nothing,
   * whereas a stranger shown a members-only link has been sent nowhere useful.
   */
  const signedIn = !loading && Boolean(user);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-20 text-center">
      <Aperture
        className="mb-10 h-20 w-20 animate-[spin_14s_linear_infinite] text-muted-foreground/30"
        strokeWidth={1}
        aria-hidden="true"
      />

      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {t("nf.frameEmpty")}
      </h1>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        {t("nf.pageGone")}
      </p>

      <div className="mt-10 flex w-full flex-col items-center gap-4">
        {signedIn ? (
          <>
            <Link
              to="/"
              className={`inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 ${focusRing}`}
            >
              {t("nf.backToHome")}
            </Link>
            <Link
              to="/discover"
              className={`rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline ${focusRing}`}
            >
              {t("nf.discover")}
            </Link>
          </>
        ) : (
          <>
            <Link
              to="/signup"
              className={`inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 ${focusRing}`}
            >
              {t("nf.signUpFree")}
            </Link>
            <Link
              to="/login"
              className={`rounded-sm text-sm font-medium text-foreground underline-offset-4 transition-colors hover:underline ${focusRing}`}
            >
              {t("nf.logIn")}
            </Link>
            <Link
              to="/"
              className={`rounded-sm text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline ${focusRing}`}
            >
              {t("nf.backToHome")}
            </Link>
          </>
        )}
      </div>
    </main>
  );
};

export default NotFound;
