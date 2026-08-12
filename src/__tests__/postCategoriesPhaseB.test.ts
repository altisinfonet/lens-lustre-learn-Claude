/**
 * Phase B — categories on posts, and a category-aware feed. CLIENT SIDE.
 *
 * The database half of Phase B is proved against a real PostgreSQL 16 in the
 * migration harness. This file covers the four things that live in TypeScript
 * and that a database test can never see:
 *
 *   1. THE CACHE KEY. `["feed"]` became `["feed", cats]`. That one change makes
 *      every exact-key `setQueryData` in the codebase a silent no-op on any
 *      category tab. Nothing errors. The feed just stops reacting.
 *
 *   2. THE FAN-OUT. A like, a delete, a realtime arrival has to reach every
 *      cached variant, not only the one the member is looking at.
 *
 *   3. THE INSERT PATHS. Four places create a post. Three of them have no human
 *      choosing a category, and each one that still goes straight to
 *      `.from("posts").insert(...)` is a feature that breaks the day the
 *      migration lands — a broken album upload, a missing profile-photo
 *      announcement, a scheduled post that never publishes.
 *
 *   4. THE SQL ITSELF, read as text. The filter must appear exactly once and
 *      inside `visible`; the ordering CTEs must be untouched. A test can assert
 *      that without a database.
 *
 * These are all source-level or cache-level assertions on purpose: they fail in
 * CI on a laptop, before anything reaches the live site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queryKeys";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * The same file with its comments removed.
 *
 * Every one of these source assertions is about what the code DOES. The
 * comments in these files quote the very patterns being banned — the note in
 * profilePostHelper.ts explains why a direct `.from("posts").insert(...)` is
 * wrong by naming it. Matching raw text would fail on the explanation rather
 * than on the code, and the obvious "fix" would be to delete the explanation.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const MIGRATION = "supabase/migrations/20260812070000_post_categories.sql";

/* ══════════════════════════════════════════════════════════════════════════
 * 1. THE CACHE KEY
 * ═══════════════════════════════════════════════════════════════════════ */
