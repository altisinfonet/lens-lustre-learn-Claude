/**
 * L1 · THE OVERLAY HISTORY CONTRACT, AGAINST A REAL BROWSER HISTORY STACK.
 *
 * F-REV4-7 (REV4 plan, 13 Oct): "Back loops on a post's comments". The cause
 * was one file — CommentsOverlayContext.tsx: opening comments pushed
 * `?comments=<id>`, closing them PUSHED a second entry instead of stepping
 * back, `subject` was never cleared, and the `[param]` watcher re-opened the
 * overlay whenever Back landed on `?comments=<same id>` again. Every Back then
 * re-opened the thread and every close added another step: an endless loop.
 *
 * These tests run inside `BrowserRouter` on jsdom's own `window.history`, not a
 * MemoryRouter, because the fault is about real history entries — how many
 * there are and where Back lands. Each test starts with a page BELOW the one
 * under test (`/below`), so "Back returns to the page below" is observable.
 *
 * The contract (REV4 §6 Stage L1):
 *  · opened in-app  → exactly ONE entry is pushed, marked as ours;
 *  · closed by ANY method → step back over our entry (or, if the entry is not
 *    ours, replace it without the parameter). Closing never pushes;
 *  · a deep link / cold start carrying `?comments=` opens the thread, and
 *    closing it leaves no step behind;
 *  · the watcher never re-opens a thread that was closed.
 *
 * SWIPE-DOWN is the one close method NOT driven here. Vaul decides a swipe from
 * the sheet's computed transform matrix, which jsdom does not compute, so a
 * "swipe" in this file could only be a call to the same onOpenChange(false)
 * Escape already makes — a test that could not fail for its own reason. The
 * real drag on the real sheet runs in tools/uishot/nav-harness.mjs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { useState } from "react";
import * as Ctx from "@/contexts/CommentsOverlayContext";
import CommentsOverlay from "@/components/comments/CommentsOverlay";
import type { UnifiedPost } from "@/types/post";

const { CommentsOverlayProvider, useCommentsOverlay } = Ctx;

vi.mock("@/hooks/feed/usePostComments", () => ({
  usePostComments: () => ({
    comments: [], loading: false, currentUserId: "viewer-1",
    viewer: { full_name: "Viewer", avatar_url: null }, isAdmin: false, canPin: false,
    submitting: false, editSubmitting: false, addComment: vi.fn(), editComment: vi.fn(),
    deleteComment: vi.fn(), toggleLike: vi.fn(), togglePin: vi.fn(), reportComment: vi.fn(), reload: vi.fn(),
  }),
}));
vi.mock("@/hooks/core/useBlockedUsers", () => ({
  useBlockedUsers: () => ({
    blockedIds: new Set<string>(), blockedRows: [], isBlocked: () => false, block: () => {},
    unblock: () => {}, blocking: false, unblocking: false, isLoading: false,
  }),
}));
vi.mock("@/components/ads/AdComments", () => ({
  default: ({ creativeId }: { creativeId: string }) => <div data-testid="ad-comments-stub">ad thread for {creativeId}</div>,
}));

const post = (id: string) => ({
  id, user_id: "author-1", content: `caption ${id}`, image_url: "https://example.com/p.jpg",
  image_urls: ["https://example.com/p.jpg"], privacy: "public", created_at: new Date().toISOString(),
  author_name: "A Photographer", author_avatar: null, like_count: 0, comment_count: 0, share_count: 0,
  is_liked: false, user_reaction: null, top_reactions: [], reaction_counts: {},
}) as unknown as UnifiedPost;

const POST = post("post-1");

/** The card's comment icon, exactly as PostCard calls it. */
const OpenButton = ({ p = POST }: { p?: UnifiedPost }) => {
  const { openPostComments } = useCommentsOverlay();
  return <button onClick={() => openPostComments(p)}>open {p.id}</button>;
};

/**
 * A card that, like PostCard, claims a deep link naming its own post. Looked up
 * by name so this file still RUNS against the pre-L1 code (where the hook does
 * not exist) and fails on the assertion — the overlay never opens — instead of
 * failing to import.
 */
const noop = () => {};
const useDeepLink: (p: UnifiedPost) => void =
  (Ctx as unknown as { usePostCommentsDeepLink?: (p: UnifiedPost) => void }).usePostCommentsDeepLink ?? noop;
const DeepLinkCard = ({ p = POST }: { p?: UnifiedPost }) => {
  useDeepLink(p);
  return <span>card {p.id}</span>;
};

/** Where the router is, and what the context believes — read from the outside. */
const Probe = () => {
  const loc = useLocation();
  const { subject, isOpen } = useCommentsOverlay();
  return (
    <>
      <div data-testid="where">{loc.pathname + loc.search}</div>
      <div data-testid="subject">{subject ? (subject.kind === "post" ? subject.post.id : subject.creativeId) : "none"}</div>
      <div data-testid="open">{String(isOpen)}</div>
    </>
  );
};

/** Exposes closeComments so a test can fire it twice in one tick (Vaul + Escape racing). */
let closeFromOutside: () => void = () => {};
const CloseHandle = () => {
  const { closeComments } = useCommentsOverlay();
  closeFromOutside = closeComments;
  return null;
};

const where = () => screen.getByTestId("where").textContent;

function startAt(url: string) {
  window.history.pushState(null, "", "/below");
  window.history.pushState(null, "", url);
}

function draw(children: React.ReactNode = <OpenButton />) {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CommentsOverlayProvider>
        {children}
        <Probe />
        <CloseHandle />
        <CommentsOverlay />
      </CommentsOverlayProvider>
    </BrowserRouter>,
  );
}

