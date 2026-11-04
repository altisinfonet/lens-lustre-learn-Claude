/**
 * FEED PHOTO SET — Owner order, 4 Nov 2026 (feed posts only):
 *   A) a feed photo upload stores EXACTLY 3 WebP files — 2048 (the URL; a smaller
 *      photo keeps its own size), 1080, 600 — sizes from ONE list
 *      (imageLadder.FEED_PHOTO_SIZES), used by the uploader AND the display.
 *      No private clean 2048, no credited `-r2048c`, no 320, no 1440.
 *   B) the credit is NEVER stored: it is drawn in the browser at save time from
 *      CREDIT_GEOMETRY_V5 (src/lib/creditGeometry.mjs).
 * The new set is the CODE path for every feed post — no switch decides it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const compressImageToFiles = vi.fn(async (_f: File, name: string, opts?: { maxDimension?: number }) => {
  const max = opts?.maxDimension ?? 3000;
  return { webpFile: new File([new Uint8Array(10)], `${name}.webp`, { type: "image/webp" }), width: Math.min(3000, max), height: Math.round((Math.min(3000, max) * 2) / 3) };
});
const compressThumbnail = vi.fn(async (_f: File, name: string) => ({ webpFile: new File([new Uint8Array(2)], `${name}-thumb.webp`, { type: "image/webp" }) }));
vi.mock("@/lib/imageCompression", () => ({ compressImageToFiles, compressThumbnail, decodeImageForCanvas: vi.fn() }));

/** The canvas encoder is a browser thing; here a 4000×3000 source gives the three planned copies. */
const SRC = { width: 4000, height: 3000 };
const feedCopy = (slot: string, max: number) => {
  const r = Math.min(1, max / Math.max(SRC.width, SRC.height));
  return { slot, maxDimension: max, quality: 0.8, credit: false, width: Math.round(SRC.width * r), height: Math.round(SRC.height * r), file: new File([new Uint8Array(max)], `${slot}.webp`, { type: "image/webp" }) };
};
const encodeFeedPhotoSet = vi.fn(async () => ({ source: SRC, copies: [feedCopy("master", 2048), feedCopy("r1080", 1080), feedCopy("thumb", 600)] }));
const encodePhotoSet = vi.fn(async () => { throw new Error("the v3 encoder must not run for a feed post"); });
vi.mock("@/lib/photoSetEncode", () => ({ encodeFeedPhotoSet, encodePhotoSet, fitInside: (w: number, h: number) => ({ width: w, height: h }) }));

vi.mock("@/lib/s3Upload", () => ({ isS3Enabled: async () => false, uploadPairToS3: vi.fn(), uploadToS3: vi.fn() }));
const storageUpload = vi.fn(async (_b: string, p: string, _f: unknown, _o?: unknown) => ({ url: `https://cdn/${p}`, path: p }));
vi.mock("@/lib/storageUpload", () => ({ storageUpload }));
vi.mock("@/lib/gpsGuard", async () => ({ ...(await vi.importActual<object>("@/lib/gpsGuard")), guardOriginalUpload: vi.fn(async (f: File) => f) }));
vi.mock("@/lib/media/storedObject", () => ({ describeStoredObject: vi.fn(async (_b: Blob, d: unknown) => ({ dims: d })) }));
const storeCleanCopy = vi.fn(async () => "stored" as const);
vi.mock("@/lib/media/cleanCopyClient", () => ({ storeCleanCopy }));

const jpeg = () => new File([new Uint8Array(1000)], "IMG_0001.jpg", { type: "image/jpeg" });
const seg = (p: string) => p.replace(/^u1\/posts\/\d+-[a-z0-9]+/, "<seg>");

beforeEach(() => {
  storageUpload.mockClear();
  storeCleanCopy.mockClear();
  encodeFeedPhotoSet.mockClear();
  compressImageToFiles.mockClear();
});

