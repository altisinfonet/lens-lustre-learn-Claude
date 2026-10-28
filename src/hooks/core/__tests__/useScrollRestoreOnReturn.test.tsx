/**
 * L1 · "Feed scroll position restored exactly when returning" — the mechanism,
 * on jsdom's own `window.history` (BrowserRouter).
 *
 * jsdom lays nothing out and cannot scroll, so the WINDOW is modelled here: a
 * document height, a `scrollY`, and a `scrollTo` that clamps to that height
 * exactly as a browser does — which is the whole problem. Coming Back from a
 * short page, the document is still short when the traversal happens, so the
 * old position cannot be reached until the feed has been drawn again.
 *
 * The same thing with real layout, in real browsers, is the scroll journeys in
 * tools/uishot/nav-harness.mjs. This file pins the rules a browser run cannot
 * isolate: nothing is restored on a PUSH, a late scroll from the page being
 * left cannot overwrite the memory, and the member's own input ends a restore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useScrollRestoreOnReturn, forgetAllScroll, RESTORE_DEADLINE_MS } from "@/hooks/core/useScrollRestoreOnReturn";

const VIEWPORT = 800;
/** The modelled document: how tall it is right now, and where it is scrolled. */
let docHeight = VIEWPORT;
let y = 0;
const maxScroll = () => Math.max(0, docHeight - VIEWPORT);
/** What a browser does when the member (or a script) scrolls. */
const scrollWindowTo = (top: number) => {
  y = Math.min(Math.max(0, top), maxScroll());
  window.dispatchEvent(new Event("scroll"));
};
/** The page changes height: the browser clamps the scroll, and observers hear of it. */
let resizeListeners: Array<() => void> = [];
const setDocHeight = (h: number) => {
  docHeight = h;
  if (y > maxScroll()) scrollWindowTo(maxScroll());
  resizeListeners.slice().forEach((fn) => fn());
};
const scrollTo = vi.fn((_x: number, top: number) => scrollWindowTo(top));

beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 30)); // let a traversal queued by the previous test land
  forgetAllScroll();
  docHeight = VIEWPORT;
  y = 0;
  resizeListeners = [];
  scrollTo.mockClear();
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: scrollTo });
  class FakeResizeObserver {
    private fn: () => void;
    constructor(fn: () => void) { this.fn = fn; }
    observe() { if (!resizeListeners.includes(this.fn)) resizeListeners.push(this.fn); }
    unobserve() {}
    disconnect() { resizeListeners = resizeListeners.filter((f) => f !== this.fn); }
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
});

/** A long page that uses the hook — the feed. It is tall only once its "cards" have been drawn. */
const FeedPage = () => {
  useScrollRestoreOnReturn();
  const navigate = useNavigate();
  return <button onClick={() => navigate("/post/1")}>open a post</button>;
};
const ShortPage = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/feed")}>to the feed</button>;
};
const Where = () => <div data-testid="where">{useLocation().pathname}</div>;
const where = () => screen.getByTestId("where").textContent;

function app() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Where />
      <Routes>
        <Route path="/feed" element={<FeedPage />} />
        <Route path="*" element={<ShortPage />} />
      </Routes>
    </BrowserRouter>,
  );
}

/**
 * `waitFor` resolves the moment the DOM shows the new route — which is BEFORE
 * React has run that commit's passive effects (the hook's restore lives there).
 * Whether they had run by the next line depended on the scheduler's timing: the
 * CI flake on #434 and later runs. So arriving is "route shown AND effects
 * flushed": act() drains them.
 */
const arriveAt = async (path: string) => {
  await waitFor(() => expect(where()).toBe(path));
  await act(async () => {});
};

const back = async () => { await act(async () => { window.history.back(); }); };
const forward = async () => { await act(async () => { window.history.forward(); }); };

/**
 * The two entries a journey starts on, written as React Router writes its own
 * (`{ usr, key, idx }`) so each carries its OWN key, as every entry the app can
 * be on does. Seeding them with `null` state gave both the router's "default"
 * key: React may run the feed's unmount effects a tick after the commit, and
 * the clamp scroll from /below then matched the feed's key and was saved over
 * the feed's position (CI flake on #434, run 38600634113). Rule 2 of the hook
 * is exactly "a scroll on another entry is not saved", so the fixture must give
 * the entries different identities for that rule to be what is tested.
 */
let seeded = 0;
function seedBelowAndFeed() {
  seeded += 1;
  window.history.pushState({ usr: null, key: `below-${seeded}`, idx: 0 }, "", "/below"); // a known page beneath the feed
  window.history.pushState({ usr: null, key: `feed-${seeded}`, idx: 1 }, "", "/feed");
}

