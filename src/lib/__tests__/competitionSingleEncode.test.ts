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
    const { storageUpload } = await import("@/lib/storageUpload");
    (storageUpload as unknown as ReturnType<typeof vi.fn>).mockClear();
    const r = await uploadImageWithThumbnail({ bucket: "competition-photos", file: encoded, type: "competition", userId: "u1", encoded: { width: 64, height: 48 } });
    expect(compressImageToFiles).not.toHaveBeenCalled();
    expect(compressThumbnail).toHaveBeenCalledTimes(1);
    const sent = (storageUpload as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(sent).toContain(encoded); // the very file the caller encoded went up
    expect(r.url).toBeTruthy();
  });

  it("a stated size that is not the file's own size is not trusted: the file is encoded again", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const encoded = new File([Uint8Array.from(atob("UklGRjYAAABXRUJQVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAAA="), (c) => c.charCodeAt(0))], "abc.webp", { type: "image/webp" });
    await uploadImageWithThumbnail({ bucket: "competition-photos", file: encoded, type: "competition", userId: "u1", encoded: { width: 6000, height: 4000 } });
    expect(compressImageToFiles).toHaveBeenCalledTimes(1);
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

describe("metadataFreeWebp — real bytes and hostile containers", () => {
  // 64×48 WebP from sharp (libwebp), the same container a canvas encode writes.
  const CLEAN = "UklGRjYAAABXRUJQVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAAA=";
  // The same image with an EXIF chunk (VP8X + VP8 + EXIF).
  const EXIF = "UklGRhYBAABXRUJQVlA4WAoAAAAIAAAAPwAALwAAVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAABFWElGxgAAAEV4aWYAAElJKgAIAAAABwASAQMAAQAAAAEAAAAaAQUAAQAAAGIAAAAbAQUAAQAAAGoAAAAoAQMAAQAAAAIAAAATAgMAAQAAAAEAAACYggIAAgAAAHgAAABphwQAAQAAAHIAAAAAAAAAOGMAAOgDAAA4YwAA6AMAAAYAAJAHAAQAAAAwMjEwAZEHAAQAAAABAgMAAKAHAAQAAAAwMTAwAaADAAEAAAD//wAAAqAEAAEAAABAAAAAA6AEAAEAAAAwAAAAAAAAAA==";
  const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const asFile = (b: Uint8Array) => new File([b], "x.webp", { type: "image/webp" });
  const setU32 = (b: Uint8Array, at: number, v: number) => { b[at] = v & 255; b[at + 1] = (v >>> 8) & 255; b[at + 2] = (v >>> 16) & 255; b[at + 3] = (v >>> 24) & 255; };
  const chunk = (t: string, payload: number[]) => {
    const n = payload.length, out = new Uint8Array(8 + n + (n & 1));
    for (let k = 0; k < 4; k++) out[k] = t.charCodeAt(k);
    setU32(out, 4, n); out.set(payload, 8); return out;
  };
  /** CLEAN with an extra top-level chunk appended INSIDE the RIFF (size fixed up). */
  const withChunk = (t: string) => {
    const c = chunk(t, [1, 2, 3, 4, 5]), base = bytes(CLEAN), out = new Uint8Array(base.length + c.length);
    out.set(base); out.set(c, base.length); setU32(out, 4, out.length - 8); return out;
  };
  let check: (f: File) => Promise<{ width: number; height: number } | null>;
  beforeEach(async () => {
    check = (await vi.importActual<typeof import("@/lib/gpsGuard")>("@/lib/gpsGuard")).metadataFreeWebp;
  });

  it("passes the clean encode and reads its size from the VP8 header (64 × 48)", async () => {
    expect(await check(asFile(bytes(CLEAN)))).toMatchObject({ width: 64, height: 48 });
  });
  it("passes REAL canvas WebP from Chromium (VP8X + ICCP + ALPH + VP8) and Firefox (VP8 / VP8X + ALPH), with their sizes", async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/canvasWebp.json"), "utf8")) as Record<string, string>;
    for (const [name, b64] of Object.entries(fx)) {
      const [w, h] = name.split("-")[1].split("x").map(Number);
      expect(await check(asFile(bytes(b64))), name).toMatchObject({ width: w, height: h });
    }
  });
  it("refuses EXIF, XMP and any unknown or renamed chunk (allow-list); a colour profile or image chunk is fine", async () => {
    expect(await check(asFile(bytes(EXIF)))).toBeNull();
    for (const t of ["XMP ", "exif", "abcd", "EXIF"]) expect(await check(asFile(withChunk(t))), t).toBeNull();
    for (const t of ["ALPH", "ICCP"]) expect(await check(asFile(withChunk(t))), t).not.toBeNull();
  });
  it("refuses bytes after the RIFF end, a RIFF size shorter than the file, and EXIF hidden past a shrunk RIFF size", async () => {
    const trail = new Uint8Array(bytes(CLEAN).length + 20); trail.set(bytes(CLEAN)); trail.set(chunk("EXIF", [9, 9, 9, 9]), bytes(CLEAN).length);
    expect(await check(asFile(trail))).toBeNull();
    const hidden = bytes(EXIF); setU32(hidden, 4, 12 + 18 + 50 - 8);
    expect(await check(asFile(hidden))).toBeNull();
  });
  it("refuses truncation (mid-chunk and exactly on a chunk boundary) and absurd size fields", async () => {
    const full = bytes(CLEAN);
    expect(await check(asFile(full.slice(0, 30)))).toBeNull();
    const boundary = bytes(EXIF).slice(0, 12 + 18); setU32(boundary, 4, 4000);
    expect(await check(asFile(boundary))).toBeNull();
    const huge = bytes(CLEAN); setU32(huge, 16, 0xfffffff0);
    expect(await check(asFile(huge))).toBeNull();
    const hugeRiff = bytes(CLEAN); setU32(hugeRiff, 4, 0xffffffff);
    expect(await check(asFile(hugeRiff))).toBeNull();
    expect(await check(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])], "a.jpg"))).toBeNull();
  });
});
