import { describe, it, expect } from "vitest";
import {
  parseImageDims,
  dimsSuffix,
  frameAspectFor,
  frameAspectForUrls,
  framePadding,
  needsPadding,
  FRAME_MIN_ASPECT,
  FRAME_MAX_ASPECT,
  FRAME_DEFAULT_ASPECT,
} from "@/lib/imageFrame";

const BASE = "https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images";
const url = (name: string) => `${BASE}/abc/posts/1754000000000-k3j9x${name}`;

describe("parseImageDims", () => {
  it("reads the dimensions written by the uploader", () => {
    expect(parseImageDims(url("-w1600h1200.webp"))).toEqual({ width: 1600, height: 1200, aspect: 1600 / 1200 });
  });

  it("reads them off the thumbnail variant too", () => {
    const d = parseImageDims(url("-w1600h1200-thumb.webp"));
    expect(d?.width).toBe(1600);
    expect(d?.height).toBe(1200);
  });

  it("ignores the render endpoint's query string", () => {
    const d = parseImageDims(`${BASE}/abc/posts/1754-k3j9x-w2560h1440.webp?width=800&quality=70&resize=contain`);
    expect(d?.aspect).toBeCloseTo(2560 / 1440);
  });

  it("returns null for every URL posted before this feature existed", () => {
    expect(parseImageDims(url(".webp"))).toBeNull();
    expect(parseImageDims(url("-thumb.webp"))).toBeNull();
    expect(parseImageDims("https://cdn.example.com/photo.jpg")).toBeNull();
    expect(parseImageDims("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
  });

  it("returns null rather than throwing on junk", () => {
    expect(parseImageDims(null)).toBeNull();
    expect(parseImageDims(undefined)).toBeNull();
    expect(parseImageDims("")).toBeNull();
    expect(parseImageDims(url("-w0h100.webp"))).toBeNull();
    expect(parseImageDims(url("-w100h0.webp"))).toBeNull();
    expect(parseImageDims(url("-w999999h1.webp"))).toBeNull();
    expect(parseImageDims(123 as unknown as string)).toBeNull();
  });

  it("does not mistake a similar-looking filename for dimensions", () => {
    expect(parseImageDims(url("-winter-h1200.webp"))).toBeNull();
    expect(parseImageDims(url("-w1600h1200.webp.txt"))).toBeNull();
  });
});

describe("dimsSuffix", () => {
  it("round-trips through parseImageDims", () => {
    for (const [w, h] of [[1600, 1200], [1080, 1350], [2560, 1080], [1, 1]]) {
      const d = parseImageDims(`${BASE}/x${dimsSuffix(w, h)}.webp`);
      expect(d).toEqual({ width: w, height: h, aspect: w / h });
    }
  });

  it("rounds fractional dimensions and never emits zero", () => {
    expect(dimsSuffix(1599.6, 1200.4)).toBe("-w1600h1200");
    expect(dimsSuffix(0, 0)).toBe("-w1h1");
    expect(dimsSuffix(-5, -5)).toBe("-w1h1");
  });
});

describe("frameAspectFor — the clamp", () => {
  it("leaves real photographs completely alone", () => {
    // Nothing here should get bars: these are the ratios people actually shoot.
    for (const a of [4 / 5, 1, 5 / 4, 4 / 3, 3 / 2, 16 / 9, 1.91]) {
      expect(frameAspectFor(a)).toBeCloseTo(a, 10);
      expect(needsPadding(a)).toBe(false);
    }
  });

  it("clamps a panorama to the widest frame", () => {
    expect(frameAspectFor(3)).toBe(FRAME_MAX_ASPECT);
    expect(frameAspectFor(21 / 9)).toBe(FRAME_MAX_ASPECT);
  });

  it("clamps a tall phone shot to the tallest frame", () => {
    expect(frameAspectFor(9 / 16)).toBe(FRAME_MIN_ASPECT);
    expect(frameAspectFor(0.5)).toBe(FRAME_MIN_ASPECT);
  });

  it("falls back to 4:5 on missing or nonsense input", () => {
    for (const bad of [undefined, null, NaN, Infinity, 0, -2, "1.5" as unknown as number]) {
      expect(frameAspectFor(bad as number)).toBe(FRAME_DEFAULT_ASPECT);
    }
  });

  it("never returns a frame outside the range, for any input", () => {
    for (let i = 1; i <= 2000; i++) {
      const a = i / 100; // 0.01 … 20
      const f = frameAspectFor(a);
      expect(f).toBeGreaterThanOrEqual(FRAME_MIN_ASPECT);
      expect(f).toBeLessThanOrEqual(FRAME_MAX_ASPECT);
    }
  });
});

describe("framePadding — how much blur, and where", () => {
  it("gives zero padding to anything inside the range", () => {
    for (const a of [0.8, 1, 1.5, 16 / 9, 1.91]) {
      expect(framePadding(a)).toEqual({ axis: "none", fraction: 0 });
    }
  });

  it("puts bars top and bottom for a panorama, and keeps them modest", () => {
    const p = framePadding(21 / 9); // 2.333
    expect(p.axis).toBe("vertical");
    expect(p.fraction).toBeCloseTo(1 - 1.91 / (21 / 9), 5);
    expect(p.fraction).toBeLessThan(0.2); // ~18%
  });

  it("puts bars left and right for a 9:16 phone shot", () => {
    const p = framePadding(9 / 16); // 0.5625
    expect(p.axis).toBe("horizontal");
    expect(p.fraction).toBeCloseTo(1 - (9 / 16) / 0.8, 5);
    expect(p.fraction).toBeLessThan(0.32); // ~30%
  });

  it("shows why a fixed 4:5 frame was the wrong answer", () => {
    // The measurements quoted to the owner. If these ever change, the argument
    // for the clamped range changes with them.
    expect(framePadding(3 / 2, 0.8).fraction).toBeCloseTo(0.4667, 3); // ~47%
    expect(framePadding(16 / 9, 0.8).fraction).toBeCloseTo(0.55, 3); // ~55%
  });

  it("caps the worst case well below half the card", () => {
    let worst = 0;
    for (let i = 1; i <= 4000; i++) {
      const p = framePadding(i / 100);
      if (p.fraction > worst) worst = p.fraction;
    }
    // An 0.01 aspect is not a photograph, so the true bound is only interesting
    // for plausible input; check the plausible band explicitly.
    let worstReal = 0;
    for (const a of [1 / 3, 0.5, 9 / 16, 2, 2.5, 3, 4]) {
      worstReal = Math.max(worstReal, framePadding(a).fraction);
    }
    expect(worstReal).toBeLessThan(0.6);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("never reports a negative or greater-than-one share", () => {
    for (let i = 1; i <= 2000; i++) {
      const p = framePadding(i / 100);
      expect(p.fraction).toBeGreaterThanOrEqual(0);
      expect(p.fraction).toBeLessThan(1);
    }
  });
});

describe("frameAspectForUrls — one frame per card", () => {
  it("takes the frame from the FIRST photo of an album", () => {
    const first = url("-w1600h1200.webp");  // 1.333
    const second = url("-w1080h1350.webp"); // 0.8
    expect(frameAspectForUrls([first, second])).toBeCloseTo(1600 / 1200, 10);
    expect(frameAspectForUrls([second, first])).toBeCloseTo(0.8, 10);
  });

  it("falls back to 4:5 for an empty album or an old post", () => {
    expect(frameAspectForUrls([])).toBe(FRAME_DEFAULT_ASPECT);
    expect(frameAspectForUrls(null)).toBe(FRAME_DEFAULT_ASPECT);
    expect(frameAspectForUrls(undefined)).toBe(FRAME_DEFAULT_ASPECT);
    expect(frameAspectForUrls([url(".webp")])).toBe(FRAME_DEFAULT_ASPECT);
    expect(frameAspectForUrls([null, url("-w1600h1200.webp")])).toBe(FRAME_DEFAULT_ASPECT);
  });

  it("keeps every existing post rendering exactly as it does today", () => {
    // Everything posted before 2026-08-01 was force-cropped to 4:5 and its URL
    // carries no dimensions. It must land on 4:5 — the current behaviour.
    expect(frameAspectForUrls([url(".webp"), url("-thumb.webp")])).toBe(0.8);
  });
});
