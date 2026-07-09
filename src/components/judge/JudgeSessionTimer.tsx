import { useEffect, useState, useRef } from "react";
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
  const [localTime, setLocalTime] = useState(0);
  const [entryTime, setEntryTime] = useState(0);
  const [entriesJudged, setEntriesJudged] = useState(0);
  const lastEntryRef = useRef<string | null>(null);

  // Local fallback timer (only if sessionElapsed not provided)
  useEffect(() => {
    if (!isActive || sessionElapsed !== undefined) return;
    const interval = setInterval(() => setLocalTime(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isActive, sessionElapsed]);

  // Per-entry timer
  useEffect(() => {
    if (!entryId) return;
    if (lastEntryRef.current && lastEntryRef.current !== entryId) {
      setEntriesJudged(c => c + 1);
    }
    lastEntryRef.current = entryId;
    setEntryTime(0);
    if (!isActive) return;
    const interval = setInterval(() => setEntryTime(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [entryId, isActive]);

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
