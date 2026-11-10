// Harness only: sample data for the H1 hashtag page (Owner plan 2026-11-09), so the
// REAL page can be photographed for the Owner before the server part is built.
// On with ?hashtag=1; without it the hashtag RPCs answer from the normal fixture posts.
import { posts as fixturePosts, profiles } from "./fixtures";

const ON = typeof location !== "undefined" && location.search.includes("hashtag=1");
export const hashtagSampleOn = () => ON;
const FOLLOWING = typeof location !== "undefined" && location.search.includes("following=1");

const pic = (id: number, w: number, h: number) => `https://picsum.photos/id/${id}/${w}/${h}`;
// [picsum id, w, h, caption]
const SHOTS: Array<[number, number, number, string]> = [
  [1067, 1080, 1350, "City at first light #landscape #travel"],
  [1074, 1080, 1080, "Falls after the rain #landscape #wildlife"],
  [1015, 1350, 1080, "Walrus beach #landscape #sunset"],
  [1039, 1080, 1350, "Road through the hills #landscape #travel #mountains"],
  [1043, 1080, 1080, "Red rocks at sunset #landscape"],
  [1062, 1080, 1350, "Vulture landing #landscape #sunset"],
  [1084, 1080, 1080, "Glass tower #landscape #travel"],
  [1025, 1080, 1350, "Lioness #landscape #wildlife"],
  [1036, 1350, 1080, "Rain on Park Street #landscape #sunset"],
  [1018, 1620, 1080, "Old Calcutta from the river #landscape #travel"],
  [1011, 1080, 1350, "Boat ride #landscape"],
  [1003, 1080, 1080, "Morning walk #landscape #wildlife"],
  [1016, 1080, 1350, "Hills road #landscape"],
  [1019, 1080, 1080, "Window #landscape #mountains"],
  [1021, 1080, 1350, "Fog #landscape"],
  [1024, 1080, 1080, "Market crowd #landscape #wildlife"],
  [1027, 1080, 1350, "Portrait on the street #landscape #wildlife"],
  [1029, 1080, 1080, "Corner shop #landscape"],
  [1031, 1080, 1350, "Shadows #landscape #mountains"],
  [1033, 1620, 1080, "Rooftops #landscape #travel"],
];

const at = (i: number) => new Date(Date.UTC(2026, 10, 9, 12) - i * 3_600_000 * 7).toISOString();

function samplePosts() {
  const base = fixturePosts[0];
  return SHOTS.map(([id, w, h, caption], i) => {
    const author = profiles[i % profiles.length];
    const url = pic(id, w, h);
    // Not in date order, so Top (most liked) and Recent (newest) differ visibly.
    const likes = [1840, 932, 611, 428, 377, 290, 251, 199, 164, 133, 97, 88, 71, 64, 52, 41, 33, 27, 19, 12][(i * 7) % 20];
    return {
      ...base,
      id: `bbbbbbb1-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      user_id: author.id,
      content: caption,
      image_url: url,
      image_urls: [url],
      thumbnail_urls: [pic(id, 600, Math.round((600 * h) / w))],
      created_at: at(i),
      author_name: author.full_name,
      author_avatar: author.avatar_url,
      author_handle: author.custom_url,
      like_count: likes, likes_count: likes,
      comment_count: Math.round(likes / 9), comments_count: Math.round(likes / 9),
      share_count: Math.round(likes / 40), shares_count: Math.round(likes / 40),
      is_liked: false,
      page_cursor: String(i + 1),
    };
  });
}

export function sampleHashtagInfo(tag: string) {
  if (!ON) {
    return { tag, display_tag: tag, people_count: 3, post_count: fixturePosts.length, is_following: false, related: [] };
  }
  // The sample photos are landscapes and wildlife, so the sample tag is #landscape.
  return {
    tag: "landscape", display_tag: "landscape", people_count: 1284, post_count: 3402, is_following: FOLLOWING,
    related: [
      { tag: "mountains", display_tag: "mountains", post_count: 2210 },
      { tag: "wildlife", display_tag: "wildlife", post_count: 1875 },
      { tag: "sunset", display_tag: "sunset", post_count: 964 },
      { tag: "travel", display_tag: "travel", post_count: 702 },
      { tag: "পাহাড়", display_tag: "পাহাড়", post_count: 318 },
      { tag: "पहाड़", display_tag: "पहाड़", post_count: 146 },
    ],
  };
}

export function sampleHashtagPosts(sort: string) {
  if (!ON) return fixturePosts.map((p, i) => ({ ...p, page_cursor: String(i + 1) }));
  const list = samplePosts();
  // Top = most liked first; Recent = newest first (the sample list is built newest-first).
  return sort === "top" ? [...list].sort((a, b) => b.like_count - a.like_count) : list;
}
