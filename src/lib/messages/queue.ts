/**
 * Messages · the SEND QUEUE: a text message written with no network is kept on this device and sent, once, when the network
 * comes back (Owner list 21 Nov: "offline send queue"; like WhatsApp's clock icon).
 *
 * EXACTLY ONCE: the message id (client_msg_id) is made when the member taps Send and stored with the item. Every send of that
 * item — the first try, a retry after an answer was lost, a resend after the app was closed and reopened — carries THAT id, and
 * the server's door (message_send: "never twice" on sender + client_msg_id) turns a repeat into the same message.
 * ORDER: first in, first out. A network failure stops the drain, so nothing is sent ahead of an item that is still waiting.
 * LIMITS: text only (a photo needs the network to upload anyway), at most 50 waiting, an item older than 7 days is dropped.
 * PRIVACY: kept per member; only the signed-in member's items are ever sent; sign-out wipes the lot (signOutWipe.ts).
 * A refusal from the server (blocked, paused, word guard …) is final: that item is dropped and reported, never retried.
 *
 * Storage is localStorage on purpose: a handful of short texts, no schema, works in the web app and in the Android WebView.
 */
import { isNetworkError } from "@/lib/offline/retryPolicy";
import { QUEUE_KEY, clearMessageQueue } from "@/lib/messages/queueWipe";

export { clearMessageQueue };

const KEY = QUEUE_KEY;
const EVENT = "msg-queue-changed";
const MAX_ITEMS = 50;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface QueuedMessage { id: string; userId: string; to: string; body: string; replyTo: number | null; at: number }

function read(): QueuedMessage[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v.filter((q): q is QueuedMessage => !!q && typeof q === "object"
      && typeof (q as QueuedMessage).id === "string" && typeof (q as QueuedMessage).userId === "string"
      && typeof (q as QueuedMessage).to === "string" && typeof (q as QueuedMessage).body === "string"
      && typeof (q as QueuedMessage).at === "number");
  } catch {
    return [];
  }
}

function write(list: QueuedMessage[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (list.length === 0) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(list));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage full or blocked: the message simply is not queued (the screen says so) */
  }
}

export const QUEUE_EVENT = EVENT;

/** Keep a message for later. Returns false when it cannot be kept (storage blocked, or 50 are already waiting). */
export function queueMessage(item: Omit<QueuedMessage, "at">): boolean {
  const list = read();
  if (list.some((q) => q.id === item.id)) return true;
  if (list.filter((q) => q.userId === item.userId).length >= MAX_ITEMS) return false;
  write([...list, { ...item, at: Date.now() }]);
  return read().some((q) => q.id === item.id);
}

export function pendingMessages(userId: string | undefined, to?: string | null): QueuedMessage[] {
  if (!userId) return [];
  return read().filter((q) => q.userId === userId && (to == null || q.to === to));
}

export function removeQueued(id: string): void {
  write(read().filter((q) => q.id !== id));
}


/** True when a failed send was the NETWORK's fault (so the message should wait), not the server's answer. */
export function isOfflineFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return isNetworkError(error);
}

export interface DrainResult { sent: number; dropped: number; waiting: number }

/**
 * Send this member's waiting messages, oldest first. `send` must throw on failure. A network failure stops the drain (the rest
 * wait); any other failure drops that one item (final) and goes on. Items older than 7 days are dropped without sending.
 */
export async function drainQueue(userId: string, send: (q: QueuedMessage) => Promise<unknown>, now: number = Date.now()): Promise<DrainResult> {
  let sent = 0;
  let dropped = 0;
  for (const q of read().filter((x) => x.userId === userId)) {
    if (now - q.at > MAX_AGE_MS) { removeQueued(q.id); dropped++; continue; }
    try {
      await send(q);
      removeQueued(q.id);
      sent++;
    } catch (e) {
      if (isOfflineFailure(e)) break;
      removeQueued(q.id);
      dropped++;
    }
  }
  return { sent, dropped, waiting: read().filter((x) => x.userId === userId).length };
}
