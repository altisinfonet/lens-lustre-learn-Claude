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
 * THE REACTIONS BELONG TO THE ROW, NOT TO THE CALLER
 *
 * They did not, at first. The like number's panel and the per-reaction
 * breakdown on the right were left with PostCard as slots, on the reasoning
 * that what a POST's number opens is a post's business. That reasoning was
 * wrong in exactly the way this whole file exists to prevent: the ad card
 * passed no slots, so it drew a like count that named nobody and no breakdown
 * at all. Owner, 2026-08-28: *"Reactions name of the person like Feed right
 * side not showing"*.
 *
 * So the row now draws both, from `reactionCounts` and a `reactionSource` that
 * says which table the names come from. Neither surface can be given one and
 * not the other, and neither can quietly go without.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT STILL STAYS WITH THE CALLER
 *
 * The share menu, because that is where the two surfaces genuinely differ: a
 * post may be reshared to a member's wall, and an advertisement may not — that
 * would republish an ad under a member's own name. A decision, not an omission,
 * so it is stated at each call site.
 *
 * And `shareCountSlot`, which is still a slot because ShareSummaryTooltip reads
 * post_shares only. An ad's share number therefore opens nothing yet; that is
 * the same gap the reactions had, one column over, and it is recorded here
 * rather than left to be discovered.
 */
import { useMemo, type ReactNode } from "react";
import { MessageCircle, Send } from "lucide-react";
import ReactionPicker, { REACTIONS, type ReactionType } from "@/components/ReactionPicker";
import ReactionSummaryTooltip, { type ReactionSource } from "@/components/ReactionSummaryTooltip";
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

  /** { like: 4, love: 2 } — the same shape posts and ads both return. */
  reactionCounts: Record<string, number>;
  /** Which table the names in the Reactions panel are read from. */
  reactionSource: ReactionSource;

  onCommentClick: () => void;

  /** Accessible names. Icon-only buttons have no other name. */
  commentLabel: string;
  shareLabel: string;

  /** The items inside the share menu — <DropdownMenuItem>s, supplied by the caller. */
  shareMenu: ReactNode;

  /** Replaces the plain share number, for a caller whose number opens a panel. */
  shareCountSlot?: ReactNode;
}

const PostActionRow = ({
  currentReaction,
  onReact,
  onUnreact,
  reactionDisabled = false,
  likeCount,
  commentCount,
  shareCount,
  reactionCounts,
  reactionSource,
  onCommentClick,
  commentLabel,
  shareLabel,
  shareMenu,
  shareCountSlot,
}: PostActionRowProps) => {
  /**
   * Which reactions this actually received, biggest first, with the emoji the
   * picker uses so the row and the picker can never disagree. Capped at four:
   * a 360px row has to hold the three action controls too.
   */
  const breakdown = useMemo(
    () =>
      Object.entries(reactionCounts ?? {})
        .filter(([, n]) => (n ?? 0) > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([type, count]) => ({
          type,
          count,
          emoji: REACTIONS.find((r) => r.type === type)?.emoji ?? "👍",
        })),
    [reactionCounts],
  );

  return (
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
        {/* JUST THE NUMBER IN THE ROW. THE BREAK-UP IS ONE TAP AWAY.

            Owner, 2026-08-10, with Instagram open beside this: "Like count
            exactly show like Instagram but when All likes will see then love
            and wow break up will show. Same for Comment and Share."

            Instagram writes "50.9K" beside the heart and nothing else, and that
            is what this is. Nothing is lost: the span is the trigger for
            ReactionSummaryTooltip, which lists every reaction with its own
            emoji, its name and its count, and then every member who left one.

            The two emoji faces that used to sit here were also what made the
            row's spacing uneven, because they were wider than the number they
            preceded. */}
        {likeCount > 0 && (
          <ReactionSummaryTooltip reactionCounts={reactionCounts} totalCount={likeCount} source={reactionSource}>
            <ActionCount interactive>{formatNumber(likeCount)}</ActionCount>
          </ReactionSummaryTooltip>
        )}
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

      {/* ── THE REACTION BREAKDOWN, ON THE RIGHT ──

          Owner, 2026-08-15: *"emoji mean love and like icons of likes post
          posts like fb"*, with *"Icons + a count per reaction, total reaction
          on left side as per FB current style"*.

          So the total stays where it always was — beside the thumb on the left,
          which is Facebook's own arrangement — and the right-hand side, which
          used to hold reach/views figures that were being sliced off at 360px,
          carries each reaction actually received with its own count.

          It is derived from `reactionCounts`, which arrives WITH the post or
          with the ad's engagement RPC, so it cannot appear late and shift the
          row. Zero-count reactions are dropped rather than shown as "0" — an
          emoji nobody chose is noise. `ml-auto` holds the group right even with
          no reactions at all.

          It opens the same ReactionSummaryTooltip the total does, so tapping
          any of it lists every member who reacted.

          ⚠ `ml-auto` sits on a wrapper OUTSIDE the tooltip, not on the row
          itself: the tooltip renders its own element around the trigger, so a
          margin on the child never reaches the flex parent and the group
          drifted in from the right edge. Measured in the harness. */}
      {breakdown.length > 0 && (
        <div className="ml-auto">
          <ReactionSummaryTooltip reactionCounts={reactionCounts} totalCount={likeCount} source={reactionSource}>
            <div className="flex cursor-pointer items-center gap-2.5 pr-1.5 text-xs text-muted-foreground">
              {breakdown.map(({ type, emoji, count }) => (
                <span key={type} className="inline-flex items-center gap-1" title={type}>
                  <span aria-hidden className="text-[13px] leading-none">{emoji}</span>
                  <span className="font-medium text-foreground/80">{formatNumber(count)}</span>
                </span>
              ))}
            </div>
          </ReactionSummaryTooltip>
        </div>
      )}
    </div>
  </div>
  );
};

export default PostActionRow;
