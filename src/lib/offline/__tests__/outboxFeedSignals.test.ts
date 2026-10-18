/**
 * S12-F1 · SIGNALS THROUGH THE OFF-2 OUTBOX: exactly once on the wire.
 *
 * Same rig as outboxFeedEvents.test.ts: the REAL supabase-js and the real
 * sender, pointed at the fake PostgREST (src/uiharness/fakeTables.ts), which
 * enforces feed_signal_events' primary key the way the database does. The
 * database then folds each row that was actually inserted into the per-viewer
 * aggregates (an AFTER INSERT trigger — a row skipped by ON CONFLICT DO NOTHING
 * fires nothing), so one row here is one count there.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import contract from "../../../../scripts/db-off2-outbox-contract.json";
import { createFakeTables, type FakeTables } from "@/uiharness/fakeTables";
import {
  MAX_FEED_EVENT_ITEMS, OUTBOX_TARGETS, UNORDERED_KINDS, enqueue, drain, submit, pending, startOutbox,
  memoryOutboxStore, __setOutboxStore, __setOutboxOnline, __setOutboxRandom, __resetOutbox,
  type FeedSignalPayload,
} from "../outbox";
import { supabaseSender } from "../outboxSender";
import { hidePost, muteAuthor, unmuteAuthor } from "@/lib/feed/feedSignals";

const U = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const AUTHOR = "33333333-3333-4333-8333-333333333333";
const sig = (n: number, kind: FeedSignalPayload["kind"] = "dwell"): FeedSignalPayload => ({
  id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`,
  kind, post_id: kind === "profile_visit" ? null : POST, subject_id: AUTHOR, value: kind === "dwell" ? 1500 : 0,
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
  it("a batch is written once, with the member as user_id and the columns the table has", async () => {
    startOutbox(U, supabaseSender(sb));
    const r = await submit(U, { kind: "feed_signals", signals: [sig(1), sig(2, "skip"), sig(3, "profile_visit")] });
    expect(r.status).toBe("delivered");
    const rows = fake.rows("feed_signal_events");
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.user_id === U)).toBe(true);
    // (created_at is the fake's own default, as the database's is; the client never sends it)
    expect(rows.map((x) => Object.keys(x).filter((k) => k !== "created_at").sort().join(","))).toEqual(Array(3).fill("id,kind,post_id,subject_id,user_id,value"));
  });

  it("the answer is lost twice: resent with the SAME ids, still three rows (ON CONFLICT (id) DO NOTHING)", async () => {
    startOutbox(U, supabaseSender(sb));
    fake.loseAnswers(2);
    const r = await submit(U, { kind: "feed_signals", signals: [sig(1), sig(2), sig(3)] });
    expect(r.status).toBe("queued");
    await drainAll();
    expect(fake.rows("feed_signal_events").map((x) => x.id).sort()).toEqual([sig(1).id, sig(2).id, sig(3).id]);
    expect(fake.log.filter((l) => l.includes("feed_signal_events ignored"))).toHaveLength(6);
    expect(await pending(U)).toHaveLength(0);
  });
});

describe("telemetry, not a member's action", () => {
  it("feed_signals is unordered (never holds a comment behind it)", () => {
    expect(UNORDERED_KINDS.has("feed_signals")).toBe(true);
  });

  it("the device keeps at most MAX_FEED_EVENT_ITEMS unsent signal batches (oldest dropped)", async () => {
    __setOutboxOnline(() => false);
    for (let i = 0; i < MAX_FEED_EVENT_ITEMS + 5; i++) await enqueue(U, { kind: "feed_signals", signals: [sig(i)] }, now + i);
    const p = await pending(U);
    expect(p.filter((x) => x.action.kind === "feed_signals")).toHaveLength(MAX_FEED_EVENT_ITEMS);
  });

  it("the target is in D1's contract with the same natural key", () => {
    const t = OUTBOX_TARGETS.feed_signals;
    expect(t).toEqual({ table: "feed_signal_events", kind: "natural", onConflict: "id" });
    const c = (contract as unknown as { tables: Record<string, { kind: string; columns?: string[] }> }).tables[t.table];
    expect(c?.kind).toBe("natural");
    expect(c?.columns).toEqual(["id"]);
  });
});

/* ── S12-F1 Extra A (hide) and Extra D (mute): the member's choices, exactly once ── */
describe("hide a post / mute an account — exactly once through the outbox", () => {
  it("hide: delivered once, and a resend after two lost answers is still ONE row (natural key user_id, post_id)", async () => {
    startOutbox(U, supabaseSender(sb));
    fake.loseAnswers(2);
    const r = await hidePost(U, POST);
    expect(r?.status).toBe("queued");
    await drainAll();
    expect(fake.rows("feed_hidden_posts")).toEqual([expect.objectContaining({ user_id: U, post_id: POST, reason: "not_interested" })]);
    await hidePost(U, POST, "hide");
    await drainAll();
    expect(fake.rows("feed_hidden_posts")).toHaveLength(1);
  });

  it("mute: one row per (member, author) however often it is sent; unmute removes it", async () => {
    startOutbox(U, supabaseSender(sb));
    await muteAuthor(U, AUTHOR);
    fake.loseAnswers(1);
    await muteAuthor(U, AUTHOR);
    await drainAll();
    expect(fake.rows("feed_muted_authors")).toEqual([expect.objectContaining({ user_id: U, author_id: AUTHOR })]);
    await unmuteAuthor(U, AUTHOR);
    await drainAll();
    expect(fake.rows("feed_muted_authors")).toHaveLength(0);
  });

  it("mute then unmute while offline collapses to the last intent (nothing sent for the first)", async () => {
    __setOutboxOnline(() => false);
    await enqueue(U, { kind: "mute", authorId: AUTHOR }, now);
    await enqueue(U, { kind: "unmute", authorId: AUTHOR }, now + 1);
    const p = await pending(U);
    expect(p.map((x) => x.action.kind)).toEqual(["unmute"]);
  });

  it("never the member themselves; nothing without a member", async () => {
    expect(await muteAuthor(U, U)).toBeNull();
    expect(await hidePost("", POST)).toBeNull();
    expect(await pending(U)).toHaveLength(0);
  });

  it("hide / mute / unmute are in D1's contract with the same natural keys", () => {
    const tables = (contract as unknown as { tables: Record<string, { kind: string; columns?: string[] }> }).tables;
    expect(OUTBOX_TARGETS.hide_post).toEqual({ table: "feed_hidden_posts", kind: "natural", onConflict: "user_id,post_id" });
    expect(OUTBOX_TARGETS.mute).toEqual({ table: "feed_muted_authors", kind: "natural", onConflict: "user_id,author_id" });
    expect(OUTBOX_TARGETS.unmute).toEqual({ table: "feed_muted_authors", kind: "natural", onConflict: "user_id,author_id" });
    expect(tables.feed_hidden_posts?.columns).toEqual(["user_id", "post_id"]);
    expect(tables.feed_muted_authors?.columns).toEqual(["user_id", "author_id"]);
  });
});
