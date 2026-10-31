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
 * THE URL MIRRORS THE THREAD — UNDER THE NAVIGATION CONTRACT (L1)
 *
 * Opening comments appends `?comments=<postId>` (or `?comments=ad:<creativeId>`
 * for an ad) to whatever route the member is already on, so Back closes the
 * panel without losing feed scroll position or re-fetching the feed.
 *
 * F-REV4-7 (Owner, 13 Oct 2026: Back "loops on that post's comments, never
 * comes to the main feed") was THIS file: closing PUSHED a second entry
 * instead of stepping back, `subject` was never cleared, and the `[param]`
 * watcher re-opened the thread whenever Back landed on `?comments=<same id>`.
 * The rules now live in src/lib/navigationContract.ts and are followed here
 * exactly: open in-app → ONE marked entry; close by any means → step back over
 * our own entry, or replace without the parameter — never push; `subject` is
 * cleared on close; the watcher re-opens only on a real traversal (POP) into
 * an entry we marked, from the copy kept for exactly that (browser Forward).
 *
 * A link that ALREADY carries `?comments=<id>` (shared link, cold start, hard
 * refresh) is opened by the card that has the post or ad in hand — PostCard
 * through usePostCommentsDeepLink, AdEngagementBar through
 * useAdCommentsDeepLink — so there is still no second post/ad-fetch path here.
 * If no card on the page carries that id, the thread stays closed and the
 * parameter is left alone (opening another thread rewrites it away first).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import type { UnifiedPost } from "@/types/post";
import { postMedia, type SubjectMedia } from "@/lib/posts/subjectMedia";
import { isOwnOverlayEntry, overlayCloseStep, overlayEntryState } from "@/lib/navigationContract";

/**
 * `media` is what the overlay shows beside the thread — the SAME value the
 * tapped card drew (src/lib/posts/subjectMedia.ts): a video plays here when
 * the card played one. Owner, staging 2026-10-12: "Video running but comment
 * box still image" — the ad subject used to carry only its picture.
 */
export type CommentsSubject =
  | { kind: "post"; post: UnifiedPost; media: SubjectMedia; focusCommentId?: string | null }
  | { kind: "ad"; creativeId: string; media: SubjectMedia };

interface CommentsOverlayContextValue {
  /** What the overlay is showing, or null when it is closed. */
  subject: CommentsSubject | null;
  isOpen: boolean;
  /** `focus` (S4-b): open on that comment — a notification's — loaded and marked. */
  openPostComments: (
    post: UnifiedPost,
    onCommentCountChange?: (postId: string, delta: number) => void,
    focus?: { commentId: string | null },
  ) => void;
  openAdComments: (creativeId: string, media: SubjectMedia, onCommentsChanged?: () => void) => void;
  closeComments: () => void;
  /** Forwards to whatever `onCommentCountChange` the opener passed in — the same callback Feed/WallPosts/PostDetail already wire into PostCard. */
  notifyCommentCountChange: (delta: number) => void;
  /** Forwards to whatever `onCommentsChanged` openAdComments was given — AdEngagementBar's own count re-fetch. */
  notifyAdCommentsChanged: () => void;
  /**
   * The `?comments=` value of a link that arrived already carrying it and that
   * no card has opened yet — read only through usePostCommentsDeepLink /
   * useAdCommentsDeepLink below.
   */
  pendingDeepLink: string | null;
}

const CommentsOverlayContext = createContext<CommentsOverlayContextValue | null>(null);

const COMMENTS_PARAM = "comments";
const AD_PREFIX = "ad:";
/** The `overlay` name in the history state rule 1 of navigationContract.ts writes. */
const OVERLAY = "comments";

const paramFor = (s: CommentsSubject): string => (s.kind === "post" ? s.post.id : `${AD_PREFIX}${s.creativeId}`);

export const CommentsOverlayProvider = ({ children }: { children: ReactNode }) => {
  const [subject, setSubject] = useState<CommentsSubject | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const postCountChangeRef = useRef<((postId: string, delta: number) => void) | undefined>(undefined);
  const adChangeRef = useRef<(() => void) | undefined>(undefined);
  /**
   * The SYNCHRONOUS truth of "a thread is open". State lags a render behind,
   * and two close paths can fire in the same tick (Android Back's synthetic
   * Escape and the sheet's own onOpenChange; Vaul's release and its animation
   * end) — the second must find the thread already closed, or it would step
   * back a second time and take the member off the page.
   */
  const openRef = useRef(false);
  /**
   * The last thread opened, kept after close ONLY so a real traversal back
   * into its own entry (browser Forward) can show it again without a fetch.
   * `subject` itself is cleared on close (L1).
   */
  const lastRef = useRef<{ param: string; subject: CommentsSubject } | null>(null);

  const param = searchParams.get(COMMENTS_PARAM);

  const show = useCallback(
    (next: CommentsSubject) => {
      const id = paramFor(next);
      openRef.current = true;
      lastRef.current = { param: id, subject: next };
      setSubject(next);
      setIsOpen(true);
      setPendingDeepLink(null);
      // Already on this thread's entry — a deep link or cold start a card has
      // just claimed: push nothing (rule 3).
      if (param === id) return;
      if (param !== null) {
        // A `?comments=` nobody opened (its card is not on this page). Rewrite
        // it away first, so stepping back over the new thread lands on the
        // page — not on a stale link.
        const clean = new URLSearchParams(searchParams);
        clean.delete(COMMENTS_PARAM);
        setSearchParams(clean, { replace: true });
      }
      const withThread = new URLSearchParams(searchParams);
      withThread.set(COMMENTS_PARAM, id);
      setSearchParams(withThread, { state: overlayEntryState(OVERLAY, id) }); // rule 1: ONE marked entry
    },
    [param, searchParams, setSearchParams],
  );

  const openPostComments = useCallback(
    (
      nextPost: UnifiedPost,
      onCommentCountChange?: (postId: string, delta: number) => void,
      focus?: { commentId: string | null },
    ) => {
      postCountChangeRef.current = onCommentCountChange;
      show({ kind: "post", post: nextPost, media: postMedia(nextPost), focusCommentId: focus?.commentId ?? null });
    },
    [show],
  );

  const openAdComments = useCallback(
    (creativeId: string, media: SubjectMedia, onCommentsChanged?: () => void) => {
      adChangeRef.current = onCommentsChanged;
      show({ kind: "ad", creativeId, media });
    },
    [show],
  );

  /** Closed state, no history touched — for when the URL has already moved on its own. */
  const hide = useCallback(() => {
    openRef.current = false;
    setIsOpen(false);
    setSubject(null);
  }, []);

  const closeComments = useCallback(() => {
    if (!openRef.current) return;
    hide();
    setPendingDeepLink(null);
    // Rule 2: step back over our own entry, or replace — closing never pushes.
    const step = overlayCloseStep(location, OVERLAY, param);
    if (step === "back") {
      navigate(-1);
    } else if (step === "replace") {
      const next = new URLSearchParams(searchParams);
      next.delete(COMMENTS_PARAM);
      setSearchParams(next, { replace: true });
    }
  }, [hide, location, param, navigate, searchParams, setSearchParams]);

  const notifyCommentCountChange = useCallback((delta: number) => {
    if (subject?.kind === "post") postCountChangeRef.current?.(subject.post.id, delta);
  }, [subject]);

  const notifyAdCommentsChanged = useCallback(() => {
    if (subject?.kind === "ad") adChangeRef.current?.();
  }, [subject]);

  // THE WATCHER — runs once per history entry (`location.key`), never because a
  // parameter is merely still there. That distinction is the loop's fix: the
  // old watcher keyed on `[param]` re-opened the thread every time Back landed
  // on `?comments=<same id>`.
  useEffect(() => {
    if (!param) {
      // Back past the thread, or a link inside it opened another page.
      if (openRef.current) hide();
      setPendingDeepLink(null);
      return;
    }
    if (openRef.current) {
      if (lastRef.current?.param === param) return; // the entry show() just pushed
      hide();
    }
    const last = lastRef.current;
    if (navigationType === "POP" && isOwnOverlayEntry(location, OVERLAY, param) && last?.param === param) {
      // Rule 4: a real traversal INTO our own entry — browser Forward, or Back
      // from a page opened on top of the thread. Closing it again steps back.
      openRef.current = true;
      setSubject(last.subject);
      setIsOpen(true);
      setPendingDeepLink(null);
      return;
    }
    // Arrived on an entry that already names a thread nobody here opened:
    // a shared link, a cold start, a reload. The card holding it claims it.
    setPendingDeepLink(param);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const value = useMemo<CommentsOverlayContextValue>(
    () => ({ subject, isOpen, openPostComments, openAdComments, closeComments, notifyCommentCountChange, notifyAdCommentsChanged, pendingDeepLink }),
    [subject, isOpen, openPostComments, openAdComments, closeComments, notifyCommentCountChange, notifyAdCommentsChanged, pendingDeepLink],
  );

  return <CommentsOverlayContext.Provider value={value}>{children}</CommentsOverlayContext.Provider>;
};

export const useCommentsOverlay = () => {
  const ctx = useContext(CommentsOverlayContext);
  if (!ctx) throw new Error("useCommentsOverlay must be used within CommentsOverlayProvider");
  return ctx;
};

/**
 * Rule 3 for a post: when this page was reached by a link that already carries
 * `?comments=<this post's id>`, open its thread — once — with the post the card
 * already has in hand. Called by PostCard, so it works on every surface a card
 * is drawn (feed, walls, the post page a notification opens).
 */
export function usePostCommentsDeepLink(
  post: UnifiedPost,
  onCommentCountChange?: (postId: string, delta: number) => void,
) {
  const { pendingDeepLink, openPostComments } = useCommentsOverlay();
  const claim = pendingDeepLink !== null && pendingDeepLink === post.id;
  useEffect(() => {
    if (claim) openPostComments(post, onCommentCountChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim]);
}

/** Rule 3 for a sponsored ad's thread (`?comments=ad:<creativeId>`). `enabled: false` where the thread is the page itself. */
export function useAdCommentsDeepLink(
  creativeId: string,
  media: SubjectMedia,
  onCommentsChanged?: () => void,
  enabled = true,
) {
  const { pendingDeepLink, openAdComments } = useCommentsOverlay();
  const claim = enabled && pendingDeepLink === `${AD_PREFIX}${creativeId}`;
  useEffect(() => {
    if (claim) openAdComments(creativeId, media, onCommentsChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim]);
}
