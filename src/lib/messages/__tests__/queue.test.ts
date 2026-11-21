import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMessageQueue, drainQueue, isOfflineFailure, pendingMessages, queueMessage, removeQueued } from "../queue";

const item = (id: string, over: Partial<{ userId: string; to: string; body: string }> = {}) => ({ id, userId: "me", to: "u2", body: `text ${id}`, replyTo: null, ...over });

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("the message send queue", () => {
  it("keeps a message once, per member, in order", () => {
    expect(queueMessage(item("a"))).toBe(true);
    expect(queueMessage(item("a"))).toBe(true);            // the same id is never queued twice
    queueMessage(item("b"));
    queueMessage(item("c", { userId: "someone-else" }));
    expect(pendingMessages("me").map((q) => q.id)).toEqual(["a", "b"]);
    expect(pendingMessages("me", "u9")).toEqual([]);
    expect(pendingMessages(undefined)).toEqual([]);
  });

  it("refuses the 51st waiting message", () => {
    for (let i = 0; i < 50; i++) expect(queueMessage(item(`m${i}`))).toBe(true);
    expect(queueMessage(item("m50"))).toBe(false);
  });

  it("sends oldest first with the SAME id, and removes what was sent", async () => {
    queueMessage(item("a")); queueMessage(item("b"));
    const seen: string[] = [];
    const r = await drainQueue("me", async (q) => { seen.push(q.id); });
    expect(seen).toEqual(["a", "b"]);
    expect(r).toEqual({ sent: 2, dropped: 0, waiting: 0 });
  });

  it("stops at a network failure and keeps the rest in order", async () => {
    queueMessage(item("a")); queueMessage(item("b")); queueMessage(item("c"));
    let n = 0;
    const r = await drainQueue("me", async () => { n++; if (n === 2) throw new TypeError("Failed to fetch"); });
    expect(r).toEqual({ sent: 1, dropped: 0, waiting: 2 });
    expect(pendingMessages("me").map((q) => q.id)).toEqual(["b", "c"]);
  });

  it("drops an item the server refused and carries on", async () => {
    queueMessage(item("a")); queueMessage(item("b"));
    const r = await drainQueue("me", async (q) => { if (q.id === "a") throw new Error("MSG-030: you cannot message this member"); });
    expect(r).toEqual({ sent: 1, dropped: 1, waiting: 0 });
  });

  it("drops an item older than 7 days without sending it, and never sends another member's", async () => {
    queueMessage(item("old")); queueMessage(item("x", { userId: "other" }));
    const send = vi.fn(async () => undefined);
    const r = await drainQueue("me", send, Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(send).not.toHaveBeenCalled();
    expect(r.dropped).toBe(1);
    expect(pendingMessages("other").map((q) => q.id)).toEqual(["x"]);
  });

  it("is wiped on sign-out and tells a network fault from a refusal", () => {
    queueMessage(item("a"));
    clearMessageQueue();
    expect(pendingMessages("me")).toEqual([]);
    removeQueued("nope");
    expect(isOfflineFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineFailure(new Error("MSG-060: held"))).toBe(false);
  });
});
