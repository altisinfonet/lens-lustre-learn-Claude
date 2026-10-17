/**
 * media-authz Worker entry (Cloudflare module Worker). The behaviour is all in
 * ./handler.ts, which is what the tests drive; this file only wires the real
 * bindings. Deploy the BUILT single file ./worker.js (see README.md) — never
 * hand-edit it: `node scripts/web-media-authz-build.mjs` regenerates it and CI
 * fails when it differs from these sources.
 */
import { handleMediaRequest, type MediaAuthzEnv, type CacheLike } from "./handler";

interface Ctx { waitUntil(p: Promise<unknown>): void }

export default {
  async fetch(request: Request, env: MediaAuthzEnv, ctx: Ctx): Promise<Response> {
    const cache = (globalThis as unknown as { caches?: { default?: CacheLike } }).caches?.default;
    return handleMediaRequest(request, env, {
      nowMs: () => Date.now(),
      cache,
      passthrough: (req) => fetch(req),
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};
