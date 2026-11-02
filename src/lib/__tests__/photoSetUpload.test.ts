/**
 * Photo plan U1b — the upload path behind switch `photo_set_v2`.
 *
 *   switch ON  (caller passes `photoSet`): posts store 2048 (credited) / 1080 / 600 / 320
 *              under the `-l4` marker; competition keeps today's full-size file and adds
 *              the credited `-r2048` + 1080 / 600 / 320 under `-l4f`.
 *   switch OFF (no `photoSet`): exactly today's calls, names and files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { photoSetPlan } from "@/lib/imageLadder";

const compressImageToFiles = vi.fn(async (_f: File, name: string, opts?: { maxDimension?: number }) => {
  const max = opts?.maxDimension ?? Infinity;
  const [w, h] = max === Infinity ? [3000, 2000] : max >= 3000 ? [3000, 2000] : [max, Math.round((max * 2) / 3)];
  return { webpFile: new File([new Uint8Array(10)], `${name}.webp`, { type: "image/webp" }), width: w, height: h };
});
const compressThumbnail = vi.fn(async (_f: File, name: string) => ({ webpFile: new File([new Uint8Array(2)], `${name}-thumb.webp`, { type: "image/webp" }) }));
vi.mock("@/lib/imageCompression", () => ({ compressImageToFiles, compressThumbnail }));

/** The canvas encoder is a browser thing; here it returns one file per planned copy. */
const encodePhotoSet = vi.fn(async (_file: File, keepFull: boolean, creditText: string) => {
  const src = { width: 4000, height: 3000 };
  const copies = photoSetPlan(src.width, src.height, keepFull).map((c) => {
    const r = Math.min(1, c.maxDimension / Math.max(src.width, src.height));
    const width = Math.round(src.width * r), height = Math.round(src.height * r);
    return { ...c, width, height, file: new File([new Uint8Array(c.maxDimension)], `${c.slot}.webp`, { type: "image/webp" }), creditText: c.credit ? creditText : null };
  });
  return { source: src, copies };
});
vi.mock("@/lib/photoSetEncode", () => ({ encodePhotoSet }));

vi.mock("@/lib/s3Upload", () => ({ isS3Enabled: async () => false, uploadPairToS3: vi.fn(), uploadToS3: vi.fn() }));
const storageUpload = vi.fn(async (_b: string, p: string, _f: unknown, _o?: unknown) => ({ url: `https://cdn/${p}`, path: p }));
vi.mock("@/lib/storageUpload", () => ({ storageUpload }));
vi.mock("@/lib/gpsGuard", async () => ({ ...(await vi.importActual<object>("@/lib/gpsGuard")), guardOriginalUpload: vi.fn(async (f: File) => f) }));
vi.mock("@/lib/media/storedObject", () => ({ describeStoredObject: vi.fn(async (_b: Blob, d: unknown) => ({ dims: d })) }));

const CREDIT = "© Neil Basu, 50mm Retina World";
const jpeg = () => new File([new Uint8Array(1000)], "IMG_0001.jpg", { type: "image/jpeg" });
const paths = () => storageUpload.mock.calls.map((c) => c[1] as string);
const seg = (p: string) => p.replace(/^u1\/(posts|competitions)\/\d+-[a-z0-9]+/, "<seg>");

beforeEach(() => {
  compressImageToFiles.mockClear();
  compressThumbnail.mockClear();
  encodePhotoSet.mockClear();
  storageUpload.mockReset();
  storageUpload.mockImplementation(async (_b: string, p: string) => ({ url: `https://cdn/${p}`, path: p }));
});

