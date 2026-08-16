/**
 * Turning a Supabase request into a fixture answer.
 *
 * Deliberately small and deliberately literal. It is NOT a PostgREST
 * implementation: it understands `eq.` and `in.()` and nothing else. It answers
 * the shapes the screens ask for, and everything else falls through to the
 * loud "NO FIXTURE" path in fakeBackend.ts — which is how this list grew, from
 * measurement rather than from reading the code and guessing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DISTINCTION THAT MAKES THIS HONEST: **empty on purpose** vs **empty
 * because nobody wrote a fixture**.
 *
 * Both photograph identically — a tidy screen with nothing on it. One is a
 * state a real member sees (a new member has no stories, no gift, no pending
 * friend request); the other is the harness lying. So a table is either in
 * `TABLES` with rows, or in `EMPTY_BY_DESIGN` with a written reason, or it is
 * REPORTED. There is no fourth case, and "return [] and move on" is exactly the
 * shortcut that would make this whole harness worthless.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FakeRoute } from "./fakeBackend";
import {
  HARNESS_USER_ID,
  adCreatives, categories, certificates, dashboardInit, follows, posts,
  postComments, postReactions, profiles, profilesPublicData, siteSettings, userRoles,
} from "./fixtures";

/** Tables answered with rows. */
const TABLES: Record<string, unknown[]> = {
  profiles,
  profiles_public_data: profilesPublicData,
  posts,
  post_comments: postComments,
  certificates,
  site_settings: siteSettings,
  categories,
  user_roles: userRoles,
  follows,
  post_reactions: postReactions,
  ad_creatives: adCreatives,
  /**
   * The profile header's follower/following counts, added 2026-08-16 with the
   * Instagram-style header. Deliberately FOUR-DIGIT and uneven: a fixture of
   * 0 and 0 would photograph as "0 0" and prove nothing about whether the row
   * still aligns once real numbers arrive. 1,204 is wide enough to push the
   * columns apart and to exercise `toLocaleString`'s separator.
   */
  profile_stats: [
    { user_id: HARNESS_USER_ID, followers_count: 1204, following_count: 87, friends_count: 41 },
  ],
};

/**
 * Empty because that is a REAL state, each with the reason it is real. Read
 * these before adding to them: the bar is "a member genuinely sees this", not
 * "I did not want to write the fixture".
 */
const EMPTY_BY_DESIGN: Record<string, string> = {
  // A member with no unseen story ring — the commonest state by far, and the
  // one where the feed's top strip must collapse cleanly rather than leave a
  // gap. Worth photographing precisely because it is the default.
  stories: "a member with no active stories; the ordinary case",
  // Nobody has asked to be friends this minute.
  friendships: "no pending request and no accepted edge in this fixture set",
  // No unread gift. The banner it drives is a competition/credit feature and
  // has its own component scenes.
  gift_announcements: "no unread gift credit",
  // Drafts and shares are per-member history; a fresh account has neither.
  post_drafts: "a member who has not saved a draft",
  post_shares: "a member who has not reshared anything",
  // Nobody is tagged in the fixture posts, so the tag pill row is absent —
  // which is the state that must not leave a stray margin behind.
  post_tags: "no tagged members in the fixture posts",
  // No badges: the name row must line up without one. The badge row itself is
  // covered by its own component scene.
  user_badges: "no badges, so the name row is checked without them",
  // ── The wall's optional sections. Each is something a member fills in over
  //    time, and the state that must look right for EVERYBODY on day one is
  //    the state without it. A wall carrying three albums, a highlights ring
  //    and a row of featured photographs is a different screenshot and belongs
  //    in its own scene — not as the default every other check is read through.
  featured_photos: "a member who has not featured any photograph yet",
  photo_albums: "no albums; the wall's default single-grid state",
  highlights: "no highlights ring, which is what a new wall looks like",
  // Nobody has reacted to a comment. The reaction pill is absent, which is the
  // state where a stray margin under a comment would show.
  post_comment_reactions: "no reactions on the fixture comments",
  // The badge CATALOGUE is admin-curated content; with no member holding a
  // badge (`user_badges` above) an empty catalogue renders identically and
  // keeps the two consistent.
  badge_definitions: "no badges are held, so the catalogue is not consulted",
  /**
   * A member who has never opened this screen has NO ROW —
   * `useNotificationPreferences` returns `DEFAULTS` for exactly that case, and
   * those defaults match the columns' own `NOT NULL DEFAULT true`. So an empty
   * answer here is not a gap: it is the commonest real state, and the one
   * where every switch should read "on".
   */
  notification_preferences: "no saved row; the hook's DEFAULTS path, which every new member takes",
};

/**
 * Stored procedures, by name. Filled from what the screens actually called —
 * an unknown name is reported, not answered.
 */
const RPCS: Record<string, (body: Record<string, unknown>, params: URLSearchParams) => unknown> = {
  /**
   * THE FEED ITSELF. Every post a member sees comes through here — which is
   * why the harness answering it with `[]` produced a perfectly tidy
   * "No posts yet" screen and reported no problem at all.
   *
   * The rows it returns carry the author's name and avatar welded on
   * (migration 20260813171159), and `useFeedQuery` detects that by the SHAPE of
   * the first row — `"author_name" in first`. So the fixture must carry those
   * columns or the harness would silently photograph the OLD code path.
   */
  get_broadcast_feed: () => posts,

  /**
   * Real distinct-viewer counts. Zero is honest: no one has opened these
   * fixture posts, and "0 views" is what a just-published post shows.
   */
  get_post_view_counts: () => [],

  // Nobody holds a public role (judge, mentor) in this fixture set, so no role
  // badge appears beside a name — the state most names are in.
  get_public_role_user_ids: () => [],
  get_public_roles_for_users: () => [],

  // An inbox with nothing unread: the bell shows no dot, which is the layout
  // that must be right for the member who has just caught up.
  get_my_unread_notifications_grouped: () => [],

  // No active stories anywhere, matching the empty `stories` table. The two
  // must agree — a ring here and an empty table there would photograph a
  // combination the app can never actually be in.
  get_feed_stories_bar: () => [],
  get_my_story_view_counts: () => [],

  // Contributor score drives a small rank chip. Nobody has one here, which is
  // the state a new member and most members are in.
  get_contributor_scores: () => [],
};

