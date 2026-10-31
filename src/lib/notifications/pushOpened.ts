/**
 * N4 · push receipts. When a member taps a push that carries a receipt id
 * (delivery_id — only pushes of a group switched on for them), tell the server
 * it was opened. Pushes without one are today's pushes: nothing is sent.
 * Fire-and-forget: opening the app is never delayed or blocked by this.
 */
import { supabase } from "@/integrations/supabase/client";

export async function reportPushOpened(data: Record<string, unknown>): Promise<void> {
  const raw = data?.delivery_id;
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,15}$/.test(raw)) return;
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return;
  try {
    await supabase.rpc("notification_delivery_opened" as never, { _id: id } as never);
  } catch {
    /* a receipt never blocks opening the app */
  }
}
