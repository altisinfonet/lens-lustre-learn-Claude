/**
 * S7b-5 · WHAT IS WAITING TO BE SENT IS VISIBLE. A like, follow or report made
 * offline is kept in the outbox; the screen marks it "will send when online"
 * until it is delivered (useOutboxPendingSubjects / PendingMark), and the bar
 * at the top counts what is waiting.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, render, screen, waitFor, act } from "@testing-library/react";
import {
  enqueue, drain, startOutbox, outboxSubject, whenOutboxSettles,
  memoryOutboxStore, __setOutboxStore, __setOutboxOnline, __resetOutbox,
} from "@/lib/offline/outbox";
import { useOutboxPendingSubjects } from "@/lib/offline/useOutboxPending";
import PendingMark from "@/components/offline/PendingMark";

const U = "11111111-1111-4111-8111-111111111111";
let sent: string[];

beforeEach(() => {
  __resetOutbox();
  __setOutboxStore(memoryOutboxStore());
  __setOutboxOnline(() => false);
  sent = [];
  startOutbox(U, async (item) => { sent.push(item.key); return { ok: true }; });
});
afterEach(() => { __resetOutbox(); __setOutboxOnline(undefined); });

describe("pending subjects", () => {
  it("names what a queued action is about", () => {
    expect(outboxSubject({ kind: "react", postId: "p", reactionType: "like", replace: false })).toBe("post:p");
    expect(outboxSubject({ kind: "unfollow", targetId: "t" })).toBe("follow:t");
    expect(outboxSubject({ kind: "post_report", postId: "p", reason: "x" })).toBe("post_report:p");
    expect(outboxSubject({ kind: "comment", postId: "p", content: "c", parentId: null })).toBe("comment:p");
  });

  it("a queued like is pending until delivered, then not", async () => {
    const { result } = renderHook(() => useOutboxPendingSubjects());
    await act(async () => { await enqueue(U, { kind: "react", postId: "p1", reactionType: "like", replace: false }); });
    await waitFor(() => expect(result.current.has("post:p1")).toBe(true));
    __setOutboxOnline(() => true);
    await act(async () => { await drain(); });
    await waitFor(() => expect(result.current.has("post:p1")).toBe(false));
  });

  it("PendingMark shows 'Will send when online' only while waiting", async () => {
    render(<PendingMark subject="follow:t1" />);
    expect(screen.queryByText(/send when online/i)).toBeNull();
    await act(async () => { await enqueue(U, { kind: "follow", targetId: "t1" }); });
    expect(await screen.findByText(/send when online/i)).toBeTruthy();
  });

  it("whenOutboxSettles reports the delivery of ONE item", async () => {
    const item = await enqueue(U, { kind: "comment", postId: "p1", content: "hi", parentId: null });
    const got: string[] = [];
    whenOutboxSettles(item.key, (outcome) => got.push(outcome));
    __setOutboxOnline(() => true);
    await drain();
    expect(got).toEqual(["delivered"]);
  });
});
