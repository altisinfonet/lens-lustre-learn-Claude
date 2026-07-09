/**
 * Vote Audit Module — extracted from AdminPanel.tsx
 */
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAdminCompetitions } from "@/hooks/admin/useAdminCompetitions";
import type { User } from "@supabase/supabase-js";

const AdminVoteAuditPanel = lazy(() => import("@/components/admin/AdminVoteAuditPanel"));

interface Props {
  user: User;
}

const VoteAuditModule = ({ user }: Props) => {
  const { competitions } = useAdminCompetitions();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Transparency</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Vote <em className="italic text-primary">Audit</em>
        </h2>
        <p className="text-xs text-muted-foreground mt-2 max-w-md" style={{ fontFamily: "var(--font-body)" }}>
          View real votes, admin adjustments, and revert adjustments with full audit trail.
        </p>
        </div>
        <Link
          to="/admin/seo?tab=verify"
          className="inline-flex items-center gap-2 px-4 py-2 border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground text-[10px] tracking-[0.2em] uppercase transition-colors"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          SEO Crawler Verify
        </Link>
      </div>
      {competitions.map((comp) => (
        <Suspense key={comp.id} fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
          <div className="space-y-2">
            <h3 className="text-sm font-medium" style={{ fontFamily: "var(--font-heading)" }}>{comp.title}</h3>
            <AdminVoteAuditPanel competitionId={comp.id} adminId={user.id} />
          </div>
        </Suspense>
      ))}
    </div>
  );
};

export default VoteAuditModule;
