/** Small shared pieces of the Admin → Video pages: avatar, role badges, the status pill. */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { memberInitials, type FeatureMode } from "@/lib/admin/featureSwitches";

/**
 * F-AUD-6: every search result and every member row shows the member's photo,
 * or their initials — two people called "Asha" are told apart by face.
 * alt="" because the name is printed beside it.
 */
export function MemberAvatar({ m, size }: { m: { full_name: string | null; username: string | null; avatar_url: string | null }; size: "chip" | "row" }) {
  return (
    <Avatar className={size === "chip" ? "h-6 w-6" : "h-8 w-8"} data-testid="member-avatar-wrap">
      {m.avatar_url ? <AvatarImage src={m.avatar_url} alt="" /> : null}
      <AvatarFallback className={size === "chip" ? "text-[9px]" : "text-xs"}>{memberInitials(m)}</AvatarFallback>
    </Avatar>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: "Admin", content_editor: "Editor", judge: "Judge", moderator: "Moderator", finance: "Finance" };

/** Admin / Editor / Judge … — "user" is everyone, so it is not shown. */
export function RoleBadges({ roles }: { roles: string[] }) {
  const shown = roles.filter((r) => r !== "user" && ROLE_LABEL[r]);
  if (shown.length === 0) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {shown.map((r) => (
        <span key={r} className={`rounded px-1.5 py-px text-[10px] font-medium ${r === "admin" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
          {ROLE_LABEL[r]}
        </span>
      ))}
    </span>
  );
}

/** Off · Selected (N) · All members, coloured so the state reads at a glance. */
export function StatusPill({ mode, members }: { mode: FeatureMode; members: number }) {
  const look = mode === "everyone"
    ? "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30"
    : mode === "selected" ? "bg-amber-500/15 text-amber-600 ring-amber-500/30" : "bg-muted text-muted-foreground ring-border";
  const text = mode === "everyone" ? "On for all members" : mode === "selected" ? `On for ${members} selected` : "Off";
  return (
    <span data-testid="feature-status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${look}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${mode === "off" ? "bg-muted-foreground" : "bg-current"}`} />
      {text}
    </span>
  );
}
