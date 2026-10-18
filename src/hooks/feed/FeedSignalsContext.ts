import { createContext, useContext } from "react";

/**
 * S12-F1 · how a card deep inside the feed reaches the ONE feed tracker
 * (useFeedEventTracker in Feed.tsx) without prop-drilling through PostCard.
 *
 * Outside the feed (a profile grid, the comments overlay, an ad zone) there is
 * no provider and the default does nothing: signals are a feed measurement,
 * and a second tracker elsewhere would be a second way of recording them.
 */
export interface FeedSignals {
  /** The % of a video played so far. */
  watch: (postId: string, authorId: string, pct: number) => void;
  /** "Copy link" on a post. */
  shareClick: (postId: string, authorId: string) => void;
}

const NONE: FeedSignals = { watch: () => {}, shareClick: () => {} };

export const FeedSignalsContext = createContext<FeedSignals>(NONE);

export const useFeedSignals = (): FeedSignals => useContext(FeedSignalsContext);
