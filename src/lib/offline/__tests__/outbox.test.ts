/**
 * OFF-2 · the outbox delivers an action exactly once.
 *
 * The client under test is the REAL supabase-js, pointed at a fake PostgREST
 * (src/uiharness/fakeTables.ts) that enforces the same unique constraints as
 * staging after D1's 0008. "Lost answer" = the server committed the write and
 * the reply never arrived (a dropped link) — the case that forces a resend.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import contract from "../../../../scripts/db-off2-outbox-contract.json";
import { createFakeTables, type FakeTables } from "@/uiharness/fakeTables";
import {
  OUTBOX_TARGETS, MAX_ATTEMPTS, enqueue, drain, submit, pending, startOutbox, clearOutbox, subscribeOutbox,
  memoryOutboxStore, __setOutboxStore, __setOutboxOnline, __setOutboxRandom, __resetOutbox, backoffMs,
  type OutboxEvent,
} from "../outbox";
import { supabaseSender } from "../outboxSender";

const U = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";

let fake: FakeTables;
let online = true;
let now = 1_000_000;
const clock = () => now;

/** One client for the file (GoTrue warns about several); its fetch reaches the current fake. */
const sb = createClient("https://testprojectref0000x.supabase.co", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: ((i: RequestInfo | URL, init?: RequestInit) => fake.fetch(i, init)) as typeof fetch },
});
const client = (_f: FakeTables) => sb;

/** Drain until nothing is waiting, jumping the clock past each back-off. */
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
  online = true;
  now = 1_000_000;
  __setOutboxOnline(() => online);
  __setOutboxRandom(() => 0.5);
  fake = createFakeTables();
  startOutbox(U, supabaseSender(client(fake)));
});
afterEach(() => {
  __resetOutbox();
  __setOutboxOnline(undefined);
  __setOutboxRandom(undefined);
  vi.restoreAllMocks();
});

describe("OFF-2 · exactly once", () => {
  it("a comment whose answer is lost twice is still ONE comment, and the read-back is that row", async () => {
    online = false;
    const item = await enqueue(U, { kind: "comment", postId: POST, content: "hello", parentId: null }, now);
    fake.loseAnswers(2); // send 1 and 2 commit, then the link drops
    online = true;
    const delivered: OutboxEvent[] = [];
    subscribeOutbox((e) => { if (e.type === "delivered") delivered.push(e); });
    await drainAll();
    const rows = fake.rows("post_comments");
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotency_key).toBe(item.key);
    expect(fake.log.filter((l) => l.startsWith("POST post_comments"))).toEqual([
      "POST post_comments +1",
      "POST post_comments ignored (post_comments_user_idempotency_key)",
      "POST post_comments ignored (post_comments_user_idempotency_key)",
    ]);
    expect(delivered).toHaveLength(1);
    expect((delivered[0] as { result: { id: string } }).result.id).toBe(rows[0].id);
    expect(await pending(U)).toEqual([]);
  });

  it("FAILS FIRST · the pre-OFF-2 send (plain insert, no key) replayed the same way makes THREE comments", async () => {
    const db = client(fake);
    fake.loseAnswers(2);
    for (let i = 0; i < 3; i++) {
      // exactly what useAddComment did before OFF-2
      await db.from("post_comments").insert({ post_id: POST, user_id: U, content: "hello", parent_id: null }).then(() => {}, () => {});
    }
    expect(fake.rows("post_comments")).toHaveLength(3);
  });

  it("the key is made ONCE per action — crypto.randomUUID is not called again on any retry", async () => {
    const spy = vi.spyOn(globalThis.crypto, "randomUUID");
    online = false;
    await enqueue(U, { kind: "comment", postId: POST, content: "x", parentId: null }, now);
    expect(spy).toHaveBeenCalledTimes(1);
    fake.loseAnswers(3);
    online = true;
    await drainAll();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fake.rows("post_comments")).toHaveLength(1);
  });

  it("a report replayed three times is one report", async () => {
    fake.loseAnswers(2);
    await enqueue(U, { kind: "report", targetType: "post", targetId: POST, reason: "spam spam" }, now);
    await drainAll();
    expect(fake.rows("reports")).toHaveLength(1);
  });

  it("a like made offline is queued, kept, and delivered once on reconnect — repeats hit the natural key", async () => {
    online = false;
    const r = await submit(U, { kind: "react", postId: POST, reactionType: "like", replace: false });
    expect(r.status).toBe("queued");
    expect(await pending(U)).toHaveLength(1);
    expect(fake.rows("post_reactions")).toHaveLength(0);
    fake.loseAnswers(2);
    online = true;
    await drainAll();
    expect(fake.rows("post_reactions")).toHaveLength(1);
    expect(fake.log.filter((l) => l.startsWith("POST post_reactions"))).toEqual([
      "POST post_reactions +1",
      "POST post_reactions 23505 (post_reactions_post_id_user_id_key)",
      "POST post_reactions 23505 (post_reactions_post_id_user_id_key)",
    ]);
    expect(await pending(U)).toEqual([]);
  });

  it("online, submit sends at once and returns the server's row", async () => {
    const r = await submit(U, { kind: "comment", postId: POST, content: "now", parentId: null });
    expect(r.status).toBe("delivered");
    expect((r as { result: { id: string } }).result.id).toBe(fake.rows("post_comments")[0].id);
  });
});

