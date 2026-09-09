/**
 * THE COMMENTS SURFACE — a modal on web, a bottom sheet on the app. One
 * mount, near the app root (see Layout.tsx), driven by CommentsOverlayContext.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY TWO SHAPES FOR ONE COMPONENT
 *
 * Same breakpoint the rest of the app already keys mobile-vs-desktop layout
 * decisions off (`useIsMobile`, 768px) — not a new one invented for this.
 * Web gets Radix `Dialog` (ESC, focus trap/return, backdrop-click, scroll
 * lock — all native to the primitive, nothing hand-built here) with the post's
 * photo beside the thread, because the post is what "preserve post context"
 * means when the panel replaces the screen instead of sliding up over it. The
 * app gets `vaul`'s `Drawer` (swipe-to-dismiss, rounded top, drag handle,
 * scroll lock — likewise native), sized like MobileProfileSheet's sheet, with
 * no photo of its own: on a phone the post is still visible above the sheet,
 * exactly like Instagram's.
 *
 * Neither shape draws a comment row, fetches a comment, or posts one — that
 * is PostCommentsSection (thread + pinned composer) and, under it,
 * usePostComments. This file is chrome: the backdrop, the close affordance,
 * and which half of the screen the post's photo gets, if any.
 */
import { useCommentsOverlay } from "@/contexts/CommentsOverlayContext";
import { useIsMobile } from "@/hooks/core/use-mobile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import PostCommentsSection from "@/components/PostCommentsSection";

const CommentsOverlay = () => {
  const { post, isOpen, closeComments, notifyCommentCountChange } = useCommentsOverlay();
  const isMobile = useIsMobile();

  // Nothing has ever been opened yet — render nothing rather than mount a
  // Dialog/Drawer with no content to show while a post loads. There is no
  // "loading the post" state here at all: openComments is only ever called
  // with a post already in hand (see PostCard), so post is either the exact
  // thing that was tapped or nothing.
  if (!post) return null;

  const imageUrls = post.image_urls?.length ? post.image_urls : post.image_url ? [post.image_url] : [];
  const coverImage = imageUrls[0];

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => { if (!open) closeComments(); }}
      >
        {/* Same 85vh ceiling MobileProfileSheet uses, for the same reason:
            it must fit the shortest phone this app has ever been measured
            on, not merely the ones on hand when this was written. */}
        <DrawerContent
          className="h-[85vh] max-h-[85vh] flex flex-col motion-reduce:!animate-none motion-reduce:!duration-0"
          aria-describedby={undefined}
        >
          <DrawerTitle className="sr-only">Comments</DrawerTitle>
          <div className="flex-1 min-h-0 flex flex-col">
            <PostCommentsSection
              postId={post.id}
              postOwnerId={post.user_id}
              onCommentCountChange={notifyCommentCountChange}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) closeComments(); }}
    >
      <DialogContent
        className="max-w-3xl w-[calc(100vw-2rem)] h-[85vh] max-h-[720px] p-0 gap-0 overflow-hidden grid grid-cols-1 md:grid-cols-[1.1fr_1fr] motion-reduce:!animate-none motion-reduce:!duration-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Comments</DialogTitle>

        {/* Post context — the photograph the comments belong to, so the panel
            never reads as a comment list floating with no idea what it is
            attached to. Hidden below md: on a narrow viewport the modal is
            comments-only, matching the sheet, and there isn't room for both. */}
        {coverImage && (
          <div className="hidden md:flex items-center justify-center bg-black">
            <img
              src={coverImage}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )}

        <div className="flex flex-col min-h-0 h-full">
          <PostCommentsSection
            postId={post.id}
            postOwnerId={post.user_id}
            onCommentCountChange={notifyCommentCountChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CommentsOverlay;
