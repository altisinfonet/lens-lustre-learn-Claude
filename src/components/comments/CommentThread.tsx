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
import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import ProfileLink from "@/components/ProfileLink";
import OptimizedImage from "@/components/OptimizedImage";
import { Link } from "react-router-dom";
import { MoreHorizontal, Trash2, Flag, Ban, Pin, Pencil, ChevronDown, Heart, SmilePlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useOnline } from "@/lib/presence/online";
import { useT } from "@/i18n/I18nContext";
import MentionInput from "@/components/MentionInput";
import CommentComposer from "@/components/comments/CommentComposer";
import { toReplyTarget, useReplyTarget, type ReplyTarget } from "@/components/comments/replyTarget";
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
  /** A comment placed by the admin seeding tool: a small star beside the age, as image threads have always shown. */
  is_admin_seed?: boolean;
  /** OFF-2 · still on the device, waiting for the network (OFF-5 G4 "Pending" mark). */
  pending?: boolean;
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
  /**
   * Edit your own comment. Off on a photograph's thread: its moderation runs on
   * INSERT only (blocklist trigger, moderate-comment), so an edit would skip it.
   */
  editing?: boolean;
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
   * S4-b: the comment a notification points at. It is scrolled into the middle
   * of the thread once it has drawn and stays marked (Instagram's tinted row)
   * while the thread is open. Replies are always drawn, so a reply needs no
   * expanding first.
   */
  highlightId?: string | null;

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
  /** Block the comment's author (App Store guideline 1.2). Omit to hide the menu item. */
  onBlockUser?: (userId: string, name: string | null) => void;
  /**
   * Draw every reply open, with no "View N more replies" line. The comments
   * box sets it while a search is typed: a matching reply is kept WITH its
   * parent as context (src/lib/commentSearch.ts), and folding it away behind a
   * toggle would hide the very match the member searched for.
   */
  expandReplies?: boolean;
  /**
   * ONE REPLY FLOW (replyTarget.ts, Owner 10 Nov 2026). When the caller draws the
   * bottom box itself (`hideComposer`), it passes the comment being answered and
   * the setter: Reply calls `onReplyStart`, and that comment is softly
   * highlighted. Without them the thread's own bottom box does the same job.
   * There is no second box inside a comment any more.
   */
  replyTarget?: ReplyTarget | null;
  onReplyStart?: (target: ReplyTarget) => void;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COMPACT ROW — INSTAGRAM'S SPACING, WITH 44 px TARGETS THAT ARE INVISIBLE.
 *
 * Owner, 4 Nov 2026 (live, desktop side panel, "Mossy Roots"): *"this comment
 * section has huge gap from each comment / reply — follow Instagram style, more
 * compact"*. Measured on the real row (tools/uishot/comments-compact.mjs):
 * text → Reply 14 px and Reply → next comment 32 px, because the action row
 * was a real 44 px box (`h-11`, see the history kept below) with Reply's 16 px
 * of text centred in it, under an 8 px `py-2` on every row.
 *
 * The target spacing (Instagram): name + age, the text directly under it, one
 * small grey line "Reply" 4 px under the text, 16 px to the next comment, the
 * heart on the right, level with the name line (any comment length), its
 * count under it.
 *
 * WHERE THE 44 px WENT: into invisible ::after regions laid out on ONE rule, so
 * that no two of them ever claim the same pixel —
 *
 *   • the 16 px band BELOW a comment's meta line is owned by that line's
 *     controls (they reach 12 px down);
 *   • the meta line's controls reach 17 px UP into the comment's own text,
 *     which is not a control — and a mention / hashtag link in that text wins
 *     every contested pixel (`[&_a]:relative [&_a]:z-[1]` on the text), so
 *     F-109 (a region taking a link's pixels) cannot happen here;
 *   • the avatar reaches 4 px up and 8 px down inside its own column;
 *   • the heart is a real 44 × 44 box in its own column (the rail).
 *
 * Every number lives in the constants below, which the geometry test reads by
 * measuring the real page in Chromium, Firefox and WebKit, web and app.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/** Reply / menu / avatar regions are transparent, out of flow, and move nothing. */
const HIT = "relative after:absolute after:content-['']";
/** Reply: 16 px tall line → 45 px (17 up into the text, 12 down), at least 44 px wide.
 *  17, not 16 (comments v3, 10 Nov): 14px × 1.4 text leaves sub-pixel line
 *  positions and Firefox snapped the region to 43.5 px; the extra px is the
 *  comment's own text, never another control. */
const META_HIT = `${HIT} after:-top-[17px] after:-bottom-3 after:-start-1.5 after:-end-1.5 after:min-w-[44px]`;
/** The row menu's dots: 16 × 16 → 44 × 44, reaching back over the dots' gap, never into the heart's column. */
const MENU_HIT = `${HIT} after:-top-[17px] after:-bottom-3 after:-start-4 after:-end-3`;
/** Avatar 32 → 44 (24 → 44 on a reply): 4 px up (the free strip of the gap), the rest down its own column. */
const AVATAR_HIT = `${HIT} after:-top-1 after:-bottom-2 after:-start-1.5 after:-end-1.5`;
const AVATAR_HIT_XS = `${HIT} after:-top-1 after:-bottom-4 after:-start-2.5 after:-end-2.5`;

/** Every reply under a comment, however deep — what "View N more replies" counts. */
const countReplies = (c: ThreadComment): number =>
  c.replies.reduce((n, r) => n + 1 + countReplies(r), 0);
const containsId = (list: ThreadComment[], id: string): boolean =>
  list.some((r) => r.id === id || containsId(r.replies, id));

/**
 * Exported so CommentComposer.tsx can draw the same avatar beside the
 * top-level composer when the composer is rendered OUTSIDE this component
 * (see `hideComposer` below) — one avatar treatment, not two.
 */
export const Avatar = ({
  src,
  name,
  size = "sm",
  userId,
}: {
  src: string | null | undefined;
  name: string | null | undefined;
  size?: "xs" | "sm";
  userId?: string | null;
}) => {
  const cls = size === "xs" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
  /* P1 §4: live presence keyed on the commenter's id. */
  const online = useOnline(userId);
  return (
    <span className={`relative inline-block ${cls}`}>
      {src ? (
        // alt = the name: the avatar is the only content of its profile link, so
        // an empty alt left that link with no name (axe link-name, 10 Nov).
        <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={src} alt={name ?? ""} className={`${cls} rounded-full object-cover`} />
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
  onBlockUser,
  highlightId = null,
  expandReplies = false,
  replyTarget: externalReplyTarget,
  onReplyStart,
}: CommentThreadProps) => {
  // The thread's own bottom box answers comments when the caller has none.
  const ownReply = useReplyTarget();
  const activeReply = onReplyStart ? externalReplyTarget ?? null : ownReply.target;
  const startReply = onReplyStart ?? ownReply.start;
  const t = useT();
  const canReact = features?.reactions ?? true;
  const canPinHere = (features?.pinning ?? true) && canPin;
  const canReport = features?.reporting ?? true;
  const canSort = features?.sorting ?? true;
  const canEdit = features?.editing ?? true;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [sortMode, setSortMode] = useState<"relevant" | "newest">("relevant");
  /** Which comment's emoji-reaction popover is open, if any. One at a time. */
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  /**
   * The member's own open / closed choice per top-level comment ("View N more
   * replies" / "Hide replies"). A comment with no choice yet is closed, unless
   * a notification points into its replies (then it starts open).
   */
  const [repliesChoice, setRepliesChoice] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const setRepliesOpen = (id: string, open: boolean) =>
    setRepliesChoice((prev) => {
      if (prev.get(id) === open) return prev;
      const next = new Map(prev);
      next.set(id, open);
      return next;
    });

  // S4-b: bring the highlighted comment into view ONCE, when it has drawn.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId || loading || scrolledTo.current === highlightId) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(highlightId)}"]`);
    if (!el) return;
    scrolledTo.current = highlightId;
    el.scrollIntoView({ block: "center" });
  });

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

  /** The thread's own bottom box (CommentComposer) posts through here. */
  const submitComment = async (text: string, parentId: string | null) => {
    if (!currentUserId || submitting) return;
    // The member's own new reply must be in view, not folded behind "View replies".
    if (parentId) setRepliesOpen(parentId, true);
    // Only a surface that explicitly reports failure gets the text back (the
    // composer restores it); the post path resolves undefined.
    return onAdd(text, parentId);
  };

  /** Reply tapped: hand the comment to the ONE bottom box and open its replies. */
  const replyToComment = (comment: ThreadComment, depth: number) => {
    if (depth === 0) setRepliesOpen(comment.id, true);
    startReply(toReplyTarget(comment));
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
    const canReply = !!currentUserId && depth < maxReplyDepth;
    const hasMenu = !!currentUserId && (isOwn || canDelete || canPinHere || canReport || (canReact && !!onReact) || (!!onBlockUser && !isOwn));
    /*
     * The meta line only takes up room when something on it shows. Without Reply
     * (a reply at the depth limit, a signed-out reader) the ⋯ is all it holds,
     * and from md up that stays hidden until hover: a reserved line there is 20 px
     * of empty gap under the comment, the "huge gap" of the Owner's 4 Nov report.
     */
    const metaLine = canReply
      ? "mt-1 h-4 items-center"
      : hasMenu ? "items-start md:h-0 max-md:mt-1 max-md:h-4 max-md:items-center" : "h-0";
    const replyCount = depth === 0 ? countReplies(comment) : 0;
    // A reply is drawn when its top-level comment is open — by the member, by a
    // search, or because a notification points INTO this thread (S4-b: the
    // highlighted reply must be on screen, never folded away).
    const repliesShown =
      depth > 0 ||
      expandReplies ||
      (repliesChoice.get(comment.id) ?? (!!highlightId && containsId(comment.replies, highlightId)));

    return (
      // The key belongs HERE: the call sites are function calls and a call
      // cannot carry a key. Without it React re-uses the wrong node when a
      // comment is deleted mid-list.
      //
      // `ms-comment-indent` (tokens.ts) = the parent's avatar (32) + its gap (12): a reply's avatar
      // starts exactly under the text it answers. Logical, so RTL mirrors it.
      <div key={comment.id} data-comment-block="" className={depth > 0 ? "ms-comment-indent mt-3" : ""}>
        <div
          data-comment-id={comment.id}
          data-comment-row=""
          data-highlighted={comment.id === highlightId ? "true" : undefined}
          data-replying={comment.id === activeReply?.id ? "true" : undefined}
          // #509 review: the mark is not colour alone — assistive tech hears it too.
          aria-current={comment.id === highlightId ? "true" : undefined}
          className={`flex gap-3 group/comment ${comment.id === highlightId || comment.id === activeReply?.id ? "-mx-2 -my-1.5 px-2 py-1.5 rounded-md bg-primary/10" : ""}`}
        >
          <ProfileLink
            userId={comment.user_id}
            handle={comment.author_handle}
            className={`shrink-0 self-start flex min-w-8 justify-center ${depth > 0 ? AVATAR_HIT_XS : AVATAR_HIT}`}
          >
            <Avatar src={comment.author_avatar} name={comment.author_name} size={depth > 0 ? "xs" : "sm"} userId={comment.user_id} />
          </ProfileLink>
          <div className="flex-1 min-w-0">
            {/* Editing mode */}
            {editingId === comment.id ? (
              <div className="flex gap-2 items-end">
                <MentionInput
                  value={editInput}
                  onChange={setEditInput}
                  onSubmit={() => saveEdit(comment.id)}
                  placeholder={t("cmt.phEdit", "Edit comment...")}
                  disabled={editSubmitting}
                  maxLength={maxLength}
                  autoFocus
                  className="bg-muted rounded-2xl px-3 py-2 text-sm"
                />
                <button onClick={() => { setEditingId(null); setEditInput(""); }} className="text-xs text-muted-foreground hover:text-foreground mb-2">
                  {t("common.cancel", "Cancel")}
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
                    <span className="shrink-0 text-[11px] italic text-muted-foreground">{t("cmt.edited", "Edited")}</span>
                  )}
                  {comment.pending && (
                    <span className="shrink-0 text-[11px] text-muted-foreground" data-testid="comment-pending">Pending</span>
                  )}
                  {comment.is_admin_seed && <span className="shrink-0 text-xs text-primary/70">★</span>}
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
                {/* `[&_a]:relative [&_a]:z-[1]`: a mention or hashtag link in the
                    text sits ABOVE the Reply / menu regions that reach up into
                    the text, so a link never loses a pixel to them (F-109). */}
                {/* Compact (Owner 10 Nov): 14px text on a 1.4 line, under the 13px name. */}
                <p className="text-[14px] leading-[1.4] text-foreground whitespace-pre-wrap break-words [&_a]:relative [&_a]:z-[1]">
                  <RichContentRenderer content={comment.content} />
                </p>

                {/*
                  HISTORY — SUPERSEDED 4 Nov 2026 by "THE COMPACT ROW" at the top
                  of this file. The real 44 px row below was the cause of the
                  Owner's "huge gap": 14 px of empty box above Reply and 14 px
                  under it. The lesson kept from it: a hit region must never
                  claim a neighbour's pixels — hence the one ownership rule.

                  ⚠ REAL 44px CONTROLS. `.tap-44-down` WAS TRIED HERE AND
                  MEASURED WRONG — THIS IS THE SECOND ANSWER, NOT THE FIRST.

                  Reply and the overflow menu paint 33x16 and 18x18, under the
                  gate's floor (long >= 44, short >= 32). They are not new:
                  they carry the same geometry on staging. This unit is the
                  first thing to PHOTOGRAPH the comments panel, and capture.mjs
                  counts a new scene's tap-target errors toward its exit code,
                  so measuring them made them ours to clear.

                  THE FIRST ATTEMPT WAS `.tap-44-down`, and it was chosen from a
                  half-measurement. elementFromPoint 8px above each control
                  returns the comment body — text full of @mention LINKS — so a
                  symmetric `.tap-44` was correctly ruled out by F-109. What was
                  NOT checked was the other direction, and `.tap-44-down` grows
                  44px DOWNWARD from the control's top while Reply is the LAST
                  thing in its row. Measured once tap-target-geometry.mjs was
                  taught to read hit regions instead of painted boxes:

                    OVERLAP with "Framo Grapher" over 49.4x12.0
                    OVERLAP with "Somnath Roy"   over 43.7x10.0
                    two hit regions intersect    over 32.0x10.0, 32.0x9.0

                  The region reached into the NEXT comment's author-name link —
                  F-109 again, one direction over. And the sweep still passed it,
                  because capture.mjs measures SIZE and never overlap: it would
                  have shipped green.

                  A real box cannot do this. `h-11` reserves its 44px in the
                  row, so nothing can be taken from a neighbour — the same
                  conclusion TodaysBirthdayStrip reached on 2026-09-07, where
                  `h-11 w-11` replaced a `.tap-44` that "satisfied a thumb and
                  was invisible to the instrument". Reply needs only the HEIGHT
                  (32.7px wide already clears the 32px short side); the menu
                  needs both axes. The cost is an action row 44px tall instead
                  of 16px, and that cost is the honest price of the fix.

                  `gap-4` is back: the widened gap existed solely to keep two
                  invisible regions from colliding, and there are none now.
                */}
                {/* Action row. The timestamp moved UP to the identity line and
                    Like moved OUT to the heart rail on the right, so what is
                    left here is Reply and the overflow menu — and the row no
                    longer competes with the comment text for attention. */}
                {/* THE META LINE — one small grey line 4 px under the text,
                    16 px tall. Its controls' 44 px lives in META_HIT / MENU_HIT
                    (invisible), not in the line's height. */}
                <div data-comment-meta="" className={`flex gap-4 text-xs font-semibold leading-4 text-muted-foreground ${metaLine}${canReact ? "" : " pe-3"}`}>
                  {canReply && (
                    <button
                      type="button"
                      onClick={() => replyToComment(comment, depth)}
                      className={`${META_HIT} flex h-4 items-center rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
                    >
                      {t("cmt.reply", "Reply")}
                    </button>
                  )}

                  {/* 3-dot menu — at the END of the line, so its region never
                      meets "View N more replies" under the text's start. */}
                  {hasMenu && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Comment options"
                          className={`${MENU_HIT} ms-auto flex h-4 w-4 items-center justify-center rounded-sm opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/comment:opacity-100 md:opacity-0 max-md:opacity-100`}
                        >
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
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
                        {/* Only where the surface can STORE a chosen type —
                            the article / entry thread writes "like" alone. */}
                        {canReact && !!onReact && (
                          <DropdownMenuItem
                            onClick={() => setReactionPickerId(comment.id)}
                            className="cursor-pointer"
                          >
                            <SmilePlus className="mr-2 h-3.5 w-3.5" /> React…
                          </DropdownMenuItem>
                        )}
                        {isOwn && canEdit && (
                          <DropdownMenuItem onClick={() => { setEditingId(comment.id); setEditInput(comment.content); }} className="cursor-pointer">
                            <Pencil className="h-3.5 w-3.5 mr-2" /> {t("cmt.edit", "Edit")}
                          </DropdownMenuItem>
                        )}
                        {canPinHere && depth === 0 && (
                          <DropdownMenuItem onClick={() => onTogglePin?.(comment.id)} className="cursor-pointer">
                            <Pin className="h-3.5 w-3.5 mr-2" /> {comment.is_pinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem onClick={() => onDelete(comment.id, comment.parent_id)} className="cursor-pointer text-destructive focus:text-destructive">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("common.delete", "Delete")}
                          </DropdownMenuItem>
                        )}
                        {canReport && !isOwn && (
                          <DropdownMenuItem onClick={() => { setReportingId(comment.id); setReportReason(""); }} className="cursor-pointer text-destructive focus:text-destructive">
                            <Flag className="h-3.5 w-3.5 mr-2" /> {t("cmt.report", "Report")}
                          </DropdownMenuItem>
                        )}
                        {onBlockUser && !isOwn && (
                          <DropdownMenuItem onClick={() => onBlockUser(comment.user_id, comment.author_name)} className="cursor-pointer text-destructive focus:text-destructive">
                            <Ban className="h-3.5 w-3.5 mr-2" /> Block member
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
                      className="overflow-hidden mt-3 ms-1"
                    >
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {REPORT_REASONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setReportReason(r)}
                            className={`text-[10px] px-2 py-1 border rounded-md transition-all ${reportReason === r ? "border-destructive text-destructive bg-destructive/5 font-medium" : "border-border text-muted-foreground hover:border-muted-foreground/50"}`}
                          >
                            {t("cmt.r." + r, r)}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => submitReport(comment.id)} disabled={!reportReason} className="text-[10px] px-3 py-1 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50">
                          {t("dash.submit", "Submit")}
                        </button>
                        <button onClick={() => { setReportingId(null); setReportReason(""); }} className="text-[10px] px-3 py-1 border border-border rounded-md text-muted-foreground">
                          {t("common.cancel", "Cancel")}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* No reply box here any more: Reply hands this comment to the
                    ONE bottom box ("Replying to …"), see replyTarget.ts. */}
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
            <div data-comment-heart-rail="" className="relative flex shrink-0 self-start">
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
                /*
                  4 Nov 2026 (compact row): the heart sits at the TOP, level with
                  the NAME line, for every comment length (Owner, reviewing a
                  long comment: "for long comments you moved the reactions —
                  that is wrong"; Instagram does the same). `self-start` on
                  the rail, the 24 px circle first in the box, and `-mt-1`
                  lifts the box 4 px into the free strip above the row so the
                  circle's centre meets the name line's centre (checked to
                  ±2 px by tools/uishot/comments-compact.mjs). The count sits
                  INSIDE the 44 × 44 box, tiny, under the circle. Square
                  corners on purpose: browsers hit-test border-radius, and a
                  rounded box gave its corner pixels to the rail (measured).
                */
                className="group/heart -mt-1 flex h-11 w-11 flex-col items-center justify-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-150 group-hover/heart:bg-muted/50 group-active/heart:scale-90 motion-reduce:transition-none motion-reduce:group-active/heart:scale-100">
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
                    className={`h-4 w-4 transition-colors ${
                      comment.user_reaction
                        ? "fill-primary text-primary"
                        : "text-muted-foreground"
                    }`}
                    strokeWidth={1.9}
                  />
                )}
                </span>
                {comment.like_count > 0 && (
                  <span data-comment-like-count="" className="text-[11px] font-semibold leading-3 tabular-nums text-muted-foreground">
                    {comment.like_count}
                  </span>
                )}
              </button>

              {/* The full picker, opened from the row menu's "React…" item. */}
              {reactionPickerId === comment.id && (
                <div
                  role="menu"
                  aria-label="Choose a reaction"
                  className="absolute end-0 top-full z-10 mt-1 flex gap-0.5 rounded-full border border-border bg-popover px-1.5 py-1 shadow-lg"
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

        {/*
          "—— View N more replies" / "—— Hide replies" — Instagram's line, under
          the comment's text column, and it STAYS here when the replies open
          below it, so the member's finger finds it in the same place.

          Its region (comments v3, 10 Nov — gaps are 12 px now):
           • `::before` = the whole button + 12 px DOWN, exactly the gap under
             it (16 px took 4 px of the first reply's name);
           • `::after`  = over the WORDS only (from 44 px in), 16 px UP + 12
             DOWN = 44 px — 12 px of gap plus 4 px of the Reply row's empty
             middle. The strip above the dash belongs to Reply's region, and the
             words start past Reply's 44 px, so the two never claim one pixel.
             `::after` is the region the size gates read (capture.mjs: ≥ 32).
        */}
        {depth === 0 && replyCount > 0 && !expandReplies && (
          <button
            type="button"
            data-comment-replies-toggle=""
            aria-expanded={repliesShown}
            onClick={() => setRepliesOpen(comment.id, !repliesShown)}
            className={`${HIT} after:start-11 after:end-0 after:-top-4 after:-bottom-3 before:absolute before:content-[''] before:inset-x-0 before:top-0 before:-bottom-3 ms-comment-indent mt-3 flex h-4 items-center gap-5 rounded-sm text-xs font-semibold leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
          >
            <span aria-hidden="true" className="h-px w-6 shrink-0 bg-muted-foreground/60" />
            <span>
              {repliesShown
                ? t("cmt.hideReplies", "Hide replies")
                : replyCount === 1
                  ? t("cmt.viewOneReply", "View 1 more reply")
                  : t("cmt.viewReplies", "View {n} more replies").replace("{n}", String(replyCount))}
            </span>
          </button>
        )}

        {/* Replies */}
        {repliesShown && comment.replies.map((reply) => (
          renderComment(reply, depth + 1)
        ))}
      </div>
    );
  };

  const totalCount = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  return (
    <div ref={rootRef} className="px-3 py-2 relative">
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
              <button className="flex h-11 items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                {sortMode === "relevant" ? t("cmt.mostRelevant", "Most relevant") : t("cmt.newestFirst", "Newest first")}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => setSortMode("relevant")} className="cursor-pointer text-xs">
                {t("cmt.mostRelevant", "Most relevant")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("newest")} className="cursor-pointer text-xs">
                {t("cmt.newestFirst", "Newest first")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Comments */}
      {loading ? (
        <div className="text-sm text-muted-foreground animate-pulse py-4 text-center">Loading comments…</div>
      ) : (
        <div data-comment-list="" className="flex flex-col gap-3">
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
        <CommentComposer
          className="pt-2 pb-1"
          currentUserId={currentUserId}
          viewer={viewer}
          submitting={submitting}
          maxLength={maxLength}
          placeholder={composerPlaceholder}
          replyTo={ownReply.target}
          onCancelReply={ownReply.cancel}
          onSubmit={submitComment}
        />
      )}
    </div>
  );
};

/** One comment as the floating list needs it (story_comments_list rows fit). */
export interface FloatComment {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  content: string;
}

/**
 * The floating comment list (Stories v2, Owner-approved 6 Nov 2026: comments
 * float over a story like Facebook Live). Read-only: no replies, actions or
 * composer — the full thread of a post story stays under the post. Drawn here
 * so every comment row still has one home (C3).
 *
 * Owner 7 Nov ("700 comments, how to see?"): it scrolls up and down; the
 * story viewer passes the scroll / touch handlers (`on`) that load older ones
 * and keep a scroll from swiping the story away. `tall` = the "All comments"
 * panel. Newest stays at the bottom (column-reverse starts scrolled there).
 */
export function CommentFloatList({ comments, tall, on }: { comments: FloatComment[]; tall?: boolean; on?: HTMLAttributes<HTMLDivElement> }) {
  if (comments.length === 0) return null;
  return (
    <div {...on}
      className={`flex flex-col-reverse gap-2 overflow-y-auto overscroll-contain ${tall ? "max-h-full" : "max-h-[148px] [mask-image:linear-gradient(to_bottom,transparent,black_30%)]"}`}
    >
      {[...comments].reverse().map((c) => (
        <div key={c.id} className="flex items-start gap-2">
          {c.avatar_url ? (
            <OptimizedImage loading="eager" src={c.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-white/25" />
          )}
          <p className="max-w-[80%] rounded-2xl bg-black/45 px-3 py-1.5 text-[13px] leading-snug backdrop-blur-sm">
            <span className="font-semibold">{c.full_name || "Member"}</span> {c.content}
          </p>
        </div>
      ))}
    </div>
  );
}

export default CommentThread;
