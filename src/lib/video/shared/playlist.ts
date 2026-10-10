/**
 * VID-1 · HLS playlists: built by the app, judged by /api/video/complete. Pure.
 *
 * Shape (VID-1 §2): fMP4 HLS, 4 s segments, one media playlist per rendition,
 * video renditions are video-only, ONE separate audio rendition shared by every
 * variant through `EXT-X-MEDIA TYPE=AUDIO,GROUP-ID="aud"`.
 *
 * The server's rules (SEC condition 3): only relative URIs that are in the
 * manifest; no absolute or `//` URI; no EXT-X-KEY, EXT-X-SESSION-KEY,
 * EXT-X-SESSION-DATA or EXT-X-DEFINE; EXT-X-TARGETDURATION ≤ 6; the summed
 * EXTINF per rendition within ±2 s of the declared duration.
 */

export interface SegmentRef {
  name: string;
  seconds: number;
}

export function mediaPlaylist(initName: string, segments: SegmentRef[]): string {
  const target = Math.max(1, Math.ceil(Math.max(0, ...segments.map((s) => s.seconds))));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${target}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MAP:URI="${initName}"`,
  ];
  for (const s of segments) lines.push(`#EXTINF:${s.seconds.toFixed(3)},`, s.name);
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

export interface VariantRef {
  /** "240p" | "480p" | "720p" */
  name: string;
  width: number;
  height: number;
  /** peak bits per second */
  bandwidth: number;
  /** e.g. "avc1.42E01E" */
  videoCodec: string;
}

export function masterPlaylist(variants: VariantRef[], audio: { codec: string } | null): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  if (audio) {
    lines.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"');
  }
  for (const v of variants) {
    const codecs = audio ? `${v.videoCodec},${audio.codec}` : v.videoCodec;
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${Math.round(v.bandwidth)},RESOLUTION=${v.width}x${v.height},CODECS="${codecs}"${audio ? ',AUDIO="aud"' : ""}`,
      `${v.name}.m3u8`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

const FORBIDDEN_TAGS = ["#EXT-X-KEY", "#EXT-X-SESSION-KEY", "#EXT-X-SESSION-DATA", "#EXT-X-DEFINE"];

/** Every URI a playlist references: plain lines and URI="…" attributes. */
export function playlistUris(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      for (const m of line.matchAll(/URI="([^"]*)"/g)) out.push(m[1]);
    } else {
      out.push(line);
    }
  }
  return out;
}

export interface PlaylistVerdict {
  problems: string[];
  /** summed EXTINF, for media playlists */
  seconds: number;
}

/**
 * Judge one playlist. `names` = every file name in the manifest.
 * `declared` = the manifest duration; media playlists must sum within ±2 s.
 */
export function judgePlaylist(name: string, text: string, names: ReadonlySet<string>, declared: number): PlaylistVerdict {
  const problems: string[] = [];
  if (!text.startsWith("#EXTM3U")) problems.push(`${name}: does not start with #EXTM3U`);
  for (const tag of FORBIDDEN_TAGS) {
    if (text.split(/\r?\n/).some((l) => l.trim().toUpperCase().startsWith(tag))) problems.push(`${name}: ${tag} is not allowed`);
  }
  for (const uri of playlistUris(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("//") || uri.startsWith("/") || uri.includes("..") || uri.includes("/")) {
      problems.push(`${name}: URI ${JSON.stringify(uri)} is not a relative file name`);
    } else if (!names.has(uri)) {
      problems.push(`${name}: URI ${JSON.stringify(uri)} is not in the manifest`);
    }
  }
  const td = /#EXT-X-TARGETDURATION:(\d+)/.exec(text);
  let seconds = 0;
  const isMedia = name !== "master.m3u8";
  if (isMedia) {
    if (!td) problems.push(`${name}: no EXT-X-TARGETDURATION`);
    else if (Number(td[1]) > 6) problems.push(`${name}: EXT-X-TARGETDURATION ${td[1]} is above 6`);
    for (const m of text.matchAll(/#EXTINF:([0-9.]+)/g)) seconds += Number(m[1]);
    if (Math.abs(seconds - declared) > 2) {
      problems.push(`${name}: segments add up to ${seconds.toFixed(2)} s, declared ${declared} s (±2 s)`);
    }
  } else if (/#EXTINF/.test(text)) {
    problems.push(`${name}: the master playlist must not list segments`);
  }
  return { problems, seconds };
}

/** CODECS strings in the master playlist, per variant playlist name. */
export function masterCodecs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const c = /CODECS="([^"]*)"/.exec(lines[i]);
    const next = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
    if (next) out.set(next, c ? c[1] : "");
  }
  return out;
}
