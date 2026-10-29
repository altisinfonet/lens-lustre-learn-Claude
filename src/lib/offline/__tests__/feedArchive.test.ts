/**
 * S7b-3 · the saved feed: ~200 posts kept on the phone in the order seen.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { memoryBackend, setBackend } from "@/lib/offline/deviceStore";
import {
  ARCHIVE_MAX_POSTS, flushFeedArchive, readFeedPage, recordFeedPage, resetFeedArchiveMemory, savedFeedCount,
} from "@/lib/offline/feedArchive";

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
});
