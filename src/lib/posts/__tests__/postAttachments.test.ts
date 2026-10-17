/**
 * postAttachments — what every surface gets for one post.
 */
import { describe, expect, it } from "vitest";
import { attachmentsFor, type PostAttachments } from "../postAttachments";
import type { FeedVideo } from "@/lib/video/postVideoRead";

const VIDEO = { id: "v1", width: 1080, height: 1920 } as unknown as FeedVideo;
const att = (over: Partial<PostAttachments> = {}): PostAttachments => ({
  media: new Map(), video: new Map(), ...over,
});

describe("attachmentsFor", () => {
  it("a video post carries its video", () => {
    expect(attachmentsFor(att({ video: new Map([["p", VIDEO]]) }), "p", [])).toEqual({ image_urls: [], video: VIDEO });
  });

  it("a video this viewer may not play → null: the surface drops the post, never shows it empty", () => {
    expect(attachmentsFor(att({ video: new Map([["p", "hidden"]]) }), "p", ["https://x/a.jpg"])).toBeNull();
  });

  it("a photo post with no media rows falls back to the URLs on the post row", () => {
    expect(attachmentsFor(att(), "p", ["https://x/a.jpg"])).toEqual({ image_urls: ["https://x/a.jpg"], video: null });
  });

  it("media rows win over the legacy URLs (the media graph first)", () => {
    const r = attachmentsFor(att({ media: new Map([["p", ["https://cdn/m.webp"]]]) }), "p", ["https://x/old.jpg"]);
    expect(r?.image_urls).toEqual(["https://cdn/m.webp"]);
  });
});
