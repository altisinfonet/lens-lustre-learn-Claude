/**
 * Messages · the send queue on screen: the member's waiting messages (shown as "Waiting for network"), and the drain that sends them
 * when the network is back — on opening Messages, when the browser/app comes online, and every 20 s while something waits (only while
 * the page is visible: the site's one visibility timer).
 * See lib/messages/queue.ts for the rules (same id on every try = never twice, oldest first, text only, wiped on sign-out).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sendMessage } from "@/lib/messages/api";
import { QUEUE_EVENT, drainQueue, pendingMessages, type QueuedMessage } from "@/lib/messages/queue";
import { useVisibilityInterval } from "@/lib/timers/visibilityInterval";

export function useMessageQueue(userId: string | undefined, to?: string | null): QueuedMessage[] {
  const qc = useQueryClient();
  const [list, setList] = useState<QueuedMessage[]>(() => pendingMessages(userId, to));
  const running = useRef(false);

  const refresh = useCallback(() => setList(pendingMessages(userId, to)), [userId, to]);
  const drain = useCallback(async () => {
    if (!userId || running.current || pendingMessages(userId).length === 0) return;
    running.current = true;
    try {
      const r = await drainQueue(userId, (q) => sendMessage(q.to, q.body, q.id, q.replyTo));
      if (r.sent > 0 || r.dropped > 0) void qc.invalidateQueries({ queryKey: ["messages"] });
    } finally {
      running.current = false;
      refresh();
    }
  }, [userId, qc, refresh]);

  useEffect(() => {
    refresh();
    void drain();
    const onChange = () => refresh();
    const onOnline = () => { void drain(); };
    window.addEventListener(QUEUE_EVENT, onChange);
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener(QUEUE_EVENT, onChange); window.removeEventListener("online", onOnline); };
  }, [refresh, drain]);

  // a retry every 20 s while something waits (stops by itself while the tab is in the background)
  useVisibilityInterval(() => { if (pendingMessages(userId).length > 0) void drain(); }, list.length > 0 ? 20_000 : null);

  return list;
}
