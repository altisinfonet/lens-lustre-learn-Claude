/** Messages · the send queue's storage key and its sign-out wipe. Kept tiny on purpose: sign-out is in the first download, the queue itself is not. */
export const QUEUE_KEY = "msg-queue:v1";

/** Sign-out: nothing a member wrote is left for the next person on this device. Never throws. */
export function clearMessageQueue(): void {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(QUEUE_KEY); } catch { /* never block sign-out */ }
}
