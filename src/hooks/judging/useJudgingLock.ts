import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
 * - Releases lock on deselection, unmount, or page unload
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
        console.warn("[JudgingLock] acquire error:", error.message);
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

  // Release on page unload (beforeunload)
  useEffect(() => {
    const handleUnload = () => {
      const active = activeRef.current;
      const jid = judgeIdRef.current;
      if (!active || !jid) return;
      // Use sendBeacon with proper auth headers via Blob
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_judge_lock`;
      const body = JSON.stringify({
        _entry_id: active.entryId,
        _photo_index: active.photoIndex,
        _judge_id: jid,
      });
      const headers = {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };
      // sendBeacon can't set custom headers; use fetch with keepalive instead
      try {
        fetch(url, {
          method: "POST",
          headers,
          body,
          keepalive: true,
        });
      } catch {
        // Best-effort; TTL will expire the lock
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  return {
    ...lockState,
    releaseLock,
  };
}
