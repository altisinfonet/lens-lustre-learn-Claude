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
import { logger } from "@/lib/logger";

function describeError(e: unknown): string {
  const x = e as { code?: string; message?: string } | null;
  return [x?.code, x?.message].filter(Boolean).join(" ").slice(0, 200) || String(e).slice(0, 200);
}

export default function OutboxBridge() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) { stopOutbox(); return; }
    let refresh: ReturnType<typeof setTimeout> | null = null;
    const off = subscribeOutbox((e) => {
      /**
       * Stage L2 · feed_events ("seen") is ranking telemetry, not a member's
       * action. Its delivery must not refetch the feed — that would re-deal the
       * list under the member's thumb every time a seen-batch lands — and its
       * refusal (the hourly rate limit, a deleted post) is not something the
       * member did or can fix, so it is logged, never toasted.
       * S12-F1 · feed_signals (time on post, skips, watch %, share clicks,
       * profile visits) is the same kind of telemetry: same treatment.
       */
      if (e.type !== "changed" && e.item.action.kind === "feed_signals") {
        if (e.type === "failed") {
          logger.warn({
            code: "DB-3009",
            event: "FEED_SIGNALS_DROPPED",
            fn: "OutboxBridge",
            file: "src/components/OutboxBridge.tsx",
            message: "A batch of feed signals was refused by the server and dropped.",
            reason: describeError(e.error),
            userId,
            detail: { signals: e.item.action.signals.length, attempts: e.item.attempts },
          });
        }
        return;
      }
      if (e.type !== "changed" && e.item.action.kind === "feed_events") {
        if (e.type === "failed") {
          logger.warn({
            code: "DB-3008",
            event: "FEED_SEEN_EVENTS_DROPPED",
            fn: "OutboxBridge",
            file: "src/components/OutboxBridge.tsx",
            message: "A batch of seen-events was refused by the server and dropped.",
            reason: describeError(e.error),
            userId,
            detail: { events: e.item.action.events.length, attempts: e.item.attempts },
          });
        }
        return;
      }
      if (e.type === "delivered" && !e.awaited) {
        // S7b-5: a follow sent from the phone — the follow state and counts
        // shown optimistically are now re-read from the server.
        const k = e.item.action.kind;
        if (k === "follow" || k === "unfollow") {
          void qc.invalidateQueries({ queryKey: ["friend-follow"] });
          void qc.invalidateQueries({ queryKey: ["follows"] });
        }
        if (refresh) clearTimeout(refresh);
        refresh = setTimeout(() => { void qc.invalidateQueries({ queryKey: ["feed"] }); }, 500);
      } else if (e.type === "failed" && !e.awaited) {
        toast({
          title: "1 action couldn't be sent",
          description: e.item.action.kind === "comment" ? "Your comment was not posted."
            : e.item.action.kind === "follow" || e.item.action.kind === "unfollow" ? "Your follow was not saved."
            : "The server refused it.",
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
