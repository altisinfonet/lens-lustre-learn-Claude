/**
 * VID-1 part 2 · the feed video card, as the member meets it (R-105):
 *   • a 9:16 card filling the post's width (capped at 85 % of the screen height); the video is fitted
 *     whole and anything it does not cover shows a blurred copy of its poster (Owner 2026-10-12);
 *   • a control bar: play/pause, a seek bar that can be dragged, elapsed / total time, sound;
 *   • nothing is fetched for a card that is nowhere near the screen;
 *   • muted autoplay when in view, pause when out of view, pause when the tab hides, no autoplay offline / reduced motion;
 *   • one card plays at a time; a failed token shows a calm message, never a crash.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } },
}));
const net = { online: true, slow: false, reason: null as string | null };
const listeners = new Set<() => void>();
vi.mock("@/lib/offline/networkQuality", () => ({
  getNetState: () => net,
  subscribeNetState: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); },
}));

import FeedVideoCard, { formatClock } from "../FeedVideoCard";
import { resetPlayback } from "@/lib/video/playback";

type IO = { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; el?: Element };
let observers: IO[] = [];
class FakeIO {
  io: IO;
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { this.io = { cb, opts }; observers.push(this.io); }
  observe(el: Element) { this.io.el = el; }
  disconnect() { observers = observers.filter((o) => o !== this.io); }
  unobserve() {}
  takeRecords() { return []; }
}
const view = () => observers.find((o) => Array.isArray(o.opts?.threshold))!;
const nearObs = () => observers.find((o) => !Array.isArray(o.opts?.threshold))!;
const fire = (o: IO, ratio: number, isIntersecting = ratio > 0) =>
  act(() => { o.cb([{ intersectionRatio: ratio, isIntersecting, target: o.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });

const GRANT = { master_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/master.m3u8?t=x", poster_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/poster.jpg?t=x", expires_at: Math.floor(Date.now() / 1000) + 900 };
let fetchMock: ReturnType<typeof vi.fn>;
let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

const vid = (over: Partial<{ id: string; width: number | null; height: number | null }> = {}) =>
  ({ id: "33333333-3333-4333-8333-333333333333", width: 1080, height: 1920, durationS: 20, hasAudio: true, ...over });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  observers = []; listeners.clear(); resetPlayback();
  net.online = true; net.slow = false;
  vi.stubGlobal("IntersectionObserver", FakeIO);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(GRANT), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  playSpy = vi.fn(async () => {});
  pauseSpy = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playSpy });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pauseSpy });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", { configurable: true, value: () => "maybe" }); // native HLS path: no hls.js in jsdom
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => vi.unstubAllGlobals());

describe("the 9:16 card (R-105)", () => {
  it("the card fills the post's width (no empty strip beside it), 9:16, capped by the screen height", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(nearObs(), 0.1); await flush();
    const card = screen.getByTestId("feed-video-card");
    expect(card.getAttribute("data-frame-aspect")).toBe("0.563");
    expect(card.style.width).toBe("100%");
    expect(card.style.maxHeight).toMatch(/85dvh/);
    expect(card.className).not.toMatch(/max-w-|mx-auto/); // the old narrow 9:16 strip
    // When the cap makes the card wider than the video, the poster's blur fills the sides.
    expect(card.getAttribute("data-fill")).toBe("blurred");
    expect(screen.getByTestId("feed-video-fill")).toBeTruthy();
    expect(card.querySelector("video")!.className).toContain("object-contain");
  });
  it("a 16:9 video is fitted whole (object-contain) over a blurred fill, in the same 9:16 card", async () => {
    render(<FeedVideoCard video={vid({ width: 1280, height: 720 })} />);
    fire(nearObs(), 0.1); await flush();
    const card = screen.getByTestId("feed-video-card");
    expect(card.getAttribute("data-frame-aspect")).toBe("0.563");
    expect(card.getAttribute("data-fill")).toBe("blurred");
    expect(screen.getByTestId("feed-video-fill")).toBeTruthy();
    const v = card.querySelector("video")!;
    expect(v.className).toContain("object-contain");
    expect(v.className).not.toContain("object-cover"); // never cropped
  });
  it("a 1:1 video is fitted too", async () => {
    render(<FeedVideoCard video={vid({ width: 1000, height: 1000 })} />);
    expect(screen.getByTestId("feed-video-card").getAttribute("data-fill")).toBe("blurred");
  });
});

describe("autoplay rules", () => {
  it("a card nowhere near the screen asks for nothing", async () => {
    render(<FeedVideoCard video={vid()} />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
  });
  it("near the screen: the poster is fetched, nothing plays", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(nearObs(), 0, true); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/video/play-token");
    expect(playSpy).not.toHaveBeenCalled();
  });
  it("in view → plays, muted", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(view(), 1); await flush();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("feed-video-card").querySelector("video")!.muted).toBe(true);
  });
  it("in view then out of view → pauses", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(view(), 1); await flush();
    fire(view(), 0); await flush();
    expect(pauseSpy).toHaveBeenCalled();
  });
  it("only a sliver in view → does not start", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(view(), 0.2); await flush();
    expect(playSpy).not.toHaveBeenCalled();
  });
  it("the tab hides while playing → pauses", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(view(), 1); await flush();
    pauseSpy.mockClear();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(pauseSpy).toHaveBeenCalled();
  });
  it("offline → no autoplay", async () => {
    net.online = false;
    render(<FeedVideoCard video={vid()} />);
    fire(view(), 1); await flush();
    expect(playSpy).not.toHaveBeenCalled();
  });
  it("reduced motion → no autoplay, a Play button instead", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    render(<FeedVideoCard video={vid()} />);
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(playSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });
  it("autoplay refused by the browser → a Play button, no crash", async () => {
    playSpy.mockRejectedValueOnce(new Error("NotAllowedError"));
    render(<FeedVideoCard video={vid()} />);
    fire(view(), 1); await flush();
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });
  it("two cards: the second to start pauses the first", async () => {
    render(<><FeedVideoCard video={vid({ id: "a3333333-3333-4333-8333-333333333333" })} /><FeedVideoCard video={vid({ id: "b3333333-3333-4333-8333-333333333333" })} /></>);
    const [v1, v2] = observers.filter((o) => Array.isArray(o.opts?.threshold));
    fire(v1, 1); await flush();
    pauseSpy.mockClear();
    fire(v2, 1); await flush();
    expect(pauseSpy).toHaveBeenCalled();
  });
  it("the token request failing → calm message, nothing plays", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    render(<FeedVideoCard video={vid()} />);
    fire(view(), 1); await flush();
    expect(screen.getByRole("status").textContent).toMatch(/can't play/);
    expect(playSpy).not.toHaveBeenCalled();
  });
  it("the sound button is the viewer's choice and starts off", async () => {
    render(<FeedVideoCard video={vid()} />);
    const b = screen.getByRole("button", { name: "Turn sound on" });
    fireEvent.click(b);
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy();
  });
  it("a video with no audio has no sound button", () => {
    render(<FeedVideoCard video={{ ...vid(), hasAudio: false }} />);
    expect(screen.queryByRole("button", { name: /sound/ })).toBeNull();
  });
});

describe("the control bar (Owner 2026-10-12: drag to move through the video)", () => {
  it("shows a seek bar and the total length before anything plays", () => {
    render(<FeedVideoCard video={{ ...vid(), durationS: 448 }} />);
    const seek = screen.getByRole("slider", { name: "Seek" }) as HTMLInputElement;
    expect(seek.max).toBe("448");
    expect(screen.getByTestId("video-clock").textContent).toBe("0:00 / 7:28");
  });

  it("dragging the bar on a playing video moves it to that point", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    const v = screen.getByTestId("feed-video-card").querySelector("video")!;
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "12.5" } });
    expect(v.currentTime).toBe(12.5);
    expect(screen.getByTestId("video-clock").textContent).toBe("0:12 / 0:20");
  });

  it("dragging before it has started starts it at that point", async () => {
    render(<FeedVideoCard video={vid()} />);
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "8" } });
    await flush();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("feed-video-card").querySelector("video")!.currentTime).toBe(8);
  });

  it("a tap on the bar never toggles playback (only the picture does)", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    pauseSpy.mockClear();
    fireEvent.click(screen.getByTestId("video-controls"));
    expect(pauseSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("feed-video-card").querySelector("video")!);
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("the bar's own play/pause button works", async () => {
    render(<FeedVideoCard video={vid()} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await flush();
    expect(playSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("formatClock", () => {
    expect([formatClock(0), formatClock(7.9), formatClock(448), formatClock(3725), formatClock(NaN)]).toEqual(["0:00", "0:07", "7:28", "1:02:05", "0:00"]);
  });
});

describe("a video longer than the 15-minute play token (no time limit)", () => {
  let perf = 1_000_000;
  beforeEach(() => { perf = 1_000_000; vi.spyOn(performance, "now").mockImplementation(() => perf); });
  afterEach(() => vi.restoreAllMocks());

  it("the token is renewed mid-play, 90 s before its 15 minutes end on the DEVICE clock, and the stream goes on at the same second", async () => {
    render(<FeedVideoCard video={{ ...vid(), durationS: 3600 }} />);
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    const v = screen.getByTestId("feed-video-card").querySelector("video")!;
    const callsBefore = fetchMock.mock.calls.length;
    v.currentTime = 840;
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...GRANT, master_url: GRANT.master_url.replace("t=x", "t=renewed") }), { status: 200 }));
    perf += 14 * 60 * 1000; // 14 minutes of playback later
    await act(async () => { v.dispatchEvent(new Event("timeupdate")); });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
    expect(v.src).toContain("t=renewed");
    expect(v.currentTime).toBe(840);
  });

  it("a token with plenty of time left is not renewed on every timeupdate", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    const n = fetchMock.mock.calls.length;
    const v = screen.getByTestId("feed-video-card").querySelector("video")!;
    for (let k = 0; k < 5; k++) { perf += 1000; await act(async () => { v.dispatchEvent(new Event("timeupdate")); }); }
    expect(fetchMock.mock.calls.length).toBe(n);
  });

  it("C6: a phone whose wall clock runs 14 minutes fast does not renew at all (Date.now is not the token clock)", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    const n = fetchMock.mock.calls.length;
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 14 * 60 * 1000);
    const v = screen.getByTestId("feed-video-card").querySelector("video")!;
    for (let k = 0; k < 5; k++) await act(async () => { v.dispatchEvent(new Event("timeupdate")); });
    expect(fetchMock.mock.calls.length).toBe(n);
  });
});
