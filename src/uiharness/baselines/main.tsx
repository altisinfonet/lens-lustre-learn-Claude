/**
 * SHARED-PIECE BASELINES HARNESS (development only) — baselinesharness.html.
 *
 * Central-control plan, unit B1. Every shared piece, REAL component and REAL
 * CSS, against the harness fake backend, so tools/uishot/ui-baselines.mjs can
 * photograph it and fail CI on a change nobody meant to make. It is what makes
 * every later unit measurable: "fixed here, broke there" shows up as a diff.
 *
 *   ?piece=postcard|photogrid|commentthread|actionrow|userline|notificationrow
 *   ?app=1   the Android shell (window.Capacitor, set before the app loads)
 *
 * Each variant is one element with `data-baseline="<piece>--<variant>"`. The
 * column is the viewport up to 560 px, the desktop feed column, so a 1280 px
 * viewport draws the desktop media queries at the real feed width.
 *
 * Features stay as on live: the fake backend answers no feature as on, so
 * photo_set_v2 is OFF here. Its ON state is covered by camline-visual.mjs.
 *
 * The photo is a fine diagonal pattern on purpose (the runner answers every
 * cdn.harness.test request with it): a smooth gradient moved by 1 px changes
 * almost no pixel, and the comparison would not see the move.
 */
import { createRoot } from "react-dom/client";
import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { installFakeBackend, HARNESS_USER_ID } from "../fakeBackend";
import { fixtureRoutes } from "../fixtureRoutes";
import "../../index.css";
import { CommentsOverlayProvider } from "@/contexts/CommentsOverlayContext";
import type { ThreadComment } from "@/components/comments/CommentThread";
import type { NotificationGroup } from "@/lib/notificationText";
import type { UnifiedPost } from "@/types/post";

if (!import.meta.env.DEV) throw new Error("baselines harness is development-only");

const q = new URLSearchParams(location.search);
if (q.get("app") === "1") {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
}
installFakeBackend({ routes: fixtureRoutes, signedIn: true });

const AppShell = lazy(() => import("../AppShell"));
const PostCard = lazy(() => import("@/components/post/PostCard"));
const FacebookPhotoGrid = lazy(() => import("@/components/FacebookPhotoGrid"));
const CommentThread = lazy(() => import("@/components/comments/CommentThread"));
const PostActionRow = lazy(() => import("@/components/post/PostActionRow"));
const UserIdentityBlock = lazy(() => import("@/components/UserIdentityBlock"));
const PresenceAvatar = lazy(() => import("@/components/PresenceAvatar"));
const CentreNotificationRow = lazy(() => import("@/components/notifications/CentreNotificationRow"));
const ClassicNotificationRow = lazy(() =>
  import("@/pages/Notifications").then((m) => ({ default: m.NotificationRow as ComponentType<Parameters<typeof m.NotificationRow>[0]> })),
);

/** Relative ages only, so a picture says the same thing on every day it is taken. */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const weeksAgo = (n: number) => minutesAgo(n * 7 * 24 * 60);

const CDN = "https://cdn.harness.test/post-images/u1/posts";
const photo = (name: string) => `${CDN}/${name}-w1200h800-l4.webp`;
const FACE = "https://cdn.harness.test/avatars/u1/face.webp";
const AUTHOR = "22222222-2222-4222-8222-222222222222";

const card = (id: string, over: Partial<UnifiedPost>): UnifiedPost => ({
  id, user_id: AUTHOR, content: "", image_url: null, image_urls: [], thumbnail_urls: [],
  created_at: minutesAgo(21), privacy: "public", like_count: 12, comment_count: 3, share_count: 0,
  author_name: "Dipannita Sen", author_handle: "dipannita", author_avatar: FACE, user_reaction: null,
  reaction_counts: { like: 12 }, tagged_people: [], ...over,
}) as unknown as UnifiedPost;

