/**
 * Photo plan U2 — SWITCH ON. Every post-photo surface shows the approved
 * camera-details states, grids load the 320 copy of new photos, and a blur
 * placeholder shows first. (The switch-OFF half is photoSetV2Off.test.tsx.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { UnifiedPost } from "@/types/post";

type Row = { post_id: string; ord: number; info: Record<string, unknown>; hidden: boolean };
let cameraRows: Row[] = [];
let switchOn = true;
const hiddenPosts = new Set<string>();
const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
  if (fn === "feature_allowed_me") return { data: args?._feature === "photo_set_v2" ? switchOn : false, error: null };
  if (fn === "post_photo_camera_for") {
    const ids = (args?.p_post_ids as string[]) ?? [];
    return { data: cameraRows.filter((r) => ids.includes(r.post_id)).map((r) => ({ ...r, hidden: hiddenPosts.has(r.post_id) })), error: null };
  }
  if (fn === "set_post_photo_camera_hidden") {
    if (args?.p_hidden) hiddenPosts.add(args.p_post_id as string); else hiddenPosts.delete(args?.p_post_id as string);
    return { data: args?.p_hidden, error: null };
  }
  return { data: [], error: null };
});
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "in", "is", "not", "order", "limit", "range", "or", "neq", "gte", "lte", "match", "filter"]) chain[k] = self;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.single = async () => ({ data: null, error: null });
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args),
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
import ProfilePostGrid from "@/components/profile/ProfilePostGrid";
import { NotificationRowThumb } from "@/components/notifications/CentreNotificationRow";
import { postMedia } from "@/lib/posts/subjectMedia";
import { featureAllowedKey } from "@/hooks/core/useFeatureAllowed";
import { PostCameraDetails } from "@/components/post/CameraDetails";

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4_THUMB = `${CDN}-w2048h1365-l4-thumb.webp`;
const L4_320 = `${CDN}-w2048h1365-l4-r320.webp`;
const OLD = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3.webp";
const OLD_THUMB = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3-thumb.webp";

const FULL = { camera: "Sony α7 IV", lens: "FE 85 mm F1.8", focal_length: 85, aperture: 1.8, shutter: "1/250", iso: 200, taken_at: "2026-10-12T18:42:00" };
const LINE = "Sony α7 IV · 85 mm · f/1.8 · 1/250 s · ISO 200";

const post = (over: Partial<UnifiedPost> = {}): UnifiedPost =>
  ({
    id: "p1", user_id: "author-1", content: "Last light over the Teesta valley", image_url: L4, image_urls: [L4],
    thumbnail_urls: [L4_THUMB], created_at: "2026-11-01T10:00:00Z", privacy: "public", like_count: 3, comment_count: 1,
    share_count: 0, author_name: "Ananya Roy", author_handle: "ananya", author_avatar: null, user_reaction: null,
    reaction_counts: {}, tagged_people: [], ...over,
  }) as unknown as UnifiedPost;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The app asks the switch once and caches it (60 s); a card mounting later
  // already knows the answer. Seed it the same way.
  qc.setQueryData(featureAllowedKey("photo_set_v2", "viewer-1"), switchOn);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const card = (p: UnifiedPost, viewer = "viewer-1") => <PostCard post={p} currentUserId={viewer} onReact={() => {}} onUnreact={() => {}} />;
const setApp = (on: boolean) => {
  (globalThis as { Capacitor?: unknown }).Capacitor = on ? { isNativePlatform: () => true } : undefined;
};

beforeEach(() => {
  rpc.mockClear();
  switchOn = true;
  hiddenPosts.clear();
  cameraRows = [{ post_id: "p1", ord: 0, info: FULL, hidden: false }];
  setApp(false);
});
afterEach(() => setApp(false));

describe("WEB feed card / post page (PostCard is both)", () => {
  it("the camera line sits under the photo, above the caption; a member's line is not clickable (admin arrow: cameraLineApproved.test.tsx)", async () => {
    const { container } = wrap(card(post()));
    await settle();
    const line = container.querySelector("[data-camera-line]") as HTMLElement;
    expect(line.textContent).toContain(LINE);
    const caption = screen.getByText(/Last light over the Teesta valley/);
    expect(line.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.querySelector("button")).toBeNull();
    // The old bordered web strip is gone.
    expect(container.querySelector("[data-camera-strip]")).toBeNull();
  });

  it("a new photo with no camera details → nothing at all", async () => {
    cameraRows = [];
    const { container } = wrap(card(post()));
    await settle();
    expect(container.querySelector("[data-camera-line]")).toBeNull();
    expect(screen.queryByText(/camera/i)).toBeNull();
  });

  it("an OLD photo with no camera details → nothing (its file was never read)", async () => {
    cameraRows = [];
    const { container } = wrap(card(post({ image_url: OLD, image_urls: [OLD], thumbnail_urls: [OLD_THUMB] } as Partial<UnifiedPost>)));
    await settle();
    expect(container.querySelector("[data-camera-line]")).toBeNull();
  });

  it("a page of cards costs ONE camera read, not one per post", async () => {
    cameraRows = ["a", "b", "c"].map((id) => ({ post_id: id, ord: 0, info: FULL, hidden: false }));
    wrap(<>{["a", "b", "c"].map((id) => <div key={id}>{card(post({ id }))}</div>)}</>);
    await settle();
    const reads = rpc.mock.calls.filter((c) => c[0] === "post_photo_camera_for");
    expect(reads).toHaveLength(1);
    expect([...(reads[0][1]!.p_post_ids as string[])].sort()).toEqual(["a", "b", "c"]);
  });

  it("owner menu: Hide camera details → the RPC, then the card refreshes to the author's 'hidden' hint; Show undoes it", async () => {
    wrap(card(post({ user_id: "viewer-1" })));
    await settle();
    fireEvent.keyDown(screen.getByRole("button", { name: "Post options" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Hide camera details/ }));
    await settle();
    expect(rpc).toHaveBeenCalledWith("set_post_photo_camera_hidden", { p_post_id: "p1", p_hidden: true });
    await waitFor(() => expect(screen.getByText("Hidden from others")).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("button", { name: "Post options" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Show camera details/ }));
    await settle();
    expect(rpc).toHaveBeenCalledWith("set_post_photo_camera_hidden", { p_post_id: "p1", p_hidden: false });
    await waitFor(() => expect(screen.queryByText("Hidden from others")).toBeNull());
  });

  it("someone else's post offers no hide control", async () => {
    wrap(card(post()));
    await settle();
    fireEvent.keyDown(screen.getByRole("button", { name: "Post options" }), { key: "Enter" });
    await screen.findByRole("menuitem", { name: /Report content/ });
    expect(screen.queryByRole("menuitem", { name: /camera details/ })).toBeNull();
  });
});

describe("APP (Android shell)", () => {
  it("feed: one small line under the photo, above the action row; a member's line opens nothing", async () => {
    setApp(true);
    const { container } = wrap(card(post()));
    await settle();
    const line = container.querySelector("[data-camera-line]") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toContain(LINE);
    const caption = screen.getByText(/Last light over the Teesta valley/);
    expect(line.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[data-camera-strip]")).toBeNull();
    expect(within(line).queryByRole("button")).toBeNull();
    fireEvent.click(line);
    expect(within(line).queryByText("FE 85 mm F1.8")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("feed, no camera details → nothing at all", async () => {
    setApp(true);
    cameraRows = [];
    const { container } = wrap(card(post()));
    await settle();
    expect(container.querySelector("[data-camera-line]")).toBeNull();
    expect(screen.queryByText(/camera/i)).toBeNull();
  });

  it("full screen: no camera ⓘ and no sheet — one design, the line under the photo (audit H1)", async () => {
    setApp(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wrap(card(post()));
      await settle();
      const frame = document.querySelector(".cursor-zoom-in") as HTMLElement;
      // The first tap may reveal the reach figures (interceptFirstTap); taps are
      // resolved after the 300 ms double-tap window.
      for (let i = 0; i < 2 && !screen.queryByRole("dialog", { name: /full size/ }); i++) {
        fireEvent.click(frame);
        await act(async () => { vi.advanceTimersByTime(400); });
      }
      const viewer = await screen.findByRole("dialog", { name: /full size/ });
      expect(within(viewer).queryByRole("button", { name: "Camera details" })).toBeNull();
      expect(screen.queryByRole("dialog", { name: "Camera details" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hashtag page card (its own markup, not PostCard)", () => {
  const both = (urls: string[]) => (
    <>
      <p>caption</p>
      <span>photo</span>
      <PostCameraDetails postId="p1" imageUrls={urls} />
    </>
  );
  it("web: the line under the photo", async () => {
    const { container } = wrap(both([L4]));
    await settle();
    expect(container.querySelector("[data-camera-strip]")).toBeNull();
    expect(container.querySelectorAll("[data-camera-line]")).toHaveLength(1);
    expect(container.querySelector("[data-camera-line]")!.textContent).toContain(LINE);
  });
  it("app: the same line under the photo", async () => {
    setApp(true);
    const { container } = wrap(both([L4]));
    await settle();
    expect(container.querySelector("[data-camera-strip]")).toBeNull();
    expect(container.querySelectorAll("[data-camera-line]")).toHaveLength(1);
  });
  it("switch off: nothing, and nothing read", async () => {
    switchOn = false;
    const { container } = wrap(both([L4]));
    await settle();
    expect(container.innerHTML).toBe("<p>caption</p><span>photo</span>");
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("post_photo_camera_for");
  });
});

describe("grids load the 320 copy of NEW photos only", () => {
  it("profile grid tile: -l4 → -r320; an old photo keeps its stored thumbnail", async () => {
    const posts = [post({ id: "g0" }), post({ id: "g1" }), post({ id: "g2", image_urls: [OLD], thumbnail_urls: [OLD_THUMB] } as Partial<UnifiedPost>)];
    const { container } = wrap(<ProfilePostGrid posts={posts} />);
    await settle();
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toContain(L4_320);
    expect(srcs).toContain(OLD_THUMB);
  });

  it("notification thumbnail: -l4 → -r320; an old photo is unchanged", async () => {
    const a = wrap(<NotificationRowThumb media={postMedia({ video: null, image_url: L4 })} />);
    const b = wrap(<NotificationRowThumb media={postMedia({ video: null, image_url: OLD })} />);
    await settle();
    expect(a.container.querySelector("img")!.getAttribute("src")).toBe(L4_320);
    expect(b.container.querySelector("img")!.getAttribute("src")).toBe(OLD);
  });
});

describe("blur preview in the feed photo", () => {
  const backdrop = (c: HTMLElement) => c.querySelector('img[aria-hidden="true"]') as HTMLImageElement | null;
  const sharp = (c: HTMLElement) => Array.from(c.querySelectorAll("img")).find((i) => !i.hasAttribute("aria-hidden"))!;

  it("a new photo: the 320 copy is the placeholder; the real photo fades in; srcset = the feed's 600 + 1080 (U4)", async () => {
    switchOn = true;
    const { container } = wrap(<PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} />);
    await settle();
    expect(backdrop(container)!.getAttribute("src")).toBe(L4_320);
    expect(sharp(container).className).toMatch(/opacity-0/);
    expect(sharp(container).className).toMatch(/transition-opacity/);
    // U2 kept today's srcset (600 + the 2048 master). U4 (the U3 review follow-up,
    // "feed keeps 1080") makes it the 600 + 1080 copies: photoSetV2U4.test.tsx.
    expect(sharp(container).getAttribute("srcset")).toBe(`${L4_THUMB} 600w, ${CDN}-w2048h1365-l4-r1080.webp 1080w`);
    fireEvent.load(sharp(container));
    expect(sharp(container).className).toMatch(/opacity-100/);
  });

  it("an old CDN photo: its stored 600 thumb is the placeholder (as today)", async () => {
    const { container } = wrap(<PostMedia urls={[OLD]} thumbUrls={[OLD_THUMB]} />);
    await settle();
    expect(backdrop(container)!.getAttribute("src")).toBe(OLD_THUMB);
  });

  it("already cached: no placeholder request, shown at once", async () => {
    const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
    const natural = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 2048 });
    try {
      const { container } = wrap(<PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} />);
      await settle();
      expect(backdrop(container)).toBeNull();
      expect(sharp(container).className).toMatch(/opacity-100/);
    } finally {
      if (complete) Object.defineProperty(HTMLImageElement.prototype, "complete", complete);
      else delete (HTMLImageElement.prototype as { complete?: boolean }).complete;
      if (natural) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", natural);
      else delete (HTMLImageElement.prototype as { naturalWidth?: number }).naturalWidth;
    }
  });
});
