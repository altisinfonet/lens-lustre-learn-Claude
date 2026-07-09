import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { profilesPublic } from "@/lib/profilesPublic";
import { getAdminIds, resolveBadges } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";
import { fetchUserEntries } from "@/hooks/competition/useUserEntries";
import { fetchCompetitionsByIds } from "@/hooks/competition/useCompetitions";
import { fetchPhotoStatusMaps, type PhotoStatusMap } from "@/lib/perPhotoStatus";
import { fetchEntryFinalVotes } from "@/lib/finalVoteTotals";
import { selectLatestPublishedTagAssignments, type PublishedTagAssignment } from "@/lib/judging/publishedTagVisibility";

interface ImageReport {
  photo_index: number;
  scores: { score: number; feedback: string | null }[];
  comments: string[];
  avg: number | null;
}

export interface MyCompEntry {
  id: string;
  title: string;
  photos: string[];
  status: string;
  created_at: string;
  competition_title: string;
  competition_id: string;
  competition_slug: string | null;
  competition_status: string;
  competition_current_round: string | null;
  competition_cover: string | null;
  vote_count: number;
  tags: { label: string; color: string; icon?: string; image_url?: string | null }[];
  score_avg: number | null;
  score_count: number;
  judge_feedback: string[];
  image_reports: ImageReport[];
  placement: string | null;
  /** Per-photo derived status (consensus). Empty when viewer lacks permission. */
  photo_status_map: PhotoStatusMap;
}

export interface FriendRequest {
  id: string;
  requester_id: string;
  created_at: string;
  requester_name: string | null;
  requester_avatar: string | null;
}

export interface RecentPost {
  id: string;
  content: string;
  privacy: string;
  created_at: string;
  like_count: number;
  comment_count: number;
}

export interface RoleApplication {
  id: string;
  requested_role: string;
  status: string;
  reason: string | null;
  admin_message: string | null;
  created_at: string;
}

export interface DashboardData {
  roles: { role: string; created_at: string }[];
  applications: RoleApplication[];
  friendRequests: FriendRequest[];
  recentPosts: RecentPost[];
  myEntries: MyCompEntry[];
  upcomingComps: any[];
  certificates: any[];
  enrollments: any[];
  suggestedPeople: any[];
  userBadges: string[];
}

