/**
 * THE GREEN DOT. P1 client half — 2-D2-03.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES, AND WHY IT IS NOT THE SAME QUESTION
 *
 * Until this unit the dot meant `isActiveNow(profiles.last_active_at)` — "this
 * member wrote a timestamp within the last five minutes". Every signed-in
 * client wrote that timestamp on mount and then every five minutes, forever, so
 * the dot cost one UPDATE per member per five minutes for a fact that is
 * already in the websocket the client is holding open anyway.
 *
 * It was also the wrong answer. A five-minute window says "was here recently",
 * and the dot claims "is here now". A member who closed the tab four minutes
 * ago was shown as online; a member reading in a background tab was shown as
 * online too, which is not what a green dot promises anyone.
 *
 * So presence is now presence: Supabase Realtime Presence, in memory, zero
 * database writes. `docs/gates/P1-interface.md` §1 is the contract this file
 * implements and the section numbers below refer to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAIL TO "NOT ONLINE" — §1
 *
 * Every failure mode here ends with an empty set: channel error, socket close,
 * signed out, an exception anywhere in the wiring. `isOnline` is a synchronous
 * read of a Set and cannot throw, and no render path awaits anything. A dot
 * that fails to absent is a dot nobody has to reason about; a dot that fails to
 * present is a lie with a green light on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIVACY — §1, ADDED BY R-62
 *
 * A member whose own `profiles.privacy_settings->>'active_status'` is `'off'`
 * never calls `track()`. Not "is filtered out of the list the readers see" —
 * never announced in the first place, so there is nothing on the wire for
 * anybody else's client to have an opinion about. Turning it off mid-session
 * calls `untrack()` immediately; turning it on calls `track()`.
 *
 * This is why the setting is read from the MEMBER'S OWN client rather than
 * applied by the readers. A reader-side filter would put every member's
 * privacy choice in every other member's browser, which is the same data
 * leaving the same door with an extra step in front of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO TABS, AND WHY THERE IS NO LEADER ELECTION
 *
 * The presence key is the user id (§1), so two tabs of one member collapse to
 * one entry in `presenceState()`. Closing one tab untracks that tab's
 * connection; the other tab's entry keeps the member online. Nothing has to
 * decide which tab is in charge, which is the same reasoning
 * `useEngagementHeartbeat.ts` gives for resolving the two-tab problem in the
 * database instead of in the client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAPACITOR
 *
 * `appStateChange` is read through the runtime globals, not an import —
 * `src/lib/native/authDeepLink.ts` documents why: the `@capacitor/*` packages
 * are installed only by the Android CI build, so importing one breaks the web
 * deploy. On web the listener simply never exists.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

/** §1. One channel name for the whole product. */
export const PRESENCE_CHANNEL = "presence:online";

type Listener = () => void;

/* ── Module state. One channel per client, not one per component. ───────────
 * A hook that opened its own channel would open one per avatar on screen. */
const listeners = new Set<Listener>();
/** Replaced, never mutated: `useSyncExternalStore` compares by reference. */
let onlineIds: ReadonlySet<string> = new Set<string>();
let channel: RealtimeChannel | null = null;
let selfId: string | null = null;
/** False when this member's own `active_status` is `'off'`. §1 PRIVACY. */
let selfVisible = true;
let isTracked = false;

const EMPTY: ReadonlySet<string> = new Set<string>();

