/**
 * PublicJudgeScoresReveal — SOW C-4 part 2 (Step 2)
 *
 * SOW (page 1, line 22): "any marks given by Judge will be visible to public.
 *   Only after final declaration on each round not instantly"
 *
 * Renders per-judge per-criterion scores for a single photo, ONE table per
 * completed round. Judge identity is anonymized as "Judge 1", "Judge 2"…
 * (labels are stable per competition — generated server-side by the RPC).
 *
 * Data source: SECURITY DEFINER RPC `get_public_round_scores(competition_id, round_number)`.
 * The RPC itself enforces the "round must be completed" gate — this component
 * never reads `judge_scores` directly, so no judge ID can leak.
 *
 * Performance: parallel React Query calls per round (4 max), 60s staleTime,
 * disabled when no completed rounds exist → zero waste on in-progress comps.
 */
import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Star } from "lucide-react";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

const CRITERIA: { key: string; label: string }[] = [
  { key: "line_score", label: "Line" },
  { key: "shape_score", label: "Shape" },
  { key: "form_score", label: "Form" },
  { key: "texture_score", label: "Texture" },
  { key: "color_palette_score", label: "Color" },
  { key: "space_score", label: "Space" },
  { key: "tone_score", label: "Tone" },
  { key: "balance_score", label: "Balance" },
  { key: "light_score", label: "Light" },
  { key: "depth_score", label: "Depth" },
];

interface RoundScoreRow {
  entry_id: string;
  photo_index: number;
  anonymized_judge_label: string;
  line_score: number | null;
  shape_score: number | null;
  form_score: number | null;
  texture_score: number | null;
  color_palette_score: number | null;
  space_score: number | null;
  tone_score: number | null;
  balance_score: number | null;
  light_score: number | null;
  depth_score: number | null;
  average_score: number | null;
}

interface Props {
  competitionId: string;
  entryId: string;
  photoIndex: number;
}

/* List completed rounds for this competition — gates whether RPC is called at all */
function useCompletedRounds(competitionId: string) {
  return useQuery({
    queryKey: ["completed-rounds", competitionId],
    queryFn: async () => {
      // BUG-030: judging_rounds is judge/admin-readable only (RLS), so every
      // non-judge visitor got 0 rows here and the public scorecard never
      // rendered. Gate on competition_round_publish instead — it is publicly
      // readable for published rounds, and published_at (admin declared) is
      // the canonical participant-visibility signal. The RPC downstream
      // (get_public_round_scores, SECURITY DEFINER) enforces its own gate too.
      const { data } = await supabase
        .from("competition_round_publish")
        .select("round_number, published_at")
        .eq("competition_id", competitionId)
        .not("published_at", "is", null)
        .order("round_number", { ascending: true });
      return (data || []).map((r: any) => ({
        round_number: r.round_number as number,
        name: `Round ${r.round_number}`,
        status: "completed",
      })) as { round_number: number; name: string; status: string }[];
    },
    enabled: !!competitionId,
    staleTime: 60_000,
  });
}

const PublicJudgeScoresReveal = ({ competitionId, entryId, photoIndex }: Props) => {
  const { data: completedRounds, isLoading: roundsLoading } = useCompletedRounds(competitionId);

  // One parallel RPC call per completed round. Empty array = zero requests (instant render).
  const roundsList = completedRounds ?? [];
  const roundQueries = useQueries({
    queries: roundsList.map((r) => ({
      queryKey: ["public-round-scores", competitionId, r.round_number],
      queryFn: async () => {
        const { data, error } = await supabase.rpc("get_public_round_scores", {
          p_competition_id: competitionId,
          p_round_number: r.round_number,
        });
        if (error) throw error;
        return (data || []) as RoundScoreRow[];
      },
      staleTime: 60_000,
    })),
  });

  // Group rows by round → filter to current photo
  const rounds = useMemo(() => {
    return roundsList.map((r, i) => {
      const allRows = roundQueries[i]?.data ?? [];
      const rows = allRows.filter((row) => row.entry_id === entryId && row.photo_index === photoIndex);
      return { round: r, rows, isLoading: roundQueries[i]?.isLoading };
    });
  }, [roundsList, roundQueries, entryId, photoIndex]);

  if (roundsLoading) return null;
  if (!completedRounds || completedRounds.length === 0) return null;

  // If there are completed rounds but zero rows for this photo across all of them, hide silently.
  const hasAnyRows = rounds.some((r) => r.rows.length > 0);
  if (!hasAnyRows && rounds.every((r) => !r.isLoading)) return null;

  return (
    <section className="border-t border-border/50 px-3 py-4 space-y-5">
      <div>
        <h3 className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
          Judges' Scorecard
        </h3>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5" style={bodyFont}>
          Released after each round was officially declared. All scores are attributed to 50mm Retina World — individual judge identities are never disclosed publicly.
        </p>
      </div>

      {rounds.map(({ round, rows, isLoading }) => {
        if (rows.length === 0 && !isLoading) return null;
        return (
          <div key={round.round_number}>
            <div className="flex items-baseline justify-between mb-2">
              <h4 className="text-xs font-semibold" style={headingFont}>
                {round.name}
              </h4>
              <span className="text-[10px] text-muted-foreground" style={headingFont}>
                Round {round.round_number}
              </span>
            </div>

            {isLoading ? (
              <div className="text-[10px] text-muted-foreground animate-pulse" style={headingFont}>
                Loading scores…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border/60">
                <table className="w-full text-[10px]" style={bodyFont}>
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground" style={headingFont}>
                        Source
                      </th>
                      {CRITERIA.map((c) => (
                        <th
                          key={c.key}
                          className="px-1.5 py-1.5 text-center font-medium text-muted-foreground"
                          style={headingFont}
                        >
                          {c.label}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-center font-semibold text-primary" style={headingFont}>
                        Avg
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.anonymized_judge_label} className="border-t border-border/40">
                        <td className="px-2 py-1.5 font-medium text-foreground" style={headingFont}>
                          50mm Retina World
                        </td>
                        {CRITERIA.map((c) => {
                          const v = (row as any)[c.key];
                          return (
                            <td key={c.key} className="px-1.5 py-1.5 text-center text-muted-foreground">
                              {v === null || v === undefined ? "—" : v}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5 text-center">
                          <span className="inline-flex items-center gap-0.5 text-primary font-semibold">
                            <Star className="h-2.5 w-2.5 fill-primary" />
                            {row.average_score ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};

export default PublicJudgeScoresReveal;
