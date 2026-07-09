/**
 * Phase 3 Step 3.3 — Crash Recovery Resume Dialog
 * Shown when judge enters /judge and has an active/paused session with bookmark.
 *
 * SOW v2.1 Step 3 (B): framer-motion replaced with Tailwind CSS animations.
 */
import { RotateCcw, SkipForward } from "lucide-react";

interface ResumeSessionDialogProps {
  competitionTitle: string;
  lastEntryIndex: number;
  elapsedSeconds: number;
  onResume: () => void;
  onStartFresh: () => void;
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const ResumeSessionDialog = ({ competitionTitle, lastEntryIndex, elapsedSeconds, onResume, onStartFresh }: ResumeSessionDialogProps) => {
  return (
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-8 text-center space-y-5 animate-in zoom-in-95 fade-in duration-200">
        <div className="w-14 h-14 rounded-full bg-primary/15 mx-auto flex items-center justify-center">
          <RotateCcw className="h-6 w-6 text-primary" />
        </div>

        <div>
          <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Resume Previous Session?
          </h2>
          <p className="text-sm text-muted-foreground mt-2" style={{ fontFamily: "var(--font-body)" }}>
            You have an unfinished judging session for <strong className="text-foreground">{competitionTitle}</strong>.
          </p>
        </div>

        <div className="flex justify-center gap-6 text-xs text-muted-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>
          <div>
            <span className="block text-foreground text-sm font-bold">{lastEntryIndex + 1}</span>
            Last image
          </div>
          <div className="w-px bg-border" />
          <div>
            <span className="block text-foreground text-sm font-bold">{formatTime(elapsedSeconds)}</span>
            Time spent
          </div>
        </div>

        <div className="space-y-2.5">
          <button
            onClick={onResume}
            className="w-full flex items-center justify-center gap-2 text-sm font-bold px-6 py-3 rounded-xl text-primary-foreground transition-colors"
            style={{ fontFamily: "var(--font-heading)", background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--ring)))" }}
          >
            <RotateCcw className="h-4 w-4" />
            Resume from Image {lastEntryIndex + 1}
          </button>
          <button
            onClick={onStartFresh}
            className="w-full text-xs text-muted-foreground/60 hover:text-foreground transition-colors py-2"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <SkipForward className="h-3 w-3 inline mr-1" />
            Start from Beginning
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResumeSessionDialog;
