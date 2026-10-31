/**
 * S7b-4 review #564 (BLOCKING): one cap of 200 records per member, oldest out
 * first, across every kind of record. Opening ~100 posts with their comment
 * threads pushed the saved feed's chunks (written once per save, so usually the
 * oldest) out of the store, and the feed read as EMPTY in flight mode. Now each
 * kind of "seen" record has its own cap and evicts only its own kind, and the
 * saved feed is never evicted by anything else.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { memoryBackend, setBackend, putRecord, readAll, GROUP_CAPS } from "@/lib/offline/deviceStore";
import { recordFeedPage, flushFeedArchive, readFeedPage, resetFeedArchiveMemory } from "@/lib/offline/feedArchive";
import { rememberPost, rememberThread } from "@/lib/offline/seenContent";

const ME = "me-1";
beforeEach(() => { setBackend(memoryBackend()); resetFeedArchiveMemory(); });

describe("the saved feed survives everything else the member opens", () => {
  it("100 posts + 100 threads + 60 walls later, the saved feed is all there", async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}` }));
    await recordFeedPage(ME, 0, page, { warm: false, saveDelayMs: 0 });
    await flushFeedArchive();
    let t = Date.now() + 1;
    for (let i = 0; i < 100; i++) {
      await rememberPost(ME, { id: `p${i}` });
      await rememberThread(ME, `p${i}`, [{ id: `c${i}` }], {});
    }
    for (let i = 0; i < 60; i++) await putRecord(ME, ["user-wall-posts", `u${i}`], { pages: [] }, t++);
    resetFeedArchiveMemory();
    expect((await readFeedPage(ME, 0, 100)).posts).toHaveLength(50);
  });

  it("each kind keeps at most its own cap, newest kept", async () => {
    for (let i = 0; i < GROUP_CAPS["seen-post"] + 10; i++) await putRecord(ME, ["seen-post", `p${i}`], { id: `p${i}` }, 1000 + i);
    const posts = (await readAll(ME, 2000)).filter((r) => r.key[0] === "seen-post");
    expect(posts).toHaveLength(GROUP_CAPS["seen-post"]);
    expect(posts.some((r) => r.key[1] === "p0")).toBe(false);
  });

  it("review #564: the member's OWN wall and profile survive browsing many other members", async () => {
    let t = 1000;
    await putRecord(ME, ["user-wall-posts", ME], { mine: true }, t++);
    await putRecord(ME, ["profile-core", ME], { full_name: "Me" }, t++);
    for (let i = 0; i < 80; i++) {
      await putRecord(ME, ["user-wall-posts", `u${i}`], {}, t++);
      await putRecord(ME, ["profile-core", `u${i}`], {}, t++);
    }
    const all = await readAll(ME, t);
    expect(all.some((r) => r.key[0] === "user-wall-posts" && r.key[1] === ME)).toBe(true);
    expect(all.some((r) => r.key[0] === "profile-core" && r.key[1] === ME)).toBe(true);
  });

  it("review #564: the shared cap never takes the saved feed or own records, only others' (both caps together)", async () => {
    let t = 1000;
    for (let i = 0; i < 4; i++) await putRecord(ME, ["feed-archive", i], [{ id: `f${i}` }], t++);
    await putRecord(ME, ["notifications", ME], { n: 1 }, t++);
    // kinds with no cap of their own fill the store past the shared cap
    for (let i = 0; i < 230; i++) await putRecord(ME, ["ungrouped-kind", `x${i}`], {}, t++);
    const all = await readAll(ME, t);
    expect(all.length).toBeLessThanOrEqual(205);
    expect(all.filter((r) => r.key[0] === "feed-archive")).toHaveLength(4);
    expect(all.some((r) => r.key[0] === "notifications")).toBe(true);
  });
});

