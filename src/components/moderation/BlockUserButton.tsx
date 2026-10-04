import { useState } from "react";
import { Ban, UserCheck } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import BlockUserDialog from "@/components/moderation/BlockUserDialog";

/** Block / Unblock for a member's profile (App Store guideline 1.2). */
const BlockUserButton = ({ targetUserId, targetName }: { targetUserId: string; targetName: string | null }) => {
  const { user } = useAuth();
  const { isBlocked, unblock, unblocking } = useBlockedUsers();
  const [confirming, setConfirming] = useState(false);

  if (!user || user.id === targetUserId) return null;
  const blocked = isBlocked(targetUserId);

  return (
    <>
      <button
        type="button"
        onClick={() => (blocked ? unblock(targetUserId) : setConfirming(true))}
        disabled={unblocking}
        data-testid="profile-block-button"
        className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all duration-300 disabled:opacity-50"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {blocked ? <UserCheck className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
        {blocked ? "Unblock" : "Block"}
      </button>
      <BlockUserDialog
        target={confirming ? { id: targetUserId, name: targetName } : null}
        onClose={() => setConfirming(false)}
      />
    </>
  );
};

export default BlockUserButton;
