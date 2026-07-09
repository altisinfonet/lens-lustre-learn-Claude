/**
 * Phase 3 Step 3.1 — Idle Warning + Auto-Pause Overlay
 * Shows at 2min idle warning, full overlay at 2.5min auto-pause.
 *
 * SOW v2.1 Step 3 (B): framer-motion replaced with Tailwind CSS animations
 * (animate-in / fade-in / zoom-in) — keeps motion identical, removes ~55KB
 * eager motion dep from /judge first-paint chunk.
 */
import { AlertTriangle, Play, Pause } from "lucide-react";

interface IdleOverlayProps {
  idleState: "active" | "warning" | "paused";
  elapsedSeconds: number;
  onResume: () => void;
  onPause: () => void;
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const IdleOverlay = ({ idleState, elapsedSeconds, onResume, onPause }: IdleOverlayProps) => {
  if (idleState === "active") return null;

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center animate-in fade-in duration-200"
      style={{ backgroundColor: idleState === "paused" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.5)" }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center space-y-5 animate-in zoom-in-95 fade-in duration-200">
        <button
          type="button"
          onClick={idleState === "paused" ? onResume : onPause}
          aria-label={idleState === "paused" ? "Resume judging" : "Pause now"}
          title={idleState === "paused" ? "Click to resume" : "Click to pause now"}
          className="w-14 h-14 rounded-full mx-auto flex items-center justify-center transition-transform hover:scale-110 active:scale-95 hover:ring-2 hover:ring-primary/40 cursor-pointer"
          style={{ backgroundColor: idleState === "paused" ? "hsl(var(--destructive) / 0.15)" : "hsl(var(--primary) / 0.15)" }}
        >
          {idleState === "paused" ? (
            <Pause className="h-6 w-6 text-destructive" />
          ) : (
            <AlertTriangle className="h-6 w-6 text-primary" />
          )}
        </button>

        <div>
          <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            {idleState === "paused" ? "Session Paused" : "Still judging?"}
          </h2>
          <p className="text-sm text-muted-foreground mt-2" style={{ fontFamily: "var(--font-body)" }}>
            {idleState === "paused"
              ? "Your session was auto-paused after inactivity. Your progress has been saved — you can resume from exactly where you left off."
              : "No activity detected for 2 minutes. Your session will auto-pause in 30 seconds to save your progress."}
          </p>
        </div>

        <div className="text-xs text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>
          Session time: {formatTime(elapsedSeconds)}
        </div>

        <button
          onClick={onResume}
          className="w-full flex items-center justify-center gap-2 text-sm font-bold px-6 py-3 rounded-xl text-primary-foreground transition-colors"
          style={{ fontFamily: "var(--font-heading)", background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--ring)))" }}
        >
          <Play className="h-4 w-4" />
          {idleState === "paused" ? "Resume Judging" : "I'm Still Here"}
        </button>

        {idleState === "warning" && (
          <button
            onClick={onPause}
            className="w-full text-xs text-muted-foreground/60 hover:text-foreground transition-colors py-2"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Pause Now
          </button>
        )}
      </div>
    </div>
  );
};

export default IdleOverlay;
