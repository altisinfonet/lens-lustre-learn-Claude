/**
 * VID-1 / SEC-VID-1 · /api/video/upload-urls and /api/video/complete, driven
 * with a fake R2 binding and a fake Supabase (auth + PostgREST + the RPC).
 *
 * The property SEC-VID-1 asks for, tested directly:
 *   • no URL a client is given ever names a served key (video/…), only upload/video/…;
 *   • the served copy is written by `complete` from bytes it verified, so a
 *     re-PUT to the upload key after `complete` changes nothing viewers get;
 *   • the audio hash sent to video_mark_uploaded is the hash of the served audio.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fakePackage } from "./fixtures";
import { handleUploadUrls } from "../../../../functions/api/video/upload-urls";
import { handleComplete } from "../../../../functions/api/video/complete";
import { presign, type R2BucketLike, type VideoEnv } from "../../../../functions/api/video/_lib";
import { SERVED_PREFIX, UPLOAD_PREFIX, sha256Hex, totalBytes, uploadKey, servedKey, manifestKey, type VideoManifest } from "../shared/rules";
import type { HlsPackage } from "../hlsPackager";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";

class FakeBucket implements R2BucketLike {
  map = new Map<string, Uint8Array>();
  async head(k: string) { const v = this.map.get(k); return v ? { size: v.length } : null; }
  async get(k: string) {
    const v = this.map.get(k);
    return v ? { size: v.length, arrayBuffer: async () => v.slice().buffer } : null;
  }
  async put(k: string, value: ArrayBuffer | Uint8Array | string) {
    this.map.set(k, typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)).slice());
  }
  async delete(k: string | string[]) { for (const x of Array.isArray(k) ? k : [k]) this.map.delete(x); }
}

interface World {
  bucket: FakeBucket;
  env: VideoEnv;
  fetch: typeof fetch;
  rpcCalls: Array<Record<string, unknown>>;
  state: { value: string };
}

function world(pkg: HlsPackage, opts: { state?: string; manifestSha?: string } = {}): World {
  const bucket = new FakeBucket();
  const rpcCalls: Array<Record<string, unknown>> = [];
  const state = { value: opts.state ?? "uploading" };
  const env: VideoEnv = {
    SUPABASE_PROJECT_REF: "testref", SUPABASE_ANON_KEY: "anon", MEDIA: bucket,
    R2_ACCOUNT_ID: "acct123", R2_BUCKET: "media-staging", R2_UPLOAD_KEY_ID: "AKIDTEST", R2_UPLOAD_KEY_SECRET: "secret", VIDEO_DELIVERY_PRIVATE: "1",
  };
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const uid = auth === "Bearer owner-jwt" ? OWNER : auth === "Bearer stranger-jwt" ? STRANGER : null;
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/auth/v1/user")) return uid ? ok({ id: uid }) : new Response("{}", { status: 401 });
    if (url.includes("/rest/v1/videos?")) return ok(uid === OWNER ? [{ id: VID, owner_id: OWNER, state: state.value, current_version: 1, purpose: "post" }] : []);
    if (url.includes("/rest/v1/video_versions?")) {
      return ok(uid === OWNER ? [{
        manifest_sha256: opts.manifestSha ?? pkg.manifestSha256, total_bytes: totalBytes(pkg.manifest),
        declared_duration_s: pkg.manifest.duration_s, has_audio: pkg.manifest.has_audio,
      }] : []);
    }
    if (url.endsWith("/rest/v1/rpc/video_mark_uploaded")) {
      rpcCalls.push(JSON.parse(String(init?.body)));
      state.value = "ready";
      return ok({ video_id: VID, version_no: 1, state: "ready" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { bucket, env, fetch: fakeFetch, rpcCalls, state };
}

const post = (body: unknown, jwt = "owner-jwt") =>
  new Request("https://app.test/api/video/x", { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(body) });

/** What the client does with the URLs: PUT each file (here: straight into the fake bucket at the URL's key). */
function clientPuts(w: World, urls: Array<{ name: string; key: string; url: string }>, files: Map<string, Uint8Array>) {
  for (const u of urls) {
    const path = new URL(u.url).pathname; // /<bucket>/<key>
    const key = decodeURIComponent(path.split("/").slice(2).join("/"));
    expect(key).toBe(u.key);
    w.bucket.map.set(key, files.get(u.name)!.slice());
  }
}

async function uploadAll(w: World, pkg: HlsPackage) {
  const r = await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest }), w.env, new Date("2026-10-05T12:00:00Z"), w.fetch);
  expect(r.status).toBe(200);
  const body = await r.json() as { urls: Array<{ name: string; key: string; url: string; headers: Record<string, string> }>; done: string[] };
  clientPuts(w, body.urls, pkg.files);
  return body;
}

let pkg: HlsPackage;
beforeEach(async () => { pkg = await fakePackage({ seconds: 10 }); });

