/**
 * The category taxonomy — drift tests.
 *
 * The database is the single source of truth for the 46 categories, but two
 * things about them cannot live in a row: the lucide icon COMPONENT, and the
 * translated display names. Both live in TypeScript. So there are two lists,
 * and two lists always drift.
 *
 * These tests read the seed block out of the migration itself and check the
 * TypeScript against it. That is the same trick the repo already uses to stop
 * `docs/error-codes.md` drifting from `errorCodes.ts` — the generated artefact
 * and its source are compared in CI rather than trusted.
 *
 * The failure these prevent is quiet: an admin adds a category, or someone
 * renames an icon, and one chip in the strip silently renders a fallback
 * camera or an untranslated English word — on a Tamil member's screen, which
 * nobody testing in English would ever see.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CATEGORY_ICONS,
  ALL_FILTER,
  MIN_POST_CATEGORIES,
  MAX_POST_CATEGORIES,
  categoryIcon,
  categoryLabelKey,
  normaliseInterests,
  toCategorySlug,
  legacyLabelForSlug,
} from "@/lib/categories";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const MIGRATION = "supabase/migrations/20260812040000_category_taxonomy.sql";

/** The seeded rows, parsed straight out of the migration's INSERT. */
const seeded = (() => {
  const sql = read(MIGRATION);
  const start = sql.indexOf("INSERT INTO public.categories (slug, name, icon_name, sort_order) VALUES");
  const end = sql.indexOf("ON CONFLICT (slug) DO NOTHING;", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const rows = [...sql.slice(start, end).matchAll(
    /\(\s*'([^']+)'\s*,\s*'((?:[^']|'')+)'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*\)/g,
  )];
  return rows.map((m) => ({
    slug: m[1],
    name: m[2].replace(/''/g, "'"),
    icon: m[3],
    sort: Number(m[4]),
  }));
})();

describe("the migration seeds exactly the approved taxonomy", () => {
  it("has 46 categories — not 47", () => {
    // Owner, 2026-08-12: "we have 46 master photography categories. `All` is
    // not a category; it is the default system filter."
    expect(seeded).toHaveLength(46);
  });

  it("does NOT contain an 'all' row", () => {
    // If "All" ever became a row it would be selectable as a category, and a
    // post could be filed under it — which would quietly break the one rule
    // that keeps existing uncategorised posts visible.
    expect(seeded.some((c) => c.slug === "all")).toBe(false);
    expect(seeded.some((c) => c.name.toLowerCase() === "all")).toBe(false);
  });

  it("uses lower-case kebab slugs only", () => {
    for (const c of seeded) {
      expect(c.slug, `slug "${c.slug}"`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("has unique slugs and unique sort_order 1..46", () => {
    expect(new Set(seeded.map((c) => c.slug)).size).toBe(46);
    expect([...seeded.map((c) => c.sort)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 46 }, (_, i) => i + 1),
    );
  });

  it("puts the owner's seven design-mock categories first, in his order", () => {
    expect(seeded.filter((c) => c.sort <= 7).sort((a, b) => a.sort - b.sort).map((c) => c.slug))
      .toEqual(["wildlife", "portrait", "street", "landscape", "macro", "travel", "aerial"]);
  });
});

describe("every seeded icon exists in the TypeScript allow-list", () => {
  it("no category falls back to the placeholder camera", () => {
    // categoryIcon() falls back rather than throwing, so a missing icon would
    // never crash — it would just quietly show the wrong picture forever.
    const missing = seeded.filter((c) => !CATEGORY_ICONS[c.icon]).map((c) => `${c.slug}=${c.icon}`);
    expect(missing, `icon names absent from CATEGORY_ICONS: ${missing.join(", ")}`).toEqual([]);
  });

  it("resolves a real component for all 46", () => {
    for (const c of seeded) expect(typeof categoryIcon(c.icon)).not.toBe("undefined");
  });

  it("falls back to a component for an unknown or empty icon name", () => {
    expect(categoryIcon("NoSuchIcon")).toBeTruthy();
    expect(categoryIcon(null)).toBeTruthy();
    expect(categoryIcon(undefined)).toBeTruthy();
  });

  it("the allow-list carries no icon the taxonomy does not use, except the All camera", () => {
    // Dead entries are bundle weight for nothing.
    const used = new Set(seeded.map((c) => c.icon));
    const unused = Object.keys(CATEGORY_ICONS).filter((n) => !used.has(n) && n !== "Camera");
    expect(unused, `unused icons in CATEGORY_ICONS: ${unused.join(", ")}`).toEqual([]);
  });
});

describe("every seeded category has a translation in all 7 locales", () => {
  const en = read("src/i18n/translations.ts");
  const rest = read("src/i18n/translations.rest.ts");

  it("English", () => {
    const missing = seeded.filter((c) => !en.includes(`"cat.${c.slug}"`)).map((c) => c.slug);
    expect(missing, `missing en keys: ${missing.join(", ")}`).toEqual([]);
  });

  for (const lang of ["hi", "bn", "mr", "gu", "ta", "te"]) {
    it(lang, () => {
      // Each dictionary is its own object literal in the same file, so the key
      // has to be counted per block, not once for the file.
      const start = rest.indexOf(`const ${lang}: Dict = {`);
      expect(start, `${lang} dictionary not found`).toBeGreaterThan(-1);
      const nextDecl = rest.indexOf("\nconst ", start + 1);
      const block = rest.slice(start, nextDecl === -1 ? rest.length : nextDecl);
      const missing = seeded.filter((c) => !block.includes(`"cat.${c.slug}"`)).map((c) => c.slug);
      expect(missing, `missing ${lang} keys: ${missing.join(", ")}`).toEqual([]);
    });
  }

  it("no translation is left as the raw English name for an Indic locale", () => {
    // A copy-paste that forgot to translate is invisible to an English reader.
    // Latin-script terms that are genuinely used as-is are allowed through.
    const ALLOWED_LATIN = new Set(["mobile", "film", "macro", "fashion"]);
    const start = rest.indexOf("const hi: Dict = {");
    const block = rest.slice(start, rest.indexOf("\nconst ", start + 1));
    const untranslated = seeded.filter((c) => {
      if (ALLOWED_LATIN.has(c.slug)) return false;
      const m = block.match(new RegExp(`"cat\\.${c.slug}":\\s*"([^"]*)"`));
      return m ? m[1] === c.name : false;
    }).map((c) => c.slug);
    expect(untranslated, `hi values identical to English: ${untranslated.join(", ")}`).toEqual([]);
  });
});

describe("the legacy label fallback", () => {
  // Until 2026-08-12 profiles.photography_interests held English labels. These
  // are the exact fifteen that were live, read from the production database on
  // the day — not guessed.
  const LIVE_ON_2026_08_12 = [
    "Street", "Travel", "Portrait", "Landscape", "Documentary", "Wildlife",
    "Abstract", "Architecture", "Fashion", "Macro", "Sports",
    "Astrophotography", "Aerial", "Underwater", "Food",
  ];

  it("maps every label that was actually in production", () => {
    const unmapped = LIVE_ON_2026_08_12.filter((l) => !toCategorySlug(l));
    expect(unmapped, `would be dropped: ${unmapped.join(", ")}`).toEqual([]);
  });

  it("maps all fifteen onto slugs that exist in the taxonomy", () => {
    const slugs = new Set(seeded.map((c) => c.slug));
    const orphans = LIVE_ON_2026_08_12
      .map((l) => toCategorySlug(l))
      .filter((s): s is string => !!s && !slugs.has(s));
    expect(orphans).toEqual([]);
  });

  it("maps Astrophotography to astro — the one that is not a lower-casing", () => {
    expect(toCategorySlug("Astrophotography")).toBe("astro");
    expect(toCategorySlug("astrophotography")).toBe("astro");
    expect(legacyLabelForSlug("astro")).toBe("Astrophotography");
  });

  it("passes slugs through unchanged, so a migrated row is untouched", () => {
    expect(normaliseInterests(["wildlife", "astro", "black-and-white"]))
      .toEqual(["wildlife", "astro", "black-and-white"]);
  });

  it("accepts a MIXED array — the state during the migration window", () => {
    expect(normaliseInterests(["Wildlife", "astro", "Street"]))
      .toEqual(["wildlife", "astro", "street"]);
  });

  it("de-duplicates when a label and its slug both appear", () => {
    expect(normaliseInterests(["Astrophotography", "astro"])).toEqual(["astro"]);
  });

  it("drops values it cannot recognise instead of inventing a category", () => {
    expect(normaliseInterests(["Wildlife", "Not A Category"])).toEqual(["wildlife"]);
    expect(toCategorySlug("Not A Category")).toBeNull();
    expect(toCategorySlug("")).toBeNull();
  });

  it("survives null and undefined", () => {
    expect(normaliseInterests(null)).toEqual([]);
    expect(normaliseInterests(undefined)).toEqual([]);
  });

  it("returns no legacy label for a category that never had one", () => {
    expect(legacyLabelForSlug("black-and-white")).toBeNull();
    expect(legacyLabelForSlug("equine")).toBeNull();
  });
});

describe("the triplicated hard-coded list is gone", () => {
  it("no surface carries its own copy of the categories any more", () => {
    for (const p of [
      "src/components/OnboardingModal.tsx",
      "src/pages/EditProfile.tsx",
      "src/pages/Discover.tsx",
    ]) {
      const src = read(p);
      expect(src, `${p} still declares INTEREST_OPTIONS`).not.toContain("INTEREST_OPTIONS");
      expect(src, `${p} does not read the taxonomy`).toContain("useCategories");
    }
  });

  it("all three read stored interests through the legacy fallback or the taxonomy", () => {
    expect(read("src/components/OnboardingModal.tsx")).toContain("normaliseInterests");
    expect(read("src/pages/EditProfile.tsx")).toContain("normaliseInterests");
    // Discover holds no stored value — it queries — so it needs the reverse map.
    expect(read("src/pages/Discover.tsx")).toContain("legacyLabelForSlug");
  });

  it("Discover queries BOTH shapes so the filter works either side of the migration", () => {
    const src = read("src/pages/Discover.tsx");
    expect(src).toContain("withLegacy");
    expect(src).toContain('query.overlaps("photography_interests", withLegacy)');
  });
});

describe("constants", () => {
  it("All is a system filter, never a stored slug", () => {
    expect(ALL_FILTER).toBe("all");
    expect(seeded.some((c) => c.slug === ALL_FILTER)).toBe(false);
  });

  it("a post takes 1 to 5 categories", () => {
    expect(MIN_POST_CATEGORIES).toBe(1);
    expect(MAX_POST_CATEGORIES).toBe(5);
  });

  it("builds the label key from the slug", () => {
    expect(categoryLabelKey("black-and-white")).toBe("cat.black-and-white");
  });
});
