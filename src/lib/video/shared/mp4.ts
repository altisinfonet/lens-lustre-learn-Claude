/**
 * VID-1 · a minimal ISO-BMFF (MP4) box reader. Pure, no imports.
 *
 * Two jobs, on both sides of the upload:
 *   • the app splits mp4-muxer's fragmented output into an init segment
 *     (ftyp+moov) and one media segment per moof+mdat, and reads each
 *     fragment's duration for the playlist;
 *   • /api/video/complete reads `moov/trak/mdia/hdlr` of every init segment to
 *     prove a video rendition carries exactly one `vide` and no `soun`, and the
 *     audio rendition exactly one `soun` (SEC F-D3-17).
 * It reads only box headers and the few fields named below. Anything malformed
 * throws — a parser that guesses would turn a crafted file into a pass.
 */

export interface Box {
  type: string;
  /** offset of the box header in the buffer */
  start: number;
  /** offset just past the header */
  body: number;
  /** offset just past the box */
  end: number;
}

function u32(b: Uint8Array, o: number): number {
  if (o + 4 > b.length) throw new Error("MP4-001: read past the end");
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function u64(b: Uint8Array, o: number): number {
  const hi = u32(b, o);
  const lo = u32(b, o + 4);
  const v = hi * 2 ** 32 + lo;
  if (!Number.isSafeInteger(v)) throw new Error("MP4-002: 64-bit value too large");
  return v;
}

function fourcc(b: Uint8Array, o: number): string {
  if (o + 4 > b.length) throw new Error("MP4-001: read past the end");
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/** The boxes directly inside [from, to). Throws on any size that does not fit exactly. */
export function children(b: Uint8Array, from = 0, to = b.length): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o < to) {
    if (o + 8 > to) throw new Error("MP4-003: truncated box header");
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let body = o + 8;
    if (size === 1) { size = u64(b, o + 8); body = o + 16; }
    else if (size === 0) size = to - o;
    if (size < body - o || o + size > to) throw new Error(`MP4-004: box ${type} at ${o} does not fit (${size})`);
    out.push({ type, start: o, body, end: o + size });
    o += size;
  }
  return out;
}

/** All boxes reached by a path of types, e.g. ["moov","trak","mdia","hdlr"]. */
export function findAll(b: Uint8Array, path: string[], from = 0, to = b.length): Box[] {
  if (path.length === 0) return [];
  const here = children(b, from, to).filter((x) => x.type === path[0]);
  if (path.length === 1) return here;
  return here.flatMap((x) => findAll(b, path.slice(1), x.body, x.end));
}

/** handler_type of every track in an init segment, in track order: "vide", "soun", … */
export function trackHandlers(init: Uint8Array): string[] {
  const hdlrs = findAll(init, ["moov", "trak", "mdia", "hdlr"]);
  // FullBox: version+flags (4), pre_defined (4), handler_type (4)
  return hdlrs.map((h) => fourcc(init, h.body + 8));
}

/** mdhd timescale of the first track (the only one, in our single-track renditions). */
export function trackTimescale(init: Uint8Array): number {
  const mdhd = findAll(init, ["moov", "trak", "mdia", "mdhd"])[0];
  if (!mdhd) throw new Error("MP4-005: no mdhd");
  const version = init[mdhd.body];
  return u32(init, mdhd.body + 4 + (version === 1 ? 16 : 8));
}

/** trex default_sample_duration of the first track (0 when absent). */
export function trexDefaultDuration(init: Uint8Array): number {
  const trex = findAll(init, ["moov", "mvex", "trex"])[0];
  return trex ? u32(init, trex.body + 12) : 0;
}

/**
 * Split a fragmented MP4 (ftyp, moov, then moof+mdat pairs) into the init
 * segment and the media segments. Any other top-level box after the moov
 * (mfra, free, sidx) is dropped — HLS does not need it.
 */
export function splitFragmented(file: Uint8Array): { init: Uint8Array; segments: Uint8Array[] } {
  const top = children(file);
  const moov = top.findIndex((x) => x.type === "moov");
  if (moov < 0) throw new Error("MP4-006: no moov");
  const init = file.slice(0, top[moov].end);
  const segments: Uint8Array[] = [];
  for (let i = moov + 1; i < top.length; i++) {
    if (top[i].type !== "moof") continue;
    const mdat = top[i + 1];
    if (!mdat || mdat.type !== "mdat") throw new Error("MP4-007: a moof without its mdat");
    segments.push(file.slice(top[i].start, mdat.end));
    i++;
  }
  return { init, segments };
}

/** Duration of one moof+mdat media segment, in the track's timescale units. */
export function segmentDurationUnits(seg: Uint8Array, defaultDuration = 0): number {
  let total = 0;
  for (const traf of findAll(seg, ["moof", "traf"])) {
    const tfhd = children(seg, traf.body, traf.end).find((x) => x.type === "tfhd");
    let trafDefault = defaultDuration;
    if (tfhd) {
      const flags = (seg[tfhd.body + 1] << 16) | (seg[tfhd.body + 2] << 8) | seg[tfhd.body + 3];
      let o = tfhd.body + 8; // version/flags + track_ID
      if (flags & 0x01) o += 8; // base_data_offset
      if (flags & 0x02) o += 4; // sample_description_index
      if (flags & 0x08) trafDefault = u32(seg, o);
    }
    for (const trun of children(seg, traf.body, traf.end).filter((x) => x.type === "trun")) {
      const flags = (seg[trun.body + 1] << 16) | (seg[trun.body + 2] << 8) | seg[trun.body + 3];
      const count = u32(seg, trun.body + 4);
      let o = trun.body + 8;
      if (flags & 0x01) o += 4; // data_offset
      if (flags & 0x04) o += 4; // first_sample_flags
      for (let i = 0; i < count; i++) {
        if (flags & 0x100) { total += u32(seg, o); o += 4; } else total += trafDefault;
        if (flags & 0x200) o += 4;
        if (flags & 0x400) o += 4;
        if (flags & 0x800) o += 4;
      }
    }
  }
  return total;
}

/** JPEG magic FF D8 FF (SEC condition 2). */
export function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
