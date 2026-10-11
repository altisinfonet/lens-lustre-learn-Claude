/**
 * VID-1 · Firefox can post videos: AAC from WASM when the browser has none.
 *
 * Cross-browser run on live staging, 2026-10-11: Firefox 157 has WebCodecs
 * H.264 encoding but no AAC encoder, so every upload was refused with "Video
 * upload isn't supported in this browser". The fallback (aacWasm.ts + worker)
 * was then proven in real Firefox on 10 formats: docs/evidence/d2/VID/aac-wasm/.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encoderSupported } from "../webEncoder";
import { aacCoreEsmPlugin, transformAacCore } from "../../../../scripts/web-aac-core-esm.mjs";

const supported = (yes: boolean) => vi.fn(async () => ({ supported: yes }));

afterEach(() => { vi.unstubAllGlobals(); });

describe("encoderSupported", () => {
  it("Chrome/Edge: native H.264 + native AAC → yes", async () => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: supported(true) });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: supported(true) });
    expect(await encoderSupported()).toBe(true);
  });

  it("Firefox: native H.264, NO AAC, WASM + workers available → yes (the fallback)", async () => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: supported(true) });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: supported(false) });
    vi.stubGlobal("Worker", class {});
    expect(typeof WebAssembly).toBe("object");
    expect(await encoderSupported()).toBe(true);
  });

  it("no AudioEncoder at all but WASM + workers → still yes", async () => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: supported(true) });
    vi.stubGlobal("AudioEncoder", undefined);
    vi.stubGlobal("Worker", class {});
    expect(await encoderSupported()).toBe(true);
  });

  it("no AAC and no workers → no (told to use the app)", async () => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: supported(true) });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: supported(false) });
    vi.stubGlobal("Worker", undefined);
    expect(await encoderSupported()).toBe(false);
  });

  it("no H.264 encoder → no, whatever the audio", async () => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: supported(false) });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: supported(true) });
    expect(await encoderSupported()).toBe(false);
  });
});

describe("the AAC core is turned into plain ESM, or the build fails", () => {
  const core = 'Object.defineProperty(exports, "__esModule", { value: true });\nasync function Module(moduleArg = {}) { return 1; }\nexports.default = Module;\n';

  it("rewrites exports to export default", () => {
    const out = transformAacCore(core);
    expect(out).not.toMatch(/exports/);
    expect(out).toMatch(/export default Module;/);
  });

  it("throws when the package changes shape", () => {
    expect(() => transformAacCore("export default function Module() {}")).toThrow(/changed shape/);
  });

  it("only touches the core file, in dev (with ?v=) and in build", () => {
    const p = aacCoreEsmPlugin();
    expect(p.transform(core, "/x/node_modules/@mediabunny/aac-encoder/dist/modules/build/aac.js?v=abc")?.code).toMatch(/export default Module/);
    expect(p.transform(core, "C:\\x\\node_modules\\@mediabunny\\aac-encoder\\dist\\modules\\build\\aac.js")?.code).toMatch(/export default Module/);
    expect(p.transform(core, "/x/src/other.ts")).toBeNull();
  });

  it("the real installed core still has the shape the plugin expects", () => {
    const real = readFileSync("node_modules/@mediabunny/aac-encoder/dist/modules/build/aac.js", "latin1");
    expect(() => transformAacCore(real)).not.toThrow();
  });
});

describe("CSP lets the WASM run — and nothing more", () => {
  const csp = readFileSync("public/_headers", "utf8").split("\n").find((l) => l.includes("Content-Security-Policy:")) || "";
  const directive = (name: string) => (csp.split(";").find((d) => d.trim().startsWith(name + " ")) || "").trim();

  it("script-src has 'wasm-unsafe-eval' (compile WASM) but never 'unsafe-eval' (JS eval)", () => {
    expect(directive("script-src")).toMatch(/'wasm-unsafe-eval'/);
    expect(directive("script-src")).not.toMatch(/'unsafe-eval'/);
  });

  it("the worker is still same-origin only", () => {
    expect(directive("worker-src")).toBe("worker-src 'self'");
  });

  it("the worker is created from a module URL Vite emits to /assets/, not from a blob:", () => {
    const src = readFileSync("src/lib/video/aacWasm.ts", "utf8");
    expect(src).toMatch(/new Worker\(new URL\("\.\/aacWasm\.worker\.ts", import\.meta\.url\), \{ type: "module" \}\)/);
    expect(src).not.toMatch(/createObjectURL/);
  });
});
