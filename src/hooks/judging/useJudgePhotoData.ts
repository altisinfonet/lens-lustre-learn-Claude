import { useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { useSiteSetting } from "@/hooks/core/useSiteSetting";
import { fetchInBatches, normalizePhotoIndex, DEFAULT_CRITERIA, SOW_ROUND4_CRITERIA_KEYS } from "./types";
import type { PhotoDataMaps, PhotoScoreData, PhotoTagData, JudgeComment, CriteriaScores } from "./types";
import { queryKeys } from "@/lib/queryKeys";
import { tryDecisionBuckets } from "@/lib/judging/decisionBucket";

function buildMaps(
  scores: any[],
  tagAssigns: any[],
  comments: any[],
  decisions: any[],
  userId: string,
  profileMap: Map<string, string>,
  activeRoundNumber?: number,
): PhotoDataMaps {
  const normalizedScores = (scores || [])
    .filter((s: any) => activeRoundNumber == null || s.round_number == null || s.round_number === activeRoundNumber)
    .map((s: any) => ({ ...s, photo_index: normalizePhotoIndex(s.photo_index) }));
  const normalizedTags = (tagAssigns || [])
    .filter((t: any) => {
      if (activeRoundNumber == null) return true;
      if (t.round_number != null) return t.round_number === activeRoundNumber;
      const visible = t.judging_tags?.visible_in_round;
      return Array.isArray(visible) && visible.includes(activeRoundNumber);
    })
    .map((t: any) => ({ ...t, photo_index: normalizePhotoIndex(t.photo_index) }));
  const normalizedComments = (comments || []).map((c: any) => ({ ...c, photo_index: normalizePhotoIndex(c.photo_index) }));

  const photoScoresMap: Record<string, PhotoScoreData> = {};
  const defaultCriteria = { ...DEFAULT_CRITERIA };
  normalizedScores.forEach((row: any) => {
    const key = `${row.entry_id}::${row.photo_index}`;
    if (!photoScoresMap[key]) photoScoresMap[key] = { myScore: null, myFeedback: null, myCriteria: { ...defaultCriteria }, allScores: [] };
    photoScoresMap[key].allScores.push({ judge_id: row.judge_id, score: row.score });
    if (row.judge_id === userId) {
      photoScoresMap[key].myScore = row.score;
      photoScoresMap[key].myFeedback = row.feedback || null;
      photoScoresMap[key].myCriteria = {
        composition: row.composition_score ?? null,
        color_palette: row.color_palette_score ?? null,
        technique: row.technique_score ?? null,
        line: row.line_score ?? null,
        shape: row.shape_score ?? null,
        form: row.form_score ?? null,
        texture: row.texture_score ?? null,
        space: row.space_score ?? null,
        tone: row.tone_score ?? null,
        balance: row.balance_score ?? null,
        light: row.light_score ?? null,
        depth: row.depth_score ?? null,
      };
    }
  });

  const photoTagsMap: Record<string, PhotoTagData> = {};
  normalizedTags.forEach((row: any) => {
    const key = `${row.entry_id}::${row.photo_index}`;
    if (!photoTagsMap[key]) photoTagsMap[key] = { myTags: [], allTags: [] };
    photoTagsMap[key].allTags.push({ tag_id: row.tag_id, judge_id: row.judge_id });
    if (row.judge_id === userId) photoTagsMap[key].myTags.push(row.tag_id);
  });

  const photoCommentsMap: Record<string, JudgeComment[]> = {};
  normalizedComments.forEach((row: any) => {
    const key = `${row.entry_id}::${row.photo_index}`;
    if (!photoCommentsMap[key]) photoCommentsMap[key] = [];
    photoCommentsMap[key].push({
      id: row.id, comment: row.comment, created_at: row.created_at,
      round_id: row.round_id, judge_id: row.judge_id,
      judge_name: profileMap.get(row.judge_id) || undefined,
    });
  });

  // Build decisions map: entry_id::photo_index -> { myDecision, allDecisions }
  const photoDecisionsMap: Record<string, { myDecision: string | null; allDecisions: { judge_id: string; decision: string; round_number: number }[] }> = {};
  (decisions || []).forEach((row: any) => {
    const pi = normalizePhotoIndex(row.photo_index);
    const key = `${row.entry_id}::${pi}`;
    if (!photoDecisionsMap[key]) photoDecisionsMap[key] = { myDecision: null, allDecisions: [] };
    photoDecisionsMap[key].allDecisions.push({ judge_id: row.judge_id, decision: row.decision, round_number: row.round_number });
    if (
      row.judge_id === userId
      && (activeRoundNumber == null || row.round_number === activeRoundNumber)
    ) {
      photoDecisionsMap[key].myDecision = row.decision;
    }
  });

  return { photoScoresMap, photoTagsMap, photoCommentsMap, photoDecisionsMap };
}

async function fetchPhotoData(
  entryIds: string[],
  userId: string,
  activeRoundNumber?: number,
): Promise<PhotoDataMaps> {
  if (entryIds.length === 0) return { photoScoresMap: {}, photoTagsMap: {}, photoCommentsMap: {}, photoDecisionsMap: {} };

  const [scores, tagAssigns, comments, decisions] = await Promise.all([
    fetchInBatches((ids) => (supabase.from("judge_scores" as any).select("entry_id, judge_id, round_number, score, feedback, photo_index, composition_score, color_palette_score, technique_score, line_score, shape_score, form_score, texture_score, space_score, tone_score, balance_score, light_score, depth_score") as any).in("entry_id", ids), entryIds),
    fetchInBatches((ids) => (supabase.from("judge_tag_assignments" as any).select("entry_id, tag_id, judge_id, round_number, photo_index, judging_tags(visible_in_round)") as any).in("entry_id", ids), entryIds),
    fetchInBatches((ids) => (supabase.from("judge_comments" as any).select("id, entry_id, judge_id, comment, created_at, round_id, photo_index") as any).in("entry_id", ids), entryIds),
    fetchInBatches((ids) => (supabase.from("judge_decisions" as any).select("entry_id, judge_id, decision, round_number, photo_index") as any).in("entry_id", ids), entryIds),
  ]);

  const commentJudgeIds = [...new Set((comments || []).map((c: any) => c.judge_id).filter(Boolean))];
  const judgeProfiles = commentJudgeIds.length > 0
    ? await fetchInBatches((ids) => profilesPublic().select("id, full_name").in("id", ids), commentJudgeIds)
    : [];
  const profileMap = new Map(judgeProfiles.map((p: any) => [p.id, p.full_name]));

  return buildMaps(scores, tagAssigns, comments, decisions, userId, profileMap, activeRoundNumber);
}

export function useJudgePhotoData(
  competitionId: string | null,
  entryIds: string[],
  userId: string | undefined,
  roundNumber?: number,
  roundId?: string | null,
) {
  const qc = useQueryClient();
  const entryIdsRef = useRef(entryIds);
  entryIdsRef.current = entryIds;
  // Stable hash of entry IDs — used for realtime filter + refetch trigger,
  // NOT included in the queryKey (Step 9: keys are [compId, roundId, judgeId]
  // only — eliminate ref-based / content-based cache busting).
  const entryIdsHash = useMemo(() => entryIds.join(","), [entryIds]);
  const queryKey = useMemo(
    () => queryKeys.judgePhotoData(competitionId, roundId ?? null, userId ?? null),
    [competitionId, roundId, userId],
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationLockRef = useRef(false);

  // R5 — Realtime privacy: when distributed mode is ON (default), the
  // per-judge live channel is filtered server-side to judge_id=eq.{userId}.
  // Other judges' events are NEVER delivered to this client. Cross-judge
  // data (allScores/allDecisions) only refreshes on next fetch / mount.
  // Toggle: site_settings.judging_realtime_distributed_mode.enabled
  const distributedModeSetting = useSiteSetting<{ enabled?: boolean }>(
    "judging_realtime_distributed_mode",
  );
  // Default ON if setting is missing/loading — strict privacy by default.
  const distributedMode = distributedModeSetting.data?.enabled !== false;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPhotoData(entryIdsRef.current, userId!, roundNumber),
    enabled: !!competitionId && entryIds.length > 0 && !!userId,
    staleTime: 30_000,
  });

  // When the entry set changes (pagination / filter), refetch with the new
  // ref WITHOUT busting the cache key. The cached data remains valid for
  // returning users; the refetch merges in new entries' photo data.
  useEffect(() => {
    if (!competitionId || !userId || entryIds.length === 0) return;
    query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryIdsHash]);

  // Realtime subscription — FIX #9: use stable entryIdsHash
  // R5: per-judge server-side filter when distributedMode is ON.
  useEffect(() => {
    if (!competitionId || !entryIdsHash) return;
    const entryIdSet = new Set(entryIdsHash.split(","));

    const debouncedInvalidate = () => {
      if (mutationLockRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey });
      }, 1500);
    };

    // When distributed mode is ON, attach a server-side judge_id filter so
    // Postgres/Realtime never streams other judges' events to this socket.
    // Channel name embeds userId so each judge gets a distinct topic.
    const judgeFilter = distributedMode && userId
      ? { filter: `judge_id=eq.${userId}` as const }
      : {};
    const channelName = distributedMode && userId
      ? `judge-live-${competitionId}-${userId}`
      : `judge-live-${competitionId}`;

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "judge_scores", ...judgeFilter }, (payload) => {
        const entryId = (payload.new as any)?.entry_id || (payload.old as any)?.entry_id;
        if (entryId && entryIdSet.has(entryId)) debouncedInvalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "judge_tag_assignments", ...judgeFilter }, (payload) => {
        const entryId = (payload.new as any)?.entry_id || (payload.old as any)?.entry_id;
        if (entryId && entryIdSet.has(entryId)) debouncedInvalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "judge_comments", ...judgeFilter }, (payload) => {
        const entryId = (payload.new as any)?.entry_id || (payload.old as any)?.entry_id;
        if (entryId && entryIdSet.has(entryId)) debouncedInvalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "judge_decisions", ...judgeFilter }, (payload) => {
        const entryId = (payload.new as any)?.entry_id || (payload.old as any)?.entry_id;
        if (entryId && entryIdSet.has(entryId)) debouncedInvalidate();
      })
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [competitionId, entryIdsHash, qc, queryKey, distributedMode, userId]);

  // Optimistic update helpers
  const lockMutation = useCallback(() => { mutationLockRef.current = true; }, []);
  const unlockMutation = useCallback(() => { mutationLockRef.current = false; }, []);

  const updateScoreOptimistic = useCallback((scoreKey: string, score: number, feedback: string | null, criteria?: CriteriaScores) => {
    qc.setQueryData<PhotoDataMaps>(queryKey, (old) => {
      if (!old) return old;
      const prev = old.photoScoresMap[scoreKey];
      return {
        ...old,
        photoScoresMap: {
          ...old.photoScoresMap,
          [scoreKey]: {
            myScore: score,
            myFeedback: feedback,
            myCriteria: criteria ?? prev?.myCriteria ?? { ...DEFAULT_CRITERIA },
            allScores: [
              ...(prev?.allScores || []).filter(s => s.judge_id !== userId),
              { judge_id: userId!, score },
            ],
          },
        },
      };
    });
  }, [qc, queryKey, userId]);

  const updateTagOptimistic = useCallback((photoKey: string, newMyTags: string[], newAllTags: { tag_id: string; judge_id: string }[]) => {
    qc.setQueryData<PhotoDataMaps>(queryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        photoTagsMap: {
          ...old.photoTagsMap,
          [photoKey]: { myTags: newMyTags, allTags: newAllTags },
        },
      };
    });
  }, [qc, queryKey]);

  const addCommentOptimistic = useCallback((photoKey: string, comment: JudgeComment) => {
    qc.setQueryData<PhotoDataMaps>(queryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        photoCommentsMap: {
          ...old.photoCommentsMap,
          [photoKey]: [...(old.photoCommentsMap[photoKey] || []), comment],
        },
      };
    });
  }, [qc, queryKey]);

  const clearOptimistic = useCallback((photoKey: string, clearAll: boolean) => {
    qc.setQueryData<PhotoDataMaps>(queryKey, (old) => {
      if (!old) return old;
      if (clearAll) {
        const nextScores = { ...old.photoScoresMap };
        const nextTags = { ...old.photoTagsMap };
        const nextComments = { ...old.photoCommentsMap };
        delete nextScores[photoKey];
        delete nextTags[photoKey];
        delete nextComments[photoKey];
        return { photoScoresMap: nextScores, photoTagsMap: nextTags, photoCommentsMap: nextComments, photoDecisionsMap: old.photoDecisionsMap };
      }
      const prevScores = old.photoScoresMap[photoKey];
      const prevTags = old.photoTagsMap[photoKey];
      return {
        ...old,
        photoScoresMap: {
          ...old.photoScoresMap,
          [photoKey]: prevScores
            ? { myScore: null, myFeedback: null, myCriteria: { ...DEFAULT_CRITERIA }, allScores: prevScores.allScores.filter(s => s.judge_id !== userId) }
            : prevScores,
        },
        photoTagsMap: {
          ...old.photoTagsMap,
          [photoKey]: prevTags
            ? { myTags: [], allTags: prevTags.allTags.filter(t => t.judge_id !== userId) }
            : prevTags,
        },
        photoCommentsMap: {
          ...old.photoCommentsMap,
          [photoKey]: (old.photoCommentsMap[photoKey] || []).filter(c => c.judge_id !== userId),
        },
      };
    });
  }, [qc, queryKey, userId]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey });
  }, [qc, queryKey]);

  // Optimistic decision update (per-photo)
  const updateDecisionOptimistic = useCallback((entryId: string, photoIndex: number, decision: string, roundNumber: number) => {
    const decisionKey = `${entryId}::${photoIndex}`;
    qc.setQueryData<PhotoDataMaps>(queryKey, (old) => {
      if (!old) return old;
      const prev = old.photoDecisionsMap[decisionKey];
      return {
        ...old,
        photoDecisionsMap: {
          ...old.photoDecisionsMap,
          [decisionKey]: {
            myDecision: decision,
            allDecisions: [
              ...(prev?.allDecisions || []).filter(d => d.judge_id !== userId),
              { judge_id: userId!, decision, round_number: roundNumber },
            ],
          },
        },
      };
    });
  }, [qc, queryKey, userId]);

  /**
   * Per-judge decision counts for sidebar navigation.
   * Derives counts from photoDecisionsMap — NOT from global entry status.
   * This prevents "ghosting" where changing a mark doesn't update sidebar counts.
   *
   * Judging v5 fix (J-03): a photo is "judged" when the judge has ANY of:
   *   decision OR score OR tag. Previously only the decision was checked,
   *   so tag-only rounds counted every tagged photo as unjudged.
   *
   * BUG-1 fix: For rounds 2/3/4 the SOW mandates all 10 criteria scores
   * per photo. Sidebar "Unjudged" now REQUIRES a full 10-criteria score
   * for the current judge (tag alone is insufficient), matching the
   * `complete-round` edge-fn gate. R1 keeps score-or-tag semantics.
   */
  const getMyDecisionCounts = useCallback((entries: { id: string; photos?: string[] }[], roundNumber?: number) => {
    const decisions = query.data?.photoDecisionsMap ?? {};
    const scores = query.data?.photoScoresMap ?? {};
    const tags = query.data?.photoTagsMap ?? {};
    const counts = { accept: 0, shortlist: 0, needs_review: 0, reject: 0, qualified: 0, finalist: 0, winner: 0, unjudged: 0, total: 0 };
    const requiresFullCriteria = typeof roundNumber === "number" && roundNumber >= 2;

    // Phase 4 — Status-Mapper Wiring.
    // Bucket aggregation now goes through the unified `decisionBuckets()`
    // mapper (Phase 2). Legacy decision tokens (e.g. R1 "shortlist" stored
    // historically as just "shortlisted") fall back to the inline mapping
    // below ONLY when the catalog resolver returns null — never silently.
    // BUG-02: R2 `qualified_r3` rows now correctly increment BOTH
    // `qualified` AND `shortlist` via the mapper's multi-bucket return.
    const sidebarKeyToCounter: Record<string, keyof typeof counts | undefined> = {
      accepted:        "accept",
      shortlisted:     "shortlist",
      needs_review:    "needs_review",
      rejected:        "reject",
      qualified:       "qualified",
      finalist:        "finalist",
      winner:          "winner",
    };

    entries.forEach((entry) => {
      const photoCount = entry.photos?.length || 1;
      counts.total += photoCount;
      for (let pi = 0; pi < photoCount; pi++) {
        const key = `${entry.id}::${pi}`;
        const dRow = decisions[key];
        const d = dRow?.myDecision;
        const scoreRow = scores[key];
        const hasAnyScore = scoreRow?.myScore != null;
        const hasFullCriteria = !!scoreRow?.myCriteria
          && SOW_ROUND4_CRITERIA_KEYS.every((k) => typeof scoreRow!.myCriteria![k] === "number");
        const hasScoreForRound = requiresFullCriteria ? hasFullCriteria : hasAnyScore;
        const hasTag = (tags[key]?.myTags?.length ?? 0) > 0;

        if (!d) {
          // In R2+ a tag alone is NOT enough — the SOW requires all 10
          // criteria scored. Sidebar must agree with the server gate.
          if (requiresFullCriteria) {
            if (!hasFullCriteria) counts.unjudged++;
          } else if (!hasScoreForRound && !hasTag) {
            counts.unjudged++;
          }
          continue;
        }


        // Pull this judge's round_number from the same allDecisions row used
        // to populate myDecision (kept consistent by buildMaps()).
        const myRow = (dRow?.allDecisions ?? []).find((r) => r.judge_id === userId);
        const roundForBucket = myRow?.round_number;
        const buckets = tryDecisionBuckets(roundForBucket, d);

        if (buckets && buckets.length > 0) {
          const seen = new Set<keyof typeof counts>();
          for (const b of buckets) {
            const target = sidebarKeyToCounter[String(b)];
            if (target && !seen.has(target)) { counts[target]++; seen.add(target); }
          }
          continue;
        }

        // Legacy / unmapped fallback — preserves prior behaviour exactly.
        if (d === "accept" || d === "accepted") counts.accept++;
        else if (d === "shortlist" || d === "shortlisted") counts.shortlist++;
        else if (d === "needs_review") counts.needs_review++;
        else if (d === "reject" || d === "rejected") counts.reject++;
        else if (d === "qualified") counts.qualified++;
        else if (d === "finalist") counts.finalist++;
        else if (d === "winner") counts.winner++;
      }
    });
    return counts;
  }, [query.data?.photoDecisionsMap, query.data?.photoScoresMap, query.data?.photoTagsMap, userId]);

  return {
    photoScoresMap: query.data?.photoScoresMap ?? {},
    photoTagsMap: query.data?.photoTagsMap ?? {},
    photoCommentsMap: query.data?.photoCommentsMap ?? {},
    photoDecisionsMap: query.data?.photoDecisionsMap ?? {},
    isLoading: query.isLoading,
    updateScoreOptimistic,
    updateTagOptimistic,
    addCommentOptimistic,
    updateDecisionOptimistic,
    clearOptimistic,
    invalidate,
    lockMutation,
    unlockMutation,
    getMyDecisionCounts,
  };
}
