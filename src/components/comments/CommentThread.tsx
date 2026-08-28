/**
 * THE comment thread — one implementation, two surfaces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * A sponsored story card used to draw its own thread in
 * src/components/ads/AdComments.tsx: 405 lines that were a hand-copy of
 * PostCommentsSection's, opening with a paragraph explaining why it could not
 * be the same component. The copy then rotted in exactly the way a copy does.
 * Its list rendered
 *
 *     renderRow(comment, false)
 *
 * as BARE TEXT inside JSX — the braces were missing, so React printed the call
 * as a string and every member saw the literal words `renderRow(comment, false)`
 * where the comment should have been. The post thread, one directory away, was
 * fine. Nothing could have caught it, because nothing tied the two together.
 *
 * So there is now one thread. It owns every piece of state a caret can live in
 * — the composer, the reply box, the edit box — and it renders one comment row.
 * What differs between a post and an advertisement is passed in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CALLER OWNS
 *
 * Reading and writing. This component never touches Supabase: the post surface
 * reads post_comments and writes through useAddComment (optimistic, with the
 * AI-moderation call behind it), and the ad surface reads and writes the
 * ad_creative_* tables through src/lib/ads/adEngagement.ts. Both hand this
 * component a tree and a set of callbacks. That split is deliberate — the two
 * data paths have genuinely different plumbing (react-query on one side, plain
 * awaits on the other) and pretending otherwise is what produced the copy.
 *
 * `features` turns off what a surface does not have rather than what it has not
 * got round to: an advertisement has no owner, so nobody may pin on it; it
 * carries no comment reactions and no per-comment report queue. Defaults are
 * the POST's, so a new surface gets the full thread unless it says otherwise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ROW IS RENDERED BY CALLING renderComment(), NOT AS <CommentItem />.
 *
 * Owner, 2026-08-12: *"In Comment Reply : I am typing 'Thanks' its typing as
 * 'sknaht'. Text pointer atomically coming front after typing"*.
 *
 * A component DECLARED INSIDE a render body is a new function object — a new
 * element TYPE — on every render. The reply text lives in this component's
 * state, so every keystroke re-rendered it, React saw an unfamiliar type, and
 * it unmounted and rebuilt the whole subtree. The real DOM input was destroyed
 * and recreated per letter, so the caret snapped back to 0 and the next
 * character landed in FRONT of the previous one. "Thanks" → "sknaht".
 *
 * Calling it as a plain function splices its output into THIS component's
 * element tree: no new type, nothing remounts, the caret stays put.
 *
 * ⚠ THE `key` LIVES ON THE RETURNED ROOT ELEMENT. A function call cannot carry
 *   one.
 * ⚠ NEVER CALL A REACT HOOK IN renderComment. It shares this component's hook
 *   slots, so a conditional hook there corrupts the hook order. It uses none,
 *   and src/__tests__/noComponentDefinedInRender.test.ts holds it to that.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { MoreHorizontal, Trash2, Flag, Pin, Pencil, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { isActiveNow } from "@/hooks/core/useLastActive";
import MentionInput from "@/components/MentionInput";
import RichContentRenderer from "@/components/RichContentRenderer";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { timeAgo } from "@/lib/postUtils";
import { avatarInitial } from "@/lib/displayName";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** One comment, with its replies already attached by the caller. */
export interface ThreadComment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
  is_pinned: boolean;
  author_name: string | null;
  author_avatar: string | null;
  author_badges: string[];
  author_last_active: string | null;
  like_count: number;
  is_liked: boolean;
  replies: ThreadComment[];
}

export interface ThreadFeatures {
  /** Per-comment Like. post_comment_reactions only — an ad comment has none. */
  reactions?: boolean;
  /** Pin to the top. Belongs to whoever owns the thing being commented on. */
  pinning?: boolean;
  /** Report to the admin queue from the row's menu. */
  reporting?: boolean;
  /** Most relevant / Newest first. */
  sorting?: boolean;
}

const REPORT_REASONS = [
  "Inappropriate",
  "Spam",
  "Harassment",
  "Nudity",
  "Hate Speech",
  "False Information",
  "Violence",
];

