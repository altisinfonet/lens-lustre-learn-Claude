/**
 * CENTRAL CONTROL K1 — THE HASHTAG PAGE SHOWS THE FEED'S CARD.
 *
 * /hashtag/:tag built its own card by hand: a 40 px avatar, no like or comment
 * count, no comments, no menu, no reach figures, its own spacing. A post looked
 * different there from the same post on /feed, and "fixed here" never reached
 * it. The page is now page chrome plus the one <PostCard>.
 *
 * These tests render the REAL page with the REAL PostCard (only the network,
 * the sign-in and the comments sheet are stood in for) next to a reference
 * <PostCard> fed the shape the feed gives it, and compare the DOM. A hand-built
 * card, or a field missing from the data, makes the two differ.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { UnifiedPost } from "@/types/post";
import { stripComments } from "@/test-utils/sourceText";

const VIEWER = "viewer-1";
const AUTHOR = "author-1";
const TAGGED = "tagged-1";
const PHOTO = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3.webp";

const { tables, deleted, opened, submitted, blocked, auth } = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  deleted: [] as string[],
  opened: [] as unknown[],
  submitted: [] as unknown[],
  blocked: { ids: new Set<string>() },
  auth: { signedIn: true },
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const k of ["select", "eq", "in", "is", "not", "ilike", "order", "limit", "range", "or", "neq", "gte", "lte", "match", "filter"]) chain[k] = self;
    chain.delete = () => ({
      eq: (_c: string, id: string) => {
        deleted.push(id);
        const done = { eq: () => done, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
        return done;
      },
    });
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(res);
    return chain;
  };
  return {
    supabase: {
      rpc: async (fn: string) => ({ data: fn === "feature_allowed_me" ? false : [], error: null }),
      from,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: auth.signedIn ? { id: "viewer-1" } : null, loading: false }),
}));
vi.mock("@/hooks/core/useIsBanned", () => ({ useIsBanned: () => ({ isBanned: false }) }));
vi.mock("@/hooks/core/useBlockedUsers", () => ({ useBlockedUsers: () => ({ blockedIds: blocked.ids }) }));
vi.mock("@/lib/offline/outbox", async (actual) => ({
  ...(await actual<typeof import("@/lib/offline/outbox")>()),
  submit: async (_u: string, action: unknown) => { submitted.push(action); return { status: "sent" }; },
}));
vi.mock("@/lib/profileMapCache", () => ({
  fetchProfileMap: async () => new Map([
    ["author-1", { full_name: "Ananya Roy", avatar_url: "https://cdn-staging.50mmretina.com/a.webp", custom_url: "ananya", badges: [], last_active_at: null }],
    ["viewer-1", { full_name: "Neil Basu", avatar_url: null, custom_url: "neil", badges: [], last_active_at: null }],
    ["tagged-1", { full_name: "Avijit Sheel", avatar_url: null, custom_url: "avijit", badges: [], last_active_at: null }],
  ]),
}));
vi.mock("@/lib/adminBrand", async (actual) => ({ ...(await actual<typeof import("@/lib/adminBrand")>()), getAdminIds: async () => new Set<string>() }));
vi.mock("@/contexts/CommentsOverlayContext", () => ({
  useCommentsOverlay: () => ({ openPostComments: (post: unknown) => { opened.push(post); } }),
  usePostCommentsDeepLink: () => {},
}));
vi.mock("@/i18n/I18nContext", () => ({
  useT: () => (_k: string, fb?: string) => fb ?? _k,
  useI18n: () => ({ lang: "en", t: (_k: string, fb?: string) => fb ?? _k }),
}));
vi.mock("@/components/PageSEO", () => ({ default: () => null }));

import HashtagFeed from "@/pages/HashtagFeed";
import PostCard from "@/components/post/PostCard";

const CREATED = "2026-10-01T10:00:00Z";

/** posts rows, spelled the way the table spells them (likes_count, not like_count). */
const row = (over: Record<string, unknown> = {}) => ({
  id: "p1", user_id: AUTHOR, content: "Fog on the river #street", image_url: PHOTO, image_urls: [PHOTO],
  thumbnail_urls: null, privacy: "public", created_at: CREATED, likes_count: 7, comments_count: 2, shares_count: 4, ...over,
});

