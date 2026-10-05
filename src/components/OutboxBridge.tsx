/**
 * OFF-2 · starts the outbox for the signed-in member. Renders nothing.
 *
 * - Signed in: the outbox sends that member's queued actions now and whenever
 *   the network returns (outbox.ts listens to the browser and React Query).
 * - Signed out: the outbox stops; useAuth's SIGNED_OUT wipe deletes its items.
 * - A delivery from the queue (not one the member just watched go) refreshes the feed head (OFF-5 R1: drain, then refresh; R2: the
 *   server's counts replace the device's optimistic ones).
 * - A refusal of an item sent in the background is said out loud, once (OFF-5
 *   R3/R7: never silently lost). One sent while the member waits is reported
 *   by its own screen instead, so it is never told twice.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { startOutbox, stopOutbox, subscribeOutbox } from "@/lib/offline/outbox";
import { supabaseSender } from "@/lib/offline/outboxSender";
import { toast } from "@/hooks/core/use-toast";

export default function OutboxBridge() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) { stopOutbox(); return; }
    let refresh: ReturnType<typeof setTimeout> | null = null;
    const off = subscribeOutbox((e) => {
      if (e.type === "delivered" && !e.awaited) {
        if (refresh) clearTimeout(refresh);
        refresh = setTimeout(() => { void qc.invalidateQueries({ queryKey: ["feed"] }); }, 500);
      } else if (e.type === "failed" && !e.awaited) {
        toast({
          title: "1 action couldn't be sent",
          description: e.item.action.kind === "comment" ? "Your comment was not posted." : "The server refused it.",
          variant: "destructive",
        });
      }
    });
    startOutbox(userId, supabaseSender(supabase));
    return () => {
      off();
      if (refresh) clearTimeout(refresh);
      stopOutbox();
    };
  }, [qc, userId]);

  return null;
}
