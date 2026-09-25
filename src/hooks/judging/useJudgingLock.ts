import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

import { logger } from "@/lib/logger";

const FILE = "src/hooks/judging/useJudgingLock.ts";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const LOCK_TTL_MINUTES = 5;

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
 * - Heartbeats every 2 minutes to extend lock
 * - Releases lock on deselection, unmount, or page teardown (`pagehide`)
 */
export function useJudgingLock(
  judgeId: string | undefined,
  entryId: string | null,
  photoIndex: number | null
) {
  const [lockState, setLockState] = useState<LockState>(IDLE);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
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

      const result = data as any;
      if (result?.acquired) {
        activeRef.current = { entryId: eid, photoIndex: pi };
        setLockState({
          isLocked: true,
          lockedByOther: false,
          lockedByJudgeId: null,
          expiresAt: null,
        });

        // Start heartbeat
        clearHeartbeat();
        heartbeatRef.current = setInterval(async () => {
          if (!judgeIdRef.current || !activeRef.current) return;
          try {
            await supabase.rpc("heartbeat_judge_lock", {
              _entry_id: activeRef.current.entryId,
              _photo_index: activeRef.current.photoIndex,
              _judge_id: judgeIdRef.current,
              _ttl_minutes: LOCK_TTL_MINUTES,
            });
          } catch {
            // Heartbeat failure is non-fatal; lock will expire naturally
          }
        }, HEARTBEAT_INTERVAL_MS);
      } else {
        setLockState({
          isLocked: false,
          lockedByOther: true,
          lockedByJudgeId: result?.locked_by || null,
          expiresAt: result?.expires_at || null,
        });
      }
    },
    [clearHeartbeat]
  );

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
