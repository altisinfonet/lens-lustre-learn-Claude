/**
 * VID-1 · the web encoder in a REAL browser (development only; served by the
 * Vite dev server at /videoharness.html, never part of a build).
 *
 * Encodes a real video file with the production encoder module and hands the
 * resulting HLS file set back to tools/uishot/video-encode-harness.mjs, which
 * judges it with the SAME rules /api/video/complete applies, and with ffprobe.
 *
 * Codecs: the CI Chromium (Playwright's build) has no H.264/AAC encoder, so the
 * harness passes VP9 + Opus through the encoder's test seam. Everything else —
 * frame capture, scaling, keyframe cadence, muxing, segmenting, playlists,
 * manifest — is the production path. H.264/AAC on a member's browser is the
 * same code with the default CodecChoice.
 */
import { encodeVideoToHls, type CodecChoice } from "@/lib/video/webEncoder";
import { judgeUploadContent, smallFiles } from "@/lib/video/shared/judge";
import { manifestProblems, renditionBytes, sha256Hex, totalBytes, RENDITION_CEILING_BPS } from "@/lib/video/shared/rules";
import landscape from "../fixtures/video/landscape-1280x720.webm?url";
import portrait from "../fixtures/video/portrait-360x640.webm?url";

if (!import.meta.env.DEV) throw new Error("video harness is development-only");

const VP9_OPUS: CodecChoice = {
  video: { mux: "vp9", codec: () => "vp09.00.10.08" },
  audio: { mux: "opus", codec: "opus", playlist: "opus" },
};

function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function run(which: string, mute: boolean) {
  const src = which === "portrait" ? portrait : landscape;
  const blob = await (await fetch(src)).blob();
  const file = new File([blob], `${which}.webm`, { type: "video/webm" });
  const t0 = performance.now();
  const pkg = await encodeVideoToHls(file, { codecs: VP9_OPUS, mute });
  // The SAME judgement /api/video/complete makes, plus every file's hash.
  const hashOk = (await Promise.all(pkg.manifest.files.map(async (f) => (await sha256Hex(pkg.files.get(f.name)!)) === f.sha256))).every(Boolean);
  const rb = renditionBytes(pkg.manifest) as Record<string, number>;
  const ceilings = Object.entries(RENDITION_CEILING_BPS).filter(([k]) => rb[k] !== undefined)
    .map(([k, c]) => ({ rendition: k, bytesPerSecond: Math.round(rb[k] / pkg.manifest.duration_s), ceiling: c }));
  return {
    problems: [...manifestProblems(pkg.manifest, "post"), ...judgeUploadContent(pkg.manifest, smallFiles(pkg.files))],
    hashOk,
    totalBytes: totalBytes(pkg.manifest),
    ceilings,
    ms: Math.round(performance.now() - t0),
    manifest: pkg.manifest,
    manifestSha256: pkg.manifestSha256,
    files: Object.fromEntries([...pkg.files].map(([n, b]) => [n, b64(b)])),
  };
}

(window as unknown as { __vidEncode: typeof run }).__vidEncode = run;
document.getElementById("root")!.textContent = "encoder harness ready";
