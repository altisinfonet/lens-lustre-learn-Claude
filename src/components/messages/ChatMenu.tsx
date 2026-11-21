/**
 * Messages · the "⋯" menu in a chat header: Search in this chat, Mute / Unmute notifications, Block / Unblock this member.
 * Blocking is the site's ONE block (useBlockedUsers, App Store 1.2): the same list the profile Block button uses, so a block
 * made here also hides the member's posts, and the send door already refuses messages either way (MSG-030).
 */
import { MoreVertical, Search, BellOff, Bell, Ban, UserCheck, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/I18nContext";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import { useConversationActions } from "@/hooks/messages/useMessages";

export default function ChatMenu({ conversationId, otherId, muted, onSearch }: {
  conversationId: string; otherId: string | null; muted: boolean; onSearch: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { mute, clear } = useConversationActions();
  const { isBlocked, block, unblock } = useBlockedUsers();
  const blocked = isBlocked(otherId);
  const item = "flex cursor-pointer items-center gap-2 text-sm";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid="chat-menu" aria-label={t("messages.menu", "More options")} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
          <MoreVertical className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[210px]">
        <DropdownMenuItem className={item} onSelect={onSearch} data-testid="chat-menu-search"><Search className="h-4 w-4" />{t("messages.searchChat", "Search in this chat")}</DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => mute.mutate({ id: conversationId, muted: !muted })} data-testid="chat-menu-mute">
          {muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}{muted ? t("messages.unmute", "Unmute notifications") : t("messages.mute", "Mute notifications")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`${item} text-destructive focus:text-destructive`}
          data-testid="chat-menu-delete"
          onSelect={() => {
            if (window.confirm(t("messages.deleteChatConfirm", "This chat will be deleted for you only. The other person keeps it. Delete?"))) {
              clear.mutate(conversationId, { onSuccess: () => navigate("/messages", { replace: true }) });
            }
          }}
        ><Trash2 className="h-4 w-4" />{t("messages.deleteChat", "Delete chat for me")}</DropdownMenuItem>
        {otherId && (
          <DropdownMenuItem
            className={`${item} ${blocked ? "" : "text-destructive focus:text-destructive"}`}
            data-testid="chat-menu-block"
            onSelect={() => {
              if (blocked) unblock(otherId);
              else if (window.confirm(t("messages.blockConfirm", "Block this member? You will not see each other's posts and neither of you can send messages."))) block(otherId);
            }}
          >
            {blocked ? <UserCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}{blocked ? t("messages.unblock", "Unblock this member") : t("messages.block", "Block this member")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
