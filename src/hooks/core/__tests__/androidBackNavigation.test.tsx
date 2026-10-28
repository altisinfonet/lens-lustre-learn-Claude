/**
 * L1 · ANDROID BACK, END TO END IN ONE PROCESS: the real `AndroidBackButton`
 * hook, the real comments provider + overlay, `BrowserRouter` on jsdom's own
 * `window.history`, and a fake Capacitor `App` plugin that hands us the
 * `backButton` listener so a test can "press Back" exactly as the OS does.
 *
 * F-REV4-7: in the app, `useAndroidBackButton` counts every router PUSH. The
 * pre-L1 comments provider PUSHED on close too, so every close made
 * `canGoBack()` true again and the app could never reach "exit" — and the Back
 * that followed landed on `?comments=<same id>`, which re-opened the thread.
 *
 * What a real phone still has to prove (this file cannot): the Back GESTURE
 * (predictive back raises the same `backButton` event, so it is covered in
 * logic but not in feel) and Vaul's swipe-down on the sheet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { BrowserRouter, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import * as Back from "@/hooks/core/useAndroidBackButton";
import { CommentsOverlayProvider, useCommentsOverlay } from "@/contexts/CommentsOverlayContext";
import CommentsOverlay from "@/components/comments/CommentsOverlay";
import PushNotificationsGate from "@/components/PushNotificationsGate";
import { unregisterPushNotifications } from "@/lib/native/push";
import type { UnifiedPost } from "@/types/post";

const { AndroidBackButton } = Back;

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
// A STABLE user object, as the real AuthProvider gives — a fresh object per
// render would re-run PushNotificationsGate's effect on every render.
const USER = { id: "viewer-1" };
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: USER, loading: false }) }));

/**
 * The REAL push module (src/lib/native/push.ts) runs, against a fake
 * FirebaseMessaging plugin that hands us its `notificationActionPerformed`
 * listener — so a test "taps" a notification exactly as the OS delivers one.
 * (Not vi.mock: a second concurrent dynamic import() of a vi.mock'd module
 * never settles under vitest, and PushNotificationsGate imports it lazily.)
 */
let tapListener: ((e: Record<string, unknown>) => void) | null = null;
const tapNotification = (data: Record<string, unknown>) => tapListener!({ notification: { data } });

const POST = {
  id: "post-1", user_id: "author-1", content: "caption", image_url: "https://example.com/p.jpg",
  image_urls: ["https://example.com/p.jpg"], privacy: "public", created_at: new Date().toISOString(),
  author_name: "A Photographer", author_avatar: null, like_count: 0, comment_count: 0, share_count: 0,
  is_liked: false, user_reaction: null, top_reactions: [], reaction_counts: {},
} as unknown as UnifiedPost;

let pressBack: (() => void) | null = null;
const exitApp = vi.fn();

