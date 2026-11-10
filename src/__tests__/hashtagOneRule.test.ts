/**
 * H1 RATCHET — ONE HASHTAG RULE (Owner plan 2026-11-09, central control).
 *
 * What a hashtag is lives in public.extract_hashtags (migration 20261112_0100).
 * The client (src/lib/hashtags/hashtagRule.ts) and the edge functions
 * (supabase/functions/_shared/hashtagRule.ts) carry the same letter class.
 * Before H1 there were four hand-written patterns (#(\w+), [A-Za-z0-9_] twice,
 * a regex in the SQL) and the hashtag page searched captions with ilike, so
 * #land returned #landscape and #পাহাড় was not a tag anywhere.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HASHTAG_CHAR_CLASS, extractHashtags, isHashtagChar, hashtagPath } from "@/lib/hashtags/hashtagRule";
import { HASHTAG_CHAR_CLASS as DENO_CLASS } from "../../supabase/functions/_shared/hashtagRule";

const MIGRATION = "supabase/migrations/20261112_0100_h1_hashtag_page.sql";
const sql = readFileSync(MIGRATION, "utf8");

// Every app and edge source file, as text (tests themselves excluded). Listed by
// Vite rather than a directory walk, so this never reads the migrations folder.
const SOURCES: Record<string, string> = {
  ...import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/__tests__/**"], { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob(["/supabase/functions/**/*.ts", "!/supabase/functions/**/__tests__/**"], { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

describe("one hashtag rule — the same letters in the database, the app and the edge", () => {
  // SQL writes À; a TS file may hold the escape or the character itself.
  const decode = (s: string) => s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  it("the migration names the class once in its header and uses exactly it in the parser and the CHECK", () => {
    const declared = sql.match(/^-- HASHTAG_CHAR_CLASS = (\S+)\r?$/m)?.[1] ?? "";
    expect(decode(declared)).toBe(decode(HASHTAG_CHAR_CLASS));
    // extract_hashtags + hashtags_tag_shape
    expect(sql.split(`[${declared}]`).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("the edge copy equals the app copy", () => {
    expect(decode(DENO_CLASS)).toBe(decode(HASHTAG_CHAR_CLASS));
  });

  it("no other hand-written hashtag pattern exists in src/ or the edge functions", () => {
    const allowed = new Set(["/src/lib/hashtags/hashtagRule.ts", "/supabase/functions/_shared/hashtagRule.ts"]);
    const files = Object.keys(SOURCES);
    expect(files.length).toBeGreaterThan(200); // the glob really listed the tree
    const offenders = files.filter((f) => !allowed.has(f)
      && /#\(\\w|#\(\[A-Za-z0-9_\]|#\[A-Za-z0-9_\]|ilike\([^)]*#/.test(SOURCES[f]));
    expect(offenders).toEqual([]);
  });

  it("H4: the sitemap lists hashtag pages with public posts, at the encoded address the app links", () => {
    const sitemap = SOURCES["/supabase/functions/sitemap/index.ts"];
    expect(sitemap).toMatch(/\.from\("hashtags"\)[\s\S]{0,200}\.gt\("post_count", 0\)/);
    expect(sitemap).toMatch(/\/hashtag\/\$\{encodeURIComponent\(t\.tag\)\}/);
  });

  it("the hashtag page reads the store, never a caption search", () => {
    const page = readFileSync("src/pages/HashtagFeed.tsx", "utf8");
    expect(page).toMatch(/useHashtagPosts\(/);
    expect(page).not.toMatch(/ilike|fetchHashtagPosts/);
    const hook = readFileSync("src/hooks/feed/useHashtagPage.ts", "utf8");
    expect(hook).toMatch(/"hashtag_page_posts"/);
    expect(hook).toMatch(/enrichPostRows\(/);
  });
});

describe("what counts as a tag (mirrors the migration's POST checks)", () => {
  it("every language, first-seen order, one per word, punctuation and the danda end a tag", () => {
    expect(extractHashtags("Hills #পাহাড় then #Land, #landscape #land। and #पहाड़!")).toEqual([
      "পাহাড়", "Land", "landscape", "पहाड़",
    ]);
  });

  it("#land is not #landscape", () => {
    expect(extractHashtags("#landscape")).toEqual(["landscape"]);
    expect(extractHashtags("#land")).toEqual(["land"]);
  });

  it("keeps at most 30 distinct tags", () => {
    const caption = Array.from({ length: 40 }, (_, i) => `#t${i + 1}`).join(" ");
    expect(extractHashtags(caption)).toHaveLength(30);
  });

  it("letters yes; spaces, punctuation and emoji no", () => {
    // one code point each (ড় = Bengali ড় precomposed, ় = its nukta)
    for (const ch of ["a", "Z", "7", "_", "é", "প", "া", "ড়", "়", "ह", "ж", "ع", "中", "‍"]) expect(isHashtagChar(ch), ch).toBe(true);
    for (const ch of [" ", "#", ".", ",", "!", "-", "।", "॥", "،", "😀", "\n"]) expect(isHashtagChar(ch), JSON.stringify(ch)).toBe(false);
  });

  it("the page address keeps the tag readable to the router", () => {
    expect(hashtagPath("street")).toBe("/hashtag/street");
    expect(decodeURIComponent(hashtagPath("#পাহাড়"))).toBe("/hashtag/পাহাড়");
  });
});
