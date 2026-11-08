// Harness only: the sample stories from the Owner-approved design (6 Nov 2026),
// so the REAL Stories v2 screens can be photographed next to the approved PNGs
// (_control/out/OWNER/stories-sample/approved-2026-11-06). On with ?stories=1.
import { HARNESS_USER_ID } from "./fakeBackend";

// Read once at load: a real-screen scene rewrites the URL to /feed before its first fetch.
const ON = typeof location !== "undefined" && location.search.includes("stories=1");
export const storySampleOn = () => ON;

const pic = (id: number, w = 1080, h = 1350) => `https://picsum.photos/id/${id}/${w}/${h}`;
export const PEOPLE = [
  { user_id: "a1", full_name: "Dipannita Sen", avatar_url: pic(64, 200, 200), photos: [1015, 1039, 1043], unseen: true, mins: 42 },
  { user_id: "a2", full_name: "Rahul Das", avatar_url: pic(91, 200, 200), photos: [1074], unseen: true, mins: 95 },
  { user_id: "a3", full_name: "Mitali Roy", avatar_url: pic(65, 200, 200), photos: [1084, 1062], unseen: true, mins: 180 },
  { user_id: "a4", full_name: "Sourav Pal", avatar_url: pic(177, 200, 200), photos: [1025], unseen: false, mins: 400 },
];
export const MY_PHOTOS = [1018, 1036];
export const storyPic = pic;

// Fixed "now" for the sample's ages (the scene clock is not frozen; ages are minutes back from real now).
const at = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();
const exp = "2099-01-01T00:00:00.000Z";

export function sampleBar() {
  return PEOPLE.map((p) => ({
    user_id: p.user_id, full_name: p.full_name, avatar_url: p.avatar_url, is_official: false,
    latest_story_at: at(p.mins), story_count: 1, has_unseen: p.unseen, cover_url: pic(p.photos[0], 300, 300),
  }));
}

// ?unread=1 — three unread likes, so the ☰ menu's dot and "3 new" can be photographed
// (Owner-approved Style 2 sample, 8 Nov 2026).
const UNREAD = typeof location !== "undefined" && location.search.includes("unread=1");
export const unreadSampleOn = () => UNREAD;
export function sampleUnreadGroups() {
  return [{
    group_key: "like:post-me-0", type: "post_like", notification_ids: ["n1", "n2", "n3"],
    actor_ids: ["a1", "a2", "a3"], actor_names: ["Dipannita Sen", "Rahul Das", "Mitali Roy"], actor_usernames: ["", "", ""],
    actor_avatars: [PEOPLE[0].avatar_url, PEOPLE[1].avatar_url, PEOPLE[2].avatar_url], actor_count: 3, event_count: 3,
    unread_count: 3, reference_id: "post-me-0", thumbnail_url: null, title: "", message: "liked your post",
    latest_at: at(5), total_unread: 3, actor_known: [true, true, true],
  }];
}

/** The profile's highlights (v2.3 renders: square tiles, open in the one viewer). */
export function sampleHighlights() {
  const hl = (id: string, title: string, photos: number[]) => ({
    id, title, cover_url: pic(photos[0], 300, 300), sort_order: 0, created_at: at(60 * 24 * 9),
    items: photos.map((p, i) => ({ id: `${id}-i${i}`, highlight_id: id, image_url: pic(p), caption: null, sort_order: i, story_id: null })),
  });
  return [hl("h-street", "Street", [1011, 1012]), hl("h-travel", "Travel", [1016])];
}

/** get_user_stories: each person's stories as the database returns them. */
export function sampleUserStories(userId: string) {
  if (userId === HARNESS_USER_ID) {
    return MY_PHOTOS.map((id, i) => ({
      id: `s-me-${i}`, user_id: userId, created_at: at(30 - i), expires_at: exp, post_id: i === 0 ? "post-me-0" : null, caption: null,
      media: [pic(id)], thumbs: [], is_video: false, like_count: 9, comment_count: 3, i_liked: false, view_count: 24,
    }));
  }
  const p = PEOPLE.find((x) => x.user_id === userId);
  if (!p) return [];
  return [{
    id: `s-${p.user_id}`, user_id: p.user_id, created_at: at(p.mins), expires_at: exp,
    post_id: `post-${p.user_id}`, caption: "Golden hour at the river 🌅",
    media: p.photos.map((id) => pic(id)), thumbs: [], is_video: false,
    like_count: 0, comment_count: 3, i_liked: false, view_count: null,
  }];
}

export function sampleComments() {
  return [
    { id: "c1", user_id: "a2", full_name: "Rahul Das", avatar_url: pic(91, 100, 100), content: "Stunning light! Which lens?", created_at: at(20) },
    { id: "c2", user_id: "a3", full_name: "Mitali Roy", avatar_url: pic(65, 100, 100), content: "Wow 😍", created_at: at(15) },
    { id: "c3", user_id: "a4", full_name: "Sourav Pal", avatar_url: pic(177, 100, 100), content: "Need to go there next month", created_at: at(10) },
  ];
}

/** story_viewers (owner only): who saw the story, newest first (Owner 7 Nov). */
export function sampleViewers() {
  return PEOPLE.map((p, i) => ({
    viewer_id: p.user_id, full_name: p.full_name, avatar_url: pic(p.photos[0] % 200 + 10, 100, 100),
    custom_url: null, viewed_at: at(5 + i * 7), liked: i < 2,
  }));
}

/** story_comments_page: one page of older comments (then none). */
export function sampleOlderComments(before: string) {
  if (new Date(before).getTime() < Date.now() - 25 * 60000) return [];
  return [
    { id: "c0a", user_id: "a1", full_name: "Dipannita Sen", avatar_url: pic(64, 100, 100), content: "First!", created_at: at(40) },
    { id: "c0b", user_id: "a2", full_name: "Rahul Das", avatar_url: pic(91, 100, 100), content: "Beautiful colours", created_at: at(35) },
  ];
}
