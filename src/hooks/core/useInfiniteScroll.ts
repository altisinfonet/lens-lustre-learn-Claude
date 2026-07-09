import { useEffect, useRef } from "react";

/**
 * Shared infinite-scroll primitive.
 *
 * Observes a sentinel element and invokes `onLoadMore` when it enters the viewport.
 * Designed to be the single source of truth for on-scroll pagination across the app
 * (Feed, Competition, Wall, Photos, Discover, etc.).
 *
 * Safety features:
 *  - SSR-safe (guards `window` / `IntersectionObserver`).
 *  - Double-fire protection via `isFetching` flag (won't trigger while a fetch is in flight).
 *  - Respects `hasNextPage` (no-op when there is nothing more to load).
 *  - Cleans up the observer on unmount or when the sentinel ref changes.
 *  - Configurable `rootMargin` for pre-fetching slightly before the user reaches the bottom.
 *
 * @example
 *   const sentinelRef = useInfiniteScroll({
 *     onLoadMore: fetchNextPage,
 *     hasNextPage,
 *     isFetching: isFetchingNextPage,
 *   });
 *   return <>...<div ref={sentinelRef} /></>;
 */
export interface UseInfiniteScrollOptions {
  /** Callback fired when the sentinel becomes visible and a load is allowed. */
  onLoadMore: () => void;
  /** Whether more pages exist. When false, the observer is a no-op. */
  hasNextPage: boolean;
  /** Whether a fetch is currently in flight. Prevents duplicate triggers. */
  isFetching: boolean;
  /**
   * Distance before the sentinel that triggers the fetch.
   * Default `200px` — pre-fetches just before the user reaches the bottom for a smooth feel.
   */
  rootMargin?: string;
  /** Disable the observer entirely (e.g., during initial loading). */
  enabled?: boolean;
}

export function useInfiniteScroll<T extends HTMLElement = HTMLDivElement>({
  onLoadMore,
  hasNextPage,
  isFetching,
  rootMargin = "200px",
  enabled = true,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<T | null>(null);
  // Keep the latest callback in a ref so the observer effect doesn't re-create
  // every render just because the parent passed a new function identity.
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    // SSR / non-browser guard.
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }

    if (!enabled || !hasNextPage) return;

    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        // Double-fire protection: don't trigger while a fetch is already in flight.
        if (isFetching) return;
        onLoadMoreRef.current();
      },
      { rootMargin, threshold: 0 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, hasNextPage, isFetching, rootMargin]);

  return sentinelRef;
}
