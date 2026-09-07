/**
 * The comment thread under a sponsored ad — the ADAPTER, and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE USED TO BE, AND WHY IT IS NOT THAT ANY MORE
 *
 * 405 lines: a second comment thread, hand-copied from PostCommentsSection's,
 * opening with a long paragraph justifying the copy. The justification was
 * about the DATA — an ad has no owner, no pinned comments, and its rows live in
 * different tables — and all of that is still true. None of it was ever a
 * reason to draw a second comment row.
 *
 * The copy rotted exactly as a copy does. Its list said
 *
 *     renderRow(comment, false)
 *
 * with no braces around it, so React printed the call as literal text and a
 * member reading 'What is the awarding criteria ?' saw the words
 * `renderRow(comment, false)` instead. The reply one line below it, inside a
 * `.map()`, was correct — which is why nobody spotted it in review. The post
 * thread never had the bug and could not have caught it.
 *
 * So the drawing is now src/components/comments/CommentThread.tsx, shared with
 * the post card, and what is left here is the mapping this surface actually
 * needs: ad_creative_comments rows in, the thread's shape out; the thread's
 * callbacks in, src/lib/ads/adEngagement.ts writes out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE AD THREAD DOES NOT HAVE
 *
 *   * comment reactions — there is no ad_creative_comment_reactions table
 *   * pinning — nobody owns an advertisement, so nobody may pin on it
 *   * per-comment reporting from the row menu — a flagged ad comment reaches
 *     the SAME admin queue, but through the blocklist trigger in the migration,
 *     not through a member-facing Report button
 *   * a sort selector — an ad thread is short and ordered by time
 *
 * These are passed as `features`, so they are absences this file states out
 * loud rather than differences in a second implementation. Adding any of them
 * later is a table and one flag.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE COUNT COMES BACK FROM THE PARENT
 *
 * `onCountChange` re-runs the engagement RPC rather than incrementing a local
 * number. A comment can be refused by the blocklist trigger AFTER an optimistic
 * bump, and a number that says 4 above a list of 3 is worse than a number that
 * arrives a moment late.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { toast } from "@/hooks/core/use-toast";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import CommentThread, { type ThreadComment } from "@/components/comments/CommentThread";
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

/**
 * The ad thread is ONE level deep. `fetchAdComments` returns a flat list and
 * this groups replies under their top-level parent; a reply to a reply would
 * have nowhere to be drawn, which is why CommentThread is told the same depth.
 */
const AD_MAX_REPLY_DEPTH = 1;

const AdComments = ({ creativeId, onCountChange }: Props) => {
  const { user } = useAuth();
  const { data: currentProfile } = useProfileCore(user?.id);
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<AdComment[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [fetched, admins] = await Promise.all([fetchAdComments(creativeId), getAdminIds()]);
    setRows(fetched);
    setAdminIds(admins);
    setLoading(false);
  }, [creativeId]);

  useEffect(() => {
    load();
  }, [load]);

  const authorIds = useMemo(() => [...new Set(rows.map((r) => r.user_id))], [rows]);
  const { profileMap } = useProfileMap(authorIds);

  /** ad_creative_comments rows in the shape the shared thread draws. */
  const comments = useMemo<ThreadComment[]>(() => {
    const toThread = (r: AdComment): ThreadComment => ({
      id: r.id,
      user_id: r.user_id,
      content: r.content,
      created_at: r.created_at,
      updated_at: r.updated_at,
      parent_id: r.parent_id,
      // An ad has no owner and so no pinned comments, and no comment reactions.
      is_pinned: false,
      like_count: 0,
      is_liked: false,
      author_name: resolveName(r.user_id, profileMap[r.user_id]?.full_name ?? null, adminIds),
      author_avatar: profileMap[r.user_id]?.avatar_url ?? null,
      author_handle: profileMap[r.user_id]?.custom_url ?? null,
      author_badges: resolveBadges(r.user_id, profileMap[r.user_id]?.badges || [], adminIds),
      author_last_active: profileMap[r.user_id]?.last_active_at ?? null,
      replies: [],
    });

    const byParent = new Map<string, ThreadComment[]>();
    rows
      .filter((r) => r.parent_id)
      .forEach((r) => {
        const list = byParent.get(r.parent_id!) || [];
        list.push(toThread(r));
        byParent.set(r.parent_id!, list);
      });

    return rows
      .filter((r) => !r.parent_id)
      .map((r) => ({ ...toThread(r), replies: byParent.get(r.id) || [] }));
  }, [rows, profileMap, adminIds]);

  const add = async (content: string, parentId: string | null): Promise<boolean> => {
    if (!user) {
      toast({ title: "Sign in to comment" });
      return false;
    }
    if (busy) return false;
    setBusy(true);
    const { error } = await addAdComment(creativeId, user.id, content, parentId);
    setBusy(false);
    if (error) {
      toast({ title: "Comment not posted", description: error, variant: "destructive" });
      return false;
    }
    await load();
    onCountChange?.();
    return true;
  };

  const edit = async (id: string, content: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const { error } = await editAdComment(id, content);
    setBusy(false);
    if (error) {
      toast({ title: "Comment not saved", description: error, variant: "destructive" });
      return false;
    }
    await load();
    return true;
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

  return (
    <CommentThread
      comments={comments}
      loading={loading}
      currentUserId={user?.id ?? null}
      viewer={currentProfile}
      isAdmin={isAdmin}
      submitting={busy}
      editSubmitting={busy}
      /* ad_creative_comments_length CHECK (length(content) <= 2000) — the box
         must not accept what the database will refuse. */
      maxLength={2000}
      emptyLabel="No comments yet."
      features={{ reactions: false, pinning: false, reporting: false, sorting: false }}
      maxReplyDepth={AD_MAX_REPLY_DEPTH}
      onAdd={add}
      onEdit={edit}
      onDelete={remove}
    />
  );
};

export default AdComments;
