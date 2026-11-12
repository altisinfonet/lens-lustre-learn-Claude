import { BadgeCheck, Users } from "lucide-react";

/**
 * One row for @followers / @all in an @mention list. ONE drawing used by both
 * lists (caption box in WallPosts, comment box in MentionInput) so they match.
 */
export default function GroupMentionRow({ id, display, hint }: { id: string; display: string; hint?: string }) {
  const Icon = id === "all" ? BadgeCheck : Users;
  return (
    <div className="flex min-w-0 items-center gap-2.5" data-testid={`group-mention-${id}`}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="font-semibold text-primary">{display}</div>
        {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}
