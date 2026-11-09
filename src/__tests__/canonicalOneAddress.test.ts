/**
 * ONE ADDRESS (Owner 2026-11-09, SEO plan A2). Every canonical URL, sitemap URL,
 * JSON-LD url and share link names the address the site is served from —
 * https://www.50mmretina.com on production — never the bare apex and never the
 * admin-editable seo_global.canonical_base. Two copies of the rule exist (Pages
 * runtime and Deno runtime); this test holds them equal and stops a bypass.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalOf as pagesRule } from "../../functions/_seo";
import { canonicalOf as denoRule } from "../../supabase/functions/_shared/laneConfig";

const ROOT = join(__dirname, "../..");
const CASES: Array<[string, string]> = [
  ["https://50mmretina.com", "https://www.50mmretina.com"],
  ["https://50mmretina.com/", "https://www.50mmretina.com"],
  ["https://www.50mmretina.com", "https://www.50mmretina.com"],
  ["https://staging.50mmretina.com", "https://staging.50mmretina.com"],
  ["https://example-lane.pages.dev", "https://example-lane.pages.dev"],
];

describe("one address — the canonical rule", () => {
  it.each(CASES)("%s → %s in both runtimes", (input, want) => {
    expect(pagesRule(input)).toBe(want);
    expect(denoRule(input)).toBe(want);
  });
});

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe("one address — no second source of truth", () => {
  const all = [...files(join(ROOT, "src")), ...files(join(ROOT, "functions")), ...files(join(ROOT, "supabase/functions"))];

  it("nothing builds a URL from seo_global.canonical_base", () => {
    const hits = all.filter((f) => /canonical_base\s*\}|canonical_base\s*\?\s*`|canonical_base\s*\|\|/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it.each(["src/components/PageSEO.tsx", "src/hooks/core/useSEO.ts", "src/lib/publicUrl.ts", "src/components/admin/AdminSEO.tsx"])(
    "%s uses the served origin, not the printed apex",
    (f) => {
      expect(readFileSync(join(ROOT, f), "utf8")).not.toMatch(/SITE_DISPLAY_ORIGIN/);
    },
  );

  it.each(["supabase/functions/seo-route-metadata/index.ts", "supabase/functions/sitemap/index.ts"])(
    "%s names canonicalOrigin(), not siteOrigin()",
    (f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toMatch(/canonicalOrigin\(\)/);
      expect(src).not.toMatch(/\bsiteOrigin\(\)/);
    },
  );
});