describe("the feed cache key", () => {
  it("is ['feed', null] for All — no categories, no selection, empty selection", () => {
    expect(queryKeys.feed()).toEqual(["feed", null]);
    expect(queryKeys.feed(null)).toEqual(["feed", null]);
    expect(queryKeys.feed([])).toEqual(["feed", null]);
  });

  it("carries the selected slugs", () => {
    expect(queryKeys.feed(["portrait"])).toEqual(["feed", ["portrait"]]);
  });

  it("sorts, so the same selection is never cached twice", () => {
    // Tapping Portrait then Street, versus Street then Portrait, is the same
    // feed. Without the sort it would be two cache entries, two fetches, and
    // two chances for them to disagree.
    expect(queryKeys.feed(["street", "portrait"]))
      .toEqual(queryKeys.feed(["portrait", "street"]));
  });

  it("does not mutate the caller's array while sorting", () => {
    const chosen = ["street", "portrait"];
    queryKeys.feed(chosen);
    expect(chosen, "the selection state was sorted in place").toEqual(["street", "portrait"]);
  });

  it("keeps 'feed' as the first element, so prefix invalidation still matches", () => {
    // This is what lets every existing invalidateQueries keep working.
    for (const k of [queryKeys.feed(), queryKeys.feed(["macro"]), queryKeys.feed(["a", "b"])]) {
      expect(k[0]).toBe("feed");
    }
    expect(queryKeys.feedAll()).toEqual(["feed"]);
  });

  it("feedAll() actually matches every variant in a real QueryClient", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.feed(), { pages: [] });
    qc.setQueryData(queryKeys.feed(["portrait"]), { pages: [] });
    qc.setQueryData(queryKeys.feed(["landscape", "macro"]), { pages: [] });

    const matched = qc.getQueryCache().findAll({ queryKey: queryKeys.feedAll() });
    expect(matched).toHaveLength(3);

    // And the old exact key reaches exactly one of them — which is the whole
    // reason the writers had to be changed.
    const exact = qc.getQueryCache().findAll({ queryKey: queryKeys.feed(), exact: true });
    expect(exact).toHaveLength(1);
    qc.clear();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. THE FAN-OUT
 * ═══════════════════════════════════════════════════════════════════════ */
describe("every feed cache writer fans out across variants", () => {
  const updaters = read("src/hooks/feed/useFeedCacheUpdaters.ts");

  it("no writer holds a single exact key any more", () => {
    // The bug this replaces: `const key = queryKeys.feed()` at the top of the
    // hook, used by five updaters. Every one of them would have written to the
    // All cache only.
    expect(updaters).not.toMatch(/const\s+key\s*=\s*queryKeys\.feed\(/);
  });

  it("enqueue() and mapPosts() both walk the cache by prefix", () => {
    const occurrences = updaters.match(/getQueryCache\(\)\.findAll\(\{\s*queryKey:\s*feedPrefix/g);
    expect(occurrences, "expected both the batched path and the optimistic path")
      .toHaveLength(2);
    expect(updaters).toContain("queryKeys.feedAll()");
  });

  it("insertPost is the only updater that is narrowed to matching variants", () => {
    // A removal or a counter change applies everywhere. An ARRIVAL does not:
    // a Landscape post must not pop into the Portrait feed.
    expect(updaters).toContain("belongsIn(post, cats)");
    // The other four pass no predicate, so they reach every variant.
    for (const fn of ["replacePost", "patchPost", "removePost"]) {
      expect(updaters, `${fn} should not be narrowed`).toContain(`const ${fn} = useCallback(`);
    }
  });

  it("'All' takes every post, including one with no categories at all", () => {
    // Mirrors `_categories IS NULL` in the RPC. This is the rule that keeps the
    // 204 pre-existing posts visible.
    const belongsIn = (own: string[] | undefined, cats: string[] | null): boolean => {
      if (!cats || cats.length === 0) return true;
      return (own ?? []).some((c) => cats.includes(c));
    };
    expect(belongsIn(undefined, null)).toBe(true);
    expect(belongsIn([], null)).toBe(true);
    expect(belongsIn(["portrait"], null)).toBe(true);

    // and the overlap rule itself — the client mirror of `&&`
    expect(belongsIn(["portrait"], ["portrait"])).toBe(true);
    expect(belongsIn(["portrait", "macro"], ["macro", "street"])).toBe(true);
    expect(belongsIn(["portrait"], ["landscape"])).toBe(false);
    expect(belongsIn([], ["landscape"])).toBe(false);
    expect(belongsIn(undefined, ["landscape"])).toBe(false);
  });

  it("no surface writes to a bare ['feed'] literal instead of the registry", () => {
    for (const p of [
      "src/hooks/feed/useFeedCacheUpdaters.ts",
      "src/components/WallPosts.tsx",
      "src/components/post/PostCard.tsx",
      "src/pages/MyPhotos.tsx",
    ]) {
      expect(code(p), `${p} hand-rolls a feed key`).not.toMatch(/queryKey:\s*\["feed"\]/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. THE INSERT PATHS — all four, audited
 * ═══════════════════════════════════════════════════════════════════════ */
describe("every path that creates a post", () => {
  it("there are exactly two direct inserts into posts left, and no more", () => {
    // If a fifth appears, it is a path nobody has thought about w.r.t.
    // categories — which means it either breaks or quietly writes a member post
    // with none. Failing here is cheaper than finding out in production.
    const sources = [
      "src/components/WallPosts.tsx",
      "src/lib/profilePostHelper.ts",
      "src/pages/MyPhotos.tsx",
      "supabase/functions/publish-scheduled-posts/index.ts",
    ];
    const withDirectInsert = sources.filter((p) =>
      /\.from\(\s*["']posts["']\s*\)\s*[\s\S]{0,80}?\.insert\(/.test(code(p)),
    );
    expect(withDirectInsert.sort()).toEqual([
      // the member's own composer — Phase C adds the picker here
      "src/components/WallPosts.tsx",
      // service_role, carries the categories chosen at compose time
      "supabase/functions/publish-scheduled-posts/index.ts",
    ]);
  });

  it("the album auto-post goes through create_system_post()", () => {
    const src = code("src/pages/MyPhotos.tsx");
    expect(src).toContain('"create_system_post"');
    expect(src, "still inserts directly, which POST-CAT-002 would refuse")
      .not.toMatch(/from\("posts"\)\.insert/);
  });

  it("the profile/cover-photo announcement goes through create_system_post()", () => {
    const src = code("src/lib/profilePostHelper.ts");
    expect(src).toContain('"create_system_post"');
    expect(src).not.toMatch(/from\("posts"\)\.insert/);
  });

  it("neither system path sends post_kind or categories — there is nothing to forge", () => {
    // create_system_post takes four parameters and none of them is post_kind.
    for (const p of ["src/pages/MyPhotos.tsx", "src/lib/profilePostHelper.ts"]) {
      const src = code(p);
      expect(src, `${p} sends post_kind`).not.toContain("_post_kind");
      expect(src, `${p} sends categories`).not.toContain("_categories");
    }
  });

  it("the scheduled path carries categories from compose time to publish time", () => {
    const hook = read("src/hooks/feed/useScheduledPosts.ts");
    expect(hook, "compose does not store the choice").toContain("categories: input.categories ?? []");
    expect(hook).toMatch(/categories\??:\s*string\[\]/);

    const fn = read("supabase/functions/publish-scheduled-posts/index.ts");
    expect(fn, "publisher does not copy the choice onto the post")
      .toContain("categories: row.categories ?? []");
    expect(fn, "a category rejection is not distinguishable in the failure reason")
      .toContain("categories_rejected");
  });

  it("the scheduled publisher is NOT a system-post path", () => {
    // A scheduled post is a member post that publishes later. Routing it
    // through create_system_post would strip the member's own category choice.
    expect(read("supabase/functions/publish-scheduled-posts/index.ts"))
      .not.toContain("create_system_post");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. THE MIGRATION, READ AS TEXT
 * ═══════════════════════════════════════════════════════════════════════ */
describe("the Phase B migration keeps the feed's fairness logic untouched", () => {
  const sql = read(MIGRATION);

  it("adds the category predicate in exactly ONE place", () => {
    const hits = sql.match(/_categories IS NULL OR p\.categories && _categories/g) ?? [];
    expect(hits, "the filter is duplicated, so the two copies can drift").toHaveLength(1);
  });

  it("puts it inside the `visible` CTE, above every ranking CTE", () => {
    const at = sql.indexOf("_categories IS NULL OR p.categories && _categories");
    const visibleAt = sql.indexOf("visible AS (");
    for (const cte of ["newest AS (", "unseen_ranked AS (", "seen_ranked AS ("]) {
      const cteAt = sql.indexOf(cte);
      expect(cteAt, `${cte} not found`).toBeGreaterThan(-1);
      expect(at, `the filter leaked into or past ${cte}`).toBeLessThan(cteAt);
    }
    expect(at).toBeGreaterThan(visibleAt);
  });

  it("leaves the three ranking expressions exactly as they were", () => {
    // If any of these three lines changes, reach fairness changed — which is a
    // far bigger deal than a category filter and must never ride along with one.
    expect(sql).toContain("ORDER BY v.created_at DESC, v.id");
    expect(sql).toContain("ORDER BY COALESCE(imp.viewers, 0) + random() * 6.0 ASC");
    expect(sql).toContain(
      "ORDER BY floor(extract(epoch FROM (now() - s.last_seen_at)) / 86400.0) DESC,",
    );
    expect(sql).toContain("ORDER BY x.tier_order ASC, x.rn ASC");
  });

  it("keeps all three RPC signatures, so an installed Android build still works", () => {
    // 2-arg and 3-arg are what shipped apps call. They become wrappers, not
    // casualties.
    expect(sql).toContain("SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, NULL::text[]);");
    expect(sql).toContain("SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, 0, NULL::text[]);");
  });

  it("gives the 4-arg _categories NO default, or a 3-arg call becomes ambiguous", () => {
    const fourArg = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.get_broadcast_feed("),
      sql.indexOf("RETURNS TABLE("),
    );
    expect(fourArg).toContain("_categories   text[]");
    expect(fourArg, "a DEFAULT here breaks every 3-argument caller").not.toMatch(
      /_categories[^,)]*DEFAULT/,
    );
  });

  it("does not touch hashtags or post_tags", () => {
    // Owner, 2026-08-12: "Hashtags are NOT being replaced or changed."
    expect(sql).not.toMatch(/\bpost_tags\b(?![^\n]*(--|untouched|Untouched))/);
    expect(sql).not.toMatch(/ALTER TABLE public\.post_tags/);
    expect(sql).not.toMatch(/DROP .*post_tags/i);
  });

  it("leaves every existing post alone — default '{}', no backfill, no UPDATE", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}'");
    expect(sql, "the migration rewrites existing rows").not.toMatch(
      /UPDATE\s+public\.posts\s+SET/i,
    );
  });

  it("the maximum is a real CHECK; the minimum deliberately is not", () => {
    // A CHECK for the minimum would re-fire on UPDATE and make the 204 legacy
    // posts uneditable — which is why the minimum lives in the trigger, in B2.
    expect(sql).toContain("CHECK (cardinality(categories) <= 5)");
    expect(sql).not.toMatch(/CHECK\s*\(\s*cardinality\(categories\)\s*>=\s*1/);
    expect(sql).toContain("POST-CAT-003");
    // NOT asserted here: `sql.includes("POST-CAT-002")`. It is true, but only
    // because the body quotes the deferred rule in a comment — so it would pass
    // whether the rule were live or not, which makes it worse than no test.
    // The real assertion is in the B1 block below, against executable code.
  });

  it("the enforcement trigger is SECURITY INVOKER — DEFINER made it bypassable", () => {
    const fn = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.enforce_post_categories()"),
      sql.indexOf("DROP TRIGGER IF EXISTS trg_validate_post_categories"),
    );
    expect(fn).toContain("SECURITY INVOKER");
    expect(fn, "DEFINER makes current_user the owner, so the client check never fires")
      .not.toContain("SECURITY DEFINER");
    expect(fn).toContain("current_user IN ('authenticated', 'anon')");
  });

  it("create_system_post is SECURITY DEFINER, takes no post_kind and no categories", () => {
    const fn = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.create_system_post("),
      sql.indexOf("REVOKE ALL ON FUNCTION public.create_system_post"),
    );
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("_uid uuid := auth.uid()");
    expect(fn, "a caller could post as somebody else").not.toMatch(/_user_id\s+uuid/);
    expect(fn, "a caller could choose post_kind").not.toMatch(/_post_kind/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.create_system_post(text, text, text[], text[]) FROM public, anon;");
  });

  it("category order is preserved — a plain DISTINCT silently reshuffled it", () => {
    expect(sql).toContain("WITH ORDINALITY");
    expect(sql).toContain("DISTINCT ON (lower(btrim(u.c)))");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. THE B1 / B2 SPLIT
 *
 * Owner's ruling, 2026-08-12: a staged rollout rather than ship-together or
 * permanently weakening the rule.
 *
 *   B1 → foundation, no minimum, safe to apply today
 *   C  → Create UI, mandatory 1-5 in the client
 *   B2 → activate the minimum in the database
 *   D  → category strip
 *
 * The danger the split creates is DRIFT: B2 re-creates the whole enforcement
 * function, because PL/pgSQL cannot patch a body. So it would be very easy for
 * an unrelated change to ride along inside B2 and reach production disguised as
 * "just turning the rule on". These tests exist to make that impossible.
 * ═══════════════════════════════════════════════════════════════════════ */
const B2 = "supabase/migrations/20260812090000_post_categories_enforce_minimum.sql";

/** A PL/pgSQL body with line comments stripped and whitespace flattened. */
const bodyOf = (sqlText: string) => {
  const start = sqlText.indexOf("CREATE OR REPLACE FUNCTION public.enforce_post_categories()");
  const end = sqlText.indexOf("$fn$;", start);
  expect(start, "enforce_post_categories() not found").toBeGreaterThan(-1);
  expect(end, "function body not terminated").toBeGreaterThan(start);
  return sqlText
    .slice(start, end)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

describe("B1 is safe to apply on its own", () => {
  const sql = read(MIGRATION);

  it("does NOT enforce the minimum — the whole reason B1 exists", () => {
    // The body QUOTES the deferred rule in a comment so the next reader knows
    // where it went, so this must look at executable code only. The migration's
    // own self-check made exactly this mistake on its first run and reported
    // the rule as active when it was not.
    expect(bodyOf(sql), "POST-CAT-002 is live in B1 — applying it would stop all posting")
      .not.toContain("POST-CAT-002");
  });

  it("still enforces everything that is safe today", () => {
    const body = bodyOf(sql);
    expect(body, "the strip guard").toContain("POST-CAT-003");
    expect(body, "slug validation").toContain("POST-CAT-001");
    expect(body, "the post_kind pin").toContain("NEW.post_kind := 'member'");
    expect(sql, "the maximum").toContain("CHECK (cardinality(categories) <= 5)");
  });

  it("carries its own tripwire, so applying it re-checks the split", () => {
    expect(sql).toContain("B1_minimum_must_be_ABSENT");
    expect(sql).toContain("B1_strip_guard_must_be_PRESENT");
    // and the check must strip comments, or it measures the explanation
    expect(sql).toMatch(/regexp_replace\(p\.prosrc, '--\[\^\\n\]\*', '', 'g'\)/);
  });

  it("documents the apply order of its three artefacts", () => {
    // Migration → frontend → edge function. Frontend-first would leave the feed
    // silently falling back to chronological, losing fairness ordering.
    expect(sql).toMatch(/APPLY ORDER WITHIN B1/i);
    expect(sql).toContain("PGRST202");
  });
});

describe("B2 turns on the minimum and changes NOTHING else", () => {
  const b1 = read(MIGRATION);
  const b2 = read(B2);

  it("exists, and is the only place the live rule is written", () => {
    expect(bodyOf(b2), "B2 does not actually enable the rule").toContain("POST-CAT-002");
  });

  it("differs from B1 by exactly the POST-CAT-002 block — nothing rides along", () => {
    // THIS IS THE IMPORTANT ONE. Replace B2's minimum block with B1's `NULL;`
    // placeholder; the two function bodies must then be character-identical.
    // If anything else was edited into B2 — a changed normaliser, a loosened
    // slug check, a different post_kind rule — this fails.
    const normalised = bodyOf(b2).replace(
      /IF NEW\.post_kind = 'member' AND _n < 1 THEN RAISE EXCEPTION 'POST-CAT-002:[^']*' USING ERRCODE = 'check_violation'; END IF;/,
      "NULL;",
    );
    expect(
      normalised,
      "B2 changes more than the minimum — diff the two function bodies before applying",
    ).toBe(bodyOf(b1));
  });

  it("keeps the same security context, or the rule becomes bypassable", () => {
    const b2Fn = b2.slice(b2.indexOf("CREATE OR REPLACE FUNCTION public.enforce_post_categories()"));
    expect(b2Fn).toContain("SECURITY INVOKER");
    expect(b2Fn.slice(0, b2Fn.indexOf("$fn$;"))).not.toContain("SECURITY DEFINER");
  });

  it("does not recreate the trigger, backfill, or touch the feed", () => {
    expect(b2, "recreating the trigger opens a window with no validation at all")
      .not.toMatch(/CREATE TRIGGER trg_validate_post_categories/);
    expect(b2, "no row may be rewritten").not.toMatch(/UPDATE\s+public\.posts\s+SET/i);
    expect(b2, "the feed is not B2's business").not.toContain("get_broadcast_feed");
  });

  it("gates itself on the scheduled queue and on B1 being applied first", () => {
    expect(b2).toContain("pending_scheduled_with_ZERO_categories");
    expect(b2).toContain("B1_is_applied_first");
    expect(b2).toContain("minimum_not_already_active");
  });

  it("records why a minimum-version gate cannot protect this transition", () => {
    // A gate only fires if it is already inside the INSTALLED build, and
    // today's builds have none. The gate shipped in Stage C protects the NEXT
    // transition. For this one, adoption is measured from client_errors.
    expect(b2).toContain("client_errors");
    expect(b2).toMatch(/already inside the INSTALLED/i);
  });
});

describe("Stage C HAS shipped — the tripwire has flipped", () => {
  it("the composer now sends categories on both insert paths", () => {
    // This test used to assert the OPPOSITE: that the composer sent nothing,
    // as the tripwire for Stage C. Stage C has landed, so it now asserts the
    // new truth — the immediate `posts` insert and the `scheduled_posts`
    // branch both carry the member's choice, in the same statement as the post
    // itself. Nothing is written in two steps.
    const composer = code("src/components/WallPosts.tsx");
    // Three sites now: the immediate posts insert, the scheduled_posts branch,
    // and the draft row. All three carry the member's choice in the same
    // statement as the thing being written.
    expect((composer.match(/categories: postCategories/g) ?? []).length).toBe(3);
    // The two that reach `posts` are the ones that matter for the feed.
    expect(composer).toContain("categories: postCategories,");
  });

  it("the composer refuses to post without one, in BOTH places", () => {
    // The button and createPost must agree, or the member gets a dead button
    // or a refusal after pressing it.
    const composer = code("src/components/WallPosts.tsx");
    expect(composer).toContain("!canPublishCategories(postCategories) ||");
    expect(composer).toContain("if (!canPublishCategories(postCategories)) {");
  });

  it("but the DATABASE minimum is still off — B2 has not run", () => {
    // Stage C enforces 1-5 in the UI only. POST-CAT-002 stays inactive until
    // the adoption gate is met, so this must remain absent from live code.
    const sql = read(MIGRATION);
    expect(bodyOf(sql)).not.toContain("POST-CAT-002");
  });
});
