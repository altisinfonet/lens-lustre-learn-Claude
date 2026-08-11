/**
 * The comment thread under a sponsored ad.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT PostCommentsSection
 *
 * PostCommentsSection reads post_comments, post_comment_reactions, pinning and
 * a post owner's moderation rights. An ad has no owner and no pinned comments,
 * and its rows live in different tables, so pointing that component at an ad
 * would have meant threading a "kind" through 565 lines that every post in the
 * feed also runs. This is the same thread, minus what an ad does not have:
 *
 *   * one level of replies, the depth the post thread actually renders
 *   * write, edit and delete your own
 *   * an admin may delete anybody's (RLS enforces it; this only draws it)
 *   * the SAME keyword blocklist, because the database attaches the SAME
 *     trigger function — see the migration
 *
 * No comment reactions and no pinning. Both are real features on a post; on an
 * advertiser's ad they are noise, and adding them later is additive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE COUNT COMES BACK FROM THE PARENT
 *
 * `onCountChange` re-runs the engagement RPC rather than incrementing a local
 * number. A comment can be refused by the blocklist trigger AFTER the optimistic
 * bump, and a number that says 4 above a list of 3 is worse than a number that
 * arrives a moment late.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MoreHorizontal, Pencil, Reply, Send, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { toast } from "@/hooks/core/use-toast";
import RichContentRenderer from "@/components/RichContentRenderer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type AdComment,
  addAdComment,
  deleteAdComment,
  editAdComment,
  fetchAdComments,
} from "@/lib/ads/adEngagement";

interface Props {
  creativeId: string;
  onCountChange?: () => void;
}

const timeAgo = (date: string) => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const Avatar = ({ src, name }: { src: string | null; name: string | null }) => (
  <span className="relative inline-block w-8 h-8 shrink-0">
    {src ? (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="w-8 h-8 rounded-full object-cover"
      />
    ) : (
      <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
        {(name || "?")[0]?.toUpperCase()}
      </span>
    )}
  </span>
);

const AdComments = ({ creativeId, onCountChange }: Props) => {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<AdComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await fetchAdComments(creativeId));
    setLoading(false);
  }, [creativeId]);

  useEffect(() => {
    load();
  }, [load]);

  const authorIds = useMemo(() => [...new Set(rows.map((r) => r.user_id))], [rows]);
  const { profileMap } = useProfileMap(authorIds);

  /** Top-level comments, each with its replies attached in time order. */
  const threaded = useMemo(() => {
    const tops = rows.filter((r) => !r.parent_id);
    const byParent = new Map<string, AdComment[]>();
    rows
      .filter((r) => r.parent_id)
      .forEach((r) => {
        const list = byParent.get(r.parent_id!) || [];
        list.push(r);
        byParent.set(r.parent_id!, list);
      });
    return tops.map((t) => ({ comment: t, replies: byParent.get(t.id) || [] }));
  }, [rows]);

  const submit = async (content: string, parentId: string | null) => {
    if (!user) {
      toast({ title: "Sign in to comment" });
      return;
    }
    if (busy) return;
    setBusy(true);
    const { error } = await addAdComment(creativeId, user.id, content, parentId);
    setBusy(false);
    if (error) {
      toast({ title: "Comment not posted", description: error, variant: "destructive" });
      return;
    }
    if (parentId) {
      setReplyInput("");
      setReplyTo(null);
    } else {
      setInput("");
    }
    await load();
    onCountChange?.();
  };

  const saveEdit = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const { error } = await editAdComment(id, editInput);
    setBusy(false);
    if (error) {
      toast({ title: "Comment not saved", description: error, variant: "destructive" });
      return;
    }
    setEditingId(null);
    setEditInput("");
    await load();
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const { error } = await deleteAdComment(id);
    setBusy(false);
    if (error) {
      toast({ title: "Comment not deleted", description: error, variant: "destructive" });
      return;
    }
    await load();
    onCountChange?.();
  };

  const Row = ({ c, isReply }: { c: AdComment; isReply: boolean }) => {
    const p = profileMap[c.user_id];
    const name = p?.full_name || "A member";
    const mine = user?.id === c.user_id;
    return (
      <div className={`flex gap-2.5 ${isReply ? "pl-10" : ""}`}>
        <Link to={`/profile/${c.user_id}`}>
          <Avatar src={p?.avatar_url ?? null} name={name} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              to={`/profile/${c.user_id}`}
              className="text-sm font-semibold hover:text-primary transition-colors truncate"
            >
              {name}
            </Link>
            <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(c.created_at)}</span>
            {c.updated_at !== c.created_at && (
              <span className="text-[11px] text-muted-foreground shrink-0">edited</span>
            )}
          </div>

          {editingId === c.id ? (
            <div className="mt-1 flex gap-2">
              <input
                value={editInput}
                onChange={(e) => setEditInput(e.target.value)}
                className="flex-1 bg-muted/40 rounded-full px-3 py-1.5 text-sm outline-none"
                autoFocus
              />
              <button
                onClick={() => saveEdit(c.id)}
                disabled={busy}
                className="text-xs font-semibold text-primary disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditingId(null);
                  setEditInput("");
                }}
                className="text-xs text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="text-sm text-foreground/90 break-words">
              <RichContentRenderer content={c.content} />
            </div>
          )}

          {editingId !== c.id && (
            <div className="mt-0.5 flex items-center gap-3">
              {!isReply && (
                <button
                  onClick={() => {
                    setReplyTo(replyTo === c.id ? null : c.id);
                    setReplyInput("");
                  }}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Reply className="h-3 w-3" /> Reply
                </button>
              )}
              {(mine || isAdmin) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Comment options"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    {mine && (
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingId(c.id);
                          setEditInput(c.content);
                        }}
                        className="py-2 cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => remove(c.id)}
                      className="py-2 cursor-pointer text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}

          {replyTo === c.id && (
            <div className="mt-2 flex gap-2">
              <input
                value={replyInput}
                onChange={(e) => setReplyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit(replyInput, c.id);
                }}
                placeholder={`Reply to ${name}…`}
                className="flex-1 bg-muted/40 rounded-full px-3 py-1.5 text-sm outline-none"
                autoFocus
              />
              <button
                onClick={() => submit(replyInput, c.id)}
                disabled={busy || !replyInput.trim()}
                aria-label="Post reply"
                className="text-primary disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="px-3 pt-1 pb-3 space-y-3">
      {loading && <div className="text-xs text-muted-foreground">Loading comments…</div>}

      {!loading && threaded.length === 0 && (
        <div className="text-xs text-muted-foreground">No comments yet.</div>
      )}

      {threaded.map(({ comment, replies }) => (
        <div key={comment.id} className="space-y-2">
          <Row c={comment} isReply={false} />
          {replies.map((r) => (
            <Row key={r.id} c={r} isReply />
          ))}
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(input, null);
          }}
          placeholder={user ? "Add a comment…" : "Sign in to comment"}
          disabled={!user}
          className="flex-1 bg-muted/40 rounded-full px-3.5 py-2 text-sm outline-none disabled:opacity-60"
        />
        <button
          onClick={() => submit(input, null)}
          disabled={!user || busy || !input.trim()}
          aria-label="Post comment"
          className="text-primary disabled:opacity-40"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default AdComments;
