/**
 * These tests exist for ONE failure, and it is a failure a member sees:
 * a like that counts up by two.
 *
 * Every reaction fires two realtime events — a `post_reactions` INSERT (a +1
 * delta) and a `posts` UPDATE (the absolute new total, written by
 * `trg_update_post_likes_count`). Apply both and the number is wrong. The rule
 * is one writer per field, and the source assertions at the bottom are what
 * stop someone re-adding the delta later "because the count looked slow".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapServerCounts, topReactionsFrom, applyReactionDelta } from "@/lib/feed/realtimeCounts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the server's counts reach the fields the UI actually reads", () => {
  it("renames all three — this is the bug that made post updates a no-op", () => {
    // posts.likes_count -> like_count, etc. The old code spread the raw row
    // straight on, so the real numbers landed as three unused keys.
    expect(mapServerCounts({ likes_count: 7, comments_count: 3, shares_count: 2 }))
      .toEqual({ like_count: 7, comment_count: 3, share_count: 2 });
  });

  it("omits what the payload does not carry, rather than zeroing it", () => {
    // A partial row must never blank a counter that is correct on screen.
    expect(mapServerCounts({ likes_count: 4 })).toEqual({ like_count: 4 });
    expect(mapServerCounts({})).toEqual({});
    expect(mapServerCounts(null)).toEqual({});
    expect(mapServerCounts({ likes_count: null })).toEqual({});
  });

  it("never renders a negative count", () => {
    // Below zero is always someone else's bug; showing "-1 likes" makes it ours.
    expect(mapServerCounts({ likes_count: -3 })).toEqual({ like_count: 0 });
  });
});

describe("the reaction delta keeps the per-type breakdown and nothing else", () => {
  it("⚠ NEVER returns like_count — that is the double-count", () => {
    const out = applyReactionDelta({ like: 2 }, "like", "INSERT");
    expect(out).not.toHaveProperty("like_count");
    expect(out).not.toHaveProperty("comment_count");
    expect(out).not.toHaveProperty("share_count");
  });

  it("adds and removes the right type", () => {
    expect(applyReactionDelta({ like: 2, love: 1 }, "love", "INSERT").reaction_counts)
      .toEqual({ like: 2, love: 2 });
    expect(applyReactionDelta({ like: 2, love: 1 }, "love", "DELETE").reaction_counts)
      .toEqual({ like: 2, love: 0 });
  });

  it("floors a type at zero when deletes outrun inserts", () => {
    expect(applyReactionDelta({ wow: 0 }, "wow", "DELETE").reaction_counts).toEqual({ wow: 0 });
  });

  it("does not mutate the map it was handed", () => {
    // patchPost merges the return value; mutating `current` in place would
    // change the cached object React Query is still holding.
    const before = { like: 1 };
    applyReactionDelta(before, "like", "INSERT");
    expect(before).toEqual({ like: 1 });
  });

  it("survives an event with no reaction type", () => {
    expect(applyReactionDelta({ like: 1 }, undefined, "INSERT").reaction_counts).toEqual({ like: 1 });
  });

  it("ranks the top three and drops empties", () => {
    expect(topReactionsFrom({ like: 5, love: 9, wow: 0, haha: 2, sad: 7 }))
      .toEqual(["love", "sad", "like"]);
  });
});

describe("⚠ both consumers obey the one-writer rule — checked in their source", () => {
  // Unit tests cannot catch a caller quietly reinstating the delta. These can.
  const feed = read("src/pages/Feed.tsx");
  const wall = read("src/components/WallPosts.tsx");

  for (const [name, src] of [["Feed.tsx", feed], ["WallPosts.tsx", wall]] as const) {
    it(`${name} routes server counts through mapServerCounts`, () => {
      expect(src).toContain("mapServerCounts");
    });

    it(`${name} does NOT hand-roll a like_count delta`, () => {
      // The exact shape that was there before, and the shape someone would
      // reach for again: like_count: <something> + delta.
      expect(src).not.toMatch(/like_count:\s*Math\.max\(0,\s*current\.like_count\s*[+-]/);
    });

    it(`${name} no longer subscribes to comment or share counters`, () => {
      // Those two child-table bindings were removed; the counts ride the
      // `posts` UPDATE now. A reappearing prop means someone re-added them.
      expect(src).not.toMatch(/onCommentChange:/);
      expect(src).not.toMatch(/onShareChange:/);
    });
  }

  it("the realtime hook keeps post_reactions and has dropped the other two", () => {
    const hook = read("src/hooks/feed/useRealtimeFeed.ts");
    const body = hook.slice(hook.indexOf('.channel("feed-live")'), hook.indexOf(".subscribe()"));
    expect(body).toContain('table: "post_reactions"');   // breakdown has no other source
    expect(body).not.toContain('table: "post_comments"');
    expect(body).not.toContain('table: "post_shares"');
  });

  it("the hook still delivers counter updates for the member's OWN posts", () => {
    // It used to `return` outright on own posts, which threw away every count
    // change on your own photos. Removing the child bindings would then have
    // frozen those counts silently.
    const hook = read("src/hooks/feed/useRealtimeFeed.ts");
    expect(hook).toContain("const isOwnPost = p.user_id === userIdRef.current;");
    expect(hook).toMatch(/onUpdatePost\(p,\s*isOwnPost\)/);
  });
});
