/**
 * S7b-5 · FOLLOW / UNFOLLOW AND REPORTING A POST WORK WITH NO NETWORK.
 *
 * Before: useToggleFollow and PostCard's report wrote straight to the database,
 * so in flight mode a follow said "Failed to follow" and a report "Failed to
 * submit report" — the member's action was lost. Now both go through the OFF-2
 * outbox: kept on the phone, sent once when the network is back, and the
 * server's natural keys (follows: follower+following, post_reports:
 * post+reporter — D1's contract) make a resend after a lost answer harmless.
 * Same rig as outboxFeedSignals.test.ts: real supabase-js + the real sender
 * against fakeTables, which enforces those unique keys.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import contract from "../../../../scripts/db-off2-outbox-contract.json";
import { createFakeTables, type FakeTables } from "@/uiharness/fakeTables";
import {
  OUTBOX_TARGETS, enqueue, drain, pending, submit, startOutbox,
  memoryOutboxStore, __setOutboxStore, __setOutboxOnline, __setOutboxRandom, __resetOutbox,
} from "../outbox";
import { supabaseSender } from "../outboxSender";

const U = "11111111-1111-4111-8111-111111111111";
const T = "33333333-3333-4333-8333-333333333333";
const POST = "22222222-2222-4222-8222-222222222222";

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

describe("follow through the outbox", () => {
  it("is inside D1's contract (follows, natural key follower_id,following_id)", () => {
    const c = (contract as { tables: Record<string, { kind: string; columns?: string[] }> }).tables;
    expect(OUTBOX_TARGETS.follow.table).toBe("follows");
    expect(OUTBOX_TARGETS.follow.onConflict).toBe(c.follows.columns!.join(","));
    expect(OUTBOX_TARGETS.post_report.table).toBe("post_reports");
    expect(OUTBOX_TARGETS.post_report.onConflict).toBe(c.post_reports.columns!.join(","));
  });

  it("made offline, sent once online — with two lost answers, still ONE row", async () => {
    __setOutboxOnline(() => false);
    startOutbox(U, supabaseSender(sb));
    expect((await submit(U, { kind: "follow", targetId: T })).status).toBe("queued");
    expect(fake.rows("follows")).toHaveLength(0);
    fake.loseAnswers(2);
    __setOutboxOnline(() => true);
    await drainAll();
    expect(fake.rows("follows")).toHaveLength(1);
    expect(fake.rows("follows")[0]).toMatchObject({ follower_id: U, following_id: T });
    expect(await pending(U)).toEqual([]);
  });

  it("follow then unfollow offline collapses to the last intent (unfollow): no row", async () => {
    __setOutboxOnline(() => false);
    startOutbox(U, supabaseSender(sb));
    await enqueue(U, { kind: "follow", targetId: T });
    await enqueue(U, { kind: "unfollow", targetId: T });
    expect((await pending(U)).map((i) => i.action.kind)).toEqual(["unfollow"]);
    __setOutboxOnline(() => true);
    await drainAll();
    expect(fake.rows("follows")).toHaveLength(0);
  });
});

describe("reporting a post through the outbox", () => {
  it("made offline, sent once online — with a lost answer, still ONE report", async () => {
    __setOutboxOnline(() => false);
    startOutbox(U, supabaseSender(sb));
    expect((await submit(U, { kind: "post_report", postId: POST, reason: "spam" })).status).toBe("queued");
    fake.loseAnswers(1);
    __setOutboxOnline(() => true);
    await drainAll();
    expect(fake.rows("post_reports")).toHaveLength(1);
    expect(fake.rows("post_reports")[0]).toMatchObject({ post_id: POST, reporter_id: U, reason: "spam" });
  });
});
