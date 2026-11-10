/**
 * The top-level "new comment" composer, pinned OUTSIDE the scrolling
 * CommentThread — for the web Comments modal and the mobile Comments bottom
 * sheet, both of which need the list to scroll independently while this stays
 * put (spec: "the comment composer must remain accessible/fixed at the
 * bottom of the comments panel").
 *
 * This is the same box CommentThread has always drawn at the bottom of its
 * own output (clear-on-submit, put the text back only if the caller reports
 * failure) — extracted so it can be rendered in a different DOM position
 * without a second, drifting copy of that logic. When CommentThread is asked
 * to `hideComposer`, this is what the caller renders instead, and the two are
 * expected to be visually identical.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import MentionInput from "@/components/MentionInput";
import type { ReplyTarget } from "@/components/comments/replyTarget";
import { Avatar } from "@/components/comments/CommentThread";
import { COMMENT_PLACEHOLDER } from "@/components/comments/CommentThread";

/**
 * THE QUICK-REACTION ROW.
 *
 * Eight emoji on one line above the box. Tapping one APPENDS IT TO THE DRAFT —
 * it does not post. That is the whole design decision in this row and it is
 * deliberate:
 *
 *   · A tap that posts instantly is a write with no undo on a surface where
 *     the member's thumb is already moving. "🔥" arriving under a stranger's
 *     photograph because a scroll was misread is not a recoverable mistake —
 *     it is a notification to somebody else.
 *   · Appending keeps one send path. The comment still goes through the same
 *     `submit` below, which means the keyword blocklist, the AI moderation
 *     call behind useAddComment, and the put-the-text-back-on-refusal contract
 *     all apply to an emoji exactly as they do to a sentence. A row that
 *     posted directly would need its own copy of all three, and a second write
 *     path is how the two comment threads drifted apart in the first place.
 *
 * These are NOT the six `REACTIONS` types in CommentThread. Those are rows in
 * post_comment_reactions attached to ONE comment; these are characters typed
 * into a NEW comment. Same-looking pictures, different things — so the sets
 * are allowed to differ and neither imports the other.
 */
export const QUICK_EMOJI: { char: string; label: string }[] = [
  { char: "❤️", label: "Heart" },
  { char: "🙌", label: "Raised hands" },
  { char: "🔥", label: "Fire" },
  { char: "👏", label: "Clapping hands" },
  { char: "😢", label: "Crying face" },
  { char: "😍", label: "Heart eyes" },
  { char: "😮", label: "Shocked face" },
  { char: "😂", label: "Laughing to tears" },
];

export interface CommentComposerProps {
  currentUserId: string | null;
  viewer?: { full_name?: string | null; avatar_url?: string | null } | null;
  /** A write is in flight; the box goes read-only rather than queue a second one. */
  submitting?: boolean;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  /**
   * Draw the quick-reaction row above the box. Off by default so the ad
   * thread and any other existing caller is unchanged — the Comments sheet
   * and modal turn it on.
   */
  quickReactions?: boolean;
  /**
   * Post the comment. Resolving `false` puts the text back — the same
   * contract CommentThread's own composer has always had, so a comment
   * refused by the keyword blocklist is never silently lost. `parentId` is the
   * comment being answered when the box is in reply mode, else null.
   */
  onSubmit: (content: string, parentId: string | null) => void | Promise<boolean | void>;
  /**
   * ONE REPLY FLOW (replyTarget.ts): the comment being answered, if any. The box
   * shows "Replying to <name> · <first words> ×" and starts with the name.
   */
  replyTo?: ReplyTarget | null;
  /** × on the "Replying to" bar, or the reply was sent. */
  onCancelReply?: () => void;
}

const CommentComposer = ({
  currentUserId,
  viewer,
  submitting = false,
  maxLength = 2200,
  placeholder = COMMENT_PLACEHOLDER,
  className,
  quickReactions = false,
  onSubmit,
  replyTo = null,
  onCancelReply,
}: CommentComposerProps) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reply tapped: the box starts with the answered member's name (a real
  // mention, highlighted, deleted as one piece) and takes the keyboard.
  useEffect(() => {
    if (!replyTo) return;
    setValue(`@[${replyTo.name}](${replyTo.userId}) `);
    const el = inputRef.current;
    if (el) requestAnimationFrame(() => { el.focus(); const end = el.value.length; el.setSelectionRange(end, end); });
  }, [replyTo]);

  if (!currentUserId) return null;

  const submit = async () => {
    if (submitting) return;
    const text = value.trim();
    if (!text) return;
    const parentId = replyTo?.id ?? null;
    setValue("");
    if (parentId) onCancelReply?.();
    const ok = await onSubmit(text, parentId);
    if (ok === false) setValue(text);
  };

  const cancelReply = () => {
    setValue("");
    onCancelReply?.();
  };

  /**
   * Append, never replace, and never past the ceiling. `maxLength` is the same
   * limit the input enforces; an emoji that would breach it is dropped rather
   * than silently truncating the member's sentence to make room for it.
   */
  const appendEmoji = (char: string) => {
    if (submitting) return;
    setValue((current) => (current.length + char.length > maxLength ? current : current + char));
  };

  return (
    <div className={className}>
      {quickReactions && (
        <div
          className="mb-1.5 flex items-center gap-0.5"
          role="group"
          aria-label="Add an emoji to your comment"
        >
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji.char}
              type="button"
              onClick={() => appendEmoji(emoji.char)}
              disabled={submitting}
              aria-label={`Add ${emoji.label} to your comment`}
              /*
                ⚠ THE ROW NEVER SCROLLS AND NEVER WRAPS. `flex-1 basis-0` over
                eight children divides whatever width there is, so the eighth
                emoji is on screen at 360px — the narrowest phone this app
                supports — instead of sitting just past the right edge where
                nothing suggests it exists.

                A fixed `w-11` (44px) is what that costs: 8 × 44 = 352px against
                the 336px a 360px screen leaves inside the band's own padding,
                so the last one overflowed. The 44px HEIGHT is kept — it is the
                tap-target floor this app holds itself to (SendButtonTapTarget
                .test.ts) — and only the width flexes, to ~42px at 360px and
                wider on anything larger. Height is the axis a thumb misses on
                in a vertical list.
              */
              className="flex h-11 min-w-0 flex-1 basis-0 items-center justify-center rounded-full text-[22px] leading-none transition-transform duration-150 hover:scale-110 hover:bg-muted/50 active:scale-95 disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
            >
              <span aria-hidden="true">{emoji.char}</span>
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div data-replying-to="" className="mb-1.5 flex min-w-0 items-center gap-1 ps-10 text-xs text-muted-foreground">
          <span className="shrink-0">Replying to</span>
          <span className="shrink-0 font-semibold text-foreground">{replyTo.name}</span>
          {replyTo.preview && <span className="min-w-0 truncate">· {replyTo.preview}</span>}
          <button
            type="button"
            onClick={cancelReply}
            aria-label="Cancel reply"
            className="-me-2 ms-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-start gap-2">
        <Avatar src={viewer?.avatar_url} name={viewer?.full_name} size="sm" />
        <MentionInput
          ref={inputRef}
          value={value}
          onChange={setValue}
          onSubmit={submit}
          placeholder={replyTo ? `Reply to ${replyTo.name}…` : placeholder}
          disabled={submitting}
          maxLength={maxLength}
        />
      </div>
    </div>
  );
};

export default CommentComposer;
