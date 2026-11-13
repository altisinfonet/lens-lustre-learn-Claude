import { useEffect, useState } from "react";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { getAdminIds, resolveName } from "@/lib/adminBrand";
import { displayName } from "@/lib/displayName";

/**
 * A member's name, guaranteed by the component that shows it (Owner 13 Nov
 * 2026: "always name will show, not Photographer anymore, like META").
 *
 * The caller's name when it has one. When it has none (a record that arrived
 * without it, a dropped profile batch on a weak network), the name is asked
 * from the shared profile cache by member id — the same cache every surface
 * fills, which retries and is kept on the phone — and the official account is
 * named by the same brand rule (resolveName). null = not known YET: the caller
 * draws a grey name bar, never a made-up word.
 */
export function useMemberName(userId: string | null | undefined, name: string | null | undefined): string | null {
  const given = displayName(name);
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    setFound(null);
    if (given || !userId) return;
    let live = true;
    void Promise.all([fetchProfileMap([userId]), getAdminIds()])
      .then(([map, admins]) => {
        const n = displayName(resolveName(userId, map.get(userId)?.full_name ?? null, admins));
        if (live && n) setFound(n);
      })
      .catch(() => { /* the bar stays; the next render of this member asks again */ });
    return () => { live = false; };
  }, [userId, given]);
  return given || found;
}
