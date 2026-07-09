import { useState, useEffect } from "react";
import { ClipboardList, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { resolveJudgeDisplay, useJudgeReveal } from "@/lib/judgeAnonymizer";
import JudgeRevealToggle from "@/components/admin/JudgeRevealToggle";

interface Props {
  competitionId?: string;
}

interface LogRow {
  id: string;
  judge_id: string;
  judge_real_name: string | null;
  action_type: string;
  entry_id: string | null;
  competition_id: string | null;
  round_number: number | null;
  created_at: string;
  details: any;
}

const AdminJudgeActivityLog = ({ competitionId }: Props) => {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterJudge, setFilterJudge] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const reveal = useJudgeReveal();

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      let query = supabase
        .from("judge_activity_logs")
        .select("id, judge_id, action_type, entry_id, competition_id, round_number, created_at, details")
        .order("created_at", { ascending: false })
        .limit(200);

      if (competitionId) query = query.eq("competition_id", competitionId);

      const { data } = await query;
      if (!data || data.length === 0) {
        setLogs([]);
        setLoading(false);
        return;
      }

      const judgeIds = [...new Set(data.map((d) => d.judge_id))];
      const profileMap = await cachedFetchProfilesByIds(judgeIds);

      setLogs(
        data.map((d) => ({
          ...d,
          judge_real_name: profileMap.get(d.judge_id) || null,
        }))
      );
      setLoading(false);
    };
    fetch();
  }, [competitionId]);

  const displayName = (l: LogRow) =>
    resolveJudgeDisplay(l.competition_id || competitionId || "", l.judge_id, l.judge_real_name, reveal);

  const filtered = logs.filter((l) => {
    if (filterJudge && !displayName(l).toLowerCase().includes(filterJudge.toLowerCase())) return false;
    if (filterAction && l.action_type !== filterAction) return false;
    return true;
  });

  const actionTypes = [...new Set(logs.map((l) => l.action_type))];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading activity logs…
      </div>
    );
  }

  return (
    <div className="border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-3.5 w-3.5 text-primary" />
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
            Judge Activity ({filtered.length})
          </span>
          <JudgeRevealToggle />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
            <input
              type="text"
              value={filterJudge}
              onChange={(e) => setFilterJudge(e.target.value)}
              placeholder="Judge…"
              className="pl-7 pr-6 py-1 text-[10px] border border-border bg-transparent outline-none focus:border-primary w-28"
              style={{ fontFamily: "var(--font-body)" }}
            />
            {filterJudge && (
              <button onClick={() => setFilterJudge("")} className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            )}
          </div>
          {actionTypes.length > 1 && (
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="text-[10px] border border-border bg-transparent outline-none px-2 py-1 focus:border-primary"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <option value="">All actions</option>
              {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No activity logs found.</p>
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
          {filtered.map((log) => (
            <div key={log.id} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-muted/20 transition-colors">
              <span className="text-[9px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-primary/30 bg-primary/5 text-primary shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
                {log.action_type}
              </span>
              <span className="text-foreground font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>{displayName(log)}</span>
              {log.round_number && (
                <span className="text-[9px] text-muted-foreground shrink-0">R{log.round_number}</span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
                {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminJudgeActivityLog;
