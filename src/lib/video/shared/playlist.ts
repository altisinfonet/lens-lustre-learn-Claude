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
  /** media playlists: each segment and the EXTINF it claims, in order */
  segments: Array<{ uri: string; seconds: number }>;
}

/**
 * Only printable ASCII and line feeds; a carriage return only as part of CRLF.
 * Review #411 C1: hls.js also breaks lines on a lone CR (and on U+2028/2029),
 * so a playlist that looks like ONE line to a "\n"-splitting checker can be two
 * lines to the player — the second an outside URL. Refuse anything else.
 */
export function hasUnsafePlaylistChars(text: string): boolean {
  return /[^\x20-\x7E\r\n]|\r(?!\n)/.test(text);
}

/**
 * THE GRAMMAR (review #411 C2): exactly what mediaPlaylist()/masterPlaylist()
 * above write, and nothing else. Every tag line must match one of these; every
 * other non-empty line must be the URI right after a strict EXTINF (media) or
 * STREAM-INF (master). A tag hls.js would read but this list does not know is
 * refused, never ignored.
 */
const MEDIA_TAG = [
  /^#EXTM3U$/, /^#EXT-X-VERSION:\d{1,2}$/, /^#EXT-X-TARGETDURATION:\d{1,2}$/, /^#EXT-X-MEDIA-SEQUENCE:0$/,
  /^#EXT-X-PLAYLIST-TYPE:VOD$/, /^#EXT-X-INDEPENDENT-SEGMENTS$/, /^#EXT-X-MAP:URI="[^"]*"$/,
  /^#EXTINF:\d{1,4}(\.\d{1,6})?,$/, /^#EXT-X-ENDLIST$/,
];
const MASTER_TAG = [
  /^#EXTM3U$/, /^#EXT-X-VERSION:\d{1,2}$/, /^#EXT-X-INDEPENDENT-SEGMENTS$/,
  /^#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="[A-Za-z0-9 ]{1,32}",DEFAULT=YES,AUTOSELECT=YES,URI="audio\.m3u8"$/,
  /^#EXT-X-STREAM-INF:BANDWIDTH=\d{1,10},RESOLUTION=\d{1,5}x\d{1,5},CODECS="[A-Za-z0-9.,]{1,80}"(,AUDIO="aud")?$/,
];

/**
 * Judge one playlist. `names` = every file name in the manifest.
 * `declared` = the manifest duration; media playlists must sum within ±2 s.
 */
