import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const compressImageToFiles = vi.fn(async (_f: File, name: string) => ({
  webpFile: new File([new Uint8Array(10)], `${name}.webp`, { type: "image/webp" }), width: 6000, height: 4000,
}));
const compressThumbnail = vi.fn(async (_f: File, name: string) => ({ webpFile: new File([new Uint8Array(2)], `${name}-thumb.webp`, { type: "image/webp" }) }));
vi.mock("@/lib/imageCompression", () => ({ compressImageToFiles, compressThumbnail }));
vi.mock("@/lib/s3Upload", () => ({ isS3Enabled: async () => false, uploadPairToS3: vi.fn() }));
vi.mock("@/lib/storageUpload", () => ({ storageUpload: vi.fn(async (_b: string, p: string) => ({ url: `https://cdn/${p}`, path: p })) }));
vi.mock("@/lib/gpsGuard", async () => ({ ...(await vi.importActual<object>("@/lib/gpsGuard")), guardOriginalUpload: vi.fn(async (f: File) => f) }));
vi.mock("@/lib/media/storedObject", () => ({ describeStoredObject: vi.fn(async () => null) }));

const ROOT = path.resolve(__dirname, "../../..");

describe("S11 uploads — a competition photo is encoded at full size ONCE", () => {
  beforeEach(() => { compressImageToFiles.mockClear(); compressThumbnail.mockClear(); });

  it("uploadImageWithThumbnail does not re-encode a file the caller already encoded", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const encoded = new File([Uint8Array.from(atob("UklGRjYAAABXRUJQVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAAA="), (c) => c.charCodeAt(0))], "abc.webp", { type: "image/webp" });
    await uploadImageWithThumbnail({ bucket: "competition-photos", file: encoded, type: "competition", userId: "u1", encoded: { width: 6000, height: 4000 } });
    expect(compressImageToFiles).not.toHaveBeenCalled();
    expect(compressThumbnail).toHaveBeenCalledTimes(1);
  });

  it("a marked WebP that carries EXIF is encoded again (metadata stripped), not uploaded as is", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const exif = new File([Uint8Array.from(atob("UklGRhYBAABXRUJQVlA4WAoAAAAIAAAAPwAALwAAVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAABFWElGxgAAAEV4aWYAAElJKgAIAAAABwASAQMAAQAAAAEAAAAaAQUAAQAAAGIAAAAbAQUAAQAAAGoAAAAoAQMAAQAAAAIAAAATAgMAAQAAAAEAAACYggIAAgAAAHgAAABphwQAAQAAAHIAAAAAAAAAOGMAAOgDAAA4YwAA6AMAAAYAAJAHAAQAAAAwMjEwAZEHAAQAAAABAgMAAKAHAAQAAAAwMTAwAaADAAEAAAD//wAAAqAEAAEAAABAAAAAA6AEAAEAAAAwAAAAAAAAAA=="), (c) => c.charCodeAt(0))], "e.webp", { type: "image/webp" });
    await uploadImageWithThumbnail({ bucket: "competition-photos", file: exif, type: "competition", userId: "u1", encoded: { width: 64, height: 48 } });
    expect(compressImageToFiles).toHaveBeenCalledTimes(1);
  });

  it("a file that is not WebP is still encoded even if marked (the flag cannot skip the WebP-only rule)", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const jpeg = new File([new Uint8Array(10)], "abc.jpg", { type: "image/jpeg" });
    await uploadImageWithThumbnail({ bucket: "competition-photos", file: jpeg, type: "competition", userId: "u1", encoded: { width: 1, height: 1 } });
    expect(compressImageToFiles).toHaveBeenCalledTimes(1);
  });

  it("both competition upload paths hand over their own encode instead of encoding again", () => {
    for (const f of ["src/pages/CompetitionSubmit.tsx", "src/components/competition/EditEntryDialog.tsx"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).toMatch(/const \{ webpFile, width, height \} = await compressImageToFiles\(file, baseName\);/);
      expect(src, f).toMatch(/uploadImageWithThumbnail\(\{[\s\S]{0,200}encoded: \{ width, height \}/);
    }
  });
});

describe("metadataFreeWebp — real bytes", () => {
  // 64×48 WebP from sharp (libwebp), the same container a canvas encode writes.
  const CLEAN = "UklGRjYAAABXRUJQVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAAA=";
  // The same image with an EXIF chunk (VP8X + VP8 + EXIF).
  const EXIF = "UklGRhYBAABXRUJQVlA4WAoAAAAIAAAAPwAALwAAVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAABFWElGxgAAAEV4aWYAAElJKgAIAAAABwASAQMAAQAAAAEAAAAaAQUAAQAAAGIAAAAbAQUAAQAAAGoAAAAoAQMAAQAAAAIAAAATAgMAAQAAAAEAAACYggIAAgAAAHgAAABphwQAAQAAAHIAAAAAAAAAOGMAAOgDAAA4YwAA6AMAAAYAAJAHAAQAAAAwMjEwAZEHAAQAAAABAgMAAKAHAAQAAAAwMTAwAaADAAEAAAD//wAAAqAEAAEAAABAAAAAA6AEAAEAAAAwAAAAAAAAAA==";
  const file = (b64: string, type = "image/webp") => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "x.webp", { type });

  it("passes a clean encode, refuses EXIF, refuses non-WebP and truncated files", async () => {
    const { metadataFreeWebp } = await vi.importActual<typeof import("@/lib/gpsGuard")>("@/lib/gpsGuard");
    expect(await metadataFreeWebp(file(CLEAN))).not.toBeNull();
    expect(await metadataFreeWebp(file(EXIF))).toBeNull();
    expect(await metadataFreeWebp(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])], "a.jpg"))).toBeNull();
    const full = Uint8Array.from(atob(CLEAN), (c) => c.charCodeAt(0));
    expect(await metadataFreeWebp(new File([full.slice(0, 30)], "t.webp"))).toBeNull();
  });
});
