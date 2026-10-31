/**
 * SEARCH WITHIN A THREAD — THE RULES THAT ARE NOT OBVIOUS.
 *
 * "Does the text contain the query" needs no test. What needs one is the
 * relationship between a parent and its replies, because there are two
 * different answers depending on WHICH of them matched, and getting either
 * wrong produces a result that looks plausible and reads as broken:
 *
 *   · drop a non-matching parent and a matching reply becomes an orphan —
 *     "I agree", attached to nothing, with no way to see what it agreed with;
 *   · keep every reply of a non-matching parent and searching for one word
 *     returns a conversation the member did not ask for.
 *
 * Each case below is one of those, plus the boundaries that decide whether a
 * query runs at all. These assert the FUNCTION, not a rendered sheet: the
 * rules are the thing that can be wrong, and a jsdom mount would only make
 * them slower to check, not better checked.
 */
import { describe, it, expect } from "vitest";
import {
  commentMatches,
  countComments,
  filterComments,
  normalizeQuery,
} from "@/lib/commentSearch";
import type { ThreadComment } from "@/components/comments/CommentThread";

let seq = 0;
const comment = (over: Partial<ThreadComment> = {}): ThreadComment => ({
  id: `c${++seq}`,
  user_id: "u1",
  content: "",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  parent_id: null,
  is_pinned: false,
  author_name: "Somnath",
  author_handle: "somnath_photolover22",
  author_avatar: null,
  author_badges: [],
  author_last_active: null,
  like_count: 0,
  is_liked: false,
  replies: [],
  ...over,
});

describe("what counts as a match", () => {
  it("matches the comment's own text, ignoring case", () => {
    const c = comment({ content: "Beautiful KATHI Holi frame" });
    expect(commentMatches(c, normalizeQuery("kathi"))).toBe(true);
    expect(commentMatches(c, normalizeQuery("diwali"))).toBe(false);
  });

  it("matches the author's display name and their handle", () => {
    const c = comment({ content: "👏", author_name: "Neil Basu", author_handle: "neilbasu" });
    expect(commentMatches(c, normalizeQuery("neil"))).toBe(true);
    expect(commentMatches(c, normalizeQuery("neilba"))).toBe(true);
  });

  it("matches the NAME inside a mention, never the uuid the markup carries", () => {
    // Stored form is `@[Neil Basu](uuid)`. The member sees "Neil Basu".
    const c = comment({
      content: "@[Neil Basu](7f3a1c9e-0000-4000-8000-000000000001) congratulations",
      author_name: "Sandeep",
      author_handle: "sandeep.artist.photographer",
    });
    expect(commentMatches(c, normalizeQuery("Neil Basu"))).toBe(true);
    expect(commentMatches(c, normalizeQuery("7f3a1c9e"))).toBe(false);
    // A query of raw mention punctuation must not match every mention there is.
    expect(commentMatches(c, normalizeQuery("]("))).toBe(false);
  });

  it("ignores accents on both sides, so 'jose' finds 'José'", () => {
    const c = comment({ content: "Shot with José at dawn" });
    expect(commentMatches(c, normalizeQuery("jose"))).toBe(true);
    expect(commentMatches(comment({ content: "jose" }), normalizeQuery("José"))).toBe(true);
  });
});

describe("a parent and its replies", () => {
  it("a matching PARENT keeps all of its replies — the member asked for that conversation", () => {
    const tree = [
      comment({
        content: "Congratulations on the win",
        replies: [comment({ content: "thank you" }), comment({ content: "well deserved" })],
      }),
    ];
    const out = filterComments(tree, "congratulations");
    expect(out).toHaveLength(1);
    expect(out[0].replies).toHaveLength(2);
  });

  it("a matching REPLY keeps its parent as context, and ONLY the replies that matched", () => {
    const tree = [
      comment({
        content: "Lovely light here",
        replies: [
          comment({ content: "thank you for all your support" }),
          comment({ content: "nice one" }),
        ],
      }),
    ];
    const out = filterComments(tree, "support");

    expect(out, "the parent is context — a reply with nothing above it is unreadable")
      .toHaveLength(1);
    expect(out[0].content).toBe("Lovely light here");
    expect(out[0].replies.map((r) => r.content)).toEqual(["thank you for all your support"]);
  });

  it("never promotes a matching reply out of its thread", () => {
    const tree = [comment({ content: "parent", replies: [comment({ content: "needle" })] })];
    const out = filterComments(tree, "needle");
    expect(out.map((c) => c.content)).toEqual(["parent"]);
    expect(out[0].replies.map((c) => c.content)).toEqual(["needle"]);
  });

  it("drops a thread where neither the parent nor any reply matches", () => {
    const tree = [
      comment({ content: "alpha", replies: [comment({ content: "beta" })] }),
      comment({ content: "needle here" }),
    ];
    expect(filterComments(tree, "needle").map((c) => c.content)).toEqual(["needle here"]);
  });

  it("does not mutate the array or the comments it was given", () => {
    const reply = comment({ content: "keep me" });
    const parent = comment({ content: "parent", replies: [reply, comment({ content: "drop me" })] });
    const tree = [parent];

    filterComments(tree, "keep me");

    expect(tree).toHaveLength(1);
    expect(parent.replies, "the source tree is what an un-search would render next")
      .toHaveLength(2);
  });
});

describe("the boundaries of running a query at all", () => {
  it("an empty or whitespace-only query returns the input UNCHANGED, by reference", () => {
    const tree = [comment({ content: "anything" })];
    expect(filterComments(tree, "")).toBe(tree);
    expect(filterComments(tree, "   ")).toBe(tree);
  });

  it("a query that matches nothing returns an empty list, not the whole thread", () => {
    const tree = [comment({ content: "alpha" }), comment({ content: "beta" })];
    expect(filterComments(tree, "zzz")).toEqual([]);
  });

  it("surrounding whitespace is trimmed before matching", () => {
    const tree = [comment({ content: "alpha" })];
    expect(filterComments(tree, "  alpha  ")).toHaveLength(1);
  });

  it("counts replies as results, because the member can see them", () => {
    const tree = [
      comment({ replies: [comment(), comment()] }),
      comment(),
    ];
    // One parent carrying two replies (3) plus one childless comment (1).
    expect(countComments(tree)).toBe(4);
  });
});