/** Feed drawn and scrolled to `top`, then a post opened on top of it (the document shrinks, the browser clamps). */
async function leaveFeedAt(top: number) {
  seedBelowAndFeed();
  app();
  act(() => { setDocHeight(6000); });
  act(() => { scrollWindowTo(top); });
  fireEvent.click(screen.getByText("open a post"));
  await arriveAt("/post/1");
  act(() => { setDocHeight(VIEWPORT); }); // the post page is one screen tall
  expect(y, "on the short page the browser has clamped the scroll").toBe(0);
}

describe("returning to the feed", () => {
  it("Back puts the feed exactly where it was left — once the feed is tall enough to be there", async () => {
    await leaveFeedAt(2400);

    await back();
    await arriveAt("/feed");
    // The traversal has happened and the feed is mounted, but nothing is drawn
    // yet: the document is still one screen tall, so 2400 cannot be reached.
    expect(y).toBe(0);

    act(() => { setDocHeight(1800); }); // the first cards arrive — still too short
    expect(y, "as far as the page allows, never past it").toBe(1000);
    act(() => { setDocHeight(6000); }); // the rest of the feed
    expect(y, "exactly where the member was").toBe(2400);
  });

  it("the page being left cannot overwrite the position: a scroll that arrives after the router moved on is not saved", async () => {
    seedBelowAndFeed();
    app();
    act(() => { setDocHeight(6000); });
    act(() => { scrollWindowTo(1500); });
    // The moment the router has pushed the next entry — and before React has
    // unmounted the feed — the browser reports a scroll to 0 (the document is
    // being replaced by a shorter one). The feed's listener is still attached.
    const realPush = window.history.pushState.bind(window.history);
    const push = vi.spyOn(window.history, "pushState").mockImplementation((...args) => {
      realPush(...args);
      scrollWindowTo(0);
    });
    fireEvent.click(screen.getByText("open a post"));
    await arriveAt("/post/1");
    push.mockRestore();
    act(() => { setDocHeight(VIEWPORT); });

    await back();
    await arriveAt("/feed");
    act(() => { setDocHeight(6000); });
    expect(y, "the 1500 the member chose — not the 0 the clamp reported").toBe(1500);
  });

  it("Forward restores as well (it is the same kind of return)", async () => {
    await leaveFeedAt(900);
    await back(); // on the feed
    await arriveAt("/feed");
    act(() => { setDocHeight(6000); });
    expect(y).toBe(900);
    act(() => { scrollWindowTo(3100); }); // the member reads further
    await back(); // below the feed
    await arriveAt("/below");
    act(() => { setDocHeight(VIEWPORT); });
    await forward();
    await arriveAt("/feed");
    act(() => { setDocHeight(6000); });
    expect(y).toBe(3100);
  });
});

describe("what a restore must never do", () => {
  it("a FRESH visit (a push) is never moved, though a position is remembered for an older visit", async () => {
    await leaveFeedAt(2400);
    scrollTo.mockClear();
    // From the post, a link to the feed: a NEW entry, not a return.
    fireEvent.click(screen.getByText("to the feed"));
    await arriveAt("/feed");
    act(() => { setDocHeight(6000); });
    expect(scrollTo, "nothing scrolls a page the member has just opened").not.toHaveBeenCalled();
    expect(y).toBe(0);

    // …and the older visit is still restored when the member goes Back to it.
    await back(); // the post
    await arriveAt("/post/1");
    act(() => { setDocHeight(VIEWPORT); });
    await back(); // the feed, as it was first left
    await arriveAt("/feed");
    act(() => { setDocHeight(6000); });
    expect(y).toBe(2400);
  });

  it("the member's own touch ends the restore: a page still growing no longer drags them back", async () => {
    await leaveFeedAt(2400);
    await back();
    await arriveAt("/feed");
    act(() => { setDocHeight(1800); });
    expect(y).toBe(1000);

    fireEvent.touchStart(window); // a thumb on the screen
    act(() => { scrollWindowTo(300); }); // …scrolling up
    act(() => { setDocHeight(6000); }); // the rest of the feed arrives late
    expect(y, "the member's position wins").toBe(300);
  });

  it("it gives up at its deadline: late growth after that moves nothing, and the observer is released", async () => {
    await leaveFeedAt(2400);
    await back();
    await arriveAt("/feed");
    act(() => { setDocHeight(1800); });
    expect(y).toBe(1000);
    expect(resizeListeners.length, "watching while the restore is live").toBe(1);

    await act(async () => { await new Promise((r) => setTimeout(r, RESTORE_DEADLINE_MS + 100)); });
    expect(resizeListeners.length, "released at the deadline").toBe(0);
    act(() => { setDocHeight(6000); });
    expect(y, "not moved after the deadline").toBe(1000);
  }, RESTORE_DEADLINE_MS + 5000);
});