describe("OFF-2 · order, collapse, retry budget, refusal, sign-out", () => {
  it("like → unlike → like offline collapses to ONE like (last intent, R5)", async () => {
    online = false;
    await enqueue(U, { kind: "react", postId: POST, reactionType: "like", replace: false }, now);
    await enqueue(U, { kind: "unreact", postId: POST }, now + 1);
    await enqueue(U, { kind: "react", postId: POST, reactionType: "love", replace: false }, now + 2);
    const p = await pending(U);
    expect(p).toHaveLength(1);
    expect(p[0].action).toMatchObject({ kind: "react", reactionType: "love" });
  });

  it("FIFO: an item waiting on back-off holds back everything after it", async () => {
    online = false;
    await enqueue(U, { kind: "comment", postId: POST, content: "first", parentId: null }, now);
    await enqueue(U, { kind: "comment", postId: POST, content: "second", parentId: null }, now + 1);
    online = true;
    fake.loseAnswers(1);
    await drain(clock);
    // first committed but its answer was lost; second must not have been sent
    expect(fake.rows("post_comments").map((r) => r.content)).toEqual(["first"]);
    await drainAll();
    expect(fake.rows("post_comments").map((r) => r.content)).toEqual(["first", "second"]);
  });

  it("a final refusal (4xx) is dropped, announced and thrown — never retried", async () => {
    const failed: OutboxEvent[] = [];
    subscribeOutbox((e) => { if (e.type === "failed") failed.push(e); });
    // the fake has no such table → a 404 PostgREST error, as a refusal would be
    fake.tables.delete("post_comments");
    await expect(submit(U, { kind: "comment", postId: POST, content: "x", parentId: null })).rejects.toBeTruthy();
    expect(fake.log).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(await pending(U)).toEqual([]);
  });

  it(`gives up after ${MAX_ATTEMPTS} sends that never get an answer`, async () => {
    const failed: OutboxEvent[] = [];
    subscribeOutbox((e) => { if (e.type === "failed") failed.push(e); });
    online = false;
    await enqueue(U, { kind: "unreact", postId: POST }, now);
    online = true;
    fake.loseAnswers(1000);
    await drainAll(50);
    expect(failed).toHaveLength(1);
    expect((failed[0] as { item: { attempts: number } }).item.attempts).toBe(MAX_ATTEMPTS);
  });

  it("back-off is 1 s, 2 s, 4 s … capped at 60 s (no jitter at 0.5)", () => {
    expect([1, 2, 3, 4, 7, 12].map((a) => backoffMs(a, () => 0.5))).toEqual([1000, 2000, 4000, 8000, 60000, 60000]);
  });

  it("nothing is sent while offline", async () => {
    online = false;
    await enqueue(U, { kind: "comment", postId: POST, content: "x", parentId: null }, now);
    await drain(clock);
    expect(fake.log).toEqual([]);
  });

  it("only the signed-in member's items are sent", async () => {
    online = false;
    await enqueue("99999999-9999-4999-8999-999999999999", { kind: "comment", postId: POST, content: "theirs", parentId: null }, now);
    online = true;
    await drainAll();
    expect(fake.rows("post_comments")).toHaveLength(0);
  });

  it("sign-out wipes the outbox", async () => {
    online = false;
    await enqueue(U, { kind: "comment", postId: POST, content: "x", parentId: null }, now);
    expect(await clearOutbox()).toBe(true);
    expect(await pending(U)).toEqual([]);
  });
});

describe("OFF-2 · the outbox writes only what D1's contract covers", () => {
  const tables = (contract as unknown as { tables: Record<string, { kind: string; owner?: string; columns?: string[] }> }).tables;
  for (const [kind, t] of Object.entries(OUTBOX_TARGETS)) {
    it(`${kind} → ${t.table} is in scripts/db-off2-outbox-contract.json with the same guard`, () => {
      const c = tables[t.table];
      expect(c, `${t.table} is not in D1's contract`).toBeTruthy();
      expect(c.kind).toBe(t.kind);
      if (t.kind === "key") {
        expect(t.owner).toBe(c.owner);
        expect(t.onConflict).toBe(`${c.owner},idempotency_key`);
      } else {
        expect(t.onConflict.split(",")).toEqual(c.columns);
      }
    });
  }
});
