/**
 * Tests for "photos are shown as shot, not force-cropped to 4:5"
 * (owner instruction 2026-08-01).
 *
 * WHAT WAS WRONG
 *   The card was hard-coded `aspectRatio: "4/5"` and the photo was rendered
 *   `object-cover`. Every landscape lost its sides, every panorama was
 *   destroyed, and — because the composer ALSO force-cropped to 4:5 before
 *   upload — the original never reached storage. A photography platform was
 *   silently recomposing photographers' frames.
 *
 * WHAT IT DOES NOW
 *   The frame is the photo's own ratio, clamped to 4:5 … 1.91:1, read from the
 *   dimensions the uploader writes into the filename. The photo is
 *   `object-contain`, so it is never cropped; when its ratio does not match the
 *   frame exactly, the blurred 32px LQIP behind it fills the gap.
 *
 * These pin the two failure modes that matter: a photo getting cropped again,
 * and an existing post changing shape.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import PostMedia from "@/components/post/PostMedia";

vi.mock("@/hooks/core/useDownloadImage", () => ({
  useDownloadImage: () => ({ downloading: null, download: vi.fn() }),
}));

const BASE = "https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/u/posts";
const photo = (name: string) => `${BASE}/1754000000000-abc${name}`;

/** The card is the outermost div PostMedia renders. */
const frameOf = (container: HTMLElement) =>
  (container.firstElementChild as HTMLElement).style.aspectRatio;

const sharpImg = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("img")).find((i) => !i.hasAttribute("aria-hidden"));

const backdropImg = (container: HTMLElement) =>
  container.querySelector('img[aria-hidden="true"]') as HTMLImageElement | null;

describe("PostMedia — the frame comes from the photo", () => {
  it("gives a 3:2 landscape its own shape, not 4:5", () => {
    const { container } = render(<PostMedia urls={[photo("-w3000h2000.webp")]} />);
    expect(Number(frameOf(container))).toBeCloseTo(1.5, 6);
  });

  it("gives a 4:5 portrait its own shape", () => {
    const { container } = render(<PostMedia urls={[photo("-w1080h1350.webp")]} />);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6);
  });

  it("clamps a panorama to the widest allowed frame", () => {
    const { container } = render(<PostMedia urls={[photo("-w4200h1400.webp")]} />); // 3:1
    expect(Number(frameOf(container))).toBeCloseTo(1.91, 6);
  });

  it("clamps a 9:16 phone shot to the tallest allowed frame", () => {
    const { container } = render(<PostMedia urls={[photo("-w1080h1920.webp")]} />);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6);
  });
});

describe("PostMedia — nothing already posted changes shape", () => {
  it("falls back to 4:5 for a URL with no dimensions", () => {
    // Every post made before 2026-08-01 looks like this.
    const { container } = render(<PostMedia urls={[photo(".webp")]} />);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6);
  });

  it("falls back to 4:5 for an external image", () => {
    const { container } = render(<PostMedia urls={["https://cdn.example.com/x.jpg"]} />);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6);
  });
});

describe("PostMedia — the photo is never cropped", () => {
  it("renders the sharp image object-contain, not object-cover", () => {
    const { container } = render(<PostMedia urls={[photo("-w3000h2000.webp")]} />);
    const img = sharpImg(container);
    expect(img).toBeTruthy();
    expect(img!.className).toContain("object-contain");
    expect(img!.className).not.toContain("object-cover");
  });

  it("keeps a blurred backdrop behind it to fill any bars", () => {
    const { container } = render(<PostMedia urls={[photo("-w4200h1400.webp")]} />);
    const back = backdropImg(container);
    expect(back).toBeTruthy();
    expect(back!.className).toContain("object-cover"); // the backdrop DOES fill
    expect(back!.className).toMatch(/blur-/);
    // It must be UNCONDITIONALLY visible. As a mere loading placeholder it
    // carried `transition-opacity` and faded to opacity-0 the moment the sharp
    // image arrived — which would now leave the bars empty. Asserting the
    // absence of the fade catches that regression; asserting `opacity-0` is
    // absent would not, because before load the old code also rendered
    // opacity-100.
    expect(back!.className).not.toContain("transition-opacity");
    expect(back!.className).not.toContain("opacity-0");
  });

  it("costs no extra bandwidth: the backdrop is the 32px LQIP", () => {
    const { container } = render(<PostMedia urls={[photo("-w4200h1400.webp")]} />);
    expect(backdropImg(container)!.getAttribute("src")).toContain("width=32");
  });
});

