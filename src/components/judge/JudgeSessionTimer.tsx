import { useEffect, useState, useRef } from "react";
import { useVisibilityInterval } from "@/lib/timers/visibilityInterval";
import { Clock, BarChart3 } from "lucide-react";

interface JudgeSessionTimerProps {
  isActive: boolean;
  entryId: string | null;
  darkMode?: boolean;
  /** Session elapsed seconds from useJudgeSession (DB-backed, resumable) */
  sessionElapsed?: number;
}

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const JudgeSessionTimer = ({ isActive, entryId, darkMode, sessionElapsed }: JudgeSessionTimerProps) => {
  // Use DB-backed session elapsed when available, else fall back to local counter
  const entryStartRef = useRef<number | null>(null);
  const [, setEntryTick] = useState(0);
  const [entriesJudged, setEntriesJudged] = useState(0);
  const lastEntryRef = useRef<string | null>(null);

  /* ── P10: DERIVED FROM A TIMESTAMP, NOT ACCUMULATED. ──
   *
   * This used to be `setInterval(() => setLocalTime(t => t + 1), 1000)`. An
   * accumulator is wrong twice over: it drifts, because a 1000 ms timer is not
   * a 1000 ms clock; and it STOPS COUNTING whenever the tab is hidden, so a
   * judge who switched apps for four minutes came back to a session timer that
   * had lost four minutes. Anchoring to a start timestamp fixes both, and it is
   * what makes the timer safe to stop while hidden — which is the other half of
   * P10. The tick below exists only to cause a re-render; the number on screen
   * is computed from the clock every time.
   */
  const localStartRef = useRef<number | null>(null);
  const [, setLocalTick] = useState(0);

  useEffect(() => {
    if (!isActive || sessionElapsed !== undefined) {
      localStartRef.current = null;
      return;
    }
    localStartRef.current = Date.now();
    setLocalTick((n) => n + 1);
  }, [isActive, sessionElapsed]);

  useVisibilityInterval(
    () => setLocalTick((n) => n + 1),
    isActive && sessionElapsed === undefined ? 1000 : null,
    { runOnVisible: true },
  );

  const localTime =
    localStartRef.current === null
      ? 0
      : Math.floor((Date.now() - localStartRef.current) / 1000);

  // Per-entry timer
  useEffect(() => {
    if (!entryId) return;
    if (lastEntryRef.current && lastEntryRef.current !== entryId) {
      setEntriesJudged(c => c + 1);
    }
    lastEntryRef.current = entryId;
    // P10: same reasoning as the session timer above — anchor, do not accumulate.
    entryStartRef.current = isActive ? Date.now() : null;
    setEntryTick((n) => n + 1);
  }, [entryId, isActive]);

  useVisibilityInterval(
    () => setEntryTick((n) => n + 1),
    entryId && isActive ? 1000 : null,
    { runOnVisible: true },
  );

  const entryTime =
    entryStartRef.current === null
      ? 0
      : Math.floor((Date.now() - entryStartRef.current) / 1000);

  const displayTime = sessionElapsed !== undefined ? sessionElapsed : localTime;
  const avgTime = entriesJudged > 0 ? Math.round(displayTime / entriesJudged) : 0;
  const textColor = darkMode ? "text-white/50" : "text-muted-foreground";
  const labelColor = darkMode ? "text-white/30" : "text-muted-foreground/60";

  return (
    <div className={`flex items-center gap-3 text-[9px] ${textColor}`} style={{ fontFamily: "var(--font-heading)" }}>
      <div className="flex items-center gap-1" title="Session time">
        <Clock className="h-3 w-3" />
        <span className="tabular-nums">{formatTime(displayTime)}</span>
      </div>
      {entryId && (
        <div className="flex items-center gap-1" title="Time on current entry">
          <span className={`${labelColor}`}>Entry:</span>
          <span className="tabular-nums">{formatTime(entryTime)}</span>
        </div>
      )}
      {entriesJudged > 0 && (
        <div className="flex items-center gap-1" title="Average time per entry">
          <BarChart3 className="h-3 w-3" />
          <span className="tabular-nums">~{formatTime(avgTime)}/entry</span>
          <span className={labelColor}>({entriesJudged})</span>
        </div>
      )}
    </div>
  );
};

export default JudgeSessionTimer;