describe("switch OFF — today's behaviour, unchanged", () => {
  it("a post without photoSet: 2560 cap, 600 thumb, 1080/1440 rungs under -l3; the new encoder is never used", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const r = await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1", cacheControl: "3600" });
    expect(encodePhotoSet).not.toHaveBeenCalled();
    expect(compressImageToFiles.mock.calls[0][2]).toEqual({ maxDimension: 2560 });
    expect(compressImageToFiles.mock.calls.slice(1).map((c) => c[2])).toEqual([
      { maxDimension: 1080, webpQuality: 0.82 },
      { maxDimension: 1440, webpQuality: 0.82 },
    ]);
    expect(compressThumbnail).toHaveBeenCalledTimes(1);
    expect(paths().map(seg).sort()).toEqual([
      "<seg>-w2560h1707-l3-r1080.webp",
      "<seg>-w2560h1707-l3-r1440.webp",
      "<seg>-w2560h1707-l3-thumb.webp",
      "<seg>-w2560h1707-l3.webp",
    ].sort());
    expect(r.url).toMatch(/-l3\.webp$/);
  });

  it("photoSetOption(false, …) adds NOTHING to the call (no key at all)", async () => {
    const { photoSetOption } = await import("@/lib/photoSetUpload");
    expect(photoSetOption(false, { full_name: "Neil Basu" })).toEqual({});
    expect(Object.keys(photoSetOption(false, { full_name: "Neil Basu" }))).toEqual([]);
    expect(photoSetOption(true, { full_name: "Neil Basu" })).toEqual({ photoSet: { creditText: CREDIT } });
  });
});

describe("switch ON — posts", () => {
  it("stores 2048 (credited) / 1080 / 600 / 320 under -l4 and returns the 2048 as the post's URL", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const r = await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1", cacheControl: "3600", photoSet: { creditText: CREDIT } });
    expect(encodePhotoSet).toHaveBeenCalledTimes(1);
    expect(encodePhotoSet.mock.calls[0][1]).toBe(false);
    expect(encodePhotoSet.mock.calls[0][2]).toBe(CREDIT);
    // today's encoder is not used at all for this photo
    expect(compressImageToFiles).not.toHaveBeenCalled();
    expect(compressThumbnail).not.toHaveBeenCalled();
    expect(paths().map(seg)).toEqual([
      // the siblings land FIRST: the -l4 name is only published with its files in the store
      "<seg>-w2048h1536-l4-r1080.webp",
      "<seg>-w2048h1536-l4-r320.webp",
      "<seg>-w2048h1536-l4.webp",
      "<seg>-w2048h1536-l4-thumb.webp",
    ]);
    expect(r.url).toMatch(/-w2048h1536-l4\.webp$/);
    expect(r.thumbnailUrl).toMatch(/-w2048h1536-l4-thumb\.webp$/);
    // the master is the 2048 copy (the credited one), with its own stored facts
    const master = storageUpload.mock.calls.find((c) => /-l4\.webp$/.test(c[1] as string))![2] as File;
    expect(master.name).toBe("master.webp");
    expect(r.stored).toEqual({ dims: { width: 2048, height: 1536 } });
  });

  it("a sibling that fails to upload: the marker comes off, the post still succeeds with 2048 + thumb", async () => {
    storageUpload.mockImplementation(async (_b: string, p: string) => {
      if (/-r320\.webp$/.test(p)) throw new Error("Failed to fetch");
      return { url: `https://cdn/${p}`, path: p };
    });
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const r = await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1", photoSet: { creditText: CREDIT } });
    expect(r.url).toMatch(/-w2048h1536\.webp$/);
    expect(r.thumbnailUrl).toMatch(/-w2048h1536-thumb\.webp$/);
    expect(r.url).not.toMatch(/-l4/);
  });

  it("the new encoder failing falls back to today's set (the post is never lost)", async () => {
    encodePhotoSet.mockRejectedValueOnce(new Error("Canvas 2D context unavailable"));
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const r = await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1", photoSet: { creditText: CREDIT } });
    expect(compressImageToFiles.mock.calls[0][2]).toEqual({ maxDimension: 2560 });
    expect(r.url).toMatch(/-l3\.webp$/);
  });

  it("other image types ignore photoSet (profile / admin uploads unchanged)", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    await uploadImageWithThumbnail({ bucket: "avatars", file: jpeg(), type: "featured", userId: "u1", photoSet: { creditText: CREDIT } });
    expect(encodePhotoSet).not.toHaveBeenCalled();
  });
});

