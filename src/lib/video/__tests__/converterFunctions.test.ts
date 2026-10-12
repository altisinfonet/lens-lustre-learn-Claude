/**
 * Server conversion (CONVERTER-DESIGN.md v2, 20261012_0002) · the Pages side,
 * driven with a fake R2 binding and a fake Supabase:
 *   • members: /source-url (one PUT for upload/source/<id>/source, size + type
 *     signed), /source-complete (size checked, ETag recorded), /source-cancel;
 *   • the VM: /convert/claim (the original checked AGAIN before a GET pinned to
 *     its ETag is handed out — R6, review #416 finding 7), /convert/finish
 *     (the database checks the claim; only then is the original deleted);
 *   • the converter path of /upload-urls and /complete: the video comes from
 *     video_converter_version (never video_upload_info) and every URL lives no
 *     longer than the claim's lease (R2).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fakePackage } from "./fixtures";
import { handleSourceUrl } from "../../../../functions/api/video/source-url";
import { handleSourceComplete } from "../../../../functions/api/video/source-complete";
import { handleSourceCancel } from "../../../../functions/api/video/source-cancel";
import { handleConvertClaim } from "../../../../functions/api/video/convert/claim";
import { handleConvertFinish } from "../../../../functions/api/video/convert/finish";
import { handleUploadUrls } from "../../../../functions/api/video/upload-urls";
import { handleComplete } from "../../../../functions/api/video/complete";
import { sourceKey, ttlWithinLease, type R2BucketLike, type VideoEnv } from "../../../../functions/api/video/_lib";
import type { AttestEnv } from "../../../../functions/api/video/attest";
import { totalBytes, uploadKey, UPLOAD_PREFIX } from "../shared/rules";
import type { HlsPackage } from "../hlsPackager";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const CONV = "44444444-4444-4444-8444-444444444444";
const SRC = "55555555-5555-4555-8555-555555555555";
const VID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-10-12T12:00:00Z");
const BYTES = 1234;

class FakeBucket implements R2BucketLike {
  map = new Map<string, { data: Uint8Array; etag: string }>();
  deleted: string[] = [];
  async head(k: string) { const v = this.map.get(k); return v ? { size: v.data.length, etag: v.etag } : null; }
  async get(k: string) { const v = this.map.get(k); return v ? { size: v.data.length, arrayBuffer: async () => v.data.slice().buffer } : null; }
  async put(k: string, value: ArrayBuffer | Uint8Array | string) {
    const data = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)).slice();
    this.map.set(k, { data, etag: "etag" + data.length });
  }
  async delete(k: string | string[]) { for (const x of Array.isArray(k) ? k : [k]) { this.map.delete(x); this.deleted.push(x); } }
  async list(o: { prefix: string }) {
    const objects = [...this.map.entries()].filter(([k]) => k.startsWith(o.prefix)).map(([key, v]) => ({ key, size: v.data.length }));
    return { objects, truncated: false };
  }
}

interface World {
  bucket: FakeBucket; env: VideoEnv & AttestEnv; fetch: typeof fetch;
  rpc: Array<{ fn: string; body: Record<string, unknown> }>;
  source: { status: string; etag: string | null };
  job: Record<string, unknown> | null;
  failAnswer: string; refuseClaim: boolean; leaseUntil: string; pkg?: HlsPackage; videoState: string;
}

function world(opts: Partial<Pick<World, "job" | "failAnswer" | "refuseClaim" | "leaseUntil" | "pkg">> = {}): World {
  const bucket = new FakeBucket();
  const w = {
    bucket, rpc: [] as World["rpc"], source: { status: "awaiting_upload", etag: null as string | null },
    job: opts.job === undefined ? null : opts.job, failAnswer: opts.failAnswer ?? "failed", refuseClaim: opts.refuseClaim ?? false,
    leaseUntil: opts.leaseUntil ?? new Date(NOW.getTime() + 30 * 60_000).toISOString(), pkg: opts.pkg, videoState: "uploading",
  } as World;
  w.env = {
    SUPABASE_PROJECT_REF: "testref", SUPABASE_ANON_KEY: "anon", MEDIA: bucket,
    R2_ACCOUNT_ID: "acct123", R2_BUCKET: "media-staging", R2_UPLOAD_KEY_ID: "AKIDTEST", R2_UPLOAD_KEY_SECRET: "secret", VIDEO_DELIVERY_PRIVATE: "1",
    VIDEO_COMPLETE_ATTEST_KEY: "test-attest-key-0123456789abcdef-staging", VIDEO_ATTEST_LANE: "staging",
  };
  w.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const uid = auth === "Bearer owner-jwt" ? OWNER : auth === "Bearer stranger-jwt" ? STRANGER : auth === "Bearer conv-jwt" ? CONV : null;
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const refuse = (m: string) => new Response(JSON.stringify({ code: "42501", message: m }), { status: 400 });
    if (url.endsWith("/auth/v1/user")) return uid ? ok({ id: uid }) : new Response("{}", { status: 401 });
    // RLS (video_sources_owner_read): the owner sees their row, nobody else does.
    if (url.includes("/rest/v1/video_sources?")) return ok(uid === OWNER ? [{ id: SRC, owner_id: OWNER, status: w.source.status, source_bytes: BYTES }] : []);
    const rpcMatch = /\/rest\/v1\/rpc\/(\w+)$/.exec(url);
    if (rpcMatch) {
      const fn = rpcMatch[1]; const body = JSON.parse(String(init?.body ?? "{}"));
      w.rpc.push({ fn, body });
      if (fn === "video_source_uploaded") { if (uid !== OWNER) return refuse("VID-SRC-004"); w.source.status = "queued"; w.source.etag = body._etag; return ok({ status: "queued" }); }
      if (fn === "video_source_cancel") { if (uid !== OWNER) return refuse("VID-SRC-004"); w.source.status = "cancelled"; return ok("cancelled"); }
      if (uid !== CONV) return refuse("VID-CONV-001: converter only");
      if (fn === "video_source_claim") return ok(w.job);
      if (fn === "video_source_fail") return w.refuseClaim ? refuse("VID-CONV-002: this claim is not held") : ok(w.failAnswer);
      if (fn === "video_source_done") return w.refuseClaim ? refuse("VID-CONV-002: this claim is not held") : ok({ state: "ready" });
      if (fn === "video_converter_version") {
        if (body._claim_token !== TOKEN || !w.pkg) return ok([]);
        return ok([{ video_id: VID, owner_id: OWNER, state: w.videoState, current_version: 1, purpose: "post", manifest_sha256: w.pkg.manifestSha256,
          total_bytes: totalBytes(w.pkg.manifest), declared_duration_s: w.pkg.manifest.duration_s, has_audio: w.pkg.manifest.has_audio, lease_until: w.leaseUntil }]);
      }
      if (fn === "video_mark_uploaded") { w.videoState = "ready"; return ok({ state: "ready" }); }
      if (fn === "video_upload_info") return ok([]);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return w;
}

const post = (body: unknown, jwt = "owner-jwt") =>
  new Request("https://app.test/api/video/x", { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const JOB = (over: Record<string, unknown> = {}) => ({
  source_id: SRC, owner_id: OWNER, purpose: "post", source_bytes: BYTES, source_etag: "etag" + BYTES, claim_token: TOKEN,
  lease_until: new Date(NOW.getTime() + 30 * 60_000).toISOString(), attempt: 1, ...over,
});
const putSource = (w: World, bytes = BYTES) => w.bucket.map.set(sourceKey(SRC), { data: new Uint8Array(bytes), etag: "etag" + bytes });

describe("/api/video/source-url (member)", () => {
  it("one PUT for upload/source/<id>/source — size and a fixed octet-stream type signed, 1 h", async () => {
    const w = world();
    const r = await handleSourceUrl(post({ source_id: SRC }), w.env, NOW, w.fetch);
    expect(r.status).toBe(200);
    const b = await r.json() as { key: string; url: string; headers: Record<string, string>; bytes: number };
    expect(b.key).toBe(`upload/source/${SRC}/source`);
    const u = new URL(b.url);
    expect(u.pathname).toBe(`/media-staging/upload/source/${SRC}/source`);
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(b.headers).toEqual({ "content-type": "application/octet-stream" });
    expect(b.bytes).toBe(BYTES);
  });
  it("refuses: no sign-in 401 · someone else's source 404 · a source past its upload 409", async () => {
    const w = world();
    expect((await handleSourceUrl(new Request("https://app.test/x", { method: "POST", body: "{}" }), w.env, NOW, w.fetch)).status).toBe(401);
    expect((await handleSourceUrl(post({ source_id: SRC }, "stranger-jwt"), w.env, NOW, w.fetch)).status).toBe(404);
    w.source.status = "queued";
    expect((await handleSourceUrl(post({ source_id: SRC }), w.env, NOW, w.fetch)).status).toBe(409);
    expect((await handleSourceUrl(post({ source_id: "../x" }), w.env, NOW, w.fetch)).status).toBe(400);
  });
});

describe("/api/video/source-complete (member)", () => {
  it("nothing uploaded → 409, nothing queued", async () => {
    const w = world();
    const r = await handleSourceComplete(post({ source_id: SRC }), w.env, w.fetch);
    expect(r.status).toBe(409);
    expect(w.rpc.some((c) => c.fn === "video_source_uploaded")).toBe(false);
  });
  it("the wrong size → the object is deleted, 409, nothing queued", async () => {
    const w = world(); putSource(w, BYTES + 1);
    const r = await handleSourceComplete(post({ source_id: SRC }), w.env, w.fetch);
    expect(r.status).toBe(409);
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(false);
    expect(w.rpc.some((c) => c.fn === "video_source_uploaded")).toBe(false);
  });
  it("the right size → queued with the object's ETag recorded [R6]; a second call is a replay", async () => {
    const w = world(); putSource(w);
    const r = await handleSourceComplete(post({ source_id: SRC }), w.env, w.fetch);
    expect(r.status).toBe(200);
    expect(w.rpc.find((c) => c.fn === "video_source_uploaded")?.body).toEqual({ _source_id: SRC, _etag: "etag" + BYTES });
    const again = await (await handleSourceComplete(post({ source_id: SRC }), w.env, w.fetch)).json() as { replayed: boolean; status: string };
    expect(again).toMatchObject({ replayed: true, status: "queued" });
  });
});

describe("/api/video/source-cancel (member)", () => {
  it("cancels in the database, then deletes the original", async () => {
    const w = world(); putSource(w);
    const r = await handleSourceCancel(post({ source_id: SRC }), w.env, w.fetch);
    expect(await r.json()).toMatchObject({ status: "cancelled" });
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(false);
  });
  it("someone else's source → 404, nothing deleted", async () => {
    const w = world(); putSource(w);
    expect((await handleSourceCancel(post({ source_id: SRC }, "stranger-jwt"), w.env, w.fetch)).status).toBe(404);
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(true);
  });
});

describe("/api/video/convert/claim (VM)", () => {
  it("no job → {job: null}", async () => {
    const w = world();
    expect(await (await handleConvertClaim(post({}, "conv-jwt"), w.env, NOW, w.fetch)).json()).toEqual({ job: null });
  });
  it("a member calling it gets the database's refusal, no URL", async () => {
    const w = world({ job: JOB() }); putSource(w);
    const r = await handleConvertClaim(post({}, "owner-jwt"), w.env, NOW, w.fetch);
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).not.toContain("X-Amz-Signature");
  });
  it("a job → ONE GET pinned to the recorded ETag (signed If-Match), living no longer than the lease [R2][R6]", async () => {
    const w = world({ job: JOB() }); putSource(w);
    const r = await handleConvertClaim(post({}, "conv-jwt"), w.env, NOW, w.fetch);
    expect(r.status).toBe(200);
    const b = await r.json() as { job: { claim_token: string }; source: { url: string; headers: Record<string, string>; expires_in: number } };
    expect(b.job.claim_token).toBe(TOKEN);
    const u = new URL(b.source.url);
    expect(u.pathname).toBe(`/media-staging/upload/source/${SRC}/source`);
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host;if-match");
    expect(b.source.headers).toEqual({ "if-match": `"etag${BYTES}"` });
    expect(b.source.expires_in).toBe(30 * 60 - 30);
    expect(u.searchParams.get("X-Amz-Expires")).toBe(String(30 * 60 - 30));
  });
  it("the original missing → the job is failed as source_missing, 409, no URL [review #416 finding 7]", async () => {
    const w = world({ job: JOB() });
    const r = await handleConvertClaim(post({}, "conv-jwt"), w.env, NOW, w.fetch);
    expect(r.status).toBe(409);
    expect(w.rpc.find((c) => c.fn === "video_source_fail")?.body).toMatchObject({ _source_id: SRC, _claim_token: TOKEN, _code: "source_missing" });
  });
  it("the original changed after it was queued (ETag) → failed, deleted, no URL", async () => {
    const w = world({ job: JOB({ source_etag: "etag-other" }) }); putSource(w);
    const r = await handleConvertClaim(post({}, "conv-jwt"), w.env, NOW, w.fetch);
    expect(r.status).toBe(409);
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(false);
    expect(w.rpc.some((c) => c.fn === "video_source_fail")).toBe(true);
  });
});

describe("/api/video/convert/finish (VM)", () => {
  it("done → the database ends the job, then the original is deleted", async () => {
    const w = world(); putSource(w);
    const r = await handleConvertFinish(post({ source_id: SRC, claim_token: TOKEN, outcome: "done" }, "conv-jwt"), w.env, w.fetch);
    expect(await r.json()).toMatchObject({ status: "done" });
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(false);
  });
  it("fail 'internal' that the database requeues → the original is KEPT for the retry", async () => {
    const w = world({ failAnswer: "queued" }); putSource(w);
    const r = await handleConvertFinish(post({ source_id: SRC, claim_token: TOKEN, outcome: "fail", code: "internal", detail: "oom" }, "conv-jwt"), w.env, w.fetch);
    expect(await r.json()).toMatchObject({ status: "queued" });
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(true);
  });
  it("a final failure → deleted; the VM's detail is passed through only as detail (the member reads fixed text)", async () => {
    const w = world({ failAnswer: "failed" }); putSource(w);
    await handleConvertFinish(post({ source_id: SRC, claim_token: TOKEN, outcome: "fail", code: "damaged", detail: "moov atom not found" }, "conv-jwt"), w.env, w.fetch);
    expect(w.rpc.find((c) => c.fn === "video_source_fail")?.body).toMatchObject({ _code: "damaged", _detail: "moov atom not found" });
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(false);
  });
  it("a claim the database does not accept → 409 and NOTHING deleted (the VM cannot delete what it does not hold)", async () => {
    const w = world({ refuseClaim: true }); putSource(w);
    const r = await handleConvertFinish(post({ source_id: SRC, claim_token: TOKEN, outcome: "done" }, "conv-jwt"), w.env, w.fetch);
    expect(r.status).toBe(409);
    expect(w.bucket.map.has(sourceKey(SRC))).toBe(true);
  });
  it("refuses a free-text code or a bad outcome (400), before touching the database", async () => {
    const w = world(); putSource(w);
    expect((await handleConvertFinish(post({ source_id: SRC, claim_token: TOKEN, outcome: "fail", code: "Visit evil.example" }, "conv-jwt"), w.env, w.fetch)).status).toBe(400);
    expect((await handleConvertFinish(post({ source_id: SRC, claim_token: TOKEN, outcome: "delete" }, "conv-jwt"), w.env, w.fetch)).status).toBe(400);
    expect(w.rpc.length).toBe(0);
  });
});

describe("the converter path of /upload-urls and /complete", () => {
  let pkg: HlsPackage;
  beforeEach(async () => { pkg = await fakePackage({ seconds: 10 }); });

  it("reads the video through video_converter_version (never video_upload_info); URLs are upload/video/ only and live no longer than the lease", async () => {
    const w = world({ pkg, leaseUntil: new Date(NOW.getTime() + 10 * 60_000).toISOString() });
    const r = await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest, claim_token: TOKEN }, "conv-jwt"), w.env, NOW, w.fetch);
    expect(r.status).toBe(200);
    const b = await r.json() as { urls: Array<{ key: string; url: string }>; expires_in: number };
    expect(w.rpc.some((c) => c.fn === "video_converter_version")).toBe(true);
    expect(w.rpc.some((c) => c.fn === "video_upload_info")).toBe(false);
    expect(b.expires_in).toBe(10 * 60 - 30);
    for (const u of b.urls) {
      expect(u.key.startsWith(UPLOAD_PREFIX)).toBe(true);
      expect(u.key).toBe(uploadKey(OWNER, VID, 1, u.key.split("/").pop()!));
      expect(new URL(u.url).searchParams.get("X-Amz-Expires")).toBe(String(10 * 60 - 30));
    }
  });
  it("a wrong token (or anyone without the claim) → 404, no URL", async () => {
    const w = world({ pkg });
    const r = await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest, claim_token: "77777777-7777-4777-8777-777777777777" }, "conv-jwt"), w.env, NOW, w.fetch);
    expect(r.status).toBe(404);
  });
  it("a lease about to run out → 409 (heartbeat first), no URL", async () => {
    const w = world({ pkg, leaseUntil: new Date(NOW.getTime() + 60_000).toISOString() });
    const r = await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest, claim_token: TOKEN }, "conv-jwt"), w.env, NOW, w.fetch);
    expect(r.status).toBe(409);
  });
  it("complete on the converter path verifies, copies and marks the video as the converter", async () => {
    const w = world({ pkg });
    const up = await (await handleUploadUrls(post({ video_id: VID, version_no: 1, manifest: pkg.manifest, claim_token: TOKEN }, "conv-jwt"), w.env, NOW, w.fetch)).json() as { urls: Array<{ key: string; url: string }> };
    for (const u of up.urls) w.bucket.map.set(u.key, { data: pkg.files.get(u.key.split("/").pop()!)!.slice(), etag: "x" });
    let r = await handleComplete(post({ video_id: VID, version_no: 1, claim_token: TOKEN }, "conv-jwt"), w.env, w.fetch, () => NOW.getTime());
    for (let i = 0; i < 5 && r.status === 202; i++) r = await handleComplete(post({ video_id: VID, version_no: 1, claim_token: TOKEN }, "conv-jwt"), w.env, w.fetch, () => NOW.getTime());
    expect(r.status).toBe(200);
    expect(w.rpc.some((c) => c.fn === "video_mark_uploaded")).toBe(true);
    expect(w.rpc.some((c) => c.fn === "video_upload_info")).toBe(false);
  });
});

describe("ttlWithinLease", () => {
  it("never past the lease (minus 30 s), never above the cap, nothing for a lease about to lapse", () => {
    const now = NOW.getTime();
    expect(ttlWithinLease(now + 30 * 60_000, now, 3600)).toBe(1770);
    expect(ttlWithinLease(now + 3 * 3600_000, now, 3600)).toBe(3600);
    expect(() => ttlWithinLease(now + 80_000, now, 3600)).toThrow(/lease/);
  });
});
