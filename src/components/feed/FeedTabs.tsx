/**
 * S12-F5 · the feed tabs, Instagram-style: For you · Following · Favourites.
 *
 * Gate: "'For you' / 'Following' (time order) / 'Favourites' — Each view
 * correct on web + Android shell".
 *
 * SHOWN ONLY WHILE THE `personal_feed` SWITCH IS ON FOR THIS MEMBER (VID-7:
 * Off / Selected members / All members). Switch off → no tabs, and the feed is
 * exactly today's: members see no change until the rollout reaches them.
 *
 * The chosen tab survives Back (the feed remounts on Back — sibling routes) and
 * a reload of the tab/app session; each tab keeps its own list (useFeedQuery
 * keys the cache and the session by tab).
 */
import { useCallback, useState } from "react";
import { useFeatureAllowed } from "@/hooks/core/useFeatureAllowed";
import type { FeedTab } from "@/hooks/feed/useFeedQuery";

export const FEED_TAB_STORAGE_KEY = "feed.tab";

const TABS: ReadonlyArray<{ tab: FeedTab; label: string }> = [
  { tab: "for_you", label: "For you" },
  { tab: "following", label: "Following" },
  { tab: "favourites", label: "Favourites" },
];

function readStoredTab(): FeedTab {
  try {
    const v = sessionStorage.getItem(FEED_TAB_STORAGE_KEY);
    return v === "following" || v === "favourites" ? v : "for_you";
  } catch {
    return "for_you";
  }
}

/**
 * The tab the feed shows. While the switch is off it is always "for_you",
 * whatever was stored (a member taken off the list mid-session gets today's
 * feed, not an orphaned Following tab).
 */
export function useFeedTab(): { tab: FeedTab; setTab: (t: FeedTab) => void; showTabs: boolean } {
  const showTabs = useFeatureAllowed("personal_feed");
  const [stored, setStored] = useState<FeedTab>(readStoredTab);
  const setTab = useCallback((t: FeedTab) => {
    setStored(t);
    try { sessionStorage.setItem(FEED_TAB_STORAGE_KEY, t); } catch { /* private mode: the tab just isn't remembered */ }
  }, []);
  return { tab: showTabs ? stored : "for_you", setTab, showTabs };
}

export default function FeedTabs({ value, onChange }: { value: FeedTab; onChange: (t: FeedTab) => void }) {
  return (
    <div role="tablist" aria-label="Feed" className="flex items-stretch border-b border-border bg-background" data-testid="feed-tabs">
      {TABS.map(({ tab, label }) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`feed-tab-${tab}`}
            onClick={() => { if (!active) onChange(tab); }}
            className={`flex-1 min-h-[44px] text-[13px] font-semibold transition-colors border-b-2 -mb-px ${
              active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {tab === "favourites" ? <span aria-hidden="true">★ </span> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
