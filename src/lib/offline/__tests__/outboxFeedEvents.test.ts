/**
 * STAGE L2 · SEEN-EVENTS THROUGH THE OFF-2 OUTBOX: exactly once, retried
 * instead of dropped, and never in a member's way.
 *
 * Same rig as outbox.test.ts: the REAL supabase-js and the real sender, pointed
 * at the fake PostgREST (src/uiharness/fakeTables.ts), which enforces
 * feed_events' primary key the way the database does.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createFakeTables, type FakeTables } from "@/uiharness/fakeTables";
import {
  MAX_FEED_EVENT_ITEMS, UNORDERED_KINDS, enqueue, drain, submit, pending, startOutbox, subscribeOutbox,
  memoryOutboxStore, __setOutboxStore, __setOutboxOnline, __setOutboxRandom, __resetOutbox,
  type FeedEventPayload, type OutboxEvent, type Sender,
} from "../outbox";
import { supabaseSender } from "../outboxSender";

const U = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const AUTHOR = "33333333-3333-4333-8333-333333333333";
const ev = (n: number): FeedEventPayload => ({
  id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`, post_id: POST, author_id: AUTHOR, event_type: "view", dwell_ms: 1000,
});

let fake: FakeTables;
let now = 1_000_000;
const clock = () => now;
const sb = createClient("https://testprojectref0000x.supabase.co", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: ((i: RequestInfo | URL, init?: RequestInit) => fake.fetch(i, init)) as typeof fetch },
});

async function drainAll(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await drain(clock);
    const p = await pending(U);
    if (!p.length) return;
    now = Math.max(now, ...p.map((x) => x.nextAt)) + 1;
  }
}

beforeEach(() => {
  __resetOutbox();
  __setOutboxStore(memoryOutboxStore());
  now = 1_000_000;
  __setOutboxOnline(() => true);
  __setOutboxRandom(() => 0.5);
  fake = createFakeTables();
});
afterEach(() => {
  __resetOutbox();
  __setOutboxOnline(undefined);
  __setOutboxRandom(undefined);
});

describe("exactly once", () => {
  it("a batch delivered normally writes each event once, with the member as user_id", async () => {
    startOutbox(U, supabaseSender(sb));
    const r = await submit(U, { kind: "feed_events", events: [ev(1), ev(2), ev(3)] });
    expect(r.status).toBe("delivered");
    expect(fake.rows("feed_events")).toHaveLength(3);
    expect(fake.rows("feed_events").every((x) => x.user_id === U && x.event_type === "view")).toBe(true);
  });

  it("the answer is lost twice: resent with the SAME event ids, still three rows (ON CONFLICT (id) DO NOTHING)", async () => {
    startOutbox(U, supabaseSender(sb));
    fake.loseAnswers(2);
    const r = await submit(U, { kind: "feed_events", events: [ev(1), ev(2), ev(3)] });
    expect(r.status).toBe("queued"); // the network "failed" — kept on the device, not dropped
    await drainAll();
    expect(fake.rows("feed_events").map((x) => x.id).sort()).toEqual([ev(1).id, ev(2).id, ev(3).id]);
    expect(fake.log.filter((l) => l.includes("feed_events ignored"))).toHaveLength(6);
    expect(await pending(U)).toHaveLength(0);
  });
});

describe("retried, never dropped on a network failure", () => {
  it("503 twice, then delivered", async () => {
    let calls = 0;
    const flaky: Sender = async (item) => {
      calls++;
      if (calls <= 2) return { ok: false, retry: true, error: { status: 503 } };
      return supabaseSender(sb)(item);
    };
    startOutbox(U, flaky);
    await enqueue(U, { kind: "feed_events", events: [ev(1)] });
    await drain(clock);
    expect(await pending(U)).toHaveLength(1);
    await drainAll();
    expect(calls).toBe(3);
    expect(fake.rows("feed_events")).toHaveLength(1);
  });

  it("a final refusal (the hourly rate limit, P0001 → 400) drops the batch and emits 'failed' — no retry wall", async () => {
    const events: OutboxEvent[] = [];
    subscribeOutbox((e) => events.push(e));
    let calls = 0;
    startOutbox(U, async () => { calls++; return { ok: false, retry: false, error: { code: "P0001", message: "Rate limit exceeded: maximum 500 feed events per hour" } }; });
    await enqueue(U, { kind: "feed_events", events: [ev(1)] });
    await drainAll();
    expect(calls).toBe(1);
    expect(await pending(U)).toHaveLength(0);
    expect(events.some((e) => e.type === "failed" && e.item.action.kind === "feed_events")).toBe(true);
  });
});

describe("telemetry is never in a member's way", () => {
  it("feed_events is an unordered kind", () => {
    expect(UNORDERED_KINDS.has("feed_events")).toBe(true);
    expect(UNORDERED_KINDS.has("comment")).toBe(false);
  });

  it("a seen-batch waiting on back-off does not hold a comment queued after it", async () => {
    const sender: Sender = async (item) =>
      item.action.kind === "feed_events" ? { ok: false, retry: true, error: { status: 503 } } : supabaseSender(sb)(item);
    startOutbox(U, sender);
    await enqueue(U, { kind: "feed_events", events: [ev(1)] });
    await drain(clock); // the seen-batch fails and waits
    const r = await submit(U, { kind: "comment", postId: POST, content: "hello", parentId: null });
    expect(r.status).toBe("delivered");
    expect(fake.rows("post_comments")).toHaveLength(1);
  });

  it("a comment waiting on back-off does not hold a seen-batch — but still holds the reply behind it (FIFO kept)", async () => {
    let commentCalls = 0;
    const sender: Sender = async (item) => {
      if (item.action.kind === "comment") { commentCalls++; return { ok: false, retry: true, error: { status: 503 } }; }
      return supabaseSender(sb)(item);
    };
    startOutbox(U, sender);
    await enqueue(U, { kind: "comment", postId: POST, content: "first", parentId: null }, now);
    await enqueue(U, { kind: "comment", postId: POST, content: "reply", parentId: null }, now + 1);
    await enqueue(U, { kind: "feed_events", events: [ev(1)] }, now + 2);
    await drain(clock);
    expect(fake.rows("feed_events")).toHaveLength(1); // went past the waiting comment
    expect(commentCalls).toBe(1);                     // the reply was NOT sent ahead of "first"
    expect((await pending(U)).map((i) => i.action.kind)).toEqual(["comment", "comment"]);
  });

  it(`keeps at most ${MAX_FEED_EVENT_ITEMS} unsent seen-batches per member, dropping the oldest`, async () => {
    __setOutboxOnline(() => false);
    for (let i = 0; i < MAX_FEED_EVENT_ITEMS + 5; i++) await enqueue(U, { kind: "feed_events", events: [ev(i)] }, now + i);
    const p = await pending(U);
    expect(p).toHaveLength(MAX_FEED_EVENT_ITEMS);
    expect((p[0].action as { events: FeedEventPayload[] }).events[0].id).toBe(ev(5).id);
  });
});
