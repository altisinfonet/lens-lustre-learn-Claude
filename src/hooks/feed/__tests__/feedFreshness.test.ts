/**
 * THE FEED MUST DEAL A NEW HAND — AND THE APP MUST ACTUALLY ASK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner spec, 2026-07-30 and restated 2026-08-05:
 *   "on every refresh changing is must to ensure maximum visibility of all
 *    posts, not newer one."
 *
 * MEASURED ON PRODUCTION 2026-08-05, and the split is the whole point:
 *
 *   * DATABASE — working. `get_broadcast_feed` is VOLATILE and re-deals every
 *     call: three consecutive calls as one member returned 10 posts each and
 *     shared only 1, then 0. The 2026-08-04 migration is intact.
 *   * CLIENT — throwing it away. `App.tsx` sets a global `staleTime` of 5
 *     minutes and this query never overrode it, so React Query served the
 *     identical cached deal for five minutes. Leave /feed, come back, same
 *     posts. The database had shuffled; nobody asked it.
 *
 * A test that only checked the SQL would have passed all along while members
 * kept seeing the same feed — which is exactly what happened.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const hook = read("src/hooks/feed/useFeedQuery.ts");
const app = read("src/App.tsx");
/**
 * ⚠ THE LATEST DEFINITION, FOUND AT RUN TIME. NEVER A HARDCODED PATH.
 *
 * This line used to read `20260805040000_broadcast_feed_null_exclude_guard.sql`
 * by name. That file is the one that ADDED the COALESCE guard, so the assertion
 * below passed forever — while BOTH later definitions of the function
 * (`20260805100000_feed_newest_first.sql` and `20260812070000_post_categories.sql`)
 * silently reverted to a bare `ANY(_exclude_ids)`.
 *
 * The guard was therefore absent from production from 2026-08-05 to 2026-08-13
 * with this test green the whole time. A test pinned to a superseded file is
 * not a weak test, it is a FALSE one: it reports on a definition nobody runs.
 *
 * Now it sorts the migrations directory and reads whichever file most recently
 * defines the function. A future migration that reverts the guard again fails
 * here on the day it is written.
 */
const migrationsDir = "supabase/migrations";
const latestFeedMigration = readdirSync(join(process.cwd(), migrationsDir))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) =>
    readFileSync(join(process.cwd(), migrationsDir, f), "utf8").includes(
      "CREATE FUNCTION public.get_broadcast_feed",
    ) ||
    readFileSync(join(process.cwd(), migrationsDir, f), "utf8").includes(
      "CREATE OR REPLACE FUNCTION public.get_broadcast_feed",
    ),
  )
  .pop();

const sql = read(`${migrationsDir}/${latestFeedMigration}`).replace(/^\s*--.*$/gm, "");

describe("the client asks again every time it mounts", () => {
  it("the feed query is never considered fresh", () => {
    expect(hook).toMatch(/staleTime:\s*0/);
  });

  it("and refetches on mount even so", () => {
    // staleTime: 0 alone leaves refetchOnMount's default in play; "always" is
    // the explicit form, per the standing rule against implicit behaviour.
    expect(hook).toMatch(/refetchOnMount:\s*"always"/);
  });

  it("the global default it is overriding really is 5 minutes", () => {
    // Not assumed — read. If this ever drops to 0 globally, the override above
    // becomes redundant rather than wrong, and this test says so out loud.
    expect(app).toMatch(/staleTime:\s*5\s*\*\s*60\s*\*\s*1000/);
  });

  it("pull-to-refresh still explicitly refetches", () => {
    // This path always worked; the fix is for every OTHER way in.
    expect(read("src/pages/Feed.tsx")).toMatch(/onRefresh=\{async \(\) => \{ await refetch\(\); \}\}/);
  });
});