describe("A · the ONE size list", () => {
  it("FEED_PHOTO_SIZES is exactly 2048 / 1080 / 600", async () => {
    const { FEED_PHOTO_SIZES } = await import("@/lib/imageLadder");
    expect([...FEED_PHOTO_SIZES]).toEqual([2048, 1080, 600]);
  });

  it("the plan is three clean public WebP copies, never upscaled", async () => {
    const { feedPhotoPlan } = await import("@/lib/imageLadder");
    const plan = feedPhotoPlan();
    expect(plan.map((c) => [c.slot, c.maxDimension])).toEqual([["master", 2048], ["r1080", 1080], ["thumb", 600]]);
    expect(plan.every((c) => !c.credit && !c.private)).toBe(true);
  });
});

describe("A · a feed upload stores exactly 3 WebP files 2048 / 1080 / 600", () => {
  for (const photoSet of [false, true]) {
    it(`switch answer ${photoSet ? "ON" : "OFF"} — the same three files (no switch decides it)`, async () => {
      const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
      const r = await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1", cacheControl: "3600", ...(photoSet ? { photoSet: true as const } : {}) });
      const stored = storageUpload.mock.calls.map((c) => ({ path: seg(c[1] as string), type: (c[2] as File).type }));
      expect(stored.map((s) => s.path).sort()).toEqual([
        "<seg>-w2048h1536-l6-r1080.webp",
        "<seg>-w2048h1536-l6-thumb.webp",
        "<seg>-w2048h1536-l6.webp",
      ]);
      expect(stored.every((s) => s.type === "image/webp")).toBe(true);
      expect(r.url).toMatch(/-w2048h1536-l6\.webp$/);
      expect(r.thumbnailUrl).toMatch(/-l6-thumb\.webp$/);
    });
  }

  it("no credited, private, 320, 1440 or full-size copy is uploaded", async () => {
    const { uploadImageWithThumbnail } = await import("@/lib/imageUpload");
    await uploadImageWithThumbnail({ bucket: "post-images", file: jpeg(), type: "post", userId: "u1", photoSet: true });
    const names = storageUpload.mock.calls.map((c) => c[1] as string);
    expect(names.some((p) => /-r2048c?\.|-r320\.|-r1440\.|photo-clean\//.test(p))).toBe(false);
    expect(storeCleanCopy).not.toHaveBeenCalled();
    expect(compressImageToFiles).not.toHaveBeenCalled(); // no 2560 "original"
  });

  it("the resumable photo job's encoder (default AND switch-on) makes the same set", async () => {
    const { defaultPhotoEncoder } = await import("@/lib/upload/photoJobs");
    const { photoSetPhotoEncoder } = await import("@/lib/photoSetUpload");
    for (const enc of [defaultPhotoEncoder, photoSetPhotoEncoder()]) {
      const e = await enc(jpeg());
      expect(e.marker).toBe("-l6");
      expect([e.full.width, e.full.height]).toEqual([2048, 1536]);
      expect(e.rungs.map((r) => r.suffix)).toEqual(["-r1080"]);
      expect(e.clean).toBeUndefined();
    }
  });
});

describe("A · display and deletion safety read the same list", () => {
  const url = "https://cdn.50mmretina.com/post-images/u1/posts/1-a-w2048h1365-l6.webp";

  it("the feed srcset offers 600 / 1080 / 2048 (src = 1080)", async () => {
    const { feedPhotoSet } = await import("@/lib/photoProtection");
    expect(feedPhotoSet(url, false)).toEqual({
      src: url.replace(".webp", "-r1080.webp"),
      srcSet: `${url.replace(".webp", "-thumb.webp")} 600w, ${url.replace(".webp", "-r1080.webp")} 1080w, ${url} 2048w`,
    });
  });

  it("every size resolves to a stored copy; nothing credited exists", async () => {
    const { photoSetUrl, photoSetSiblingKeys, photoSetCleanKey, isCreditedPhotoUrl } = await import("@/lib/imageLadder");
    expect(photoSetUrl(url, 2048)).toBe(url);
    expect(photoSetUrl(url, 1080)).toBe(url.replace(".webp", "-r1080.webp"));
    expect(photoSetUrl(url, 600)).toBe(url.replace(".webp", "-thumb.webp"));
    expect(photoSetUrl(url, 320)).toBe(url.replace(".webp", "-thumb.webp"));
    expect(photoSetSiblingKeys("post-images/u1/posts/1-a-w2048h1365-l6.webp")).toEqual(["post-images/u1/posts/1-a-w2048h1365-l6-r1080.webp"]);
    expect(photoSetCleanKey("post-images/u1/posts/1-a-w2048h1365-l6.webp")).toBeNull();
    expect(isCreditedPhotoUrl(url)).toBe(false);
  });

  it("detect-orphan-files derives the -l6 siblings (r1080, thumb)", () => {
    const src = readFileSync(join(process.cwd(), "supabase/functions/detect-orphan-files/index.ts"), "utf8");
    expect(src).toMatch(/-l6-r1080/);
    expect(src).toMatch(/-l6-thumb/);
  });
});

describe("B · the credit is drawn on SAVE from CREDIT_GEOMETRY_V5", () => {
  it("a 2048×1365 save gets the 22 px credit, bottom-right, white 0.32", async () => {
    const { paintSaveCredit } = await import("@/lib/photoCreditSave");
    const calls: { op: string; args: unknown[]; font: string; fill: unknown }[] = [];
    const ctx = {
      font: "", fillStyle: "" as unknown, shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, textBaseline: "alphabetic",
      measureText: (t: string) => ({ width: t.length * 11, fontBoundingBoxAscent: 20, fontBoundingBoxDescent: 6 }),
      fillText(...args: unknown[]) { calls.push({ op: "fillText", args, font: this.font, fill: this.fillStyle }); },
      save() {}, restore() {},
    };
    const r = paintSaveCredit(ctx as unknown as CanvasRenderingContext2D, 2048, 1365, "© A Member, 50mm Retina World");
    expect(r.drawn).toBe(true);
    expect(r.fontPx).toBe(22);
    const white = calls.find((c) => c.fill === "rgba(255, 255, 255, 0.32)");
    expect(white?.font).toMatch(/600 22px/);
    expect(white?.args[0]).toBe("© A Member, 50mm Retina World");
    expect(white?.args[1] as number).toBe(2048 - r.inset - r.textW);
  });

  it("only a feed set photo (-l6) is saved by drawing; old photos keep their own path", async () => {
    const { drawsCreditOnSave } = await import("@/lib/photoCreditSave");
    expect(drawsCreditOnSave("https://cdn/x-w2048h1365-l6.webp")).toBe(true);
    expect(drawsCreditOnSave("https://cdn/x-w1080h720-l5.webp")).toBe(false);
    expect(drawsCreditOnSave("https://cdn/x-w2560h1707-l3.webp")).toBe(false);
  });
});

describe("ratchet · one size list, one credit geometry, one font loader", () => {
  const root = join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== "__tests__") walk(p); }
      else if (/\.(ts|tsx|mjs)$/.test(n) && !/\.test\.|\.d\.mts$/.test(n)) files.push(p);
    }
  };
  walk(root);
  const hits = (re: RegExp) => files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => relative(process.cwd(), f).replace(/\\/g, "/"));

  it("the feed size list is written once (imageLadder.ts)", () => {
    expect(hits(/\[\s*2048\s*,\s*1080\s*,\s*600\s*\]/)).toEqual(["src/lib/imageLadder.ts"]);
  });
  it("the credit geometry numbers live only in creditGeometry.mjs", () => {
    expect(hits(/fontPctShort\s*:|minFontPx\s*:|0\.0162/)).toEqual(["src/lib/creditGeometry.mjs"]);
  });
  it("the browser credit is drawn in ONE module, with the server's committed font", () => {
    expect(hits(/new FontFace\(/)).toEqual(["src/lib/photoCreditSave.ts"]);
    expect(readFileSync(join(root, "lib/photoCreditSave.ts"), "utf8")).toMatch(/tools\/media-derivatives\/fonts\/FiraSans-SemiBold-latin\.ttf\?url/);
  });
});
