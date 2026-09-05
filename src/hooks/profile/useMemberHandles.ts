import { useEffect, useState } from "react";
import { fetchProfileMap } from "@/lib/profileMapCache";

/**
 * id -> name-URL handle, for lists whose own source cannot carry one.
 *
 * F-95 — THE FALLBACK, AND WHY IT IS NOT THE DESIGN.
 *
 * Nearly every profile link in the app now gets the handle in the same object
 * as the name, from the same round trip — that is the design, it costs nothing,
 * and it is what the rest of F-95 does. A few lists cannot, and the reason is a
 * lane boundary rather than a preference.
 *
 * ⚠ THIS EXISTS BECAUSE SEVEN RPCs DO NOT YET CARRY custom_url. Their
 * RETURNS TABLE shape names every column, and they live in supabase/, which is
 * not this lane's to change. Measured on the staging lane by the Auditor:
 *
 *   get_todays_birthdays                 member-facing (birthday strip/sidebar)
 *   get_feed_stories_bar                 member-facing (stories bar)
 *   admin_search_users                   AdminUsers.tsx
 *   admin_search_users_v2                AdminUsers.tsx
 *   admin_search_certificate_recipients  admin certificates
 *   search_profiles_admin                admin search
 *   get_profile_admin                    AdminCommentReports.tsx
 *
 * (An eighth, verify_staff_id, also lacks it and is discounted: it carries no
 * member id and is not a profile link.)
 *
 * D1 is widening these to carry the handle in the house v2 pattern. WHEN THEY
 * LAND, DELETE THIS MODULE — it is a bridge over a lane boundary, not an
 * architecture, and the list above is how you know the bridge is no longer
 * needed. It is deliberately one module with one call per list so that removal
 * is a small change and not an excavation.
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
