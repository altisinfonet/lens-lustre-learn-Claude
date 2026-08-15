/**
 * A QUERY WITH NO LIMIT IS FINE UNTIL THE DAY IT ISN'T, AND NOTHING TELLS YOU
 * WHICH DAY THAT IS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED ON PRODUCTION, 2026-08-15 — see docs/unbounded-query-ceilings.md.
 *
 * On the screens a member actually opens there are 39 unbounded row-returning
 * queries. Eighteen are bounded by the page that produced their id list. Most
 * of the rest are bounded by their own nature — a config table of six rows, one
 * member's devices, 24 hours of one member's stories. Three are bounded by
 * nothing:
 *
 *   friendships   read TWICE per feed load, against check_friend_limit's 10 000
 *   follows       read per feed load, with no cap anywhere in the schema
 *   post_reactions every reaction on a photograph, to compute a count and a
 *                 boolean — the one that scales with SUCCESS
 *
 * At 94 members none of it hurts: heaviest member follows 66 and has 27
 * friends; the most-reacted photograph has 14 reactions. That is exactly why a
 * test is the right container for it. Nobody is going to re-run this scan by
 * hand in eight months, and the failure mode when it matters is not an error —
 * it is "the app got slow", which gets blamed on everything except a query
 * written in 2026.
 *
 * WHAT THIS ASKS FOR: every unbounded row-returning query on the member-facing
 * path is either bounded, or named here with what bounds it instead. Writing
 * "one member's own devices" takes a moment and is the whole mechanism — the
 * author has to look, and if they cannot name a ceiling, that is the finding.
 *
 * IT DOES NOT ASK for the three to be fixed. `.limit()` on friendships would
 * silently mislabel posts for a member past the limit, and silent truncation is
 * what the standing rule forbids. The real repair is a design change with its
 * own GO.
 *
 * ⚠ THE SCANNER WAS WRONG FOUR TIMES BEFORE IT WAS RIGHT, each time in the
 * alarming direction, so its exclusions are not decoration:
 *   1. `head: true` returns a COUNT and zero rows — the opposite of an
 *      unbounded read. Twenty were flagged, two of them on the home page.
 *   2. `.limit()` applied to a REASSIGNED BUILDER is invisible to a
 *      single-expression scan. TagPeopleModal does exactly this and was
 *      reported as "reads the whole member directory".
 *   3. `.in(...)` against a page's id list IS a ceiling — the page's size.
 *   4. Pagination in a wrapper (`useUserPostsQuery`, PAGE_SIZE 10 + cursor).
 * Any change to the matching below should be measured against those four.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const AUDIT_DOC = join(ROOT, "docs/unbounded-query-ceilings.md");

/** The screens a member opens. Admin screens serve one person and are out. */
const HOT_DIRS = [
  "src/hooks/feed",
  "src/components/feed",
  "src/components/post",
  "src/components/profile",
  "src/hooks/profile",
];
const HOT_FILES = [
  "src/pages/Index.tsx",
  "src/pages/PublicProfile.tsx",
  "src/pages/PostDetail.tsx",
  "src/components/PostCommentsSection.tsx",
  "src/components/CommentsSection.tsx",
  "src/lib/profileBatch.ts",
  "src/lib/profileMapCache.ts",
];

/**
 * `<table>@<file>` -> what bounds it, since the query itself does not say.
 * A `.limit()`, `.range()`, `.single()`, `head: true` or an `.in(<page ids>)`
 * removes the entry's need to exist; delete it then.
 */
const CEILING_LEDGER: Record<string, string> = {
  "friendships@src/hooks/feed/useFeedQuery.ts":
    "NOTHING BOUNDS IT — check_friend_limit() permits 10 000 friends and this reads them all, twice per feed load (:31 labels posts is_suggested, :204 decides the Add-friend button). A .limit() would silently mislabel posts for a member past it; the repair is to move the labelling into the feed RPC, as its own design cycle. Heaviest member today: 27",
  "follows@src/hooks/feed/useFeedQuery.ts":
    "NOTHING BOUNDS IT — no cap exists anywhere in the schema for how many accounts a member may follow, and every row is fetched before the feed renders. Heaviest member today: 66",
  "post_reactions@src/pages/PostDetail.tsx":
    "NOTHING BOUNDS IT — every reaction on the photograph is fetched to compute a count and whether this member reacted, both single values. Scales with SUCCESS, so it costs most on the page people share. Most-reacted photograph today: 14",
  "comments@src/components/CommentsSection.tsx":
    "the article/entry filter is applied CONDITIONALLY, so with neither prop this reads every comment on the platform. Both call sites pass one (JournalArticle articleId, EntryDetail entryId) — verified, so unreachable today; recorded because both props are optional",
  "stories@src/components/feed/FeedStoriesBar.tsx":
    "expires_at > now() — at most 24 hours of one member's stories. Live platform-wide today: 2",
  "stories@src/components/profile/ProfileStories.tsx":
    "expires_at > now() — at most 24 hours of one member's stories",
  "highlights@src/components/profile/ProfileStories.tsx":
    "one member's own curated highlights, created by hand one at a time",
  "featured_photos@src/components/profile/FeaturedPhotos.tsx":
    "one member's own featured selection, chosen by hand",
  "photo_albums@src/hooks/profile/useAlbums.ts":
    "one member's own albums, created by hand. Most albums held by anyone today: 3",
  "album_photos@src/hooks/profile/useAlbums.ts":
    "the photographs in one album the member opened. Largest album today: 5",
  "post_tags@src/components/post/PostCard.tsx":
    "the tags on the single post being rendered. Most tags on any post today: 1",
  "scheduled_posts@src/hooks/feed/useScheduledPosts.ts":
    "one member's own scheduled posts, scoped by RLS. Platform-wide today: 1",
  "user_devices@src/hooks/profile/useUserDevices.ts":
    "one member's own signed-in devices, a handful by nature",
  "user_roles@src/hooks/profile/useUserRoles.ts":
    "one member's own roles — admin, judge and so on, a handful by nature",
  "badge_definitions@src/hooks/profile/useBadgeDefinitions.ts":
    "an admin-curated definition table that does not grow with membership. 6 rows today",
  "role_display_config@src/hooks/profile/useRoleDefinitions.ts":
    "an admin-curated display table that does not grow with membership. 7 rows today",
  "hero_banners@src/pages/Index.tsx":
    "admin-curated home banners, a handful, and they do not grow with membership",
};

