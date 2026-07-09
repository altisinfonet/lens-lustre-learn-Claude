import { Gavel, Plus, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import {
  useCompetitionJudgeAssignments,
  useJuryUsers,
  useProfileNameMap,
  useInvalidateJudges,
} from "@/hooks/competition/useCompetitionJudges";
import { useState } from "react";

interface Props {
  competitionId: string;
  adminId: string;
}

const AdminCompetitionJudges = ({ competitionId, adminId }: Props) => {
  const [adding, setAdding] = useState(false);
  const [selectedJudge, setSelectedJudge] = useState("");
  const invalidateJudges = useInvalidateJudges();

  const { data: assignments = [], isLoading: loadingJudges } = useCompetitionJudgeAssignments(competitionId);
  const { data: juryUsers = [], isLoading: loadingJury } = useJuryUsers();

  const judgeIds = assignments.map((a) => a.judge_id);
  const { data: profileMap = new Map() } = useProfileNameMap(judgeIds);

  const loading = loadingJudges || loadingJury;

  const judges = assignments.map((a) => ({
    id: a.id,
    judge_id: a.judge_id,
    assigned_at: a.assigned_at,
    full_name: profileMap.get(a.judge_id) || null,
  }));

  const availableJury = juryUsers.filter(
    (j) => !judges.some((assigned) => assigned.judge_id === j.user_id)
  );

  const assignJudge = async () => {
    if (!selectedJudge) return;
    setAdding(true);
    const { error } = await supabase.from("competition_judges").insert({
      competition_id: competitionId,
      judge_id: selectedJudge,
      assigned_by: adminId,
    });
    setAdding(false);
    if (error) {
      if (error.message.includes("duplicate")) {
        toast({ title: "Judge already assigned", variant: "destructive" });
      } else {
        toast({ title: "Failed to assign", description: error.message, variant: "destructive" });
      }
    } else {
      toast({ title: "Judge assigned" });
      setSelectedJudge("");
      invalidateJudges(competitionId);
    }
  };

  const removeJudge = async (id: string) => {
    const { error } = await supabase.from("competition_judges").delete().eq("id", id);
    if (error) {
      toast({ title: "Remove failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Judge removed" });
      invalidateJudges(competitionId);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading judges...
      </div>
    );
  }

  return (
    <div className="border border-border/50 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Gavel className="h-3 w-3 text-primary" />
        <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Judges ({judges.length})
        </span>
      </div>

      {judges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {judges.map((j) => (
            <span
              key={j.id}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 border border-primary/30 bg-primary/5 text-primary"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {j.full_name || "Unknown"}
              <button
                onClick={() => removeJudge(j.id)}
                className="hover:text-destructive transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <select
          value={selectedJudge}
          onChange={(e) => setSelectedJudge(e.target.value)}
          className="flex-1 bg-transparent border border-border focus:border-primary outline-none py-1 px-2 text-xs transition-colors"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <option value="">Select jury…</option>
          {availableJury.map((j) => (
            <option key={j.user_id} value={j.user_id}>
              {j.full_name || j.user_id}
            </option>
          ))}
        </select>
        <button
          onClick={assignJudge}
          disabled={!selectedJudge || adding}
          className="inline-flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground text-[9px] tracking-[0.1em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {adding ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
          Add
        </button>
      </div>

      {availableJury.length === 0 && juryUsers.length === 0 && (
        <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          No users with the Judge role found. Assign the role first.
        </p>
      )}
    </div>
  );
};

export default AdminCompetitionJudges;
