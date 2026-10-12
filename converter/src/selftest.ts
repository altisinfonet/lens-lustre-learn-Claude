/**
 * The self-test: make a short synthetic video INSIDE the sandbox (FFmpeg's
 * lavfi test source — the only run that does not read a member's file), then
 * convert it with exactly the code a member's video goes through
 * (convert.ts: probe → plan → encode → package → the server's judge).
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
import { classifyToolFailure, toFailure } from "./failures";
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

export async function selfTest(o: { launcher: Launcher; jobsRoot: string; preset: X264Preset; log?: (e: string, f?: Record<string, unknown>) => void; now?: () => number }): Promise<SelfTestResult> {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => undefined);
  const t0 = now();
  const dir = path.join(o.jobsRoot, randomUUID());
  try {
    await prepareJobDir(dir);
    const g = await o.launcher.run({ tool: "ffmpeg", args: synthArgs(), jobDir: dir, timeoutS: 120 });
    if (g.exitCode !== 0) throw classifyToolFailure("ffmpeg", g);
    const { pkg } = await convertSource({ launcher: o.launcher, jobDir: dir, purpose: "post", preset: o.preset, log, now });
    const seg = mediaPlaylistSegments(pkg.files);
    return {
      ok: true, ms: now() - t0,
      renditions: [...pkg.files.keys()].filter((n) => /^(240|480|720)p\.m3u8$/.test(n)).map((n) => n.replace(".m3u8", "")).sort(),
      has_audio: pkg.manifest.has_audio, files: pkg.manifest.files.length,
      max_segment_s: Math.max(...seg.map((s) => s.seconds)),
    };
  } catch (e) {
    const f = toFailure(e);
    return { ok: false, ms: now() - t0, code: f.code, detail: f.detail };
  } finally {
    await wipeJobDir(dir, log);
  }
}
