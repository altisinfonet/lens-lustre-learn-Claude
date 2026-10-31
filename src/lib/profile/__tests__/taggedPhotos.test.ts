import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const state: { tags: unknown; tagsErr: unknown; posts: unknown; postsErr: unknown } = { tags: [], tagsErr: null, posts: [], postsErr: null };
vi.mock("@/integrations/supabase/client", () => {
  const tagsQ = { select: () => tagsQ, eq: () => tagsQ, order: () => tagsQ, range: async () => ({ data: state.tags, error: state.tagsErr }) };
  const postsQ = { select: () => postsQ, in: () => postsQ, not: async () => ({ data: state.posts, error: state.postsErr }) };
  return { supabase: { from: (t: string) => (t === "post_tags" ? tagsQ : postsQ) } };
});

import { fetchTaggedPhotosPage, nextTaggedPage } from "@/lib/profile/taggedPhotos";

const tag = (id: string) => ({ post_id: id, created_at: "2026-10-29" });
const post = (id: string) => ({ id, image_url: `https://cdn/${id}.webp`, user_id: "x", created_at: "2026-10-29" });

describe("S11 — My Photos → Tagged in tells the truth", () => {
  beforeEach(() => Object.assign(state, { tags: [], tagsErr: null, posts: [], postsErr: null }));

  it("a failed read is an error, never 'no tagged photos'", async () => {
    state.tagsErr = { message: "permission denied" };
    await expect(fetchTaggedPhotosPage("u", 0, 3)).rejects.toMatchObject({ message: "permission denied" });
    Object.assign(state, { tagsErr: null, tags: [tag("a")], postsErr: { message: "timeout" } });
    await expect(fetchTaggedPhotosPage("u", 0, 3)).rejects.toMatchObject({ message: "timeout" });
  });

  it("a full page of tags with one deleted post still asks for the next page", async () => {
    Object.assign(state, { tags: [tag("a"), tag("b"), tag("c")], posts: [post("a"), post("c")] });
    const p = await fetchTaggedPhotosPage("u", 0, 3);
    expect(p.photos.map((x) => x.id)).toEqual(["a", "c"]);
    expect(nextTaggedPage(p, 1, 3)).toBe(1);
    expect(nextTaggedPage({ photos: [], tagCount: 2 }, 4, 3)).toBeUndefined();
  });

  it("the tab shows a retry state on error and uses this reader", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../../pages/MyPhotos.tsx"), "utf8");
    const grid = src.slice(src.indexOf("const TaggedInGrid"));
    expect(grid).toContain("fetchTaggedPhotosPage(userId");
    expect(grid).toMatch(/if \(isError && photos\.length === 0\)/);
    expect(grid).not.toMatch(/if \(error \|\| !tags\?\.length\) return \[\];/);
  });
});
