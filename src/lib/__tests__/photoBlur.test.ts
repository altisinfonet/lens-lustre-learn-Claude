import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { rgbaToThumbHash, thumbHashToRGBA } from "@/lib/media/thumbhash.mjs";
import { __resetPhotoBlurs, blurPicture, photoBlurFor, requestPhotoBlurs, PHOTO_BLUR_BATCH_MAX } from "@/lib/photoBlur";

/** A 40×30 left-red → right-blue gradient, as the server job would read it. */
function sampleHash(): string {
  const w = 40, h = 30, rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = 255 - Math.round((x / (w - 1)) * 255); rgba[i + 1] = 40; rgba[i + 2] = Math.round((x / (w - 1)) * 255); rgba[i + 3] = 255;
  }
  return btoa(String.fromCharCode(...rgbaToThumbHash(w, h, rgba)));
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const A = "https://cdn.50mmretina.com/post-images/u/posts/a.jpg";
const B = "https://cdn.50mmretina.com/post-images/u/posts/b.jpg";

describe("photo blur code", () => {
  beforeEach(() => { __resetPhotoBlurs(); rpc.mockReset(); });

  it("the stored code is short and keeps the photo's colours (encode ↔ decode agree)", () => {
    const hash = sampleHash();
    expect(hash.length).toBeLessThanOrEqual(48);
    const { w, h, rgba } = thumbHashToRGBA(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)));
    expect(w).toBeGreaterThan(h); // landscape stays landscape
    expect(rgba[0]).toBeGreaterThan(rgba[2]); // left edge red
    const r = (w - 1) * 4;
    expect(rgba[r + 2]).toBeGreaterThan(rgba[r]); // right edge blue
  });

  it("turns a code into a picture in memory — no request", () => {
    const pic = blurPicture(sampleHash());
    expect(pic).toMatch(/^data:image\/png;base64,/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed code (the card keeps its old fill)", () => {
    expect(blurPicture("not a code!")).toBeNull();
    expect(blurPicture("AAAA")).toBeNull();
  });

  it("asks once per post, batched, and answers per photo", async () => {
    rpc.mockResolvedValue({ data: [{ post_id: "p1", url: A, hash: sampleHash() }], error: null });
    expect(photoBlurFor(A)).toBeNull(); // never asked
    requestPhotoBlurs("p1", [A, B]);
    requestPhotoBlurs("p1", [A, B]); // idempotent
    requestPhotoBlurs("p2", [B]);
    expect(photoBlurFor(A)).toBeUndefined(); // waiting
    await tick(); await tick();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("post_photo_blurs", { p_post_ids: ["p1", "p2"] });
    expect(photoBlurFor(A)).toMatch(/^data:image\/png/);
    expect(photoBlurFor(B)).toBeNull(); // no code yet → old fill
  });

  it("a refused call means no code — never an error on screen", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function not found" } });
    requestPhotoBlurs("p1", [A]);
    await tick(); await tick();
    expect(photoBlurFor(A)).toBeNull();
  });

  it("never sends more than 50 posts in one call", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    for (let i = 0; i < 120; i++) requestPhotoBlurs(`p${i}`, [`https://cdn.50mmretina.com/x/${i}.jpg`]);
    for (let i = 0; i < 6; i++) await tick();
    expect(rpc).toHaveBeenCalledTimes(3);
    for (const c of rpc.mock.calls) expect((c[1] as { p_post_ids: string[] }).p_post_ids.length).toBeLessThanOrEqual(PHOTO_BLUR_BATCH_MAX);
  });
});
