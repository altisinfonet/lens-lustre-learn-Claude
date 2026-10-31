/**
 * S7b-3 · the saved feed: ~200 posts kept on the phone in the order seen.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { memoryBackend, setBackend } from "@/lib/offline/deviceStore";
import {
  ARCHIVE_MAX_POSTS, feedArchiveEpoch, flushFeedArchive, readFeedPage, recordFeedPage, resetFeedArchiveMemory, savedFeedCount,
} from "@/lib/offline/feedArchive";
import type { Backend, StoredRecord } from "@/lib/offline/deviceStore";

const ME = "me-0000";
const page = (prefix: string, n = 10) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const ids = (r: { posts: { id: string }[] }) => r.posts.map((p) => p.id);
const rec = (pi: number, p: { id: string }[], user = ME) => recordFeedPage(user, pi, p, { warm: false, saveDelayMs: 0 });

beforeEach(() => {
  resetFeedArchiveMemory();
  setBackend(memoryBackend());
});

describe("the saved feed", () => {
  it("page N saved online is page N offline", async () => {
    await rec(0, page("a"));
    await rec(1, page("b"));
    expect(ids(await readFeedPage(ME, 0, 10))).toEqual(page("a").map((p) => p.id));
    expect(ids(await readFeedPage(ME, 1, 10))).toEqual(page("b").map((p) => p.id));
    expect((await readFeedPage(ME, 1, 10)).more).toBe(false);
    expect(await savedFeedCount(ME)).toBe(20);
  });

  it("a new session goes in front; older posts follow, never twice", async () => {
    await rec(0, page("a"));
    await rec(1, page("b"));
    await rec(0, [{ id: "n0" }, { id: "a3" }]);
    await rec(1, [{ id: "n1" }]);
    const all = ids(await readFeedPage(ME, 0, 100));
    expect(all.slice(0, 3)).toEqual(["n0", "a3", "n1"]);
    expect(new Set(all).size).toBe(all.length);
    // n0, n1 + a0–a9 + b0–b9 (a3 moved to the front, not copied)
    expect(all).toHaveLength(22);
  });

  it(`keeps at most ${ARCHIVE_MAX_POSTS} posts, the newest`, async () => {
    for (let i = 0; i < 30; i++) await rec(i, page(`p${i}-`));
    expect(await savedFeedCount(ME)).toBe(ARCHIVE_MAX_POSTS);
    expect(ids(await readFeedPage(ME, 0, 10))[0]).toBe("p0-0");
  });

  it("survives the app being closed (read back from the phone's store)", async () => {
    await rec(0, page("a"));
    await rec(1, page("b"));
    await flushFeedArchive();
    resetFeedArchiveMemory();
    expect(ids(await readFeedPage(ME, 1, 10))).toEqual(page("b").map((p) => p.id));
  });

  it("review #548: signing out stops the pending save, so nothing is written back after the wipe", async () => {
    const store = memoryBackend();
    setBackend(store);
    const { wipeMemberDataOnSignOut } = await import("@/lib/offline/signOutWipe");
    // The save is due well AFTER the wipe has finished — the order a member hits.
    await recordFeedPage(ME, 0, page("a"), { warm: false, saveDelayMs: 1500 });
    await wipeMemberDataOnSignOut();
    expect([...store.map.values()].filter((r) => r.userId === ME)).toEqual([]);
    await new Promise((r) => setTimeout(r, 1800));
    expect([...store.map.values()].filter((r) => r.userId === ME)).toEqual([]);
  });

  it("is never shown to a different member on the same phone", async () => {
    await rec(0, page("a"));
    await flushFeedArchive();
    expect((await readFeedPage("someone-else", 0, 10)).posts).toEqual([]);
  });

  it("review #548: a page that was LOADING when the member signed out is not saved after the wipe", async () => {
    const store = memoryBackend();
    setBackend(store);
    const { wipeMemberDataOnSignOut } = await import("@/lib/offline/signOutWipe");
    const epoch = feedArchiveEpoch(); // the page request starts
    await wipeMemberDataOnSignOut(); // the member signs out meanwhile
    await recordFeedPage(ME, 0, page("late"), { warm: false, saveDelayMs: 0, epoch }); // the page arrives
    await flushFeedArchive();
    await new Promise((r) => setTimeout(r, 30));
    expect([...store.map.values()].filter((r) => r.userId === ME)).toEqual([]);
    expect(await savedFeedCount(ME)).toBe(0);
  });

  it("review #548: a read of member A's saved feed that finishes after B signed in never reaches B", async () => {
    const base = memoryBackend();
    await setBackendAnd(base, async () => {
      await rec(0, page("a"), "user-a");
      await flushFeedArchive();
    });
    resetFeedArchiveMemory();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: Backend = { ...base, getAll: async () => { await gate; return base.getAll(); } };
    setBackend(slow);
    const aRead = readFeedPage("user-a", 0, 10); // A's read is slow
    resetFeedArchiveMemory(); // A signs out
    setBackend(base);
    const bRec = rec(0, page("b"), "user-b"); // B signs in and scrolls
    release();
    await Promise.all([aRead, bRec]);
    const shown = ids(await readFeedPage("user-b", 0, 100));
    expect(shown.some((id) => id.startsWith("a"))).toBe(false);
  });

  it("review #548: a missing chunk (evicted) never joins the chunks around it out of order", async () => {
    for (let i = 0; i < 20; i++) await rec(i, page(`p${i}-`)); // 200 posts = 4 full chunks
    await flushFeedArchive();
    const store = memoryBackend();
    // copy the saved chunks, then lose chunk 1 (as the store's cap would)
    const { backend } = await import("@/lib/offline/deviceStore");
    const all = (await backend()!.getAll()) as StoredRecord[];
    for (const r of all) if (!(Array.isArray(r.key) && r.key[0] === "feed-archive" && r.key[1] === 1)) await store.put(r);
    setBackend(store);
    resetFeedArchiveMemory();
    const shown = ids(await readFeedPage(ME, 0, 1000));
    expect(shown).toEqual(Array.from({ length: 50 }, (_, i) => `p${Math.floor(i / 10)}-${i % 10}`));
  });

  it("review #548: two saves never overlap (a slow older save cannot land after a newer one)", async () => {
    const base = memoryBackend();
    let first = true;
    const slow: Backend = {
      ...base,
      put: async (r) => {
        if (first && Array.isArray(r.key) && r.key[0] === "feed-archive" && r.key[1] === 0) {
          first = false;
          await new Promise((res) => setTimeout(res, 60));
        }
        return base.put(r);
      },
    };
    setBackend(slow);
    await rec(0, page("old"));
    const s1 = flushFeedArchive(); // slow save of [old]
    await rec(0, page("new")); // a new session in front
    const s2 = flushFeedArchive();
    await Promise.all([s1, s2]);
    resetFeedArchiveMemory();
    setBackend(base);
    expect(ids(await readFeedPage(ME, 0, 10))).toEqual(page("new").map((p) => p.id));
  });
});

async function setBackendAnd(b: Backend, fn: () => Promise<void>) {
  setBackend(b);
  await fn();
}

