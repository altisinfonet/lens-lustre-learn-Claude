/**
 * S6-b · NO UNFILTERED HOT BINDING, ANYWHERE IN src/.
 *
 * S6 gate term "0 unfiltered hot bindings": every postgres_changes binding on
 * posts / post_reactions / post_comments / post_shares carries a server-side
 * `filter`, and none listens to DELETE (Supabase cannot filter DELETE events,
 * so such a binding is unfiltered by construction). Read with the same scanner
 * the P3 parity check uses (scripts/web-subscription-scan.mjs).
 */
import { describe, it, expect } from "vitest";
import { scan } from "../../scripts/web-subscription-scan.mjs";

const HOT = /^(posts|post_reactions|post_comments|post_shares)$/;

describe("S6-b hot realtime bindings", () => {
  const hot = scan("src").subscriptions.filter((s: { table: string | null }) => s.table && HOT.test(s.table));

  it("the scan sees the feed's hot bindings (not vacuous)", () => {
    expect(hot.length).toBeGreaterThan(0);
  });

  it("every hot binding is filtered and none is a DELETE", () => {
    const bad = hot
      .filter((s: { filter: string | null; event: string | null }) => !s.filter || s.event === "DELETE" || s.event === "*")
      .map((s: { file: string; line: number; table: string; event: string | null }) => `${s.file}:${s.line} ${s.table} ${s.event}`);
    expect(bad).toEqual([]);
  });
});
