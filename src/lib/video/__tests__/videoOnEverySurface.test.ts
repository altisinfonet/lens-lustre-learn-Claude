/**
 * VID-1 · a video post shows its video on EVERY surface that renders posts.
 *
 * Owner, staging 2026-10-11 (lena.petrov?section=wall): the uploaded video post
 * appeared on the wall as an EMPTY post. Only useFeedQuery attached post.video;
 * the wall, the single-post page and the hashtag page built posts without it.
 * #402 patched the three by hand; the structure since is ONE module,
 * src/lib/posts/postAttachments.ts, that reads a post's photographs AND video
 * for every surface, and drops a post whose video this viewer may not play.
 * This file fails if a surface reads either some other way — so the next kind
 * of attachment is added once and reaches all four together.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-utils/sourceText";

const BUILDERS = [
  "src/hooks/feed/useFeedQuery.ts",
  "src/hooks/feed/useUserPostsQuery.ts",
  "src/pages/PostDetail.tsx",
  "src/pages/HashtagFeed.tsx",
  // The feed's live-arrival path (handleNewPost): a video post arriving by
  // realtime showed as an empty post until a refresh (2026-10-12).
  "src/pages/Feed.tsx",
];

describe("src/lib/posts/postAttachments.ts — the one attachments reader", () => {
  const src = stripComments(readFileSync("src/lib/posts/postAttachments.ts", "utf8"));
  it("reads photographs and video together, batched", () => {
    expect(src).toMatch(/Promise\.all\(\[fetchPostMediaMap\(postIds\), fetchPostVideoMap\(postIds\)\]\)/);
  });
  it("hides a post whose video is not playable for this viewer (null), never shows it empty", () => {
    expect(src).toMatch(/if \(v === "hidden"\) return null;/);
  });
});

describe.each(BUILDERS)("%s", (file) => {
  const src = stripComments(readFileSync(file, "utf8"));
  it("reads attachments only through postAttachments", () => {
    expect(src).toMatch(/import \{[^}]*fetchPostAttachments[^}]*attachmentsFor[^}]*\} from "@\/lib\/posts\/postAttachments"/);
    expect(src).toMatch(/fetchPostAttachments\(/);
    expect(src).not.toMatch(/fetchPostVideoMap\(|fetchPostMediaMap\(/);
  });
  it("drops a post whose attachments say this viewer must not see it", () => {
    expect(src).toMatch(/attachedById\.get\(p\.id\) !== null|attached === null/);
  });
  it("puts the video on the post it builds", () => {
    expect(src).toMatch(/\bvideo,|video: attached\.video|\.\.\.attachedById\.get\(p\.id\)!/);
  });
});
