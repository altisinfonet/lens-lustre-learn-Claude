import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AggregateStats {
  /** Total photos across all in-scope entries (sum of photos[].length). */
  totalPhotos: number;
  /** Photos this judge has assigned a numeric score to (R2-4 scoring rounds). */
  reviewedPhotos: number;
  /** Total per-photo decisions this judge has recorded across all rounds (R1 + R2-4). */
  decisionsMade: number;
  /** Mean of this judge's numeric scores across all in-scope photos. Null if none. */
  scoreAverage: number | null;
  /** Photos this judge has marked as 'needs_review' (per-photo decision). */
  needsReviewCount: number;
  /** Per-competition: { roundLabel, progressPct } */
  competitionProgress: Record<string, { roundLabel: string; progressPct: number }>;
}

const EMPTY_STATS: AggregateStats = {
  totalPhotos: 0,
  reviewedPhotos: 0,
  decisionsMade: 0,
  scoreAverage: null,
  needsReviewCount: 0,
  competitionProgress: {},
};

async function fetchAggregateStats(userId: string, competitionIds: string[]): Promise<AggregateStats> {
  if (competitionIds.length === 0) return EMPTY_STATS;

  // ── 1. Fetch entries (drives totalPhotos + entry-id scope) ─────────────
  const { data: entries } = await supabase
    .from("competition_entries")
    .select("id, competition_id, photos")
    .in("competition_id", competitionIds);

  if (!entries || entries.length === 0) return EMPTY_STATS;

  let totalPhotos = 0;
  const entryIds: string[] = [];
  const compPhotoCount: Record<string, number> = {};
  for (const e of entries) {
    const photoCount = Array.isArray(e.photos) ? e.photos.length : 0;
    totalPhotos += photoCount;
    entryIds.push(e.id);
    compPhotoCount[e.competition_id] = (compPhotoCount[e.competition_id] || 0) + photoCount;
  }

  const entryToComp = new Map(entries.map((e) => [e.id, e.competition_id]));
  const scopedIds = entryIds.slice(0, 1000); // batch ceiling kept conservative

  // ── 2. Independent parallel queries for the 4 new metrics + rounds ────
  const [scoresRes, decisionsRes, roundsRes] = await Promise.all([
    supabase
      .from("judge_scores")
      .select("entry_id, photo_index, score")
      .eq("judge_id", userId)
      .in("entry_id", scopedIds),
    supabase
      .from("judge_decisions")
      .select("entry_id, photo_index, decision")
      .eq("judge_id", userId)
      .in("entry_id", scopedIds),
    supabase
      .from("judging_rounds")
      .select("competition_id, round_number, name, status")
      .in("competition_id", competitionIds)
      .order("round_number", { ascending: true }),
  ]);

  const allScores = scoresRes.data || [];
  const allDecisions = decisionsRes.data || [];
  const rounds = roundsRes.data || [];

  // ── 3. Reviewed photos (unique entry::photo_index with a score) ───────
  const reviewedSet = new Set(allScores.map((s) => `${s.entry_id}::${s.photo_index}`));
  const reviewedPhotos = reviewedSet.size;

  // ── 4. decisions_made: unique entry::photo_index with ANY decision ────
  const decisionSet = new Set(allDecisions.map((d) => `${d.entry_id}::${d.photo_index}`));
  const decisionsMade = decisionSet.size;

  // ── 5. score_average: mean of this judge's numeric scores ─────────────
  let scoreAverage: number | null = null;
  if (allScores.length > 0) {
    const valid = allScores.filter((s) => typeof s.score === "number");
    if (valid.length > 0) {
      const sum = valid.reduce((acc, s) => acc + (s.score as number), 0);
      scoreAverage = Math.round((sum / valid.length) * 100) / 100;
    }
  }

  // ── 6. needs_review_count: per-photo decisions == 'needs_review' ──────
  const needsReviewCount = allDecisions.filter((d) => d.decision === "needs_review").length;

  // ── 7. Per-competition progress (uses scores, R2-4 scoring metric) ────
  const compReviewed: Record<string, number> = {};
  for (const s of allScores) {
    const compId = entryToComp.get(s.entry_id);
    if (compId) compReviewed[compId] = (compReviewed[compId] || 0) + 1;
  }

  const competitionProgress: Record<string, { roundLabel: string; progressPct: number }> = {};
  for (const compId of competitionIds) {
    const compRounds = rounds.filter((r) => (r as any).competition_id === compId);
    const activeRound = compRounds.find((r) => r.status === "active") || compRounds[0];
    const total = compPhotoCount[compId] || 0;
    const reviewed = compReviewed[compId] || 0;
    competitionProgress[compId] = {
      roundLabel: activeRound ? activeRound.name : "Round 1",
      progressPct: total > 0 ? Math.round((reviewed / total) * 100) : 0,
    };
  }

  return {
    totalPhotos,
    reviewedPhotos,
    decisionsMade,
    scoreAverage,
    needsReviewCount,
    competitionProgress,
  };
}

export function useJudgeAggregateStats(userId: string | undefined, competitionIds: string[]) {
  return useQuery({
    queryKey: ["judge-aggregate-stats", userId, competitionIds] as const,
    queryFn: () => fetchAggregateStats(userId!, competitionIds),
    enabled: !!userId && competitionIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
