import { Eye } from "lucide-react";
import { formatCount, estimateReadTimeMin } from "@/lib/simulatedEngagement";

interface EngagementFooterProps {
  /** REAL view count for this item. Omit when no real source exists — the
   *  view figure is then simply not rendered (never invented). */
  views?: number | null;
  /** Word count for articles; produces a genuine reading-time estimate. */
  wordCount?: number;
  className?: string;
  /** Render as inline fragment (no wrapper div) for embedding in counts rows */
  inline?: boolean;
}

/**
 * Shows only figures we can actually prove.
 *
 * 2026-07-31: the "reach" number and the Trending / Top-post badges were removed
 * because they came from `getSimulatedStats()` — a hash of the item id, not data.
 * See src/lib/simulatedEngagement.ts for the rule. Do not add a metric here
 * without a real source behind it.
 */
const Stats = ({ views, readTimeMin }: { views?: number | null; readTimeMin?: number }) => (
  <>
    {typeof views === "number" && (
      <span
        className="inline-flex items-center gap-0.5 text-muted-foreground"
        title={`${views} view${views === 1 ? "" : "s"}`}
      >
        <Eye className="h-3 w-3 text-blue-500/70" />
        <span className="text-xs font-medium">{formatCount(views)}</span>
      </span>
    )}
    {readTimeMin && (
      <span className="text-[9px] text-muted-foreground">{readTimeMin} min read</span>
    )}
  </>
);

const EngagementFooter = ({ views, wordCount, className = "", inline = false }: EngagementFooterProps) => {
  const readTimeMin = estimateReadTimeMin(wordCount);

  // Nothing real to show → render nothing at all.
  if (typeof views !== "number" && !readTimeMin) return null;

  if (inline) return <Stats views={views} readTimeMin={readTimeMin} />;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 ${className}`}>
      <Stats views={views} readTimeMin={readTimeMin} />
    </div>
  );
};

export default EngagementFooter;
import { Eye, TrendingUp, Trophy, BarChart3 } from "lucide-react";
import { getSimulatedStats, type SimulatedStats } from "@/lib/simulatedEngagement";

interface EngagementFooterProps {
  id: string;
  createdAt: string;
  wordCount?: number;
  className?: string;
  /** Render as inline fragment (no wrapper div) for embedding in counts row */
  inline?: boolean;
}

const InlineStats = ({ stats }: { stats: SimulatedStats }) => (
  <>
    <span className="inline-flex items-center gap-0.5 text-muted-foreground">
      <Eye className="h-3 w-3 text-blue-500/70" />
      <span className="text-xs font-medium">{stats.viewsLabel}</span>
    </span>
    <span className="inline-flex items-center gap-0.5 text-muted-foreground">
      <BarChart3 className="h-3 w-3 text-emerald-500/70" />
      <span className="text-xs font-medium">{stats.reachLabel}</span>
    </span>
    {stats.isTrending && (
      <span className="inline-flex items-center gap-0.5 text-orange-500">
        <TrendingUp className="h-3 w-3" />
        <span className="text-xs font-medium">Trending</span>
      </span>
    )}
  </>
);

const EngagementFooter = ({ id, createdAt, wordCount, className = "", inline = false }: EngagementFooterProps) => {
  const stats = getSimulatedStats(id, createdAt, wordCount);

  if (!stats.show) return null;

  // Inline mode: render fragments directly (caller provides the row container)
  if (inline) return <InlineStats stats={stats} />;

  // Standalone mode: compact row with no ribbon background
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 ${className}`}>
      <InlineStats stats={stats} />
      {stats.readTimeMin && (
        <span className="text-[9px] text-muted-foreground">
          {stats.readTimeMin} min read
        </span>
      )}
    </div>
  );
};

export default EngagementFooter;
