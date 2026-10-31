/**
 * N4 · push receipts (supabase/functions/_shared/pushReceipts.ts). A receipt
 * must never block, delay or change a push: any failure of the receipt calls
 * means "no receipt", and the message is today's message.
 */
import { describe, it, expect, vi } from "vitest";
import { startPushReceipt, finishPushReceipt, fcmErrorCode } from "../../supabase/functions/_shared/pushReceipts";

const client = (impl: (fn: string, args: Record<string, unknown>) => unknown) => ({
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => impl(fn, args)),
});

describe("startPushReceipt", () => {
  it("returns the id the database gives, for a registered type", async () => {
    const c = client(() => ({ data: 42, error: null }));
    expect(await startPushReceipt(c, "u1", "post_reaction")).toBe(42);
    expect(c.rpc).toHaveBeenCalledWith("notification_delivery_start",
      { _user: "u1", _type: "post_reaction", _channel: "push", _notification: null });
  });

  it("returns null when the group is off (database returns null)", async () => {
    expect(await startPushReceipt(client(() => ({ data: null, error: null })), "u1", "post_reaction")).toBeNull();
  });

  it("returns null on a database error, a thrown error, or no type — without calling for no type", async () => {
    expect(await startPushReceipt(client(() => ({ data: null, error: { message: "function does not exist" } })), "u1", "x")).toBeNull();
    expect(await startPushReceipt(client(() => { throw new Error("network"); }), "u1", "x")).toBeNull();
    const c = client(() => ({ data: 1, error: null }));
    expect(await startPushReceipt(c, "u1", undefined)).toBeNull();
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("passes a valid notification id through and drops anything else", async () => {
    const c = client(() => ({ data: 7, error: null }));
    await startPushReceipt(c, "u1", "post_reaction", "123e4567-e89b-42d3-a456-426614174000");
    await startPushReceipt(c, "u1", "post_reaction", "not-a-uuid");
    expect(c.rpc.mock.calls[0][1]._notification).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(c.rpc.mock.calls[1][1]._notification).toBeNull();
  });
});

describe("finishPushReceipt", () => {
  it("does nothing without an id", async () => {
    const c = client(() => ({ data: "sent", error: null }));
    await finishPushReceipt(c, null, { ok: 1, failed: 0, pruned: 0 });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("sends the counts and a short error", async () => {
    const c = client(() => ({ data: "failed", error: null }));
    await finishPushReceipt(c, 9, { ok: 0, failed: 2, pruned: 1, error: "E".repeat(1000) });
    const args = c.rpc.mock.calls[0][1];
    expect(c.rpc.mock.calls[0][0]).toBe("notification_delivery_finish");
    expect(args).toMatchObject({ _id: 9, _ok: 0, _failed: 2, _pruned: 1 });
    expect((args._error as string).length).toBe(300);
  });

  it("never throws", async () => {
    await expect(finishPushReceipt(client(() => { throw new Error("down"); }), 9, { ok: 1, failed: 0, pruned: 0 })).resolves.toBeUndefined();
  });
});

describe("fcmErrorCode", () => {
  it("keeps FCM's status word and nothing else", () => {
    expect(fcmErrorCode(JSON.stringify({ error: { code: 404, status: "UNREGISTERED", message: "token abc123 not found" } }))).toBe("UNREGISTERED");
    expect(fcmErrorCode("<html>bad gateway</html>")).toBe("error");
    expect(fcmErrorCode(JSON.stringify({ error: { status: "has spaces and abc123" } }))).toBe("error");
  });
});

describe("startPushReceipt is bounded", () => {
  it("gives up after 2 s and returns null when the database hangs", async () => {
    vi.useFakeTimers();
    try {
      const c = { rpc: vi.fn(() => new Promise(() => { /* never answers */ })) };
      const p = startPushReceipt(c, "u1", "post_reaction");
      await vi.advanceTimersByTimeAsync(2001);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
