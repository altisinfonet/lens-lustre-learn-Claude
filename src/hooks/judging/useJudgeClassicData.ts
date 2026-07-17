/**
 * Unified data hook for Classic Judge Panel.
 * Replaces 60+ useState hooks + module-level caches with React Query.
 * Single source of truth for entries + photo-level judging data.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { fetchInBatches, normalizePhotoIndex, ENTRIES_PAGE_SIZE } from "./types";
import { useJudgePhotoData } from "./useJudgePhotoData";
import type {
  JudgeEntry, FlatPhoto, PhotoEvaluation, SidebarView,
  PhotoScoreData, PhotoTagData, JudgeComment, JudgingRound,
} from "./types";

/* ── Auto-resume helpers ── */
const getResumeKey = (compId: string, roundId: string) => `judge_resume_${compId}_${roundId}`;
export const saveResumePosition = (compId: string, roundId: string, photoKey: string) => {
  try { localStorage.setItem(getResumeKey(compId, roundId), photoKey); } catch { /* noop */ }
};
export const loadResumePosition = (compId: string, roundId: string): string | null => {
  try { return localStorage.getItem(getResumeKey(compId, roundId)); } catch { return null; }
};

export const getRoundMode = (round: JudgingRound | null): "scoring" | "tagging" | "decision" => {
  // FIX #1 (judging-load-race): when rounds haven't loaded yet, default to
  // "decision" so the first paint matches R1 (the most common active round)
  // instead of flashing R2-style scoring sliders.
  if (!round) return "decision";
  // R1 = decision mode (Accept/Shortlist/Needs Review/Reject only — no sliders)
  if (round.round_number === 1) return "decision";
  // R2-4 = scoring with 10 criteria
  return "scoring";
};

interface UseJudgeClassicDataArgs {
  userId: string | undefined;
  isAdmin: boolean;
  selectedCompId: string | null;
  selectedRound: string | null;
  currentRound: JudgingRound | null;
}