beforeEach(async () => {
  // jsdom keeps ONE history stack for the whole file: let any traversal a
  // previous test queued land before this one starts.
  await new Promise((r) => setTimeout(r, 30));
  pressBack = null;
  tapListener = null;
  exitApp.mockReset();
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: {
        addListener: (_ev: string, cb: () => void) => { pressBack = cb; return { remove: () => {} }; },
        exitApp,
      },
      FirebaseMessaging: {
        requestPermissions: async () => ({ receive: "granted" }),
        getToken: async () => ({}), // no token → nothing is sent anywhere
        addListener: async (ev: string, cb: (e: Record<string, unknown>) => void) => {
          if (ev === "notificationActionPerformed") tapListener = cb;
          return { remove: () => {} };
        },
        removeAllListeners: async () => { tapListener = null; },
      },
    },
  };
  Object.defineProperty(window, "innerWidth", { value: 375, writable: true, configurable: true });
  window.dispatchEvent(new Event("resize"));
});
afterEach(async () => {
  cleanup();
  // push.ts registers once per app start (`started`); each test is a new start.
  await unregisterPushNotifications();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

const OpenButton = () => {
  const { openPostComments } = useCommentsOverlay();
  return <button onClick={() => openPostComments(POST)}>open comments</button>;
};
const GoTo = ({ to }: { to: string }) => {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go {to}</button>;
};
const Where = () => {
  const loc = useLocation();
  const type = useNavigationType();
  return (
    <>
      <div data-testid="where">{loc.pathname + loc.search}</div>
      <div data-testid="navtype">{type}</div>
    </>
  );
};
const where = () => screen.getByTestId("where").textContent;

function app(children: React.ReactNode = null) {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AndroidBackButton />
      <PushNotificationsGate />
      <CommentsOverlayProvider>
        <OpenButton />
        {children}
        <Where />
        <CommentsOverlay />
      </CommentsOverlayProvider>
    </BrowserRouter>,
  );
}

/** One press of the Android Back button, plus the time a close needs to land. */
async function press() {
  await waitFor(() => expect(pressBack).not.toBeNull());
  await act(async () => { pressBack!(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

/** A cold start: the WebView opens at `url` with nothing of ours beneath it. */
function coldStartAt(url: string) {
  window.history.pushState(null, "", url);
}

describe("comments on the feed, then Back, Back", () => {
  it("first Back closes the sheet, second Back leaves the app — never a loop", async () => {
    coldStartAt("/feed");
    app();
    fireEvent.click(screen.getByText("open comments"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await press();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(exitApp).not.toHaveBeenCalled();

    await press();
    expect(screen.queryByRole("dialog"), "Back must not re-open the thread").toBeNull();
    expect(exitApp, "at the start of the app, Back leaves it").toHaveBeenCalledTimes(1);
    expect(where()).toBe("/feed");
  });

  it("opened and closed three times in a row: still one Back to leave", async () => {
    coldStartAt("/feed");
    app();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText("open comments"));
      await press();
      await waitFor(() => expect(where()).toBe("/feed"));
    }
    await press();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });
});

describe("a notification tapped at cold start (no in-app history)", () => {
  it("puts the feed beneath the post: Back lands on the feed, the next Back leaves", async () => {
    coldStartAt("/"); // the WebView's start URL, before anything has been opened
    app();
    await waitFor(() => expect(tapListener).not.toBeNull());
    await act(async () => { tapNotification({ type: "post_comment", reference_id: "post-1" }); });
    await waitFor(() => expect(where()).toBe("/post/post-1"));

    await press();
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(exitApp).not.toHaveBeenCalled();

    await press();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("post → comments → Back ×2 → feed (the reported loop)", async () => {
    coldStartAt("/");
    app();
    await waitFor(() => expect(tapListener).not.toBeNull());
    await act(async () => { tapNotification({ type: "post_comment", reference_id: "post-1" }); });
    await waitFor(() => expect(where()).toBe("/post/post-1"));

    fireEvent.click(screen.getByText("open comments"));
    await waitFor(() => expect(where()).toBe("/post/post-1?comments=post-1"));

    await press(); // closes the sheet
    await waitFor(() => expect(where()).toBe("/post/post-1"));
    await press(); // leaves the post
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await press();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("S4-c: with the app already open on another page, a tap puts the FEED beneath the post — Back → feed → the page that was open", async () => {
    coldStartAt("/feed");
    app(<GoTo to="/profile/someone" />);
    // The listener registers ONCE per app start (push.ts's `started` flag), so
    // wait for it before moving — as on a phone, where it is long registered.
    await waitFor(() => expect(tapListener).not.toBeNull());
    fireEvent.click(screen.getByText("go /profile/someone"));
    await waitFor(() => expect(where()).toBe("/profile/someone"));
    await act(async () => { tapNotification({ type: "post_comment", reference_id: "post-1" }); });
    await waitFor(() => expect(where()).toBe("/post/post-1"));
    // The post page reads this to decide where a post that is gone should land
    // (src/pages/__tests__/postDetailBackAndGonePost.test.tsx).
    expect((window.history.state as { usr?: unknown } | null)?.usr, "the entry says how it was reached")
      .toEqual({ from: "notification", feedBeneath: true, type: "post_comment" });

    await press();
    await waitFor(() => expect(where()).toBe("/feed"));
    await press();
    await waitFor(() => expect(where()).toBe("/profile/someone"));
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("S4-c: with the app already open ON the feed, a tap opens the post straight on it — Back → that feed, no second one", async () => {
    coldStartAt("/start");
    app(<GoTo to="/feed" />);
    await waitFor(() => expect(tapListener).not.toBeNull());
    fireEvent.click(screen.getByText("go /feed"));
    await waitFor(() => expect(where()).toBe("/feed"));
    await act(async () => { tapNotification({ type: "post_reaction", reference_id: "post-1" }); });
    await waitFor(() => expect(where()).toBe("/post/post-1"));
    await press();
    await waitFor(() => expect(where()).toBe("/feed"));
    await press();
    await waitFor(() => expect(where()).toBe("/start"));
    expect(exitApp).not.toHaveBeenCalled();
  });
});

describe("the depth counter stays honest", () => {
  it("a POP that returns to the SAME router entry (a raw history entry popped, e.g. the crop dialog's) is not a screen", async () => {
    coldStartAt("/start");
    app(<GoTo to="/a" />);
    fireEvent.click(screen.getByText("go /a"));
    await waitFor(() => expect(where()).toBe("/a"));

    // ImageCropModal's pattern: a raw entry pushed outside the router, then popped.
    // Wait until the ROUTER has seen that pop (navigation type POP), or a slow
    // run would press Back before the pop and prove nothing.
    await act(async () => { window.history.pushState({ cropModal: true }, ""); });
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.getByTestId("navtype").textContent).toBe("POP"));
    expect(where()).toBe("/a");

    await press();
    await waitFor(() => expect(where()).toBe("/start"));
    expect(exitApp, "one real screen is still beneath /a — Back must go there, not leave").not.toHaveBeenCalled();
  });

  it("exposes the depth so other screens can ask 'is there in-app history?'", async () => {
    const depth = (Back as unknown as { inAppHistoryDepth?: () => number }).inAppHistoryDepth;
    expect(typeof depth, "inAppHistoryDepth must be exported").toBe("function");
    coldStartAt("/start");
    app(<GoTo to="/a" />);
    await waitFor(() => expect(depth!()).toBe(0)); // cold start: the initial POP counts for nothing
    fireEvent.click(screen.getByText("go /a"));
    await waitFor(() => expect(depth!()).toBe(1));
  });
});
