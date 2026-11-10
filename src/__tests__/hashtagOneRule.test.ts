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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HASHTAG_CHAR_CLASS, extractHashtags, isHashtagChar, hashtagPath } from "@/lib/hashtags/hashtagRule";
import { HASHTAG_CHAR_CLASS as DENO_CLASS } from "../../supabase/functions/_shared/hashtagRule";

const MIGRATION = "supabase/migrations/20261112_0100_h1_hashtag_page.sql";
const sql = readFileSync(MIGRATION, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules" && name !== "__tests__") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

describe("one hashtag rule — the same letters in the database, the app and the edge", () => {
  it("the migration names the class once in its header and uses exactly it in the parser and the CHECK", () => {
    const declared = sql.match(/^-- HASHTAG_CHAR_CLASS = (\S+)$/m)?.[1];
    expect(declared).toBe(HASHTAG_CHAR_CLASS);
    // extract_hashtags + hashtags_tag_shape
    expect(sql.split(`[${HASHTAG_CHAR_CLASS}]`).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("the edge copy equals the app copy", () => {
    expect(DENO_CLASS).toBe(HASHTAG_CHAR_CLASS);
  });

  it("no other hand-written hashtag pattern exists in src/ or the edge functions", () => {
    const allowed = new Set(["src/lib/hashtags/hashtagRule.ts", "supabase/functions/_shared/hashtagRule.ts"]);
    const offenders: string[] = [];
    for (const f of [...walk("src"), ...walk("supabase/functions")]) {
      if (allowed.has(f)) continue;
      const s = readFileSync(f, "utf8");
      if (/#\(\\w|#\(\[A-Za-z0-9_\]|#\[A-Za-z0-9_\]|ilike\([^)]*#/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
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
    for (const ch of ["a", "Z", "7", "_", "é", "প", "া", "ড়", "ह", "ж", "ع", "中", "‍"]) expect(isHashtagChar(ch), ch).toBe(true);
    for (const ch of [" ", "#", ".", ",", "!", "-", "।", "॥", "،", "😀", "\n"]) expect(isHashtagChar(ch), JSON.stringify(ch)).toBe(false);
  });

  it("the page address keeps the tag readable to the router", () => {
    expect(hashtagPath("street")).toBe("/hashtag/street");
    expect(decodeURIComponent(hashtagPath("#পাহাড়"))).toBe("/hashtag/পাহাড়");
  });
});