const FROM = /\.from\(\s*["']([a-z0-9_]+)["']\s*(?:as any)?\s*\)/gi;
const BOUND = /\.(limit|range|single|maybeSingle)\s*\(/;
const HEAD_ONLY = /head\s*:\s*true/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !name.includes(".test.")) out.push(p);
  }
  return out;
}

const files = [
  ...HOT_DIRS.flatMap((d) => walk(join(ROOT, d))).map((p) => p.slice(ROOT.length + 1).replace(/\\/g, "/")),
  ...HOT_FILES.filter((f) => existsSync(join(ROOT, f))),
].sort();

interface Hit { key: string; table: string; file: string; line: number; pageBounded: boolean }

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const m of src.matchAll(FROM)) {
      const start = m.index! + m[0].length;
      const window = src.slice(start, start + 1200);
      const semi = window.indexOf(";");
      const chain = semi > 0 ? window.slice(0, semi) : window;
      if (!chain.includes(".select(")) continue;
      if (HEAD_ONLY.test(chain)) continue;          // exclusion 1: a count, not rows
      if (BOUND.test(chain)) continue;

      // exclusion 2: the builder was assigned to a variable and bounded later.
      const before = src.slice(Math.max(0, m.index! - 200), m.index!);
      const varName = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*supabase[\s\S]{0,60}$/)?.[1];
      if (varName) {
        const rest = src.slice(start);
        const bounded = new RegExp(`\\b${varName}\\b[\\s\\S]{0,300}?\\.(limit|range)\\s*\\(`).test(rest);
        if (bounded) continue;
      }

      hits.push({
        key: `${m[1]}@${rel}`,
        table: m[1],
        file: rel,
        line: src.slice(0, m.index!).split("\n").length,
        pageBounded: /\.in\s*\(/.test(chain),   // exclusion 3: bounded by a page's id list
      });
    }
  }
  return hits;
}

const hits = scan();
const noCeiling = hits.filter((h) => !h.pageBounded);

describe("member-facing queries state their ceiling", () => {
  it("scans the hot path at all (vacuity guard)", () => {
    // A refactor that moves these folders would otherwise make every assertion
    // below pass by examining nothing.
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(hits.length).toBeGreaterThanOrEqual(20);
  });

  it("every unbounded query is either page-bounded or has a stated ceiling", () => {
    const unexplained = [...new Set(noCeiling.map((h) => h.key))].filter((k) => {
      const reason = CEILING_LEDGER[k];
      return !reason || reason.trim().length <= 20;
    });
    expect(
      unexplained,
      `These member-facing queries return rows with no limit, no range, and no .in() page bound, ` +
        `and nothing says what stops them growing: ${unexplained.join(", ")}. Add .limit()/.range(), ` +
        `or add an entry to CEILING_LEDGER naming what bounds it. "One member's own rows" is a fine ` +
        `answer; "nothing bounds it" is a finding. See docs/unbounded-query-ceilings.md.`,
    ).toEqual([]);
  });

  it("the ledger does not outlive the queries it describes", () => {
    // A stale entry lets the NEXT unbounded query at that path inherit an
    // explanation written for a different one.
    const live = new Set(noCeiling.map((h) => h.key));
    const stale = Object.keys(CEILING_LEDGER).filter((k) => !live.has(k));
    expect(
      stale,
      `CEILING_LEDGER entries whose query is now bounded or gone: ${stale.join(", ")}. Delete them.`,
    ).toEqual([]);
  });

  it("still recognises a bounded query as bounded (positive control)", () => {
    // Without this, a scanner broken toward "everything looks bounded" would
    // report all clear and read exactly like a healthy codebase. These three
    // are bounded three DIFFERENT ways, matching the three exclusions.
    const bounded = [
      "src/hooks/feed/useUserPostsQuery.ts",   // .limit(PAGE_SIZE) in the expression
      "src/components/post/TagPeopleModal.tsx", // .limit(30) on a reassigned builder
      "src/pages/Index.tsx",                    // head: true count queries
    ];
    for (const f of bounded) {
      expect(files, `${f} left the hot-path scan`).toContain(f);
    }
    // TagPeopleModal must NOT appear as unbounded — it is exclusion 2's case.
    expect(noCeiling.map((h) => h.file)).not.toContain("src/components/post/TagPeopleModal.tsx");
    // useUserPostsQuery must NOT appear — exclusion 4, pagination in a wrapper.
    expect(noCeiling.map((h) => h.file)).not.toContain("src/hooks/feed/useUserPostsQuery.ts");
  });

  it("keeps the audit that every ceiling was measured against", () => {
    expect(existsSync(AUDIT_DOC)).toBe(true);
  });
});
