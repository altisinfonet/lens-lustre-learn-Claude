/**
 * Test doubles for the converter: a REAL local HTTP server playing Supabase
 * auth + PostgREST + the Pages endpoints + R2's presigned GET/PUT, and a fake
 * FFmpeg launcher that writes real fragmented MP4s (mp4-muxer, as the VID
 * fixtures do) where FFmpeg would.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fakeFragmentedAudio, fakeFragmentedVideo, JPEG } from "../../src/lib/video/__tests__/fixtures";
import { Api } from "../src/api";
import { Session } from "../src/auth";
import type { Launcher, RunResult, RunSpec } from "../src/launcher";

export const SRC = "55555555-5555-4555-8555-555555555555";
export const TOKEN = "66666666-6666-4666-8666-666666666666";
export const VIDEO = "77777777-7777-4777-8777-777777777777";
export const OWNER = "11111111-1111-4111-8111-111111111111";

export interface Recorded { method: string; path: string; headers: IncomingMessage["headers"]; body: Buffer; json: unknown }

export type Handler = (req: Recorded, res: ServerResponse) => void | Promise<void>;

export interface FakeServer {
  url: string;
  requests: Recorded[];
  on(method: string, path: string, h: Handler): void;
  close(): Promise<void>;
}

export async function fakeServer(): Promise<FakeServer> {
  const routes = new Map<string, Handler>();
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const p = new URL(req.url ?? "/", "http://x").pathname;
      let json: unknown = null;
      try { json = body.length ? JSON.parse(body.toString("utf8")) : null; } catch { json = null; }
      const rec: Recorded = { method: req.method ?? "GET", path: p, headers: req.headers, body, json };
      requests.push(rec);
      const h = routes.get(`${rec.method} ${p}`) ?? [...routes.entries()].find(([k]) => k.endsWith("*") && `${rec.method} ${p}`.startsWith(k.slice(0, -1)))?.[1];
      if (!h) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ message: `no route ${rec.method} ${p}` })); return; }
      try { await h(rec, res); } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    on: (method, p, h) => { routes.set(`${method} ${p}`, h); },
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export const sha256 = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

export async function tempDir(prefix = "conv-"): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), prefix));
}

export function apiFor(server: FakeServer): { api: Api; session: Session } {
  const session = new Session({
    supabaseUrl: server.url, anonKey: "anon-test", credentials: async () => ({ email: "converter@example.test", password: "not-a-real-password" }),
  });
  return { session, api: new Api({ apiBase: server.url, supabaseUrl: server.url, anonKey: "anon-test", session }) };
}

/** Supabase password + refresh grants: every sign-in gets a fresh access token. */
export function withAuth(server: FakeServer, counters = { password: 0, refresh: 0 }) {
  server.on("POST", "/auth/v1/token", (req, res) => {
    const isRefresh = (req.json as { refresh_token?: string })?.refresh_token !== undefined;
    if (isRefresh) counters.refresh++; else counters.password++;
    send(res, 200, { access_token: `access-${counters.password}-${counters.refresh}`, refresh_token: `refresh-${counters.refresh + 1}`, expires_in: 3600 });
  });
  return counters;
}

/**
 * ffprobe JSON for a file like a phone's: one H.264 video, one AAC audio, then
 * any `extra` streams (indexed in order unless they say otherwise). `colour`
 * adds the video's colour tags (e.g. a PQ / HLG source).
 */
