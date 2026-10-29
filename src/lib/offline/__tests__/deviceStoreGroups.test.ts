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
});
