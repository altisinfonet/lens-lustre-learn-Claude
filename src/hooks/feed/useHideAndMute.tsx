/**
 * S12-F5 (Extras A + D UI) · "Not interested" and "Mute <name>" from a post's
 * ⋯ menu.
 *
 * The record goes through the OFF-2 outbox (hidePost / muteAuthor in
 * feedSignals.ts — kept on the device first, sent exactly once). The card goes
 * at once, with an Undo in the toast: Undo sends the opposite intent
 * (unhidePost / unmuteAuthor); if the first one has not left the device yet,
 * the outbox replaces it (last intent wins), so nothing is sent at all.
 *
 * What is hidden on screen lives in this module, not in the feed component:
 * the feed remounts on Back (sibling routes) and a hidden card must not come
 * back from the cache. A different member starts from nothing. The server
 * excludes both from every later page (get_personal_feed / get_following_feed /
 * get_favourites_feed read feed_hidden_posts and feed_muted_authors).
 */
import { useCallback, useReducer, useEffect } from "react";
import { toast } from "@/hooks/core/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { hidePost, muteAuthor, unhidePost, unmuteAuthor } from "@/lib/feed/feedSignals";

let member: string | null = null;
const hiddenPosts = new Set<string>();
const mutedAuthors = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function forMember(userId: string | null | undefined) {
  if ((userId ?? null) !== member) {
    member = userId ?? null;
    hiddenPosts.clear();
    mutedAuthors.clear();
  }
}

/** Muted from the ⋯ menu this session (its outbox item may not have left the device yet). */
export function mutedThisSession(authorId: string): boolean {
  return mutedAuthors.has(authorId);
}

/** Unmuted elsewhere (the member's profile): the feed shows their posts again. */
export function forgetMute(authorId: string): void {
  if (mutedAuthors.delete(authorId)) changed();
}

/** Tests only. */
export function __resetHideAndMute() {
  member = null;
  hiddenPosts.clear();
  mutedAuthors.clear();
}

const refused = () => toast({ title: "Couldn't save that — try again", variant: "destructive" });

export interface HideablePost { id: string; user_id: string; author_name?: string | null }

export function useHideAndMute(userId: string | null | undefined) {
  forMember(userId);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);

  const unhide = useCallback((postId: string) => {
    hiddenPosts.delete(postId);
    changed();
    void unhidePost(userId, postId).catch(refused);
  }, [userId]);

  const notInterested = useCallback((post: HideablePost) => {
    if (!userId || post.user_id === userId) return;
    hiddenPosts.add(post.id);
    changed();
    void hidePost(userId, post.id, "not_interested").catch(() => {
      hiddenPosts.delete(post.id);
      changed();
      refused();
    });
    toast({
      title: "Post hidden",
      description: "You'll see fewer posts like this.",
      action: (
        <ToastAction altText="Undo" onClick={() => unhide(post.id)} data-testid="toast-undo-hide">
          Undo
        </ToastAction>
      ),
    });
  }, [userId, unhide]);

  const unmute = useCallback((authorId: string) => {
    mutedAuthors.delete(authorId);
    changed();
    void unmuteAuthor(userId, authorId).catch(refused);
  }, [userId]);

  const mute = useCallback((post: HideablePost) => {
    if (!userId || post.user_id === userId) return;
    const name = post.author_name?.trim() || "this member";
    mutedAuthors.add(post.user_id);
    changed();
    void muteAuthor(userId, post.user_id).catch(() => {
      mutedAuthors.delete(post.user_id);
      changed();
      refused();
    });
    toast({
      title: `Muted ${name}`,
      description: "You won't see their posts. Unmute any time on their profile.",
      action: (
        <ToastAction altText="Undo" onClick={() => unmute(post.user_id)} data-testid="toast-undo-mute">
          Undo
        </ToastAction>
      ),
    });
  }, [userId, unmute]);

  // A new function every render on purpose: a list memoised on it recomputes
  // whenever something is hidden or brought back.
  const isHidden = (post: { id: string; user_id: string }) => hiddenPosts.has(post.id) || mutedAuthors.has(post.user_id);

  return { notInterested, mute, isHidden };
}
