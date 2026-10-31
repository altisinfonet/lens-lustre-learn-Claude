/**
 * The feed window has to be proved on two axes, and the second one matters more.
 *
 *   1. It CULLS — otherwise it does nothing and the OOM is still there.
 *   2. It FAILS OPEN — a windowing bug must degrade to "uses more memory",
 *      never to "the feed is blank". A blank feed is the single most damaging
 *      thing this app can show, and it is exactly what a broken culler
 *      produces.
 *
 * jsdom has no real layout, so `getBoundingClientRect` is stubbed per test.
 * That is not a weakness here — height measurement is precisely the input this
 * component branches on, so driving it directly is the point.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import FeedCardWindow, { EAGER_CARDS } from "@/components/feed/FeedCardWindow";

/** Captures the observer so a test can drive intersection by hand. */
let fire: ((isIntersecting: boolean) => void) | null = null;
/** Several entries for the same card in ONE callback, oldest first (as browsers deliver them). */
let fireBatch: ((states: boolean[]) => void) | null = null;
let observed = 0;
let disconnected = 0;

class FakeIO {
  cb: (e: { isIntersecting: boolean }[]) => void;
  constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
    this.cb = cb;
    fire = (isIntersecting) => act(() => { this.cb([{ isIntersecting }]); });
    fireBatch = (states) => act(() => { this.cb(states.map((isIntersecting) => ({ isIntersecting }))); });
  }
  observe() { observed++; }
  disconnect() { disconnected++; }
  unobserve() {}
  takeRecords() { return []; }
  root = null; rootMargin = ""; thresholds = [];
}

/** Force every element to report a height, the way real layout would. */
function stubHeight(px: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: px, width: 400, top: 0, left: 0, right: 400, bottom: px, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  fire = null; fireBatch = null; observed = 0; disconnected = 0;
  vi.stubGlobal("IntersectionObserver", FakeIO as unknown as typeof IntersectionObserver);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the feed window culls what nobody can see", () => {
  it("renders its children to begin with — a card must exist before it can be measured", () => {
    stubHeight(600);
    render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    expect(screen.getByText("post body")).toBeInTheDocument();
    expect(observed).toBe(1);
  });

  it("drops the children once the card leaves the window", () => {
    stubHeight(600);
    render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    fire!(false);
    expect(screen.queryByText("post body")).toBeNull();
  });

  it("holds the exact measured height open, so nothing below it jumps", () => {
    // A scroll jump under the member's thumb is worse than the memory saved.
    stubHeight(742);
    const { container } = render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    fire!(false);
    expect((container.firstChild as HTMLElement).style.height).toBe("742px");
  });

  it("brings the children back when the card returns", () => {
    stubHeight(600);
    render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    fire!(false);
    expect(screen.queryByText("post body")).toBeNull();
    fire!(true);
    expect(screen.getByText("post body")).toBeInTheDocument();
  });

  it("keeps observing the wrapper after culling — or the card could never come back", () => {
    // The wrapper must survive; only its children go. Observing a node you also
    // unmount is how a window gets permanently stuck empty.
    stubHeight(600);
    const { container } = render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    fire!(false);
    expect(container.firstChild).not.toBeNull();
    expect(disconnected).toBe(0);
  });
});

describe("⚠ it fails open — every one of these must keep the card on screen", () => {
  it("never culls a card whose height measures 0 (not laid out yet)", () => {
    // Collapsing an unmeasured card to nothing would yank the scroll position.
    stubHeight(0);
    render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    fire!(false);
    expect(screen.getByText("post body")).toBeInTheDocument();
  });

  it("never culls an eager card, however far off screen it goes", () => {
    stubHeight(600);
    render(<FeedCardWindow eager><p>post body</p></FeedCardWindow>);
    expect(observed).toBe(0);          // not even observed
    expect(screen.getByText("post body")).toBeInTheDocument();
  });

  it("renders everything when IntersectionObserver does not exist", () => {
    // Old WebView, jsdom, anything unexpected: behave exactly as before this
    // component existed.
    vi.unstubAllGlobals();
    // Deliberately removing the API. `delete` on an optional global is legal
    // here, so the previous `@ts-expect-error` was itself the error (TS2578) —
    // masked for as long as CI type-checked zero files.
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    stubHeight(600);
    render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    expect(screen.getByText("post body")).toBeInTheDocument();
  });

  it("reads the NEWEST entry when the browser batches several (fast scroll / fling)", () => {
    // Owner report 2026-10-29: "many posts are not coming, showing black" — a
    // full card-height blank in the middle of the screen, web and app. When a
    // card leaves and comes back between two observer callbacks, the browser
    // hands over BOTH entries in one call, oldest first. Reading entries[0]
    // acted on the stale "left" and hid a card that is on screen; no further
    // callback comes (its state does not change again), so it stayed blank.
    stubHeight(600);
    render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    fireBatch!([false, true]);
    expect(screen.getByText("post body")).toBeInTheDocument();
  });

  it("a culled card that moves into the top (becomes eager) shows its post again", () => {
    // Owner report 2026-10-29 (second): blank posts 1–2, right above the
    // first ad, after the newest-entry fix was live. The feed keeps each card
    // by post id; when it refreshes and reorders, a card culled further down
    // can land in the top three and be handed `eager`. The eager branch
    // stopped observing but never set `mounted` back, so that card stayed an
    // empty box for good.
    stubHeight(600);
    const { rerender } = render(<FeedCardWindow><p>post body</p></FeedCardWindow>);
    fire!(false);
    expect(screen.queryByText("post body")).toBeNull();
    rerender(<FeedCardWindow eager><p>post body</p></FeedCardWindow>);
    expect(screen.getByText("post body")).toBeInTheDocument();
  });

  it("keeps a sensible number of cards eager at the top of the feed", () => {
    // Not zero (the first screenful would churn where it is most visible) and
    // not so many that culling stops mattering.
    expect(EAGER_CARDS).toBeGreaterThanOrEqual(1);
    expect(EAGER_CARDS).toBeLessThanOrEqual(10);
  });
});
