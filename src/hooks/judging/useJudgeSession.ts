/**
 * useJudgeSession — Phase 1, Step 1.1
 * Manages judge session lifecycle: create/resume, heartbeat, idle detection, bookmarking.
 * Source of truth: judge_sessions table.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface JudgeSession {
  id: string;
  judge_id: string;
  competition_id: string;
  round_id: string | null;
  last_entry_id: string | null;
  last_entry_index: number;
  /** Per-photo bookmark index within the bookmarked entry (0-based). */
  last_photo_index: number;
  elapsed_seconds: number;
  status: string;
  heartbeat_at: string;
}

const HEARTBEAT_INTERVAL = 30_000; // 30s
const IDLE_SILENT_SAVE = 10_000; // 10s
const IDLE_WARNING = 120_000; // 2min
const IDLE_AUTO_PAUSE = 150_000; // 2.5min

/**
 * Phase 9 (Resilience & Sync — 2026-04-20):
 * localStorage-backed position mirror so that even when the user has NOT
 * clicked "Bookmark", a hard refresh or crash still restores the last-seen
 * (entry, photo). The DB row (`judge_sessions.last_entry_id` etc.) is the
 * authoritative fallback. This block adds a SECOND layer without touching the
 * existing bookmark contract — bookmarks still mean "intentional pin".
 *
 * Key format: `judge_resume_<competitionId>_session`
 * Payload   : { entry_id, entry_index, photo_index, ts }
 *
 * Scope-locked per Phase 9 SOW to this hook + the `judge_resume_*` key namespace.
 */
