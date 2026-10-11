/** VID-1 · see the "@mediabunny-aac-core" alias in vite.config.ts and aacWasm.worker.ts. */
declare module "@mediabunny-aac-core" {
  const createModule: (moduleArg?: Record<string, unknown>) => Promise<unknown>;
  export default createModule;
}
