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
import fs from "node:fs";
import path from "node:path";
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
 * that can be switched off outside this repo.
 *
 * PERF, 2026-08-07, SECOND ATTEMPT — the "image broken" incident, same day:
 * the first attempt DERIVED `-thumb.webp` from the original's address by string
 * rule. Measured against production data: for posts from before the R2
 * migration the original lives on cdn.50mmretina.com but the STORED thumbnail
 * (posts.thumbnail_urls) lives on Supabase storage — the derived address does
 * not exist, and the dead URL ended in the permanent branded placeholder via
 * the global image retrier. Owner screenshots, many profiles affected.
 *
 * So the contract now: the card shows the STORED thumbnail passed in via the
 * `thumbUrls` prop when there is one, the ORIGINAL when there is not, and it
 * NEVER invents an address. The safety invariant these tests exist to protect
 * — never /cdn-cgi/image/ — is unchanged.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const cdn = (name: string) =>
  `https://cdn.50mmretina.com/post-images/u/posts/1754000000000-abc${name}`;
const sbThumb =
  "https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/u/1754000000000-abc-thumb.webp";
const POSTMEDIA_SRC = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/post/PostMedia.tsx"),
  "utf8",
);

describe("PostMedia — CDN images load DIRECT, never via a transformer", () => {
  it("uses the STORED thumbnail address verbatim, never a derived one", () => {
    // REWRITTEN 2026-08-10. This case used to assert that the stored thumbnail
    // was the SHARP image. That was the photo-quality bug: a 600px file
    // stretched across a full-width slot on every device. The rule it was
    // really written to protect is different and still holds — when a thumbnail
    // IS used, its address comes from `thumbUrls` verbatim and is never derived
    // by string rule. So the assertion moved to the srcset, which is where the
    // stored thumbnail now appears.
    const { container } = render(
      <PostMedia urls={[cdn("-w2560h1463.webp")]} thumbUrls={[sbThumb]} />,
    );
    const img = sharpImg(container)!;
    const src = img.getAttribute("src")!;
    // The sharp layer is the ORIGINAL — full resolution, exactly as stored.
    expect(src).toBe(cdn("-w2560h1463.webp"));
    expect(src).not.toContain("/cdn-cgi/image/");
    // …and the stored thumbnail is offered beside it, byte-for-byte as given.
    expect(img.getAttribute("srcset")).toContain(sbThumb);
  });

  it("shows the ORIGINAL, untouched, when no thumbnail is on record — never a guess", () => {
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    const src = sharpImg(container)!.getAttribute("src")!;
    // Exactly the stored original: no derived "-thumb" suffix, no transformer.
    expect(src).toBe(cdn("-w2560h1463.webp"));
    expect(src).not.toContain("/cdn-cgi/image/");
  });

  it("never derives a thumbnail address by string rule", () => {
    // The address-guessing helper must stay gone from the source.
    expect(POSTMEDIA_SRC).not.toContain("buildCdnThumb");
    expect(POSTMEDIA_SRC).not.toMatch(/-thumb\.\$1/);
  });

  it("offers BOTH copies with true widths so the browser can pick", () => {
    // REPLACES "no srcset — the thumbnail is a single fixed-size file"
    // (2026-08-10). Having no srcset is exactly what forced every device onto
    // the 600px copy: measured live, a 588px slot at DPR 1.125 needed 662
    // device pixels and received 600. A phone at DPR 3 needed ~1,760.
    //
    // Device pixel ratio is the one input we cannot read at render time, so the
    // choice belongs to the browser. Both addresses are stored; neither is
    // derived.
    const { container } = render(
      <PostMedia urls={[cdn("-w2560h1463.webp")]} thumbUrls={[cdn("-w2560h1463-thumb.webp")]} />,
    );
    const srcset = sharpImg(container)!.getAttribute("srcset")!;
    expect(srcset).toBe(
      `${cdn("-w2560h1463-thumb.webp")} 600w, ${cdn("-w2560h1463.webp")} 2560w`,
    );
  });

  it("gives a PORTRAIT thumbnail its real width, not a flat 600", () => {
    // The thumbnail is capped on its LONG edge, so a 1080x1350 portrait is 480
    // wide. Declaring 600w would make the browser skip the original at exactly
    // the sizes where it is needed — the upscaling this suite now guards.
    const { container } = render(
      <PostMedia urls={[cdn("-w1080h1350.webp")]} thumbUrls={[cdn("-w1080h1350-thumb.webp")]} />,
    );
    expect(sharpImg(container)!.getAttribute("srcset")).toBe(
      `${cdn("-w1080h1350-thumb.webp")} 480w, ${cdn("-w1080h1350.webp")} 1080w`,
    );
  });

  it("offers no srcset when the filename carries no dimensions to declare", () => {
    // Rather than invent a width descriptor. A legacy filename has none.
    const { container } = render(
      <PostMedia urls={[cdn(".webp")]} thumbUrls={[cdn("-thumb.webp")]} />,
    );
    expect(sharpImg(container)!.getAttribute("srcset")).toBeNull();
    expect(sharpImg(container)!.getAttribute("src")).toBe(cdn(".webp"));
  });

  it("the backdrop also uses the direct URL", () => {
    // Given a stored thumbnail there IS a backdrop, and it must still never be
    // routed through the transformer — that is what broke every www and
    // Android user for four days in the 2026-08-01 incident.
    const { container } = render(
      <PostMedia urls={[cdn("-w2560h1463.webp")]} thumbUrls={[cdn("-thumb.webp")]} />,
    );
    const back = backdropImg(container)!.getAttribute("src")!;
    expect(back).not.toContain("/cdn-cgi/image/");
    expect(back).toBe(cdn("-thumb.webp"));
  });

  it("renders NO backdrop at all when there is no cheap source for it", () => {
    /**
     * The memory fix, asserted on the rendered output rather than the source.
     *
     * A CDN url with no stored thumbnail cannot be transformed, so there is no
     * 32px LQIP and no 600px thumb. This used to fall through to the FULL
     * 2560px original with `loading="eager"` — roughly 14.7 MB of decoded
     * bitmap, per card, to paint a layer that is then blurred into mush.
     *
     * The correct answer is nothing. A flat card background behind a
     * letterboxed photo costs nobody anything.
     */
    const { container } = render(<PostMedia urls={[cdn("-w2560h1463.webp")]} />);
    expect(backdropImg(container)).toBeNull();
  });

  it("never points the backdrop at the full-resolution original", () => {
    // The specific regression this guards: any backdrop that renders must be a
    // thumbnail or an LQIP, never the same address as the sharp layer.
    const original = cdn("-w2560h1463.webp");
    for (const thumbs of [undefined, [cdn("-thumb.webp")]]) {
      const { container, unmount } = render(
        <PostMedia urls={[original]} thumbUrls={thumbs} />,
      );
      const back = backdropImg(container);
      if (back) expect(back.getAttribute("src")).not.toBe(original);
      unmount();
    }
  });

  it("an old post whose stored URL is already a transformer URL is left as-is", () => {
    // Not double-wrapped, not rewritten here — the data is what it is.
    const already = `https://50mmretina.com/cdn-cgi/image/width=800/${cdn(".webp")}`;
    const { container } = render(<PostMedia urls={[already]} />);
    const src = sharpImg(container)!.getAttribute("src")!;
    expect(src.split("/cdn-cgi/image/").length - 1).toBe(1);
  });

  it("a GIF stays untouched so the animation survives — even with a stored thumb", () => {
    const { container } = render(
      <PostMedia urls={[cdn(".gif")]} thumbUrls={[cdn("-thumb.webp")]} />,
    );
    // The static thumbnail would freeze the animation; the original wins.
    expect(sharpImg(container)!.getAttribute("src")).toBe(cdn(".gif"));
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

  it("drops the backdrop when the 32px transform fails — it does NOT escalate to the original", () => {
    /**
     * ⚠ THIS ASSERTION WAS DELIBERATELY INVERTED ON 2026-08-13.
     *
     * It used to require that a failed 32px transform fall back to `url` — the
     * full-resolution original — so the letterbox bars were never blank. The
     * intent was right and the cost was not understood: that fallback is the
     * eager 2560px fetch, ~14.7 MB of decoded bitmap per card, and it is the
     * out-of-memory crash on a mid-range Android phone.
     *
     * A blurred decorative layer is not worth 14.7 MB. When the cheap source
     * fails there is no cheap source left, so the backdrop is dropped and the
     * bars fall back to the card background. Blank bars are a cosmetic
     * disappointment; the alternative crashed the app.
     */
    const url = photo("-w4200h1400.webp");
    const { container } = render(<PostMedia urls={[url]} />);
    const back = backdropImg(container)!;
    expect(back.getAttribute("src")).toContain("width=32");
    fireEvent.error(back);
    expect(backdropImg(container)).toBeNull();
  });
});