/**
 * PostgREST returns a single OBJECT rather than an array when the caller used
 * `.single()`/`.maybeSingle()`, signalled by an Accept header the harness does
 * not see. `limit=1` is the honest proxy available here. Getting it wrong is
 * immediately visible — the screen renders nothing — so simple is safe.
 */
function narrow(rows: unknown[], params: URLSearchParams): unknown {
  return Number(params.get("limit") ?? "") === 1 ? rows.slice(0, 1) : rows;
}

/**
 * PostgREST reports how many rows matched in `content-range`, and supabase-js
 * reads `count` from there — including for a HEAD request, whose body is
 * discarded. A wrong or missing count renders as "0 comments" beside a
 * thread that plainly has two.
 */
function countable(body: unknown[], method: string, total = body.length) {
  const range = total > 0 ? `0-${total - 1}/${total}` : `*/0`;
  return { body: method === "HEAD" ? [] : body, headers: { "content-range": range } };
}

/** Params that are PostgREST verbs, not column filters. */
const NOT_A_COLUMN = new Set(["select", "order", "limit", "offset", "or", "and", "not"]);

/**
 * Apply the filters we can honestly apply. Anything else is IGNORED rather
 * than approximated: a filter half-implemented would hand a screen rows it
 * would never really receive, and the screenshot would be of an app that does
 * not exist.
 */
function applyFilters(rows: unknown[], params: URLSearchParams): unknown[] {
  let out = rows as Array<Record<string, unknown>>;
  for (const [key, raw] of params.entries()) {
    if (NOT_A_COLUMN.has(key)) continue;
    if (raw.startsWith("eq.")) {
      const want = raw.slice(3);
      out = out.filter((r) => key in r && String(r[key]) === want);
    } else if (raw.startsWith("in.(")) {
      const set = new Set(raw.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, "")));
      out = out.filter((r) => key in r && set.has(String(r[key])));
    }
  }
  return out;
}

export const fixtureRoutes: FakeRoute[] = [
  // ── Table reads ──────────────────────────────────────────────────────────
  ({ method, path, params }) => {
    // HEAD is how supabase-js asks for a COUNT — `{ head: true, count: "exact" }`.
    // Answering it as if it were a GET returns the right number in
    // `content-range`, which is what the caller actually reads; refusing it
    // made three comment counters on the post screen report nothing.
    if (method !== "GET" && method !== "HEAD") return undefined;
    const m = /^\/rest\/v1\/([A-Za-z0-9_]+)$/.exec(path);
    if (!m) return undefined;
    const table = m[1];
    if (table in EMPTY_BY_DESIGN) return countable([], method);
    const rows = TABLES[table];
    if (!rows) return undefined; // unknown table: report it, never invent it
    const matched = applyFilters(rows, params);
    return countable(narrow(matched, params) as unknown[], method, matched.length);
  },

  // ── Edge functions ───────────────────────────────────────────────────────
  ({ method, path }) => {
    if (method !== "POST") return undefined;
    if (path === "/functions/v1/dashboard-init") return { body: dashboardInit };
    return undefined;
  },

  // ── RPC. Answered by name, and by NOTHING ELSE.
  //
  //    ⚠ THE MISTAKE THIS GUARDS AGAINST WAS MADE HERE, and caught by looking
  //    at a screenshot. The write rule below matched `POST /rest/v1/...`, and
  //    an RPC call IS a POST to `/rest/v1/rpc/<name>` — so the feed's RPC was
  //    quietly answered with `[]`, the feed rendered "No posts yet", the sweep
  //    reported zero missing fixtures, and the screenshot looked entirely
  //    reasonable. That is the exact lie this harness exists to prevent, made
  //    by the harness itself.
  //
  //    So RPC is matched FIRST, by name, and an unknown RPC falls through to
  //    the loud path instead of being mistaken for a write.
  ({ method, path, params, body }) => {
    if (method !== "POST") return undefined;
    const m = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/.exec(path);
    if (!m) return undefined;
    const fn = RPCS[m[1]];
    if (!fn) return undefined; // unknown RPC: reported, never silently empty
    return { body: fn((body ?? {}) as Record<string, unknown>, params) };
  },

  // ── Writes. A screenshot commits nothing; answer so an optimistic UI
  //    completes instead of raising an error toast that has nothing to do with
  //    the layout under inspection. Reads and RPC are handled above; anything
  //    reaching here is a genuine INSERT/UPDATE/DELETE.
  ({ method, path }) => {
    if (!/^\/rest\/v1\//.test(path)) return undefined;
    if (/^\/rest\/v1\/rpc\//.test(path)) return undefined; // never swallow an RPC
    if (method === "POST" || method === "PATCH" || method === "DELETE") return { body: [] };
    return undefined;
  },
];

/** Exported for the tests. */
export const FIXTURE_TABLE_NAMES = Object.keys(TABLES);
export const EMPTY_BY_DESIGN_NAMES = Object.keys(EMPTY_BY_DESIGN);
export const EMPTY_BY_DESIGN_REASONS = EMPTY_BY_DESIGN;
