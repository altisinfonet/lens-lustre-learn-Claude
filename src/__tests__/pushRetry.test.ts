/**
 * N4 · push retry (supabase/functions/_shared/pushRetry.ts). A temporary FCM
 * failure (429 / 5xx / network) is retried once after a short pause; a
 * permanent one (bad token, 400/404) is not — it is pruned as before.
 */
import { describe, it, expect, vi } from "vitest";
import { sendWithRetry, isTemporaryFcmFailure } from "../../supabase/functions/_shared/pushRetry";

const res = (status: number, body = "") => ({ ok: status >= 200 && status < 300, status, text: async () => body });

describe("isTemporaryFcmFailure", () => {
  it("429 and 5xx are temporary; 400/401/403/404 are not", () => {
    for (const s of [429, 500, 502, 503, 504]) expect(isTemporaryFcmFailure(s), String(s)).toBe(true);
    for (const s of [400, 401, 403, 404]) expect(isTemporaryFcmFailure(s), String(s)).toBe(false);
  });
});

describe("sendWithRetry", () => {
  const sleep = vi.fn(async () => {});

  it("a first success is not repeated", async () => {
    const send = vi.fn(async () => res(200));
    const r = await sendWithRetry(send, sleep);
    expect(r.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a 503 is tried once more after a pause, and the second answer is used", async () => {
    const send = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
    const r = await sendWithRetry(send, sleep);
    expect(r.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalled();
  });

  it("a bad token (404 UNREGISTERED) is not retried", async () => {
    const send = vi.fn(async () => res(404, '{"error":{"status":"UNREGISTERED"}}'));
    const r = await sendWithRetry(send, sleep);
    expect(r.status).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("only one retry — a second temporary failure is returned as it is", async () => {
    const send = vi.fn(async () => res(500));
    const r = await sendWithRetry(send, sleep);
    expect(r.status).toBe(500);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a network error is retried once; a second one is thrown as before", async () => {
    const ok = vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(res(200));
    expect((await sendWithRetry(ok, sleep)).status).toBe(200);
    const bad = vi.fn(async () => { throw new Error("down"); });
    await expect(sendWithRetry(bad, sleep)).rejects.toThrow("down");
    expect(bad).toHaveBeenCalledTimes(2);
  });
});
