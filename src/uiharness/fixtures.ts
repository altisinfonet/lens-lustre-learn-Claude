/**
 * THE ROWS THE FAKE BACKEND ANSWERS WITH.
 *
 * Imports no app code (only erased types), because `main.tsx` installs the
 * backend before the app is loaded — see fakeBackend.ts.
 *
 * HOW THIS LIST WAS BUILT, and the only way it may be extended: **by running
 * the sweep and reading what the screens actually asked for.** Every request
 * without a fixture prints `[harness] NO FIXTURE for …` and fails the capture
 * gate. Nothing here was guessed from reading the code; each entry exists
 * because a real screen asked for it.
 *
 * WHY THE DATA IS DELIBERATELY AWKWARD: a fixture set of tidy short strings
 * proves only that tidy short strings fit. The rows below carry the things
 * that actually break a layout — a very long display name, a caption with no
 * spaces, a five-digit like count, a missing avatar, a portrait next to a
 * panorama — because those are the screenshots worth looking at.
 */

/** Deterministic stand-in photograph. No network, same pixels every run. */
export function fixtureImage(seed: number, label = ""): string {
  const hue = (seed * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 30% 32%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 26% 18%)"/>
    </linearGradient></defs>
    <rect width="900" height="600" fill="url(#g)"/>
    ${label ? `<text x="450" y="330" font-family="sans-serif" font-size="64" font-weight="700"
        fill="rgba(255,255,255,.5)" text-anchor="middle">${label}</text>` : ""}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const HARNESS_USER_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Names are Title Case here because the owner's rule is that they are Title
 * Case EVERYWHERE — database, backend, web and app. A fixture that shouted
 * "AVIJIT SHEEL" would be testing a state the app is not allowed to be in.
 */
export const FIXTURE_NAMES = [
  "Avijit Sheel",
  "Ranjana Bhattacharya Chowdhury",
  "Li Wei",
  "Maria De La Cruz",
] as const;

export interface FixtureProfile {
  id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  /**
   * THE THREE COLUMNS THAT DECIDE WHETHER A SCREEN IS VISIBLE AT ALL.
   *
   * `Layout` opens the onboarding modal unless `onboarding_completed` is true
   * and `user_type` and `custom_url` are both set. Measured: without them the
   * first real-screen run photographed "Let's set up your profile" instead of
   * the feed, three times, at three widths. A member who has finished signing
   * up is the state worth photographing — the modal itself gets its own scene.
   */
  onboarding_completed: boolean;
  user_type: string;
  custom_url: string;
}

export const profiles: FixtureProfile[] = [
  {
    id: HARNESS_USER_ID,
    full_name: FIXTURE_NAMES[0],
    username: "avijit",
    onboarding_completed: true,
    user_type: "photographer",
    custom_url: "avijit",
    avatar_url: fixtureImage(3),
    bio: "Street and portrait work, mostly at 50mm. Kolkata.",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    // The longest realistic name on the platform: four words, 33 characters.
    // If a card can hold this one it can hold the rest.
    full_name: FIXTURE_NAMES[1],
    username: "ranjana",
    onboarding_completed: true,
    user_type: "photographer",
    custom_url: "ranjana",
    avatar_url: null, // no avatar: the initials fallback must be looked at too
    bio: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    full_name: FIXTURE_NAMES[2],
    username: "liwei",
    onboarding_completed: true,
    user_type: "enthusiast",
    custom_url: "liwei",
    avatar_url: fixtureImage(9),
    bio: "Long exposure.",
  },
];

export interface FixturePost {
  id: string;
  user_id: string;
  content: string;
  /** The single-image column the older code paths still read. */
  image_url: string;
  image_urls: string[];
  thumbnail_urls: string[];
  privacy: string;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
  /**
   * F-95 — REQUIRED, not optional, and that is the lesson from the miss.
   *
   * On the app's own Post type this field is optional, so when I added it the
   * compiler could not tell me which hydration sites still lacked it — and
   * PostDetail was one, which is exactly what the UI gate caught as three
   * author anchors gone. Where the same field was made REQUIRED (the linkTo
   * to handle change on UserIdentityBlock) tsc produced the complete list in
   * one run. Required here so a new fixture post cannot silently render a
   * member with no reachable name.
   */
  author_handle: string | null;
  like_count: number;
  comment_count: number;
  share_count: number;
  is_liked: boolean;
  /** The `*_count` names above are the UI's; these are the columns' own. */
  likes_count: number;
  comments_count: number;
  shares_count: number;
  categories: string[];
}

/** Dimensions are in the filename because that is how the real feed learns a
 *  photo's shape without measuring — see src/lib/imageFrame.ts. */
function sized(seed: number, w: number, h: number, label: string): string {
  return fixtureImage(seed, `${label} -w${w}h${h}`);
}

export const posts: FixturePost[] = [
  {
    id: "aaaaaaa1-0000-4000-8000-000000000001",
    user_id: HARNESS_USER_ID,
    content: "Morning fog on the river. Waited forty minutes for the boat to cross the light.",
    image_url: sized(1, 1800, 1200, "3:2"),
    image_urls: [sized(1, 1800, 1200, "3:2")],
    thumbnail_urls: [sized(1, 1800, 1200, "3:2")],
    privacy: "public",
    created_at: "2026-08-14T04:30:00.000Z",
    author_name: FIXTURE_NAMES[0],
    author_avatar: fixtureImage(3),
    author_handle: "avijit",
    like_count: 12840, // five digits: the counter's widest realistic case
    comment_count: 312,
    share_count: 41,
    is_liked: true,
    likes_count: 12840,
    comments_count: 312,
    shares_count: 41,
    categories: ["street"],
  },
  {
    id: "aaaaaaa1-0000-4000-8000-000000000002",
    user_id: "22222222-2222-4222-8222-222222222222",
    // No spaces anywhere: the one string that cannot wrap, and therefore the
    // one that pushes a card wider than a 360px screen if anything is missing
    // an overflow rule.
    content: "Untitled_series_seventeen_finalexport_v3_lightroom_classic_export_full.jpg",
    image_url: sized(2, 1200, 1500, "4:5"),
    image_urls: [sized(2, 1200, 1500, "4:5")],
    thumbnail_urls: [sized(2, 1200, 1500, "4:5")],
    privacy: "public",
    created_at: "2026-08-13T18:05:00.000Z",
    author_name: FIXTURE_NAMES[1],
    author_avatar: null,
    author_handle: "ranjana",
    like_count: 3,
    comment_count: 0,
    share_count: 0,
    is_liked: false,
    likes_count: 3,
    comments_count: 0,
    shares_count: 0,
    categories: ["portrait"],
  },
  {
    id: "aaaaaaa1-0000-4000-8000-000000000003",
    user_id: "33333333-3333-4333-8333-333333333333",
    content: "",
    // A four-photo album whose cover is a panorama — the frame rule clamps at
    // 1.91:1, so this is where a photo is allowed to be letterboxed.
    image_url: sized(4, 2400, 900, "pano"),
    image_urls: [
      sized(4, 2400, 900, "pano"),
      sized(5, 1200, 1500, "4:5"),
      sized(6, 1800, 1200, "3:2"),
      sized(7, 1500, 1500, "1:1"),
    ],
    thumbnail_urls: [
      sized(4, 2400, 900, "pano"),
      sized(5, 1200, 1500, "4:5"),
      sized(6, 1800, 1200, "3:2"),
      sized(7, 1500, 1500, "1:1"),
    ],
    privacy: "public",
    created_at: "2026-08-12T07:00:00.000Z",
    author_name: FIXTURE_NAMES[2],
    author_avatar: fixtureImage(9),
    author_handle: "liwei",
    like_count: 87,
    comment_count: 9,
    share_count: 2,
    is_liked: false,
    likes_count: 87,
    comments_count: 9,
    shares_count: 2,
    categories: ["landscape", "wildlife"],
  },
];

/**
 * THE TABLE IS `post_comments`, NOT `comments`.
 *
 * The first draft of this file guessed `comments` from the UI wording. Nothing
 * ever read it — and nothing said so, because a fixture nobody asks for is
 * silent. The loud NO-FIXTURE path named the real table on the first run of
 * `screen-post-detail`. Kept as a note because it is the exact reason that
 * path exists.
 */
export const postComments = [
  {
    id: "ccccccc1-0000-4000-8000-000000000001",
    post_id: posts[0].id,
    user_id: "22222222-2222-4222-8222-222222222222",
    content: "The tonality here is remarkable. What were you shooting at?",
    created_at: "2026-08-14T05:10:00.000Z",
    updated_at: "2026-08-14T05:10:00.000Z",
    parent_id: null,
    is_pinned: false,
    author_name: FIXTURE_NAMES[1],
    author_avatar: null,
    author_handle: "ranjana",
  },
  {
    id: "ccccccc1-0000-4000-8000-000000000002",
    post_id: posts[0].id,
    user_id: HARNESS_USER_ID,
    content: "f/8, 1/250. Thank you.",
    created_at: "2026-08-14T05:40:00.000Z",
    updated_at: "2026-08-14T05:40:00.000Z",
    // A reply, so the threaded indent is in the picture and not only the
    // flat case — indentation at 360px is where a comment thread breaks.
    parent_id: "ccccccc1-0000-4000-8000-000000000001",
    is_pinned: false,
    author_name: FIXTURE_NAMES[0],
    author_avatar: fixtureImage(3),
    author_handle: "avijit",
  },
];

/* ───────────────────────────────────────────────────────────────────────────
 * Rows added because a REAL SCREEN ASKED FOR THEM. Every entry below appeared
 * first as `[harness] NO FIXTURE for …` in a capture run; none was written by
 * reading the code and guessing what might be needed.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * `profiles_public_data` is the view nearly every screen reads — the name, the
 * avatar and the badges beside a photograph. Its columns are a superset of
 * `profiles`, so it is derived from the same people rather than invented
 * separately: two lists of the same members that could drift apart is a bug
 * waiting to be photographed as a feature.
 */
export const profilesPublicData = profiles.map((p, i) => ({
  id: p.id,
  full_name: p.full_name,
  username: p.username,
  /*
   * C-84 / F-95 — CARRIED, and its absence was a real blind spot.
   *
   * The source rows above have always given every member a custom_url. This
   * DERIVED projection never copied it, so every screen reading
   * profiles_public_data saw undefined and only the no-handle fallback was ever
   * exercised. Harmless while a missing handle only meant "fall back to the id
   * url"; not harmless after F-95, where it means every profile link in every
   * scene renders as plain text — which is exactly what the UI gate reported on
   * e3160bf as three anchors "gone" on screen-post-detail and a vanished QR
   * card on screen-profile.
   *
   * On staging 513 of 513 members carry a handle. A fixture in which none does
   * is not a conservative fixture, it is the wrong one.
   */
  custom_url: p.custom_url,
  avatar_url: p.avatar_url,
  bio: p.bio,
  portfolio_url: i === 0 ? "https://example.test/avijit" : null,
  photography_interests: i === 0 ? ["street", "portrait"] : [],
  facebook_url: null,
  instagram_url: i === 0 ? "https://instagram.test/avijit" : null,
  created_at: "2026-01-05T00:00:00.000Z",
  // Fixed, never "now": a relative "active 3 minutes ago" would make two runs
  // of the same scene render different words.
  last_active_at: "2026-08-15T08:30:00.000Z",
}));

/**
 * Site settings. Left as an EMPTY set of rows for the keys the harness does
 * not configure, which is a deliberate choice with a consequence worth stating:
 * the screens are photographed on their DEFAULT branding path — the built-in
 * `SYSTEM_PAGES` menu and the bundled logo. The admin-configured logo and
 * custom navigation are NOT covered here and remain device/staging questions.
 */
export const siteSettings: Array<{ key: string; value: unknown }> = [];

/** Categories drive the feed's filter row: enough of them to overflow 360px,
 *  which is the only interesting question the row asks. */
export const categories = [
  { slug: "street", name: "Street", icon_name: "Footprints", sort_order: 1, is_active: true },
  { slug: "portrait", name: "Portrait", icon_name: "User", sort_order: 2, is_active: true },
  { slug: "landscape", name: "Landscape", icon_name: "Mountain", sort_order: 3, is_active: true },
  { slug: "wildlife", name: "Wildlife", icon_name: "Bird", sort_order: 4, is_active: true },
  { slug: "architecture", name: "Architecture", icon_name: "Building2", sort_order: 5, is_active: true },
  { slug: "documentary", name: "Documentary", icon_name: "Newspaper", sort_order: 6, is_active: true },
];

/**
 * An ordinary member, not an admin. Deliberate: an admin session would render
 * controls no member ever sees and hide the layout that most of them do.
 */
export const userRoles = [{ user_id: HARNESS_USER_ID, role: "member" }];

/** The harness member follows one of the other two. */
export const follows = [
  { follower_id: HARNESS_USER_ID, following_id: "33333333-3333-4333-8333-333333333333" },
];

/** One post already reacted to by this member — so the "liked" state of the
 *  reaction control is in the picture, not only the resting state. */
export const postReactions = [
  { post_id: posts[0].id, user_id: HARNESS_USER_ID, reaction_type: "like" },
  { post_id: posts[0].id, user_id: "22222222-2222-4222-8222-222222222222", reaction_type: "love" },
];

/**
 * No advertisement. Stated rather than left implicit: the ad slots collapse,
 * and a collapsed slot that leaves a gap behind it is exactly the kind of
 * fault worth seeing. The filled slot has its own component scene.
 */
export const adCreatives: unknown[] = [];

/**
 * The `dashboard-init` edge function's payload, shaped from its own
 * `/* ── 4. Build response ── *`/` block. The sidebar lists are empty on
 * purpose — competitions, courses and journal each have their own scenes, and
 * a sidebar full of invented competitions would make every feed screenshot a
 * picture of the sidebar instead of the feed.
 */
export const dashboardInit = {
  settings: {},
  profiles: profilesPublicData,
  roles: userRoles,
  badges: [],
  user_meta: { is_banned: false, notification_sound_enabled: true },
  sidebar: {
    competitions: [],
    courses: [],
    journal: [],
    winners: [],
    trending: [],
    voting_entries: [],
    voting_thumbnails: [],
    milestones: [],
    birthdays: [],
    suggestions: [],
  },
  user_id: HARNESS_USER_ID,
  cached: false,
};

/**
 * The wall's own sections, each asked for by `screen-profile` on its first run.
 *
 * All four are EMPTY BY DESIGN and the reason is the same one: they are
 * OPTIONAL sections a member fills in over time, and the state that must look
 * right for everybody on day one is the state without them. A wall carrying
 * five certificates, three albums and a highlights ring is a different
 * screenshot, and it belongs in its own scene rather than being the default
 * every other check is read through.
 *
 * They are declared in fixtureRoutes' EMPTY_BY_DESIGN rather than here.
 */

/** One certificate, so the row is not always empty in every screenshot. */
export const certificates = [
  {
    id: "eeeeeee1-0000-4000-8000-000000000001",
    user_id: HARNESS_USER_ID,
    title: "Monsoon Open 2026 — Finalist",
    type: "competition",
    issued_at: "2026-07-20T00:00:00.000Z",
  },
];
