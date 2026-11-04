/**
 * FEED GESTURES, EXACTLY LIKE INSTAGRAM — Owner order, 4 Nov 2026.
 *
 *  1. A tap / click on a feed photograph opens NOTHING (no viewer, no page,
 *     no lightbox) — web and app alike.
 *  2. Two fingers pinch the photograph IN PLACE over the feed; it follows the
 *     fingers and springs back on release. One finger still scrolls the feed.
 *  3. A double-tap / double-click LIKES the post through the SAME like action
 *     the like button uses, with a heart on the photograph. A double-tap on a
 *     post that is already liked keeps it liked (it never un-likes).
 *
 * These are behaviour tests against the real PostMedia / PostCard; the source
 * ratchet that keeps a viewer from coming back is feedNoViewerRatchet.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { UnifiedPost } from "@/types/post";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "in", "is", "not", "order", "limit", "range", "or", "neq", "gte", "lte", "match", "filter"]) chain[k] = self;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.single = async () => ({ data: null, error: null });
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      rpc: async () => ({ data: false, error: null }),
      from: () => chain,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer-1" }, loading: false }) }));
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

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const A = `${CDN}-w2048h1365-l4.webp`;
const B = `${CDN}-b-w2048h1365-l4.webp`;

const post = (over: Partial<UnifiedPost> = {}): UnifiedPost =>
  ({
    id: "p1", user_id: "author-1", content: "Last light", image_url: A, image_urls: [A], thumbnail_urls: [],
    created_at: "2026-11-01T10:00:00Z", privacy: "public", like_count: 3, comment_count: 1, share_count: 0,
    author_name: "Ananya Roy", author_handle: "ananya", author_avatar: null, user_reaction: null,
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

/** The photograph's frame — the one element the gestures live on. */
const frameOf = (root: ParentNode = document) =>
  (root.querySelector("[data-feed-photo]") ?? root.querySelector(".cursor-zoom-in")) as HTMLElement;

/** Anything that looks like a viewer opened over the feed. */
const viewerOpen = () =>
  !!screen.queryByRole("dialog") || !!screen.queryByRole("button", { name: /close photo viewer/i });

const t = (x: number, y: number) => ({ clientX: x, clientY: y, identifier: x * 1000 + y });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe("1 · a tap or a click on a feed photograph opens nothing", () => {
  it("single photograph: click, wait past the double-tap window, click again later → no viewer", async () => {
    wrap(<PostMedia urls={[A]} />);
    fireEvent.click(frameOf());
    await act(async () => { vi.advanceTimersByTime(400); });
    fireEvent.click(frameOf());
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(viewerOpen()).toBe(false);
  });

  it("album: click → no viewer, and the slider still pages with its arrows", async () => {
    wrap(<PostMedia urls={[A, B]} />);
    fireEvent.click(frameOf());
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(viewerOpen()).toBe(false);
    expect(screen.getByText("1/2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByText("2/2")).toBeTruthy();
    expect(viewerOpen()).toBe(false);
  });
});

describe("3 · double-tap / double-click likes, with a heart", () => {
  it("PostMedia: two taps inside the window call the like exactly once and burst a heart", async () => {
    const like = vi.fn();
    const { container } = wrap(<PostMedia urls={[A]} onDoubleTapLike={like} />);
    fireEvent.click(frameOf(), { clientX: 100, clientY: 100 });
    fireEvent.click(frameOf(), { clientX: 102, clientY: 101 });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(like).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-feed-heart]")).not.toBeNull();
    expect(viewerOpen()).toBe(false);
  });

  it("album: a double-tap likes too (same rule on both renderers)", async () => {
    const like = vi.fn();
    wrap(<PostMedia urls={[A, B]} onDoubleTapLike={like} />);
    fireEvent.click(frameOf());
    fireEvent.click(frameOf());
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(like).toHaveBeenCalledTimes(1);
  });

  it("PostCard: a double-tap calls the card's ONE like action — onReact(post.id, \"like\") — once", async () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    wrap(<PostCard post={post()} currentUserId="viewer-1" onReact={onReact} onUnreact={onUnreact} />);
    fireEvent.click(frameOf());
    fireEvent.click(frameOf());
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact).toHaveBeenCalledWith("p1", "like");
    expect(onUnreact).not.toHaveBeenCalled();
    expect(viewerOpen()).toBe(false);
  });

  it("PostCard: double-tap on a post already liked keeps it liked — no un-like, no second like", async () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    wrap(<PostCard post={post({ user_reaction: "like" } as Partial<UnifiedPost>)} currentUserId="viewer-1" onReact={onReact} onUnreact={onUnreact} />);
    fireEvent.click(frameOf());
    fireEvent.click(frameOf());
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onReact).not.toHaveBeenCalled();
    expect(onUnreact).not.toHaveBeenCalled();
  });
});

