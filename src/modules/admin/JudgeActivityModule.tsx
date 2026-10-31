/**
 * Judge Activity Module — extracted from AdminPanel.tsx
 */
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const AdminJudgeActivityLog = lazy(() => import("@/components/admin/AdminJudgeActivityLog"));

const JudgeActivityModule = () => (
  <div className="space-y-6">
    <div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-px bg-primary" />
        <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Audit Trail</span>
      </div>
      <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
        Judge <em className="italic text-primary">Activity</em>
      </h2>
      <p className="text-xs text-muted-foreground mt-2 max-w-md" style={{ fontFamily: "var(--font-body)" }}>
        Complete log of all judge scoring, decisions, and overrides.
      </p>
    </div>
    <Suspense fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
      <AdminJudgeActivityLog />
    </Suspense>
  </div>
);

export default JudgeActivityModule;
