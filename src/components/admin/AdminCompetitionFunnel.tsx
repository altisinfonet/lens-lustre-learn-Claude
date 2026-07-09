import { useState, useEffect } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  competitionId: string;
}

const STAGES = [
  { key: "submitted", label: "Submitted", color: "bg-muted-foreground" },
  { key: "approved", label: "Approved", color: "bg-primary/60" },
  { key: "round1_qualified", label: "Round 1", color: "bg-primary/70" },
  { key: "round2_qualified", label: "Round 2", color: "bg-primary/80" },
  { key: "finalist", label: "Finalist", color: "bg-primary/90" },
  { key: "winner", label: "Winner", color: "bg-primary" },
  { key: "rejected", label: "Rejected", color: "bg-destructive/60" },
];

const AdminCompetitionFunnel = ({ competitionId }: Props) => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("competition_entries")
        .select("status")
        .eq("competition_id", competitionId);

      if (data) {
        const c: Record<string, number> = {};
        data.forEach((e) => {
          c[e.status] = (c[e.status] || 0) + 1;
        });
        setCounts(c);
        setTotal(data.length);
      }
      setLoading(false);
    };
    fetch();
  }, [competitionId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading funnel…
      </div>
    );
  }

  const maxCount = Math.max(...STAGES.map((s) => counts[s.key] || 0), 1);

  return (
    <div className="border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-primary" />
        <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
          Entry Funnel ({total} total)
        </span>
      </div>
      <div className="p-4 space-y-2">
        {STAGES.map((stage) => {
          const count = counts[stage.key] || 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const barWidth = maxCount > 0 ? Math.max(2, (count / maxCount) * 100) : 0;
          return (
            <div key={stage.key} className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground w-16 shrink-0 text-right" style={{ fontFamily: "var(--font-heading)" }}>
                {stage.label}
              </span>
              <div className="flex-1 h-5 bg-muted/20 rounded-sm overflow-hidden relative">
                <div
                  className={`h-full ${stage.color} rounded-sm transition-all`}
                  style={{ width: `${barWidth}%` }}
                />
                {count > 0 && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                    {count} ({pct}%)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminCompetitionFunnel;
