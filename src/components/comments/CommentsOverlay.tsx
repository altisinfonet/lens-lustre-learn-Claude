/**
 * THE COMMENTS SURFACE — a modal on web, a full-height bottom sheet on the app.
 * One mount, near the app root (see Layout.tsx), driven by CommentsOverlayContext.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SHAPES, ONE THEME SYSTEM
 *
 * Same breakpoint the rest of the app already keys mobile-vs-desktop layout
 * decisions off (`useIsMobile`, 768px) — not a new one invented for this.
 * Web gets Radix `Dialog` (ESC, focus trap/return, backdrop-click, scroll
 * lock — all native to the primitive) with the post's photo beside the thread.
 * The app gets `vaul`'s `Drawer` (swipe-to-dismiss, rounded top, drag handle,
 * scroll lock — likewise native), full-height.
 *
 * Neither shape sets its own colors. `DrawerContent` and `DialogContent`
 * already carry `bg-background`, and every class this file and
 * PostCommentsSection reach for (`bg-popover`, `text-foreground`,
 * `border-border`, …) is a CSS variable that flips with the `.dark` class
 * on <html> — the member's own light/dark toggle in Navbar / MobileProfileSheet
 * (see src/hooks/core/useTheme.tsx), not the device's OS setting. Comments
 * inherits that for free; it must never invent a second, competing theme
 * signal (an earlier pass here read `prefers-color-scheme` directly, which
 * could disagree with the toggle the member actually set — reverted).
 *
 * Neither shape draws a comment row, fetches a comment, or posts one — that
 * is PostCommentsSection (thread + pinned composer) and, under it,
 * usePostComments — or, for a sponsored ad, AdComments and adEngagement.ts.
 * This file is chrome: the backdrop, the close affordance, and which half of
 * the screen the subject's photo gets (web only). Which of the two threads to
 * draw is the ONE thing this file decides per subject.kind; everything else
 * about the shell is identical for a post and an ad, which is the point —
 * "Like Comment share is required like a normal post" (owner, 2026-08-11)
 * means an ad's thread opens exactly the way a post's does, not a second,
 * ad-shaped modal beside this one.
 */
import type { ReactNode } from "react";
import { useCommentsOverlay } from "@/contexts/CommentsOverlayContext";
import { useIsMobile } from "@/hooks/core/use-mobile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import PostCommentsSection from "@/components/PostCommentsSection";
import AdComments from "@/components/ads/AdComments";

const CommentsOverlay = () => {
  const { subject, isOpen, closeComments, notifyCommentCountChange, notifyAdCommentsChanged } = useCommentsOverlay();
  const isMobile = useIsMobile();

  // Nothing has ever been opened yet — render nothing rather than mount a
  // Dialog/Drawer with no content to show while a post loads. There is no
  // "loading the post" state here at all: openPostComments/openAdComments are
  // only ever called with the subject already in hand (see PostCard,
  // AdEngagementBar), so subject is either the exact thing that was tapped or
  // nothing.
  if (!subject) return null;

  let coverImage: string | undefined;
  let thread: ReactNode;
  if (subject.kind === "post") {
    const { post } = subject;
    const imageUrls = post.image_urls?.length ? post.image_urls : post.image_url ? [post.image_url] : [];
    coverImage = imageUrls[0];
    thread = (
      <PostCommentsSection
        postId={post.id}
        postOwnerId={post.user_id}
        onCommentCountChange={notifyCommentCountChange}
      />
    );
  } else {
    coverImage = subject.imageUrl ?? undefined;
    thread = (
      <AdComments
        creativeId={subject.creativeId}
        onCountChange={notifyAdCommentsChanged}
      />
    );
  }

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => { if (!open) closeComments(); }}
      >
        {/* Full-height immersive bottom sheet for app.
            Height spans from top (below status bar) to bottom (above nav bar).
            DrawerContent's own `bg-background` already follows the member's
            light/dark toggle — nothing extra needed here.
            Safe areas handled by Capacitor config (iOS notch, Android edge-to-edge). */}
        <DrawerContent
          className="h-screen flex flex-col motion-reduce:!animate-none motion-reduce:!duration-0"
          aria-describedby={undefined}
        >
          <DrawerTitle className="sr-only">Comments</DrawerTitle>
          <div className="flex-1 min-h-0 flex flex-col">
            {thread}
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

        {/* Subject context — the photograph the comments belong to, so the
            panel never reads as a comment list floating with no idea what it
            is attached to. Hidden below md: on a narrow viewport the modal is
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
          {thread}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CommentsOverlay;