export function useJudgeClassicData({
  userId,
  isAdmin,
  selectedCompId,
  selectedRound,
  currentRound,
}: UseJudgeClassicDataArgs) {
  const [entries, setEntries] = useState<JudgeEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreEntries, setHasMoreEntries] = useState(false);
  const [entriesOffset, setEntriesOffset] = useState(0);
  /** Per-photo eligibility map for the current round (R2+).
   *  Key = `${entryId}::${photoIndex}`. NULL ⇒ no filter (R1 or admin override). */
  const [eligiblePhotoKeys, setEligiblePhotoKeys] = useState<Set<string> | null>(null);

  // Use React Query–based photo data hook — include selectedRound for cache key isolation
  const entryIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const photoData = useJudgePhotoData(
    selectedCompId,
    entryIds,
    userId,
    currentRound?.round_number,
    selectedRound,
  );

  // Flatten photos
  // SOW v2.1 Step 5: emit BOTH photoUrl (full original — for lightbox) and
  // photoThumbUrl (~150-250KB WebP — for grid/list/filmstrip). Falls back to
  // the full URL when no thumbnail was generated for that entry.
  // PER-PHOTO ROUTING (R2+): apply eligiblePhotoKeys filter so photos that
  // were NOT shortlisted in the previous round never surface in this round.
  const allPhotos: FlatPhoto[] = useMemo(() => {
    return entries.flatMap((entry) => {
      const photos = entry.photos && entry.photos.length > 0 ? entry.photos : [""];
      const thumbs = entry.photo_thumbnails ?? [];
      const meta: any[] = Array.isArray((entry as any).photo_meta) ? (entry as any).photo_meta : [];
      return photos
        .map((photoUrl, photoIndex) => ({
          entryId: entry.id,
          photoUrl,
          photoThumbUrl: thumbs[photoIndex] || photoUrl,
          photoIndex,
          entry,
        }))
        .filter((p) => {
          // Per-photo "One Image, One Reject" — admin-rejected photos never reach judges.
          if (meta[p.photoIndex]?.rejected === true) return false;
          return eligiblePhotoKeys === null
            ? true
            : eligiblePhotoKeys.has(`${p.entryId}::${p.photoIndex}`);
        });
    });
  }, [entries, eligiblePhotoKeys]);

  const getPhotoKey = useCallback((photo: FlatPhoto) => `${photo.entryId}::${photo.photoIndex}`, []);

  const getPhotoEvaluation = useCallback((photo: FlatPhoto): PhotoEvaluation => {
    const key = getPhotoKey(photo);
    const scoreData = photoData.photoScoresMap[key];
    const tagData = photoData.photoTagsMap[key];
    const decisionData = photoData.photoDecisionsMap[key];
    return {
      score: scoreData?.myScore ?? null,
      tags: tagData?.myTags ?? [],
      feedback: scoreData?.myFeedback ?? null,
      allScores: scoreData?.allScores ?? [],
      comments: photoData.photoCommentsMap[key] ?? [],
      criteria: scoreData?.myCriteria ?? { composition: null, color_palette: null, technique: null, line: null, shape: null, form: null, texture: null, space: null, tone: null, balance: null, light: null, depth: null, editing: null, story: null, moment: null },
      decision: decisionData?.myDecision ?? null,
    };
  }, [getPhotoKey, photoData.photoScoresMap, photoData.photoTagsMap, photoData.photoCommentsMap, photoData.photoDecisionsMap]);

  /* ── Enrichment: only fetch entry metadata (profiles + votes) ── */
  const enrichBatch = useCallback(async (rawEntries: any[], existingEntries: JudgeEntry[] = []) => {
    if (rawEntries.length === 0) return existingEntries;

    const entryIds = rawEntries.map((e) => e.id);
    const userIds = [...new Set(rawEntries.map((e) => e.user_id))];

    const [profiles, votes] = await Promise.all([
      fetchInBatches((ids) => profilesPublic().select("id, full_name, avatar_url").in("id", ids), userIds),
      fetchInBatches((ids) => supabase.from("competition_votes").select("entry_id").in("entry_id", ids) as any, entryIds),
    ]);

    const profileMap = new Map(profiles.map((p: any) => [p.id, { name: p.full_name, avatar: p.avatar_url }]));
    const votesByEntry = new Map<string, number>();
    (votes || []).forEach((v: any) => {
      votesByEntry.set(v.entry_id, (votesByEntry.get(v.entry_id) || 0) + 1);
    });

    const enriched: JudgeEntry[] = rawEntries.map((entry) => ({
      ...entry,
      placement: entry.placement || null,
      is_ai_generated: entry.is_ai_generated || false,
      ai_detection_result: entry.ai_detection_result || null,
      exif_data: entry.exif_data || null,
      // SOW v2.1 Step 5: explicit propagation (DB col may be null on legacy entries).
      photo_thumbnails: entry.photo_thumbnails ?? null,
      photo_meta: Array.isArray(entry.photo_meta) ? entry.photo_meta : null,
      photographer_name: profileMap.get(entry.user_id)?.name || null,
      photographer_avatar: profileMap.get(entry.user_id)?.avatar || null,
      vote_count: votesByEntry.get(entry.id) || 0,
      my_score: null,
      my_feedback: null,
      avg_score: null,
      my_tags: [],
      all_tags: [],
      all_scores: [],
      my_comments: [],
    }));

    const combined = [...existingEntries, ...enriched];
    return combined;
  }, []);

  /* ── Load entries page ── */
  const entriesRef = useRef<JudgeEntry[]>(entries);
  entriesRef.current = entries;

  const loadEntriesPage = useCallback(async (compId: string, offset: number, append: boolean, roundNumber?: number) => {
    if (!userId) return;

    if (append) setLoadingMore(true);
    else { setLoadingEntries(true); }

    // Check distributed assignment
    let assignedEntryIds: string[] | null = null;
    if (!isAdmin) {
      const { data: compData } = await supabase
        .from("competitions")
        .select("judge_assignment_mode")
        .eq("id", compId)
        .single();

      if (compData && (compData as any).judge_assignment_mode === "distributed") {
        const { data: assignments } = await supabase
          .from("judge_entry_assignments" as any)
          .select("entry_id")
          .eq("competition_id", compId)
          .eq("judge_id", userId);
        assignedEntryIds = assignments && (assignments as any[]).length > 0
          ? (assignments as any[]).map((a: any) => a.entry_id)
          : [];
      }
    }

    // PER-PHOTO ROUTING (R2+): the only source of truth for "what shows up in
    // round N" is judge_decisions where round_number=N-1 and decision='shortlist'.
    // entry.status / entry.current_round are NO LONGER used for routing.
    let eligibleEntryIds: string[] | null = null;
    let nextEligibleKeys: Set<string> | null = null;
    if (roundNumber && roundNumber >= 2) {
      const { data: eligibleRows, error: eligibleErr } = await (supabase.rpc as any)(
        "get_round_eligible_photos",
        { _competition_id: compId, _round_number: roundNumber },
      );
      if (eligibleErr) {
        console.error("[judge] get_round_eligible_photos failed", eligibleErr);
      }
      const rows: { entry_id: string; photo_index: number }[] = eligibleRows ?? [];
      nextEligibleKeys = new Set(rows.map((r) => `${r.entry_id}::${r.photo_index}`));
      eligibleEntryIds = [...new Set(rows.map((r) => r.entry_id))];
    }
    // Publish to state so allPhotos can filter; null clears the filter (R1).
    setEligiblePhotoKeys(nextEligibleKeys);

    let query = supabase
      .from("competition_entries")
      // SOW v2.1 Step 5: include photo_thumbnails so grid surfaces can render
      // the lightweight WebP variant instead of the full original.
      // F-04: exif_data + ai_detection_result column-revoked from `authenticated`;
      // fetched below via get_entries_private_meta RPC (judge-authorized rows only).
      .select("id, title, description, photos, photo_thumbnails, photo_meta, user_id, status, created_at, competition_id, placement, is_ai_generated, view_count")

      .eq("competition_id", compId)
      .order("created_at", { ascending: false });

    // R1: load every entry in the comp (per-judge decisions handle filtering).
    // R2+: restrict to entries with at least one shortlisted photo from prev round.
    if (roundNumber && roundNumber >= 2) {
      if (eligibleEntryIds && eligibleEntryIds.length > 0) {
        query = query.in("id", eligibleEntryIds);
      } else {
        if (!append) setEntries([]);
        setHasMoreEntries(false);
        setLoadingEntries(false);
        setLoadingMore(false);
        return;
      }
    }

    if (assignedEntryIds !== null) {
      if (assignedEntryIds.length === 0) {
        if (!append) setEntries([]);
        setHasMoreEntries(false);
        setLoadingEntries(false);
        setLoadingMore(false);
        return;
      }
      query = query.in("id", assignedEntryIds);
    }

    const { data: rawEntries } = await query.range(offset, offset + ENTRIES_PAGE_SIZE - 1);

    if (!rawEntries || rawEntries.length === 0) {
      if (!append) setEntries([]);
      setHasMoreEntries(false);
      setLoadingEntries(false);
      setLoadingMore(false);
      return;
    }

    setHasMoreEntries(rawEntries.length === ENTRIES_PAGE_SIZE);

    // F-04: fetch judge-authorized private meta (exif_data + ai_detection_result)
    // via SECURITY DEFINER RPC. Rows the judge is NOT assigned to return null.
    const rawIds = (rawEntries as any[]).map((e) => e.id);
    const { data: metaRows } = await (supabase.rpc as any)(
      "get_entries_private_meta",
      { _entry_ids: rawIds },
    );
    const metaMap = new Map(
      ((metaRows as any[]) || []).map((m) => [
        m.entry_id,
        { exif_data: m.exif_data, ai_detection_result: m.ai_detection_result },
      ]),
    );
    const rawWithMeta = (rawEntries as any[]).map((e) => ({
      ...e,
      exif_data: metaMap.get(e.id)?.exif_data ?? null,
      ai_detection_result: metaMap.get(e.id)?.ai_detection_result ?? null,
    }));

    // Use ref to avoid stale closure over `entries`
    const prevEntries = append ? entriesRef.current : [];
    const enriched = await enrichBatch(rawWithMeta, prevEntries);


    setEntries(enriched);
    setEntriesOffset(offset + rawEntries.length);
    setLoadingEntries(false);
    setLoadingMore(false);
  }, [userId, enrichBatch, isAdmin]);

  const handleLoadMore = useCallback(() => {
    if (!selectedCompId || loadingMore) return;
    const rn = currentRound?.round_number;
    loadEntriesPage(selectedCompId, entriesOffset, true, rn);
  }, [selectedCompId, entriesOffset, loadingMore, loadEntriesPage, currentRound]);

  // Load when competition or round changes
  useEffect(() => {
    if (!selectedCompId || !userId) return;
    setEntriesOffset(0);
    setHasMoreEntries(false);
    loadEntriesPage(selectedCompId, 0, false, currentRound?.round_number);
  }, [selectedCompId, userId, selectedRound]);

  // Update entry statuses optimistically
  const updateEntryLocally = useCallback((entryId: string, patch: Partial<JudgeEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));
  }, []);

  const refreshEntryStatuses = useCallback(async () => {
    if (!userId || entries.length === 0) return;
    const ids = entries.map((e) => e.id);
    const freshEntries = await fetchInBatches(
      (batchIds) => supabase.from("competition_entries").select("id, status, placement, current_round").in("id", batchIds),
      ids,
    );
    if (!freshEntries || freshEntries.length === 0) return;
    const statusMap = new Map(freshEntries.map((e: any) => [e.id, { status: e.status, placement: e.placement }]));
    setEntries((prev) => prev.map((entry) => {
      const fresh = statusMap.get(entry.id);
      if (!fresh) return entry;
      return { ...entry, status: fresh.status, placement: fresh.placement || entry.placement };
    }));
  }, [userId, entries]);

  return {
    entries,
    setEntries,
    allPhotos,
    getPhotoKey,
    getPhotoEvaluation,
    loadingEntries,
    loadingMore,
    hasMoreEntries,
    handleLoadMore,
    loadEntriesPage,
    updateEntryLocally,
    refreshEntryStatuses,
    // Photo data from React Query
    photoScoresMap: photoData.photoScoresMap,
    photoTagsMap: photoData.photoTagsMap,
    photoCommentsMap: photoData.photoCommentsMap,
    photoDecisionsMap: photoData.photoDecisionsMap,
    photoDataLoading: photoData.isLoading,
    updateScoreOptimistic: photoData.updateScoreOptimistic,
    updateTagOptimistic: photoData.updateTagOptimistic,
    addCommentOptimistic: photoData.addCommentOptimistic,
    clearOptimistic: photoData.clearOptimistic,
    updateDecisionOptimistic: photoData.updateDecisionOptimistic,
    getMyDecisionCounts: photoData.getMyDecisionCounts,
    invalidatePhotoData: photoData.invalidate,
    lockMutation: photoData.lockMutation,
    unlockMutation: photoData.unlockMutation,
  };
}
