/**
 * The comment thread under a post — the DATA-TO-LAYOUT adapter.
 *
 * The drawing half is src/components/comments/CommentThread.tsx, which this
 * shares with the sponsored story card (src/components/ads/AdComments.tsx).
 * The actual data plumbing — post_comments, post_comment_reactions, pinning,
 * the report queue, useAddComment's optimistic insert with the AI moderation
 * call behind it — now lives in src/hooks/feed/usePostComments.ts, extracted
 * from this file so the SAME fetch/mutate logic can back both the surface
 * this component draws (the Comments overlay) without a second, hand-copied
 * data layer. See BrandBadgeEverywhere.test.tsx and queryCeilings.test.ts,
 * whose scan targets moved to that hook for the same reason — the list
 * follows the code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TWO-BAND LAYOUT NOW, NOT A HEIGHT-ANIMATED INLINE STRIP
 *
 * Until 2026-09, this rendered inline inside PostCard, expanding the card's
 * own height when a member tapped the comment icon — which pushed every post
 * below it down the feed and gave comments no dedicated surface of their own
 * on either web or the app. PostCard now opens comments in a dedicated
 * overlay instead (src/components/comments/CommentsOverlay.tsx: a modal on
 * web, a bottom sheet on the app), and THIS component is the panel it shows —
 * a scrollable thread with the composer pinned below it, never the other way
 * around. `hideComposer` on CommentThread is what makes the split possible:
 * the thread draws the list only, and CommentComposer (the exact same box,
 * extracted so there is one implementation of it) is rendered here, outside
 * the scrolling region.
 *
 * Nothing about who may load, post, edit, delete, like, pin or report a
 * comment changed in this move — that is all still usePostComments and
 * CommentThread, untouched by the layout around them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE BOX FOR EVERY THREAD (bug 3, Owner, 15 Oct 2026)
 *
 * "One comments box, the same for posts, ads, video posts and picture posts:
 * same features, same wording." The post box had a search row, the emoji row
 * and "Add a comment for <owner>"; the ad box (AdComments) drew CommentThread
 * with its own composer — no search, no emoji row, "Write a comment...", a
 * different empty line. Two configurations of one thread, and they drifted.
 *
 * So the box is CommentsBox, below, and it is the only one: PostCommentsSection
 * and AdComments are now just where its data comes from. What a source may
 * leave out is only what its TABLES do not have — an ad has no comment
 * reactions, nobody to pin, no per-comment report queue — and that is said by
 * leaving the callback out, never by a second layout. Search, sorting, the
 * emoji row, blocking an author, the placeholder and the empty line are the
 * box's, so they are the same everywhere it opens.
 */
import { useMemo, useState } from "react";
import CommentThread, { commentPlaceholderFor, type ThreadComment } from "@/components/comments/CommentThread";
import CommentComposer from "@/components/comments/CommentComposer";
import CommentSearchBar from "@/components/comments/CommentSearchBar";
import { countComments, filterComments } from "@/lib/commentSearch";
import { usePostComments } from "@/hooks/feed/usePostComments";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import BlockUserDialog, { type BlockTarget } from "@/components/moderation/BlockUserDialog";

/** The one empty line, for every thread the box shows. */
export const COMMENTS_EMPTY_LABEL = "No comments yet. Be the first to comment.";

/** Where a thread's rows come from and where its writes go — the only thing that differs between a post and an ad. */
export interface CommentsBoxSource {
  comments: ThreadComment[];
  loading: boolean;
  currentUserId: string | null;
  viewer?: { full_name?: string | null; avatar_url?: string | null } | null;
  isAdmin: boolean;
  canPin?: boolean;
  submitting: boolean;
  editSubmitting: boolean;
  /** The table's own length CHECK — the box must not accept what the database will refuse. */
  maxLength: number;
  maxReplyDepth?: number;
  addComment: (content: string, parentId: string | null) => void | Promise<boolean | void>;
  editComment: (id: string, content: string) => void | Promise<boolean | void>;
  deleteComment: (id: string, parentId: string | null) => void;
  /** Absent = the thread's tables have no comment reactions. */
  toggleLike?: (id: string) => void;
  setReaction?: (id: string, reactionType: string) => void;
  /** Absent = nobody owns the subject, so nobody pins. */
  togglePin?: (id: string) => void;
  /** Absent = no per-comment report queue for this table. */
  reportComment?: (id: string, reason: string) => void;
}

interface CommentsBoxProps {
  source: CommentsBoxSource;
  /**
   * Whose thing this is, for the composer's placeholder ("Add a comment for …")
   * — a post owner's name-URL handle, an ad's advertiser. Absent falls back to
   * the one shared COMMENT_PLACEHOLDER; see commentPlaceholderFor.
   */
  ownerHandle?: string | null;
  /** The subject's first line, shown at rest in the search row for orientation. */
  subjectLabel?: string | null;
}

