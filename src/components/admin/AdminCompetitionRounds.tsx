import { useEffect, useState } from "react";
import { Layers, Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import CompleteRoundDialog from "@/components/judge/CompleteRoundDialog";

interface Round {
  id: string;
  round_number: number;
  name: string;
  description: string | null;
  status: string;
}

interface RoundStats {
  total: number;
  qualified: number;
  rejected: number;
}

interface Props {
  competitionId: string;
}

const ROUND_STATUSES_SAFE = ["pending", "active"];

/** Fixed round names — global rule, same for every competition */
const FIXED_ROUNDS = [
  { round_number: 1, name: "Initial Screening" },
  { round_number: 2, name: "Round 2" },
  { round_number: 3, name: "Round 3" },
  { round_number: 4, name: "Final Round" },
];

const AdminCompetitionRounds = ({ competitionId }: Props) => {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingRound, setCompletingRound] = useState<Round | null>(null);
  const [entryStats, setEntryStats] = useState<RoundStats>({ total: 0, qualified: 0, rejected: 0 });

  const fetchRounds = async () => {
    const { data } = await supabase
      .from("judging_rounds")
      .select("id, round_number, name, description, status")
      .eq("competition_id", competitionId)
      .order("round_number", { ascending: true });
    const existing = (data as Round[]) || [];

    // Auto-create missing rounds if fewer than 4 exist
    if (existing.length < 4) {
      const existingNums = new Set(existing.map((r) => r.round_number));
      const missing = FIXED_ROUNDS.filter((fr) => !existingNums.has(fr.round_number));
      if (missing.length > 0) {
        await supabase.from("judging_rounds").insert(
          missing.map((m) => ({ competition_id: competitionId, round_number: m.round_number, name: m.name }))
        );
        // Re-fetch after auto-create
        const { data: refreshed } = await supabase
          .from("judging_rounds")
          .select("id, round_number, name, description, status")
          .eq("competition_id", competitionId)
          .order("round_number", { ascending: true });
        setRounds((refreshed as Round[]) || []);
        setLoading(false);
        return;
      }
    }

    setRounds(existing);
    setLoading(false);
  };

  const fetchStats = async () => {
    const { data } = await supabase
      .from("competition_entries")
      .select("status")
      .eq("competition_id", competitionId);
    if (data) {
      const qualifiedStatuses = ["approved", "shortlisted", "round1_qualified", "round2_qualified", "finalist", "winner"];
      setEntryStats({
        total: data.length,
        qualified: data.filter((e) => qualifiedStatuses.includes(e.status)).length,
        rejected: data.filter((e) => e.status === "rejected").length,
      });
    }
  };

  useEffect(() => {
    fetchRounds();
    fetchStats();
  }, [competitionId]);

  const updateStatus = async (id: string, status: string) => {
    if (status === "completed") {
      const round = rounds.find((r) => r.id === id);
      if (round) setCompletingRound(round);
      return;
    }
    await supabase.from("judging_rounds").update({ status }).eq("id", id);
    setRounds((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    toast({ title: `Round → ${status}` });
  };

  const handleCompleteConfirm = async () => {
    if (!completingRound) return;
    await supabase.from("judging_rounds").update({ status: "completed" }).eq("id", completingRound.id);
    setRounds((prev) => prev.map((r) => (r.id === completingRound.id ? { ...r, status: "completed" } : r)));
    toast({ title: `${completingRound.name} completed` });
    setCompletingRound(null);
    fetchStats();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading rounds...
      </div>
    );
  }

  return (
    <div className="border border-border/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3 w-3 text-primary" />
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Rounds ({rounds.length}/4)
          </span>
        </div>
        <div className="flex items-center gap-2 text-[8px]" style={{ fontFamily: "var(--font-heading)" }}>
          <span className="text-muted-foreground">{entryStats.total} entries</span>
          <span className="text-primary">{entryStats.qualified} qual</span>
          <span className="text-destructive">{entryStats.rejected} rej</span>
        </div>
      </div>

      {rounds.length > 0 && (
        <div className="space-y-1">
          {rounds.map((r) => (
            <div key={r.id} className="flex items-center gap-2 border border-border px-2 py-1.5 text-xs">
              <span className="text-[9px] tracking-[0.1em] uppercase text-primary font-semibold w-5 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
                R{r.round_number}
              </span>
              <span className="flex-1 min-w-0 truncate text-xs" style={{ fontFamily: "var(--font-body)" }}>{r.name}</span>

              {r.status === "completed" ? (
                <span className="text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 border text-muted-foreground border-muted-foreground/40 flex items-center gap-1" style={{ fontFamily: "var(--font-heading)" }}>
                  <Lock className="h-2 w-2" /> completed
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  <select
                    value={r.status}
                    onChange={(e) => updateStatus(r.id, e.target.value)}
                    className={`text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 border bg-transparent outline-none cursor-pointer ${
                      r.status === "active" ? "text-primary border-primary" : "text-accent-foreground border-accent"
                    }`}
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {ROUND_STATUSES_SAFE.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button
                    onClick={() => { const round = rounds.find(rd => rd.id === r.id); if (round) setCompletingRound(round); }}
                    className="text-[7px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    Complete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[8px] text-muted-foreground italic px-1" style={{ fontFamily: "var(--font-body)" }}>
        4 fixed rounds: Initial Screening → Round 2 → Round 3 → Final Round
      </p>

      {completingRound && (
        <CompleteRoundDialog
          roundId={completingRound.id}
          roundName={completingRound.name}
          competitionId={competitionId}
          roundNumber={completingRound.round_number}
          onConfirm={handleCompleteConfirm}
          onCancel={() => setCompletingRound(null)}
        />
      )}
    </div>
  );
};

export default AdminCompetitionRounds;