export function probeJson(o: {
  width?: number; height?: number; duration?: number; fps?: string; audio?: boolean; extra?: Array<Record<string, unknown>>;
  rotation?: number; format?: string; colour?: { transfer?: string; primaries?: string; matrix?: string; range?: string; pixFmt?: string };
} = {}): string {
  const streams: Array<Record<string, unknown>> = [{
    index: 0, codec_type: "video", codec_name: "h264", width: o.width ?? 1280, height: o.height ?? 720,
    avg_frame_rate: o.fps ?? "30/1", r_frame_rate: o.fps ?? "30/1", sample_aspect_ratio: "1:1", disposition: { attached_pic: 0, default: 1 },
    pix_fmt: o.colour?.pixFmt ?? "yuv420p",
    ...(o.colour?.transfer ? { color_transfer: o.colour.transfer } : {}),
    ...(o.colour?.primaries ? { color_primaries: o.colour.primaries } : {}),
    ...(o.colour?.matrix ? { color_space: o.colour.matrix } : {}),
    ...(o.colour?.range ? { color_range: o.colour.range } : {}),
    ...(o.rotation !== undefined ? { side_data_list: [{ side_data_type: "Display Matrix", rotation: o.rotation }] } : {}),
  }];
  if (o.audio !== false) streams.push({ index: 1, codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000", disposition: { attached_pic: 0, default: 1 } });
  for (const x of o.extra ?? []) streams.push({ index: streams.length, ...x });
  return JSON.stringify({ format: { format_name: o.format ?? "mov,mp4,m4a,3gp,3g2,mj2", duration: String(o.duration ?? 10), nb_streams: streams.length }, streams });
}

/** An iPhone-like .mov as ffprobe lists it: HEVC HDR video, stereo AAC (default), spatial audio FFmpeg does not know, mebx metadata ×4, a cover picture first. */
export function iphoneProbeJson(): string {
  const streams = [
    { index: 0, codec_type: "video", codec_name: "mjpeg", width: 320, height: 240, avg_frame_rate: "0/0", r_frame_rate: "90000/1", disposition: { attached_pic: 1, default: 0 } },
    { index: 1, codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, avg_frame_rate: "30/1", r_frame_rate: "30/1", sample_aspect_ratio: "1:1",
      pix_fmt: "yuv420p10le", color_range: "tv", color_space: "bt2020nc", color_transfer: "arib-std-b67", color_primaries: "bt2020",
      disposition: { attached_pic: 0, default: 1 }, side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] },
    { index: 2, codec_type: "audio", codec_name: "unknown", channels: 4, disposition: { attached_pic: 0, default: 1 } },
    { index: 3, codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "44100", disposition: { attached_pic: 0, default: 1 } },
    { index: 4, codec_type: "data", codec_name: "none", disposition: { attached_pic: 0, default: 1 }, tags: { handler_name: "Core Media Metadata" } },
    { index: 5, codec_type: "data", codec_name: "none", disposition: { attached_pic: 0, default: 1 } },
    { index: 6, codec_type: "data", codec_name: "none", disposition: { attached_pic: 0, default: 1 } },
    { index: 7, codec_type: "data", codec_name: "none", disposition: { attached_pic: 0, default: 1 } },
  ];
  return JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.345", nb_streams: streams.length }, streams });
}

/**
 * Plays ffprobe and ffmpeg: ffprobe answers `probe`; ffmpeg writes, for every
 * output file named in its arguments, what FFmpeg would have written there.
 */
export class FakeLauncher implements Launcher {
  calls: RunSpec[] = [];
  constructor(public o: {
    probe?: string;
    fail?: (spec: RunSpec) => RunResult | null;
    onRun?: (spec: RunSpec) => void | Promise<void>;
  } = {}) {}

  async run(spec: RunSpec): Promise<RunResult> {
    this.calls.push(spec);
    await this.o.onRun?.(spec);
    if (spec.signal?.aborted) return { exitCode: null, stdout: "", stderr: "aborted", timedOut: false, killed: true };
    const failed = this.o.fail?.(spec);
    if (failed) return failed;
    if (spec.tool === "ffprobe") return { exitCode: 0, stdout: this.o.probe ?? probeJson(), stderr: "", timedOut: false, killed: false };
    const args = spec.args;
    const seconds = Number(args[args.indexOf("-t") + 1]) || 10;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-f" && args[i + 1] === "mp4") {
        const file = args[i + 2];
        const dims = /^(240|480|720)p\.mp4$/.exec(file);
        let bytes: Uint8Array;
        if (dims) {
          // This output's label ("[o1]") is the -map before it; its size is in the filter graph's scale for that label.
          const label = args[args.lastIndexOf("-map", i) + 1].replace(/[[\]]/g, "\\$&");
          const graph = args[args.indexOf("-filter_complex") + 1];
          const m = new RegExp(`scale=w=(\\d+):h=(\\d+)[^;]*${label}`).exec(graph);
          const width = m ? Number(m[1]) : 426, height = m ? Number(m[2]) : 240;
          bytes = fakeFragmentedVideo({ seconds, width, height, bytesPerFrame: dims[1] === "240" ? 800 : 2000 });
        } else if (file === "audio.mp4") {
          bytes = fakeFragmentedAudio({ seconds });
        } else {
          bytes = fakeFragmentedVideo({ seconds, width: 426, height: 240 }); // the self-test's synthetic source
        }
        await fs.writeFile(path.join(spec.jobDir, file), bytes);
      }
      if (args[i] === "image2") await fs.writeFile(path.join(spec.jobDir, args[args.length - 1]), JPEG);
    }
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, killed: false };
  }
}

export const noSleep = async () => undefined;
export const quietLog = () => undefined;
