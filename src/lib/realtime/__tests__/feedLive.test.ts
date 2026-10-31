/**
 * S6-b · ONE feed-live channel per client, every hot binding filtered.
 * A recording fake of `supabase.channel` — the real channel would open a socket.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  channels: [] as Array<{ topic: string; bindings: Array<{ event: string; table: string; filter?: string; cb: (p: { new: unknown }) => void }>; removed: boolean; status?: (s: string) => void }>,
  realtime: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const make = (topic: string) => {
    const rec = { topic, bindings: [] as Array<{ event: string; table: string; filter?: string; cb: (p: { new: unknown }) => void }>, removed: false, status: undefined as undefined | ((s: string) => void) };
    h.channels.push(rec);
    const ch = {
      on: (_t: string, cfg: { event: string; table: string; filter?: string }, cb: (p: { new: unknown }) => void) => { rec.bindings.push({ ...cfg, cb }); return ch; },
      subscribe: (cb: (s: string) => void) => { rec.status = cb; return ch; },
      __rec: rec,
    };
    return ch;
  };
  return { supabase: { channel: make, removeChannel: (ch: { __rec: { removed: boolean } }) => { ch.__rec.removed = true; return Promise.resolve("ok"); } } };
});
vi.mock("@/lib/telemetry", () => ({ recordRealtime: (s: string) => h.realtime.push(s) }));

const { addFeedLiveConsumer, refreshFeedLive, __resetFeedLive } = await import("@/lib/realtime/feedLive");

const ME = "00000000-0000-4000-8000-0000000000aa";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const consumer = (posts: string[], authors: string[]) => ({
  userId: ME, postIds: () => posts, authorIds: () => authors,
  onInsert: vi.fn(), onUpdate: vi.fn(), onReaction: vi.fn(),
});
const open = () => h.channels.filter((c) => !c.removed);
const HOT = /^(posts|post_reactions|post_comments|post_shares)$/;

beforeEach(() => { __resetFeedLive(); h.channels.length = 0; h.realtime.length = 0; });

describe("S6-b feed-live", () => {
  it("three consumers (feed, wall, composer) share ONE channel; no hot binding is unfiltered; no DELETE binding", () => {
    const feed = consumer([id(1), id(2)], [id(50)]);
    addFeedLiveConsumer(feed);
    addFeedLiveConsumer(consumer([id(3)], [ME]));
    addFeedLiveConsumer(consumer([], []));
    refreshFeedLive(true);
    open()[open().length - 1].status!("SUBSCRIBED");
    expect(open()).toHaveLength(1);
    const ch = open()[0];
    expect(ch.topic.startsWith(`feed-live:${ME}:`)).toBe(true);
    for (const b of ch.bindings) {
      if (HOT.test(b.table)) expect(b.filter, `${b.table} ${b.event}`).toMatch(/=in\.\(/);
      expect(b.event).not.toBe("DELETE");
    }
    expect(ch.bindings.map((b) => `${b.table} ${b.event} ${b.filter}`)).toEqual([
      `posts INSERT user_id=in.(${ME},${id(50)})`,
      `posts UPDATE id=in.(${id(1)},${id(3)},${id(2)})`,
      `post_reactions INSERT post_id=in.(${id(1)},${id(3)},${id(2)})`,
    ]);
  });

  it("scrolling rebuilds the filter and leaves exactly one channel; lists are capped at 100", () => {
    const posts = [id(1)];
    addFeedLiveConsumer(consumer(posts, []));
    for (let n = 2; n <= 150; n++) posts.push(id(n));
    refreshFeedLive(true);
    // the old channel stays until the new one is subscribed — no lost events
    expect(open()).toHaveLength(2);
    open()[1].status!("SUBSCRIBED");
    expect(open()).toHaveLength(1);
    const f = open()[0].bindings.find((b) => b.table === "posts" && b.event === "UPDATE")!.filter!;
    expect(f.split(",")).toHaveLength(100);
  });

  it("a consumer registered AFTER the build, with the same filters, still receives events (review #520 B1)", () => {
    const feed = consumer([id(1)], []);
    addFeedLiveConsumer(feed);
    const composer = consumer([], []);
    addFeedLiveConsumer(composer);
    refreshFeedLive(true); // same signature: no rebuild
    expect(h.channels).toHaveLength(1);
    const upd = open()[0].bindings.find((b) => b.table === "posts" && b.event === "UPDATE")!;
    upd.cb({ new: { id: id(1) } });
    expect(feed.onUpdate).toHaveBeenCalledTimes(1);
    expect(composer.onUpdate).toHaveBeenCalledTimes(1);
  });

  it("the 100 slots are shared round-robin between consumers", () => {
    addFeedLiveConsumer(consumer(Array.from({ length: 150 }, (_, n) => id(n)), []));
    addFeedLiveConsumer(consumer([id(900)], []));
    refreshFeedLive(true);
    const ch = open()[open().length - 1];
    expect(ch.bindings.find((b) => b.table === "posts" && b.event === "UPDATE")!.filter).toContain(id(900));
  });

  it("subscribe status goes to S2 telemetry; the last consumer gone = no channel", () => {
    const a = consumer([id(1)], []);
    const b = consumer([id(1)], []);
    const offA = addFeedLiveConsumer(a);
    const offB = addFeedLiveConsumer(b);
    refreshFeedLive(true);
    const ch = open()[0];
    ch.status!("SUBSCRIBED");
    expect(h.realtime).toEqual(["SUBSCRIBED"]);
    offA();
    offB();
    expect(open()).toHaveLength(0);
  });
});
