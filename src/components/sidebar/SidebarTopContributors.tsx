import { useTopContributors } from "@/hooks/useTopContributors";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";

const SidebarTopContributors = () => {
  const { data: contributors, isLoading } = useTopContributors();

  if (isLoading) {
    return (
      <div className="p-4 rounded-lg border border-border space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium" style={{ fontFamily: "var(--font-heading)" }}>Top Contributors</span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-full shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2 w-12" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!contributors || contributors.length === 0) return null;

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="p-4 rounded-lg border border-border space-y-3">
      <div className="flex items-center gap-2">
        <Trophy className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium" style={{ fontFamily: "var(--font-heading)" }}>Top Contributors</span>
      </div>

      {contributors.slice(0, 3).map((c, i) => (
        <Link
          key={c.id}
          to={`/profile/${c.id}`}
          className="flex items-center gap-2.5 group"
        >
          <span className="text-xs shrink-0">{medals[i]}</span>
          <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
            {c.avatar_url ? (
              <img referrerPolicy="no-referrer" src={c.avatar_url} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[9px] font-medium text-muted-foreground uppercase">
                {c.full_name?.[0] || "?"}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <UserIdentityBlock
              userId={c.id}
              name={c.full_name || "Photographer"}
              nameClassName="text-xs truncate group-hover:text-primary transition-colors [font-family:var(--font-body)]"
            />
            {/* Same treatment as the Home page card — the Contributor Score sits
                under the name, not the post count that used to be to the right
                of it. This block renders for SIGNED-OUT visitors only (see
                FeedRightSidebar), so it must not drift from Index.tsx. */}
            <div className="text-[9px] text-muted-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
              ✦ {c.contributor_score.toLocaleString()}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default SidebarTopContributors;