describe("switch ON — competition entries", () => {
  // 64×48 WebP from sharp: a file the caller already encoded at full size.
  const CLEAN = "UklGRjYAAABXRUJQVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAAA=";
  const encoded = () => new File([Uint8Array.from(atob(CLEAN), (c) => c.charCodeAt(0))], "abc.webp", { type: "image/webp" });

  it("keeps the full-size file exactly as uploaded today and adds the credited -r2048 + 1080/600/320 under -l4f", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const full = encoded();
    const r = await uploadImageWithThumbnail({
      bucket: "competition-photos", file: full, encoded: { width: 64, height: 48 }, type: "competition", userId: "u1", cacheControl: "3600",
      photoSet: { creditText: CREDIT },
    });
    expect(compressImageToFiles).not.toHaveBeenCalled(); // the full size is NOT re-encoded
    expect(encodePhotoSet.mock.calls[0][1]).toBe(true);
    expect(paths().map(seg)).toEqual([
      "<seg>-w64h48-l4f-r2048.webp",
      "<seg>-w64h48-l4f-r1080.webp",
      "<seg>-w64h48-l4f-r320.webp",
      "<seg>-w64h48-l4f.webp",
      "<seg>-w64h48-l4f-thumb.webp",
    ]);
    const sentFull = storageUpload.mock.calls.find((c) => /-l4f\.webp$/.test(c[1] as string))![2];
    expect(sentFull).not.toBe(undefined);
    expect((sentFull as File).size).toBe(full.size); // the very bytes the caller encoded
    expect(r.url).toMatch(/-l4f\.webp$/);
  });
});

describe("callers: the switch decides, and OFF adds nothing", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("posts and both competition paths spread photoSetOption(<switch>, <own profile>) into the upload call", () => {
    expect(read("src/components/WallPosts.tsx")).toMatch(/useFeatureAllowed\("photo_set_v2"\)/);
    expect(read("src/components/WallPosts.tsx")).toMatch(/cacheControl: "3600",[\s\S]{0,120}\.\.\.photoSetOption\(photoSetV2, currentProfile\),\s*\}\);/);
    for (const f of ["src/pages/CompetitionSubmit.tsx", "src/components/competition/EditEntryDialog.tsx"]) {
      const s = read(f);
      expect(s, f).toMatch(/useFeatureAllowed\("photo_set_v2"\)/);
      expect(s, f).toMatch(/\.\.\.photoSetOption\(photoSetV2, entrantProfile\),/);
    }
  });
  it("camera details are read only when the switch is on, and saved without being awaited", () => {
    const s = read("src/components/WallPosts.tsx");
    expect(s).toMatch(/photoSetV2 && !scheduleAt \? await readCameraInfos\(selectedImages\) : null/);
    expect(s).toMatch(/void savePostPhotoCamera\(newPost\.id, cameraItems\(cameraInfos\)\)/);
    expect(s).not.toMatch(/await savePostPhotoCamera/);
  });
  it("profile / admin uploads do not pass photoSet", () => {
    for (const f of ["src/components/admin/AdminBanners.tsx", "src/components/admin/AdminPhotoOfDay.tsx", "src/components/profile/FeaturedPhotos.tsx", "src/pages/MyPhotos.tsx"]) {
      expect(read(f), f).not.toMatch(/photoSet/);
    }
  });
});

describe("the photo-job encoder (resumable posts) makes the same set", () => {
  it("full = credited 2048, thumb = 600, rungs = 1080 + 320, marker -l4", async () => {
    const { photoSetPhotoEncoder } = await import("@/lib/photoSetUpload");
    const e = await photoSetPhotoEncoder(CREDIT)(jpeg());
    expect(encodePhotoSet.mock.calls[0][2]).toBe(CREDIT);
    expect(e.marker).toBe("-l4");
    expect(e.full).toMatchObject({ width: 2048, height: 1536 });
    expect(e.rungs.map((r) => r.rung)).toEqual([1080, 320]);
    expect((e.thumb as File).name).toBe("thumb.webp");
  });
});