const normalizePhotoIndex = (value: unknown): number => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const createDbPhotoIndexResolver = (totalPhotos: number, observedValues: unknown[]) => {
  const parsedValues = observedValues
    .map((value) => {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
      const parsed = Number.parseInt(String(value ?? ""), 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    })
    .filter((value): value is number => value !== null);

  const hasZeroBasedEvidence = parsedValues.includes(0);
  const hasOneBasedEvidence = parsedValues.includes(1);
  const maxObserved = parsedValues.length > 0 ? Math.max(...parsedValues) : -1;
  const useOneBased = totalPhotos > 0 && !hasZeroBasedEvidence && hasOneBasedEvidence && maxObserved <= totalPhotos;

  return (value: unknown): number | null => {
    const parsed = normalizePhotoIndex(value);
    const resolved = useOneBased ? parsed - 1 : parsed;
    if (!Number.isFinite(resolved) || resolved < 0 || resolved >= totalPhotos) return null;
    return resolved;
  };
};

export const useDashboardData = (userId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.dashboard(userId || ""),
    queryFn: async (): Promise<DashboardData> => {
      if (!userId) throw new Error("No user");

      const [rolesRes, appsRes, friendReqRes, postsRes, profileMapRes, adminIds] = await Promise.all([
        supabase.from("user_roles").select("role, created_at").eq("user_id", userId),
        supabase.from("role_applications").select("id, requested_role, status, reason, admin_message, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("friendships").select("id, requester_id, created_at").eq("addressee_id", userId).eq("status", "pending").order("created_at", { ascending: false }),
        supabase.from("posts").select("id, content, privacy, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(3),
        fetchProfileMap([userId]),
        getAdminIds(),
      ]);

      const entry = profileMapRes.get(userId);
      const userBadges = resolveBadges(userId, entry?.badges || [], adminIds);
      const roles = rolesRes.data || [];
      const applications = (appsRes.data || []) as RoleApplication[];

      // Friend requests with profiles
      let friendRequests: FriendRequest[] = [];
      if (friendReqRes.data && friendReqRes.data.length > 0) {
        const requesterIds = friendReqRes.data.map((r) => r.requester_id);
        const { data: profiles } = await profilesPublic().select("id, full_name, avatar_url").in("id", requesterIds);
        const profileMap = new Map((profiles as any[] || []).map((p: any) => [p.id, p]));
        friendRequests = friendReqRes.data.map((r) => ({
          ...r,
          requester_name: profileMap.get(r.requester_id)?.full_name || null,
          requester_avatar: profileMap.get(r.requester_id)?.avatar_url || null,
        }));
      }

      // Recent posts with counts
      let recentPosts: RecentPost[] = [];
      if (postsRes.data && postsRes.data.length > 0) {
        const postIds = postsRes.data.map((p) => p.id);
        const [reactionsRes, commentsRes] = await Promise.all([
          supabase.from("post_reactions").select("post_id").in("post_id", postIds),
          supabase.from("post_comments").select("post_id").in("post_id", postIds),
        ]);
        const likeCounts: Record<string, number> = {};
        (reactionsRes.data || []).forEach((r) => { likeCounts[r.post_id] = (likeCounts[r.post_id] || 0) + 1; });
        const commentCounts: Record<string, number> = {};
        (commentsRes.data || []).forEach((c) => { commentCounts[c.post_id] = (commentCounts[c.post_id] || 0) + 1; });
        recentPosts = postsRes.data.map((p) => ({ ...p, like_count: likeCounts[p.id] || 0, comment_count: commentCounts[p.id] || 0 }));
      }

      // Competition entries — reuse shared cached fetch.
      // Audit v6 / P-05: pageSize is explicit (was an implicit `.limit(50)`
      // inside fetchUserEntries). The dashboard summary keeps the same first
      // 50 rows for stats/overview parity; the SubmissionsTab uses
      // `useUserEntriesInfinite` to surface entries beyond this slice.
      let myEntries: MyCompEntry[] = [];
      const myEntriesData = await fetchUserEntries(userId, { pageSize: 50 });

      if (myEntriesData && myEntriesData.length > 0) {
        const entryIds = myEntriesData.map((e) => e.id);
        const compIds = [...new Set(myEntriesData.map((e) => e.competition_id))];

        // Final votes come from a backend edge function (service role).
        // The browser NEVER reads competition_votes or admin_vote_adjustments.
        // RLS keeps admin_vote_adjustments admin-only at the DB level.
        const finalVotesPromise = fetchEntryFinalVotes(entryIds)
          .catch(() => ({ totals: {} as Record<string, number>, perPhoto: {} as Record<string, Record<string, number>> }));

        const [compMap, finalVotes, tagAssignRes, scoresRes, commentsRes, publishRes] = await Promise.all([
          fetchCompetitionsByIds(compIds),
          finalVotesPromise,
          // HOTFIX-G: read from publish-gated owner-safe views (no judge_id leak,
          // and zero rows pre-publication regardless of round).
          supabase.from("judge_tag_assignments_owner_safe" as any).select("entry_id, tag_id, photo_index, created_at").in("entry_id", entryIds),
          supabase.from("judge_scores").select("entry_id, score, feedback, photo_index").in("entry_id", entryIds),
          supabase.from("judge_comments_owner_safe" as any).select("entry_id, comment, photo_index").in("entry_id", entryIds),
          supabase.from("competition_round_publish").select("competition_id, round_number, published_at").in("competition_id", compIds),
        ]);

        // SOW Visibility Matrix (Rule #6): participant-facing per-photo
        // statuses and tags are revealed only after ADMIN DECLARE
        // (`competition_round_publish.published_at`), not when judges act or
        // when judging_rounds.status flips to completed.
        const publishedRoundsByComp = new Map<string, Set<number>>();
        ((publishRes as any)?.data || []).forEach((r: any) => {
          if (r.published_at == null) return;
          const set = publishedRoundsByComp.get(r.competition_id) || new Set<number>();
          set.add(Number(r.round_number));
          publishedRoundsByComp.set(r.competition_id, set);
        });
        const photoStatusMaps = new Map<string, PhotoStatusMap>();
        await Promise.all(compIds.map(async (compId) => {
          const idsForComp = myEntriesData.filter((e) => e.competition_id === compId).map((e) => e.id);
          const mapsForComp = await fetchPhotoStatusMaps(idsForComp, [compId], {
            viewerRole: "owner",
            publishedRounds: publishedRoundsByComp.get(compId) || new Set<number>(),
          });
          mapsForComp.forEach((value, key) => photoStatusMaps.set(key, value));
        }));
        const compPhaseById = new Map<string, string>();
        compMap.forEach((v: any, k: string) => compPhaseById.set(k, (v?.phase || "submission_open")));
        const resolverByEntry = new Map<string, (value: unknown) => number | null>(
          myEntriesData.map((entry) => {
            const observedValues = [
              ...((tagAssignRes.data || []).filter((row: any) => row.entry_id === entry.id).map((row: any) => row.photo_index)),
              ...((scoresRes.data || []).filter((row: any) => row.entry_id === entry.id).map((row: any) => row.photo_index)),
              ...((commentsRes.data || []).filter((row: any) => row.entry_id === entry.id).map((row: any) => row.photo_index)),
              ...Object.keys(photoStatusMaps.get(entry.id) ?? {}).map(Number),
            ];
            return [entry.id, createDbPhotoIndexResolver(entry.photos.length, observedValues)];
          }),
        );
        // Tag visible-in-round metadata so we can gate tags by per-round close.
        const allTagIds = [...new Set((tagAssignRes.data || []).map((t: any) => t.tag_id))];
        let tagRoundMap = new Map<string, number[]>();
        if (allTagIds.length > 0) {
          const { data: tagsMeta } = await supabase
            .from("judging_tags" as any)
            .select("id, visible_in_round")
            .in("id", allTagIds);
          (tagsMeta as any[] || []).forEach((t: any) => {
            tagRoundMap.set(t.id, Array.isArray(t.visible_in_round) ? t.visible_in_round.map((n: any) => Number(n)) : []);
          });
        }

        // Authoritative final totals from backend (real_votes + admin adjustments).
        const finalTotals = finalVotes.totals;

        const normalizedScores = (scoresRes.data || []).flatMap((s: any) => {
          const photoIndex = resolverByEntry.get(s.entry_id)?.(s.photo_index);
          return photoIndex == null ? [] : [{ ...s, photo_index: photoIndex }];
        });
        const normalizedComments = (commentsRes.data || []).flatMap((c: any) => {
          const photoIndex = resolverByEntry.get(c.entry_id)?.(c.photo_index);
          return photoIndex == null ? [] : [{ ...c, photo_index: photoIndex }];
        });

        const scoreMap: Record<string, { avg: number; count: number; feedback: string[] }> = {};
        normalizedScores.forEach((s: any) => {
          if (!scoreMap[s.entry_id]) scoreMap[s.entry_id] = { avg: 0, count: 0, feedback: [] };
          scoreMap[s.entry_id].avg += s.score;
          scoreMap[s.entry_id].count += 1;
          if (s.feedback) scoreMap[s.entry_id].feedback.push(s.feedback);
        });
        Object.values(scoreMap).forEach((s) => { s.avg = Math.round((s.avg / s.count) * 10) / 10; });

        const imageReportMap: Record<string, Record<number, ImageReport>> = {};
        normalizedScores.forEach((s: any) => {
          if (!imageReportMap[s.entry_id]) imageReportMap[s.entry_id] = {};
          if (!imageReportMap[s.entry_id][s.photo_index]) imageReportMap[s.entry_id][s.photo_index] = { photo_index: s.photo_index, scores: [], comments: [], avg: null };
          imageReportMap[s.entry_id][s.photo_index].scores.push({ score: s.score, feedback: s.feedback });
        });
        normalizedComments.forEach((c: any) => {
          if (!imageReportMap[c.entry_id]) imageReportMap[c.entry_id] = {};
          if (!imageReportMap[c.entry_id][c.photo_index]) imageReportMap[c.entry_id][c.photo_index] = { photo_index: c.photo_index, scores: [], comments: [], avg: null };
          imageReportMap[c.entry_id][c.photo_index].comments.push(c.comment);
        });
        Object.values(imageReportMap).forEach((entryReports) => {
          Object.values(entryReports).forEach((report) => {
            if (report.scores.length > 0) {
              report.avg = Math.round((report.scores.reduce((s, sc) => s + sc.score, 0) / report.scores.length) * 10) / 10;
            }
          });
        });

        const normalizedTagRows: PublishedTagAssignment[] = [];
        (tagAssignRes.data || []).forEach((t: any) => {
          const photoIndex = resolverByEntry.get(t.entry_id)?.(t.photo_index);
          if (photoIndex == null) return;
          normalizedTagRows.push({ entry_id: t.entry_id, tag_id: t.tag_id, photo_index: photoIndex, created_at: t.created_at ?? null });
        });

        const uniqueTagIds = [...new Set(normalizedTagRows.map((t) => t.tag_id))];
        let tagInfoMap = new Map<string, { label: string; color: string; icon?: string; image_url?: string | null }>();
        if (uniqueTagIds.length > 0) {
          const { data: tagsData } = await supabase.from("judging_tags" as any).select("id, label, color, icon, image_url").in("id", uniqueTagIds);
          (tagsData as any[] || []).forEach((t: any) => tagInfoMap.set(t.id, { label: t.label, color: t.color, icon: t.icon, image_url: t.image_url }));
        }

        myEntries = myEntriesData.map((e) => {
          const phase = compPhaseById.get(e.competition_id) || "submission_open";
          const completed = publishedRoundsByComp.get(e.competition_id) || new Set<number>();
          const scoresReleased = phase === "result";
          const visibleTagsForEntry: { label: string; color: string; icon?: string; image_url?: string | null }[] = [];
          selectLatestPublishedTagAssignments(
            normalizedTagRows.filter((row) => row.entry_id === e.id),
            tagRoundMap,
            completed,
          ).forEach((row) => {
            const info = tagInfoMap.get(row.tag_id);
            if (info && !visibleTagsForEntry.some((tag) => tag.label === info.label)) visibleTagsForEntry.push(info);
          });
          return {
            ...e,
            competition_title: compMap.get(e.competition_id)?.title || "Unknown",
            competition_slug: compMap.get(e.competition_id)?.slug || null,
            competition_status: compMap.get(e.competition_id)?.phase || "submission_open",
            competition_current_round: compMap.get(e.competition_id)?.current_round ?? null,
            competition_cover: compMap.get(e.competition_id)?.cover_image_url || null,
            vote_count: finalTotals[e.id] ?? 0,
            tags: visibleTagsForEntry,
            // SOW privacy: marks visible to participant ONLY after results are declared.
            score_avg: scoresReleased ? (scoreMap[e.id]?.avg || null) : null,
            score_count: scoresReleased ? (scoreMap[e.id]?.count || 0) : 0,
            judge_feedback: scoresReleased ? (scoreMap[e.id]?.feedback || []) : [],
            image_reports: scoresReleased && imageReportMap[e.id]
              ? Object.values(imageReportMap[e.id]).sort((a, b) => a.photo_index - b.photo_index)
              : [],
            photo_status_map: Object.fromEntries(
              Object.entries(photoStatusMaps.get(e.id) ?? {}).flatMap(([photoIndex, status]) => {
                const resolved = resolverByEntry.get(e.id)?.(Number(photoIndex));
                return resolved == null ? [] : [[resolved, status]];
              }),
            ) as PhotoStatusMap,
          };
        });
      }

      // Additional dashboard data
      const [upcomingCompsRes, certsRes, enrollmentsRes, suggestedRes] = await Promise.all([
        supabase.from("competitions").select("id, slug, title, starts_at, ends_at, cover_image_url, category").eq("status", "upcoming").order("starts_at", { ascending: true }).limit(3),
        supabase.from("certificates").select("id, title, type, issued_at, reference_id").eq("user_id", userId).eq("is_revoked", false).order("issued_at", { ascending: false }).limit(20),
        supabase.from("course_enrollments").select("id, course_id, enrolled_at, courses(id, title, cover_image_url, slug)").eq("user_id", userId).order("enrolled_at", { ascending: false }).limit(3),
        profilesPublic().select("id, full_name, avatar_url, bio").neq("id", userId).limit(5),
      ]);

      return {
        roles,
        applications,
        friendRequests,
        recentPosts,
        myEntries,
        upcomingComps: upcomingCompsRes.data || [],
        certificates: certsRes.data || [],
        enrollments: enrollmentsRes.data || [],
        suggestedPeople: (suggestedRes.data as any[]) || [],
        userBadges,
      };
    },
    enabled: !!userId,
    refetchInterval: 30000, // replaces the manual 30s polling
  });
};
