/**
 * The self-test: make short synthetic videos INSIDE the sandbox (FFmpeg's
 * lavfi test source — the only runs that do not read a member's file), then
 * convert them with exactly the code a member's video goes through
 * (convert.ts: probe → plan → encode → package → the server's judge):
 *   1. SDR 1280x720 with sound → 240p/480p/720p + audio;
 *   2. an HDR-tagged source (PQ / BT.2020, amendment A1) → the tone-mapping
 *      chain must run on this machine's FFmpeg (zscale + tonemap) and the
 *      result must still pass the judge.
 *
 * The worker runs it at every start, before it claims anything: a VM whose
 * FFmpeg, sandbox or polkit grant is broken must not take members' jobs and
 * fail them three times each. `node worker.mjs --selftest` runs it alone
 * (deploy/README.md) and prints one JSON line.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mediaPlaylistSegments } from "./playlistFacts";
import { convertSource } from "./convert";
import type { X264Preset } from "./encode";
import { classifyToolFailure, JobFailure, toFailure } from "./failures";
import { prepareJobDir, wipeJobDir } from "./job";
import type { Launcher } from "./launcher";

export interface SelfTestResult {
  ok: boolean;
  ms: number;
  code?: string;
  detail?: string;
  renditions?: string[];
  has_audio?: boolean;
  files?: number;
  max_segment_s?: number;
  /** the HDR case: tone-mapped and accepted */
  hdr_tone_mapped?: boolean;
}

export function synthArgs(seconds = 6): string[] {
  return [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    "-f", "mp4", "source",
  ];
}

/** A small source TAGGED as HDR (PQ, BT.2020): enough to drive the tone-mapping path end to end, cheaply. */
export function synthHdrArgs(seconds = 2): string[] {
  return [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=25:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc", "-color_range", "tv",
    "-f", "mp4", "source",
  ];
}

async function oneCase(o: SelfTestOptions, synth: string[], now: () => number, log: NonNullable<SelfTestOptions["log"]>) {
  const dir = path.join(o.jobsRoot, randomUUID());
  try {
    await prepareJobDir(dir);
    const g = await o.launcher.run({ tool: "ffmpeg", args: synth, jobDir: dir, timeoutS: 120 });
    if (g.exitCode !== 0) throw classifyToolFailure("ffmpeg", g);
    return await convertSource({ launcher: o.launcher, jobDir: dir, purpose: "post", preset: o.preset, log, now });
  } finally {
    await wipeJobDir(dir, log);
  }
}

interface SelfTestOptions { launcher: Launcher; jobsRoot: string; preset: X264Preset; log?: (e: string, f?: Record<string, unknown>) => void; now?: () => number }

export async function selfTest(o: SelfTestOptions): Promise<SelfTestResult> {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => undefined);
  const t0 = now();
  try {
    const { pkg } = await oneCase(o, synthArgs(), now, log);
    const seg = mediaPlaylistSegments(pkg.files);
    const hdr = await oneCase(o, synthHdrArgs(), now, log);
    if (!hdr.facts.hdr || hdr.plan.toneMap === null) throw new JobFailure("internal", "the HDR self-test source was not recognised as HDR");
    return {
      ok: true, ms: now() - t0,
      renditions: [...pkg.files.keys()].filter((n) => /^(240|480|720)p\.m3u8$/.test(n)).map((n) => n.replace(".m3u8", "")).sort(),
      has_audio: pkg.manifest.has_audio, files: pkg.manifest.files.length,
      max_segment_s: Math.max(...seg.map((s) => s.seconds), ...mediaPlaylistSegments(hdr.pkg.files).map((s) => s.seconds)),
      hdr_tone_mapped: true,
    };
  } catch (e) {
    const f = toFailure(e);
    return { ok: false, ms: now() - t0, code: f.code, detail: f.detail };
  }
}
