/**
 * PHOTO SPEED (Owner, 5 Nov 2026): "photo must come in App less than 1 sec" and
 * "why two side not filled up? showing borders".
 *
 *  - feedPhotoFit: a photo within FEED_FILL_MAX_TRIM (10 %) of its frame FILLS it
 *    (object-cover); one that would lose more is shown whole (object-contain).
 *  - An OLD photo (no set marker, no `-l3`) whose stored clean 1080 the
 *    post_photo_feed_copies lookup (20261110_0112) names shows that copy — never
 *    its multi-MB original. While the lookup is pending the sharp layer is not
 *    started; the stored 600 preview shows.
 *  - A `-l3` photo with stored rungs: the feed srcset no longer offers the original.
 *  - A photo shown whole ("contain") always has its blurred fill.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

type RpcResult = { data: unknown; error: { message?: string } | null };
let answerLookup: ((r: RpcResult) => void) | null = null;
const rpc = vi.fn((fn: string, _args?: Record<string, unknown>): Promise<RpcResult> => {
  if (fn === "post_photo_feed_copies") return new Promise((res) => { answerLookup = res; });
  return Promise.resolve({ data: null, error: null });
});
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "in", "is", "not", "order", "limit", "range", "or", "neq", "gte", "lte", "match", "filter"]) chain[k] = self;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.single = async () => ({ data: null, error: null });
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args),
      from: () => chain,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
vi.mock("@/hooks/core/useDownloadImage", () => ({ useDownloadImage: () => ({ downloading: null, download: vi.fn() }) }));

import PostMedia from "@/components/post/PostMedia";
import { FEED_FILL_MAX_TRIM, feedPhotoFit } from "@/lib/imageFrame";
import { __resetFeedCopies, requestFeedCopies } from "@/lib/photoFeedCopies";

const CDN = "https://cdn-staging.50mmretina.com/post-images/0b4c2f1e-1111-4a2b-8c3d-123456789abc/posts";
const OLD = `${CDN}/1700000000000-old.jpg`;
const OLD_THUMB = `${CDN}/1700000000000-old-thumb.webp`;
const OLD_1080 = `${CDN}/1700000000000-old-l4-r1080.webp`;
const OLD_600 = `${CDN}/1700000000000-old-l4-thumb.webp`;

const settle = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const imgs = (c: HTMLElement) => Array.from(c.querySelectorAll("img"));
const sharp = (c: HTMLElement) => imgs(c).find((i) => !i.hasAttribute("aria-hidden"));
const preview = (c: HTMLElement) => c.querySelector("img[data-feed-preview]") as HTMLImageElement | null;
const blurFill = (c: HTMLElement) => imgs(c).find((i) => i.hasAttribute("aria-hidden") && /blur-/.test(i.className));

beforeEach(() => {
  __resetFeedCopies();
  answerLookup = null;
  rpc.mockClear();
});

describe("feedPhotoFit — fill like Instagram, never lose more than 10 %", () => {
  it("fills a frame it is within FEED_FILL_MAX_TRIM of; shows a far-off photo whole", () => {
    expect(FEED_FILL_MAX_TRIM).toBe(0.1);
    expect(feedPhotoFit(0.784, 0.8)).toBe("cover"); // a hair taller than 4:5 → fill
    expect(feedPhotoFit(0.73, 0.8)).toBe("cover"); // ~9 % trimmed
    expect(feedPhotoFit(0.71, 0.8)).toBe("contain"); // ~11 % → whole
    expect(feedPhotoFit(0.5625, 0.8)).toBe("contain"); // 9:16 phone shot → whole, blurred fill beside
    expect(feedPhotoFit(3, 1.91)).toBe("contain"); // a panorama in the widest frame
    expect(feedPhotoFit(1.5, 1.5)).toBe("cover");
    expect(feedPhotoFit(null, 0.8)).toBe("contain"); // unknown shape → never crop
  });

  it("the feed card draws the 0.784 photo object-cover and the 9:16 one object-contain", () => {
    const a = render(<PostMedia urls={[`${CDN}/1-w1176h1500-l3.webp`]} />); // 0.784
    expect(sharp(a.container)!.className).toContain("object-cover");
    const b = render(<PostMedia urls={[`${CDN}/2-w1080h1920-l3.webp`]} />); // 0.5625
    expect(sharp(b.container)!.className).toContain("object-contain");
  });
});

describe("an OLD photo never loads its original in the feed when a clean 1080 is stored", () => {
  it("while the lookup is pending: no sharp layer, the stored 600 preview shows", async () => {
    requestFeedCopies("p1", [OLD]);
    const { container } = render(<PostMedia urls={[OLD]} thumbUrls={[OLD_THUMB]} />);
    await settle();
    expect(rpc).toHaveBeenCalledWith("post_photo_feed_copies", { p_post_ids: ["p1"] });
    expect(sharp(container)).toBeUndefined();
    expect(preview(container)!.getAttribute("src")).toBe(OLD_THUMB);
    for (const i of imgs(container)) expect(i.getAttribute("src")).not.toBe(OLD);
  });

  it("the answer names a -l4-r1080: that file is the sharp layer, no srcset, never the original", async () => {
    requestFeedCopies("p1", [OLD]);
    const { container } = render(<PostMedia urls={[OLD]} thumbUrls={[OLD_THUMB]} />);
    await settle();
    await act(async () => {
      answerLookup!({ data: [{ src_url: OLD, feed_url: OLD_1080, thumb_url: OLD_600 }], error: null });
      await new Promise((r) => setTimeout(r, 10));
    });
    const img = sharp(container)!;
    expect(img.getAttribute("src")).toBe(OLD_1080);
    expect(img.hasAttribute("srcset")).toBe(false);
    for (const i of imgs(container)) {
      expect(i.getAttribute("src")).not.toBe(OLD);
      expect(i.getAttribute("srcset") ?? "").not.toContain(OLD);
    }
  });

  it("an answer naming a credited -l4 master is refused: the original, as before", async () => {
    requestFeedCopies("p1", [OLD]);
    const { container } = render(<PostMedia urls={[OLD]} thumbUrls={[OLD_THUMB]} />);
    await settle();
    await act(async () => {
      answerLookup!({ data: [{ src_url: OLD, feed_url: `${CDN}/1700000000000-old-l4.webp`, thumb_url: null }], error: null });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(sharp(container)!.getAttribute("src")).toBe(OLD);
  });
});

describe("a -l3 photo with stored rungs: the feed never offers its original", () => {
  it("portrait srcset = thumb + rungs, no original", () => {
    const L3 = `${CDN}/3-w2400h3000-l3.webp`;
    const L3_THUMB = `${CDN}/3-w2400h3000-l3-thumb.webp`;
    const { container } = render(<PostMedia urls={[L3]} thumbUrls={[L3_THUMB]} />);
    const set = sharp(container)!.getAttribute("srcset")!;
    expect(set).toBe(`${L3_THUMB} 480w, ${CDN}/3-w2400h3000-l3-r1080.webp 864w, ${CDN}/3-w2400h3000-l3-r1440.webp 1152w`);
    expect(set).not.toContain(`${L3} `);
  });
});

describe("a photo shown whole always has its blurred fill", () => {
  const L6 = `${CDN}/4-w1152h2048-l6.webp`; // 9:16 → contain in the 4:5 frame
  const L6_THUMB = `${CDN}/4-w1152h2048-l6-thumb.webp`;

  it("a -l6 9:16 photo: object-contain, and its -thumb is the blurred fill", () => {
    const { container } = render(<PostMedia urls={[L6]} />);
    expect(sharp(container)!.className).toContain("object-contain");
    expect(blurFill(container)!.getAttribute("src")).toBe(L6_THUMB);
  });

  it("…even when the sharp copy was already cached at mount (the fill is not just a placeholder)", () => {
    const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
    const natural = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 1080 });
    try {
      const { container } = render(<PostMedia urls={[L6]} />);
      expect(blurFill(container)!.getAttribute("src")).toBe(L6_THUMB);
      expect(preview(container)).toBeNull(); // cached → no preview request
      expect(sharp(container)!.className).toMatch(/opacity-100/);
    } finally {
      if (complete) Object.defineProperty(HTMLImageElement.prototype, "complete", complete);
      else delete (HTMLImageElement.prototype as { complete?: boolean }).complete;
      if (natural) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", natural);
      else delete (HTMLImageElement.prototype as { naturalWidth?: number }).naturalWidth;
    }
  });
});