const POSITION_KEY = (compId: string) => `judge_resume_${compId}_session`;
type PersistedPosition = { entry_id: string; entry_index: number; photo_index: number; ts: number };
const readPosition = (compId: string): PersistedPosition | null => {
  try {
    const raw = localStorage.getItem(POSITION_KEY(compId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.entry_id !== "string") return null;
    return parsed as PersistedPosition;
  } catch { return null; }
};
const writePosition = (compId: string, pos: Omit<PersistedPosition, "ts">) => {
  try { localStorage.setItem(POSITION_KEY(compId), JSON.stringify({ ...pos, ts: Date.now() })); }
  catch { /* quota — non-fatal */ }
};
const clearPosition = (compId: string) => {
  try { localStorage.removeItem(POSITION_KEY(compId)); } catch { /* noop */ }
};

export function useJudgeSession(
  competitionId: string | null,
  userId: string | undefined,
) {
  const qc = useQueryClient();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());
  const elapsedTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [idleState, setIdleState] = useState<"active" | "warning" | "paused">("active");
  const [localElapsed, setLocalElapsed] = useState(0);
  const localElapsedRef = useRef(0);

  // Phase 9: live position tracker (not yet persisted to DB unless bookmarked).
  // Mirrored to localStorage on every update; flushed to DB by heartbeat & beforeunload.
  const positionRef = useRef<{ entry_id: string; entry_index: number; photo_index: number } | null>(null);
  const lastPositionDbWriteRef = useRef<number>(0);

  const queryKey = ["judge-session", competitionId, userId];

  // Fetch existing session.
  // Phase 9: if DB has no last_entry_id but localStorage holds a mirrored position,
  // fold that position into the returned JudgeSession so hasResumeData flips true
  // and the resume dialog can surface it. The DB is still written back in the
  // heartbeat so the next refresh is symmetrical.
  const { data: session, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<JudgeSession | null> => {
      const { data } = await supabase
        .from("judge_sessions" as any)
        .select("*")
        .eq("judge_id", userId!)
        .eq("competition_id", competitionId!)
        .maybeSingle();
      if (data) { setLocalElapsed((data as any).elapsed_seconds || 0); localElapsedRef.current = (data as any).elapsed_seconds || 0; }
      if (!data) return null;
      const row = data as any;
      if (!row.last_entry_id && competitionId) {
        const mirrored = readPosition(competitionId);
        if (mirrored) {
          row.last_entry_id = mirrored.entry_id;
          row.last_entry_index = mirrored.entry_index;
          row.last_photo_index = mirrored.photo_index;
          positionRef.current = {
            entry_id: mirrored.entry_id,
            entry_index: mirrored.entry_index,
            photo_index: mirrored.photo_index,
          };
        }
      } else if (row.last_entry_id) {
        // DB is authoritative — seed the in-memory tracker and localStorage mirror
        // so the two layers converge on the next flush.
        positionRef.current = {
          entry_id: row.last_entry_id,
          entry_index: row.last_entry_index ?? 0,
          photo_index: row.last_photo_index ?? 0,
        };
        if (competitionId) writePosition(competitionId, positionRef.current);
      }
      return row as JudgeSession;
    },
    enabled: !!competitionId && !!userId,
    staleTime: 60_000,
  });

  // Create or resume session
  const startSession = useCallback(async (roundId?: string | null) => {
    if (!competitionId || !userId) return null;

    const { data: existing } = await supabase
      .from("judge_sessions" as any)
      .select("*")
      .eq("judge_id", userId)
      .eq("competition_id", competitionId)
      .maybeSingle();

    if (existing) {
      // Resume: update status to active
      await supabase
        .from("judge_sessions" as any)
        .update({ status: "active", heartbeat_at: new Date().toISOString(), round_id: roundId || (existing as any).round_id } as any)
        .eq("id", (existing as any).id);
      setLocalElapsed((existing as any).elapsed_seconds || 0); localElapsedRef.current = (existing as any).elapsed_seconds || 0;
      setIdleState("active");
      qc.invalidateQueries({ queryKey });
      return (existing as any) as JudgeSession;
    }

    // Create new
    const { data: newSession } = await supabase
      .from("judge_sessions" as any)
      .insert({
        judge_id: userId,
        competition_id: competitionId,
        round_id: roundId || null,
        status: "active",
      } as any)
      .select("*")
      .single();

    setLocalElapsed(0); localElapsedRef.current = 0;
    setIdleState("active");
    qc.invalidateQueries({ queryKey });
    return (newSession as any) as JudgeSession | null;
  }, [competitionId, userId, qc, queryKey]);

  // Heartbeat: update heartbeat_at + elapsed_seconds every 30s.
  // Phase 9: ALSO flushes the in-memory position tracker to DB so an ambient
  // (un-bookmarked) viewing position survives a tab crash.
  useEffect(() => {
    if (!session || session.status !== "active" || idleState === "paused") return;

    heartbeatRef.current = setInterval(async () => {
      const patch: Record<string, unknown> = {
        heartbeat_at: new Date().toISOString(),
        elapsed_seconds: localElapsedRef.current,
      };
      const pos = positionRef.current;
      if (pos && pos.entry_id) {
        patch.last_entry_id = pos.entry_id;
        patch.last_entry_index = pos.entry_index;
        patch.last_photo_index = pos.photo_index;
        lastPositionDbWriteRef.current = Date.now();
      }
      await supabase
        .from("judge_sessions" as any)
        .update(patch as any)
        .eq("id", session.id);
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [session?.id, session?.status, idleState]);

  // Elapsed time counter (ticks every second when active)
  useEffect(() => {
    if (!session || idleState === "paused") {
      if (elapsedTickRef.current) clearInterval(elapsedTickRef.current);
      return;
    }

    elapsedTickRef.current = setInterval(() => {
      setLocalElapsed((prev) => { const next = prev + 1; localElapsedRef.current = next; return next; });
    }, 1000);

    return () => {
      if (elapsedTickRef.current) clearInterval(elapsedTickRef.current);
    };
  }, [session?.id, idleState]);

  // Idle detection
  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (idleState === "warning") setIdleState("active");

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    // Warning at 2min
    idleTimerRef.current = setTimeout(() => {
      setIdleState("warning");

      // Auto-pause at 2.5min
      setTimeout(() => {
        setIdleState("paused");
      }, IDLE_AUTO_PAUSE - IDLE_WARNING);
    }, IDLE_WARNING);
  }, [idleState]);

  // Listen to user activity
  useEffect(() => {
    if (!session || session.status !== "active") return;

    const handleActivity = () => resetIdleTimer();
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);

    resetIdleTimer(); // Start timer

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [session?.id, session?.status, resetIdleTimer]);

  // Bookmark a specific PHOTO within an entry (per-photo addressability).
  // entryIndex = sequential index within the active photo list (used for resume UI labels).
  // photoIndex = the index of the photo within the entry's photos[] array (0-based).
  const bookmark = useCallback(async (entryId: string, entryIndex: number, photoIndex: number = 0) => {
    if (!session) return;
    await supabase
      .from("judge_sessions" as any)
      .update({
        last_entry_id: entryId,
        last_entry_index: entryIndex,
        last_photo_index: photoIndex,
        elapsed_seconds: localElapsedRef.current,
      } as any)
      .eq("id", session.id);
    // Phase 9: keep the localStorage mirror in lock-step so the two layers
    // never diverge after an intentional bookmark.
    positionRef.current = { entry_id: entryId, entry_index: entryIndex, photo_index: photoIndex };
    if (competitionId) writePosition(competitionId, positionRef.current);
    qc.invalidateQueries({ queryKey });
  }, [session?.id, competitionId, qc, queryKey]);

  // Clear bookmark (unset last_entry_id + last_photo_index)
  const clearBookmark = useCallback(async () => {
    if (!session) return;
    await supabase
      .from("judge_sessions" as any)
      .update({
        last_entry_id: null,
        last_entry_index: 0,
        last_photo_index: 0,
        elapsed_seconds: localElapsedRef.current,
      } as any)
      .eq("id", session.id);
    // Phase 9: clearing an intentional bookmark ALSO wipes the ambient mirror.
    positionRef.current = null;
    if (competitionId) clearPosition(competitionId);
    qc.invalidateQueries({ queryKey });
  }, [session?.id, competitionId, qc, queryKey]);

  // Toggle bookmark on a specific (entry, photo) pair.
  // If THIS exact photo is already bookmarked → clear; otherwise set.
  // (Bookmarking photo #2 of entry X when photo #4 was bookmarked moves the pin to photo #2.)
  const toggleBookmark = useCallback(async (entryId: string, entryIndex: number, photoIndex: number = 0) => {
    if (!session) return;
    const sameEntry = session.last_entry_id === entryId;
    const samePhoto = (session.last_photo_index ?? 0) === photoIndex;
    if (sameEntry && samePhoto) {
      await clearBookmark();
    } else {
      await bookmark(entryId, entryIndex, photoIndex);
    }
  }, [session?.id, session?.last_entry_id, session?.last_photo_index, bookmark, clearBookmark]);

  /**
   * Phase 9: AMBIENT position tracker — distinct from intentional bookmark.
   * Callers SHOULD call this on every photo selection change. The update is
   * synchronous into memory + localStorage (no network round-trip), and the
   * heartbeat effect flushes to DB at most every 30 s. Also piggybacks on
   * beforeunload via keepalive PATCH. This closes the crash-recovery gap when
   * the judge has not intentionally bookmarked.
   */
  const trackPosition = useCallback(
    (entryId: string, entryIndex: number, photoIndex: number = 0) => {
      if (!competitionId || !entryId) return;
      positionRef.current = { entry_id: entryId, entry_index: entryIndex, photo_index: photoIndex };
      writePosition(competitionId, positionRef.current);
    },
    [competitionId],
  );

  // Pause session
  const pauseSession = useCallback(async () => {
    if (!session) return;
    setIdleState("paused");
    await supabase
      .from("judge_sessions" as any)
      .update({
        status: "paused",
        elapsed_seconds: localElapsedRef.current,
        heartbeat_at: new Date().toISOString(),
      } as any)
      .eq("id", session.id);
    qc.invalidateQueries({ queryKey });
  }, [session?.id, qc, queryKey]);

  // Resume from pause
  const resumeSession = useCallback(async () => {
    if (!session) return;
    setIdleState("active");
    await supabase
      .from("judge_sessions" as any)
      .update({
        status: "active",
        heartbeat_at: new Date().toISOString(),
      } as any)
      .eq("id", session.id);
    qc.invalidateQueries({ queryKey });
  }, [session?.id, qc, queryKey]);

  // Update round in session
  const updateSessionRound = useCallback(async (roundId: string) => {
    if (!session) return;
    await supabase
      .from("judge_sessions" as any)
      .update({ round_id: roundId } as any)
      .eq("id", session.id);
  }, [session?.id]);

  // Save all pending on beforeunload using fetch keepalive with proper auth.
  // Phase 9: include the live position tracker so an un-bookmarked tab-close
  // still persists the last-seen (entry, photo) to DB.
  useEffect(() => {
    if (!session) return;
    const handleBeforeUnload = () => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/judge_sessions?id=eq.${session.id}`;
      const payload: Record<string, unknown> = {
        elapsed_seconds: localElapsedRef.current,
        heartbeat_at: new Date().toISOString(),
      };
      const pos = positionRef.current;
      if (pos && pos.entry_id) {
        payload.last_entry_id = pos.entry_id;
        payload.last_entry_index = pos.entry_index;
        payload.last_photo_index = pos.photo_index;
      }
      const body = JSON.stringify(payload);
      // Extract auth token from localStorage (Supabase stores it there)
      let authToken = "";
      try {
        const storageKey = Object.keys(localStorage).find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
        if (storageKey) {
          const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
          authToken = stored?.access_token || "";
        }
      } catch { /* ignore */ }
      try {
        fetch(url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${authToken}`,
            "Prefer": "return=minimal",
          },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Last resort: fire-and-forget
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [session?.id]);

  return {
    session,
    isLoading,
    idleState,
    elapsedSeconds: localElapsed,
    startSession,
    pauseSession,
    resumeSession,
    bookmark,
    clearBookmark,
    toggleBookmark,
    trackPosition,
    updateSessionRound,
    resetIdleTimer,
    hasResumeData:
      (!!session?.last_entry_id && session.status !== "completed") ||
      (!!competitionId && !!readPosition(competitionId) && session?.status !== "completed"),
  };
}