describe("PostMedia — an album has one frame", () => {
  it("takes it from the first photo and does not change per slide", () => {
    const { container } = render(
      <PostMedia urls={[photo("-w3000h2000.webp"), photo("-w1080h1350.webp"), photo("-w4200h1400.webp")]} />,
    );
    expect(Number(frameOf(container))).toBeCloseTo(1.5, 6);
  });

  it("falls back to 4:5 when the first photo carries no dimensions", () => {
    const { container } = render(<PostMedia urls={[photo(".webp"), photo("-w3000h2000.webp")]} />);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6);
  });
});

describe("PostMedia — nothing to show", () => {
  it("renders nothing for an empty album", () => {
    const { container } = render(<PostMedia urls={[]} />);
    expect(container.firstElementChild).toBeNull();
  });
});

/**
 * Cloudflare Transformations (2026-08-01).
 *
 * Post images live on cdn.50mmretina.com, which the Supabase render endpoint
 * never matched — so every card was downloading the full 2560px original.
 * Measured live: 3,450 KB of visible photos became 383 KB as AVIF at 800px.
 *
 * The two failure modes worth pinning are (a) silently reverting to full-size
 * originals, and (b) the base URL, which MUST be the hard-coded zone origin —
 * location.origin would 404 every image inside the Android app while looking
 * perfect on web.
 */
const cdn = (name: string) =>
  `https://cdn.50mmretina.com/post-images/u/posts/1754000000000-abc${name}`;

describe("PostMedia — CDN images go through Cloudflare", () => {
  it("requests a resized, auto-format variant instead of the original", () => {
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    const img = sharpImg(container)!;
    expect(img.getAttribute("src")).toContain("/cdn-cgi/image/");
    expect(img.getAttribute("src")).toContain("width=800");
    expect(img.getAttribute("src")).toContain("format=auto");
  });

  it("uses the hard-coded zone origin, never the current origin", () => {
    // jsdom's location.origin is http://localhost — if that ever leaks into the
    // URL, every image in the Capacitor app breaks while web looks fine.
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    const src = sharpImg(container)!.getAttribute("src")!;
    expect(src.startsWith("https://50mmretina.com/cdn-cgi/image/")).toBe(true);
    expect(src).not.toContain("localhost/cdn-cgi");
  });

  it("offers a responsive srcset so a phone does not fetch the desktop size", () => {
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    const ss = sharpImg(container)!.getAttribute("srcset") || "";
    expect(ss).toContain("480w");
    expect(ss).toContain("800w");
    expect(ss).toContain("1200w");
  });

  it("still uses a 32px backdrop, now via Cloudflare", () => {
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    const back = backdropImg(container)!.getAttribute("src")!;
    expect(back).toContain("/cdn-cgi/image/");
    expect(back).toContain("width=32");
  });

  it("never double-transforms an already-transformed URL", () => {
    const already = `https://50mmretina.com/cdn-cgi/image/width=800/${cdn(".webp")}`;
    const { container } = render(<PostMedia urls={[already]} />);
    const src = sharpImg(container)!.getAttribute("src")!;
    expect(src.split("/cdn-cgi/image/").length - 1).toBe(1);
  });

  it("leaves a GIF alone so the animation survives", () => {
    const { container } = render(<PostMedia urls={[cdn(".gif")]} />);
    expect(sharpImg(container)!.getAttribute("src")).not.toContain("/cdn-cgi/image/");
  });
});
