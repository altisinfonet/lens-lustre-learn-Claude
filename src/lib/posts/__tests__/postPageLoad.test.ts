/**
 * S7b-4 · THE POST PAGE WITH NO NETWORK. Before: any failed read set
 * "not found", so a member in flight mode tapping a post they had just seen
 * was told "Post not found or has been removed."
 *   · the server answers, no row      → gone (the post really is not there)
 *   · a network failure / no network  → the copy saved when it was opened
 *     online, else the post as saved in the feed (S7b-3), else "offline"
 *     (a plain "no internet" note — never "not found")
 *   · opened online                   → shown, and saved for next time
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { memoryBackend, setBackend } from "@/lib/offline/deviceStore";
import { resetFeedArchiveMemory, recordFeedPage } from "@/lib/offline/feedArchive";
import { savedPost } from "@/lib/offline/seenContent";
import { loadPostPage, type PostPageData, type PostPageDeps } from "@/lib/posts/postPageLoad";

const ME = "me-1";
const row = { id: "p1", user_id: "a1", content: "fog", image_url: null, image_urls: ["https://x/1.jpg"], privacy: "public", created_at: "2026-10-01T00:00:00Z" };
const netErr = { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" };

function deps(over: Partial<PostPageDeps> = {}): PostPageDeps {
  return {
    online: () => true,
    readPost: async () => ({ data: row, error: null }),
    readDetails: async (p) => ({
      ...p, content: p.content ?? "", image_url: p.image_url ?? null, privacy: p.privacy ?? "public", image_urls: p.image_urls, video: null, author_name: "Asha", author_avatar: null, author_handle: null,
      like_count: 2, comment_count: 1, share_count: 0, user_reaction: null, top_reactions: ["like"], reaction_counts: { like: 2 },
    }) as PostPageData,
    ...over,
  };
}

beforeEach(() => {
  setBackend(memoryBackend());
  resetFeedArchiveMemory();
});

describe("loadPostPage", () => {
  it("online: the post, saved for next time", async () => {
    const r = await loadPostPage("p1", ME, deps());
    expect(r.kind).toBe("post");
    await new Promise((res) => setTimeout(res, 10));
    expect((await savedPost<{ id: string }>(ME, "p1"))?.id).toBe("p1");
  });

  it("no such row: gone", async () => {
    const r = await loadPostPage("p1", ME, deps({ readPost: async () => ({ data: null, error: null }) }));
    expect(r.kind).toBe("gone");
  });

  it("network failure after it was opened online: the saved copy, not 'not found'", async () => {
    await loadPostPage("p1", ME, deps());
    await new Promise((res) => setTimeout(res, 10));
    const r = await loadPostPage("p1", ME, deps({ readPost: async () => ({ data: null, error: netErr }) }));
    expect(r).toMatchObject({ kind: "post", saved: true, post: { id: "p1", author_name: "Asha" } });
  });

  it("no network at all: no request; a post seen in the feed opens from the saved feed", async () => {
    await recordFeedPage(ME, 0, [{ ...row, id: "f1", author_name: "Ravi", author_avatar: null, like_count: 5, comment_count: 0, share_count: 0, is_liked: false, user_reaction: null, top_reactions: [], reaction_counts: {} } as never], { warm: false, saveDelayMs: 0 });
    const readPost = vi.fn();
    const r = await loadPostPage("f1", ME, deps({ online: () => false, readPost }));
    expect(readPost).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: "post", saved: true, post: { id: "f1", author_name: "Ravi", like_count: 5 } });
  });

  it("no network and never seen: offline (a 'no internet' note), never gone", async () => {
    expect((await loadPostPage("zz", ME, deps({ online: () => false }))).kind).toBe("offline");
    expect((await loadPostPage("zz", ME, deps({ readPost: async () => ({ data: null, error: netErr }) }))).kind).toBe("offline");
  });

  it("a refusal that is not the network (e.g. permission) is still gone", async () => {
    const r = await loadPostPage("p1", ME, deps({ readPost: async () => ({ data: null, error: { message: "permission denied", code: "42501" } }) }));
    expect(r.kind).toBe("gone");
  });

  it("review #564: a post the server says is gone stops opening offline", async () => {
    await loadPostPage("p1", ME, deps());
    await new Promise((res) => setTimeout(res, 10));
    expect((await loadPostPage("p1", ME, deps({ readPost: async () => ({ data: null, error: null }) }))).kind).toBe("gone");
    await new Promise((res) => setTimeout(res, 10));
    expect((await loadPostPage("p1", ME, deps({ online: () => false }))).kind).toBe("offline");
  });

  it("review #564: a page that was loading when the member signed out is not saved after the wipe", async () => {
    const { wipeMemberDataOnSignOut } = await import("@/lib/offline/signOutWipe");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const p = loadPostPage("p1", ME, deps({ readPost: async () => { await gate; return { data: row, error: null }; } }));
    await wipeMemberDataOnSignOut();
    release();
    await p;
    await new Promise((res) => setTimeout(res, 10));
    expect(await savedPost(ME, "p1")).toBeNull();
  });
});

