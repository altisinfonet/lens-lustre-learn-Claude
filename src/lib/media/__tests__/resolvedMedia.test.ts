import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetResolvedMediaForTests, groupResolved, ladderFor, originalFor, resolvedImageUrls, type ResolvedRow,
} from "../resolvedMedia";

const P = "33333333-3333-4333-8333-333333333333";
const row = (ord: number, w: number, h: number, rung: number): ResolvedRow => ({
  post_id: P, ord, media_id: `m${ord}`, width: w, height: h, mime: "image/webp",
  url: `https://cdn.example/post-images/o/d/m${ord}/w${rung}.webp`,
});

describe("S3-c resolved media on the client", () => {
  beforeEach(() => __resetResolvedMediaForTests());

  it("shows the largest derivative per slide, in ord order, and remembers the srcset, thumb and original", () => {
    const map = groupResolved([row(1, 1440, 960, 1440), row(0, 1080, 720, 1080), row(0, 600, 400, 600), row(0, 1440, 960, 1440),
      row(1, 600, 400, 600), row(1, 1080, 720, 1080)]);
    const urls = resolvedImageUrls(map, P, ["https://cdn.example/a.webp", "https://cdn.example/b.webp"]);
    expect(urls).toEqual(["https://cdn.example/post-images/o/d/m0/w1440.webp", "https://cdn.example/post-images/o/d/m1/w1440.webp"]);
    const e = ladderFor(urls![0])!;
    expect(e.thumb).toMatch(/w600\.webp$/);
    expect(e.srcSet).toBe(
      "https://cdn.example/post-images/o/d/m0/w600.webp 600w, https://cdn.example/post-images/o/d/m0/w1080.webp 1080w, https://cdn.example/post-images/o/d/m0/w1440.webp 1440w",
    );
    expect(originalFor(urls![1])).toBe("https://cdn.example/b.webp");
  });

  it("a post the server did not resolve keeps today's path (null), and unknown URLs are untouched", () => {
    expect(resolvedImageUrls(groupResolved([]), P, ["x"])).toBeNull();
    expect(resolvedImageUrls(undefined, P, ["x"])).toBeNull();
    expect(originalFor("https://cdn.example/legacy.jpg")).toBe("https://cdn.example/legacy.jpg");
    expect(ladderFor("https://cdn.example/legacy.jpg")).toBeUndefined();
  });

  it("misaligned originals are not guessed: zoom then shows the derivative itself", () => {
    const urls = resolvedImageUrls(groupResolved([row(0, 600, 400, 600), row(0, 1080, 720, 1080)]), P, ["a", "b"]);
    expect(originalFor(urls![0])).toBe(urls![0]);
  });

  it("drops rows that are not https URLs", () => {
    const bad = { ...row(0, 600, 400, 600), url: "javascript:alert(1)" };
    expect(groupResolved([bad]).size).toBe(0);
  });
});
