/**
 * Phase 2a — Active Engagement collector, client half. COLLECT ONLY.
 *
 * Mounted once, in Layout. Signed-out visitors are never touched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS A MINUTE
 *
 * A minute is recorded when ALL of these hold at the moment the timer fires:
 *
 *   1. somebody is signed in;
 *   2. the tab is visible (`document.hidden === false`), and inside the app the
 *      Capacitor app state is active;
 *   3. there was a real input event — pointer, key, wheel, touch or scroll —
 *      within the last 120 seconds (owner's decision 1);
 *   4. no ping has already been sent for this wall-clock minute.
 *
 * A left-open tab therefore stops earning after two minutes, and a phone in a
 * pocket earns nothing at all. That is the entire point: this must measure
 * attention, not uptime. Owner, 2026-08-11: "Do not use last_active_at as
 * Active Engagement."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TIMER IS DESTROYED ON HIDE RATHER THAN LEFT TO NO-OP
 *
 * A hidden tab's setInterval still fires, throttled to about once a minute. A
 * no-op tick is cheap but it is not free, and on a phone it is a wake-up that
 * buys nothing. The interval is cleared on hide and rebuilt on show, so a
 * backgrounded app costs exactly zero timers.
 *
 * Showing again also resets the idle clock: returning to the tab is itself the
 * interaction. Without that, coming back after ten minutes away would sit idle
 * until the member happened to touch something.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO TABS
 *
 * Two tabs open on the same account both ping. They collide on the primary key
 * (user_id, minute_bucket) and the server keeps one row, taking the strictest
 * surface — so a member reading the feed in one tab and /admin in another gets
 * that minute marked `internal`, never credit. No client-side leader election
 * is needed, and none is attempted; a leader that dies with its tab would lose
 * minutes for a benefit the database already provides.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAPACITOR
 *
 * `appStateChange` is read through the `window.Capacitor` runtime globals, not
 * an import. src/lib/native/authDeepLink.ts documents why: the @capacitor/*
 * packages are installed only by the Android CI build, so importing one breaks
 * the web deploy. On web the listener simply never exists.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import {
  minuteKey,
  pathSegment,
  sendActivityPing,
} from "@/lib/engagement/activityPing";

/** Owner's decision 1: idle timeout = 120 seconds. */
const IDLE_MS = 120_000;

/**
 * How often we look. Not how often we send — the minute key does that. 15s is
 * fine-grained enough that a member who arrives at :14 past the minute is not
 * credited for the minute they barely saw, and coarse enough to be invisible.
 */
const TICK_MS = 15_000;

const INPUT_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

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
  (window as unknown as { Capacitor?: CapGlobal }).Capacitor?.Plugins?.App;

export function useEngagementHeartbeat(): void {
  const { user } = useAuth();
  const { pathname } = useLocation();

  /**
   * The current path lives in a ref, not in the effect's dependency list. If it
   * were a dependency, every navigation would tear down and rebuild the timer,
   * and a member browsing quickly would keep resetting a 15s countdown and
   * never reach a tick. The timer must survive navigation; only the value it
   * reads changes.
   */
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const lastInputAt = useRef(0);
  const lastSentMinute = useRef(-1);

  useEffect(() => {
    if (!user) return;

    // Arriving on the page is itself the first interaction.
    lastInputAt.current = Date.now();
    lastSentMinute.current = -1;

    let timer: number | null = null;

    const markInput = () => {
      lastInputAt.current = Date.now();
    };

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;

      const now = Date.now();
      if (now - lastInputAt.current > IDLE_MS) return;

      const key = minuteKey(now);
      if (key === lastSentMinute.current) return;
      lastSentMinute.current = key;

      // had_interaction: was there a real input event inside THIS minute, as
      // opposed to a still-warm idle window carried over from the last one?
      // Purely diagnostic — it is what will tell us, in two weeks, whether the
      // collector over-counts. Nothing scores on it.
      const interacted = lastInputAt.current >= key * 60_000;

      void sendActivityPing(pathSegment(pathRef.current), interacted);
    };

    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(tick, TICK_MS);
    };

    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        lastInputAt.current = Date.now();
        start();
      }
    };

    for (const ev of INPUT_EVENTS) {
      window.addEventListener(ev, markInput, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    let capHandle: CapListenerHandle | undefined;
    try {
      // Older Capacitor App plugins return nothing from addListener; newer ones
      // return a handle. Narrow rather than assume, so `remove` is only called
      // when it actually exists.
      const h = capApp()?.addListener("appStateChange", (s) => {
        if (s?.isActive === false) {
          stop();
        } else {
          lastInputAt.current = Date.now();
          start();
        }
      });
      capHandle = h && typeof h === "object" ? h : undefined;
    } catch {
      // Web, or an app build without the App plugin. Visibility alone covers it.
    }

    if (typeof document === "undefined" || !document.hidden) start();

    return () => {
      stop();
      for (const ev of INPUT_EVENTS) {
        window.removeEventListener(ev, markInput);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        capHandle?.remove?.();
      } catch {
        /* nothing to unwind */
      }
    };
  }, [user]);
}
