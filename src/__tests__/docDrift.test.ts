// @vitest-environment node
/**
 * S11 doc drift · two comments that told the next reader something false.
 *   - queryKeys.ts restated App.tsx's QueryClient defaults and said
 *     refetchOnWindowFocus: false — App.tsx sets true.
 *   - realtimeCounts.ts pointed at `assertNoLikeCountDelta`, a function that
 *     does not exist; the guard is applyReactionDelta + the source checks in
 *     realtimeCounts.test.ts.
 * These read the real values, so the comments cannot drift silently again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("comments that restate code agree with it", () => {
  it("queryKeys.ts's global defaults are App.tsx's", () => {
    const app = read("src/App.tsx");
    const block = app.slice(app.indexOf("new QueryClient("), app.indexOf("});", app.indexOf("new QueryClient(")));
    const focus = /refetchOnWindowFocus:\s*(true|false)/.exec(block)![1];
    const stale = /staleTime:\s*(\d+) \* 60 \* 1000/.exec(block)![1];
    const gc = /gcTime:\s*(\d+) \* 60 \* 1000/.exec(block)![1];
    const doc = read("src/lib/queryKeys.ts");
    expect(doc).toContain(`refetchOnWindowFocus: ${focus}`);
    expect(doc).toContain(`staleTime: ${stale} min`);
    expect(doc).toContain(`gcTime: ${gc} min`);
  });

  it("every function realtimeCounts.ts names in backticks exists", () => {
    const src = read("src/lib/feed/realtimeCounts.ts");
    const named = [...src.matchAll(/`([a-z][A-Za-z]+)`/g)].map((m) => m[1]).filter((n) => /^(assert|apply|map|top)[A-Z]/.test(n));
    expect(named.length).toBeGreaterThan(0);
    for (const n of new Set(named)) expect(src, n).toMatch(new RegExp(`export function ${n}\\(`));
  });
});
