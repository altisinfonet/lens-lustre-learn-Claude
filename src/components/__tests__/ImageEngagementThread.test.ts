/**
 * A PHOTOGRAPH'S COMMENTS ARE THE ONE SHARED THREAD (central-control plan C2).
 *
 * ImageEngagement drew a third comment row of its own. It is now a data adapter
 * on `image_comments`, as CommentsSection became in #875. What must not change
 * with the drawing is pinned here: this table has no comment likes, its
 * moderation runs on INSERT only so a comment cannot be edited, and a reply
 * cannot be replied to.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toThread } from "@/components/comments/imageCommentThread";

const src = readFileSync(join(process.cwd(), "src/components/ImageEngagement.tsx"), "utf8");

const row = {
  id: "c1", user_id: "u1", content: "Lovely", parent_id: null, created_at: "2026-11-01T00:00:00Z",
  profile_name: "Amit", avatar_url: "a.webp", author_handle: "amit", badges: ["verified"],
  is_pinned: true, is_admin_seed: true,
  replies: [{
    id: "c2", user_id: "u2", content: "Thanks", parent_id: "c1", created_at: "2026-11-02T00:00:00Z",
    profile_name: null, avatar_url: null, author_handle: null, badges: [],
  }],
};

describe("toThread", () => {
  it("maps a row and its replies into the shared shape", () => {
    const t = toThread(row);
    expect(t).toMatchObject({
      id: "c1", user_id: "u1", content: "Lovely", parent_id: null, is_pinned: true, is_admin_seed: true,
      author_name: "Amit", author_avatar: "a.webp", author_handle: "amit", author_badges: ["verified"],
    });
    expect(t.replies.map((r) => r.id)).toEqual(["c2"]);
    expect(t.replies[0].parent_id).toBe("c1");
  });

  it("never shows 'Edited' or a like count: the table has neither", () => {
    const t = toThread(row);
    expect(t.updated_at).toBe(t.created_at);
    expect(t.like_count).toBe(0);
    expect(t.is_liked).toBe(false);
  });

  it("gives a row with no optional columns plain defaults", () => {
    const t = toThread(row).replies[0];
    expect(t.is_pinned).toBe(false);
    expect(t.is_admin_seed).toBe(false);
    expect(t.replies).toEqual([]);
  });
});

describe("the surface", () => {
  it("draws no comment row of its own", () => {
    expect(src).toContain("<CommentThread");
    expect(src).toContain("<CommentComposer");
    expect(src).not.toMatch(/renderComment|<MentionInput|RichContentRenderer|<UserIdentityBlock/);
  });

  it("keeps this table's rules", () => {
    expect(src).toMatch(/features=\{\{ reactions: false, pinning: false, reporting: true, sorting: false, editing: false \}\}/);
    expect(src).toContain("maxReplyDepth={1}");
    expect(src).toContain("isAdmin={false}");
  });

  it("keeps the moderation and the per-photo scope on every write and read", () => {
    expect(src).toContain("moderateComment(trimmed)");
    expect(src).toContain('functions.invoke("moderate-comment"');
    expect(src).toContain('.eq("photo_index", photoIndex)');
    expect(src).toContain("photo_index: photoIndex");
  });
});