export interface CommentThreadProps {
  comments: ThreadComment[];
  loading: boolean;
  currentUserId: string | null;
  /** The signed-in member's own name and picture, for the composer's avatar. */
  viewer?: { full_name?: string | null; avatar_url?: string | null } | null;
  isAdmin: boolean;
  /** May the viewer pin on THIS thread — post owner or admin. */
  canPin?: boolean;
  /** A write is in flight; the boxes go read-only rather than queue a second one. */
  submitting?: boolean;
  editSubmitting?: boolean;
  maxLength?: number;
  composerPlaceholder?: string;
  /** Shown in place of the list when there is nothing in it. Omit to show nothing. */
  emptyLabel?: string;
  features?: ThreadFeatures;
  /**
   * How deep Reply is offered. Posts thread without a limit; an ad thread is
   * one level deep, because its loader groups replies by their top-level parent
   * and a reply-to-a-reply would simply never be drawn.
   */
  maxReplyDepth?: number;

  /**
   * Post the comment. The box is cleared immediately — that is the post
   * thread's long-standing behaviour and it is what makes the optimistic row
   * feel instant. Resolving `false` puts the text back, which is how a comment
   * refused by the keyword blocklist stops being lost.
   */
  onAdd: (content: string, parentId: string | null) => void | Promise<boolean | void>;
  /** Resolve true to close the editor; false leaves it open with the text in it. */
  onEdit: (id: string, content: string) => void | Promise<boolean | void>;
  onDelete: (id: string, parentId: string | null) => void;
  onToggleLike?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onReport?: (id: string, reason: string) => void;
}

const Avatar = ({
  src,
  name,
  size = "sm",
  lastActiveAt,
}: {
  src: string | null | undefined;
  name: string | null | undefined;
  size?: "xs" | "sm";
  lastActiveAt?: string | null;
}) => {
  const cls = size === "xs" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
  const online = isActiveNow(lastActiveAt);
  return (
    <span className={`relative inline-block ${cls}`}>
      {src ? (
        <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={src} alt="" className={`${cls} rounded-full object-cover`} />
      ) : (
        <div className={`${cls} rounded-full bg-muted flex items-center justify-center font-semibold text-muted-foreground`}>
          {avatarInitial(name)}
        </div>
      )}
      {online && (
        <span aria-label="Online" title="Online" className="absolute bottom-0 right-0 block h-2 w-2 rounded-full bg-green-500 ring-2 ring-background" />
      )}
    </span>
  );
};

/**
 * "Edited" only after a real edit. `updated_at` is stamped by a trigger and can
 * land a few milliseconds after `created_at` on the insert itself, so a bare
 * inequality labelled every brand-new comment as edited.
 */
const isEdited = (c: ThreadComment) =>
  !!c.updated_at &&
  c.updated_at !== c.created_at &&
  new Date(c.updated_at).getTime() - new Date(c.created_at).getTime() > 2000;