describe("SigV4 presigning", () => {
  it("reproduces AWS's documented presigned-URL example byte for byte", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = await presign({
      method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1", service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      amzDate: "20130524T000000Z", expires: 86400,
    });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
});

describe("/api/video/upload-urls", () => {
  it("SEC-VID-1: every URL is for upload/video/…, never a served key", async () => {
    const w = world(pkg);
    const body = await uploadAll(w, pkg);
    expect(body.urls.length).toBe(pkg.files.size);
    for (const u of body.urls) {
      expect(u.key.startsWith(UPLOAD_PREFIX)).toBe(true);
      expect(u.key).toBe(uploadKey(OWNER, VID, 1, u.name));
      expect(new URL(u.url).pathname.startsWith(`/media-staging/${UPLOAD_PREFIX}`)).toBe(true);
      expect(new URL(u.url).pathname).not.toContain(`/media-staging/${SERVED_PREFIX}`);
    }
    // nothing at all exists under the served prefix until complete runs
    expect([...w.bucket.map.keys()].some((k) => k.startsWith(SERVED_PREFIX))).toBe(false);
  });

  it("each URL signs content-length, content-type, host and the sha256, for 1 h, on the R2 S3 host", async () => {
    const w = world(pkg);
    const r = await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest }), w.env, new Date("2026-10-05T12:00:00Z"), w.fetch);
    const body = await r.json() as { urls: Array<{ url: string; headers: Record<string, string>; name: string }> };
    const u = new URL(body.urls[0].url);
    expect(u.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host;x-amz-checksum-sha256");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(Object.keys(body.urls[0].headers).sort()).toEqual(["content-type", "x-amz-checksum-sha256"]);
  });

  it("stores the canonical manifest server-side, and skips files already uploaded (resume)", async () => {
    const w = world(pkg);
    await uploadAll(w, pkg);
    expect(w.bucket.map.has(manifestKey(OWNER, VID, 1))).toBe(true);
    const again = await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest }), w.env, new Date(), w.fetch);
    const b = await again.json() as { urls: unknown[]; done: string[] };
    expect(b.urls).toEqual([]);
    expect(b.done.length).toBe(pkg.files.size);
  });

  it("refuses: no sign-in 401 · a stranger 404 · a manifest the database did not declare 409 · a bad file name 400", async () => {
    const w = world(pkg);
    const noAuth = new Request("https://app.test/api/video/upload-urls", { method: "POST", body: "{}" });
    expect((await handleUploadUrls(noAuth, w.env, new Date(), w.fetch)).status).toBe(401);
    expect((await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest }, "stranger-jwt"), w.env, new Date(), w.fetch)).status).toBe(404);
    const other = world(pkg, { manifestSha: "0".repeat(64) });
    expect((await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest }), other.env, new Date(), other.fetch)).status).toBe(409);
    const bad: VideoManifest = { ...pkg.manifest, files: [...pkg.manifest.files, { name: "../x.mp4", bytes: 1, sha256: "a".repeat(64) }] };
    expect((await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: bad }), w.env, new Date(), w.fetch)).status).toBe(400);
  });

  it("refuses a video that is not uploading any more", async () => {
    const w = world(pkg, { state: "checking" });
    expect((await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest }), w.env, new Date(), w.fetch)).status).toBe(409);
  });
});

describe("F-D3-18 · no upload while the media host is public", () => {
  it("both endpoints answer 503 VID-ENV-002 until VIDEO_DELIVERY_PRIVATE=1, and write nothing", async () => {
    const w = world(pkg);
    delete w.env.VIDEO_DELIVERY_PRIVATE;
    const a = await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest }), w.env, new Date(), w.fetch);
    const b = await handleComplete(post({ video_id: VID, version_no: 1 }), w.env, w.fetch);
    expect([a.status, b.status]).toEqual([503, 503]);
    expect((await a.json() as { error: string }).error).toBe("VID-ENV-002");
    expect(w.bucket.map.size).toBe(0);
  });
});

