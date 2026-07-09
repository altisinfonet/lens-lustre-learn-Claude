import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { useNavigate } from "react-router-dom";

interface VotingContext {
  competitionId: string;
  userId: string | undefined;
}

const normalizePhotoIndex = (value: unknown) => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

const applyVoteToCompetitionEntries = (old: any, entryId: string, hasVoted: boolean, photoIndex: number) => {
  if (!old?.pages) return old;

  const delta = hasVoted ? -1 : 1;
  const photoKey = String(photoIndex);

  return {
    ...old,
    pages: old.pages.map((page: any) => ({
      ...page,
      entries: page.entries.map((entry: any) => {
        if (entry.id !== entryId) return entry;

        const photoVoteMap = { ...(entry._photoVoteMap || {}) };
        const currentPhotoVotes = Number(photoVoteMap[photoKey] || 0);
        const nextPhotoVotes = Math.max(0, currentPhotoVotes + delta);
        const nextUserVotedPhotos = hasVoted
          ? ((entry._userVotedPhotos || []) as number[]).filter((index) => index !== photoIndex)
          : Array.from(new Set([...(entry._userVotedPhotos || []), photoIndex])).sort((a, b) => a - b);

        if (nextPhotoVotes === 0) delete photoVoteMap[photoKey];
        else photoVoteMap[photoKey] = nextPhotoVotes;

        return {
          ...entry,
          vote_count: Math.max(0, Number(entry.vote_count || 0) + delta),
          user_voted: nextUserVotedPhotos.length > 0,
          _photoVoteMap: photoVoteMap,
          _userVotedPhotos: nextUserVotedPhotos,
        };
      }),
    })),
  };
};

const applyVoteToDashboard = (old: any, entryId: string, hasVoted: boolean, photoIndex: number) => {
  if (!old?.sidebar) return old;

  const delta = hasVoted ? -1 : 1;

  const updateItems = (items: any) => {
    if (!Array.isArray(items)) return items;

    return items.map((item: any) => {
      const itemEntryId = item?.entry_id ?? item?.id;
      const itemPhotoIndex = normalizePhotoIndex(item?.photo_index);

      if (itemEntryId !== entryId || itemPhotoIndex !== photoIndex) return item;

      return {
        ...item,
        vote_count: Math.max(0, Number(item?.vote_count ?? 0) + delta),
        user_voted: !hasVoted,
      };
    });
  };

  return {
    ...old,
    sidebar: {
      ...old.sidebar,
      voting_entries: updateItems(old.sidebar.voting_entries),
      voting_thumbnails: updateItems(old.sidebar.voting_thumbnails),
    },
  };
};

export function useCompetitionVoting({ competitionId, userId }: VotingContext) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  void userId;

  const mutation = useMutation({
    mutationFn: async ({ entryId, hasVoted, photoIndex = 0 }: { entryId: string; hasVoted: boolean; photoIndex?: number }) => {
      if (!user) {
        navigate("/login");
        throw new Error("Not authenticated");
      }

      const action = hasVoted ? "unvote" : "vote";

      // Phase 1: single atomic edge function — vote write + wallet reward in one round-trip.
      const { data, error: voteError } = await supabase.functions.invoke("cast-photo-vote", {
        body: { entryId, action, photoIndex },
      });
      if (voteError) throw voteError;
      if (data?.error) throw new Error(data.error);

      if (action === "unvote" && data?.rewards_applied) {
        const penalty = Math.abs(Number(data.voter_reward || 0));
        if (penalty > 0) {
          toast({
            title: "⚠️ Unvote Penalty Applied",
            description: `Double the vote reward (${formatUSDFixed(penalty, 3)}) has been deducted from your wallet.`,
            variant: "destructive",
          });
        }
      } else if (action === "vote" && data?.rewards_applied && Number(data.voter_reward) > 0) {
        toast({
          title: "🎉 Vote Recorded!",
          description: `You earned ${formatUSDFixed(Number(data.voter_reward), 3)} in your wallet.`,
        });
      }

      return { entryId, action, photoIndex };
    },

    onMutate: async ({ entryId, hasVoted, photoIndex = 0 }) => {
      const normalizedPhotoIndex = normalizePhotoIndex(photoIndex);
      const entriesKey = ["competition-entries", competitionId] as const;
      const dashboardSnapshots = qc.getQueriesData({ queryKey: ["dashboard-init"] });

      if (competitionId) {
        await qc.cancelQueries({ queryKey: entriesKey });
      }

      const snapshot = competitionId ? qc.getQueryData(entriesKey) : undefined;

      if (competitionId) {
        qc.setQueryData(entriesKey, (old: any) =>
          applyVoteToCompetitionEntries(old, entryId, hasVoted, normalizedPhotoIndex),
        );
      }

      qc.setQueriesData({ queryKey: ["dashboard-init"] }, (old: any) =>
        applyVoteToDashboard(old, entryId, hasVoted, normalizedPhotoIndex),
      );

      return { snapshot, entriesKey, dashboardSnapshots };
    },

    onError: (err: any, _vars, context) => {
      if (context?.snapshot) {
        qc.setQueryData(context.entriesKey, context.snapshot);
      }
      context?.dashboardSnapshots?.forEach(([queryKey, data]: [readonly unknown[], unknown]) => {
        qc.setQueryData(queryKey, data);
      });
      const msg = typeof err?.message === "string" && err.message.includes("own entry")
        ? "You cannot vote on your own entry"
        : "Vote failed";
      toast({ title: msg, variant: "destructive" });
    },

    onSettled: () => {
      if (competitionId) {
        void qc.invalidateQueries({ queryKey: ["competition-entries", competitionId] });
      }
      void qc.invalidateQueries({ queryKey: ["dashboard-init"] });
    },
  });

  return {
    toggleVote: (entryId: string, hasVoted: boolean, photoIndex?: number) => {
      if (mutation.isPending) return;
      mutation.mutate({ entryId, hasVoted, photoIndex: photoIndex ?? 0 });
    },
    toggleVoteAsync: (entryId: string, hasVoted: boolean, photoIndex?: number) => {
      return mutation.mutateAsync({ entryId, hasVoted, photoIndex: photoIndex ?? 0 });
    },
    isVoting: mutation.isPending,
  };
}