const one = photo("1762000000000-prayer");
const three = ["prayer", "river", "street"].map((n) => photo(`1762000000000-${n}`));
const five = ["a", "b", "c", "d", "e"].map((n) => photo(`1762000000000-${n}`));

const POSTS: Record<string, UnifiedPost> = {
  photo: card("bbbbbbbb-0000-4000-8000-000000000011", { content: "After the Prayer", image_url: one, image_urls: [one], thumbnail_urls: [one] }),
  album: card("bbbbbbbb-0000-4000-8000-000000000012", { content: "Three frames", image_url: three[0], image_urls: three, thumbnail_urls: three }),
  text: card("bbbbbbbb-0000-4000-8000-000000000013", { content: "Which lens would you take to the Kathi Holi?\nI can only carry one.", like_count: 0, comment_count: 0, reaction_counts: {} }),
};

const comment = (id: number, name: string, content: string, weeks: number, over: Partial<ThreadComment> = {}): ThreadComment => ({
  id: `c0000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  user_id: `a0000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  content, created_at: weeksAgo(weeks), updated_at: weeksAgo(weeks), parent_id: null, is_pinned: false,
  author_name: name, author_handle: name.toLowerCase().replace(/\W/g, ""), author_avatar: null, author_badges: [],
  author_last_active: null, like_count: 0, is_liked: false, replies: [], ...over,
});

const THREADS: Record<string, ThreadComment[]> = {
  owner: [comment(1, "Amit Baran Sen", "Outstanding picture", 9, { like_count: 1 }), comment(2, "Monojit Dutta", "Lovely Shot ❤️", 5, { author_badges: ["verified"] })],
  replies: [comment(3, "Neil Basu", "Congratulations", 5, {
    like_count: 3,
    replies: [
      comment(4, "Somnath Roy", "Thank you for all your support", 4, { parent_id: "c0000000-0000-4000-8000-000000000003" }),
      comment(5, "Framo Grapher", "Agreed, the light on the headdresses is superb", 4, { parent_id: "c0000000-0000-4000-8000-000000000003", like_count: 1 }),
    ],
  })],
  long: [comment(6, "Shri Venkata Subramanian Ramakrishnan Iyer", "Beautiful capture of the Kathi Holi. The light on the headdresses is superb and the colours hold even in the shadows.\nWhich lens did you use for this? https://www.50mmretina.com/journal/a-very-long-article-address-that-keeps-going", 6, { author_badges: ["verified"], like_count: 12, is_liked: true })],
};

const group = (key: string, type: string, title: string, message: string, over: Partial<NotificationGroup> = {}): NotificationGroup => ({
  group_key: key, type, notification_ids: [`n-${key}`], actor_ids: ["a0000000-0000-4000-8000-000000000001"],
  actor_names: ["Amit Baran Sen"], actor_usernames: ["amitbaransen"], actor_avatars: [FACE], actor_count: 1, event_count: 1,
  unread_count: 0, reference_id: "bbbbbbbb-0000-4000-8000-000000000011", thumbnail_url: one, title, message, latest_at: minutesAgo(21), ...over,
});

const GROUPS: Record<string, NotificationGroup> = {
  like: group("like", "post_like", "New like", "Amit Baran Sen liked your post", { unread_count: 1 }),
  many: group("many", "post_like", "New like", "Amit Baran Sen and 2 others liked your post", {
    actor_ids: ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"],
    actor_names: ["Amit Baran Sen", "Monojit Dutta"], actor_usernames: ["amitbaransen", "monojitdutta"], actor_avatars: [FACE, FACE], actor_count: 3, event_count: 3,
  }),
  follow: group("follow", "new_follower", "New follower", "Amit Baran Sen started following you", { reference_id: null, thumbnail_url: null }),
};

const nothing = () => {};
const noWrite = async () => true;

