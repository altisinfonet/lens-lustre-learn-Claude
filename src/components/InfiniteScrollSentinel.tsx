import { Loader2 } from "lucide-react";
import { useInfiniteScroll } from "@/hooks/core/useInfiniteScroll";
import { cn } from "@/lib/utils";

const headingFont = { fontFamily: "var(--font-heading)" };

export interface InfiniteScrollSentinelProps {
  /** Fetch the next page. Wired to the IntersectionObserver. */
  onLoadMore: () => void;
  /** Whether more pages exist. When false, shows the "end" marker (if `showEndMarker`). */
  hasNextPage: boolean;
  /** Whether a fetch is currently in flight. Shows the loader and blocks duplicate triggers. */
  isFetching: boolean;
  /** Pre-fetch margin. Defaults to `200px`. */
  rootMargin?: string;
  /** Disable observation (e.g., during initial load). */
  enabled?: boolean;
  /** Show "You've reached the end" when `!hasNextPage`. Defaults to `true`. */
  showEndMarker?: boolean;
  /** Custom end-marker label. */
  endLabel?: string;
  /** Custom loading label. */
  loadingLabel?: string;
  /**
   * Hide the built-in spinner/label while loading. The sentinel still observes
   * and triggers `onLoadMore`, but renders no loading UI. Useful when the parent
   * shows its own richer placeholder (e.g., a skeleton card) above the sentinel.
   */
  hideLoader?: boolean;
  /** Extra class names for the wrapping div. */
  className?: string;
}

/**
 * Drop-in sentinel that auto-loads the next page when it scrolls into view.
 *
 * Single source of truth for infinite-scroll UI across the app. Pages should
 * render this at the bottom of their list instead of bespoke buttons or observers.
 *
 *   <InfiniteScrollSentinel
 *     onLoadMore={fetchNextPage}
 *     hasNextPage={hasNextPage}
 *     isFetching={isFetchingNextPage}
 *   />
 */
export default function InfiniteScrollSentinel({
  onLoadMore,
  hasNextPage,
  isFetching,
  rootMargin = "200px",
  enabled = true,
  showEndMarker = true,
  endLabel = "You've reached the end",
  loadingLabel = "Loading more...",
  hideLoader = false,
  className,
}: InfiniteScrollSentinelProps) {
  const ref = useInfiniteScroll<HTMLDivElement>({
    onLoadMore,
    hasNextPage,
    isFetching,
    rootMargin,
    enabled,
  });

  return (
    <div ref={ref} className={cn("py-6 text-center", className)}>
      {isFetching && hasNextPage && !hideLoader && (
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>
            {loadingLabel}
          </span>
        </div>
      )}
      {!hasNextPage && showEndMarker && (
        <span
          className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground/50"
          style={headingFont}
        >
          {endLabel}
        </span>
      )}
    </div>
  );
}
