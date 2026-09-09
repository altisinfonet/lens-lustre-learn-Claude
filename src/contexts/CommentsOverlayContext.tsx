/**
 * GLOBAL, MINIMAL STATE FOR "WHICH POST'S COMMENTS ARE OPEN RIGHT NOW."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A CONTEXT, AND WHY IT HOLDS NO COMMENT DATA
 *
 * Comments used to live inside PostCard, expanding the card in place
 * (src/components/PostCommentsSection.tsx's history has the detail). Fixing
 * that means the trigger (the comment icon, in PostActionRow) and the surface
 * that draws the thread (CommentsOverlay, mounted once near the app root) are
 * no longer the same subtree — PostCard can be one of dozens mounted at once
 * in a feed, and the overlay is one instance shared by all of them. A context
 * is the plumbing for that, and it carries exactly enough to open the right
 * panel: the POST (so the overlay never has to guess or re-fetch what was
 * already on screen when it was tapped) and the count-change callback the
 * caller already had wired (Feed's cache updater, PostDetail's local state —
 * see PostCard's `onCommentCountChange` prop). No comment list, no pagination
 * cursor, no composer draft lives here — that is usePostComments' job, fetched
 * fresh per postId with its own stale-post-switch guards, exactly as it was
 * before this existed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE URL IS A THIN, BEST-EFFORT MIRROR — NOT THE SOURCE OF TRUTH
 *
 * Opening comments appends `?comments=<postId>` to whatever route the member
 * is already on (never navigates), so Back closes the panel and Forward
 * reopens it without losing feed scroll position or re-fetching the feed.
 * That only works because the POST object is cached in this context across
 * the back/forward round trip — nothing is re-fetched.
 *
 * What this deliberately does NOT do: hydrate the overlay from a COLD load of
 * a URL that already carries `?comments=<id>` (a shared link, or a hard
 * refresh with the panel open) — that would need a second full post-fetch
 * path duplicating PostDetail's, for a case the inline implementation this
 * replaces never handled at all either. Documented as a known limitation
 * rather than quietly left unstated.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { UnifiedPost } from "@/types/post";

interface CommentsOverlayContextValue {
  /** The post whose comments are showing, or null when the overlay is closed. */
  post: UnifiedPost | null;
  isOpen: boolean;
  openComments: (post: UnifiedPost, onCommentCountChange?: (postId: string, delta: number) => void) => void;
  closeComments: () => void;
  /** Forwards to whatever `onCommentCountChange` the opener passed in — the same callback Feed/WallPosts/PostDetail already wire into PostCard. */
  notifyCommentCountChange: (delta: number) => void;
}

const CommentsOverlayContext = createContext<CommentsOverlayContextValue | null>(null);

const COMMENTS_PARAM = "comments";

export const CommentsOverlayProvider = ({ children }: { children: ReactNode }) => {
  const [post, setPost] = useState<UnifiedPost | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const countChangeRef = useRef<((postId: string, delta: number) => void) | undefined>(undefined);

  const openComments = useCallback(
    (nextPost: UnifiedPost, onCommentCountChange?: (postId: string, delta: number) => void) => {
      countChangeRef.current = onCommentCountChange;
      setPost(nextPost);
      setIsOpen(true);
      const next = new URLSearchParams(searchParams);
      next.set(COMMENTS_PARAM, nextPost.id);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  const closeComments = useCallback(() => {
    setIsOpen(false);
    if (searchParams.has(COMMENTS_PARAM)) {
      const next = new URLSearchParams(searchParams);
      next.delete(COMMENTS_PARAM);
      setSearchParams(next, { replace: false });
    }
  }, [searchParams, setSearchParams]);

  const notifyCommentCountChange = useCallback((delta: number) => {
    if (post) countChangeRef.current?.(post.id, delta);
  }, [post]);

  // Back/forward: the URL is the thing that actually changed, so react to IT
  // rather than trust whoever called openComments/closeComments to have also
  // driven history. Closes when the param disappears (Back past the open) and
  // reopens when it reappears WITH a post we already have cached (Forward);
  // a param with no cached post — the cold-load case above — is left closed.
  const paramPostId = searchParams.get(COMMENTS_PARAM);
  useEffect(() => {
    if (!paramPostId && isOpen) {
      setIsOpen(false);
    } else if (paramPostId && !isOpen && post?.id === paramPostId) {
      setIsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramPostId]);

  const value = useMemo<CommentsOverlayContextValue>(
    () => ({ post, isOpen, openComments, closeComments, notifyCommentCountChange }),
    [post, isOpen, openComments, closeComments, notifyCommentCountChange],
  );

  return <CommentsOverlayContext.Provider value={value}>{children}</CommentsOverlayContext.Provider>;
};

export const useCommentsOverlay = () => {
  const ctx = useContext(CommentsOverlayContext);
  if (!ctx) throw new Error("useCommentsOverlay must be used within CommentsOverlayProvider");
  return ctx;
};
