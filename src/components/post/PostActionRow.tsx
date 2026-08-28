/**
 * THE action row: react · comment · share, with each count beside its icon.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A COMPONENT NOW
 *
 * It used to be written out inside PostCard, and a second, hand-copied version
 * of it lived in src/components/ads/AdEngagementBar.tsx with a comment on top
 * promising *"If PostCard's row changes, this changes with it — the two are
 * supposed to look like one thing."* Nothing enforced that promise, and the two
 * had already drifted: the deployed bundle shipped two separate "Add a comment"
 * composers, and only one of the two rows could record anything but a `like`.
 *
 * A promise a person has to keep by hand is not a design. This file is the row,
 * once, and both surfaces render it. Geometry lives here and nowhere else:
 * 24px icons in a 48px tall tap target, pushed left, no divider, no text
 * labels, and a count that disappears at zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT STAYS WITH THE CALLER
 *
 * Everything that is about a POST rather than about the row: the
 * ReactionSummaryTooltip and ShareSummaryTooltip that a post's numbers open,
 * the per-reaction breakdown on the right, and what the share menu offers. A
 * post may be reshared to a member's wall; an advertisement may not (that would
 * republish an ad under a member's own name), so the menu is a prop and not a
 * decision this file makes. They arrive as slots, so the ad surface simply
 * passes none and gets a plain number.
 */
import type { ReactNode } from "react";
import { MessageCircle, Send } from "lucide-react";
import ReactionPicker, { type ReactionType } from "@/components/ReactionPicker";
import { formatNumber } from "@/lib/postAnalytics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A count beside an icon. Exported because a caller that wraps its number in a
 * tooltip has to draw the number itself, and it must be the same number.
 */
export const ActionCount = ({
  children,
  interactive = false,
}: {
  children: ReactNode;
  interactive?: boolean;
}) => (
  <span
    className={`pr-2 ${interactive ? "cursor-pointer " : ""}text-sm font-semibold text-foreground`}
  >
    {children}
  </span>
);

export interface PostActionRowProps {
  currentReaction: ReactionType | null;
  onReact: (type: ReactionType) => void;
  onUnreact: () => void;
  /** The picker is dead while nobody is signed in, or while a write is in flight. */
  reactionDisabled?: boolean;

  likeCount: number;
  commentCount: number;
  shareCount: number;

  onCommentClick: () => void;

  /** Accessible names. Icon-only buttons have no other name. */
  commentLabel: string;
  shareLabel: string;

  /** The items inside the share menu — <DropdownMenuItem>s, supplied by the caller. */
  shareMenu: ReactNode;

  /** Replaces the plain like/share number, for a caller whose number opens a panel. */
  likeCountSlot?: ReactNode;
  shareCountSlot?: ReactNode;

  /** Anything pinned to the right of the row (the post's reaction breakdown). */
  trailing?: ReactNode;
}

const PostActionRow = ({
  currentReaction,
  onReact,
  onUnreact,
  reactionDisabled = false,
  likeCount,
  commentCount,
  shareCount,
  onCommentClick,
  commentLabel,
  shareLabel,
  shareMenu,
  likeCountSlot,
  shareCountSlot,
  trailing,
}: PostActionRowProps) => (
  <div className="select-none px-1.5">
    <div className="flex items-center">
      {/* Like — the picker owns the button, the count sits beside it */}
      <div className="flex items-center">
        <ReactionPicker
          currentReaction={currentReaction}
          onReact={onReact}
          onUnreact={onUnreact}
          disabled={reactionDisabled}
        />
        {likeCount > 0 && (likeCountSlot ?? <ActionCount>{formatNumber(likeCount)}</ActionCount>)}
      </div>

      {/* Comment */}
      <button
        onClick={onCommentClick}
        aria-label={commentLabel}
        title={commentLabel}
        className="h-12 px-2.5 flex items-center gap-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation">
        <MessageCircle className="h-6 w-6" strokeWidth={1.75} />
        {commentCount > 0 && (
          <span className="text-sm font-semibold text-foreground">{formatNumber(commentCount)}</span>
        )}
      </button>

      {/* Share */}
      <div className="flex items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={shareLabel}
              title={shareLabel}
              className="h-12 px-2.5 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation">
              <Send className="h-6 w-6" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {shareMenu}
          </DropdownMenuContent>
        </DropdownMenu>
        {shareCount > 0 && (shareCountSlot ?? <ActionCount>{formatNumber(shareCount)}</ActionCount>)}
      </div>

      {trailing}
    </div>
  </div>
);

export default PostActionRow;
