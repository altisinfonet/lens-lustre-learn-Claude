/** Types for scripts/web-aac-core-esm.mjs (VID-1, AAC WASM fallback). */
export declare function transformAacCore(code: string): string;
export declare function aacCoreEsmPlugin(): {
  name: string;
  enforce: "pre";
  transform: (code: string, id: string) => { code: string; map: null } | null;
};
