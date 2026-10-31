/**
 * WHY DID THIS MEMBER GET SIGNED OUT?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-15:
 *   *"dont know sometimes logged off home screen opening automatically"*
 *   *"during commenting logging off"*
 *   *"point 2 and 3 happening not all the time but randomly"*
 *
 * Two hypotheses were tested against production and BOTH were wrong. The
 * deleted-account guard was innocent — all ten of its firings were genuinely
 * deleted accounts. The alarming 5,697-logins-to-66-logouts ratio was a logging
 * bug, not re-logins: the median gap between one member's consecutive login
 * rows is two seconds.
 *
 * The investigation then stopped, for a reason worth stating plainly:
 * **nothing in this app records WHY a session ended.** `SIGNED_OUT` is handled,
 * but its cause is never captured, so afterwards every possible cause looks
 * identical — the member is simply logged out. A stalled token refresh, a
 * WebView dropping localStorage, an upload signing them out, and the member
 * tapping Log out are, from the evidence available today, the same event.
 *
 * This file is that missing evidence. It answers, at the moment a session ends:
 *
 *   • Did the member ASK for this? (Log out, delete account, sign out everywhere)
 *   • Had a token refresh just failed — and with what, and how many times?
 *   • Was the last request aborted by our own 25-second timeout?
 *   • Had the app just come back from the background, and after how long?
 *   • Is the stored session still in localStorage, or did it vanish underneath us?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR RULES THIS FILE OBEYS
 *
 * 1. **It imports nothing.** Not the Supabase client, not even the logger.
 *    The fetch wrapper inside `src/integrations/supabase/client.ts` reports
 *    into this module, and the logger imports that client — so a single import
 *    here would close a cycle. The consumer reads the facts and does the
 *    logging. That constraint is why this file is a plain fact-store.
 *
 * 2. **It never throws and never blocks.** It runs on the auth path during a
 *    failure. A recorder that can make an outage worse is not worth having.
 *
 * 3. **It writes NOTHING to storage.** Every fact lives in memory for the life
 *    of the page. WebView storage loss is one of the three suspects; adding our
 *    own writes to the store under investigation would contaminate the
 *    experiment.
 *
 * 4. **It records once.** A session can only be lost once per run, and a
 *    recorder that fires per retry would flood the very log it exists to fill.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** How a sign-out came about. Only `involuntary` is a bug. */
export type SignOutCause =
  | "member_action"      // they tapped Log out
  | "account_deleted"    // the deleted-account guard, working correctly
  | "delete_account"     // they deleted their own account
  | "sign_out_everywhere" // they revoked other devices
  | "upload_auth_failure" // s3Upload gave up after persistent auth failure
  | "involuntary";       // nobody asked for this — THIS is the bug

/** Everything known at the moment a session ended. Flat on purpose: this
 *  becomes one JSON column, and a nested shape is one nobody greps. */
export interface SessionLossFacts {
  cause: SignOutCause;
  /** Set only when something declared itself; otherwise the loss is a mystery. */
  declaredBy: string | null;
  /** ms since a deliberate sign-out was declared, or null if none was. */
  msSinceDeclared: number | null;

  /** Token refresh — the leading suspect. */
  lastRefreshAgoMs: number | null;
  lastRefreshOk: boolean | null;
  lastRefreshStatus: number | string | null;
  refreshFailuresInARow: number;

  /** The last request of any kind, and whether OUR timeout killed it. */
  lastRequestAgoMs: number | null;
  lastRequestStatus: number | string | null;
  lastRequestWasTimeout: boolean;
  timeoutsSeen: number;

  /** Backgrounding — an Android WebView can be reclaimed while hidden. */
  wasHiddenRecently: boolean;
  msSinceResume: number | null;
  longestHiddenMs: number;

  /** Did the stored session survive? */
  storedSessionPresent: boolean | null;

  /** Uptime, so a loss at second 3 is distinguishable from one at hour 3. */
  sessionAgeMs: number;
  platform: string;
  online: boolean | null;
}

