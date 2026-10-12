/**
 * ONE ANSWER TO "WHAT DOES THIS POST / AD SHOW?" — ON EVERY SCREEN.
 *
 * Owner, staging 2026-10-12, a video ad: "Video running but comment box still
 * image … for every error did different different screen". The card played
 * the video; the comments box beside it showed the ad's still picture, because
 * each screen decided for itself. A video post's comments box showed nothing,
 * its wall-grid tile was an empty photo tile, and one arriving live in the
 * feed showed with no video until a refresh.
 *
 * The structure now: src/lib/posts/subjectMedia.ts decides (video, else
 * photographs — never both), every screen draws that value, and the comments
 * box draws the very value its card drew. This file fails when a screen works
 * it out some other way, or when a new screen draws a video without joining.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-utils/sourceText";
import { adMedia, hasMedia, NO_MEDIA, postMedia } from "@/lib/posts/subjectMedia";

const V = { id: "33333333-3333-4333-8333-333333333333", width: 1080, height: 1920, durationS: 20, hasAudio: true };
const read = (f: string) => stripComments(readFileSync(f, "utf8"));

describe("subjectMedia — the one decision", () => {
  it("a post with a video shows the video and no photographs", () => {
    expect(postMedia({ video: V, image_urls: ["https://x/a.jpg"], image_url: "https://x/a.jpg" })).toEqual({ video: V, imageUrls: [] });
  });
  it("a photo post shows its photographs, else the single legacy image_url", () => {
    expect(postMedia({ image_urls: ["https://x/a.jpg", "https://x/b.jpg"] })).toEqual({ video: null, imageUrls: ["https://x/a.jpg", "https://x/b.jpg"] });
    expect(postMedia({ image_urls: [], image_url: "https://x/l.jpg" })).toEqual({ video: null, imageUrls: ["https://x/l.jpg"] });
  });
  it("a text post has no media; blank URLs never count as a photograph", () => {
    expect(postMedia({ image_urls: [], image_url: "" })).toEqual(NO_MEDIA);
    expect(hasMedia(postMedia({ image_urls: null, image_url: null }))).toBe(false);
  });
  it("an ad with a video shows the video, never its picture; without one, its picture", () => {
    expect(adMedia({ video: V, image_url: "https://x/ad.jpg" })).toEqual({ video: V, imageUrls: [] });
    expect(adMedia({ video: null, image_url: "https://x/ad.jpg" })).toEqual({ video: null, imageUrls: ["https://x/ad.jpg"] });
  });
});

/** Every screen that draws a post's or an ad's video. A new one must join this list (the sweep below fails until it does). */
const VIDEO_SURFACES: Record<string, RegExp> = {
  "src/components/post/PostCard.tsx": /<FeedVideoCard video=\{media\.video\}/,
  "src/pages/HashtagFeed.tsx": /<FeedVideoCard video=\{media\.video\}/,
  "src/components/ads/AdZone.tsx": /<FeedVideoCard video=\{media\.video\} fillParent \/>/,
  "src/pages/AdDetail.tsx": /<FeedVideoCard video=\{media\.video\}/,
  "src/components/comments/CommentsOverlay.tsx": /<FeedVideoCard video=\{media\.video\} fillParent \/>/,
  "src/components/profile/ProfilePostGrid.tsx": /<VideoPoster video=\{video\}/,
};

describe.each(Object.entries(VIDEO_SURFACES))("%s", (file, draws) => {
  const src = read(file);
  it("takes its media from subjectMedia and draws THAT value", () => {
    expect(src).toMatch(/from "@\/lib\/posts\/subjectMedia"/);
    expect(src).toMatch(draws);
  });
  it("never reads a video straight off the post / creative to draw it", () => {
    expect(src).not.toMatch(/<(FeedVideoCard|VideoPoster) video=\{(post|creative|chosen|subject)\.video\}/);
  });
});

describe("no screen draws a video without joining the list above", () => {
  it("every file that renders <FeedVideoCard> or <VideoPoster> is a listed surface", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(rel); }
        else if (/\.tsx$/.test(e.name)) files.push(rel);
      }
    };
    walk("src");
    const drawing = files.filter((f) => /<(FeedVideoCard|VideoPoster)\b/.test(read(f)));
    expect(drawing.sort()).toEqual(Object.keys(VIDEO_SURFACES).sort());
  });
});

describe("the comments box draws what the card drew — it decides nothing", () => {
  it("the subject carries media for posts AND ads; a post's is postMedia(post), an ad's is the card's own", () => {
    const ctx = read("src/contexts/CommentsOverlayContext.tsx");
    expect(ctx).toMatch(/\{ kind: "post"; post: UnifiedPost; media: SubjectMedia \}/);
    expect(ctx).toMatch(/\{ kind: "ad"; creativeId: string; media: SubjectMedia \}/);
    expect(ctx).toMatch(/media: postMedia\(nextPost\)/);
    expect(ctx).toMatch(/openAdComments: \(creativeId: string, media: SubjectMedia/);
  });
  it("the overlay reads subject.media and works out no picture of its own", () => {
    const overlay = read("src/components/comments/CommentsOverlay.tsx");
    expect(overlay).toMatch(/const \{ media \} = subject;/);
    expect(overlay).not.toMatch(/image_urls|image_url\b|imageUrl\b|coverImage/);
  });
  it("the ad bar forwards the media it was given — no picture-only prop left", () => {
    const bar = read("src/components/ads/AdEngagementBar.tsx");
    expect(bar).toMatch(/openAdComments\(creativeId, media, reload\)/);
    expect(bar).not.toMatch(/imageUrl/);
  });
});
