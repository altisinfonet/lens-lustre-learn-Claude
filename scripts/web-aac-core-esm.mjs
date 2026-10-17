/**
 * VID-1 · Vite plugin: turn the AAC WASM core into plain ESM.
 *
 * @mediabunny/aac-encoder's core (dist/modules/build/aac.js, reached through the
 * "@mediabunny-aac-core" alias in vite.config.ts) is an Emscripten build that
 * mixes CommonJS (`exports.default = Module`) with ESM (`import.meta.url`).
 * Neither esbuild (dev) nor Rollup (build) converts that mix, and inside a
 * module worker the leftover `exports` throws — the AAC worker then dies
 * silently (seen in real Firefox, 2026-10-11). This rewrites the one file to
 * `export default Module`.
 *
 * It FAILS the build if the file no longer has that exact shape, so a package
 * update can never silently ship a broken worker. Registered for the main build
 * and for worker bundles (worker.plugins). Tested in
 * src/lib/video/__tests__/aacFallback.test.ts.
 */
const CORE_SUFFIX = "/@mediabunny/aac-encoder/dist/modules/build/aac.js";
const MARKER = 'Object.defineProperty(exports, "__esModule", { value: true });';
const TAIL = /\nexports\.default = Module;\s*$/;

export function transformAacCore(code) {
  if (!code.includes(MARKER) || !TAIL.test(code)) {
    throw new Error("mediabunny-aac-core-esm: aac.js changed shape — review the @mediabunny/aac-encoder update before shipping");
  }
  return code.replace(MARKER, "").replace(TAIL, "\nexport default Module;\n");
}

export function aacCoreEsmPlugin() {
  return {
    name: "mediabunny-aac-core-esm",
    enforce: "pre",
    transform(code, id) {
      // Dev ids carry a "?v=hash" query; build ids do not.
      if (!id.split("?")[0].replace(/\\/g, "/").endsWith(CORE_SUFFIX)) return null;
      return { code: transformAacCore(code), map: null };
    },
  };
}
