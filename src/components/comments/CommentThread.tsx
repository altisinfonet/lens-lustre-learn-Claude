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
import ProfileLink from "@/components/ProfileLink";
import { Link } from "react-router-dom";
import { MoreHorizontal, Trash2, Flag, Pin, Pencil, ChevronDown, Heart, SmilePlus } from "lucide-react";
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
  /** F-95 — the name-URL handle, carried beside the name it belongs to. */
  author_handle?: string | null;
  author_avatar: string | null;
  author_badges: string[];
  author_last_active: string | null;
  like_count: number;
  is_liked: boolean;
  /** Per-type breakdown, e.g. { like: 3, love: 1 } — only meaningful when reactions are on. */
  reaction_counts?: Record<string, number>;
  /** The reaction_type the current viewer picked on this comment, or null/undefined for none. */
  user_reaction?: string | null;
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

/**
 * ONE PLACEHOLDER, ONE STRING.
 *
 * The post cards said "Write a comment..." and the sponsored ad card said
 * "Add a comment…" — different words AND a different ellipsis (one U+2026
 * character against three full stops). Two threads written twice left two
 * strings behind even after the threads became one; a member moving down the
 * feed met both. This is the string, and the ad surface no longer overrides it.
 */
export const COMMENT_PLACEHOLDER = "Write a comment...";

/**
 * THE HANDLE-AWARE PLACEHOLDER — DERIVED FROM THE ONE STRING ABOVE, NOT A
 * SECOND COPY OF IT.
 *
 * The reference composer names whose post you are about to comment on
 * ("Add a comment for villagesquarei…"), which is genuinely useful on a sheet
 * that can be opened from a feed of dozens of posts. The note above this is
 * the reason it is a FUNCTION and not a second exported literal: two strings
 * written twice is exactly what left "Write a comment..." and "Add a comment…"
 * in the same bundle. A post with no handle falls back to COMMENT_PLACEHOLDER,
 * so there is still exactly one default in the codebase.
 */
/**
 * ⚠ 10, AND THE NUMBER CAME FROM A SCREENSHOT, NOT FROM THE REFERENCE.
 *
 * It was 14 — the reference's own "villagesquarei…" — and the first capture of
 * the comments scene at 360px (tools/uishot, app-360) showed why that does not
 * transfer: the placeholder WRAPPED to a second line and the second line was
 * clipped by the bottom of the sheet. MentionInput renders a textarea, whose
 * placeholder wraps like any other text, and the box is narrower here than the
 * reference's — an avatar on the left and the send button occupying 44px
 * INSIDE the field on the right leave about 236px for the string.
 *
 * "Add a comment for " is 18 characters before the handle even starts, so the
 * handle is what has to give. 10 + the ellipsis fits on one line at 360px,
 * measured in the harness, with the longest handle this can produce.
 */
export const HANDLE_PLACEHOLDER_MAX = 10;
export const commentPlaceholderFor = (handle?: string | null): string => {
  const clean = handle?.trim().replace(/^@/, "");
  if (!clean) return COMMENT_PLACEHOLDER;
  const shown =
    clean.length > HANDLE_PLACEHOLDER_MAX ? `${clean.slice(0, HANDLE_PLACEHOLDER_MAX)}…` : clean;
  return `Add a comment for ${shown}`;
};

/**
 * THE REACTION SET. `post_comment_reactions.reaction_type` is free-form
 * `text` in the database (default `'like'`, no CHECK constraint — see the
 * 20260323 migration), so this list is a client-side convention, not a
 * schema constraint. Adding a reaction here needs no migration; removing
 * one would still leave old rows of that type in the database, so treat
 * `type` values as append-only.
 */
