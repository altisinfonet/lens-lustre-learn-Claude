/**
 * VID-1 · a video post shows its video on EVERY surface that renders posts.
 *
 * Owner, staging 2026-10-11 (lena.petrov?section=wall): the uploaded video post
 * appeared on the wall as an EMPTY post. Only useFeedQuery attached
 * post.video (fetchPostVideoMap); the wall (useUserPostsQuery), the single-post
 * page (PostDetail) and the hashtag page built posts without it, so PostCard
 * had nothing to play. Each builder must read the video through the same
 * function and drop posts whose video is not playable for this viewer
 * ("hidden": not ready, or not visible), exactly as the feed does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BUILDERS = [
  "src/hooks/feed/useFeedQuery.ts",
  "src/hooks/feed/useUserPostsQuery.ts",
  "src/pages/PostDetail.tsx",
  "src/pages/HashtagFeed.tsx",
];

describe.each(BUILDERS)("%s", (file) => {
  const src = readFileSync(file, "utf8");
  it("reads post videos through fetchPostVideoMap", () => {
    expect(src).toMatch(/import \{[^}]*fetchPostVideoMap[^}]*\} from "@\/lib\/video\/postVideoRead"/);
    expect(src).toMatch(/fetchPostVideoMap\(/);
  });
  it("puts the video on the post it builds", () => {
    // Either the inline "hidden"-stripping form, or PostDetail's form after it
    // has already returned on "hidden".
    expect(src).toMatch(/video:\s*(\(\(\): FeedVideo \| null|videoEntry \?\? null)/);
  });
  it("drops a post whose video is hidden for this viewer", () => {
    expect(src).toMatch(/!==\s*"hidden"|===\s*"hidden"/);
  });
});