export function judgePlaylist(name: string, text: string, names: ReadonlySet<string>, declared: number): PlaylistVerdict {
  const problems: string[] = [];
  const segments: Array<{ uri: string; seconds: number }> = [];
  let seconds = 0;
  if (hasUnsafePlaylistChars(text)) {
    return { problems: [`${name}: contains characters other than printable ASCII and line breaks`], seconds, segments };
  }
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const nonEmpty = lines.filter((l) => l !== "");
  if (nonEmpty[0] !== "#EXTM3U") problems.push(`${name}: does not start with #EXTM3U`);
  if (lines.some((l) => l !== l.trim())) problems.push(`${name}: a line has leading or trailing spaces`);
  const isMedia = name !== "master.m3u8";

  if (isMedia) {
    const rendition = name.replace(/\.m3u8$/, "");
    const segRe = new RegExp(`^${rendition}_(0|[1-9]\\d{0,3})\\.m4s$`);
    let target = NaN;
    let targets = 0;
    let maps = 0;
    let ended = false;
    let pending: number | null = null;
    const seen = new Set<string>();
    for (const line of nonEmpty) {
      if (line.startsWith("#")) {
        if (!MEDIA_TAG.some((re) => re.test(line))) {
          problems.push(`${name}: ${line.startsWith("#EXTINF") ? "a malformed EXTINF" : `the tag ${line.split(":")[0]} is not allowed`} (${JSON.stringify(line.slice(0, 40))})`);
          continue;
        }
        if (ended) problems.push(`${name}: a tag after #EXT-X-ENDLIST`);
        if (line.startsWith("#EXT-X-TARGETDURATION:")) { targets++; target = Number(line.split(":")[1]); }
        else if (line.startsWith("#EXT-X-MAP:")) {
          maps++;
          const uri = /URI="([^"]*)"/.exec(line)![1];
          if (uri !== `${rendition}.mp4`) problems.push(`${name}: EXT-X-MAP must be ${rendition}.mp4, not ${JSON.stringify(uri)}`);
          if (segments.length) problems.push(`${name}: EXT-X-MAP after the first segment`);
        } else if (line.startsWith("#EXTINF:")) {
          if (pending !== null) problems.push(`${name}: two EXTINF lines in a row`);
          pending = Number(line.slice(8, -1));
        } else if (line === "#EXT-X-ENDLIST") ended = true;
        continue;
      }
      // A URI line: only directly after a strict EXTINF.
      if (pending === null) { problems.push(`${name}: ${JSON.stringify(line.slice(0, 40))} is not a segment after an EXTINF`); continue; }
      const s = pending;
      pending = null;
      if (ended) problems.push(`${name}: a segment after #EXT-X-ENDLIST`);
      segments.push({ uri: line, seconds: s });
      seconds += s;
      if (!segRe.test(line)) problems.push(`${name}: ${line} is not one of ${rendition}'s own segments`);
      else if (!names.has(line)) problems.push(`${name}: ${line} is not in the manifest`);
      if (seen.has(line)) problems.push(`${name}: ${line} is listed twice`);
      seen.add(line);
      if (!(s > 0)) problems.push(`${name}: ${line} claims ${s} s`);
      // HLS: an EXTINF rounded to the nearest second must not exceed TARGETDURATION.
      if (Number.isFinite(target) && Math.round(s) > target) problems.push(`${name}: ${line} claims ${s} s, above EXT-X-TARGETDURATION ${target}`);
    }
    if (pending !== null) problems.push(`${name}: an EXTINF with no segment after it`);
    if (targets !== 1) problems.push(`${name}: needs exactly one EXT-X-TARGETDURATION`);
    else if (target > 6) problems.push(`${name}: EXT-X-TARGETDURATION ${target} is above 6`);
    if (maps !== 1) problems.push(`${name}: needs exactly one EXT-X-MAP`);
    if (!ended) problems.push(`${name}: no #EXT-X-ENDLIST`);
    if (segments.length === 0) problems.push(`${name}: no segments`);
    // Review #411 C4: every segment but the last is at least 1 s (no thousands of slivers).
    segments.slice(0, -1).forEach((g) => { if (g.seconds < 1) problems.push(`${name}: ${g.uri} is ${g.seconds} s — only the last segment may be under 1 s`); });
    if (Math.abs(seconds - declared) > 2) {
      problems.push(`${name}: segments add up to ${seconds.toFixed(2)} s, declared ${declared} s (±2 s)`);
    }
  } else {
    let pendingVariant = false;
    const variants = new Set<string>();
    for (const line of nonEmpty) {
      if (line.startsWith("#")) {
        if (!MASTER_TAG.some((re) => re.test(line))) { problems.push(`${name}: the tag ${line.split(":")[0]} is not allowed here (${JSON.stringify(line.slice(0, 40))})`); continue; }
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          if (pendingVariant) problems.push(`${name}: two EXT-X-STREAM-INF lines in a row`);
          pendingVariant = true;
        } else if (line.startsWith("#EXT-X-MEDIA:") && !names.has("audio.m3u8")) {
          problems.push(`${name}: names audio.m3u8, which is not in the manifest`);
        }
        continue;
      }
      if (!pendingVariant) { problems.push(`${name}: ${JSON.stringify(line.slice(0, 40))} is not a variant after an EXT-X-STREAM-INF`); continue; }
      pendingVariant = false;
      if (!/^(240|480|720)p\.m3u8$/.test(line)) problems.push(`${name}: variant ${JSON.stringify(line.slice(0, 40))} is not 240p/480p/720p.m3u8`);
      else if (!names.has(line)) problems.push(`${name}: variant ${line} is not in the manifest`);
      if (variants.has(line)) problems.push(`${name}: variant ${line} is listed twice`);
      variants.add(line);
    }
    if (pendingVariant) problems.push(`${name}: an EXT-X-STREAM-INF with no variant after it`);
    if (variants.size === 0) problems.push(`${name}: no variants`);
  }
  return { problems, seconds, segments };
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