/** The same post as the feed hands it to PostCard. */
const feedShaped = (over: Partial<UnifiedPost> = {}): UnifiedPost => ({
  id: "p1", user_id: AUTHOR, content: "Fog on the river #street", image_url: PHOTO, image_urls: [PHOTO],
  video: null, thumbnail_urls: null, privacy: "public", created_at: CREATED,
  author_name: "Ananya Roy", author_avatar: "https://cdn-staging.50mmretina.com/a.webp", author_handle: "ananya",
  author_last_active: null, author_badges: [],
  like_count: 7, comment_count: 2, share_count: 4, is_liked: true, user_reaction: "like",
  top_reactions: ["love", "like"], reaction_counts: { love: 2, like: 1 },
  tagged_people: [{ id: TAGGED, name: "Avijit Sheel", handle: "avijit", pending: false, badges: [] }],
  ...over,
});

function seed() {
  tables.posts = [row()];
  tables.post_reactions = [
    { post_id: "p1", reaction_type: "love", user_id: "x" },
    { post_id: "p1", reaction_type: "love", user_id: "y" },
    { post_id: "p1", reaction_type: "like", user_id: VIEWER },
  ];
  tables.post_tags = [{ post_id: "p1", tagged_user_id: TAGGED, status: "approved" }];
}

function shell(node: ReactNode, route = "/hashtag/street") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/hashtag/:tag" element={node} />
          <Route path="*" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