const back = async () => { await act(async () => { window.history.back(); }); };
const forward = async () => { await act(async () => { window.history.forward(); }); };

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  window.dispatchEvent(new Event("resize"));
};

beforeEach(async () => {
  // jsdom keeps ONE history stack for the whole file: let any traversal a
  // previous test queued land before this one starts.
  await new Promise((r) => setTimeout(r, 30));
  setViewportWidth(1280);
});
afterEach(() => cleanup());

type CloseMethod = { name: string; mobile?: boolean; close: () => void | Promise<void> };

const CLOSE_METHODS: CloseMethod[] = [
  { name: "the X button", close: () => { fireEvent.click(screen.getByRole("button", { name: "Close" })); } },
  { name: "Escape", close: () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" }); } },
  {
    name: "a backdrop tap",
    close: async () => {
      // Radix registers its outside-pointer listener on the next tick after opening.
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      fireEvent.pointerDown(document.body);
    },
  },
  {
    name: "Escape on the mobile sheet (what Android Back dispatches)",
    mobile: true,
    close: () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" }); },
  },
];

describe("opened in-app, closed by every method", () => {
  for (const m of CLOSE_METHODS) {
    it(`${m.name}: close adds no history step, and Back then lands on the page below`, async () => {
      if (m.mobile) setViewportWidth(375);
      startAt("/feed");
      draw();
      const lenBefore = window.history.length;

      fireEvent.click(screen.getByText("open post-1"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(where()).toBe("/feed?comments=post-1");
      expect(window.history.length, "opening pushes exactly one entry").toBe(lenBefore + 1);

      await m.close();
      await waitFor(() => expect(where()).toBe("/feed"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(window.history.length, "closing must never push").toBe(lenBefore + 1);
      expect(screen.getByTestId("subject").textContent, "subject is cleared on close").toBe("none");

      await back();
      await waitFor(() => expect(where()).toBe("/below"));
      expect(screen.queryByRole("dialog"), "Back must not re-open the thread").toBeNull();
    });
  }
});

describe("opened in-app, closed by the browser's own Back", () => {
  for (const width of [1280, 375]) {
    it(`${width}px: Back closes the thread and adds nothing; the next Back lands on the page below`, async () => {
      setViewportWidth(width);
      startAt("/feed");
      draw();
      const lenBefore = window.history.length;

      fireEvent.click(screen.getByText("open post-1"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(where()).toBe("/feed?comments=post-1");

      await back();
      await waitFor(() => expect(where()).toBe("/feed"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByTestId("subject").textContent, "subject is cleared on close").toBe("none");
      expect(window.history.length, "Back must not be answered with a push").toBe(lenBefore + 1);

      await back();
      await waitFor(() => expect(where()).toBe("/below"));
      expect(screen.queryByRole("dialog"), "Back must not re-open the thread").toBeNull();
    });
  }
});

describe("the watcher never re-opens a closed thread", () => {
  it("closing twice in one tick (two close paths racing) steps back ONCE, not twice", async () => {
    startAt("/feed");
    draw();
    fireEvent.click(screen.getByText("open post-1"));
    const lenOpen = window.history.length;
    act(() => { closeFromOutside(); closeFromOutside(); });
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(window.history.length, "neither close may push").toBe(lenOpen);
    // Give a second, wrongly-issued Back time to land if one was sent.
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(where()).toBe("/feed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the closed thread stays closed while its card keeps re-rendering", async () => {
    startAt("/feed");
    const Rerenderer = () => {
      const [n, setN] = useState(0);
      return (<><OpenButton /><DeepLinkCard /><button onClick={() => setN(n + 1)}>rerender {n}</button></>);
    };
    draw(<Rerenderer />);
    fireEvent.click(screen.getByText("open post-1"));
    const lenOpen = window.history.length;
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(window.history.length).toBe(lenOpen);
    fireEvent.click(screen.getByText("rerender 0"));
    fireEvent.click(screen.getByText("rerender 1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("open").textContent).toBe("false");
  });

  it("browser Forward — a real navigation into our own entry — may open it again, and closing then still steps back", async () => {
    startAt("/feed");
    draw();
    fireEvent.click(screen.getByText("open post-1"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(where()).toBe("/feed"));
    const len = window.history.length;

    await forward();
    await waitFor(() => expect(where()).toBe("/feed?comments=post-1"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(window.history.length).toBe(len);
  });
});

describe("a deep link / cold start that already carries ?comments=", () => {
  it("opens the thread, and closing it leaves no step behind", async () => {
    startAt("/feed?comments=post-1");
    const lenBefore = window.history.length;
    // Two cards on the page, as on a feed; only the one the link names may claim it.
    draw(<><DeepLinkCard p={post("post-2")} /><DeepLinkCard /></>);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByTestId("subject").textContent, "the thread the link names — not another card's").toBe("post-1");
    expect(window.history.length, "a deep link open pushes nothing").toBe(lenBefore);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(window.history.length, "closing a deep-linked thread REPLACES — no step left").toBe(lenBefore);

    await back();
    await waitFor(() => expect(where()).toBe("/below"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opening another thread on top of an UNCLAIMED link (its post is not on screen) does not land back on the stale link", async () => {
    startAt("/feed?comments=post-9");
    // A card for a DIFFERENT post is on screen: it must not claim post-9's link.
    draw(<><OpenButton /><DeepLinkCard p={post("post-2")} /></>);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByRole("dialog"), "no card here carries post-9 — the thread stays closed").toBeNull();

    fireEvent.click(screen.getByText("open post-1"));
    expect(where()).toBe("/feed?comments=post-1");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await back();
    await waitFor(() => expect(where()).toBe("/below"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