export const REACTIONS: { type: string; emoji: string; label: string; color: string }[] = [
  { type: "like", emoji: "👍", label: "Like", color: "text-primary" },
  { type: "love", emoji: "❤️", label: "Love", color: "text-red-500" },
  { type: "haha", emoji: "😆", label: "Haha", color: "text-amber-500" },
  { type: "wow", emoji: "😮", label: "Wow", color: "text-amber-500" },
  { type: "sad", emoji: "😢", label: "Sad", color: "text-amber-500" },
  { type: "angry", emoji: "😡", label: "Angry", color: "text-orange-600" },
];
const REACTION_BY_TYPE = new Map(REACTIONS.map((r) => [r.type, r]));

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
  /**
   * Omit the top-level "new comment" composer from this component's own
   * output. Set this when the caller renders <CommentComposer> itself,
   * pinned outside this thread's scroll container (the web modal and the
   * mobile bottom sheet both do — the comments panel scrolls, the composer
   * must not). Reply and edit boxes are unaffected: they stay inline, under
   * the comment they belong to, exactly as before. Default false so every
   * existing caller (the post's inline thread, the ad thread) is unchanged.
   */
  hideComposer?: boolean;
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
  /** Plain tap on the "Like" word — always the default reaction (REACTIONS[0], "like"). */
  onToggleLike?: (id: string) => void;
  /** A specific emoji chosen from the reaction picker. Omit `features.reactions` and neither this nor onToggleLike's UI renders. */
  onReact?: (id: string, reactionType: string) => void;
  onTogglePin?: (id: string) => void;
  onReport?: (id: string, reason: string) => void;
}

/**
 * Exported so CommentComposer.tsx can draw the same avatar beside the
 * top-level composer when the composer is rendered OUTSIDE this component
 * (see `hideComposer` below) — one avatar treatment, not two.
 */
