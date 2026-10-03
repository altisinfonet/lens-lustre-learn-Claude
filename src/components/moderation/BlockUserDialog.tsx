import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";

export interface BlockTarget {
  id: string;
  name: string | null;
}

/**
 * The confirmation shown before a member is blocked (App Store guideline 1.2).
 * Confirming blocks immediately: the member's posts and comments disappear from
 * the viewer's feed at once, and the moderation team is notified.
 */
const BlockUserDialog = ({ target, onClose }: { target: BlockTarget | null; onClose: () => void }) => {
  const { block } = useBlockedUsers();
  const label = target?.name?.trim() || "this member";

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Block {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their posts and comments will disappear from your feed straight away, and they won’t
            appear in your comment threads. Our moderators are told about every block so they can
            review the account. You can unblock them any time in Settings → Blocked members.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (target) block(target.id);
              onClose();
            }}
          >
            Block
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default BlockUserDialog;
