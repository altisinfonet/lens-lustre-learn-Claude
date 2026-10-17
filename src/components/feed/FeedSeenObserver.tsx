import { useRef, type ReactNode } from "react";
import { usePostSeenObserver } from "@/hooks/feed/usePostSeenObserver";

/**
 * Stage L2 · wraps one feed card so its visibility reaches the seen-tracker.
 * A plain block element: it adds no spacing and changes no layout. It sits
 * OUTSIDE FeedCardWindow, so it stays mounted (and observed) while the card's
 * contents are windowed out.
 */
export default function FeedSeenObserver({
  postId,
  authorId,
  onVisibility,
  children,
}: {
  postId: string;
  authorId: string;
  onVisibility: (postId: string, authorId: string, visibleEnough: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePostSeenObserver(ref, postId, authorId, onVisibility);
  return (
    <div ref={ref} data-seen-post={postId}>
      {children}
    </div>
  );
}