/** Anything older than this is not "just now" and must not be reported as if
 *  it were. Five seconds is long enough to cover a refresh that failed and the
 *  sign-out that followed it, and short enough to exclude coincidence. */
const RECENT_MS = 5_000;

interface State {
  startedAt: number;
  declaredCause: SignOutCause | null;
  declaredBy: string | null;
  declaredAt: number | null;

  lastRefreshAt: number | null;
  lastRefreshOk: boolean | null;
  lastRefreshStatus: number | string | null;
  refreshFailuresInARow: number;

  lastRequestAt: number | null;
  lastRequestStatus: number | string | null;
  lastRequestWasTimeout: boolean;
  timeoutsSeen: number;

  hiddenSince: number | null;
  lastResumeAt: number | null;
  longestHiddenMs: number;

  recorded: boolean;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const state: State = {
  startedAt: now(),
  declaredCause: null,
  declaredBy: null,
  declaredAt: null,
  lastRefreshAt: null,
  lastRefreshOk: null,
  lastRefreshStatus: null,
  refreshFailuresInARow: 0,
  lastRequestAt: null,
  lastRequestStatus: null,
  lastRequestWasTimeout: false,
  timeoutsSeen: 0,
  hiddenSince: null,
  lastResumeAt: null,
  longestHiddenMs: 0,
  recorded: false,
};

/** True for the endpoint that renews a session — the one that matters most. */
export function isTokenRefreshUrl(url: string): boolean {
  return /\/auth\/v1\/token(\?|$)/.test(url);
}

/**
 * Called by the fetch wrapper for EVERY request it makes.
 *
 * `status` is the HTTP status, or the string "timeout" when our own abort fired,
 * or "network" when the request never reached a server at all. That distinction
 * is the whole point: a refresh that returned 400 and a refresh we cancelled
 * ourselves after 25 seconds are completely different bugs with completely
 * different fixes, and today they are indistinguishable after the fact.
 */
export function noteRequest(url: string, status: number | "timeout" | "network"): void {
  try {
    const t = now();
    const ok = typeof status === "number" && status >= 200 && status < 400;

    state.lastRequestAt = t;
    state.lastRequestStatus = status;
    state.lastRequestWasTimeout = status === "timeout";
    if (status === "timeout") state.timeoutsSeen += 1;

    if (isTokenRefreshUrl(url)) {
      state.lastRefreshAt = t;
      state.lastRefreshOk = ok;
      state.lastRefreshStatus = status;
      // Consecutive, not cumulative: one failure on a train is noise, four in a
      // row is a session about to end.
      state.refreshFailuresInARow = ok ? 0 : state.refreshFailuresInARow + 1;
    }
  } catch { /* a recorder must never be the reason a request fails */ }
}

/**
 * Declare that a sign-out was ASKED FOR, immediately before asking for it.
 *
 * Every deliberate sign-out path calls this. What is left over — a session that
 * ends with nothing declared — is the bug the owner reported, and it is
 * identifiable only because the deliberate ones announce themselves.
 */
export function declareSignOut(cause: SignOutCause, by: string): void {
  try {
    state.declaredCause = cause;
    state.declaredBy = by;
    state.declaredAt = now();
  } catch { /* never throw on the sign-out path */ }
}

/** Watch backgrounding. Idempotent; safe to call from more than one place. */
let visibilityInstalled = false;
export function installVisibilityObserver(doc: Document = document): void {
  try {
    if (visibilityInstalled || typeof doc?.addEventListener !== "function") return;
    visibilityInstalled = true;
    doc.addEventListener("visibilitychange", () => {
      try {
        if (doc.visibilityState === "hidden") {
          state.hiddenSince = now();
        } else if (state.hiddenSince !== null) {
          const hidden = now() - state.hiddenSince;
          state.longestHiddenMs = Math.max(state.longestHiddenMs, hidden);
          state.hiddenSince = null;
          state.lastResumeAt = now();
        }
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

/**
 * Is the Supabase session still in localStorage?
 *
 * Matched by SHAPE (`sb-<project-ref>-auth-token`) rather than by a hardcoded
 * key, so this keeps working if the project ref or the client's naming ever
 * changes — a recorder that silently answers "absent" because it was looking
 * for the wrong key would manufacture the very finding we are hunting.
 *
 * Returns null, not false, when storage cannot be read at all: "I could not
 * look" and "I looked and it was gone" are different facts.
 */
export function storedSessionPresent(store?: Storage): boolean | null {
  try {
    const s = store ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return null;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) return true;
    }
    return false;
  } catch {
    return null;
  }
}

/** Read every fact. Pure — calling it twice changes nothing. */
export function collectFacts(): SessionLossFacts {
  const t = now();
  const declaredRecently =
    state.declaredAt !== null && t - state.declaredAt <= RECENT_MS;

  return {
    cause: declaredRecently ? state.declaredCause! : "involuntary",
    declaredBy: declaredRecently ? state.declaredBy : null,
    msSinceDeclared: declaredRecently ? Math.round(t - state.declaredAt!) : null,

    lastRefreshAgoMs: state.lastRefreshAt === null ? null : Math.round(t - state.lastRefreshAt),
    lastRefreshOk: state.lastRefreshOk,
    lastRefreshStatus: state.lastRefreshStatus,
    refreshFailuresInARow: state.refreshFailuresInARow,

    lastRequestAgoMs: state.lastRequestAt === null ? null : Math.round(t - state.lastRequestAt),
    lastRequestStatus: state.lastRequestStatus,
    lastRequestWasTimeout: state.lastRequestWasTimeout,
    timeoutsSeen: state.timeoutsSeen,

    wasHiddenRecently:
      state.hiddenSince !== null ||
      (state.lastResumeAt !== null && t - state.lastResumeAt <= RECENT_MS),
    msSinceResume: state.lastResumeAt === null ? null : Math.round(t - state.lastResumeAt),
    longestHiddenMs: Math.round(state.longestHiddenMs),

    storedSessionPresent: storedSessionPresent(),

    sessionAgeMs: Math.round(t - state.startedAt),
    platform: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : "unknown",
    online: typeof navigator !== "undefined" && "onLine" in navigator ? navigator.onLine : null,
  };
}

/**
 * Claim the single recording slot for this page.
 *
 * Returns the facts the FIRST time a session ends and null every time after,
 * so a retry loop cannot turn one lost session into two hundred log rows. The
 * caller does the logging — see rule 1 at the top of this file.
 */
export function claimSessionLoss(): SessionLossFacts | null {
  try {
    if (state.recorded) return null;
    state.recorded = true;
    return collectFacts();
  } catch {
    return null;
  }
}

/**
 * A member signing back in makes the next loss a NEW event, so the slot and the
 * failure counters reset. Without this, a member who is signed out, signs in,
 * and is signed out again would report only the first — and "it keeps happening
 * to the same person" is exactly the pattern worth seeing.
 */
export function resetForNewSession(): void {
  try {
    state.recorded = false;
    state.declaredCause = null;
    state.declaredBy = null;
    state.declaredAt = null;
    state.refreshFailuresInARow = 0;
    state.startedAt = now();
  } catch { /* ignore */ }
}

/** Test seam. Not used by the app. */
export function TESTING_ONLY_reset(): void {
  Object.assign(state, {
    startedAt: now(),
    declaredCause: null, declaredBy: null, declaredAt: null,
    lastRefreshAt: null, lastRefreshOk: null, lastRefreshStatus: null, refreshFailuresInARow: 0,
    lastRequestAt: null, lastRequestStatus: null, lastRequestWasTimeout: false, timeoutsSeen: 0,
    hiddenSince: null, lastResumeAt: null, longestHiddenMs: 0,
    recorded: false,
  });
  visibilityInstalled = false;
}
