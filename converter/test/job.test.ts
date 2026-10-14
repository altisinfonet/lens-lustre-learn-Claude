// @vitest-environment node
/**
 * One claimed job through the whole state machine, against a REAL local HTTP
 * server playing Supabase + Pages + R2, with a fake FFmpeg that writes real
 * fragmented MP4s: claim → source GET → probe → encode → package → judge →
 * begin_version → upload-urls → PUTs → complete rounds → finish.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import { canonicalManifest, type VideoManifest } from "../../src/lib/video/shared/rules";
import { prepareJobDir, runJob, setWorkerUmask, WORKER_UMASK, type JobDeps } from "../src/job";
import type { RunSpec } from "../src/launcher";
import { apiFor, FakeLauncher, fakeServer, iphoneProbeJson, noSleep, probeJson, send, sha256, SRC, tempDir, TOKEN, VIDEO, withAuth, OWNER, type FakeServer, type Recorded } from "./helpers";

const SOURCE = Buffer.alloc(50_000, 7);
const ETAG = "e7e7e7";
let server: FakeServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close(); server = null;
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

interface World {
  server: FakeServer;
  stored: Map<string, Buffer>;
  finish: unknown[];
  heartbeats: number;
  completeCalls: number;
  deps: JobDeps;
  launcher: FakeLauncher;
  logs: Array<{ event: string; fields?: Record<string, unknown> }>;
}

async function world(o: {
  probe?: string;
  fail?: (spec: RunSpec) => ReturnType<NonNullable<ConstructorParameters<typeof FakeLauncher>[0]>["fail"] & object>;
  onRun?: (spec: RunSpec) => void | Promise<void>;
  etag?: string;
  heartbeat?: (req: Recorded, res: ServerResponse) => void;
  beginVersion?: (req: Recorded, res: ServerResponse) => void;
  dropOnFirstPut?: string;
  completeRounds?: number;
  finish?: (req: Recorded, res: ServerResponse, n: number) => void;
  heartbeatMs?: number;
} = {}): Promise<World> {
  const s = await fakeServer();
  server = s;
  withAuth(s);
  const stored = new Map<string, Buffer>();
  const w = { server: s, stored, finish: [] as unknown[], heartbeats: 0, completeCalls: 0 } as World;
  s.on("POST", "/api/video/convert/claim", (_req, res) => send(res, 200, {
    job: { source_id: SRC, owner_id: OWNER, purpose: "post", source_bytes: SOURCE.length, source_etag: ETAG, claim_token: TOKEN, lease_until: new Date(Date.now() + 1_800_000).toISOString(), attempt: 1 },
    source: { url: `${s.url}/r2/source?X-Amz-Signature=sig`, headers: { "if-match": `"${ETAG}"` }, bytes: SOURCE.length, expires_in: 1770 },
  }));
  s.on("GET", "/r2/source", (_req, res) => { res.writeHead(200, { etag: `"${o.etag ?? ETAG}"`, "content-length": String(SOURCE.length) }); res.end(SOURCE); });
  s.on("POST", "/rest/v1/rpc/video_source_heartbeat", (req, res) => {
    w.heartbeats++;
    if (o.heartbeat) { o.heartbeat(req, res); return; }
    send(res, 200, new Date(Date.now() + 1_800_000).toISOString());
  });
  s.on("POST", "/rest/v1/rpc/video_converter_begin_version", (req, res) => {
    if (o.beginVersion) { o.beginVersion(req, res); return; }
    send(res, 200, { video_id: VIDEO, version_no: 1, state: "uploading", replayed: false });
  });
  let dropped = false;
  s.on("POST", "/api/video/upload-urls", (req, res) => {
    const m = (req.json as { manifest: VideoManifest }).manifest;
    const urls = m.files.filter((f) => !stored.has(f.name)).map((f) => ({
      name: f.name, key: `upload/video/x/${f.name}`, url: `${s.url}/r2/put/${f.name}?X-Amz-Signature=s-${f.name}`,
      headers: { "content-type": f.name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4", "x-amz-checksum-sha256": Buffer.from(f.sha256, "hex").toString("base64") },
    }));
    send(res, 200, { video_id: VIDEO, version_no: 1, expires_in: 1700, urls, done: m.files.filter((f) => stored.has(f.name)).map((f) => f.name) });
  });
  s.on("PUT", "/r2/put/*", (req, res) => {
    const name = req.path.slice("/r2/put/".length);
    if (name === o.dropOnFirstPut && !dropped) { dropped = true; res.writeHead(403); res.end(); return; }
    stored.set(name, req.body);
    res.writeHead(200); res.end();
  });
  let manifest: VideoManifest | null = null;
  s.on("POST", "/api/video/complete", (req, res) => {
    w.completeCalls++;
    if (!manifest) {
      const uu = s.requests.filter((r) => r.path === "/api/video/upload-urls").at(-1)!;
      manifest = (uu.json as { manifest: VideoManifest }).manifest;
    }
    const missing = manifest.files.filter((f) => !stored.has(f.name) || sha256(stored.get(f.name)!) !== f.sha256).map((f) => f.name);
    if (missing.length) { send(res, 409, { error: "VID-CMP-003", message: "not uploaded yet", missing }); return; }
    const rounds = o.completeRounds ?? 2;
    if (w.completeCalls <= rounds) { send(res, 202, { state: "uploading", copied: Math.floor((manifest.files.length * w.completeCalls) / (rounds + 1)), total: manifest.files.length }); return; }
    send(res, 200, { video_id: VIDEO, version_no: 1, state: "checking" });
  });
  let finishN = 0;
  s.on("POST", "/api/video/convert/finish", (req, res) => {
    finishN++;
    w.finish.push(req.json);
    if (o.finish) { o.finish(req, res, finishN); return; }
    const b = req.json as { outcome: string; code?: string };
    send(res, 200, { source_id: SRC, status: b.outcome === "done" ? "done" : b.code === "internal" ? "queued" : "failed" });
  });

  const root = await tempDir();
  dirs.push(root);
  const { api } = apiFor(s);
  w.launcher = new FakeLauncher({ probe: o.probe ?? probeJson({ width: 1280, height: 720, duration: 10 }), fail: o.fail as never, onRun: o.onRun });
  w.logs = [];
  w.deps = {
    api, launcher: w.launcher, jobsRoot: root, preset: "veryfast", heartbeatMs: o.heartbeatMs ?? 60_000,
    sleep: noSleep, log: (event, fields) => w.logs.push({ event, fields }), allowUrl: () => true,
  };
  return w;
}

async function claimAndRun(w: World) {
  const claim = await w.deps.api.claim();
  expect(claim).not.toBeNull();
  return runJob(claim!, w.deps);
}

describe("converter · the worker's own umask", () => {
  it.skipIf(process.platform === "win32")("job directories are 0770 whatever mask the worker was started under (update-ffmpeg.sh and a manual --selftest run it outside the unit)", async () => {
    const root = await tempDir();
    const before = process.umask(0o022); // root's usual mask: what update-ffmpeg.sh's `runuser` hands the worker
    try {
      const without = path.join(root, "without");
      await prepareJobDir(without);
      expect((await fs.stat(without)).mode & 0o777).toBe(0o750); // the fault: group convjob (ffjob) cannot write
      setWorkerUmask();
      expect(process.umask()).toBe(WORKER_UMASK);
      const dir = path.join(root, "with");
      await prepareJobDir(dir);
      expect((await fs.stat(dir)).mode & 0o777).toBe(0o770);
      await fs.mkdir(path.join(dir, ".run"), { mode: 0o770 });    // as SystemdLauncher.run does
      expect((await fs.stat(path.join(dir, ".run"))).mode & 0o777).toBe(0o770);
      await fs.writeFile(path.join(dir, "source"), "x");           // a download: no access for others
      expect((await fs.stat(path.join(dir, "source"))).mode & 0o007).toBe(0);
    } finally {
      process.umask(before);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("the mask is 0007: user and group everything, others nothing", () => {
    expect(WORKER_UMASK).toBe(0o007);
  });
});

// Each test runs whole jobs (encode stand-in, packager, fake HTTP servers): slow on a busy machine.
describe("converter · one job, start to end", { timeout: 20_000 }, () => {
  it("happy path: every file PUT with its signed headers, complete in rounds, finish done, nothing left behind", async () => {
    const w = await world();
    const out = await claimAndRun(w);
    expect(out).toEqual({ result: "done", videoId: VIDEO, state: "checking" });

    const paths = w.server.requests.map((r) => `${r.method} ${r.path.replace(/^\/r2\/put\/.*/, "/r2/put/*")}`);
    const firstIndex = (p: string) => paths.indexOf(p);
    expect(firstIndex("GET /r2/source")).toBeLessThan(firstIndex("POST /rest/v1/rpc/video_converter_begin_version"));
    expect(firstIndex("POST /rest/v1/rpc/video_converter_begin_version")).toBeLessThan(firstIndex("POST /api/video/upload-urls"));
    expect(firstIndex("POST /api/video/upload-urls")).toBeLessThan(firstIndex("PUT /r2/put/*"));
    expect(paths.lastIndexOf("PUT /r2/put/*")).toBeLessThan(firstIndex("POST /api/video/complete"));
    expect(paths.filter((p) => p === "POST /api/video/complete")).toHaveLength(3); // 202, 202, 200
    expect(paths.at(-1)).toBe("POST /api/video/convert/finish");

    // the source GET carried the signed If-Match exactly
    expect(w.server.requests.find((r) => r.path === "/r2/source")!.headers["if-match"]).toBe(`"${ETAG}"`);
    // the converter's JWT on every call; the anon key on PostgREST
    for (const r of w.server.requests.filter((x) => x.path.startsWith("/api/") || x.path.startsWith("/rest/"))) expect(r.headers.authorization).toMatch(/^Bearer access-/);
    expect(w.server.requests.find((r) => r.path.startsWith("/rest/"))!.headers.apikey).toBe("anon-test");

    // begin_version declared exactly the package that was uploaded
    const bv = w.server.requests.find((r) => r.path === "/rest/v1/rpc/video_converter_begin_version")!.json as Record<string, unknown>;
    const uu = w.server.requests.find((r) => r.path === "/api/video/upload-urls")!.json as { manifest: VideoManifest; claim_token: string; video_id: string; version_no: number };
    expect(uu).toMatchObject({ claim_token: TOKEN, video_id: VIDEO, version_no: 1 });
    expect(bv._manifest_sha256).toBe(createHash("sha256").update(canonicalManifest(uu.manifest)).digest("hex"));
    expect(bv).toMatchObject({ _source_id: SRC, _claim_token: TOKEN, _declared_duration_s: 10, _has_audio: true });
    expect(bv._total_bytes).toBe(uu.manifest.files.reduce((a, f) => a + f.bytes, 0));
    expect(Object.keys(bv._rendition_bytes as object).sort()).toEqual(["240p", "480p", "720p", "audio", "other"]);
    // every file arrived, byte-exact, with the headers upload-urls signed
    expect(w.stored.size).toBe(uu.manifest.files.length);
    for (const f of uu.manifest.files) expect(sha256(w.stored.get(f.name)!)).toBe(f.sha256);
    const put = w.server.requests.find((r) => r.path === "/r2/put/master.m3u8")!;
    expect(put.headers["content-type"]).toBe("application/vnd.apple.mpegurl");
    expect(put.headers["x-amz-checksum-sha256"]).toBe(Buffer.from(uu.manifest.files.find((f) => f.name === "master.m3u8")!.sha256, "hex").toString("base64"));
    for (const r of w.server.requests.filter((x) => x.path === "/api/video/complete")) expect(r.json).toEqual({ video_id: VIDEO, version_no: 1, claim_token: TOKEN });
    expect(w.finish).toEqual([{ source_id: SRC, claim_token: TOKEN, outcome: "done" }]);

    // FFmpeg ran with the plan's renditions; the job directory is gone
    expect(w.launcher.calls.map((c) => c.tool)).toEqual(["ffprobe", "ffmpeg", "ffmpeg", "ffmpeg"]);
    await expect(fs.stat(path.join(w.deps.jobsRoot, SRC))).rejects.toThrow();
    // no presigned URL, token or password in any log line
    const logText = JSON.stringify(w.logs);
    expect(logText).not.toMatch(/X-Amz-Signature|access-\d|not-a-real-password|66666666-6666/);
  });

  it("a probe refusal ends the job with its fixed code — nothing declared, nothing uploaded", async () => {
    const w = await world({ probe: probeJson({ width: 5120, height: 2880 }) });
    const out = await claimAndRun(w);
    expect(out).toMatchObject({ result: "failed", code: "too_big", status: "failed" });
    expect(w.finish).toEqual([{ source_id: SRC, claim_token: TOKEN, outcome: "fail", code: "too_big", detail: "5120x2880 is above 4096 on a side" }]);
    expect(w.server.requests.some((r) => r.path.includes("begin_version") || r.path.includes("upload-urls"))).toBe(false);
    await expect(fs.stat(path.join(w.deps.jobsRoot, SRC))).rejects.toThrow();
  });

  it("an iPhone .mov (A1: cover picture first, HLG, spatial audio, metadata tracks) goes all the way: index maps, tone mapping, done", async () => {
    const w = await world({ probe: iphoneProbeJson() });
    expect(await claimAndRun(w)).toMatchObject({ result: "done" });
    const runs = w.launcher.calls.filter((c) => c.tool === "ffmpeg").map((c) => c.args);
    const video = runs.find((a) => a.includes("-filter_complex"))!;
    expect(video[video.indexOf("-filter_complex") + 1]).toMatch(/^\[0:1\]fps=/);
    expect(video[video.indexOf("-filter_complex") + 1]).toContain("tonemap=tonemap=hable:desat=0");
    expect(video.join(" ")).toContain("-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv");
    const audio = runs.find((a) => a.includes("aac"))!;
    expect(audio[audio.indexOf("-map") + 1]).toBe("0:3");
    const bv = w.server.requests.find((r) => r.path === "/rest/v1/rpc/video_converter_begin_version")!.json as Record<string, unknown>;
    expect(bv).toMatchObject({ _has_audio: true, _declared_duration_s: 12.35 });
    const uu = w.server.requests.find((r) => r.path === "/api/video/upload-urls")!.json as { manifest: { width: number; height: number } };
    expect(uu.manifest).toMatchObject({ width: 1080, height: 1920 }); // the display size (rotated)
  });

  it("FFmpeg cannot decode → damaged; FFmpeg reaches its own time cap → too_long, FINAL (review of #420, M2); killed from outside → internal", async () => {
    let w = await world({ fail: (spec) => (spec.tool === "ffmpeg" ? { exitCode: 1, stdout: "", stderr: "source: Invalid data found when processing input", timedOut: false, killed: false } : null) });
    expect(await claimAndRun(w)).toMatchObject({ result: "failed", code: "damaged" });
    await server!.close();
    w = await world({ fail: (spec) => (spec.tool === "ffmpeg" ? { exitCode: null, stdout: "", stderr: "", timedOut: true, killed: false } : null) });
    expect(await claimAndRun(w)).toMatchObject({ result: "failed", code: "too_long", status: "failed" });
    expect((w.finish.at(-1) as { code: string; detail: string })).toMatchObject({ outcome: "fail", code: "too_long" });
    await server!.close();
    w = await world({ fail: (spec) => (spec.tool === "ffmpeg" ? { exitCode: null, stdout: "", stderr: "", timedOut: false, killed: true } : null) });
    expect(await claimAndRun(w)).toMatchObject({ result: "failed", code: "internal", status: "queued" });
  });

  it("the original's ETag differs → source_missing, before any FFmpeg run", async () => {
    const w = await world({ etag: "changed" });
    expect(await claimAndRun(w)).toMatchObject({ result: "failed", code: "source_missing" });
    expect(w.launcher.calls).toHaveLength(0);
  });

  it("complete says files are missing (a PUT refused) → another round of upload-urls for just those", async () => {
    const w = await world({ dropOnFirstPut: "240p_1.m4s", completeRounds: 0 });
    expect(await claimAndRun(w)).toMatchObject({ result: "done" });
    const rounds = w.server.requests.filter((r) => r.path === "/api/video/upload-urls");
    expect(rounds).toHaveLength(2);
    const second = w.server.requests.filter((r) => r.path.startsWith("/r2/put/")).slice(-1)[0];
    expect(second.path).toBe("/r2/put/240p_1.m4s");
  });

  it("the heartbeat is refused (claim gone) during the encode → the job stops, finish is not attempted", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const w = await world({
      heartbeatMs: 30,
      heartbeat: (_req, res) => { send(res, 403, { code: "42501", message: "VID-CONV-002: this claim is not held (wrong token, expired lease, or not converting)" }); setTimeout(release, 10); },
      onRun: async (spec) => { if (spec.tool === "ffmpeg") await hold; },
    });
    const out = await claimAndRun(w);
    expect(out.result).toBe("lost");
    expect(w.finish).toEqual([]);
    expect(w.server.requests.some((r) => r.path.includes("begin_version"))).toBe(false);
  });

  it("begin_version refuses on size (VID-LIM-002) → too_big; a lost claim there → lost", async () => {
    let w = await world({ beginVersion: (_req, res) => send(res, 400, { code: "23514", message: "VID-LIM-002: a video is at most 500 MB (declared 600000000 bytes)" }) });
    expect(await claimAndRun(w)).toMatchObject({ result: "failed", code: "too_big" });
    await server!.close();
    w = await world({ beginVersion: (_req, res) => send(res, 403, { code: "42501", message: "VID-CONV-002: this claim is not held" }) });
    expect(await claimAndRun(w)).toMatchObject({ result: "lost" });
  });

  it("finish is retried through a server error; a finish that never gets through leaves the job 'unfinished'", async () => {
    let w = await world({ finish: (_req, res, n) => (n === 1 ? send(res, 502, { error: "VID-DB-001" }) : send(res, 200, { source_id: SRC, status: "done" })) });
    expect(await claimAndRun(w)).toMatchObject({ result: "done" });
    expect(w.finish).toHaveLength(2);
    await server!.close();
    w = await world({ finish: (_req, res) => send(res, 503, { error: "down" }) });
    expect(await claimAndRun(w)).toMatchObject({ result: "unfinished" });
  });

  it("a PUT URL outside the lane's R2 pin is never used: internal, no PUT made, and the job is marked fatal (N4: the worker stops claiming)", async () => {
    const w = await world();
    w.deps.allowUrl = (u) => u.includes("/r2/source"); // the source GET is allowed; every PUT URL is "foreign"
    const out = await claimAndRun(w);
    expect(out).toMatchObject({ result: "failed", code: "internal", fatal: "storage_url_refused" });
    expect((out as { detail: string }).detail).toContain("not this lane's R2 storage URL");
    expect(w.server.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("an ordinary internal failure is not fatal (the worker keeps claiming, with its back-off)", async () => {
    const w = await world();
    w.server.on("POST", "/api/video/upload-urls", (_req, res) => send(res, 409, { error: "VID-MAN-002", message: "no" }));
    const out = await claimAndRun(w);
    expect(out).toMatchObject({ result: "failed", code: "internal" });
    expect((out as { fatal?: string }).fatal).toBeUndefined();
  });

  it("an upload-urls refusal that is not about the lease is internal, with the server's code in the detail", async () => {
    const w = await world();
    w.server.on("POST", "/api/video/upload-urls", (_req, res) => send(res, 409, { error: "VID-MAN-002", message: "this manifest is not the one declared for this version" }));
    const out = await claimAndRun(w);
    expect(out).toMatchObject({ result: "failed", code: "internal" });
    expect((out as { detail: string }).detail).toContain("VID-MAN-002");
  });
});
