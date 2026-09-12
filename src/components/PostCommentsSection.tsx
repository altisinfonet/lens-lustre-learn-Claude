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
 */
import CommentThread from "@/components/comments/CommentThread";
import CommentComposer from "@/components/comments/CommentComposer";
import { usePostComments } from "@/hooks/feed/usePostComments";

interface Props {
  postId: string;
  postOwnerId: string;
  onCommentCountChange?: (delta: number) => void;
}

const PostCommentsSection = ({ postId, postOwnerId, onCommentCountChange }: Props) => {
  const {
    comments,
    loading,
    currentUserId,
    viewer,
    isAdmin,
    canPin,
    submitting,
    editSubmitting,
    addComment,
    editComment,
    deleteComment,
    toggleLike,
    setReaction,
    togglePin,
    reportComment,
  } = usePostComments(postId, postOwnerId, onCommentCountChange, true);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* THE ONLY SCROLLING BAND. min-h-0 is load-bearing on a flex child —
          without it the thread refuses to shrink below its content and the
          composer below gets pushed off the bottom instead of staying pinned,
          exactly the failure MobileProfileSheet's three-band layout note
          documents for this same flex pattern. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <CommentThread
          comments={comments}
          loading={loading}
          currentUserId={currentUserId}
          viewer={viewer}
          isAdmin={isAdmin}
          canPin={canPin}
          submitting={submitting}
          editSubmitting={editSubmitting}
          maxLength={2200}
          hideComposer
          emptyLabel="No comments yet. Be the first to comment."
          onAdd={(content, parentId) => addComment(content, parentId)}
          onEdit={editComment}
          onDelete={deleteComment}
          onToggleLike={toggleLike}
          onReact={setReaction}
          onTogglePin={togglePin}
          onReport={reportComment}
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
            maxLength={2200}
            onSubmit={(content) => addComment(content, null)}
          />
        </div>
      )}
    </div>
  );
};

export default PostCommentsSection;
