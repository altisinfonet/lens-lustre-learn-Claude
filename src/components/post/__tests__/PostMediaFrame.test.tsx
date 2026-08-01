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