export const CommentsBox = ({ source, ownerHandle, subjectLabel }: CommentsBoxProps) => {
  const { comments, loading, currentUserId, viewer, isAdmin, canPin, submitting, editSubmitting, maxLength } = source;

  // Blocked members' comments (and the replies under them) are removed from the
  // thread the moment the block exists — App Store guideline 1.2.
  const { blockedIds } = useBlockedUsers();
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const unblockedComments = useMemo(() => {
    if (blockedIds.size === 0) return comments;
    const strip = (list: typeof comments): typeof comments =>
      list
        .filter((c) => !blockedIds.has(c.user_id))
        .map((c) => ({ ...c, replies: strip(c.replies) }));
    return strip(comments);
  }, [comments, blockedIds]);

  /**
   * SEARCH IS A VIEW OVER THE LOADED THREAD — it re-reads nothing.
   *
   * The query lives here rather than inside CommentSearchBar because THIS is
   * what hands the array to CommentThread; a box holding its own copy would be
   * a second source for one string. The filter itself is a pure function in
   * src/lib/commentSearch.ts so its rules (a matching reply keeps its parent as
   * context; a matching parent keeps all of its replies) are testable without
   * mounting a drawer — see src/lib/__tests__/commentSearch.test.ts.
   */
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchQuery.trim().length > 0;
  const visibleComments = useMemo(
    () => filterComments(unblockedComments, searchQuery),
    [unblockedComments, searchQuery],
  );

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="comments-box">
      {/* BAND ONE — search. shrink-0, so it never eats the thread's height. */}
      <div className="shrink-0 border-b border-border/60">
        <CommentSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          expanded={searchOpen}
          onExpandedChange={setSearchOpen}
          subjectLabel={subjectLabel}
          resultCount={countComments(visibleComments)}
        />
      </div>
      {/* THE ONLY SCROLLING BAND. min-h-0 is load-bearing on a flex child —
          without it the thread refuses to shrink below its content and the
          composer below gets pushed off the bottom instead of staying pinned,
          exactly the failure MobileProfileSheet's three-band layout note
          documents for this same flex pattern. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <CommentThread
          comments={visibleComments}
          loading={loading}
          currentUserId={currentUserId}
          viewer={viewer}
          isAdmin={isAdmin}
          canPin={canPin}
          submitting={submitting}
          editSubmitting={editSubmitting}
          maxLength={maxLength}
          hideComposer
          emptyLabel={searching ? undefined : COMMENTS_EMPTY_LABEL}
          features={{
            reactions: !!source.setReaction,
            pinning: !!source.togglePin,
            reporting: !!source.reportComment,
            sorting: true,
          }}
          maxReplyDepth={source.maxReplyDepth}
          onAdd={(content, parentId) => source.addComment(content, parentId)}
          onEdit={source.editComment}
          onDelete={source.deleteComment}
          onToggleLike={source.toggleLike}
          onReact={source.setReaction}
          onTogglePin={source.togglePin}
          onReport={source.reportComment}
          onBlockUser={(id, name) => setBlockTarget({ id, name })}
        />
      </div>

      {/* THE PINNED COMPOSER. `env(safe-area-inset-bottom)` matters only on the
          app's bottom sheet — on the web modal it evaluates to 0 and costs
          nothing. */}
      {currentUserId && (
        <div
          className="shrink-0 border-t border-border px-3 py-2.5 bg-background"
          style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
        >
          <CommentComposer
            currentUserId={currentUserId}
            viewer={viewer}
            submitting={submitting}
            maxLength={maxLength}
            quickReactions
            placeholder={commentPlaceholderFor(ownerHandle)}
            onSubmit={(content) => source.addComment(content, null)}
          />
        </div>
      )}
      <BlockUserDialog target={blockTarget} onClose={() => setBlockTarget(null)} />
    </div>
  );
};

interface Props {
  postId: string;
  postOwnerId: string;
  /**
   * The post owner's name-URL handle, for the composer's placeholder
   * ("Add a comment for …"). Absent — the owner has no handle — falls back to
   * the one shared COMMENT_PLACEHOLDER; see commentPlaceholderFor.
   */
  postOwnerHandle?: string | null;
  /** The post's first line, shown at rest in the search row for orientation. */
  subjectLabel?: string | null;
  onCommentCountChange?: (delta: number) => void;
}

const PostCommentsSection = ({
  postId,
  postOwnerId,
  postOwnerHandle,
  subjectLabel,
  onCommentCountChange,
}: Props) => {
  const thread = usePostComments(postId, postOwnerId, onCommentCountChange, true);
  const source: CommentsBoxSource = {
    comments: thread.comments,
    loading: thread.loading,
    currentUserId: thread.currentUserId,
    viewer: thread.viewer,
    isAdmin: thread.isAdmin,
    canPin: thread.canPin,
    submitting: thread.submitting,
    editSubmitting: thread.editSubmitting,
    maxLength: 2200,
    addComment: thread.addComment,
    editComment: thread.editComment,
    deleteComment: thread.deleteComment,
    toggleLike: thread.toggleLike,
    setReaction: thread.setReaction,
    togglePin: thread.togglePin,
    reportComment: thread.reportComment,
  };
  return <CommentsBox source={source} ownerHandle={postOwnerHandle} subjectLabel={subjectLabel} />;
};

export default PostCommentsSection;
