/**
 * S5-b · the resumable photo job: same keys, same bytes, one post — through
 * lost answers, a dead link mid-upload, an expired presign and a refusal.
 * (The 8 kill points in a real browser are the S5-d harness.)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/media/storedObject", () => ({
  describeStoredObject: async (b: Blob) => ({ sha256: `sha-${b.size}`, bytes: b.size, width: 2000, height: 1500, mime: "image/webp" }),
}));
import { memoryUploadStore } from "../jobStore";
import {
  __resetPhotoJobs, __setPhotoStore, createPhotoJob, photoJobsFor, PhotoRefused, runPhotoJob, runPhotoJobs,
  type EncodedPhoto, type PhotoJob, type PhotoJobDeps,
} from "../photoJobs";

const U = "u1";
const enc = async (f: File): Promise<EncodedPhoto> => ({
  full: { blob: new Blob([new Uint8Array(f.size)], { type: "image/webp" }), width: 2000, height: 1500 },
  thumb: new Blob([new Uint8Array(10)], { type: "image/webp" }),
  rungs: [{ rung: 1080, blob: new Blob([new Uint8Array(20)], { type: "image/webp" }) }, { rung: 1440, blob: new Blob([new Uint8Array(30)], { type: "image/webp" }) }],
});
const post = { content: "hi", privacy: "public", categories: ["street"], indexingDisabled: false };

function fakeServer() {
  const objects = new Map<string, number>(); // key -> PUT count
  const posts = new Map<string, string>(); // idempotency key -> post id
  const presigned: string[] = [];
  let failPuts = 0, expirePuts = 0, losePublish = 0;
  const d: PhotoJobDeps & { now: () => number } = {
    presign: async (objs) => objs.map((o) => { presigned.push(o.path); return { uploadUrl: `https://r2/${o.path}?sig=${presigned.length}`, publicUrl: `https://cdn/${o.path}` }; }),
    put: async (url, _data, _ct, represign) => {
      let u = url;
      if (expirePuts > 0) { expirePuts--; u = await represign(); }
      if (failPuts > 0) { failPuts--; throw new TypeError("Failed to fetch"); }
      const key = u.slice("https://r2/".length).split("?")[0];
      objects.set(key, (objects.get(key) ?? 0) + 1);
    },
    publish: async (j: PhotoJob) => {
      if (!posts.has(j.id)) posts.set(j.id, `post-${posts.size + 1}`);
      if (losePublish > 0) { losePublish--; throw new TypeError("Failed to fetch"); }
      return posts.get(j.id)!;
    },
    online: () => true,
    now: () => 10 ** 12,
  };
  return { d, objects, posts, presigned, failNext: (n: number) => { failPuts = n; }, expireNext: (n: number) => { expirePuts = n; }, losePublish: (n: number) => { losePublish = n; } };
}

let store: ReturnType<typeof memoryUploadStore<PhotoJob>>;
beforeEach(() => { __resetPhotoJobs(); store = memoryUploadStore<PhotoJob>(); __setPhotoStore(store); });

const files = () => [new File([new Uint8Array(100)], "a.jpg"), new File([new Uint8Array(200)], "b.jpg")];

describe("photo job", () => {
  it("keys are deterministic from the upload id and slot; bytes are on the device before the job", async () => {
    const j = await createPhotoJob({ id: "k1", userId: U, files: files(), post }, enc);
    expect(j.slots[0].objects.map((o) => o.path)).toEqual([
      "post-images/u1/posts/k1-0-w2000h1500-l3.webp",
      "post-images/u1/posts/k1-0-w2000h1500-l3-thumb.webp",
      "post-images/u1/posts/k1-0-w2000h1500-l3-r1080.webp",
      "post-images/u1/posts/k1-0-w2000h1500-l3-r1440.webp",
    ]);
    expect(store.files.size).toBe(8);
  });

  it("a dead link mid-upload, then a resume: every key PUT to, no new key, ONE post", async () => {
    const s = fakeServer();
    await createPhotoJob({ id: "k2", userId: U, files: files(), post }, enc);
    s.failNext(1);
    const first = await runPhotoJob("k2", s.d);
    expect(first?.step).toBe("encoded");
    expect(first?.attempts).toBe(1);
    // the "app" restarts: everything is read back from the store
    await runPhotoJobs(U, { ...s.d, now: () => 10 ** 13 });
    expect(s.posts.size).toBe(1);
    expect(new Set(s.presigned).size).toBe(8); // only the 8 deterministic keys were ever asked for
    expect([...s.objects.keys()].every((k) => k.includes("/posts/k2-"))).toBe(true);
    expect(await photoJobsFor(U)).toEqual([]); // done: nothing left on the device
    expect(store.files.size).toBe(0);
  });

  it("an expired presign is re-signed for the SAME key", async () => {
    const s = fakeServer();
    await createPhotoJob({ id: "k3", userId: U, files: files().slice(0, 1), post }, enc);
    s.expireNext(1);
    await runPhotoJob("k3", s.d);
    expect(s.objects.size).toBe(4);
    expect(s.posts.size).toBe(1);
  });

  it("the post committed and its answer was lost (kill point 8): the replay is the same post", async () => {
    const s = fakeServer();
    await createPhotoJob({ id: "k4", userId: U, files: files(), post }, enc);
    s.losePublish(2);
    await runPhotoJob("k4", s.d);
    await runPhotoJob("k4", { ...s.d, now: () => 10 ** 13 });
    await runPhotoJob("k4", { ...s.d, now: () => 10 ** 14 });
    expect(s.posts.size).toBe(1);
    expect(await photoJobsFor(U)).toEqual([]);
  });

  it("a refusal fails the job out loud and keeps the bytes", async () => {
    const s = fakeServer();
    await createPhotoJob({ id: "k5", userId: U, files: files(), post }, enc);
    const j = await runPhotoJob("k5", { ...s.d, publish: async () => { throw new PhotoRefused("banned"); } });
    expect(j?.step).toBe("failed");
    expect(j?.lastError).toBe("banned");
    expect(store.files.size).toBe(8);
  });

  it("offline: nothing is sent, nothing is lost", async () => {
    const s = fakeServer();
    await createPhotoJob({ id: "k6", userId: U, files: files(), post }, enc);
    const j = await runPhotoJob("k6", { ...s.d, online: () => false });
    expect(j?.step).toBe("encoded");
    expect(s.presigned.length).toBe(0);
  });
});

describe("photo plan U1b · photo_set_v2 on the resumable path", () => {
  const encV2 = async (f: File): Promise<EncodedPhoto> => ({
    full: { blob: new Blob([new Uint8Array(f.size)], { type: "image/webp" }), width: 2048, height: 1536 },
    thumb: new Blob([new Uint8Array(10)], { type: "image/webp" }),
    rungs: [{ rung: 1080, blob: new Blob([new Uint8Array(20)], { type: "image/webp" }) }, { rung: 320, blob: new Blob([new Uint8Array(5)], { type: "image/webp" }) }],
    marker: "-l4",
  });

  it("a v2 encode is stored under -l4 (2048 / thumb / 1080 / 320), deterministically", async () => {
    const j = await createPhotoJob({ id: "v1", userId: U, files: files(), post }, encV2);
    expect(j.slots[0].objects.map((o) => o.path)).toEqual([
      "post-images/u1/posts/v1-0-w2048h1536-l4.webp",
      "post-images/u1/posts/v1-0-w2048h1536-l4-thumb.webp",
      "post-images/u1/posts/v1-0-w2048h1536-l4-r1080.webp",
      "post-images/u1/posts/v1-0-w2048h1536-l4-r320.webp",
    ]);
  });

  describe("Unit A/B · the private clean 2048 never holds up a post", () => {
    const encV3 = async (f: File): Promise<EncodedPhoto> => ({
      full: { blob: new Blob([new Uint8Array(f.size)], { type: "image/webp" }), width: 1080, height: 810 },
      thumb: new Blob([new Uint8Array(10)], { type: "image/webp" }),
      rungs: [{ rung: 320, suffix: "-r320", blob: new Blob([new Uint8Array(5)], { type: "image/webp" }) }],
      clean: new Blob([new Uint8Array(50)], { type: "image/webp" }),
      marker: "-l5",
    });

    it("stored once per photo, after the public copies, with the photo's public key", async () => {
      const s = fakeServer();
      const sent: string[] = [];
      await createPhotoJob({ id: "c1", userId: U, files: files(), post }, encV3);
      await runPhotoJob("c1", { ...s.d, putClean: async (k) => { sent.push(k); return "stored"; } });
      expect(s.posts.size).toBe(1);
      expect(sent).toEqual(["post-images/u1/posts/c1-0-w1080h810-l5.webp", "post-images/u1/posts/c1-1-w1080h810-l5.webp"]);
      expect(s.presigned.some((p) => p.endsWith("-r2048.webp"))).toBe(false); // never presigned into the public bucket
    });

    it("a clean-copy route that keeps failing (network / 5xx) is given up after 3 tries — the post is still published", async () => {
      const s = fakeServer();
      let calls = 0;
      await createPhotoJob({ id: "c2", userId: U, files: [new File([new Uint8Array(100)], "a.jpg")], post }, encV3);
      const d = { ...s.d, putClean: async () => { calls++; throw new TypeError("Failed to fetch"); } };
      for (let i = 0; i < 6 && s.posts.size === 0; i++) await runPhotoJob("c2", { ...d, now: () => 10 ** 12 + i * 10 ** 9 });
      expect(s.posts.size).toBe(1);
      expect(calls).toBe(3);
    });
  });

  it("camera details travel on the job record (read before the encode), and old jobs have none", async () => {
    const camera = [{ ord: 1, camera: "Canon EOS R5", iso: 400 }];
    const j = await createPhotoJob({ id: "v2", userId: U, files: files(), post, camera }, encV2);
    expect(j.camera).toEqual(camera);
    const old = await createPhotoJob({ id: "v3", userId: U, files: files(), post }, enc);
    expect("camera" in old).toBe(false);
  });
});