const threadRows = (kind: string) => (
  <CommentThread
    comments={THREADS[kind]} loading={false} currentUserId={HARNESS_USER_ID} viewer={{ full_name: "Neil Basu", avatar_url: null }}
    isAdmin={false} hideComposer expandReplies features={{ reactions: true, reporting: true, sorting: true }}
    onAdd={nothing} onEdit={noWrite} onDelete={nothing} onToggleLike={nothing} onReact={nothing} onReport={nothing} onBlockUser={nothing}
  />
);

const actionRow = (likes: number, comments: number, shares: number) => (
  <PostActionRow
    currentReaction={null} onReact={nothing} onUnreact={nothing} likeCount={likes} commentCount={comments} shareCount={shares}
    reactionCounts={likes > 0 ? { like: likes } : {}} reactionSource={{ kind: "post", postId: POSTS.photo.id }}
    onCommentClick={nothing} commentLabel="Comment" shareLabel="Share" shareMenu={null}
  />
);

const rowProps = { isFollowing: false, followReady: true, onOpen: nothing, onFollowBack: nothing, onDelete: nothing, followPending: false, adminIds: new Set<string>(), video: null };

/** Each piece's variants. A new variant needs its baseline PNGs, or the run fails. */
const PIECES: Record<string, Record<string, () => ReactNode>> = {
  postcard: Object.fromEntries(Object.entries(POSTS).map(([k, p]) => [k, () => <PostCard post={p} currentUserId={HARNESS_USER_ID} onReact={nothing} onUnreact={nothing} />])),
  photogrid: {
    one: () => <FacebookPhotoGrid urls={[one]} />,
    three: () => <FacebookPhotoGrid urls={three} />,
    five: () => <FacebookPhotoGrid urls={five} />,
  },
  commentthread: { owner: () => threadRows("owner"), replies: () => threadRows("replies"), long: () => threadRows("long") },
  actionrow: { short: () => actionRow(12, 3, 0), long: () => actionRow(823, 50, 17), zero: () => actionRow(0, 0, 0) },
  userline: {
    plain: () => <UserIdentityBlock userId={AUTHOR} name="Dipannita Sen" handle="dipannita" />,
    verified: () => <UserIdentityBlock userId={AUTHOR} name="Dipannita Sen" handle="dipannita" badges={["verified"]} />,
    long: () => <UserIdentityBlock userId={AUTHOR} name="Shri Venkata Subramanian Ramakrishnan Iyer" handle="venkata.subramanian" badges={["verified"]} />,
    avatar: () => (
      <div className="flex items-center gap-3">
        <PresenceAvatar src={FACE} name="Dipannita Sen" userId={AUTHOR} size={40} />
        <UserIdentityBlock userId={AUTHOR} name="Dipannita Sen" handle="dipannita" />
      </div>
    ),
  },
  notificationrow: {
    "classic-like": () => <ClassicNotificationRow group={GROUPS.like} {...rowProps} />,
    "classic-follow": () => <ClassicNotificationRow group={GROUPS.follow} {...rowProps} />,
    "centre-like": () => <CentreNotificationRow group={GROUPS.like} {...rowProps} />,
    "centre-many": () => <CentreNotificationRow group={GROUPS.many} {...rowProps} />,
    "centre-follow": () => <CentreNotificationRow group={GROUPS.follow} {...rowProps} />,
  },
};

const piece = q.get("piece") ?? "postcard";
const variants = PIECES[piece];
if (!variants) throw new Error(`no such piece: ${piece}`);

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>loading…</p>}>
    <AppShell route="/feed" path="/feed" withLayout={false}>
      <CommentsOverlayProvider>
        <div id="pieces" style={{ width: "100%", maxWidth: 560, margin: "0 auto", background: "hsl(var(--card))" }}>
          {Object.entries(variants).map(([name, draw]) => (
            <div key={name} data-baseline={`${piece}--${name}`}>{draw()}</div>
          ))}
        </div>
      </CommentsOverlayProvider>
    </AppShell>
  </Suspense>,
);
