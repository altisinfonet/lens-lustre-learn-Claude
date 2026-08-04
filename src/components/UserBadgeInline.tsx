import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useBadgeDefinitions } from "@/hooks/profile/useBadgeDefinitions";
import { solidPillClass, BADGE_ICON_SIZE, BADGE_ROW_SHRINK } from "@/lib/badgePalette";

interface Props {
  badges: string[];
  size?: "compact" | "full";
  /**
   * Render only part of the set.
   *
   * The blue verified tick and the coloured award pills behave differently when
   * space is tight: the tick is a fixed 14px glyph that always fits and belongs
   * immediately after the name (that is what the tick MEANS — this name is the
   * real person), while a pill is a word that needs room. `only` lets a narrow
   * layout keep the tick on the name's line and move the pills below.
   *
   * Default "all" — every existing caller keeps today's single-row behaviour.
   */
  only?: "all" | "verified" | "pills";
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

const UserBadgeInline = ({ badges, size = "compact", only = "all" }: Props) => {
  const defs = useBadgeDefinitions();

  if (!badges || badges.length === 0) return null;

  const isVerified = badges.includes("verified") && only !== "pills";
  const otherBadges = only === "verified" ? [] : badges.filter((b) => b !== "verified");

  // Nothing left to draw for this half — render nothing rather than an empty
  // inline box, which would still take the row's gap.
  if (!isVerified && otherBadges.length === 0) return null;

  // Size + colour now come from ONE place (src/lib/badgePalette.ts) and the
  // stored class string is normalised there, so a badge cannot render
  // unreadable whatever the database holds. Was: 7px text on a 15%-transparent
  // fill, which failed WCAG AA in both modes for all ten colours.
  const tickSize = size === "compact" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <span className={`inline-flex items-center gap-1 align-middle ${BADGE_ROW_SHRINK}`}>
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
              <span className={solidPillClass(cfg.badge_class, size)}>
                <span className={BADGE_ICON_SIZE}>{cfg.icon}</span>
                <span className="truncate">{cfg.label}</span>
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