describe("/api/video/complete", () => {
  it("verifies, copies to the served prefix itself, and marks uploaded with the served audio's hash", async () => {
    const w = world(pkg);
    await uploadAll(w, pkg);
    const r = await handleComplete(post({ video_id: VID, version_no: 1 }), w.env, w.fetch);
    expect(r.status).toBe(200);
    for (const [name, bytes] of pkg.files) {
      expect(Array.from(w.bucket.map.get(servedKey(OWNER, VID, 1, name)) ?? []), name).toEqual(Array.from(bytes));
    }
    const audio = [pkg.files.get("audio.mp4")!, ...[...pkg.files.keys()].filter((n) => /^audio_\d+\.m4s$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).map((n) => pkg.files.get(n)!)];
    const all = new Uint8Array(audio.reduce((a, p) => a + p.length, 0));
    let o = 0; for (const p of audio) { all.set(p, o); o += p.length; }
    expect(w.rpcCalls).toEqual([{ _video_id: VID, _version_no: 1, _audio_sha256: await sha256Hex(all) }]);
  });

  it("SEC-VID-1: a re-PUT to the upload key AFTER complete changes nothing viewers get", async () => {
    const w = world(pkg);
    await uploadAll(w, pkg);
    expect((await handleComplete(post({ video_id: VID, version_no: 1 }), w.env, w.fetch)).status).toBe(200);
    const swapped = new Uint8Array(pkg.files.get("audio_0.m4s")!.length).fill(7);
    w.bucket.map.set(uploadKey(OWNER, VID, 1, "audio_0.m4s"), swapped); // the hour-long URL is still valid
    expect(Array.from(w.bucket.map.get(servedKey(OWNER, VID, 1, "audio_0.m4s"))!)).toEqual(Array.from(pkg.files.get("audio_0.m4s")!));
  });

  it("missing files → 409 with the list, nothing marked", async () => {
    const w = world(pkg);
    await uploadAll(w, pkg);
    w.bucket.map.delete(uploadKey(OWNER, VID, 1, "480p_1.m4s"));
    const r = await handleComplete(post({ video_id: VID, version_no: 1 }), w.env, w.fetch);
    expect(r.status).toBe(409);
    expect((await r.json() as { missing: string[] }).missing).toEqual(["480p_1.m4s"]);
    expect(w.rpcCalls).toEqual([]);
  });

  it("a file whose bytes differ from the manifest is deleted and reported, nothing marked", async () => {
    const w = world(pkg);
    await uploadAll(w, pkg);
    const k = uploadKey(OWNER, VID, 1, "240p_0.m4s");
    w.bucket.map.set(k, new Uint8Array(w.bucket.map.get(k)!.length));
    const r = await handleComplete(post({ video_id: VID, version_no: 1 }), w.env, w.fetch);
    expect(r.status).toBe(409);
    expect((await r.json() as { mismatched: string[] }).mismatched).toEqual(["240p_0.m4s"]);
    expect(w.bucket.map.has(k)).toBe(false);
    expect([...w.bucket.map.keys()].some((x) => x.startsWith(SERVED_PREFIX))).toBe(false);
  });

  async function withSwap(name: string, bytes: Uint8Array) {
    // a package whose manifest honestly lists the swapped bytes, so only the content rule can catch it
    const files = new Map(pkg.files);
    files.set(name, bytes);
    const { canonicalManifest } = await import("../shared/rules");
    const list = await Promise.all([...files].map(async ([n, b]) => ({ name: n, bytes: b.length, sha256: await sha256Hex(b) })));
    const manifest: VideoManifest = { ...pkg.manifest, files: list };
    const text = canonicalManifest(manifest);
    const p2: HlsPackage = { files, manifest, manifestText: text, manifestSha256: await sha256Hex(text) };
    const w = world(p2);
    await uploadAll(w, p2);
    const r = await handleComplete(post({ video_id: VID, version_no: 1 }), w.env, w.fetch);
    return { r, w, body: await r.json() as { problems?: string[] } };
  }

  it("F-D3-17: a video rendition carrying a sound track is refused", async () => {
    const { r, body, w } = await withSwap("480p.mp4", pkg.files.get("audio.mp4")!);
    expect(r.status).toBe(409);
    expect(body.problems?.join(" ")).toMatch(/480p must hold exactly one video track and no audio/);
    expect(w.rpcCalls).toEqual([]);
  });

  it("F-D3-17: an audio rendition that is not one sound track is refused", async () => {
    const { r, body } = await withSwap("audio.mp4", pkg.files.get("240p.mp4")!);
    expect(r.status).toBe(409);
    expect(body.problems?.join(" ")).toMatch(/audio rendition must hold exactly one audio track/);
  });

  it("SEC condition 3: an absolute URI or an EXT-X-KEY in a playlist is refused", async () => {
    const t = new TextDecoder().decode(pkg.files.get("240p.m3u8")!);
    const a = await withSwap("240p.m3u8", new TextEncoder().encode(t.replace("240p_0.m4s", "https://evil.example/x.m4s")));
    expect(a.r.status).toBe(409);
    const k = await withSwap("240p.m3u8", new TextEncoder().encode(t.replace("#EXT-X-MAP", '#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXT-X-MAP')));
    expect(k.r.status).toBe(409);
  });

  it("SEC condition 2: a poster that is not a JPEG is refused", async () => {
    const { r, body } = await withSwap("poster.jpg", new TextEncoder().encode("<svg onload=alert(1)>"));
    expect(r.status).toBe(409);
    expect(body.problems).toContain("poster.jpg is not a JPEG");
  });

  it("a retry after success answers without doing anything (outbox replay)", async () => {
    const w = world(pkg, { state: "ready" });
    const r = await handleComplete(post({ video_id: VID, version_no: 1 }), w.env, w.fetch);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { replayed: boolean }).replayed).toBe(true);
    expect(w.rpcCalls).toEqual([]);
  });
});
