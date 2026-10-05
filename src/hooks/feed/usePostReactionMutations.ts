import { useMutation } from "@tanstack/react-query";
import { submit } from "@/lib/offline/outbox";
import { useAuth } from "@/hooks/core/useAuth";
import { useFeedCacheUpdaters } from "@/hooks/feed/useFeedCacheUpdaters";
import { useIsBanned } from "@/hooks/core/useIsBanned";
import type { ReactionType } from "@/components/ReactionPicker";

/* ── Shared post-like shape expected by consumers ── */

export interface ReactablePost {
  id: string;
  like_count: number;
  is_liked: boolean;
  user_reaction: ReactionType | null;
  top_reactions: string[];
  reaction_counts: Record<string, number>;
}

/* ── Optimistic state helpers ── */

/** Recompute top_reactions from reaction_counts — picks the top 3 types with count > 0 */
function computeTopReactions(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type);
}

function applyReact<T extends ReactablePost>(post: T, reactionType: ReactionType): T {
  const oldReaction = post.user_reaction;
  const newCount = oldReaction ? post.like_count : post.like_count + 1;
  const newCounts = { ...post.reaction_counts };
  if (oldReaction) newCounts[oldReaction] = Math.max(0, (newCounts[oldReaction] || 0) - 1);
  newCounts[reactionType] = (newCounts[reactionType] || 0) + 1;
  return {
    ...post,
    is_liked: true,
    user_reaction: reactionType,
    like_count: newCount,
    top_reactions: computeTopReactions(newCounts),
    reaction_counts: newCounts,
  };
}

function applyUnreact<T extends ReactablePost>(post: T): T {
  const newCounts = { ...post.reaction_counts };
  if (post.user_reaction) newCounts[post.user_reaction] = Math.max(0, (newCounts[post.user_reaction] || 0) - 1);
  return {
    ...post,
    is_liked: false,
    user_reaction: null,
    like_count: Math.max(0, post.like_count - 1),
    top_reactions: computeTopReactions(newCounts),
    reaction_counts: newCounts,
  };
}

/** Custom cache mapper — a function that applies a post mapper to the relevant cache. */
export type PostCacheMapper<T extends ReactablePost> = (mapper: (post: T) => T) => void;

/**
 * Internal helper — creates a mapper function that works with both
 * a custom cache mapper and the feed cache mapPosts (default).
 */
function usePostMapper<T extends ReactablePost>(
  customMapper?: PostCacheMapper<T>,
) {
  const { mapPosts } = useFeedCacheUpdaters();

  return (mapper: (post: T) => T) => {
    if (customMapper) {
      customMapper(mapper);
    } else {
      mapPosts(mapper as any);
    }
  };
}

/* ── React (add / switch reaction) ── */

export function useReactToPost<T extends ReactablePost>(
  customMapper?: PostCacheMapper<T>,
) {
  const { user } = useAuth();
  const { isBanned } = useIsBanned();
  const applyMap = usePostMapper(customMapper);

  return useMutation({
    mutationFn: async ({ postId, reactionType, hadPreviousReaction }: {
      postId: string;
      reactionType: ReactionType;
      hadPreviousReaction: boolean;
    }) => {
      if (!user) throw new Error("Not authenticated");
      if (isBanned) throw new Error("Your account is restricted from this action");
      // OFF-2: through the outbox. Online it is sent at once; offline (or if
      // the link drops) it stays on the device and is sent once, later. Only a
      // refusal from the server throws, and only then is the optimistic like
      // rolled back.
      return submit(user.id, { kind: "react", postId, reactionType, replace: hadPreviousReaction });
    },
    // React Query would otherwise PAUSE this mutation offline — in memory, lost
    // on a restart. The outbox is what waits for the network now.
    networkMode: "always",
    onMutate: async ({ postId, reactionType }) => {
      let snapshot: ReactablePost | undefined;
      applyMap((p) => {
        if (p.id !== postId) return p;
        snapshot = { id: p.id, like_count: p.like_count, is_liked: p.is_liked, user_reaction: p.user_reaction, top_reactions: [...p.top_reactions], reaction_counts: { ...p.reaction_counts } };
        return applyReact(p, reactionType);
      });
      return { snapshot, postId };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        const s = context.snapshot;
        applyMap((p) => (p.id === context.postId ? { ...p, ...s } as T : p));
      }
    },
  });
}

/* ── Unreact (remove reaction) ── */

export function useUnreactToPost<T extends ReactablePost>(
  customMapper?: PostCacheMapper<T>,
) {
  const { user } = useAuth();
  const applyMap = usePostMapper(customMapper);

  return useMutation({
    mutationFn: async (postId: string) => {
      if (!user) throw new Error("Not authenticated");
      return submit(user.id, { kind: "unreact", postId });
    },
    networkMode: "always",
    onMutate: async (postId) => {
      let snapshot: ReactablePost | undefined;
      applyMap((p) => {
        if (p.id !== postId) return p;
        snapshot = { id: p.id, like_count: p.like_count, is_liked: p.is_liked, user_reaction: p.user_reaction, top_reactions: [...p.top_reactions], reaction_counts: { ...p.reaction_counts } };
        return applyUnreact(p);
      });
      return { snapshot, postId };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        const s = context.snapshot;
        applyMap((p) => (p.id === context.postId ? { ...p, ...s } as T : p));
      }
    },
  });
}
