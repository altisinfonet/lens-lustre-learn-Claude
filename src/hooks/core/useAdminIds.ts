/**
 * The set of admin user ids, for rendering.
 *
 * Every surface in the app shows an admin as the brand — "50mm Retina World" —
 * rather than a real person's name. `resolveName()` in src/lib/adminBrand.ts is
 * how that is done, and it needs the id set.
 *
 * Notifications were the one place this was never applied: an admin's real
 * `full_name` appeared in the bell, on /notifications, and in the push message
 * body. This hook is what lets the notification surfaces apply the same rule.
 *
 * `getAdminIds()` already caches the answer for the session, so mounting this
 * in several places costs one query, not several.
 */
import { useEffect, useState } from "react";
import { getAdminIds } from "@/lib/adminBrand";

/**
 * Returns an empty set until the lookup resolves. That is the safe direction:
 * an admin briefly rendering under their own name is a cosmetic blip, whereas
 * blocking the whole list on this query would make notifications feel slow.
 */
export function useAdminIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    getAdminIds()
      .then((set) => {
        if (!cancelled) setIds(set);
      })
      .catch(() => {
        /* Brand substitution is a nicety; never break the list over it. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ids;
}

export default useAdminIds;
