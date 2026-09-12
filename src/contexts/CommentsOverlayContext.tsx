/**
 * GLOBAL, MINIMAL STATE FOR "WHICH COMMENT THREAD IS OPEN RIGHT NOW."
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
 * panel and nothing that belongs to a specific thread's data layer — that is
 * usePostComments' job (posts) or AdComments'/adEngagement.ts's (ads), fetched
 * fresh per id with their own guards, exactly as before this existed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SUBJECT, TWO SHAPES — NOT A SECOND CONTEXT
 *
 * "For All sponsored Ad, Like Comment share is required like a normal post"
 * (owner, 2026-08-11) is why AdEngagementBar draws the same PostActionRow and
 * the same CommentThread a post does (see those files). It shipped BEFORE this
 * overlay existed, so its "Comment" tap still opened its thread inline under
 * the card — the exact pattern this file replaced for posts, left standing on
 * the ad surface only because nobody had come back to it. `subject` is a
 * discriminated union rather than a second `AdCommentsOverlayContext` so the
 * one thing both need — "which id is open, and how does closing it clear that
 * state" — is written once. What genuinely differs (a post's data comes back
 * as an object already in hand; an ad's count-refresh callback takes no delta)
 * stays out of this file and lives in CommentsOverlay's branch instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE URL IS A THIN, BEST-EFFORT MIRROR — NOT THE SOURCE OF TRUTH
 *
 * Opening comments appends `?comments=<postId>` (or `?comments=ad:<creativeId>`
 * for an ad) to whatever route the member is already on (never navigates), so
 * Back closes the panel and Forward reopens it without losing feed scroll
 * position or re-fetching the feed. That only works because the subject is
 * cached in this context across the back/forward round trip — nothing is
 * re-fetched.
 *
 * What this deliberately does NOT do: hydrate the overlay from a COLD load of
 * a URL that already carries `?comments=<id>` (a shared link, or a hard
 * refresh with the panel open) — that would need a second full post/ad-fetch
 * path duplicating PostDetail's/AdDetail's, for a case the inline
 * implementation this replaces never handled at all either. Documented as a
 * known limitation rather than quietly left unstated.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { UnifiedPost } from "@/types/post";

export type CommentsSubject =
  | { kind: "post"; post: UnifiedPost }
  | { kind: "ad"; creativeId: string; imageUrl: string | null };

interface CommentsOverlayContextValue {
  /** What the overlay is showing, or null when it is closed. */
  subject: CommentsSubject | null;
  isOpen: boolean;
  openPostComments: (post: UnifiedPost, onCommentCountChange?: (postId: string, delta: number) => void) => void;
  openAdComments: (creativeId: string, imageUrl: string | null, onCommentsChanged?: () => void) => void;
  closeComments: () => void;
  /** Forwards to whatever `onCommentCountChange` the opener passed in — the same callback Feed/WallPosts/PostDetail already wire into PostCard. */
  notifyCommentCountChange: (delta: number) => void;
  /** Forwards to whatever `onCommentsChanged` openAdComments was given — AdEngagementBar's own count re-fetch. */
  notifyAdCommentsChanged: () => void;
}

const CommentsOverlayContext = createContext<CommentsOverlayContextValue | null>(null);

const COMMENTS_PARAM = "comments";
const AD_PREFIX = "ad:";

export const CommentsOverlayProvider = ({ children }: { children: ReactNode }) => {
  const [subject, setSubject] = useState<CommentsSubject | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const postCountChangeRef = useRef<((postId: string, delta: number) => void) | undefined>(undefined);
  const adChangeRef = useRef<(() => void) | undefined>(undefined);

  const openPostComments = useCallback(
    (nextPost: UnifiedPost, onCommentCountChange?: (postId: string, delta: number) => void) => {
      postCountChangeRef.current = onCommentCountChange;
      setSubject({ kind: "post", post: nextPost });
      setIsOpen(true);
      const next = new URLSearchParams(searchParams);
      next.set(COMMENTS_PARAM, nextPost.id);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  const openAdComments = useCallback(
    (creativeId: string, imageUrl: string | null, onCommentsChanged?: () => void) => {
      adChangeRef.current = onCommentsChanged;
      setSubject({ kind: "ad", creativeId, imageUrl });
      setIsOpen(true);
      const next = new URLSearchParams(searchParams);
      next.set(COMMENTS_PARAM, `${AD_PREFIX}${creativeId}`);
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
    if (subject?.kind === "post") postCountChangeRef.current?.(subject.post.id, delta);
  }, [subject]);

  const notifyAdCommentsChanged = useCallback(() => {
    if (subject?.kind === "ad") adChangeRef.current?.();
  }, [subject]);

  // Back/forward: the URL is the thing that actually changed, so react to IT
  // rather than trust whoever called open*Comments/closeComments to have also
  // driven history. Closes when the param disappears (Back past the open) and
  // reopens when it reappears WITH a subject we already have cached (Forward);
  // a param with no cached subject — the cold-load case above — is left closed.
  const param = searchParams.get(COMMENTS_PARAM);
  useEffect(() => {
    if (!param && isOpen) {
      setIsOpen(false);
    } else if (param && !isOpen) {
      const matches = param.startsWith(AD_PREFIX)
        ? subject?.kind === "ad" && subject.creativeId === param.slice(AD_PREFIX.length)
        : subject?.kind === "post" && subject.post.id === param;
      if (matches) setIsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  const value = useMemo<CommentsOverlayContextValue>(
    () => ({ subject, isOpen, openPostComments, openAdComments, closeComments, notifyCommentCountChange, notifyAdCommentsChanged }),
    [subject, isOpen, openPostComments, openAdComments, closeComments, notifyCommentCountChange, notifyAdCommentsChanged],
  );

  return <CommentsOverlayContext.Provider value={value}>{children}</CommentsOverlayContext.Provider>;
};

export const useCommentsOverlay = () => {
  const ctx = useContext(CommentsOverlayContext);
  if (!ctx) throw new Error("useCommentsOverlay must be used within CommentsOverlayProvider");
  return ctx;
};