/** The DOM of a card, with the ids Radix and React number per mount taken out. */
function dom(card: Element): string {
  return card.outerHTML.replace(/radix-[^"]*/g, "radix").replace(/:r[0-9a-z]+:/g, ":r:");
}

async function openHashtagPage() {
  const view = shell(<HashtagFeed />);
  await settle();
  return view;
}

async function referenceCard(post: UnifiedPost, viewer: string | undefined) {
  const view = shell(<PostCard post={post} currentUserId={viewer} onReact={() => {}} onUnreact={() => {}} />);
  await settle();
  const card = view.container.querySelector(`[data-post-id="${post.id}"]`);
  expect(card, "the reference PostCard rendered").not.toBeNull();
  const html = dom(card!);
  view.unmount();
  return html;
}

function hashtagCard(container: HTMLElement, id = "p1") {
  const card = container.querySelector(`[data-post-id="${id}"]`);
  expect(card, `the hashtag page renders post ${id} through PostCard (data-post-id)`).not.toBeNull();
  return card as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-04T10:00:00Z") });
  for (const k of Object.keys(tables)) delete tables[k];
  deleted.length = 0;
  opened.length = 0;
  submitted.length = 0;
  blocked.ids = new Set();
  auth.signedIn = true;
  seed();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("/hashtag/:tag — the same card as /feed", () => {
  it("draws the very DOM PostCard draws for the feed's shape: header, photo, action row, caption", async () => {
    const reference = await referenceCard(feedShaped(), VIEWER);
    const { container } = await openHashtagPage();
    expect(dom(hashtagCard(container))).toBe(reference);
  });

  it("the same for a signed-out visitor: the page is public and shows no member menu", async () => {
    auth.signedIn = false;
    const reference = await referenceCard(
      feedShaped({ is_liked: false, user_reaction: null }),
      undefined,
    );
    const { container } = await openHashtagPage();
    const card = hashtagCard(container);
    expect(dom(card)).toBe(reference);
    expect(within(card).queryByRole("button", { name: "Post options" })).toBeNull();
  });

  it("the header carries the feed's 32 px avatar, the name link, and the tagged person's link", async () => {
    const { container } = await openHashtagPage();
    const card = hashtagCard(container);
    expect(card.querySelector("img.w-8.h-8.rounded-full")).not.toBeNull();
    expect(within(card).getByRole("link", { name: "Ananya Roy's profile" })).toHaveAttribute("href", "/ananya");
    expect(within(card).getByRole("link", { name: "Avijit Sheel" })).toHaveAttribute("href", "/avijit");
  });

  it("the action row shows the post's real counts and the viewer's own reaction", async () => {
    const { container } = await openHashtagPage();
    const row = within(hashtagCard(container));
    expect(row.getByText("7")).toBeInTheDocument();
    expect(row.getByRole("button", { name: /comment/i })).toHaveTextContent("2");
    expect(row.getByText("4")).toBeInTheDocument();
  });

  it("a comment opens the one shared comment sheet with the post", async () => {
    const { container } = await openHashtagPage();
    fireEvent.click(within(hashtagCard(container)).getByRole("button", { name: /comment/i }));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ id: "p1", comment_count: 2 });
  });

  it("the ⋯ menu is the feed's: Report and Block for someone else's post", async () => {
    const { container } = await openHashtagPage();
    const options = within(hashtagCard(container)).getByRole("button", { name: "Post options" });
    fireEvent.keyDown(options, { key: "Enter" });
    await settle();
    expect(await screen.findByText("Report content")).toBeInTheDocument();
    expect(screen.getByText("Block Ananya Roy")).toBeInTheDocument();
  });

  it("the Like button works here, and the number follows it at once", async () => {
    tables.post_reactions = [];
    const { container } = await openHashtagPage();
    const card = within(hashtagCard(container));
    expect(card.getByText("7")).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: /^(like|react)/i }));
    await settle();
    expect(submitted).toEqual([expect.objectContaining({ kind: "react", postId: "p1", reactionType: "like" })]);
    expect(card.getByText("8")).toBeInTheDocument();
  });

  it("a member's own post can be moved to trash and leaves the page", async () => {
    tables.posts = [row({ id: "mine", user_id: VIEWER })];
    tables.post_reactions = [];
    tables.post_tags = [];
    const { container } = await openHashtagPage();
    fireEvent.keyDown(within(hashtagCard(container, "mine")).getByRole("button", { name: "Post options" }), { key: "Enter" });
    await settle();
    fireEvent.click(await screen.findByText("Move to trash"));
    await settle();
    expect(deleted).toEqual(["mine"]);
    expect(container.querySelector('[data-post-id="mine"]')).toBeNull();
  });

  it("a blocked member's post is not shown, as on the feed", async () => {
    blocked.ids = new Set([AUTHOR]);
    const { container } = await openHashtagPage();
    expect(container.querySelector('[data-post-id="p1"]')).toBeNull();
    expect(screen.getByText("No public posts found with #street")).toBeInTheDocument();
  });
});

describe("src/pages/HashtagFeed.tsx — page chrome only", () => {
  const src = stripComments(readFileSync("src/pages/HashtagFeed.tsx", "utf8"));

  it("renders posts through PostCard and builds them with the wall's one builder", () => {
    expect(src).toMatch(/import PostCard from "@\/components\/post\/PostCard"/);
    expect(src).toMatch(/<PostCard\b/);
    expect(src).toMatch(/fetchHashtagPosts\(/);
    const builder = stripComments(readFileSync("src/hooks/feed/useUserPostsQuery.ts", "utf8"));
    expect(builder).toMatch(/return enrichPostRows\(visiblePosts, viewerId\);/);
  });

  it("has no hand-built card left: none of the pieces of a card, none of its own post shape", () => {
    for (const piece of [
      "FacebookPhotoGrid", "FeedVideoCard", "RichContentRenderer", "PresenceAvatar", "UserIdentityBlock",
      "PostCameraDetails", "postMedia", "fetchPostAttachments", "attachmentsFor", "bg-card", "timeAgo", "HashPost",
    ]) {
      expect(src, piece).not.toContain(piece);
    }
  });
});
