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
import { render, fireEvent } from "@testing-library/react";
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
 * ═══════════════════════════════════════════════════════════════════════════
 * REVERSED, 2026-08-05: CDN images must NOT go through /cdn-cgi/image/.
 *
 * The describe that used to live here pinned the OPPOSITE — it protected the
 * Cloudflare Transformations routing shipped 2026-08-01 ("silently reverting
 * to full-size originals" was listed as the failure mode to guard against).
 *
 * The real failure mode was the transformer itself. It is zone infrastructure:
 * it died with no deploy and no code change, and from that day the owner's
 * feed — web AND app — was a wall of branded placeholders. Measured in his own
 * browser on 2026-08-05: every /cdn-cgi/image/ request failed while every
 * direct cdn.50mmretina.com URL returned 200. "Images are not coming. Many
 * times told" — this was it.
 *
 * So the pin now points the other way: a cdn.50mmretina.com image is rendered
 * by its DIRECT url, no srcset, and nothing may reroute it through an endpoint
 * that can be switched off outside this repo. Full-size originals in the feed
 * cost bandwidth; they do not cost the product. See PostMedia.tsx for the
 * conditions under which a transformer may return.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const cdn = (name: string) =>
  `https://cdn.50mmretina.com/post-images/u/posts/1754000000000-abc${name}`;

describe("PostMedia — CDN images load DIRECT, never via a transformer", () => {
  it("renders the original URL, untouched", () => {
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    const src = sharpImg(container)!.getAttribute("src")!;
    expect(src).toBe(cdn("-w2560h1463.webp"));
    expect(src).not.toContain("/cdn-cgi/image/");
  });

  it("no srcset — every candidate would have been a transformer URL", () => {
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    expect(sharpImg(container)!.getAttribute("srcset")).toBeNull();
  });

  it("the 32px backdrop also uses the direct URL", () => {
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    const back = backdropImg(container)!.getAttribute("src")!;
    expect(back).not.toContain("/cdn-cgi/image/");
  });

  it("an old post whose stored URL is already a transformer URL is left as-is", () => {
    // Not double-wrapped, not rewritten here — the data is what it is.
    const already = `https://50mmretina.com/cdn-cgi/image/width=800/${cdn(".webp")}`;
    const { container } = render(<PostMedia urls={[already]} />);
    const src = sharpImg(container)!.getAttribute("src")!;
    expect(src.split("/cdn-cgi/image/").length - 1).toBe(1);
  });

  it("a GIF stays untouched so the animation survives", () => {
    const { container } = render(<PostMedia urls={[cdn(".gif")]} />);
    expect(sharpImg(container)!.getAttribute("src")).not.toContain("/cdn-cgi/image/");
  });

  it("Supabase-hosted images keep their storage-native render endpoint", () => {
    // That transformer is a different system, predates 2026-08-01, and was
    // never part of the failure. Losing it would be its own regression.
    const sb =
      "https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/portfolio-images/g/a.webp";
    const { container } = render(<PostMedia urls={[sb]} />);
    const src = sharpImg(container)!.getAttribute("src")!;
    expect(src).toContain("/storage/v1/render/image/public/");
  });
});

/**
 * ── OLD POSTS: the frame is measured when the filename does not carry it ──
 *
 * Reported by the owner with a screenshot on 2026-08-01: a landscape photo
 * sitting in the middle of a tall portrait card with big dark bars above and
 * below. Cause: photos posted before 2026-08-01 have no `-w<W>h<H>` in their
 * name, so they fell back to the 4:5 default — which was right while the image
 * was `object-cover` and force-cropped, and wrong the moment it became
 * `object-contain`.
 *
 * The fallback still applies BEFORE the image loads (nothing can be known yet),
 * so the two tests above stay true. These pin what happens after it loads.
 */
describe("PostMedia — an old photo takes its shape from the image itself", () => {
  /** Fire a load on the backdrop with a given intrinsic size. */
  const loadBackdrop = (container: HTMLElement, w: number, h: number) => {
    const back = backdropImg(container)!;
    Object.defineProperty(back, "naturalWidth", { value: w, configurable: true });
    Object.defineProperty(back, "naturalHeight", { value: h, configurable: true });
    fireEvent.load(back);
  };

  it("re-shapes a legacy landscape photo once its size is known", () => {
    const { container } = render(<PostMedia urls={[photo(".webp")]} />);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6); // before load
    loadBackdrop(container, 32, 21); // ~3:2
    expect(Number(frameOf(container))).toBeCloseTo(32 / 21, 6);
  });

  it("still clamps what it measures — a panorama cannot swallow the feed", () => {
    const { container } = render(<PostMedia urls={[photo(".webp")]} />);
    loadBackdrop(container, 32, 8); // 4:1
    expect(Number(frameOf(container))).toBeCloseTo(1.91, 6);
  });

  it("still clamps a legacy 9:16 phone shot to 4:5", () => {
    const { container } = render(<PostMedia urls={[photo(".webp")]} />);
    loadBackdrop(container, 18, 32);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6);
  });

  it("does NOT re-measure a photo whose filename already carries dimensions", () => {
    // New uploads must have zero reflow. If a stray load event could move the
    // frame, every new post would jump as its image arrived.
    const { container } = render(<PostMedia urls={[photo("-w3000h2000.webp")]} />);
    loadBackdrop(container, 10, 32); // wildly different — must be ignored
    expect(Number(frameOf(container))).toBeCloseTo(1.5, 6);
  });

  it("ignores a zero or missing intrinsic size instead of collapsing the card", () => {
    const { container } = render(<PostMedia urls={[photo(".webp")]} />);
    loadBackdrop(container, 0, 0);
    expect(Number(frameOf(container))).toBeCloseTo(0.8, 6);
  });
});

describe("PostMedia — the blurred padding has to be visible", () => {
  it("does not dim the backdrop into a black void", () => {
    // It was brightness-[0.55], tuned on a bright photo. On a dark forest shot
    // that is indistinguishable from an empty card, which is what the owner
    // saw and reasonably read as "the blur was removed".
    const { container } = render(<PostMedia urls={[photo("-w4200h1400.webp")]} />);
    const cls = backdropImg(container)!.className;
    const m = cls.match(/brightness-\[([\d.]+)\]/);
    expect(m, `no brightness class found in "${cls}"`).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.75);
  });

  it("falls back to the original when the 32px transform fails", () => {
    // The backdrop had no error handler at all: a failed transform rendered an
    // empty layer, and the bars really were blank.
    const url = photo("-w4200h1400.webp");
    const { container } = render(<PostMedia urls={[url]} />);
    const back = backdropImg(container)!;
    expect(back.getAttribute("src")).toContain("width=32");
    fireEvent.error(back);
    expect(backdropImg(container)!.getAttribute("src")).toBe(url);
  });
});
