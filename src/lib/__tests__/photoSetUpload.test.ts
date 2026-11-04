/**
 * Photo plan U1b — the upload path behind switch `photo_set_v2`.
 *
 *   POSTS (Owner order, 4 Nov 2026): ALWAYS the feed set `-l6` (2048 + 1080 + 600),
 *              whatever the switch — locked in feedPhotoSet.test.ts. Here: its
 *              fallbacks (the encoder refuses → today's `-l3` set; a sibling fails → unmarked).
 *   COMPETITION, switch ON (caller passes `photoSet`), Unit A v3: today's full-size file + clean
 *              1080 / 600 / 320 under `-l5f`. Switch OFF: exactly today's calls, names and files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { feedPhotoPlan, photoSetPlan } from "@/lib/imageLadder";

const compressImageToFiles = vi.fn(async (_f: File, name: string, opts?: { maxDimension?: number }) => {
  const max = opts?.maxDimension ?? Infinity;
  const [w, h] = max === Infinity ? [3000, 2000] : max >= 3000 ? [3000, 2000] : [max, Math.round((max * 2) / 3)];
  return { webpFile: new File([new Uint8Array(10)], `${name}.webp`, { type: "image/webp" }), width: w, height: h };
});
const compressThumbnail = vi.fn(async (_f: File, name: string) => ({ webpFile: new File([new Uint8Array(2)], `${name}-thumb.webp`, { type: "image/webp" }) }));
vi.mock("@/lib/imageCompression", () => ({ compressImageToFiles, compressThumbnail }));

/** The canvas encoder is a browser thing; here it returns one file per planned copy. */
const encodePhotoSet = vi.fn(async (_file: File, keepFull: boolean) => {
  const src = { width: 4000, height: 3000 };
  const copies = photoSetPlan(src.width, src.height, keepFull).map((c) => {
    const r = Math.min(1, c.maxDimension / Math.max(src.width, src.height));
    const width = Math.round(src.width * r), height = Math.round(src.height * r);
    return { ...c, width, height, file: new File([new Uint8Array(c.maxDimension)], `${c.slot}.webp`, { type: "image/webp" }) };
  });
  return { source: src, copies };
});
const encodeFeedPhotoSet = vi.fn(async (_file: File) => {
  const src = { width: 4000, height: 3000 };
  const copies = feedPhotoPlan().map((c) => {
    const r = Math.min(1, c.maxDimension / Math.max(src.width, src.height));
    const width = Math.round(src.width * r), height = Math.round(src.height * r);
    return { ...c, width, height, file: new File([new Uint8Array(c.maxDimension)], `${c.slot}.webp`, { type: "image/webp" }) };
  });
  return { source: src, copies };
});
vi.mock("@/lib/photoSetEncode", () => ({ encodePhotoSet, encodeFeedPhotoSet }));

vi.mock("@/lib/s3Upload", () => ({ isS3Enabled: async () => false, uploadPairToS3: vi.fn(), uploadToS3: vi.fn() }));
const storageUpload = vi.fn(async (_b: string, p: string, _f: unknown, _o?: unknown) => ({ url: `https://cdn/${p}`, path: p }));
vi.mock("@/lib/storageUpload", () => ({ storageUpload }));
vi.mock("@/lib/gpsGuard", async () => ({ ...(await vi.importActual<object>("@/lib/gpsGuard")), guardOriginalUpload: vi.fn(async (f: File) => f) }));
vi.mock("@/lib/media/storedObject", () => ({ describeStoredObject: vi.fn(async (_b: Blob, d: unknown) => ({ dims: d })) }));

const storeCleanCopy = vi.fn(async (_key: string, _blob: Blob) => "stored" as const);
vi.mock("@/lib/media/cleanCopyClient", () => ({ storeCleanCopy }));

const jpeg = () => new File([new Uint8Array(1000)], "IMG_0001.jpg", { type: "image/jpeg" });
const paths = () => storageUpload.mock.calls.map((c) => c[1] as string);
const seg = (p: string) => p.replace(/^u1\/(posts|competitions)\/\d+-[a-z0-9]+/, "<seg>");

beforeEach(() => {
  compressImageToFiles.mockClear();
  compressThumbnail.mockClear();
  encodePhotoSet.mockClear();
  encodeFeedPhotoSet.mockClear();
  storageUpload.mockReset();
  storeCleanCopy.mockClear();
  storageUpload.mockImplementation(async (_b: string, p: string) => ({ url: `https://cdn/${p}`, path: p }));
});

