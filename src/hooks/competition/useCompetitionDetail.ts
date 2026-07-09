import { useEffect, useMemo } from "react";
import { useQuery, useInfiniteQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { getAdminIds, resolveBadges } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";
import { resolvePhase } from "@/lib/competitionPhase";
import { fetchPhotoStatusMaps } from "@/lib/perPhotoStatus";
import { fetchEntryFinalVotes } from "@/lib/finalVoteTotals";

const ENTRIES_PAGE_SIZE = 10;

export interface CompetitionFull {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  category: string;
  entry_fee: number;
  prize_info: string | null;
  status: string;
  phase: string;
  current_round: string | null;
  max_entries_per_user: number;
  max_photos_per_entry: number;
  starts_at: string;
  ends_at: string;
  ai_images_allowed: boolean;
  total_entries: number;
}

export interface CompetitionEntry {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  /** Per-photo metadata is required for One Image, One Card naming. */
  photo_meta: any[] | null;
  /** Phase 2: low-bandwidth thumbnails for grid display. May be null/empty/partial for legacy entries — always fall back to photos[i]. */
  photo_thumbnails: string[] | null;
  user_id: string;
  status: string;
  created_at: string;
  placement: string | null;
  profiles: { full_name: string | null } | null;
  vote_count: number;
  user_voted: boolean;
  badges: string[];
}

/** Fetches competition metadata + total entry count + user entry count */
export const useCompetitionMeta = (slugOrId: string | undefined, userId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.competitionDetail(slugOrId || ""),
    queryFn: async (): Promise<{ competition: CompetitionFull; userEntryCount: number }> => {
      if (!slugOrId) throw new Error("Missing slug/id");

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
      const col = isUuid ? "id" : "slug";
      const { data: comp, error: compError } = await supabase
        .from("competitions")
        .select("id, title, description, cover_image_url, category, entry_fee, prize_info, status, phase, current_round, max_entries_per_user, max_photos_per_entry, starts_at, ends_at, voting_ends_at, judging_completed, ai_images_allowed")
        .eq(col, slugOrId)
        .single();
      if (compError) throw compError;

      // Get total entry count
      const { count: totalEntries } = await supabase
        .from("competition_entries")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", comp.id)
        .in("status", ["submitted", "approved", "shortlisted", "round1_qualified", "round2_qualified", "finalist", "winner", "needs_review"]);

      let userEntryCount = 0;
      if (userId) {
        const { count } = await supabase
          .from("competition_entries")
          .select("id", { count: "exact", head: true })
          .eq("competition_id", comp.id)
          .eq("user_id", userId);
        userEntryCount = count || 0;
      }

      const safeComp = { ...comp, phase: resolvePhase(comp), total_entries: totalEntries || 0 } as CompetitionFull;
      return { competition: safeComp, userEntryCount };
    },
    enabled: !!slugOrId,
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
};

/** Paginated entries with vote counts */
export const useCompetitionEntries = (competitionId: string | undefined, userId: string | undefined, phase?: string) => {
  const isVoting = phase === "voting";
  const qc = useQueryClient();

  useEffect(() => {
    if (!competitionId) return;

    const invalidateEntries = () => {
      qc.invalidateQueries({ queryKey: ["competition-entries", competitionId] });
      qc.invalidateQueries({ queryKey: ["competition-detail"] });
    };

    const channel = supabase
      .channel(`competition-entries-live-${competitionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_round_publish", filter: `competition_id=eq.${competitionId}` },
        invalidateEntries,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [competitionId, qc]);

  return useInfiniteQuery({
    queryKey: ["competition-entries", competitionId],
    queryFn: async ({ pageParam = 0 }): Promise<{ entries: CompetitionEntry[]; nextCursor: number | null }> => {
      if (!competitionId) throw new Error("Missing competition id");

      const from = pageParam;
      const to = from + ENTRIES_PAGE_SIZE - 1;

      const { data: rawEntries } = await supabase
        .from("competition_entries")
        .select("id, title, description, photos, photo_thumbnails, photo_meta, user_id, status, created_at, placement")
        .eq("competition_id", competitionId)
        .in("status", ["submitted", "approved", "shortlisted", "round1_qualified", "round2_qualified", "finalist", "winner", "needs_review"])
        .order("created_at", { ascending: false })
        .range(from, to);

      if (!rawEntries || rawEntries.length === 0) {
        return { entries: [], nextCursor: null };
      }

      const entryIds = rawEntries.map((e) => e.id);

      // CRITICAL: fetch publish ledger FIRST so we can gate per-photo status +
      // R4 tag maps by `published_at`. Without this gate, placements (Winner /
      // Top 50 / Top 100 / Runner-Up / Honorary / Special Jury) would leak to
      // participants before the admin declares Round 4.
      const { data: publishRows } = await supabase
        .from("competition_round_publish")
        .select("round_number, published_at")
        .eq("competition_id", competitionId);

      const publishedRounds = new Set<number>(
        ((publishRows as any[]) || [])
          .filter((row) => row?.published_at != null)
          .map((row) => Number(row.round_number)),
      );
      const anyRoundPublished = publishedRounds.size > 0;

      const [{ totals: finalTotals, perPhoto: finalPerPhoto }, { data: votes }, userIds, adminIds, photoStatusMaps, { data: r4TagAssignRows }] = await Promise.all([
        fetchEntryFinalVotes(entryIds),
        supabase
          .from("competition_votes")
          .select("entry_id, user_id, photo_index")
          .in("entry_id", entryIds),
        Promise.resolve([...new Set(rawEntries.map((e) => e.user_id))]),
        getAdminIds(),
        fetchPhotoStatusMaps(entryIds, [competitionId], { viewerRole: "owner", publishedRounds }),
        // HOTFIX-G: read R4 tag assignments from publish-gated owner-safe view
        // (no judge_id leak; zero rows pre-publication). Tag metadata is
        // hydrated via a separate `judging_tags` lookup below — the view has
        // no FK metadata so PostgREST FK-embed is not available here.
        supabase
          .from("judge_tag_assignments_owner_safe" as any)
          .select("entry_id, tag_id, photo_index, created_at")
          .in("entry_id", entryIds)
          .eq("round_number", 4)
          .order("created_at", { ascending: false }),
      ]);

      const r4TagIds = [...new Set(((r4TagAssignRows as any[]) || []).map((r) => r.tag_id).filter(Boolean))];
      const { data: r4TagMetaRows } = r4TagIds.length > 0
        ? await supabase
            .from("judging_tags" as any)
            .select("id, label, color, icon, image_url")
            .in("id", r4TagIds)
        : { data: [] as any[] };
      const r4TagMetaById = new Map<string, any>(
        ((r4TagMetaRows as any[]) || []).map((t) => [t.id, t]),
      );
      const r4TagRows = ((r4TagAssignRows as any[]) || []).map((r) => ({
        ...r,
        judging_tags: r4TagMetaById.get(r.tag_id) || null,
      }));

      const profileMap = await fetchProfileMap(userIds);

      // Pre-bucket votes ONCE: O(V) instead of O(entries × votes).
      // Shape: entry_id → { photoVoteMap: {photoIndex: count}, userVotedPhotos: number[], totalVotes: number }
      const votesByEntry = new Map<string, { photoVoteMap: Record<string, number>; userVotedPhotos: number[]; totalVotes: number }>();
      if (votes) {
        for (const v of votes) {
          const pi = (v as any).photo_index ?? 0;
          let bucket = votesByEntry.get(v.entry_id);
          if (!bucket) {
            bucket = { photoVoteMap: {}, userVotedPhotos: [], totalVotes: 0 };
            votesByEntry.set(v.entry_id, bucket);
          }
          const piKey = String(pi);
          bucket.photoVoteMap[piKey] = (bucket.photoVoteMap[piKey] || 0) + 1;
          bucket.totalVotes += 1;
          if (userId && v.user_id === userId && !bucket.userVotedPhotos.includes(pi)) {
            bucket.userVotedPhotos.push(pi);
          }
        }
      }

      const r4TagsByEntryPhoto = new Map<string, any>();
      for (const row of ((r4TagRows as any[]) || [])) {
        const key = `${row.entry_id}::${row.photo_index ?? 0}`;
        if (!r4TagsByEntryPhoto.has(key)) r4TagsByEntryPhoto.set(key, row.judging_tags);
      }

      const entries: CompetitionEntry[] = rawEntries.map((entry) => {
        const prof = profileMap.get(entry.user_id);
        const bucket = votesByEntry.get(entry.id);
        const mergedPhotoVoteMap = finalPerPhoto[entry.id] ?? bucket?.photoVoteMap ?? {};

        return {
          ...entry,
          photo_meta: Array.isArray((entry as any).photo_meta) ? (entry as any).photo_meta : null,
          profiles: prof ? { full_name: prof.full_name! } : null,
          vote_count: finalTotals[entry.id] ?? 0,
          user_voted: false, // per-photo voting — entry-level voted is deprecated
          badges: resolveBadges(entry.user_id, prof?.badges || [], adminIds),
          _photoVoteMap: mergedPhotoVoteMap,
          _userVotedPhotos: bucket?.userVotedPhotos ?? [],
          _visibleStatus: anyRoundPublished ? entry.status : "submitted",
          // Per-photo status map. Empty {} means viewer doesn't have permission
          // (RLS) — UI must fall back to entry.status only as a last resort.
          _photoStatusMap: photoStatusMaps.get(entry.id) ?? {},
          // CRITICAL PRIVACY GATE — R4 tags (Winner / Runner-Up / Top 50 / Top 100 /
          // Honorary / Special Jury) MUST NOT leak to participants until the admin
          // has published Round 4 (`competition_round_publish.published_at` set).
          // Emit an empty map until then; EntryCard derives `photoPlacement` from
          // this map and falls back to perPhotoStatus, which is already gated.
          _photoR4TagMap: publishedRounds.has(4)
            ? Object.fromEntries(
                Array.from(r4TagsByEntryPhoto.entries())
                  .filter(([key]) => key.startsWith(`${entry.id}::`))
                  .map(([key, tag]) => [key.split("::")[1], tag]),
              )
            : {},
        };
      }).sort((a, b) => b.vote_count - a.vote_count);

      const nextCursor = rawEntries.length === ENTRIES_PAGE_SIZE ? from + ENTRIES_PAGE_SIZE : null;
      return { entries, nextCursor };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!competitionId,
    staleTime: isVoting ? 15 * 1000 : 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: isVoting,
    refetchInterval: isVoting ? 90 * 1000 : false,
    placeholderData: keepPreviousData,
  });
};

/**
 * Combined hook for backward compatibility.
 * Returns flattened entries from all loaded pages.
 */
export const useCompetitionDetail = (slugOrId: string | undefined, userId: string | undefined) => {
  const metaQuery = useCompetitionMeta(slugOrId, userId);
  const competitionId = metaQuery.data?.competition?.id;
  const phase = metaQuery.data?.competition?.phase;
  const entriesQuery = useCompetitionEntries(competitionId, userId, phase);

  const entries = useMemo(
    () => entriesQuery.data?.pages.flatMap((p) => p.entries) ?? [],
    [entriesQuery.data?.pages]
  );

  const isLoading = metaQuery.isLoading || (!!competitionId && entriesQuery.isLoading);

  const data = useMemo(
    () =>
      metaQuery.data
        ? { competition: metaQuery.data.competition, entries, userEntryCount: metaQuery.data.userEntryCount }
        : undefined,
    [metaQuery.data, entries]
  );

  return useMemo(
    () => ({
      data,
      isLoading,
      fetchNextPage: entriesQuery.fetchNextPage,
      hasNextPage: entriesQuery.hasNextPage,
      isFetchingNextPage: entriesQuery.isFetchingNextPage,
    }),
    [data, isLoading, entriesQuery.fetchNextPage, entriesQuery.hasNextPage, entriesQuery.isFetchingNextPage]
  );
};
