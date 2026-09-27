/**
 * THE ONE REPEATING TIMER IN THIS CLIENT. P10.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * The 0-D2-03 baseline inventory counted 21 `setInterval` sites in `src/**`.
 * **Twenty of the twenty-one failed P10's gate** — *"no timer fires more often
 * than once a second; every repeating timer is cleared on `visibilitychange`"*
 * — and the one that passed, `useEngagementHeartbeat.ts`, passed because it had
 * written the teardown by hand.
 *
 * Nineteen hand-rolled timers is nineteen chances to forget the teardown, and
 * the cost of forgetting is not theoretical: a repeating timer in a backgrounded
 * tab keeps waking a phone that nobody is looking at. That is the same shape as
 * the 580,000-requests-for-35-rows problem, spread thin.
 *
 * So there is now one timer, here, and it stops when the page is hidden.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 *  · It stops on `visibilitychange` → hidden, and starts again on visible.
 *  · It stops on Capacitor `appStateChange` → `isActive: false`, because on
 *    Android the app can be backgrounded without `document.hidden` changing.
 *  · It refuses a delay under `MIN_INTERVAL_MS`. Not clamps — **throws**, in
 *    development. A clamp would let a 30 ms intention survive as a 1 s timer
 *    and read as compliance; the call site is supposed to change instead.
 *  · It does **not** fire a catch-up tick for the time spent hidden. A timer
 *    that owes you eleven ticks on resume is a thundering herd, and every
 *    caller here either re-derives its state from a timestamp on the next
 *    render or does not care. `runOnVisible` asks for exactly one tick on
 *    resume, for the callers that do.
 *  · It tells the callback whether a tick is the first one after a resume
 *    (`TickInfo.firstTickAfterResume`). A caller that holds a server-side
 *    claim needs that: nothing it believes about the world survived the gap,
 *    and a failure on that tick means something different from a failure
 *    mid-session. Only this file knows when the timer restarted — the gap can
 *    be a `visibilitychange` or a Capacitor `appStateChange` — so the flag is
 *    produced here rather than re-derived by each caller.
 *
 * `useEngagementHeartbeat.ts` keeps its own copy of this pattern and is exempt
 * in `p10TimerDiscipline.test.ts`: it is the implementation this one was
 * derived from, it additionally refuses to tick while idle, and rewriting it to
 * call this hook would be rewriting the reference to match the copy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAPACITOR
 *
 * `appStateChange` is read through the `window.Capacitor` runtime globals, not
 * an import — `src/lib/native/authDeepLink.ts` documents why: the `@capacitor/*`
 * packages are installed only by the Android CI build, so importing one breaks
 * the web deploy. On web the listener simply never exists.
 */
import { useEffect, useRef } from "react";

/** P10's floor. Nothing in this client repeats faster than this. */
export const MIN_INTERVAL_MS = 1000;

/**
 * What the callback is told about the tick it is running on.
 *
 * Optional at the call site: a callback declared `() => void` is still a valid
 * argument, which is why the seventeen sites that do not care were not touched
 * when this was added.
 */
export interface TickInfo {
  /**
   * True for a tick fired the moment the page became visible again, or the
   * Capacitor app returned to the foreground, after this timer had been
   * stopped. False for an ordinary interval tick and for the tick fired at
   * start-up.
   *
   * It exists for callers whose tick asserts something to a server that may
   * have moved on while they were away — `useJudgingLock`'s heartbeat, which
   * treats a failure here as a lock it can no longer assume it holds. Do not
   * read it as "the page just became visible": it is only set when this timer
   * had actually stopped, and only when the caller asked for a resume tick.
   */
  firstTickAfterResume: boolean;
}

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
 * The imperative form, for a timer that lives inside an effect that is already
 * doing something else — a realtime subscription with a polling backup beside
 * it, typically. Returns its own teardown; call it from the effect's cleanup.
 *
 * `useVisibilityInterval` below is a thin wrapper over this. There is one
 * implementation of the visibility rule and both forms share it, so a site that
 * cannot hoist its callback to component level does not have to hand-roll the
 * teardown — which is exactly how nineteen of them came to be missing it.
 *
 * Returns a no-op teardown when the delay is below the floor, having said so.
 */
