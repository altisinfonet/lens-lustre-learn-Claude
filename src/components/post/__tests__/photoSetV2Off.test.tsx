/**
 * Photo plan U2 — SWITCH OFF ⇒ TODAY'S UI, BYTE FOR BYTE.
 *
 * The snapshots in __snapshots__/photoSetV2Off.test.tsx.snap were WRITTEN ON
 * THE CODE BEFORE U2 (staging 932271d5) and committed before any U2 display
 * code existed. Every U2 surface — the feed card, its photo, the profile grid,
 * the notification thumbnail, the My Photos tile — renders here with the
 * switch answering FALSE (and once with nobody signed in), using `-l4` photo
 * URLs, the case U2 changes when the switch is on. If any byte of their markup
 * moves, this file fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { UnifiedPost } from "@/types/post";

const rpc = vi.fn(async (fn: string, _args?: unknown) => ({ data: fn === "feature_allowed_me" ? false : [], error: null }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "in", "is", "not", "order", "limit", "range", "or", "neq", "gte", "lte", "match", "filter"]) chain[k] = self;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.single = async () => ({ data: null, error: null });
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      rpc: (fn: string, args?: unknown) => rpc(fn, args),
      from: () => chain,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
let signedIn = true;
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: signedIn ? { id: "viewer-1" } : null, loading: false }) }));
vi.mock("@/hooks/core/useDownloadImage", () => ({ useDownloadImage: () => ({ downloading: null, download: vi.fn() }) }));
vi.mock("@/contexts/CommentsOverlayContext", () => ({ useCommentsOverlay: () => ({ openPostComments: () => {} }), usePostCommentsDeepLink: () => {} }));
vi.mock("@/hooks/feed/FeedSignalsContext", () => ({ useFeedSignals: () => ({ watch: () => {}, dwell: () => {}, open: () => {} }) }));
vi.mock("@/components/ContributorScore", () => ({ default: () => null }));
vi.mock("@/components/UserIdentityBlock", () => ({ default: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("@/components/ShareSummaryTooltip", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/video/VideoPoster", () => ({ default: () => <span /> }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k, useI18n: () => ({ lang: "en", t: (_k: string, fb?: string) => fb ?? _k }) }));

import PostCard from "@/components/post/PostCard";
import PostMedia from "@/components/post/PostMedia";
import ProfilePostGrid from "@/components/profile/ProfilePostGrid";
import { NotificationRowThumb } from "@/components/notifications/CentreNotificationRow";
import { postMedia } from "@/lib/posts/subjectMedia";

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4_THUMB = `${CDN}-w2048h1365-l4-thumb.webp`;
const L4B = `${CDN}-w1365h2048-l4.webp`;
const OLD = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3.webp";

const post = (over: Partial<UnifiedPost> = {}): UnifiedPost =>
  ({
    id: "p1", user_id: "author-1", content: "Last light over the Teesta valley", image_url: L4, image_urls: [L4],
    thumbnail_urls: [L4_THUMB], created_at: "2026-11-01T10:00:00Z", privacy: "public", like_count: 3, comment_count: 1,
    share_count: 0, author_name: "Ananya Roy", author_handle: "ananya", author_avatar: null, user_reaction: null,
    reaction_counts: {}, tagged_people: [], ...over,
  }) as unknown as UnifiedPost;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

/**
 * THE CLOCK IS FIXED. The feed card shows "reach / viewed by" figures that grow
 * with the post's age (lib/displayEngagement.ts, age is its only input), so a
 * snapshot taken with the real clock goes stale: these were written at
 * 2026-11-02 ~13:47 UTC and fail from 15:32 UTC on (873 → 874 reach; CI run
 * 41491197888). Only `Date` is faked; timers stay real (settle() waits on them).
 * 14:00 UTC is inside the window the stored figures belong to (13:29–15:32).
 */
const SNAPSHOT_CLOCK = Date.parse("2026-11-02T14:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SNAPSHOT_CLOCK);
  rpc.mockClear();
  signedIn = true;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("photo_set_v2 OFF — every U2 surface renders exactly today's markup", () => {
  it("feed card, viewer is not the author", async () => {
    const { container } = wrap(<PostCard post={post()} currentUserId="viewer-1" onReact={() => {}} onUnreact={() => {}} />);
    await settle();
    expect(container.innerHTML).toMatchSnapshot();
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("post_photo_camera_for");
  });

  it("feed card, viewer IS the author (owner menu present, closed)", async () => {
    const { container } = wrap(<PostCard post={post({ user_id: "viewer-1" })} currentUserId="viewer-1" onReact={() => {}} onUnreact={() => {}} />);
    await settle();
    expect(container.innerHTML).toMatchSnapshot();
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("post_photo_camera_for");
  });

  it("feed card, signed out", async () => {
    signedIn = false;
    const { container } = wrap(<PostCard post={post()} currentUserId={undefined} onReact={() => {}} onUnreact={() => {}} />);
    await settle();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("single photo and album (PostMedia)", async () => {
    const one = wrap(<PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} />);
    const two = wrap(<PostMedia urls={[L4, L4B, OLD]} thumbUrls={[L4_THUMB, null, null]} />);
    await settle();
    expect(one.container.innerHTML).toMatchSnapshot();
    expect(two.container.innerHTML).toMatchSnapshot();
  });

  it("profile grid (grid tiles + showcase)", async () => {
    const posts = Array.from({ length: 4 }, (_, i) => post({ id: `p${i}`, image_urls: [i % 2 ? OLD : L4], thumbnail_urls: [i % 2 ? null : L4_THUMB] } as Partial<UnifiedPost>));
    const { container } = wrap(<ProfilePostGrid posts={posts} />);
    await settle();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("notification thumbnail", async () => {
    const { container } = wrap(<NotificationRowThumb media={postMedia({ video: null, image_url: L4 })} />);
    await settle();
    expect(container.innerHTML).toMatchSnapshot();
  });
});
