import { describe, expect, it } from "vitest";
import { commentIdFromDedupKey, isCommentNotificationType } from "@/lib/notificationComment";

const C = "ccccccc1-0000-4000-8000-000000000901";
const M = "11111111-1111-4111-8111-111111111111";

describe("S4-b · the comment a comment notification is about", () => {
  it("reads the comment id from every dedup_key the database writes for a comment", () => {
    expect(commentIdFromDedupKey(`post_comment:${C}:owner`)).toBe(C);
    expect(commentIdFromDedupKey(`post_comment:${C}:reply`)).toBe(C);
    expect(commentIdFromDedupKey(`tagged_post_comment:${C}:${M}`)).toBe(C);
  });
  it("names nothing for any other key, a missing key or a malformed id", () => {
    expect(commentIdFromDedupKey(null)).toBeNull();
    expect(commentIdFromDedupKey(`post_reaction:${C}:owner`)).toBeNull();
    expect(commentIdFromDedupKey("post_comment:not-a-uuid:owner")).toBeNull();
    expect(commentIdFromDedupKey(`post_comment:${C}"),or(x:owner`)).toBeNull();
  });
  it("only comment types open on a comment", () => {
    for (const t of ["post_comment", "comment_reply", "tagged_post_comment"]) expect(isCommentNotificationType(t)).toBe(true);
    for (const t of ["post_reaction", "new_post_from_following", "", null, undefined]) expect(isCommentNotificationType(t)).toBe(false);
  });
});
