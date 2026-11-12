// Asks the server what the signed-in member may be OFFERED (@followers / @all)
// and how many are left today — mention_groups_me() (20261113_0100). The server
// still decides at save time; this only keeps the list honest.
//
// Called by both @ lists when "@" is typed. One request per 30 s at most; a
// failure leaves the tags off (never offered wrongly).
import { supabase } from "@/integrations/supabase/client";
import { setGroupMentions } from "@/lib/groupMentions";

const FRESH_MS = 30_000;
let loadedAt = 0;
let inFlight: Promise<void> | null = null;

export function refreshGroupMentions(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < FRESH_MS) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc("mention_groups_me" as never);
      const d = (error ? null : data) as { on?: boolean; can_all?: boolean; all_left?: number; followers_left?: number } | null;
      setGroupMentions({
        on: d?.on === true,
        canAll: d?.can_all === true,
        allLeft: Number(d?.all_left ?? 0),
        followersLeft: Number(d?.followers_left ?? 0),
      });
    } catch {
      setGroupMentions({ on: false, canAll: false, allLeft: 0, followersLeft: 0 });
    } finally {
      loadedAt = Date.now();
      inFlight = null;
    }
  })();
  return inFlight;
}
