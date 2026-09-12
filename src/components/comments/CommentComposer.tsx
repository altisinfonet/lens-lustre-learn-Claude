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
import { useState } from "react";
import MentionInput from "@/components/MentionInput";
import { Avatar } from "@/components/comments/CommentThread";
import { COMMENT_PLACEHOLDER } from "@/components/comments/CommentThread";

export interface CommentComposerProps {
  currentUserId: string | null;
  viewer?: { full_name?: string | null; avatar_url?: string | null } | null;
  /** A write is in flight; the box goes read-only rather than queue a second one. */
  submitting?: boolean;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  /**
   * Post the comment. Resolving `false` puts the text back — the same
   * contract CommentThread's own composer has always had, so a comment
   * refused by the keyword blocklist is never silently lost.
   */
  onSubmit: (content: string) => void | Promise<boolean | void>;
}

const CommentComposer = ({
  currentUserId,
  viewer,
  submitting = false,
  maxLength = 2200,
  placeholder = COMMENT_PLACEHOLDER,
  className,
  onSubmit,
}: CommentComposerProps) => {
  const [value, setValue] = useState("");

  if (!currentUserId) return null;

  const submit = async () => {
    if (submitting) return;
    const text = value.trim();
    if (!text) return;
    setValue("");
    const ok = await onSubmit(text);
    if (ok === false) setValue(text);
  };

  return (
    <div className={`flex gap-2 items-start ${className ?? ""}`}>
      <Avatar src={viewer?.avatar_url} name={viewer?.full_name} size="sm" />
      <MentionInput
        value={value}
        onChange={setValue}
        onSubmit={submit}
        placeholder={placeholder}
        disabled={submitting}
        maxLength={maxLength}
      />
    </div>
  );
};

export default CommentComposer;
