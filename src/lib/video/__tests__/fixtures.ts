/**
 * Synthetic encoded media for the VID tests: real fMP4 boxes (muxed by the
 * same mp4-muxer path as production) around fake sample bytes. The server
 * checks never decode samples, so fake samples exercise every rule.
 */
import { packageHls, type RawChunk } from "../hlsPackager";

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
