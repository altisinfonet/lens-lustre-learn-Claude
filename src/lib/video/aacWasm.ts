/**
 * VID-1 · AAC-LC for browsers whose WebCodecs cannot encode AAC (Firefox).
 *
 * Same output as the native AudioEncoder path in webEncoder.ts — key-only AAC
 * chunks with microsecond timestamps plus a decoderConfig carrying the
 * AudioSpecificConfig — so hlsPackager, the manifest and /api/video/complete see
 * no difference. Lazy: only imported when native AAC is unavailable.
 */
import type { RawChunk } from "./hlsPackager";
import type { AacCommand, AacPacket } from "./aacWasm.worker";

/** The rates FFmpeg's AAC encoder accepts (an AudioBuffer at any other rate is resampled first). */
export const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** WASM + module workers: what the fallback needs from the browser. */
export function wasmAacAvailable(): boolean {
  return typeof WebAssembly === "object" && typeof Worker !== "undefined";
}

export interface WasmAacResult {
  chunks: RawChunk[];
  decoderConfig: AudioDecoderConfig;
}

/** Encode planar f32 channels (as from AudioBuffer.getChannelData) to AAC-LC. */
export async function encodeAacWasm(
  planes: Float32Array[], sampleRate: number, bitrate: number, signal?: AbortSignal,
): Promise<WasmAacResult> {
  const channels = planes.length;
  const length = planes[0]?.length ?? 0;
  const worker = new Worker(new URL("./aacWasm.worker.ts", import.meta.url), { type: "module" });
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let failure: Error | null = null;
  worker.addEventListener("message", (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(`VID-ENC-003: ${e.data.error}`));
  });
  const failAll = (err: Error) => {
    failure = err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  worker.addEventListener("error", (e) => failAll(new Error(`VID-ENC-003: the AAC encoder could not start (${e.message || "worker error"})`)));
  worker.addEventListener("messageerror", () => failAll(new Error("VID-ENC-003: the AAC encoder sent a message that could not be read")));
  // A stuck worker must not hang the upload: init may compile the WASM (seconds
  // on a slow phone), one frame is milliseconds.
  const send = <T>(command: AacCommand, transfer: Transferable[] = []): Promise<T> => {
    if (failure) return Promise.reject(failure);
    const id = nextId++;
    const limitMs = command.type === "init" ? 60_000 : 15_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => failAll(new Error(`VID-ENC-003: the AAC encoder stopped responding (${command.type})`)), limitMs);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); (resolve as (v: unknown) => void)(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      worker.postMessage({ id, command }, transfer);
    });
  };

  try {
    const init = await send<{ ctx: number; frameSize: number; extradata: ArrayBuffer }>({ type: "init", data: { numberOfChannels: channels, sampleRate, bitrate } });
    const { ctx, frameSize } = init;
    const chunks: RawChunk[] = [];
    let packetTs = 0; // samples
    const take = (packets: AacPacket[]) => {
      for (const p of packets) {
        chunks.push({
          data: new Uint8Array(p.encodedData),
          key: true,
          timestamp: Math.round((packetTs / sampleRate) * 1e6),
          duration: Math.round((p.duration / sampleRate) * 1e6),
        });
        packetTs += p.duration;
      }
    };
    for (let off = 0; off < length; off += frameSize) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const n = Math.min(frameSize, length - off);
      const frame = new Float32Array(frameSize * channels); // the last frame is zero-padded
      for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) frame[i * channels + c] = planes[c][off + i];
      const r = await send<{ packets: AacPacket[] }>({ type: "encode", data: { ctx, audioData: frame.buffer, timestamp: off } }, [frame.buffer]);
      take(r.packets);
    }
    take((await send<{ packets: AacPacket[] }>({ type: "flush", data: { ctx } })).packets);
    return {
      chunks,
      decoderConfig: { codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, description: new Uint8Array(init.extradata) },
    };
  } finally {
    worker.terminate();
  }
}
