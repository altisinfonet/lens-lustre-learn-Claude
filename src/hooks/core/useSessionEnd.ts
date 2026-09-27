/**
 * "LAST SEEN" IS NOW WRITTEN ONCE, WHEN THE SESSION ENDS. P1 client half.
 *
 * `docs/gates/P1-interface.md` §2 is the contract. The green dot moved to
 * Realtime Presence (`src/lib/presence/online.ts`); what is left for
 * `profiles.last_active_at` is the "Last seen 3h ago" line, and that needs one
 * write per session, not one every five minutes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DATABASE OWNS THE TWO-TAB RULE
 *
 * `record_session_end` only writes when the stored value is older than sixty
 * seconds, so three tabs closing together produce one write and no client has
 * to elect a leader. §2 states that condition; this file must not re-implement
 * it, and deliberately does not debounce, batch or de-duplicate — a client-side
 * guard here would be a second copy of a rule that already resolves correctly
 * one layer down, and the two would drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `pagehide` AND `visibilitychange`, AND WHY NEITHER IS AWAITED
 *
 * `beforeunload` does not fire when a mobile browser or the Android WebView
 * discards the page, which is most of how this app is used. `pagehide` does,
 * and `visibilitychange` → hidden covers the far more common case of a member
 * switching away and never coming back — the same reasoning
 * `useJudgingLock.ts` gives for its teardown release.
 *
 * Nothing awaits the call and nothing retries it (§2). A page being torn down
 * has no time to spend on a promise, and a missed write is bounded by
 * `backfill_last_seen()` (§3): worst case the reading is about thirty minutes
 * stale, which is invisible in a string that says "3h ago".
 *
 * `persisted === true` on `pagehide` means the page is going into the
 * back/forward cache and will come back — the session has not ended, so
 * nothing is recorded.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

type CapAppState = { isActive?: boolean };
type CapListenerHandle = { remove?: () => void };
type CapGlobal = {
  Plugins?: {
    App?: {
      addListener: (
        event: "appStateChange",
        cb: (s: CapAppState) => void,
      ) => CapListenerHandle | void;
    };
  };
};
const capApp = () =>
  (globalThis as unknown as { Capacitor?: CapGlobal }).Capacitor?.Plugins?.App;

/**
 * THE CROSS-LANE INTERLOCK, IN THE TYPE SYSTEM.
 *
 * `src/integrations/supabase/types.ts` is generated from the live database, and
 * `record_session_end` is D1's half of P1 — it is not on `staging` yet, so
 * `supabase.rpc` does not know the name and `tsc` rejects it. This declares the
 * one call site against the frozen signature in `docs/gates/P1-interface.md` §2
 * instead of widening anything: `_platform` is still constrained to the two
 * values the function accepts, so a typo here is still a compile error.
 *
 * WHEN D1's MIGRATION LANDS and the types are regenerated, this narrowing
 * becomes redundant and should be deleted — `supabase.rpc("record_session_end",
 * …)` will type on its own. It is deliberately ugly so that it is found.
 *
 * `as unknown as`, not `as any`: the cast is to a named function type with real
 * parameter types, and nothing else in the file loses its types because of it.
 * And it is applied at the CALL SITE, never to a stored copy — see the note
 * beside the call.
 */
type RecordSessionEnd = (
  fn: "record_session_end",
  args: { _platform: "app" | "web" },
) => PromiseLike<unknown>;

export function useSessionEnd(): void {
  const { user } = useAuth();
  /** Mirrored so the teardown listeners read it without re-subscribing. */
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  useEffect(() => {
    if (!user) return;

    const record = () => {
      if (!userIdRef.current) return;
      // §2: best-effort, never awaited, never retried. The `catch` is here so an
      // unhandled rejection cannot surface during teardown, not to recover.
      /* IN CALL POSITION, and that is not a style choice.
       *
       * `const rpc = supabase.rpc as …; rpc(…)` detaches the method from the
       * client, so it runs with `this === undefined` and throws a TypeError
       * before any request is made. That exact line shipped once and is the
       * subject of `mediaWritePath.test.ts` · RED-1, whose static scan caught
       * this file's first draft doing it again. Casting the member expression
       * AT the call keeps the receiver. */
      void Promise.resolve(
        (supabase.rpc as unknown as RecordSessionEnd)("record_session_end", {
          _platform: isNativeCapacitorApp() ? "app" : "web",
        }),
      ).catch(() => {});
    };

    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return; // back/forward cache: the session continues
      record();
    };
    const onVisibility = () => {
      if (document.hidden) record();
    };

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    let capHandle: CapListenerHandle | undefined;
    try {
      const h = capApp()?.addListener("appStateChange", (s) => {
        if (s?.isActive === false) record();
      });
      capHandle = h && typeof h === "object" ? h : undefined;
    } catch {
      // Web, or an app build without the App plugin.
    }

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        capHandle?.remove?.();
      } catch {
        /* nothing to unwind */
      }
    };
  }, [user]);
}
