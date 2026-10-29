/**
 * BUG-VID-HOME · EVERY SURFACE THAT DRAWS A POST'S MEDIA KNOWS ABOUT VIDEO.
 *
 * Owner, 2026-10-18, on live www.50mmretina.com: the home page "Share Your
 * Story" preview showed a photo post's picture but NOTHING for a video post.
 * Cause: src/pages/Index.tsx read `posts.image_url` itself and drew an <img>
 * — it never asked postAttachments.ts (which knows a post's video) or
 * subjectMedia.ts (which decides video-else-photos), so a video post, whose
 * row has no image_url, drew an empty box. The existing guards
 * (sameMediaEverywhere, videoOnEverySurface) only watched files that ALREADY
 * drew a video or were known post builders; a screen that read the photo
 * columns on its own was invisible to them.
 *
 * This file closes that hole from the other side: it finds every file that
 * READS a post's media columns (image_url / image_urls / thumbnail_urls, or
 * `*`) from `posts`, or draws a notification's post thumbnail, and fails
 * unless that file is video-aware (reads through postAttachments /
 * subjectMedia) or is listed below as not drawing post media, with the reason.
 *
 * The audited surfaces (BUG-VID-HOME gate) and what each must draw:
 *   large preview  → FeedVideoCard   (home preview, PostCard = feed / wall / post page / hashtag)
 *   small thumbnail→ VideoPoster     (profile grid, notifications)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-utils/sourceText";

const read = (f: string) => stripComments(readFileSync(f, "utf8"));

/** Surfaces that draw a post's media, and the one shared component each must draw a video with. */
const SURFACES: Record<string, { what: string; must: RegExp[] }> = {
  "src/pages/Index.tsx": {
    what: "home 'Share Your Story' preview (large) — FeedVideoCard",
    must: [
      /import \{[^}]*fetchPostAttachments[^}]*attachmentsFor[^}]*\} from "@\/lib\/posts\/postAttachments"/,
      /from "@\/lib\/posts\/subjectMedia"/,
      /postMedia\(/,
      /<FeedVideoCard video=\{media\.video\}/,
    ],
  },
  "src/pages/Notifications.tsx": {
    what: "notification thumbnail (small) — VideoPoster",
    must: [
      /from "@\/lib\/posts\/subjectMedia"/,
      /postMedia\(/,
      /<VideoPoster video=\{media\.video\}/,
    ],
  },
  "src/components/post/PostCard.tsx": {
    what: "feed, wall, post page, hashtag page (all render PostCard) — FeedVideoCard",
    must: [/postMedia\(post\)/, /<FeedVideoCard video=\{media\.video\}/],
  },
  "src/pages/PostDetail.tsx": {
    what: "single post page — renders PostCard with the video attached",
    must: [/<PostCard\b/, /video: attached\.video/],
  },
  "src/components/profile/ProfilePostGrid.tsx": {
    what: "profile grid / showcase (small) — VideoPoster",
    must: [/postMedia\(post\)/, /<VideoPoster video=\{video\}/],
  },
};

/**
 * Files that read a post's media columns but draw no post media — each with the
 * reason. A new entry here needs a reason a reviewer can check.
 */
const NOT_DRAWING_POST_MEDIA: Record<string, string> = {
  "src/pages/MyPhotos.tsx": "photographs-only page by design: its uploads query keeps only rows with image_url (.not(\"image_url\", \"is\", null)), so a video post is never drawn as an empty tile",
  "src/lib/profile/taggedPhotos.ts": "MyPhotos' Tagged tab query (moved here, S11): keeps only rows with image_url (.not(\"image_url\", \"is\", null)) and drops any without one, so a video post is never drawn as an empty tile",
};

/** A read of the posts table whose select names a media column (or every column). */
const READS_POST_MEDIA = /from\(\s*["']posts["']\s*\)[\s\S]{0,160}?\.select\(\s*["'`]([^"'`]*)["'`]/g;
const MEDIA_COL = /(^|[\s,])(\*|image_url|image_urls|thumbnail_url|thumbnail_urls)(\s*,|\s*$)/;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "integrations") walk(rel); }
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(rel);
    }
  };
  walk("src");
  return out;
}

describe("BUG-VID-HOME — the audited surfaces draw a video with the ONE shared component", () => {
  describe.each(Object.entries(SURFACES))("%s", (file, { what, must }) => {
    const src = read(file);
    it.each(must.map((re) => [re.source, re] as const))(`${what}: has %s`, (_s, re) => {
      expect(src).toMatch(re);
    });
    it("never draws a second video player or reads a video off the row to draw it", () => {
      expect(src).not.toMatch(/<video\b/);
      expect(src).not.toMatch(/<(FeedVideoCard|VideoPoster) video=\{(post|latestPost|row|group)\.video\}/);
    });
  });
});

describe("BUG-VID-HOME sweep — no file reads post media without video support", () => {
  it("every file that selects image_url / image_urls / thumbnail_urls / * from posts is video-aware or explained", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const src = read(f);
      let readsMedia = false;
      for (const m of src.matchAll(READS_POST_MEDIA)) if (MEDIA_COL.test(m[1])) readsMedia = true;
      if (!readsMedia) continue;
      const videoAware = /from "@\/lib\/posts\/(postAttachments|subjectMedia)"/.test(src);
      if (!videoAware && !(f in NOT_DRAWING_POST_MEDIA)) offenders.push(f);
    }
    expect(offenders, "these read a post's photo columns and would draw a video post as an empty box").toEqual([]);
  });

  it("the home preview no longer draws the post's image_url directly", () => {
    expect(read("src/pages/Index.tsx")).not.toMatch(/src=\{latestPost\.image_url\}/);
  });

  it("a notification's post thumbnail is drawn through postMedia, never straight from thumbnail_url", () => {
    expect(read("src/pages/Notifications.tsx")).not.toMatch(/src=\{group\.thumbnail_url\}/);
  });

  it("positive control: the sweep sees the known post readers, and no exception is stale", () => {
    const seen = sourceFiles().filter((f) => [...read(f).matchAll(READS_POST_MEDIA)].some((m) => MEDIA_COL.test(m[1])));
    expect(seen).toEqual(expect.arrayContaining(["src/hooks/feed/useFeedQuery.ts", "src/pages/PostDetail.tsx", "src/pages/Index.tsx", ...Object.keys(NOT_DRAWING_POST_MEDIA)]));
    expect(read("src/pages/MyPhotos.tsx").match(/\.not\("image_url", "is", null\)/g)).toHaveLength(1);
    expect(read("src/lib/profile/taggedPhotos.ts").match(/\.not\("image_url", "is", null\)/g)).toHaveLength(1);
  });
});
