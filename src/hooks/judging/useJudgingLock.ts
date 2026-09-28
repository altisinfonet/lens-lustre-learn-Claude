import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { startVisibilityInterval, type TickInfo } from "@/lib/timers/visibilityInterval";

import { logger } from "@/lib/logger";

const FILE = "src/hooks/judging/useJudgingLock.ts";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const LOCK_TTL_MINUTES = 5;

/**
 * What `acquire_judge_lock` returns, from the function itself
 * (`supabase/migrations/20260326091904_*.sql:60-94`): a `jsonb_build_object`
 * with `acquired` always present, `lock_id` on success, and `locked_by` plus
 * `expires_at` on refusal. Every field is read defensively below anyway,
 * because this shape is the database's to change and TypeScript cannot see it.
 *
 * WHY THIS TYPE EXISTS AT ALL. It was `data as any`. `audit-v6/no-as-any-in-
 * protected-dirs` baselines that site by FILE AND LINE, so it was already red
 * on `staging` (the baseline pins line 82; the cast had drifted to 94) and this
 * unit's edits moved it again. The rule offers two ways out and says which is
 * preferred: remove the cast, or re-baseline in a follow-up phase. This removes
 * it. Re-baselining would have recorded the drift as acceptable and left the
 * next reader with the same puzzle.
 */
interface AcquireLockResult {
  acquired?: boolean;
  lock_id?: string | null;
  locked_by?: string | null;
  expires_at?: string | null;
}

interface LockState {
  isLocked: boolean;
  lockedByOther: boolean;
  lockedByJudgeId: string | null;
  expiresAt: string | null;
}

const IDLE: LockState = {
  isLocked: false,
  lockedByOther: false,
  lockedByJudgeId: null,
  expiresAt: null,
};

/**
 * Manages a session lock on a specific entry+photo_index.
 * - Acquires lock when entryId/photoIndex are set
 * - Heartbeats every 2 minutes to extend lock, and re-acquires when that
 *   heartbeat says the lock is no longer this judge's (R-63 / P10-J1)
 * - Releases lock on deselection, unmount, or page teardown (`pagehide`)
 */
