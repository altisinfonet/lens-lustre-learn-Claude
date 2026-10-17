/// <reference lib="webworker" />
/**
 * VID-1 · AAC-LC encoder worker for browsers without native AAC encoding
 * (Firefox: WebCodecs AudioEncoder has no "mp4a.40.2").
 *
 * Runs FFmpeg's AAC encoder compiled to WASM, from @mediabunny/aac-encoder
 * (MPL-2.0; core = FFmpeg libavcodec, LGPL-2.1). The message protocol and the
 * calls below follow that package's own src/encode.worker.ts. It is our own file
 * only so Vite emits it to /assets/ — the package's bundle would start the
 * worker from a blob: URL, which the CSP (worker-src 'self') refuses on purpose.
 * Needs script-src 'wasm-unsafe-eval' to compile the WASM; no eval, no new Function.
 *
 * Protocol (one request → one response, by id):
 *   init  {numberOfChannels, sampleRate, bitrate} → {ctx, frameSize, extradata}
 *   encode {ctx, audioData: interleaved f32 of exactly frameSize frames, timestamp in samples} → {packets}
 *   flush {ctx} → {packets}
 */
import createModule from "@mediabunny-aac-core";

type Fn = (...a: number[]) => number;
interface AacModule { HEAPU8: Uint8Array; cwrap: (name: string, ret: string | null, args: string[]) => Fn }

export type AacCommand =
  | { type: "init"; data: { numberOfChannels: number; sampleRate: number; bitrate: number } }
  | { type: "encode"; data: { ctx: number; audioData: ArrayBuffer; timestamp: number } }
  | { type: "flush"; data: { ctx: number } };
export interface AacPacket { encodedData: ArrayBuffer; pts: number; duration: number }

let mod: AacModule | null = null;
let fns: Record<string, Fn> = {};

async function ensure(): Promise<AacModule> {
  if (mod) return mod;
  const m = (await createModule()) as unknown as AacModule;
  fns = {
    init: m.cwrap("init_encoder", "number", ["number", "number", "number"]),
    frameSize: m.cwrap("get_encoder_frame_size", "number", ["number"]),
    extradata: m.cwrap("get_encoder_extradata", "number", ["number"]),
    extradataSize: m.cwrap("get_encoder_extradata_size", "number", ["number"]),
    inputPtr: m.cwrap("get_encode_input_ptr", "number", ["number", "number"]),
    send: m.cwrap("send_frame", "number", ["number", "number"]),
    receive: m.cwrap("receive_packet", "number", ["number"]),
    flushStart: m.cwrap("flush_encoder_start", null, ["number"]),
    reset: m.cwrap("reset_encoder", null, ["number"]),
    data: m.cwrap("get_encoded_data", "number", ["number"]),
    pts: m.cwrap("get_encoded_pts", "number", ["number"]),
    duration: m.cwrap("get_encoded_duration", "number", ["number"]),
  };
  mod = m;
  return m;
}

function drain(m: AacModule, ctx: number): AacPacket[] {
  const out: AacPacket[] = [];
  let size: number;
  while ((size = fns.receive(ctx)) > 0) {
    const ptr = fns.data(ctx);
    out.push({ encodedData: m.HEAPU8.slice(ptr, ptr + size).buffer, pts: Number(fns.pts(ctx)), duration: fns.duration(ctx) });
  }
  return out;
}

async function handle(cmd: AacCommand): Promise<{ result: unknown; transfer: ArrayBuffer[] }> {
  const m = await ensure();
  switch (cmd.type) {
    case "init": {
      const { numberOfChannels, sampleRate, bitrate } = cmd.data;
      const ctx = fns.init(numberOfChannels, sampleRate, bitrate);
      if (ctx === 0) throw new Error("AAC encoder did not initialise");
      const p = fns.extradata(ctx);
      const extradata = m.HEAPU8.slice(p, p + fns.extradataSize(ctx)).buffer;
      return { result: { ctx, frameSize: fns.frameSize(ctx), extradata }, transfer: [extradata] };
    }
    case "encode": {
      const bytes = new Uint8Array(cmd.data.audioData);
      const ptr = fns.inputPtr(cmd.data.ctx, bytes.length);
      if (ptr === 0) throw new Error("AAC encoder could not allocate its input buffer");
      m.HEAPU8.set(bytes, ptr);
      // send_frame takes a 64-bit pts; cwrap passes BigInt for that argument.
      const ret = (fns.send as unknown as (ctx: number, pts: bigint) => number)(cmd.data.ctx, BigInt(cmd.data.timestamp));
      if (ret < 0) throw new Error(`AAC encode failed (${ret})`);
      const packets = drain(m, cmd.data.ctx);
      return { result: { packets }, transfer: packets.map((x) => x.encodedData) };
    }
    case "flush": {
      fns.flushStart(cmd.data.ctx);
      const packets = drain(m, cmd.data.ctx);
      fns.reset(cmd.data.ctx);
      return { result: { packets }, transfer: packets.map((x) => x.encodedData) };
    }
  }
}

self.addEventListener("message", (e: MessageEvent<{ id: number; command: AacCommand }>) => {
  const { id, command } = e.data;
  handle(command).then(
    ({ result, transfer }) => (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, result }, transfer),
    (err) => (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) }),
  );
});