describe("posts — the feed set's fallbacks (the post is never lost)", () => {
  it("the feed encoder refusing: today's -l3 set (2560 cap, 600 thumb, 1080/1440 rungs)", async () => {
    encodeFeedPhotoSet.mockRejectedValueOnce(new Error("Canvas 2D context unavailable"));
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

  it("a browser without a WebP encoder (encodeFeedPhotoSet → null): today's set; the job encoder throws so the composer uses today's path", async () => {
    encodeFeedPhotoSet.mockResolvedValueOnce(null as never);
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const r = await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1", photoSet: true });
    expect(r.url).toMatch(/-l3\.webp$/);
    encodeFeedPhotoSet.mockResolvedValueOnce(null as never);
    const { photoSetPhotoEncoder } = await import("@/lib/photoSetUpload");
    await expect(photoSetPhotoEncoder()(jpeg())).rejects.toThrow(/WebP/);
  });

  it("a sibling that fails to upload: the marker comes off, the post still succeeds with the 2048 + thumb", async () => {
    storageUpload.mockImplementation(async (_b: string, p: string) => {
      if (/-r1080\.webp$/.test(p)) throw new Error("Failed to fetch");
      return { url: `https://cdn/${p}`, path: p };
    });
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const r = await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1" });
    expect(r.url).toMatch(/-w2048h1536\.webp$/);
    expect(r.thumbnailUrl).toMatch(/-w2048h1536-thumb\.webp$/);
    expect(storeCleanCopy).not.toHaveBeenCalled();
  });

  it("other image types ignore photoSet (profile / admin uploads unchanged)", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    await uploadImageWithThumbnail({ bucket: "avatars", file: jpeg(), type: "featured", userId: "u1", photoSet: true });
    expect(encodePhotoSet).not.toHaveBeenCalled();
    expect(encodeFeedPhotoSet).not.toHaveBeenCalled();
  });

  it("photoSetOption(false, …) adds NOTHING to the call (no key at all)", async () => {
    const { photoSetOption } = await import("@/lib/photoSetUpload");
    expect(photoSetOption(false)).toEqual({});
    expect(Object.keys(photoSetOption(false))).toEqual([]);
    expect(photoSetOption(true)).toEqual({ photoSet: true });
  });
});


describe("switch ON — competition entries", () => {
  // 64×48 WebP from sharp: a file the caller already encoded at full size.
  const CLEAN = "UklGRjYAAABXRUJQVlA4ICoAAABQAwCdASpAADAAPm02mUkkIyKhIqgAgA2JaQAAE/GOHwhFgAD+ooAAAAA=";
  const encoded = () => new File([Uint8Array.from(atob(CLEAN), (c) => c.charCodeAt(0))], "abc.webp", { type: "image/webp" });

  it("keeps the full-size file exactly as uploaded today and adds clean 1080/600/320 under -l5f, nothing credited", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    const full = encoded();
    const r = await uploadImageWithThumbnail({
      bucket: "competition-photos", file: full, encoded: { width: 64, height: 48 }, type: "competition", userId: "u1", cacheControl: "3600",
      photoSet: true,
    });
    expect(compressImageToFiles).not.toHaveBeenCalled(); // the full size is NOT re-encoded
    expect(encodePhotoSet.mock.calls[0][1]).toBe(true);
    expect(paths().map(seg)).toEqual([
      "<seg>-w64h48-l5f-r1080.webp",
      "<seg>-w64h48-l5f-r320.webp",
      "<seg>-w64h48-l5f.webp",
      "<seg>-w64h48-l5f-thumb.webp",
    ]);
    const sentFull = storageUpload.mock.calls.find((c) => /-l5f\.webp$/.test(c[1] as string))![2];
    expect(sentFull).not.toBe(undefined);
    expect((sentFull as File).size).toBe(full.size); // the very bytes the caller encoded
    expect(r.url).toMatch(/-l5f\.webp$/);
    expect(String(storeCleanCopy.mock.calls[0][0])).toMatch(/^competition-photos\/u1\/competitions\/.*-w64h48-l5f\.webp$/);
  });
});

describe("callers: the switch decides, and OFF adds nothing", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("posts and both competition paths spread photoSetOption(<switch>) into the upload call", () => {
    // Unit B: ONE reader of the switch everywhere, uploads included (usePhotoSetV2, never frozen)
    expect(read("src/components/WallPosts.tsx")).toMatch(/const photoSetV2 = usePhotoSetV2\(\);/);
    expect(read("src/components/WallPosts.tsx")).not.toMatch(/useFeatureAllowed\("photo_set_v2"\)/);
    expect(read("src/components/WallPosts.tsx")).toMatch(/cacheControl: "3600",[\s\S]{0,120}\.\.\.photoSetOption\(photoSetV2\),\s*\}\);/);
    for (const f of ["src/pages/CompetitionSubmit.tsx", "src/components/competition/EditEntryDialog.tsx"]) {
      const s = read(f);
      expect(s, f).toMatch(/const photoSetV2 = usePhotoSetV2\(\);/);
      expect(s, f).not.toMatch(/useFeatureAllowed\("photo_set_v2"\)/);
      expect(s, f).toMatch(/\.\.\.photoSetOption\(photoSetV2\),/);
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

