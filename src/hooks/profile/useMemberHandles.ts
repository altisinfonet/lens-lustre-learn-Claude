import { useEffect, useState } from "react";
import { fetchProfileMap } from "@/lib/profileMapCache";

/**
 * id -> name-URL handle, for lists whose own source cannot carry one.
 *
 * F-95 — THE FALLBACK, AND WHY IT IS NOT THE DESIGN.
 *
 * Nearly every profile link in the app gets the handle in the same object as
 * the name, from the same round trip — that is the design, it costs nothing,
 * and it is what the rest of F-95 does. This bridge fetches it separately for
 * lists whose own source cannot carry one.
 *
 * ⚠ F-98c, 2026-09-05 — THIS IS NOW ADMIN-ONLY, AND THE HEADER IT REPLACES WAS
 * BUILT ON A PREMISE THAT WAS FALSE.
 *
 * The old text listed seven RPCs and said D1 was "widening these to carry the
 * handle in the house v2 pattern", so the next person to read it would have
 * waited for a change that was never coming. The Auditor queried the staging
 * catalogue for every function in public whose RETURNS TABLE contains
 * full_name, found exactly those seven, and corrected himself in public: NOT
 * ONE of them carries custom_url, and `admin_search_users_v2` — the case the
 * pattern was inferred from — added total_count, not a handle. A suffix was
 * read as a shape instead of the signature being read.
 *
 * WHAT ACTUALLY FIXED THE MEMBER-FACING SURFACES was not this bridge. The
 * handle now travels WITH the name, from the server:
 *
 *   suggestions, milestones   dashboard-init/index.ts — Q11 select + both
 *                             object literals now carry custom_url
 *   birthdays                 get_todays_birthdays, dropped and recreated with
 *                             custom_url in migration 20260910_0013
 *   photographers             dashboard-init toVotingPhoto — photographer_handle
 *   winners                   dashboard-init winners — user_custom_url
 *
 * So the bridge was WITHDRAWN from FeedLeftSidebar, FeedRightSidebar,
 * FeedFriendSuggestions and TodaysBirthdayStrip rather than stacked on top of
 * the fix. Two mechanisms delivering one handle is how the two drift apart —
 * the same argument this codebase already made about author_badges — and the
 * Auditor ruled it out explicitly.
 *
 * WHAT IS LEFT, and it is a NAMED EXCEPTION rather than an oversight:
 *
 *   admin_search_users                   AdminUsers.tsx
 *   admin_search_users_v2                AdminUsers.tsx
 *   admin_search_certificate_recipients  admin certificates
 *   search_profiles_admin                admin search
 *   get_profile_admin                    AdminCommentReports.tsx
 *
 * These render names on ADMIN screens only and were placed out of scope of the
 * member-facing rule by the Auditor, and written down so nobody refiles them as
 * a new P0 in three weeks. See docs/evidence/d2/F-98c/NAMED_EXCEPTIONS.md.
 *
 * ONE MEMBER-FACING SOURCE IS STILL OPEN, awaiting the Owner and not this
 * module: get_feed_stories_bar has no custom_url either, and the story-ring
 * name at FeedStoriesBar.tsx:384 is a bare span inside a button that opens the
 * story. Whether a story ring should go to the story or to the profile is his
 * call, and it costs an RPC signature change either way. Same register.
 *
 * DELETE THIS MODULE when those five admin signatures carry the handle. It is a
 * bridge over a lane boundary, not an architecture.
 *
 * ONE BATCHED LOOKUP PER LIST, NEVER ONE PER LINK. It takes the whole set of
 * ids and asks profileMapCache once — the same batched entity cache everything
 * else already reads — so on a feed the ids are usually already cached from the
 * posts and it is often no request at all. A per-link resolver here would
 * reintroduce exactly the cost that was refused for ProfileLink, and it would
 * be worse, because these lists render in the feed. profileMapCache's own
 * header records the measurement: 52 requests per feed load became 4.
 */
export function useMemberHandles(ids: Array<string | null | undefined>): Map<string, string | null> {
  const [handles, setHandles] = useState<Map<string, string | null>>(new Map());
  // Sorted + deduped, so the effect depends on the SET of ids and not on the
  // array identity a parent re-render produces.
  const key = [...new Set(ids.filter((id): id is string => !!id))].sort().join(",");

  useEffect(() => {
    if (!key) { setHandles(new Map()); return; }
    let cancelled = false;
    void fetchProfileMap(key.split(",")).then((map) => {
      if (cancelled) return;
      const next = new Map<string, string | null>();
      map.forEach((entry, id) => next.set(id, entry.custom_url ?? null));
      setHandles(next);
    });
    return () => { cancelled = true; };
  }, [key]);

  return handles;
}
