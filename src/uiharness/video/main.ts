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
// A slideshow-style video: one picture held for 12 s at a time (no new frame for 12 s while it plays).
import held from "../fixtures/video/held-frames-640x360.webm?url";
// A slideshow with 1.5 s cross-fades between 4 s held pictures (review #418 F1).
import crossfade from "../fixtures/video/crossfade-slides-1280x720.webm?url";

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

/**
 * S7-e · phone-shaped files, made by ffmpeg in the harness script and served at
 * /__fixture/<name> (Playwright routing; no binary in the repo). The File
 * carries the name and type the phone's picker hands the app.
 */
const GENERATED: Record<string, { name: string; type: string }> = {
  // iPhone "HDR video": 10-bit BT.2020 HLG, recorded landscape with a 90° display
  // rotation, picked as IMG_….MOV (video/quicktime). CI's Chromium cannot decode
  // HEVC, so the stream is VP9 profile 2 — same depth, colour and rotation.
  "iphone-hdr": { name: "IMG_0001.MOV", type: "video/quicktime" },
  // Android camera: H.264 + AAC, 90° rotation, variable frame rate, moov at the end.
  android: { name: "VID_20261029_120000.mp4", type: "video/mp4" },
  // The member limit: exactly 3 minutes.
  "three-min": { name: "three-min.mp4", type: "video/mp4" },
};

async function run(which: string, mute: boolean) {
  const gen = GENERATED[which];
  const src = gen ? `/__fixture/${which}` : which === "portrait" ? portrait : which === "held" ? held : which === "crossfade" ? crossfade : landscape;
  const blob = await (await fetch(src)).blob();
  const file = gen ? new File([blob], gen.name, { type: gen.type }) : new File([blob], `${which}.webm`, { type: "video/webm" });
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
