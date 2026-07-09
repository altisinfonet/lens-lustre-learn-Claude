/**
 * Phase 5 Step 5.1 — Multi-Judge Progress Panel
 * Shows other judges' progress in the sidebar.
 */
import { memo } from "react";
import { Camera, Users } from "lucide-react";
import type { JudgeProgress } from "@/hooks/judging/useMultiJudgeProgress";

const f = { fontFamily: "var(--font-heading)" };

interface JudgeProgressPanelProps {
  otherJudges: JudgeProgress[];
  isLoading: boolean;
}

const statusDot: Record<string, string> = {
  active: "bg-emerald-500 animate-pulse",
  paused: "bg-amber-500",
  completed: "bg-primary",
  inactive: "bg-muted-foreground/30",
};

const JudgeProgressPanel = memo(({ otherJudges, isLoading }: JudgeProgressPanelProps) => {
  if (isLoading || otherJudges.length === 0) return null;

  return (
    <div className="px-3 py-2.5 border-t border-border/30">
      <div className="flex items-center gap-1.5 mb-2">
        <Users className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[8px] tracking-[0.25em] uppercase text-muted-foreground/70" style={f}>
          Other Judges
        </span>
      </div>
      <div className="space-y-1.5">
        {otherJudges.map((judge) => {
          const pct = judge.totalEntries > 0 ? Math.round((judge.scoredCount / judge.totalEntries) * 100) : 0;
          return (
            <div key={judge.judgeId} className="flex items-center gap-2 py-1">
              {judge.judgeAvatar ? (
                <img loading="lazy" decoding="async" src={judge.judgeAvatar} alt="" className="w-5 h-5 rounded-full object-cover border border-border shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-muted/30 border border-border flex items-center justify-center shrink-0">
                  <Camera className="w-2.5 h-2.5 text-muted-foreground/40" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[judge.status] || statusDot.inactive}`} />
                  <span className="text-[10px] font-medium text-foreground truncate" style={f}>
                    {judge.judgeName}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[8px] text-muted-foreground/60 shrink-0 tabular-nums" style={f}>
                    {judge.scoredCount}/{judge.totalEntries}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

JudgeProgressPanel.displayName = "JudgeProgressPanel";
export default JudgeProgressPanel;
