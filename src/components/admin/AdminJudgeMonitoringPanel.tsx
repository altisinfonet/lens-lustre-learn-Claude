import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Users, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { resolveJudgeDisplay, useJudgeReveal } from "@/lib/judgeAnonymizer";
import JudgeRevealToggle from "@/components/admin/JudgeRevealToggle";

interface Props {
  competitionId: string;
}

interface JudgeStats {
  judgeId: string;
  realName: string | null;
  assigned: number;
  reviewed: number;
  pending: number;
  completionPct: number;
  lastActivity: string | null;
  assignedAt: string | null;
}

const AdminJudgeMonitoringPanel = ({ competitionId }: Props) => {
  const [stats, setStats] = useState<JudgeStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const reveal = useJudgeReveal();
  // Debounce rapid realtime events (a judge saving 15 criteria fires many
  // rows in quick succession) into a single reload.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);

      // Get judges assigned to this competition (with assignment timestamp)
      const { data: assignments } = await supabase
        .from("competition_judges")
        .select("judge_id, assigned_at")
        .eq("competition_id", competitionId);

      if (!assignments || assignments.length === 0) {
        setStats([]);
        setLoading(false);
        return;
      }

      const judgeIds = assignments.map((a) => a.judge_id);
      const assignedAtMap = new Map<string, string>();
      assignments.forEach((a) => assignedAtMap.set(a.judge_id, a.assigned_at));

      // Get all eligible entries for this competition (judge_scores has no competition_id column,
      // so we must scope by entry_id list)
      const { data: entries } = await supabase
        .from("competition_entries")
        .select("id")
        .eq("competition_id", competitionId)
        .neq("status", "rejected");

      const entryIds = (entries ?? []).map((e) => e.id);
      const totalEntries = entryIds.length;

      // Scores per judge — joined via entry_id (the correct schema link)
      let scores: { judge_id: string; entry_id: string }[] = [];
      if (entryIds.length > 0 && judgeIds.length > 0) {
        const { data: scoreRows, error: scoreErr } = await supabase
          .from("judge_scores")
          .select("judge_id, entry_id")
          .in("entry_id", entryIds)
          .in("judge_id", judgeIds);
        if (scoreErr) {
          console.error("[AdminJudgeMonitoringPanel] score fetch failed", scoreErr);
        } else {
          scores = scoreRows ?? [];
        }
      }

      // Get last activity per judge
      const { data: activityLogs } = await supabase
        .from("judge_activity_logs")
        .select("judge_id, created_at")
        .eq("competition_id", competitionId)
        .in("judge_id", judgeIds)
        .order("created_at", { ascending: false })
        .limit(500);

      // Get names
      const profileMap = await cachedFetchProfilesByIds(judgeIds);

      const scoresByJudge = new Map<string, Set<string>>();
      scores.forEach((s) => {
        if (!scoresByJudge.has(s.judge_id)) scoresByJudge.set(s.judge_id, new Set());
        scoresByJudge.get(s.judge_id)!.add(s.entry_id);
      });

      const lastActivityMap = new Map<string, string>();
      activityLogs?.forEach((log) => {
        if (!lastActivityMap.has(log.judge_id)) {
          lastActivityMap.set(log.judge_id, log.created_at);
        }
      });

      const result: JudgeStats[] = judgeIds.map((jid) => {
        const reviewed = scoresByJudge.get(jid)?.size ?? 0;
        return {
          judgeId: jid,
          realName: profileMap.get(jid) || null,
          assigned: totalEntries,
          reviewed,
          pending: Math.max(0, totalEntries - reviewed),
          completionPct: totalEntries > 0 ? Math.round((reviewed / totalEntries) * 100) : 0,
          lastActivity: lastActivityMap.get(jid) || null,
          assignedAt: assignedAtMap.get(jid) || null,
        };
      });

      result.sort((a, b) => a.completionPct - b.completionPct);
      setStats(result);
      setLoading(false);
  }, [competitionId]);

  useEffect(() => {
    load(true);

    // Live updates: judging tables broadcast via supabase_realtime
    // (migration 20260722110000). judge_scores / judge_decisions carry no
    // competition_id column, so those events arrive unfiltered — the reload
    // itself is competition-scoped, making a stray refetch harmless.
    // judge_activity_logs IS filterable by competition.
    const scheduleReload = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => load(false), 800);
    };

    const channel = supabase
      .channel(`admin-judge-monitor-${competitionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "judge_scores" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "judge_decisions" }, scheduleReload)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "judge_activity_logs", filter: `competition_id=eq.${competitionId}` },
        scheduleReload
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      supabase.removeChannel(channel);
      setLive(false);
    };
  }, [competitionId, load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading judge stats…
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="text-center py-6 border border-dashed border-border rounded-sm">
        <Users className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No judges assigned.</p>
      </div>
    );
  }

  return (
    <div className="border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-primary" />
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
            Judge Progress ({stats.length})
          </span>
          {live && (
            <span className="flex items-center gap-1 text-[8px] tracking-[0.1em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              Live
            </span>
          )}
        </div>
        <JudgeRevealToggle />
      </div>
      <div className="divide-y divide-border">
        {stats.map((j) => {
          const isInactive = j.completionPct === 0 && j.assigned > 0;
          const daysSinceAssigned = j.assignedAt
            ? Math.floor((Date.now() - new Date(j.assignedAt).getTime()) / 86400000)
            : null;
          return (
            <div key={j.judgeId} className={`px-4 py-3 flex items-center gap-3 ${isInactive ? "bg-destructive/5" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>{resolveJudgeDisplay(competitionId, j.judgeId, j.realName, reveal)}</span>
                  {isInactive && (
                    <span className="text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/30" style={{ fontFamily: "var(--font-heading)" }}>
                      Inactive
                    </span>
                  )}
                  {j.completionPct === 100 && (
                    <CheckCircle className="h-3 w-3 text-primary shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    {j.reviewed}/{j.assigned} reviewed
                  </span>
                  {j.lastActivity ? (
                    <span className="text-[9px] text-muted-foreground/60" style={{ fontFamily: "var(--font-body)" }}>
                      Last: {new Date(j.lastActivity).toLocaleDateString()}
                    </span>
                  ) : daysSinceAssigned !== null ? (
                    <span className="text-[9px] text-muted-foreground/60" style={{ fontFamily: "var(--font-body)" }}>
                      Assigned {daysSinceAssigned === 0 ? "today" : `${daysSinceAssigned}d ago`} · no activity
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="w-24 shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-bold ${j.completionPct === 100 ? "text-primary" : j.completionPct === 0 ? "text-destructive" : "text-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
                    {j.completionPct}%
                  </span>
                </div>
                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${j.completionPct === 100 ? "bg-primary" : j.completionPct === 0 ? "bg-destructive/50" : "bg-primary/60"}`}
                    style={{ width: `${j.completionPct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminJudgeMonitoringPanel;
