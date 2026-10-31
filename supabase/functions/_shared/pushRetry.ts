/**
 * N4 · push retry. A temporary FCM failure (429, 5xx, or a network error) is
 * tried once more after a short pause; a permanent one (bad token, 400/404 …)
 * is returned at once so send-push prunes the token as before.
 *
 * send-push uses this only for a push that carries a receipt — i.e. one whose
 * group is switched on for the member (0160). Every other push is sent exactly
 * once, as today.
 */
export type FcmResponse = { ok: boolean; status: number; text: () => Promise<string> };

export function isTemporaryFcmFailure(status: number): boolean {
  return status === 429 || status >= 500;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sendWithRetry(
  send: () => Promise<FcmResponse>,
  sleep: (ms: number) => Promise<void> = pause,
  delayMs = 800,
): Promise<FcmResponse> {
  let first: FcmResponse;
  try {
    first = await send();
  } catch {
    await sleep(delayMs);
    return send();                       // a second network error is thrown, as before
  }
  if (first.ok || !isTemporaryFcmFailure(first.status)) return first;
  await sleep(delayMs);
  return send();
}