describe("2 · two-finger pinch enlarges the photo in place and springs back", () => {
  const layer = () => document.querySelector("[data-feed-pinch-layer]") as HTMLElement | null;

  it("pinch out → a layer over the feed follows the fingers; release → it returns to scale 1 and goes away", async () => {
    wrap(<PostMedia urls={[A]} />);
    const frame = frameOf();
    fireEvent.touchStart(frame, { touches: [t(100, 200), t(200, 200)] });
    expect(layer()).not.toBeNull();
    // Fingers spread from 100px apart to 200px apart, midpoint moved +10,+20.
    const moved = fireEvent.touchMove(frame, { touches: [t(60, 220), t(260, 220)] });
    expect(moved).toBe(false); // the page does not scroll under a pinch
    expect(layer()!.style.transform).toMatch(/scale\(2\)/);
    expect(layer()!.style.transform).toMatch(/translate3d\(10px, 20px/);
    expect(frame.style.visibility).toBe("hidden");
    fireEvent.touchEnd(frame, { touches: [] });
    expect(layer()!.style.transform).toMatch(/scale\(1\)/);
    expect(layer()!.style.transform).toMatch(/translate3d\(0px, 0px/);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(layer()).toBeNull();
    expect(frame.style.visibility).toBe("");
    expect(viewerOpen()).toBe(false);
  });

  it("one finger is never captured — the feed keeps scrolling and no layer appears", () => {
    wrap(<PostMedia urls={[A]} />);
    const frame = frameOf();
    expect(fireEvent.touchStart(frame, { touches: [t(100, 200)] })).toBe(true);
    expect(fireEvent.touchMove(frame, { touches: [t(100, 120)] })).toBe(true);
    fireEvent.touchEnd(frame, { touches: [] });
    expect(layer()).toBeNull();
  });

  it("a pinch is not a tap: the click that may follow it neither likes nor opens anything", async () => {
    const like = vi.fn();
    wrap(<PostMedia urls={[A]} onDoubleTapLike={like} />);
    const frame = frameOf();
    fireEvent.touchStart(frame, { touches: [t(100, 200), t(200, 200)] });
    fireEvent.touchMove(frame, { touches: [t(80, 200), t(220, 200)] });
    fireEvent.touchEnd(frame, { touches: [] });
    fireEvent.click(frame);
    fireEvent.click(frame);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(like).not.toHaveBeenCalled();
    expect(viewerOpen()).toBe(false);
  });

  it("album: pinch works on a slide too", () => {
    wrap(<PostMedia urls={[A, B]} />);
    const frame = frameOf();
    fireEvent.touchStart(frame, { touches: [t(100, 200), t(200, 200)] });
    fireEvent.touchMove(frame, { touches: [t(50, 200), t(250, 200)] });
    expect(layer()!.style.transform).toMatch(/scale\(2\)/);
    fireEvent.touchEnd(frame, { touches: [] });
    expect(layer()!.style.transform).toMatch(/scale\(1\)/);
  });
});
