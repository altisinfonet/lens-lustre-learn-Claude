import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useBadgeDefinitions } from "@/hooks/profile/useBadgeDefinitions";

interface Props {
  badges: string[];
  size?: "compact" | "full";
}

const BADGE_DESCRIPTIONS: Record<string, string> = {
  verified: "Verified Profile — Authenticated identity",
  top_rated: "Top Rated — Recognized for exceptional quality",
  most_popular: "Most Popular — Loved by the community",
  most_trusted: "Most Trusted — A reliable community member",
  rising_star: "Rising Star — Rapidly gaining recognition",
};

const getBadgeDescription = (key: string, label: string, icon: string) => {
  if (BADGE_DESCRIPTIONS[key]) return BADGE_DESCRIPTIONS[key];
  return `${icon} ${label} — Awarded by 50mm Retina`;
};

const UserBadgeInline = ({ badges, size = "compact" }: Props) => {
  const defs = useBadgeDefinitions();

  if (!badges || badges.length === 0) return null;

  const isVerified = badges.includes("verified");
  const otherBadges = badges.filter((b) => b !== "verified");

  const labelSize = size === "compact" ? "text-[7px] px-1 py-px" : "text-[8px] px-1.5 py-0.5";
  const tickSize = size === "compact" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {isVerified && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0 cursor-default">
              <VerifiedBadge className={tickSize} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs font-medium px-3 py-2 max-w-[220px]">
            ✓ Verified Profile — Authenticated identity
          </TooltipContent>
        </Tooltip>
      )}
      {otherBadges.map((b) => {
        const cfg = defs.get(b);
        if (!cfg) return null;
        const description = getBadgeDescription(b, cfg.label, cfg.icon);
        return (
          <Tooltip key={b}>
            <TooltipTrigger asChild>
              <span
                className={`inline-flex h-auto items-center gap-0.5 ${labelSize} tracking-[0.06em] uppercase font-semibold rounded-sm border shrink-0 leading-none cursor-default ${cfg.badge_class}`}
              >
                <span className="text-[8px]">{cfg.icon}</span>
                {cfg.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs font-medium px-3 py-2 max-w-[240px]">
              {description}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
};

export default UserBadgeInline;
