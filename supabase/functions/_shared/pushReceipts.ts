/**
 * N4 · push receipts (20261104_0160). send-push asks the database for a
 * receipt id before sending, puts it in the message (delivery_id, so the app
 * can report "opened"), and records the outcome after.
 *
 * A receipt must never block, delay or change a push: any failure here —
 * migration not applied, group switched off, network — means "no receipt",
 * and the message sent is exactly today's message.
 */
type RpcResult = { data?: unknown; error?: unknown } | null | undefined;
export type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startPushReceipt(
  client: RpcClient,
  userId: string,
  type: unknown,
  notificationId?: unknown,
): Promise<number | null> {
  if (typeof type !== "string" || type === "") return null;
  try {
    const res = (await client.rpc("notification_delivery_start", {
      _user: userId,
      _type: type,
      _channel: "push",
      _notification: typeof notificationId === "string" && UUID.test(notificationId) ? notificationId : null,
    })) as RpcResult;
    if (!res || res.error) return null;
    const data = res.data;
    const id = typeof data === "number" ? data : typeof data === "string" ? Number(data) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function finishPushReceipt(
  client: RpcClient,
  id: number | null,
  outcome: { ok: number; failed: number; pruned: number; error?: string | null },
): Promise<void> {
  if (id === null) return;
  try {
    await client.rpc("notification_delivery_finish", {
      _id: id,
      _ok: outcome.ok,
      _failed: outcome.failed,
      _pruned: outcome.pruned,
      _error: outcome.error ? outcome.error.slice(0, 300) : null,
    });
  } catch {
    /* a receipt is never allowed to fail a push */
  }
}

/** FCM's error status word (e.g. UNREGISTERED), or "error" — never the raw body. */
export function fcmErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown } };
    const st = parsed?.error?.status;
    return typeof st === "string" && /^[A-Z_]{1,40}$/.test(st) ? st : "error";
  } catch {
    return "error";
  }
}
