/**
 * VID-1 §3.4 · the CONTENT rules /api/video/complete applies once every file
 * is present and matches the manifest. Pure, no imports beyond the shared
 * readers, so the Function and the encoder harness judge with ONE function.
 *
 *   SEC condition 2  poster.jpg starts FF D8 FF
 *   SEC condition 3  playlists: relative URIs in the manifest only; no key /
 *                    session / define tags; TARGETDURATION ≤ 6; EXTINF sums
 *                    within ±2 s of the declared duration
 *   review C1 (#410) with no time cap: every EXTINF ≤ TARGETDURATION; each
 *                    segment listed once, in its own rendition's playlist
 *                    only; every segment file listed; each segment's bytes ≤
 *                    2 × its rendition's bytes/s ceiling × its own EXTINF
 *                    (+256 KB for the last segment only)
 *   review C1–C3 (#411): the playlist GRAMMAR (shared/playlist.ts) — printable
 *                    ASCII only, a fixed tag list, segments only after a strict
 *                    EXTINF, exactly one EXT-X-MAP = the rendition's own init
 *   SEC F-D3-17      every video init: exactly one `vide`, no `soun`; the audio
 *                    init exactly one `soun`; none when has_audio = false; the
 *                    master's CODECS name an audio codec exactly when there is audio
 *
 * `small` = the playlists, the init segments and the poster, by name.
 */
import { isJpeg, trackHandlers } from "./mp4";
import { judgePlaylist, masterCodecs } from "./playlist";
import { RENDITION_CEILING_BPS, type VideoManifest } from "./rules";

const dec = new TextDecoder();

export function judgeUploadContent(manifest: VideoManifest, small: ReadonlyMap<string, Uint8Array>): string[] {
  const problems: string[] = [];
  const names = new Set(manifest.files.map((f) => f.name));

  const poster = small.get("poster.jpg");
  if (!poster || !isJpeg(poster)) problems.push("poster.jpg is not a JPEG");

  const size = new Map(manifest.files.map((f) => [f.name, f.bytes]));
  const listedIn = new Map<string, string>();
  for (const [name, bytes] of small) {
    if (!name.endsWith(".m3u8")) continue;
    const v = judgePlaylist(name, dec.decode(bytes), names, manifest.duration_s);
    problems.push(...v.problems);
    const rendition = name.replace(/\.m3u8$/, "") as keyof typeof RENDITION_CEILING_BPS;
    const ceiling = RENDITION_CEILING_BPS[rendition];
    v.segments.forEach((seg, i) => {
      const other = listedIn.get(seg.uri);
      if (other && other !== name) problems.push(`${seg.uri} is listed in both ${other} and ${name}`);
      listedIn.set(seg.uri, name);
      const b = size.get(seg.uri);
      // +256 KB only for the LAST segment (a keyframe in a short tail) — review #411 C5.
      const slack = i === v.segments.length - 1 ? 262_144 : 0;
      if (ceiling && b !== undefined && b > ceiling * seg.seconds * 2 + slack) {
        problems.push(`${seg.uri}: ${b} bytes for ${seg.seconds} s is above twice the ${rendition} ceiling`);
      }
    });
  }
  for (const n of names) {
    if (n.endsWith(".m4s") && !listedIn.has(n)) problems.push(`${n} is uploaded but no playlist lists it`);
    // Re-review #411: an init with no playlist of its own is a blob the judge never reads.
    const init = /^(240p|480p|720p|audio)\.mp4$/.exec(n);
    if (init && !names.has(`${init[1]}.m3u8`)) problems.push(`${n} is uploaded but there is no ${init[1]}.m3u8`);
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
