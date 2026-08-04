import { useMemo } from "react";
import { useRoleDefinitions } from "@/hooks/profile/useRoleDefinitions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { solidPillClass, BADGE_ICON_SIZE } from "@/lib/badgePalette";

interface Props {
  roles: string[];
  size?: "compact" | "full";
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "🛡 Administrator — Platform management & oversight",
  judge: "⚖ Judge — Official competition jury member",
  content_editor: "✎ Editor — Content contributor & curator",
  registered_photographer: "📷 Photographer — Verified photography professional",
  student: "🎓 Student — Photography learner & enthusiast",
  user: "👤 User — Community member",
};

const getRoleDescription = (key: string, label: string, icon: string) => {
  if (ROLE_DESCRIPTIONS[key]) return ROLE_DESCRIPTIONS[key];
  return `${icon} ${label} — Platform role`;
};

const UserRoleInline = ({ roles, size = "compact" }: Props) => {
  const defs = useRoleDefinitions();

  const visibleRoles = useMemo(() => {
    if (!roles || roles.length === 0) return [];
    return roles.filter((r) => defs.get(r)?.show_inline);
  }, [roles, defs]);

  if (visibleRoles.length === 0) return null;

  // Same shared pill as badges — "Featured Creator" is a ROLE pill, and it was
  // failing contrast for exactly the same reason. See src/lib/badgePalette.ts.

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {visibleRoles.map((r) => {
        const cfg = defs.get(r);
        if (!cfg) return null;
        const description = getRoleDescription(r, cfg.label, cfg.icon);
        return (
          <Tooltip key={r}>
            <TooltipTrigger asChild>
              <span className={solidPillClass(cfg.pill_class, size)}>
                {cfg.icon && <span className={BADGE_ICON_SIZE}>{cfg.icon}</span>}
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

export default UserRoleInline;