const CommentThread = ({
  comments,
  loading,
  currentUserId,
  viewer,
  isAdmin,
  canPin = false,
  submitting = false,
  editSubmitting = false,
  maxLength = 2200,
  composerPlaceholder = "Write a comment...",
  emptyLabel,
  features,
  maxReplyDepth = Number.POSITIVE_INFINITY,
  onAdd,
  onEdit,
  onDelete,
  onToggleLike,
  onTogglePin,
  onReport,
}: CommentThreadProps) => {
  const canReact = features?.reactions ?? true;
  const canPinHere = (features?.pinning ?? true) && canPin;
  const canReport = features?.reporting ?? true;
  const canSort = features?.sorting ?? true;

  const [commentInput, setCommentInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [sortMode, setSortMode] = useState<"relevant" | "newest">("relevant");

  const sortedComments = [...comments].sort((a, b) => {
    // Pinned first
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    if (canSort && sortMode === "relevant") {
      const scoreA = a.like_count + a.replies.length;
      const scoreB = b.like_count + b.replies.length;
      if (scoreA !== scoreB) return scoreB - scoreA;
    }
    if (canSort && sortMode === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const submitComment = async (parentId: string | null = null) => {
    if (!currentUserId || submitting) return;
    const text = parentId ? replyInput.trim() : commentInput.trim();
    if (!text) return;
    if (parentId) {
      setReplyInput("");
      setReplyTo(null);
    } else {
      setCommentInput("");
    }
    const ok = await onAdd(text, parentId);
    // Only a surface that explicitly reports failure gets the text back; the
    // post path resolves undefined because its mutation rolls itself back.
    if (ok === false) {
      if (parentId) {
        setReplyTo(parentId);
        setReplyInput(text);
      } else {
        setCommentInput(text);
      }
    }
  };

  const saveEdit = async (commentId: string) => {
    const text = editInput.trim();
    if (!text) return;
    const ok = await onEdit(commentId, text);
    if (ok === false) return;
    setEditingId(null);
    setEditInput("");
  };

  const submitReport = (commentId: string) => {
    if (!reportReason) return;
    onReport?.(commentId, reportReason);
    setReportingId(null);
    setReportReason("");
  };

  /** ⚠ Called, never written as an element. See the note at the top of this file. */
  const renderComment = (comment: ThreadComment, depth = 0) => {
    const isOwn = currentUserId === comment.user_id;
    const canDelete = isOwn || isAdmin;

    return (
      // The key belongs HERE: the call sites are function calls and a call
      // cannot carry a key. Without it React re-uses the wrong node when a
      // comment is deleted mid-list.
      <div key={comment.id} className={depth > 0 ? "ml-10" : ""}>
        <div className="flex gap-2 group/comment py-0.5">
          <Link to={`/profile/${comment.user_id}`} className="shrink-0 mt-0.5">
            <Avatar src={comment.author_avatar} name={comment.author_name} size={depth > 0 ? "xs" : "sm"} lastActiveAt={comment.author_last_active} />
          </Link>
          <div className="flex-1 min-w-0">
            {/* Editing mode */}
            {editingId === comment.id ? (
              <div className="flex gap-2 items-end">
                <MentionInput
                  value={editInput}
                  onChange={setEditInput}
                  onSubmit={() => saveEdit(comment.id)}
                  placeholder="Edit comment..."
                  disabled={editSubmitting}
                  maxLength={maxLength}
                  autoFocus
                  className="bg-muted rounded-2xl px-3 py-2 text-sm"
                />
                <button onClick={() => { setEditingId(null); setEditInput(""); }} className="text-xs text-muted-foreground hover:text-foreground mb-2">
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {/* Pinned badge */}
                {comment.is_pinned && (
                  <div className="flex items-center gap-1 text-[10px] text-primary font-medium mb-0.5">
                    <Pin className="h-3 w-3" /> Pinned comment
                  </div>
                )}

                {/* Bubble */}
                <div className="relative inline-block max-w-full">
                  <div className="bg-popover rounded-2xl px-3 py-2 inline-block max-w-full">
                    <UserIdentityBlock
                      userId={comment.user_id}
                      name={comment.author_name || "Photographer"}
                      linkTo={`/profile/${comment.user_id}`}
                    />
                    <p className="text-[15px] text-foreground leading-[1.33] break-words">
                      <RichContentRenderer content={comment.content} />
                    </p>
                    {isEdited(comment) && (
                      <span className="text-[10px] text-muted-foreground italic ml-1">Edited</span>
                    )}
                  </div>

                  {/* Like count badge on bubble */}
                  {canReact && comment.like_count > 0 && (
                    <span className="absolute -bottom-2 right-2 bg-card border border-border rounded-full px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm flex items-center gap-0.5">
                      👍 {comment.like_count}
                    </span>
                  )}
                </div>

                {/* Action row */}
                <div className="flex items-center gap-3 mt-1 px-1">
                  <span className="text-xs text-muted-foreground font-medium">{timeAgo(comment.created_at)}</span>
                  {canReact && currentUserId && (
                    <button
                      onClick={() => onToggleLike?.(comment.id)}
                      className={`text-xs font-semibold transition-colors ${comment.is_liked ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Like
                    </button>
                  )}
                  {currentUserId && depth < maxReplyDepth && (
                    <button
                      onClick={() => {
                        const opening = replyTo !== comment.id;
                        setReplyTo(opening ? comment.id : null);
                        if (opening) {
                          const name = comment.author_name || "Photographer";
                          setReplyInput(`@[${name}](${comment.user_id}) `);
                        } else {
                          setReplyInput("");
                        }
                      }}
                      className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Reply
                    </button>
                  )}

                  {/* 3-dot menu */}
                  {currentUserId && (isOwn || canDelete || canPinHere || canReport) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label="Comment options"
                          className="opacity-0 group-hover/comment:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        {isOwn && (
                          <DropdownMenuItem onClick={() => { setEditingId(comment.id); setEditInput(comment.content); }} className="cursor-pointer">
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                        )}
                        {canPinHere && depth === 0 && (
                          <DropdownMenuItem onClick={() => onTogglePin?.(comment.id)} className="cursor-pointer">
                            <Pin className="h-3.5 w-3.5 mr-2" /> {comment.is_pinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem onClick={() => onDelete(comment.id, comment.parent_id)} className="cursor-pointer text-destructive focus:text-destructive">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        )}
                        {canReport && !isOwn && (
                          <DropdownMenuItem onClick={() => { setReportingId(comment.id); setReportReason(""); }} className="cursor-pointer text-destructive focus:text-destructive">
                            <Flag className="h-3.5 w-3.5 mr-2" /> Report
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Report inline */}
                <AnimatePresence>
                  {canReport && reportingId === comment.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden mt-1 ml-1"
                    >
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {REPORT_REASONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setReportReason(r)}
                            className={`text-[10px] px-2 py-1 border rounded-md transition-all ${reportReason === r ? "border-destructive text-destructive bg-destructive/5 font-medium" : "border-border text-muted-foreground hover:border-muted-foreground/50"}`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => submitReport(comment.id)} disabled={!reportReason} className="text-[10px] px-3 py-1 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50">
                          Submit
                        </button>
                        <button onClick={() => { setReportingId(null); setReportReason(""); }} className="text-[10px] px-3 py-1 border border-border rounded-md text-muted-foreground">
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Reply input */}
                {replyTo === comment.id && (
                  <div className="flex gap-2 mt-2">
                    <Avatar src={viewer?.avatar_url} name={viewer?.full_name} size="xs" />
                    <MentionInput
                      value={replyInput}
                      onChange={setReplyInput}
                      onSubmit={() => submitComment(comment.id)}
                      placeholder={`Reply to ${comment.author_name || "Photographer"}...`}
                      disabled={submitting}
                      maxLength={maxLength}
                      autoFocus
                      className="bg-muted rounded-full px-3 py-1.5 text-sm"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Replies */}
        {comment.replies.map((reply) => (
          renderComment(reply, depth + 1)
        ))}
      </div>
    );
  };

  const totalCount = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  return (
    <div className="px-3 py-2">
      {/* Sort selector */}
      {canSort && totalCount > 1 && (
        <div className="flex items-center gap-1 mb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1">
                {sortMode === "relevant" ? "Most relevant" : "Newest first"}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => setSortMode("relevant")} className="cursor-pointer text-xs">
                Most relevant
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("newest")} className="cursor-pointer text-xs">
                Newest first
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Comments */}
      {loading ? (
        <div className="text-sm text-muted-foreground animate-pulse py-4 text-center">Loading comments…</div>
      ) : (
        <div className="space-y-0.5">
          {emptyLabel && sortedComments.length === 0 && (
            <div className="text-xs text-muted-foreground">{emptyLabel}</div>
          )}
          {sortedComments.map((c) => (
            renderComment(c)
          ))}
        </div>
      )}

      {/* New comment input */}
      {currentUserId && (
        <div className="flex gap-2 pt-2 pb-1">
          <Avatar src={viewer?.avatar_url} name={viewer?.full_name} size="sm" />
          <MentionInput
            value={commentInput}
            onChange={setCommentInput}
            onSubmit={() => submitComment(null)}
            placeholder={composerPlaceholder}
            disabled={submitting}
            maxLength={maxLength}
          />
        </div>
      )}
    </div>
  );
};

export default CommentThread;
