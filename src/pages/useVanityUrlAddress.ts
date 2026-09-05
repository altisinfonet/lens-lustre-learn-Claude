import { useEffect, useRef } from "react";

/**
 * F-92 — ARRIVING BY ID MUST LEAVE YOU LOOKING AT THE NAME.
 *
 * Owner's rule: *"any link always show profilename link"*. F-86 made
 * `/membername` STAY `/membername`; this is the other half — landing on
 * `/profile/<uuid>` ends up showing `/<custom_url>`. The ID link is not a
 * secret and may be shared (*"profile link can be disclosed to anyone"*), but
 * it must never be what the visitor is left looking at: a recipient sees a UUID
 * instead of a name, and search engines index the UUID rather than the name.
 *
 * ⚠ ITS OWN MODULE, ON PURPOSE. The alternative is a `useEffect` buried in a
 * 1800-line page component, testable only by mounting that whole page with its
 * auth, query and router stack mocked — and a control that can only be
 * exercised through a full page render is a control that stops being run.
 *
 * ⚠ history.replaceState, NOT navigate(). Measured, not stylistic:
 * `/profile/:userId` and `/:customUrl` are two DIFFERENT routes on a
 * BrowserRouter, so `navigate("/membername")` makes the router re-match — the
 * profile unmounts, CustomUrlProfile mounts, `resolve_custom_url` runs again,
 * and a profile that is already on screen is refetched and re-rendered. That is
 * a remount and a flash, and it would drag this change into the F-85/F-86 code
 * path, which is proven and must not be disturbed. `replaceState` updates the
 * address bar WITHOUT telling the router, so the match is untouched and nothing
 * below re-renders. It is already the house pattern: `cacheBuster.ts:37`,
 * `Wallet.tsx:119`.
 *
 * ⚠ REPLACE, NEVER PUSH. A push would put the UUID URL in history and the back
 * button would bounce the visitor between two spellings of the same page.
 *
 * ⚠ NO custom_url MEANS CHANGE NOTHING. On production 15 members still have no
 * handle and D1's backfill has not run, so `/profile/<id>` has to keep working
 * for them — it must never 404 and never redirect into a dead end. The early
 * return is that guarantee, and it is the branch most worth keeping a test on.
 */
export function useVanityUrlAddress(userId: string | undefined, customUrl: string | null | undefined) {
  /** One rewrite per member. Without this, any re-render that still satisfies
   *  the conditions would push a second identical history operation. */
  const rewrittenFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const handle = (customUrl || "").trim();
    if (!handle) return;                                  // no handle: leave the ID url alone
    if (rewrittenFor.current === userId) return;

    const { pathname, search, hash } = window.location;
    // Only correct an ID address. Arriving on the vanity url already (F-86's
    // in-place render) needs no correction, and rewriting it would be a
    // pointless history operation.
    if (!pathname.startsWith("/profile/")) return;

    const target = `/${handle}`;
    if (pathname === target) return;

    rewrittenFor.current = userId;
    window.history.replaceState(window.history.state, "", target + search + hash);
  }, [userId, customUrl]);
}
