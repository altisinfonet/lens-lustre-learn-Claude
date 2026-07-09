import { memo } from "react";
import { Play, Eye, X } from "lucide-react";

/**
 * SOW v2.1 Step 3 (B): framer-motion replaced with Tailwind CSS animations.
 */

const f = { fontFamily: "var(--font-heading)" };

interface StartJudgingPromptProps {
  open: boolean;
  roundName: string;
  onStartJudging: () => void;
  onViewOnly: () => void;
  onClose: () => void;
}

const StartJudgingPrompt = memo(({ open, roundName, onStartJudging, onViewOnly, onClose }: StartJudgingPromptProps) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-[380px] max-w-[90vw] animate-in zoom-in-95 fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Start Initial Screening?
          </h3>
          <button onClick={onClose} className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[12px] text-muted-foreground mb-5 leading-relaxed" style={f}>
          You're about to open <span className="text-foreground font-semibold">{roundName}</span>.
          Would you like to start judging or just preview the entries?
        </p>

        <div className="space-y-2">
          <button
            onClick={onStartJudging}
            className="w-full flex items-center justify-center gap-2 text-[13px] font-bold px-4 py-3 rounded-xl text-primary-foreground transition-all hover:opacity-90"
            style={{ ...f, background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--ring)))" }}
          >
            <Play className="h-4 w-4" />
            Start Judging — {roundName}
          </button>
          <button
            onClick={onViewOnly}
            className="w-full flex items-center justify-center gap-2 text-[12px] font-medium px-4 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-all"
            style={f}
          >
            <Eye className="h-4 w-4" />
            View Only (No scoring)
          </button>
        </div>
      </div>
    </div>
  );
});

StartJudgingPrompt.displayName = "StartJudgingPrompt";
export default StartJudgingPrompt;
