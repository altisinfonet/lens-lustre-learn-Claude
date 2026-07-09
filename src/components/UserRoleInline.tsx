import { useMemo } from "react";
import { useRoleDefinitions } from "@/hooks/profile/useRoleDefinitions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

  const labelSize =
    size === "compact" ? "text-[7px] px-1 py-px" : "text-[8px] px-1.5 py-0.5";

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {visibleRoles.map((r) => {
        const cfg = defs.get(r);
        if (!cfg) return null;
        const description = getRoleDescription(r, cfg.label, cfg.icon);
        return (
          <Tooltip key={r}>
            <TooltipTrigger asChild>
              <span
                className={`inline-flex h-auto items-center gap-0.5 ${labelSize} tracking-[0.06em] uppercase font-semibold rounded-sm border shrink-0 leading-none cursor-default ${cfg.pill_class}`}
              >
                {cfg.icon && <span className="text-[8px]">{cfg.icon}</span>}
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
