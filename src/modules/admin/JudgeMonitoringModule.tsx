/**
 * Judge Monitoring Module — extracted from AdminPanel.tsx
 */
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useAdminCompetitions } from "@/hooks/admin/useAdminCompetitions";

const AdminJudgeMonitoringPanel = lazy(() => import("@/components/admin/AdminJudgeMonitoringPanel"));
const AdminCompetitionFunnel = lazy(() => import("@/components/admin/AdminCompetitionFunnel"));

const JudgeMonitoringModule = () => {
  const { competitions } = useAdminCompetitions();
  const judgingComps = competitions.filter(c => c.phase === "judging");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Judging</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Judge <em className="italic text-primary">Monitoring</em>
        </h2>
        <p className="text-xs text-muted-foreground mt-2 max-w-md" style={{ fontFamily: "var(--font-body)" }}>
          Track judge progress and identify inactive judges per competition.
        </p>
      </div>
      {competitions.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-sm">
          <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            No competitions exist yet. Create one to assign judges and monitor progress.
          </p>
        </div>
      ) : judgingComps.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-sm space-y-1">
          <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            None of the {competitions.length} competition{competitions.length === 1 ? " is" : "s are"} currently in the judging phase.
          </p>
          <p className="text-[10px] text-muted-foreground/60" style={{ fontFamily: "var(--font-body)" }}>
            Judge progress only surfaces while a competition's phase is set to <code className="text-[10px]">judging</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {judgingComps.map((comp) => (
            <Suspense key={comp.id} fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <div className="space-y-2">
                <h3 className="text-sm font-medium" style={{ fontFamily: "var(--font-heading)" }}>{comp.title}</h3>
                <AdminJudgeMonitoringPanel competitionId={comp.id} />
                <AdminCompetitionFunnel competitionId={comp.id} />
              </div>
            </Suspense>
          ))}
        </div>
      )}
    </div>
  );
};

export default JudgeMonitoringModule;
