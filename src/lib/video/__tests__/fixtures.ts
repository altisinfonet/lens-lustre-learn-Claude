/**
 * Synthetic encoded media for the VID tests: real fMP4 boxes (muxed by the
 * same mp4-muxer path as production) around fake sample bytes. The server
 * checks never decode samples, so fake samples exercise every rule.
 */
import { Muxer, StreamTarget } from "mp4-muxer";
import { KEYFRAME_SECONDS, packageHls, SEGMENT_SECONDS, type RawChunk } from "../hlsPackager";

export function fakeChunks(seconds: number, fps: number, keyEverySec: number, bytesPerFrame: number): RawChunk[] {
  const out: RawChunk[] = [];
  const dur = Math.round(1e6 / fps);
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const data = new Uint8Array(bytesPerFrame);
    data[0] = i & 0xff; data[1] = (i >> 8) & 0xff;
    out.push({ data, key: i % Math.round(keyEverySec * fps) === 0, timestamp: i * dur, duration: dur });
  }
  return out;
}

export function fakeAudio(seconds: number, sampleRate = 48000): RawChunk[] {
  const frame = 1024; // AAC frame
  const dur = Math.round((frame / sampleRate) * 1e6);
  const n = Math.ceil((seconds * sampleRate) / frame);
  return Array.from({ length: n }, (_, i) => ({ data: new Uint8Array(200).fill(i & 0xff), key: true, timestamp: i * dur, duration: dur }));
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

const AVC_DESC = new Uint8Array([1, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1e, 1, 0, 4, 0x68, 0xce, 0x3c, 0x80]);
const AAC_DESC = new Uint8Array([0x11, 0x90]);

export async function fakePackage(opts: { seconds?: number; audio?: boolean; renditions?: Array<"240p" | "480p" | "720p"> } = {}) {
  const seconds = opts.seconds ?? 10;
  const names = opts.renditions ?? ["240p", "480p"];
  const sizes = { "240p": [426, 240, 800], "480p": [854, 480, 2400], "720p": [1280, 720, 6000] } as const;
  return packageHls({
    video: names.map((name) => ({
      name, width: sizes[name][0], height: sizes[name][1], muxCodec: "avc" as const, codecString: "avc1.42C01E",
      chunks: fakeChunks(seconds, 30, 2, sizes[name][2]),
      decoderConfig: { codec: "avc1.42C01E", codedWidth: sizes[name][0], codedHeight: sizes[name][1], description: AVC_DESC },
    })),
    audio: opts.audio === false ? null : {
      muxCodec: "aac", codecString: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, chunks: fakeAudio(seconds),
      decoderConfig: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, description: AAC_DESC },
    },
    poster: JPEG,
    durationSeconds: seconds,
    sourceWidth: 1280,
    sourceHeight: 720,
  });
}

/**
 * A WHOLE fragmented MP4 (ftyp, moov, moof+mdat …, mfra), as an outside
 * encoder writes it — the input of packageFromFragmented (the server
 * converter's FFmpeg output has this shape). Same mp4-muxer settings as
 * hlsPackager's muxVideo/muxAudio, so the same chunks give the same bytes.
 */
function wholeFile(mux: (target: StreamTarget) => void): Uint8Array {
  const parts: { data: Uint8Array; position: number }[] = [];
  mux(new StreamTarget({ onData: (data, position) => parts.push({ data: data.slice(), position }) }));
  const size = parts.reduce((m, p) => Math.max(m, p.position + p.data.length), 0);
  const out = new Uint8Array(size);
  for (const p of parts) out.set(p.data, p.position);
  return out;
}

export function fakeFragmentedVideo(o: { seconds: number; width: number; height: number; fps?: number; keyEverySec?: number; bytesPerFrame?: number; minFragmentSeconds?: number }): Uint8Array {
  return wholeFile((target) => {
    const muxer = new Muxer({
      target, video: { codec: "avc", width: o.width, height: o.height }, fastStart: "fragmented",
      minFragmentDuration: o.minFragmentSeconds ?? KEYFRAME_SECONDS + 0.15, firstTimestampBehavior: "offset", // = muxVideo
    });
    fakeChunks(o.seconds, o.fps ?? 30, o.keyEverySec ?? 2, o.bytesPerFrame ?? 800).forEach((c, i) => {
      muxer.addVideoChunkRaw(c.data, c.key ? "key" : "delta", c.timestamp, c.duration,
        i === 0 ? { decoderConfig: { codec: "avc1.42C01E", codedWidth: o.width, codedHeight: o.height, description: AVC_DESC } } : undefined);
    });
    muxer.finalize();
  });
}

export function fakeFragmentedAudio(o: { seconds: number; minFragmentSeconds?: number }): Uint8Array {
  return wholeFile((target) => {
    const muxer = new Muxer({
      target, audio: { codec: "aac", sampleRate: 48000, numberOfChannels: 2 }, fastStart: "fragmented",
      minFragmentDuration: o.minFragmentSeconds ?? SEGMENT_SECONDS - 0.1, firstTimestampBehavior: "offset", // = muxAudio
    });
    fakeAudio(o.seconds).forEach((c, i) => {
      muxer.addAudioChunkRaw(c.data, "key", c.timestamp, c.duration,
        i === 0 ? { decoderConfig: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, description: AAC_DESC } } : undefined);
    });
    muxer.finalize();
  });
}
