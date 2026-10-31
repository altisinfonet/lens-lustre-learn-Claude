/**
 * P4 — the guard that keeps site_settings reads keyed.
 *
 * `scripts/web-site-settings-guard.mjs` is the CI check (d2-site-settings-guard.yml)
 * behind P4's design proof under R-82: the client never reads the whole
 * configuration table; that read happens once, at the edge. These tests pin
 * three things:
 *   1. every planted violating shape is caught, every legitimate neighbour is not
 *      (the same table the CLI's --self-test runs, so the two cannot drift);
 *   2. the real src/ tree reads clean today;
 *   3. removing the key filter from a REAL call site turns it red — the guard is
 *      shown failing on the code it protects, not only on toy strings (C-34).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scan, scanText, selfTest, SELF_TEST } from "../../scripts/web-site-settings-guard.mjs";

type V = { file: string; line: number; rule: string; text: string };

describe("site_settings guard — shapes", () => {
  it("classifies every self-test shape correctly", () => {
    expect(selfTest()).toEqual([]);
    expect(SELF_TEST.length).toBeGreaterThanOrEqual(10);
  });

  it.each((SELF_TEST as { name: string; must: string | null; src: string }[]).map((c) => [c.name, c]))(
    "%s",
    (_n, c) => {
      const rules = (scanText(c.src, "t.ts") as V[]).map((v) => v.rule);
      expect(rules).toEqual(c.must === null ? [] : [c.must]);
    },
  );

  it("parses .tsx with JSX around the call", () => {
    const src = `export const X = () => { void supabase.from("site_settings").select("*"); return <div a="1" />; };`;
    expect((scanText(src, "x.tsx") as V[]).map((v) => v.rule)).toEqual(["unfiltered-read"]);
  });
});

describe("site_settings guard — the real tree", () => {
  it("src/ has zero unfiltered site_settings reads", () => {
    const r = scan("src") as { files: number; fromCalls: number; violations: V[] };
    expect(r.violations).toEqual([]);
    // A scan that found nothing because it read nothing would also be "clean".
    expect(r.files).toBeGreaterThan(100);
    expect(r.fromCalls).toBeGreaterThan(20);
  });

  it("goes red when a real call site loses its key filter (fail-first on real code)", () => {
    const path = "src/components/SiteFooter.tsx";
    const real = readFileSync(path, "utf8");
    expect(scanText(real, path)).toEqual([]);
    const mutated = real.replace(/\.eq\("key",\s*"managed_pages"\)/, "");
    expect(mutated).not.toBe(real);
    const v = scanText(mutated, path) as V[];
    expect(v.map((x) => x.rule)).toEqual(["unfiltered-read"]);
  });

  it("goes red when the batched cache's keyed fallback loses its .in(\"key\")", () => {
    const path = "src/lib/siteSettingsCache.ts";
    const real = readFileSync(path, "utf8");
    expect(scanText(real, path)).toEqual([]);
    const mutated = real.replace(/\.in\("key",\s*keys\)/, "");
    expect(mutated).not.toBe(real);
    expect((scanText(mutated, path) as V[]).map((x) => x.rule)).toEqual(["unfiltered-read"]);
  });
});
