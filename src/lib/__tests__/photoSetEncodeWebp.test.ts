/**
 * Photo plan U2 · item 4 (review of #823): a browser WITHOUT a WebP encoder
 * (canvas.toBlob silently falls back to image/png for an unsupported type) must
 * not have its PNG bytes stored under a `.webp` name. encodePhotoSet returns
 * null instead, and the uploader falls back to today's path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/imageCompression", () => ({
  decodeImageForCanvas: vi.fn(async () => ({ width: 3000, height: 2000 })),
}));
vi.mock("@/lib/photoCredit", () => ({ drawCredit: vi.fn() }));

import { encodePhotoSet } from "@/lib/photoSetEncode";

let blobType = "image/webp";
const origGetContext = HTMLCanvasElement.prototype.getContext;
const origToBlob = HTMLCanvasElement.prototype.toBlob;

beforeEach(() => {
  blobType = "image/webp";
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof origGetContext;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([1, 2, 3])], { type: blobType }));
  } as typeof origToBlob;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
  HTMLCanvasElement.prototype.toBlob = origToBlob;
});

const source = () => new File([new Uint8Array([9])], "photo.jpg", { type: "image/jpeg" });

describe("encodePhotoSet · WebP or nothing", () => {
  it("returns the v3 copies (private clean 2048, credited 2048, clean 1080 URL, 600, 320) when the browser really encodes WebP", async () => {
    const r = await encodePhotoSet(source(), false, "© A, 50mm Retina World");
    expect(r).not.toBeNull();
    expect(r!.copies.map((c) => c.slot)).toEqual(["clean2048", "r2048c", "master", "thumb", "r320"]);
    expect(r!.copies.every((c) => c.file.type === "image/webp")).toBe(true);
  });

  it("returns null when toBlob hands back PNG (no WebP encoder) — never a PNG named .webp", async () => {
    blobType = "image/png";
    await expect(encodePhotoSet(source(), false, "© A, 50mm Retina World")).resolves.toBeNull();
  });

  it("returns null when only a later copy comes back as something else", async () => {
    let n = 0;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      n += 1;
      cb(new Blob([new Uint8Array([1])], { type: n === 3 ? "image/png" : "image/webp" }));
    } as typeof origToBlob;
    await expect(encodePhotoSet(source(), true, "© A, 50mm Retina World")).resolves.toBeNull();
  });
});
