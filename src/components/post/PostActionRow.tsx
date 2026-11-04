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
 * once, and both surfaces render it. Geometry lives here and in
 * actionRowGeometry.ts and nowhere else: 24px icons on a 32px row, every
 * control a 44px-tall finger target reaching up only (ROW_TAP), content-sized
 * side to side with Instagram's spacing (Owner report 4 Nov 2026), pushed
 * left, no divider, no text labels, and a count that disappears at zero.
 *
 * THE VISIBLE GAPS AND THE LEFT EDGE (Owner report 3 Nov 2026 ~16:20Z, "not
 * done"): the 48px boxes from 10 Aug (ea8f2256) left 13px of empty card above
 * the icons and 18px below them, and the Like icon started 5px right of the
 * caption. Now the box is 32px (5px of card above the icon ink, 10px down to the
 * caption's ink) and the row starts 1px in, so the Like icon's ink (1px inside
 * its 24px box) starts at x 12 — the caption's left edge. Measured on visible
 * pixels by tools/uishot/camline-visual.mjs (card-ink.mjs).
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
import { ROW_TAP } from "@/components/post/actionRowGeometry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A count beside an icon. Exported because a caller that wraps its number in a
 * tooltip has to draw the number itself, and it must be the same number.
 *
 * Its padding IS the row's spacing (Owner report 4 Nov, Instagram's row —
 * actionRowGeometry.ts): 3 px before the number (with the icon's own 1 px edge
 * and the digit's side bearing, ~5 px of visible space after the icon) and
 * 14 px after it (~16 px to the next icon's ink). The count's tap box owns both,
 * so the visible gaps are finger target, not empty card.
 */
export const ActionCount = ({
  children,
  interactive = false,
}: {
  children: ReactNode;
  interactive?: boolean;
}) => (
  <span
    className={`ps-[3px] pe-3.5 ${interactive ? "cursor-pointer " : ""}text-sm font-semibold text-foreground`}
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

  /*
   * SIDE TO SIDE (Owner report 4 Nov 2026, Instagram beside it — see
   * actionRowGeometry.ts). Every box is content-sized and abuts the next; the
   * visible gaps are padding, owned like this:
   *   Like icon → like count       the count (Like stops at its icon)
   *   like count → Comment icon    the count (Comment starts at its icon)
   *   Like → Comment, no count     split: Like pe-2 | Comment ps-2
   *   Comment (+count) → Share     split: Comment pe-1.5 | Share ps-2
   *   Comment (no count) → Share   split: Comment pe-2 | Share ps-2
   *   Share → share count          the count (Share stops at its icon)
   * Every box stays >= 32 wide (capture.mjs floor): Share is 8 + 24 even
   * with its count beside it (ui-gate run 41759079521 caught 6 + 24 = 30);
   * Comment with no count after a like count is 0 + 24 + 8.
   *   after the last control       free card (Share pe-2.5 when no count)
   */
  const hasLikes = likeCount > 0;
  const hasShares = shareCount > 0;

  return (
  <div className="select-none ps-px pe-1.5">
    <div className="flex items-center">
      {/* Like — the picker owns the button, the count sits beside it */}
      <div className="flex items-center">
        <ReactionPicker
          currentReaction={currentReaction}
          onReact={onReact}
          onUnreact={onUnreact}
          disabled={reactionDisabled}
          sideClassName={hasLikes ? "ps-2.5 pe-0" : "ps-2.5 pe-2"}
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
        {hasLikes && (
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
        className={`${ROW_TAP} ${hasLikes ? "ps-0" : "ps-2"} ${commentCount > 0 ? "pe-1.5" : "pe-2"} flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors`}>
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
              className={`${ROW_TAP} ps-2 ${hasShares ? "pe-0" : "pe-2.5"} flex items-center justify-start text-muted-foreground hover:text-foreground transition-colors`}>
              <Send className="h-6 w-6" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {shareMenu}
          </DropdownMenuContent>
        </DropdownMenu>
        {hasShares && (shareCountSlot ?? <ActionCount>{formatNumber(shareCount)}</ActionCount>)}
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
            {/* A SPAN, because ReactionSummaryTooltip's trigger is now a real
                <button> and a <div> inside a button is invalid content. The
                cursor and the click behaviour come from that button. Its
                side padding lives here (the trigger is content-sized since
                4 Nov): ps-2.5 pe-4 = the 10 + 16 px it always had, so the
                break-up sits exactly where it did. */}
            <span className="inline-flex items-center gap-2.5 ps-2.5 pe-4 text-xs text-muted-foreground">
              {breakdown.map(({ type, emoji, count }) => (
                <span key={type} className="inline-flex items-center gap-1" title={type}>
                  <span aria-hidden className="text-[13px] leading-none">{emoji}</span>
                  <span className="font-medium text-foreground/80">{formatNumber(count)}</span>
                </span>
              ))}
            </span>
          </ReactionSummaryTooltip>
        </div>
      )}
    </div>
  </div>
  );
};

export default PostActionRow;
