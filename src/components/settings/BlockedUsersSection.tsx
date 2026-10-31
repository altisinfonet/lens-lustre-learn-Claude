import { Ban } from "lucide-react";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import { useProfileMap } from "@/hooks/profile/useProfileMap";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

/** Settings → Blocked members: who the viewer has blocked, with Unblock (App Store 1.2). */
const BlockedUsersSection = () => {
  const { blockedRows, unblock, unblocking } = useBlockedUsers();
  const ids = blockedRows.map((r) => r.blocked_id);
  const { profileMap } = useProfileMap(ids);

  return (
    <div className="border border-border p-4 md:p-5" id="blocked-members">
      <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-3 flex items-center gap-1.5" style={headingFont}>
        <Ban className="h-3 w-3" /> Blocked members
      </span>
      {blockedRows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" style={bodyFont}>
          You haven’t blocked anyone. To block a member, open their profile or the menu on one of
          their posts or comments.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {blockedRows.map((r) => {
            const prof: any = (profileMap as any)?.[r.blocked_id] ?? (profileMap as any)?.get?.(r.blocked_id);
            const name = prof?.full_name || "Member";
            return (
              <li key={r.blocked_id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-xs text-foreground truncate" style={bodyFont}>{name}</span>
                <button
                  type="button"
                  onClick={() => unblock(r.blocked_id)}
                  disabled={unblocking}
                  className="text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 border border-border hover:border-primary hover:text-primary transition-all duration-300 disabled:opacity-50"
                  style={headingFont}
                >
                  Unblock
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default BlockedUsersSection;