export function startVisibilityInterval(
  callback: (info: TickInfo) => void,
  delayMs: number,
  options: VisibilityIntervalOptions = {},
): () => void {
  if (delayMs < MIN_INTERVAL_MS) {
    const message =
      `startVisibilityInterval: ${delayMs} ms is below P10's ${MIN_INTERVAL_MS} ms floor. ` +
      `Derive the displayed value from a timestamp at render time, or use ` +
      `requestAnimationFrame if a continuous visual is genuinely needed.`;
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
    return () => {};
  }

  const runOnVisible = options.runOnVisible ?? false;
  /** `runOnVisible` is the same thing plus the start-up tick. */
  const runOnResume = runOnVisible || (options.runOnResume ?? false);
  let timer: number | null = null;

  const tick = (firstTickAfterResume = false) => {
    // Belt and braces: a timer can survive one turn of the event loop after
    // stop(), and a tick while hidden is exactly what this exists to prevent.
    if (typeof document !== "undefined" && document.hidden) return;
    callback({ firstTickAfterResume });
  };

  const start = () => {
    if (timer !== null) return;
    timer = window.setInterval(tick, delayMs);
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
      if (runOnResume) tick(true);
      start();
    }
  };

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
        if (runOnResume) tick(true);
        start();
      }
    });
    capHandle = h && typeof h === "object" ? h : undefined;
  } catch {
    // Web, or an app build without the App plugin. Visibility alone covers it.
  }

  if (typeof document === "undefined" || !document.hidden) {
    // Start-up, not a resume. `runOnResume` deliberately does not fire here.
    if (runOnVisible) tick(false);
    start();
  }

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
    try {
      capHandle?.remove?.();
    } catch {
      // A plugin that cannot be removed must not break unmount.
    }
  };
}

export interface VisibilityIntervalOptions {
  /**
   * Fire once immediately when the page becomes visible again (and on mount).
   * For a caller that shows something time-derived and would otherwise display
   * a stale value for up to one interval. Default false.
   */
  runOnVisible?: boolean;
  /**
   * Fire once on resume — but **not** at start-up. Default false.
   *
   * The difference from `runOnVisible` is one tick, and it matters for a
   * caller whose tick is a write rather than a read: `useJudgingLock` has just
   * acquired its lock when the timer starts, so a heartbeat in that instant is
   * an RPC that asserts something already true. Coming back from hidden is the
   * opposite case — that is the moment it least knows whether it still holds
   * the lock.
   *
   * `runOnVisible` implies this. Setting both is the same as `runOnVisible`.
   */
  runOnResume?: boolean;
}

/**
 * Run `callback` every `delayMs`, only while the page is visible.
 *
 * `delayMs === null` disables the timer entirely — use it for "poll only while
 * X is true" rather than mounting and unmounting the caller.
 *
 * The callback is held in a ref, so a caller may pass an inline closure without
 * tearing the timer down and rebuilding it on every render. That was the defect
 * in three of the call sites this replaced: the interval was re-created on each
 * render and its countdown never completed.
 */
export function useVisibilityInterval(
  callback: (info: TickInfo) => void,
  delayMs: number | null,
  options: VisibilityIntervalOptions = {},
): void {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  const runOnVisible = options.runOnVisible ?? false;
  const runOnResume = options.runOnResume ?? false;

  useEffect(() => {
    if (delayMs === null) return;
    return startVisibilityInterval((info) => savedCallback.current(info), delayMs, {
      runOnVisible,
      runOnResume,
    });
  }, [delayMs, runOnVisible, runOnResume]);
}