export const Avatar = ({
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
  composerPlaceholder = COMMENT_PLACEHOLDER,
  hideComposer = false,
  emptyLabel,
  features,
  maxReplyDepth = Number.POSITIVE_INFINITY,
  onAdd,
  onEdit,
  onDelete,
  onToggleLike,
  onReact,
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
  /** Which comment's emoji-reaction popover is open, if any. One at a time. */
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);

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
      <div key={comment.id} className={depth > 0 ? "ml-11" : ""}>
        <div className="flex gap-3 group/comment py-2">
          <ProfileLink userId={comment.user_id} handle={comment.author_handle} className="shrink-0 mt-0.5">
            <Avatar src={comment.author_avatar} name={comment.author_name} size={depth > 0 ? "xs" : "sm"} lastActiveAt={comment.author_last_active} />
          </ProfileLink>
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
                {/* PINNED — a chip above the name rather than a line of body
                    text, so it reads as metadata about the comment and never as
                    something the author wrote. */}
                {comment.is_pinned && (
                  <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.04em] text-primary">
                    <Pin className="h-2.5 w-2.5" /> Pinned
                  </div>
                )}

                {/*
                  ⚠ ONE IDENTITY LINE — NAME, BADGE, WHEN — THEN THE TEXT UNDER IT.

                  This replaced a chat-style bubble (`bg-popover rounded-2xl`)
                  with the timestamp and actions stacked BELOW it and the like
                  count floating on the bubble's corner. The bubble cost a row
                  of horizontal padding on both sides of every comment, wrapped
                  the text earlier on a 360px phone, and put four separate
                  vertical bands (name, bubble, count badge, action row) between
                  one comment and the next.

                  Flat rows are what a THREAD wants: the eye runs down one
                  left-hand avatar rail, and reply indentation — not a coloured
                  container — is what says which comment answers which. The
                  bubble is still right where it is used for a two-party chat;
                  this is not one.
                */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <UserIdentityBlock
                    userId={comment.user_id}
                    name={comment.author_name || "Photographer"}
                    /**
                     * ⚠ PASS THE BADGES THE CALLER ALREADY RESOLVED.
                     *
                     * Both adapters run every author through `resolveBadges`,
                     * which is what injects the brand tick for an admin — the
                     * admin account has no row in user_badges at all. This
                     * computed them and threw them away, so the row fell back
                     * to a second per-name lookup that could not know about
                     * the brand rule, and the owner saw a verified name with
                     * no tick in every comment (2026-08-28). Same correction
                     * PostCard's header took on 2026-08-14: if the name and
                     * the badge arrive together, "name visible, badge
                     * missing" stops being a reachable state.
                     */
                    badges={comment.author_badges}
                    handle={comment.author_handle}
                    className="min-w-0"
                  />
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {timeAgo(comment.created_at, { weeks: true })}
                  </span>
                  {isEdited(comment) && (
                    <span className="shrink-0 text-[11px] italic text-muted-foreground">Edited</span>
                  )}
                </div>

                {/*
                  ⚠ `whitespace-pre-wrap` IS LOAD-BEARING. (Fixed 2026-08-28.)

                  A comment written as two paragraphs rendered as ONE line.
                  The newline survived everything except the last step: the
                  database stored it (post_comments 95c6f07c is 'para one' +
                  chr(10) + 'para two'), React put it in the DOM (textContent
                  was "para one\npara two") — and then HTML did what HTML
                  does. Under the default `white-space: normal` a newline is
                  just another run of whitespace and collapses to a single
                  space. Measured: 18px rendered against a 20px line-height.

                  Nothing in the data path was wrong, which is why it looked
                  so puzzling; the fault was one missing CSS declaration on
                  the element that draws the text.

                  PRE-WRAP, NEVER PRE: `pre` would preserve the newlines and
                  stop long lines wrapping, so a pasted URL would run off the
                  card — the same failure `break-words` exists to prevent one
                  property along. `pre-wrap` keeps the breaks AND still wraps.

                  It is inherited, so it reaches RichContentRenderer's inner
                  <span> too, and this is the one comment row both the post
                  card and the sponsored ad card render — replies included.
                  Caption.tsx has carried the identical pair since it was
                  written; see the note there.

                  The leading is 1.45 rather than the old 1.33: without a
                  bubble behind it the text is read against the page, and
                  1.33 on a 15px body is tight enough to grey out a long
                  comment on a phone.
                */}
                <p className="mt-0.5 text-[15px] leading-[1.45] text-foreground whitespace-pre-wrap break-words">
                  <RichContentRenderer content={comment.content} />
                </p>

                {/* Action row. The timestamp moved UP to the identity line and
                    Like moved OUT to the heart rail on the right, so what is
                    left here is Reply and the overflow menu — and the row no
                    longer competes with the comment text for attention. */}
                <div className="mt-1 flex items-center gap-4">
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
                      className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Reply
                    </button>
                  )}

                  {/* 3-dot menu */}
                  {currentUserId && (isOwn || canDelete || canPinHere || canReport || canReact) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label="Comment options"
                          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover/comment:opacity-100 md:opacity-0 max-md:opacity-100"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        {/*
                          ⚠ THE PICKER KEEPS A KEYBOARD ROUTE.

                          The six reaction types are real rows in
                          post_comment_reactions and the heart rail can only
                          ever send the default one, so the picker cannot
                          simply be deleted with the old ▾ caret it used to
                          hang off. Opening it from this menu keeps every type
                          reachable by keyboard and screen reader — a
                          long-press would not be.
                        */}
                        {canReact && (
                          <DropdownMenuItem
                            onClick={() => setReactionPickerId(comment.id)}
                            className="cursor-pointer"
                          >
                            <SmilePlus className="mr-2 h-3.5 w-3.5" /> React…
                          </DropdownMenuItem>
                        )}
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

          {/*
            THE HEART RAIL — the like, and its count, in the row's right margin.

            It used to be the word "Like" plus a "▾" caret in the action row
            under the bubble, with the count floating on the bubble's corner as
            a third, separate element. Three places said one thing. The rail is
            one control: tap it to like, and the number under it is that same
            like_count.

            ⚠ THE HEART DRAWS THE DEFAULT REACTION, NOT A SEVENTH TYPE.
            `onToggleLike` writes REACTIONS[0] — reaction_type 'like' — exactly
            as it did before this row was redrawn; nothing about what is stored
            changed here. When the viewer has picked one of the OTHER five from
            the picker, their own emoji is drawn in place of the heart, because
            showing a filled heart for a 😢 would misreport what they actually
            sent.

            `title` carries the per-type breakdown that the corner badge used to
            show, so the detail is still reachable without giving every row a
            second cluster of emoji to read past.
          */}
          {canReact && editingId !== comment.id && (
            <div className="relative flex shrink-0 flex-col items-center">
              <button
                type="button"
                onClick={() => onToggleLike?.(comment.id)}
                disabled={!currentUserId}
                aria-pressed={!!comment.user_reaction}
                aria-label={comment.user_reaction ? "Remove your reaction" : "Like this comment"}
                title={
                  Object.entries(comment.reaction_counts || {})
                    .filter(([, count]) => count > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => `${REACTION_BY_TYPE.get(type)?.label ?? type} ${count}`)
                    .join(" · ") || undefined
                }
                /*
                  ⚠ 44×44 IS THE BUTTON ITSELF, NOT A `.tap-44` REGION.

                  tools/uishot's tap-target sweep measured this at 32×32 on the
                  first capture of the comments scene — under the floor. The
                  app's `.tap-44` utility would have fixed the number by growing
                  an invisible region symmetrically, and F-109 (see index.css) is
                  the record of what that costs next to text: the enlarged region
                  around "Copy Photo Link" took 27% of the photographer's name
                  above it. This control sits in the margin beside a comment body
                  that can wrap to its edge, so the same contest was available.

                  A real 44×44 button cannot take a pixel from anything, because
                  the row reserves the space. The visible circle stays 32px on
                  the span inside, so the rail looks exactly as designed and only
                  the thumb target is larger.
                */
                className="group/heart flex h-11 w-11 items-center justify-center disabled:cursor-default disabled:opacity-60"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-150 group-hover/heart:bg-muted/50 group-active/heart:scale-90 motion-reduce:transition-none motion-reduce:group-active/heart:scale-100">
                {comment.user_reaction && comment.user_reaction !== "like" ? (
                  <span className="text-base leading-none">
                    {REACTION_BY_TYPE.get(comment.user_reaction)?.emoji ?? "👍"}
                  </span>
                ) : (
                  /*
                    ⚠ THE FILLED HEART IS `primary`, NOT A RAW RED.

                    REACTIONS[0] — the type this heart actually writes — already
                    declares its colour as `text-primary` a hundred lines up, so
                    a red heart here would have been a second, contradicting
                    answer to "what colour is a like on this platform", and one
                    the eslint rule audit-v6/no-raw-tailwind-colors exists to
                    catch. `fill-primary` is written out in full rather than
                    interpolated from REACTIONS because Tailwind scans source
                    text and never generates a class it cannot see.
                  */
                  <Heart
                    className={`h-[18px] w-[18px] transition-colors ${
                      comment.user_reaction
                        ? "fill-primary text-primary"
                        : "text-muted-foreground"
                    }`}
                    strokeWidth={1.9}
                  />
                )}
                </span>
              </button>
              {comment.like_count > 0 && (
                <span className="-mt-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {comment.like_count}
                </span>
              )}

              {/* The full picker, opened from the row menu's "React…" item. */}
              {reactionPickerId === comment.id && (
                <div
                  role="menu"
                  aria-label="Choose a reaction"
                  className="absolute right-0 top-full z-10 mt-1 flex gap-0.5 rounded-full border border-border bg-popover px-1.5 py-1 shadow-lg"
                >
                  {REACTIONS.map((r) => (
                    <button
                      key={r.type}
                      type="button"
                      title={r.label}
                      aria-label={r.label}
                      onClick={() => { onReact?.(comment.id, r.type); setReactionPickerId(null); }}
                      className="rounded-full p-1 text-base leading-none transition-transform hover:scale-125 hover:bg-muted motion-reduce:transition-none motion-reduce:hover:scale-100"
                    >
                      {r.emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
    <div className="px-3 py-2 relative">
      {/* Closes the reaction picker on an outside click/tap without a
          document-level listener — one transparent layer under the popover
          (which carries its own z-10) and above everything else in the thread. */}
      {reactionPickerId && (
        <div className="fixed inset-0 z-[5]" onClick={() => setReactionPickerId(null)} />
      )}

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

      {/* New comment input — omitted when the caller pins its own
          <CommentComposer> outside this thread's scroll area. */}
      {!hideComposer && currentUserId && (
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
