/**
 * L1 · THE POST PAGE A NOTIFICATION OPENS: where its own "← Back" goes, and
 * what happens when the post is gone. REV4 plan §6 Stage L1, "cold-start
 * notification fallback".
 *
 * The REAL PostDetail, the REAL PushNotificationsGate and push module, the
 * REAL AndroidBackButton, on jsdom's own `window.history` (BrowserRouter) with
 * a fake Capacitor that hands this file the two listeners the app registers —
 * so a test taps a notification and presses Back exactly as the OS does. The
 * database answers "no such post" (the post was deleted, hidden, or was never
 * this member's to see — PostDetail cannot tell which and does not need to).
 *
 * Before L1: the tap navigated straight to /post/<id>. At a cold start nothing
 * of ours was beneath it, the page said "Post not found", and "Go back" was
 * `navigate(-1)` into whatever the WebView had lying there.
 *
 * Now: a cold-start tap puts the feed beneath the post; a post that is gone
 * lands on the feed with a short notice; and the page's own Back goes to the
 * feed when there is no in-app history to step back into.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AndroidBackButton } from "@/hooks/core/useAndroidBackButton";
import PushNotificationsGate from "@/components/PushNotificationsGate";
import { unregisterPushNotifications } from "@/lib/native/push";
import PostDetail from "@/pages/PostDetail";

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/core/use-toast", async (original) => ({
  ...(await original<typeof import("@/hooks/core/use-toast")>()),
  toast: toastSpy,
}));

/** PostgREST answering "no row" to every read — the post is not there. */
vi.mock("@/integrations/supabase/client", () => {
  const none = { data: null, error: null, count: 0 };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => none;
  chain.single = async () => none;
  chain.then = (resolve: (v: typeof none) => unknown) => Promise.resolve(none).then(resolve);
  return {
    supabase: {
      from: () => chain,
      rpc: async () => none,
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    },
  };
});

const USER = { id: "viewer-1" };
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: USER, loading: false }) }));
vi.mock("@/hooks/core/useBlockedUsers", () => ({
  useBlockedUsers: () => ({
    blockedIds: new Set<string>(), blockedRows: [], isBlocked: () => false, block: () => {},
    unblock: () => {}, blocking: false, unblocking: false, isLoading: false,
  }),
}));
vi.mock("@/hooks/feed/usePostReactionMutations", () => ({
  useReactToPost: () => ({ mutate: vi.fn(), isPending: false }),
  useUnreactToPost: () => ({ mutate: vi.fn(), isPending: false }),
}));

const GONE = "00000000-0000-4000-8000-00000000dead";
const NOTICE = "That post is no longer available.";

let tapListener: ((e: Record<string, unknown>) => void) | null = null;
let pressBack: (() => void) | null = null;
const exitApp = vi.fn();
const tapNotification = (data: Record<string, unknown>) => tapListener!({ notification: { data } });

beforeEach(async () => {
  // jsdom keeps ONE history stack for the whole file: let any traversal a
  // previous test queued land before this one starts.
  await new Promise((r) => setTimeout(r, 30));
  tapListener = null;
  pressBack = null;
  exitApp.mockReset();
  toastSpy.mockReset();
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
});
afterEach(async () => {
  cleanup();
  await unregisterPushNotifications(); // push.ts registers once per app start; each test is a new start
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
};
const where = () => screen.getByTestId("where").textContent;
const GoTo = ({ to }: { to: string }) => {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go {to}</button>;
};

function app() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AndroidBackButton />
      <PushNotificationsGate />
      <Where />
      <Routes>
        <Route path="/post/:postId" element={<PostDetail />} />
        <Route path="*" element={<><GoTo to="/profile/someone" /><GoTo to={`/post/${GONE}`} /></>} />
      </Routes>
    </BrowserRouter>,
  );
}

/** A cold start: the WebView opens at `url` with nothing of ours beneath it. */
function coldStartAt(url: string) {
  window.history.pushState(null, "", url);
}

/** One press of the Android Back button, plus the time a navigation needs to land. */
async function press() {
  await waitFor(() => expect(pressBack).not.toBeNull());
  await act(async () => { pressBack!(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

describe("a notification about a post that is gone", () => {
  it("tapped at cold start: lands on the feed with a short notice, and Back then leaves the app", async () => {
    coldStartAt("/");
    app();
    await waitFor(() => expect(tapListener).not.toBeNull());
    await act(async () => { tapNotification({ type: "post_comment", reference_id: GONE }); });

    await waitFor(() => expect(where()).toBe("/feed"));
    expect(toastSpy, "the member is told why they are on the feed").toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toMatchObject({ title: NOTICE });

    await press();
    expect(exitApp, "the feed is the bottom of the stack — Back leaves, it does not return to a dead post").toHaveBeenCalledTimes(1);
    expect(where()).toBe("/feed");
  });

  it("tapped with in-app history beneath: the dead post's entry BECOMES the feed, so Back returns to where the member was", async () => {
    coldStartAt("/feed");
    app();
    await waitFor(() => expect(tapListener).not.toBeNull());
    fireEvent.click(screen.getByText("go /profile/someone"));
    await waitFor(() => expect(where()).toBe("/profile/someone"));
    const lenBefore = window.history.length;

    await act(async () => { tapNotification({ type: "post_comment", reference_id: GONE }); });
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(toastSpy.mock.calls[0][0]).toMatchObject({ title: NOTICE });
    expect(window.history.length, "the tap's one entry was replaced, not added to").toBe(lenBefore + 1);

    await press();
    await waitFor(() => expect(where()).toBe("/profile/someone"));
    expect(exitApp).not.toHaveBeenCalled();
  });
});

describe("the post page's own Back, when the post was reached WITHOUT a notification", () => {
  it("an outside link (nothing of ours beneath): 'Go back' goes to the feed and adds no step; opened in-app it steps back", async () => {
    coldStartAt(`/post/${GONE}`);
    app();
    const goBack = await screen.findByRole("button", { name: "Go back" });
    expect(where(), "a plain link to a missing post stays put and says so").toBe(`/post/${GONE}`);
    expect(toastSpy).not.toHaveBeenCalled();
    const lenBefore = window.history.length;

    fireEvent.click(goBack);
    await waitFor(() => expect(where()).toBe("/feed"));
    expect(window.history.length, "the fallback REPLACES this entry").toBe(lenBefore);

    // The other half of the same rule, so the fallback cannot over-reach: with
    // in-app history beneath, the page's Back is ONE STEP BACK — not a second
    // feed entry laid over the post. If it replaced here too, the count of our
    // own screens would still be 1 and the Back press below would not leave.
    fireEvent.click(screen.getByText(`go /post/${GONE}`));
    fireEvent.click(await screen.findByRole("button", { name: "Go back" }));
    await waitFor(() => expect(where()).toBe("/feed"));
    await press();
    expect(exitApp, "one step back was taken, so the feed is the bottom again").toHaveBeenCalledTimes(1);
  });
});
