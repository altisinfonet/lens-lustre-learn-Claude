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
    {stats.isTopPost && (
      <span className="inline-flex items-center gap-0.5 text-amber-500">
        <Trophy className="h-3 w-3" />
        <span className="text-xs font-medium">Top</span>
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