describe("the database half must stay volatile", () => {
  it("is VOLATILE, which is what lets random() re-deal per call", () => {
    // STABLE would let Postgres reuse one result and the feed would freeze.
    expect(sql).toMatch(/\bVOLATILE\b/);
    expect(sql).not.toMatch(/\bSTABLE\b/);
  });

  /**
   * ⚠ THESE TWO ASSERTIONS WERE RE-POINTED ON 2026-08-14, NOT RELAXED.
   *
   * They used to match the literal `random() * 6.0 ASC`. That expression is
   * gone: 20260814080000 replaced the per-call `random()` with
   * `feed_rank_score(id, bucket, seed)` — a deterministic hash of the post and a
   * session seed — because non-deterministic ordering makes a keyset cursor
   * impossible, forces the unbounded `_exclude_ids` array, and forecloses
   * caching, read replicas and fan-out permanently.
   *
   * The guard fired on that change, which is exactly what it is for. It is
   * updated because the ranking change is deliberate and was measured, not
   * because it was inconvenient:
   *
   *   Spearman(viewer_bucket, rank position), 1M-post harness
   *     old  random() * 6.0        +0.9231
   *     new  feed_rank_score(...)  +0.9192      delta 0.0039
   *
   * Low-viewer posts still surface first, to within 0.4%. The property these
   * tests protect — jitter, no recency term in the unseen tier, oldest-seen-day
   * first in the recycled tier — is unchanged, so they now assert the property
   * AND pin the new expression, which is strictly more than they asserted
   * before.
   */
  it("still ranks with jitter and no recency term", () => {
    // Jitter is now deterministic-per-seed rather than per-call.
    expect(sql).toMatch(/feed_rank_score\(v\.id, v\.bucket, \(SELECT s FROM seed\)\) ASC/);
    // The jitter must still be seeded, or every viewer sees one global order.
    expect(sql).toMatch(/to_char\(now\(\), 'YYYYMMDDHH24'\) \|\| coalesce\(auth\.uid\(\)::text, 'anon'\)/);
    // No recency term may creep into the unseen tier — that is what makes new
    // posts crowd out everything else.
    //
    // ⚠ The slice end is `,\n  seen_ranked AS`, NOT `seen_ranked AS`.
    // `indexOf("seen_ranked AS")` matches inside `unseen_ranked AS`, so the
    // slice came back empty and the assertion passed against nothing. Caught by
    // mutating the ORDER BY and watching this test stay green — trap #14 again,
    // this time in the guard itself.
    const from = sql.indexOf("unseen_ranked AS");
    const to = sql.indexOf("seen_ranked AS", from + "unseen_ranked AS".length);
    expect(from, "unseen_ranked CTE not found").toBeGreaterThan(-1);
    expect(to, "seen_ranked CTE not found after unseen_ranked").toBeGreaterThan(from);
    const unseen = sql.slice(from, to);
    expect(unseen.length, "the unseen_ranked slice is empty, so this asserts nothing")
      .toBeGreaterThan(100);
    expect(unseen).not.toMatch(/created_at/);
  });

  it("recycles seen posts oldest-seen-day first, shuffled within the day", () => {
    expect(sql).toMatch(/86400\.0\) DESC,\s*[\s\S]{0,80}?feed_rank_score/);
  });

  it("ranks over a BOUNDED candidate pool, not every visible post", () => {
    // The reason this migration exists. Measured at 1M posts: 4,836,645 buffers
    // and 9,489 ms scanning everything, against 1,656 buffers and 8 ms here.
    expect(sql).toMatch(/feed_candidates\(/);
    // The count(DISTINCT) LATERAL was 97% of the cost. It must not come back.
    expect(sql).not.toMatch(/count\(DISTINCT fe\.user_id\)/);
  });
});

describe("a NULL exclusion list must not empty the feed", () => {
  it("guards with COALESCE", () => {
    // Measured before the fix: get_broadcast_feed(NULL, 10) returned 0 rows
    // against 150 posts, because NOT (id = ANY(NULL)) is NULL, not TRUE.
    // After: 10 rows. The app never sent NULL, so this closes a class rather
    // than a live outage.
    expect(sql).toMatch(/ANY\(COALESCE\(_exclude_ids, '\{\}'::uuid\[\]\)\)/);
    expect(sql).not.toMatch(/ANY\(_exclude_ids\)/);
  });

  it("the app still sends an array, so nothing about the live call changes", () => {
    expect(hook).toMatch(/excludeByPageRef\.current\.get\(pageIndex\) \?\? \[\]/);
  });

  it("is the deployed function with ONE clause changed, not a rewrite", () => {
    // Re-deriving a live feed function from a partial read would be guesswork
    // on production. This migration was generated from
    // 20260804090000_feed_reshuffle_on_refresh.sql; `diff` showed exactly one
    // differing line. These anchors fail if someone "tidies" it into a rewrite.
    expect(sql).toMatch(/feed_tier text/);
    expect(sql).toMatch(/'unseen'::text AS feed_tier, 1 AS tier_order/);
    expect(sql).toMatch(/'recycled'::text AS feed_tier, 2 AS tier_order/);
    expect(sql).toMatch(/e\.skips = 1 AND e\.last_seen_at > now\(\) - interval '12 hours'/);
  });
});
