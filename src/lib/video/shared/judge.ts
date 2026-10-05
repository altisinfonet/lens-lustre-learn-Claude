/**
 * VID-1 §3.4 · the CONTENT rules /api/video/complete applies once every file
 * is present and matches the manifest. Pure, no imports beyond the shared
 * readers, so the Function and the encoder harness judge with ONE function.
 *
 *   SEC condition 2  poster.jpg starts FF D8 FF
 *   SEC condition 3  playlists: relative URIs in the manifest only; no key /
 *                    session / define tags; TARGETDURATION ≤ 6; EXTINF sums
 *                    within ±2 s of the declared duration
 *   SEC F-D3-17      every video init: exactly one `vide`, no `soun`; the audio
 *                    init exactly one `soun`; none when has_audio = false; the
 *                    master's CODECS name an audio codec exactly when there is audio
 *
 * `small` = the playlists, the init segments and the poster, by name.
 */
import { isJpeg, trackHandlers } from "./mp4";
import { judgePlaylist, masterCodecs } from "./playlist";
import type { VideoManifest } from "./rules";

const dec = new TextDecoder();

export function judgeUploadContent(manifest: VideoManifest, small: ReadonlyMap<string, Uint8Array>): string[] {
  const problems: string[] = [];
  const names = new Set(manifest.files.map((f) => f.name));

  const poster = small.get("poster.jpg");
  if (!poster || !isJpeg(poster)) problems.push("poster.jpg is not a JPEG");

  for (const [name, bytes] of small) {
    if (!name.endsWith(".m3u8")) continue;
    problems.push(...judgePlaylist(name, dec.decode(bytes), names, manifest.duration_s).problems);
  }

  const variants = [...names].filter((n) => /^(240|480|720)p\.m3u8$/.test(n));
  for (const v of variants) {
    const r = v.replace(".m3u8", "");
    const init = small.get(`${r}.mp4`);
    if (!init) { problems.push(`${r}.mp4 is missing`); continue; }
    try {
      const h = trackHandlers(init);
      if (h.filter((x) => x === "vide").length !== 1 || h.includes("soun")) {
        problems.push(`${r} must hold exactly one video track and no audio (has ${h.join(",") || "none"})`);
      }
    } catch (e) {
      problems.push(`${r}.mp4 is not a readable MP4 (${(e as Error).message})`);
    }
  }
  const audioInit = small.get("audio.mp4");
  if (manifest.has_audio) {
    if (!audioInit) problems.push("audio.mp4 is missing");
    else {
      try {
        const h = trackHandlers(audioInit);
        if (h.length !== 1 || h[0] !== "soun") problems.push(`the audio rendition must hold exactly one audio track (has ${h.join(",") || "none"})`);
      } catch (e) {
        problems.push(`audio.mp4 is not a readable MP4 (${(e as Error).message})`);
      }
    }
  } else if ([...names].some((n) => n.startsWith("audio"))) {
    problems.push("has_audio is false but audio files were uploaded");
  }
  const master = small.get("master.m3u8");
  if (master) {
    const codecs = masterCodecs(dec.decode(master));
    for (const v of variants) {
      const c = codecs.get(v);
      if (c === undefined) { problems.push(`master.m3u8 does not list ${v}`); continue; }
      const hasAudioCodec = /mp4a|opus/.test(c);
      if (hasAudioCodec !== manifest.has_audio) problems.push(`master.m3u8 CODECS for ${v} ${hasAudioCodec ? "names" : "lacks"} an audio codec`);
    }
  }
  return problems;
}

/** The files judgeUploadContent needs, picked out of a full file set. */
export function smallFiles(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [n, b] of files) if (n.endsWith(".m3u8") || n.endsWith(".mp4") || n === "poster.jpg") out.set(n, b);
  return out;
}
