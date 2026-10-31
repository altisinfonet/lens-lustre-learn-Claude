/** Segment facts read back from a package's own media playlists (self-test + tests). */
import { judgePlaylist } from "../../src/lib/video/shared/playlist";

const dec = new TextDecoder();

export function mediaPlaylistSegments(files: ReadonlyMap<string, Uint8Array>): Array<{ playlist: string; uri: string; seconds: number; bytes: number; last: boolean }> {
  const names = new Set(files.keys());
  const out: Array<{ playlist: string; uri: string; seconds: number; bytes: number; last: boolean }> = [];
  for (const [name, bytes] of files) {
    if (!name.endsWith(".m3u8") || name === "master.m3u8") continue;
    const v = judgePlaylist(name, dec.decode(bytes), names, Number.POSITIVE_INFINITY);
    v.segments.forEach((s, i) => out.push({ playlist: name, uri: s.uri, seconds: s.seconds, bytes: files.get(s.uri)?.length ?? 0, last: i === v.segments.length - 1 }));
  }
  return out;
}

/** EXT-X-TARGETDURATION of a media playlist. */
export function targetDuration(text: string): number {
  return Number(/#EXT-X-TARGETDURATION:(\d+)/.exec(text)?.[1] ?? NaN);
}