function publish(next: ReadonlySet<string>) {
  onlineIds = next;
  for (const l of listeners) {
    try {
      l();
    } catch {
      // A subscriber that throws must not stop the others from hearing.
    }
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Is this member online RIGHT NOW, as far as this client's socket knows?
 *
 * Synchronous, never throws, and false for everything when the channel is not
 * up — including for a signed-out viewer, who never opens one.
 */
export function isOnline(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return onlineIds.has(userId);
}

/** The whole set, for a caller rendering a list and unable to call a hook per row. */
export function onlineUserIds(): ReadonlySet<string> {
  return onlineIds;
}

/** §1. Re-renders when this one member comes or goes. */
export function useOnline(userId: string | null | undefined): boolean {
  const getSnapshot = useCallback(() => isOnline(userId), [userId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * For a list rendered with `.map()`, where `useOnline` per row would be a hook
 * inside a loop. One subscription, one re-render, `has()` per row.
 */
export function useOnlineIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => onlineIds,
    () => EMPTY,
  );
}

/* ── track / untrack ───────────────────────────────────────────────────────── */

function trackSelf() {
  if (!channel || !selfId || !selfVisible || isTracked) return;
  isTracked = true;
  // §1: track({ u: <auth user id> }). The payload carries the id as well as the
  // key so a reader has it without depending on how the key is exposed.
  void Promise.resolve(channel.track({ u: selfId })).catch(() => {
    isTracked = false;
  });
}

function untrackSelf() {
  if (!channel || !isTracked) return;
  isTracked = false;
  void Promise.resolve(channel.untrack()).catch(() => {
    // Nothing to unwind: the server drops the entry when the socket goes.
  });
}

/**
 * §1 PRIVACY. Called by the member's own client when they change the setting,
 * so the change takes effect in the same gesture rather than at the next reload.
 *
 * `EditProfile.tsx` calls this after the profile write succeeds. It is a plain
 * function and not a hook precisely so the save path can call it inline.
 */
export function setOwnActiveStatusVisible(visible: boolean): void {
  selfVisible = visible;
  if (!visible) untrackSelf();
  else if (typeof document === "undefined" || !document.hidden) trackSelf();
}

/** `privacy_settings->>'active_status'`: absent means on (the database COALESCEs the same way). */
export function activeStatusVisible(
  privacySettings: Record<string, unknown> | null | undefined,
): boolean {
  const raw = privacySettings?.["active_status"];
  return typeof raw === "string" ? raw !== "off" : true;
}

/* ── Capacitor ─────────────────────────────────────────────────────────────── */

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

/* ── The connection ────────────────────────────────────────────────────────── */

/**
 * Open the presence channel as `userId` and keep it in step with visibility.
 * Returns the teardown. Imperative rather than hook-only so a test can drive it
 * without a renderer — the privacy rule is a statement about what does and does
 * not reach the wire, and that is clearest asserted directly.
 *
 * Only ever called for a signed-in member: presence is not shown to signed-out
 * visitors, so opening a socket for them would buy nothing.
 */
export function connectPresence(
  userId: string,
  options: { visible?: boolean } = {},
): () => void {
  disconnectPresence();

  selfId = userId;
  selfVisible = options.visible ?? true;
  isTracked = false;

  const readState = () => {
    if (!channel) return;
    try {
      // Keys are presence keys, which §1 fixes to the user id.
      publish(new Set(Object.keys(channel.presenceState())));
    } catch {
      publish(EMPTY);
    }
  };

  let onVisibility: (() => void) | null = null;
  let onPageHide: (() => void) | null = null;
  let capHandle: CapListenerHandle | undefined;

  try {
    const ch = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userId } },
    });
    channel = ch;

    ch.on("presence", { event: "sync" }, readState)
      .on("presence", { event: "join" }, readState)
      .on("presence", { event: "leave" }, readState)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // §1: track once after SUBSCRIBED — and only if privacy allows.
          if (typeof document === "undefined" || !document.hidden) trackSelf();
          readState();
          return;
        }
        // CHANNEL_ERROR, TIMED_OUT, CLOSED. Fail to "not online" (§1).
        isTracked = false;
        publish(EMPTY);
      });

    onVisibility = () => {
      if (document.hidden) untrackSelf();
      else trackSelf();
    };
    document.addEventListener("visibilitychange", onVisibility);

    onPageHide = () => untrackSelf();
    window.addEventListener("pagehide", onPageHide);

    try {
      const h = capApp()?.addListener("appStateChange", (s) => {
        if (s?.isActive === false) untrackSelf();
        else trackSelf();
      });
      capHandle = h && typeof h === "object" ? h : undefined;
    } catch {
      // Web, or an app build without the App plugin.
    }
  } catch {
    // A channel that cannot be opened is a dot that does not render. Nothing
    // above this line is allowed to reach a render path as an exception.
    publish(EMPTY);
  }

  return () => {
    if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    if (onPageHide) window.removeEventListener("pagehide", onPageHide);
    try {
      capHandle?.remove?.();
    } catch {
      /* nothing to unwind */
    }
    disconnectPresence();
  };
}

/** Leave the channel and forget everything. Every path ends "not online". */
export function disconnectPresence(): void {
  const ch = channel;
  channel = null;
  selfId = null;
  isTracked = false;
  selfVisible = true;
  if (ch) {
    try {
      void Promise.resolve(supabase.removeChannel(ch)).catch(() => {});
    } catch {
      /* already gone */
    }
  }
  publish(EMPTY);
}

/**
 * Mounted ONCE, in `Layout`. Opens the channel for the signed-in member and
 * reads their own privacy setting before announcing them.
 *
 * The setting is read here, at connect time, rather than subscribed to: the
 * same-tab change is handled by `setOwnActiveStatusVisible` from the save path,
 * and a second realtime subscription for a preference a member changes once
 * would cost every client a channel for the life of the session.
 * `useAuth.tsx`'s `profile-guard` channel is deliberately not touched.
 */
export function usePresenceOnline(): void {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      disconnectPresence();
      return;
    }

    let cancelled = false;
    let teardown: (() => void) | null = null;

    void (async () => {
      let visible = true;
      try {
        const { data } = await supabase
          .from("profiles")
          .select("privacy_settings")
          .eq("id", userId)
          .maybeSingle();
        visible = activeStatusVisible(
          (data as { privacy_settings?: Record<string, unknown> | null } | null)
            ?.privacy_settings ?? null,
        );
      } catch {
        /* Unreadable preference: treated as ON, which is the database default.
         * The alternative — defaulting to hidden on a failed read — would make
         * a flaky request look like a privacy choice the member did not make. */
      }
      if (cancelled) return;
      teardown = connectPresence(userId, { visible });
    })();

    return () => {
      cancelled = true;
      if (teardown) teardown();
      else disconnectPresence();
    };
  }, [userId]);
}
