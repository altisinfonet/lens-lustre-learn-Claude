import { describe, it, expect } from "vitest";
import { supabaseUrl, supabaseAnon, site } from "../../functions/_seo";

/**
 * G5b — functions/_seo.ts must have NO production defaults.
 *
 * Until 2026-08-23 these three read production values whenever the Pages
 * environment did not define them. Pages Functions have no build step, so a
 * lane that forgot to set them silently became production — and emitted
 * production canonical URLs into that lane's crawlable HTML, which is the one
 * place a wrong origin is expensive because search engines keep it.
 *
 * "Unset" must therefore be a loud failure, not a quiet fallback. These tests
 * pin that, so restoring a default breaks the suite rather than the lane.
 */
const READERS: Array<[string, (env: any) => string, string]> = [
  ["supabaseUrl", supabaseUrl, "SUPABASE_PROJECT_REF"],
  ["supabaseAnon", supabaseAnon, "SUPABASE_ANON_KEY"],
  ["site", site, "SITE_ORIGIN"],
];

describe("functions/_seo.ts — lane values are required, never defaulted", () => {
  it.each(READERS)("%s throws when the whole env is undefined", (_n, read, varName) => {
    expect(() => read(undefined)).toThrow(new RegExp(`${varName} is not set`));
  });

  it.each(READERS)("%s throws when its variable is absent from a present env", (_n, read, varName) => {
    expect(() => read({})).toThrow(new RegExp(`${varName} is not set`));
  });

  it.each(READERS)("%s throws when set-but-empty (a config error, not a default)", (_n, read, varName) => {
    expect(() => read({ [varName]: "" })).toThrow(new RegExp(`${varName} is set but empty`));
    expect(() => read({ [varName]: "   " })).toThrow(new RegExp(`${varName} is set but empty`));
  });

  it("never emits a production value when the lane supplies its own", () => {
    const env = {
      SUPABASE_PROJECT_REF: "stgabcdefghijklmnopq",
      SUPABASE_ANON_KEY: "staging-anon-key",
      SITE_ORIGIN: "https://staging.50mmretina.com/",
    };
    expect(supabaseUrl(env)).toBe("https://stgabcdefghijklmnopq.supabase.co");
    expect(supabaseAnon(env)).toBe("staging-anon-key");
    expect(site(env)).toBe("https://staging.50mmretina.com"); // trailing slash stripped
    for (const v of [supabaseUrl(env), supabaseAnon(env), site(env)]) {
      expect(v).not.toContain("jtdtehuqtinjxropkkcn");
      expect(v).not.toContain("[www.50mmretina.com](https://www.50mmretina.com)");
    }
  });

  it("the source file itself carries no production literal", async () => {
    // Read via cwd, not import.meta.url: the test environment does not
    // guarantee a file: URL, and this assertion must not depend on that.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "functions", "_seo.ts"), "utf8");
    expect(src).not.toContain("jtdtehuqtinjxropkkcn");
    expect(src).not.toContain("[www.50mmretina.com](https://www.50mmretina.com)");
    expect(src).not.toMatch(/eyJhbGciOi/); // no baked JWT
  });
});