export function useJudgingLock(
  judgeId: string | undefined,
  entryId: string | null,
  photoIndex: number | null
) {
  const [lockState, setLockState] = useState<LockState>(IDLE);
  /** The heartbeat's teardown, not a timer id — see the note at the start. */
  const heartbeatRef = useRef<(() => void) | null>(null);
  const activeRef = useRef<{ entryId: string; photoIndex: number } | null>(null);
  const judgeIdRef = useRef(judgeId);
  judgeIdRef.current = judgeId;

  /* The teardown release at the bottom of this file may not await anything, and
   * `supabase.auth.getSession()` is async. So the access token is mirrored into
   * a ref on every render and read synchronously there. It is taken from the
   * single `onAuthStateChange` subscription `AuthProvider` already owns — a
   * second subscription here would be a second way to do the same thing. */
  const { session } = useAuth();
  const accessTokenRef = useRef<string | null>(session?.access_token ?? null);
  accessTokenRef.current = session?.access_token ?? null;

  /* The heartbeat has to be able to call `acquireLock`, and `acquireLock`
   * starts the heartbeat. A ref breaks the cycle without putting `acquireLock`
   * in its own dependency list — the alternative is a second copy of the
   * acquire logic inside the heartbeat, which is how the two would drift. */
  const acquireLockRef = useRef<((eid: string, pi: number) => Promise<void>) | null>(null);
  /** Guards against two overlapping re-acquires (a resume tick landing on an
   *  interval tick's heels), which would race for the same lock row. */
  const reacquiringRef = useRef(false);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      heartbeatRef.current();
      heartbeatRef.current = null;
    }
  }, []);

  const releaseLock = useCallback(async () => {
    const active = activeRef.current;
    const jid = judgeIdRef.current;
    if (!active || !jid) return;

    activeRef.current = null;
    clearHeartbeat();
    setLockState(IDLE);

    try {
      await supabase.rpc("release_judge_lock", {
        _entry_id: active.entryId,
        _photo_index: active.photoIndex,
        _judge_id: jid,
      });
    } catch {
      // Best-effort release; TTL will auto-expire
    }
  }, [clearHeartbeat]);

  /* ── THE HEARTBEAT, AND WHAT IT DOES WITH THE ANSWER. R-63 / P10-J1. ──
   *
   * WHAT WAS WRONG. `heartbeat_judge_lock(uuid, integer, uuid, integer)` is
   * `RETURNS boolean`, and the boolean is `FOUND` from an UPDATE filtered by
   * `judge_id`: FALSE means the lock row is no longer this judge's — it
   * expired and somebody else took it. This function used to `await` that call
   * and drop the result on the floor, inside a `catch` that dropped the failure
   * too. So a judge whose tab was hidden past LOCK_TTL_MINUTES came back to
   * `isLocked: true`, kept heartbeating a row that was not theirs, and scored a
   * photo another judge was also scoring. Two judges, one photo, no symptom.
   *
   * WHAT IT DOES NOW.
   *   · `false` → the lock is gone. Re-acquire, and let `acquireLock` report
   *     what it finds: if another judge holds it, the `lockedByOther` branch
   *     below puts that on screen, which is the state the UI already renders.
   *   · a failure on the first tick after resume → treat it as gone, for the
   *     same reason. The tab was hidden for an unknown length of time, so the
   *     one thing this tick was for is the one thing it did not establish.
   *     Re-acquiring is idempotent when the lock is still ours; assuming is not.
   *   · a failure on an ordinary interval tick → non-fatal, as before. The
   *     judge is demonstrably here, at most two minutes of TTL is at stake, and
   *     dropping a working judge out of a round on one flaky request would be a
   *     worse failure than the one being fixed.
   *
   * THE ASYMMETRY IS THE POINT, so it is stated rather than inferred: after a
   * gap this code knows nothing, and during a session it knows the judge is
   * present. `TickInfo.firstTickAfterResume` is the only thing that separates
   * those two cases, and only the timer can produce it.
   */
  const heartbeatTick = useCallback(
    async (info: TickInfo) => {
      const active = activeRef.current;
      const jid = judgeIdRef.current;
      if (!active || !jid || reacquiringRef.current) return;

      let stillOurs: boolean;
      try {
        const { data, error } = await supabase.rpc("heartbeat_judge_lock", {
          _entry_id: active.entryId,
          _photo_index: active.photoIndex,
          _judge_id: jid,
          _ttl_minutes: LOCK_TTL_MINUTES,
        });
        // PostgREST reports a refusal in `error`, not by throwing; a network
        // fault throws. Both are "this tick did not extend the lock".
        if (error) throw new Error(error.message);
        stillOurs = data === true;
      } catch {
        if (!info.firstTickAfterResume) return; // mid-session: non-fatal
        stillOurs = false;
      }

      if (stillOurs) return;

      logger.warn({
        code: "JUDGE-6108", event: "JUDGING_LOCK_LOST",
        fn: "useJudgingLock", file: FILE,
        message: "The judging lock is no longer held by this judge; re-acquiring.",
        reason: info.firstTickAfterResume
          ? "The first heartbeat after the tab became visible again did not confirm the lock."
          : "heartbeat_judge_lock returned false, so the lock row is not this judge's.",
        expected: "The heartbeat extends a lock this judge still holds",
        actual: "The lock had expired or been taken by another judge",
        nextStep: "None if the re-acquire succeeds. If judges report losing rounds mid-session, LOCK_TTL_MINUTES is shorter than the work takes.",
      });

      /* Stop asserting a claim we do not have before asking for it again. The
       * old heartbeat is torn down inside `acquireLock`'s success branch; the
       * release path must not send a release for a row another judge owns, so
       * `activeRef` is cleared first and only set again if we win it back. */
      reacquiringRef.current = true;
      activeRef.current = null;
      clearHeartbeat();
      try {
        await acquireLockRef.current?.(active.entryId, active.photoIndex);
      } finally {
        reacquiringRef.current = false;
      }
    },
    [clearHeartbeat],
  );

  const acquireLock = useCallback(
    async (eid: string, pi: number) => {
      if (!judgeIdRef.current) return;

      const { data, error } = await supabase.rpc("acquire_judge_lock", {
        _entry_id: eid,
        _photo_index: pi,
        _judge_id: judgeIdRef.current,
        _ttl_minutes: LOCK_TTL_MINUTES,
      });

      if (error) {
        logger.warn({
          code: "JUDGE-6106", event: "JUDGING_LOCK_NOT_ACQUIRED",
          fn: "useJudgingLock", file: FILE,
          message: "The judging lock could not be acquired.",
          reason: error.message,
          expected: "An exclusive lock on this round",
          actual: "The lock was refused",
          nextStep: "Usually correct \u2014 another judge holds the round. Investigate only if the same judge is blocked repeatedly, which means a stale lock rather than a busy one.",
        });
        setLockState(IDLE);
        return;
      }

      const result = (data ?? null) as AcquireLockResult | null;
      if (result?.acquired) {
        activeRef.current = { entryId: eid, photoIndex: pi };
        setLockState({
          isLocked: true,
          lockedByOther: false,
          lockedByJudgeId: null,
          expiresAt: null,
        });

        /* ── Start heartbeat. P10. ──
         *
         * The heartbeat extends a TTL-based lock every two minutes, through
         * `startVisibilityInterval`, so it STOPS while the judge's tab is
         * hidden or the app is backgrounded and resumes when it is back. That
         * is P10's clause, and it is also the honest semantics: a heartbeat is
         * a claim that this judge is working on this entry, and a background
         * tab is not working on it.
         *
         * THE CONSEQUENCE, stated rather than discovered: a judge who leaves
         * the tab hidden for longer than LOCK_TTL_MINUTES loses the lock and
         * another judge can take the round. That is what the TTL is for, and it
         * matches the teardown reasoning in the release path at the bottom of
         * this file. It was raised with the Auditor under 2-D2-04 and accepted
         * in R-63 — which is also where the silent half of it was ruled a
         * defect: losing the lock is fine, not NOTICING is not. See
         * `heartbeatTick` above.
         *
         * `runOnResume`, not `runOnVisible`: the first thing this hook does on
         * coming back is check the lock, and the last thing it needs is a
         * heartbeat one millisecond after the acquire that started the timer.
         */
        clearHeartbeat();
        heartbeatRef.current = startVisibilityInterval(
          (info) => { void heartbeatTick(info); },
          HEARTBEAT_INTERVAL_MS,
          { runOnResume: true },
        );
      } else {
        setLockState({
          isLocked: false,
          lockedByOther: true,
          lockedByJudgeId: result?.locked_by || null,
          expiresAt: result?.expires_at || null,
        });
      }
    },
    [clearHeartbeat, heartbeatTick]
  );

  /* Published for `heartbeatTick`, which is defined above it. Assigned on every
   * render so the heartbeat never calls a stale closure. */
  acquireLockRef.current = acquireLock;

  // Acquire/release when target changes
  useEffect(() => {
    const prev = activeRef.current;
    const hasTarget = entryId && photoIndex !== null && judgeId;

    if (prev) {
      // Target changed or cleared — release previous
      if (!hasTarget || prev.entryId !== entryId || prev.photoIndex !== photoIndex) {
        releaseLock().then(() => {
          if (hasTarget && entryId && photoIndex !== null) {
            acquireLock(entryId, photoIndex);
          }
        });
        return;
      }
      // Same target — keep lock
      return;
    }

    // No previous lock, acquire new
    if (hasTarget && entryId && photoIndex !== null) {
      acquireLock(entryId, photoIndex);
    }
  }, [entryId, photoIndex, judgeId, acquireLock, releaseLock]);

  // Release on unmount
  useEffect(() => {
    return () => {
      clearHeartbeat();
      const active = activeRef.current;
      const jid = judgeIdRef.current;
      if (active && jid) {
        // Fire-and-forget release
        supabase
          .rpc("release_judge_lock", {
            _entry_id: active.entryId,
            _photo_index: active.photoIndex,
            _judge_id: jid,
          })
          .then(() => {});
        activeRef.current = null;
      }
    };
  }, [clearHeartbeat]);

  /* ── THE TEARDOWN RELEASE: AUTHORIZED, OR NOT SENT AT ALL. ──
   *
   * WHAT WAS WRONG. This request carried `apikey` and nothing else. PostgREST
   * takes the role from the JWT in `Authorization`; with only `apikey` present
   * it executes the call as `anon`, not as the signed-in judge. Once PR #276
   * closes `release_judge_lock` to `anon`, every one of these would come back
   * `42501` — and nothing would have said so: the fetch is not awaited, its
   * rejection was swallowed by an empty `catch`, and no test ran this line. The
   * only symptom would have been judges’ locks sitting untouched until their
   * TTL expired. The silence was as much the defect as the missing header, so
   * both are fixed here and both are pinned by
   * `__tests__/useJudgingLockUnloadAuth.test.tsx`.
   *
   * WHY NO TOKEN MEANS NO REQUEST. An unauthenticated release is a request the
   * server will refuse. Sending it anyway would replace a plainly missing
   * session with a 401/403 nobody reads, so when the ref is empty this sends
   * nothing at all and leaves the lock to its TTL.
   *
   * WHY `pagehide` AND NOT `beforeunload`. `beforeunload` is not fired when a
   * mobile browser or the Android WebView discards the page — which is most of
   * how this app is used. `pagehide` is. `event.persisted` separates the two
   * cases: `true` means the page went into the back/forward cache and will come
   * back with this hook’s state, its `activeRef` and its heartbeat intact, so
   * releasing there would strand a judge holding a lock the server has already
   * given away. Only `persisted === false` is a teardown.
   *
   * THIS IS NOT RELIABLE DELIVERY AND MUST NOT BE READ AS ONE. A `keepalive`
   * fetch can be dropped in flight, a tab killed by the OS fires no event at
   * all, and a reaped WebView fires nothing either. `LOCK_TTL_MINUTES` above is
   * the backstop and remains the only actual guarantee that a lock is given up.
   * This handler exists to make the common case prompt, not to make a promise.
   */
  useEffect(() => {
    const releaseOnTeardown = (event: PageTransitionEvent) => {
      // Back/forward cache: the page is coming back, and so is its lock.
      if (event.persisted) return;

      const active = activeRef.current;
      const jid = judgeIdRef.current;
      if (!active || !jid) return;

      // Synchronous read — nothing in a teardown handler may await.
      const accessToken = accessTokenRef.current;
      if (!accessToken) return;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_judge_lock`;
      try {
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            // The signed-in judge. Without this the call runs as `anon`.
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            _entry_id: active.entryId,
            _photo_index: active.photoIndex,
            _judge_id: jid,
          }),
          keepalive: true,
        });
      } catch {
        // Best-effort; the TTL is what actually expires the lock.
      }
    };

    window.addEventListener("pagehide", releaseOnTeardown);
    return () => window.removeEventListener("pagehide", releaseOnTeardown);
  }, []);

  return {
    ...lockState,
    releaseLock,
  };
}
