import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startVisibilityInterval } from "@/lib/timers/visibilityInterval";

/**
 * STAGE L2 · "N NEW POSTS" — A LIGHT COUNT, NEVER A RELOAD.
 *
 * Every NEW_POSTS_POLL_MS while the feed is on screen (and once on returning to
 * it), ask for the ids of posts this member can see that were created after the
 * session's watermark (useFeedQuery's fetchWatermark), excluding their own. At
 * most NEW_POSTS_CAP rows; RLS decides visibility. Private posts are left out
 * (an admin can READ everyone's; the feed never deals them), and each row
 * carries its author so the caller can drop a blocked member's posts — the pill
 * must not promise what a refresh will not bring. Ids already in the feed are
 * subtracted by the caller. Nothing here touches the list: the pill shows the
 * number, and the new posts arrive only when the member pulls to refresh or
 * taps the pill.
 *
 * Why poll at all when `posts` realtime exists: realtime is in production's
 * publication but not staging's (read 2026-10-13), so a staging test of a
 * realtime-only pill would prove nothing about live. One query a minute, two
 * columns, usually zero rows, stopped while hidden (P10 — the one shared timer,
 * visibilityInterval.ts). Realtime still feeds the same pill on live, through
 * useNewPostsBanner.
 */
export const NEW_POSTS_POLL_MS = 60_000;
export const NEW_POSTS_CAP = 50;

export interface NewPostRef {
  id: string;
  user_id: string;
}

export function useNewPostsCount(opts: {
  userId: string | undefined;
  categories: string[] | null;
  /** The session's watermark; null/undefined disables the count. */
  watermark: string | null | undefined;
  /** Changes on every refresh; the count starts again from zero. */
  sessionKey: string | undefined;
}): NewPostRef[] {
  const { userId, watermark, sessionKey } = opts;
  const catsKey = opts.categories && opts.categories.length ? [...opts.categories].sort().join(",") : "";
  const [found, setFound] = useState<NewPostRef[]>([]);
  const catsRef = useRef(opts.categories);
  catsRef.current = opts.categories;

  useEffect(() => {
    setFound((prev) => (prev.length ? [] : prev));
    if (!userId || !watermark) return;
    let alive = true;
    const check = async () => {
      try {
        let q = supabase
          .from("posts")
          .select("id, user_id")
          .gt("created_at", watermark)
          .neq("user_id", userId)
          .neq("privacy", "private")
          .order("created_at", { ascending: false })
          .limit(NEW_POSTS_CAP);
        const cats = catsRef.current;
        if (cats && cats.length > 0) q = q.overlaps("categories", cats);
        const { data, error } = await q;
        if (!alive || error || !data) return;
        setFound((data as NewPostRef[]).map((r) => ({ id: r.id, user_id: r.user_id })));
      } catch {
        // A failed count is not shown; the next tick tries again.
      }
    };
    const stop = startVisibilityInterval(() => { void check(); }, NEW_POSTS_POLL_MS, { runOnResume: true });
    return () => { alive = false; stop(); };
  }, [userId, watermark, sessionKey, catsKey]);

  return found;
}
