/**
 * Owner 2026-10-18, testing Android app 1.2.23: the video plays, but
 *   (1) the progress bar must look like Meta's — thin, translucent, HIDDEN by default,
 *       shown by a tap, gone again a moment later;
 *   (2) it must AUTOPLAY in the app, WITH SOUND by default, like the Instagram app.
 * The web keeps the browser rule (muted autoplay) until the member unmutes once.
 *
 * Written against the real FeedVideoCard (the one player every surface uses). Everything this
 * file needs from the new rules is reached through `import * as pb`, so the file also runs
 * against the old card and FAILS there (docs/evidence/d2/video-player-meta/fail-first.txt).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } },
}));
vi.mock("@/lib/offline/networkQuality", () => ({
  getNetState: () => ({ online: true, slow: false, reason: null }),
  subscribeNetState: () => () => {},
}));
// hls.js stand-in: records what it is given (jsdom has no MediaSource of its own).
const hlsLog: string[] = [];
vi.mock("hls.js", () => ({
  default: class {
    static isSupported() { return true; }
    levels = []; autoLevelCapping = -1; startLevel = 0;
    on() {} startLoad() {} destroy() {}
    loadSource(u: string) { hlsLog.push(`load ${u}`); }
    attachMedia(v: HTMLVideoElement) { hlsLog.push("attach"); v.setAttribute("src", "blob:https://localhost/ms"); }
  },
}));
vi.mock("hls.js/dist/hls.worker.js?url", () => ({ default: "/assets/hls.worker.js" }));

import FeedVideoCard from "../FeedVideoCard";
import * as pb from "@/lib/video/playback";
import { resetGrantCache } from "@/lib/video/playGrant";

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
const views = () => observers.filter((o) => Array.isArray(o.opts?.threshold));
const fire = (o: IO, ratio: number) =>
  act(() => { o.cb([{ intersectionRatio: ratio, isIntersecting: ratio > 0, target: o.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

const GRANT = { master_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/master.m3u8?t=x", poster_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/poster.jpg?t=x", expires_at: Math.floor(Date.now() / 1000) + 900 };
const vid = (id = "33333333-3333-4333-8333-333333333333") => ({ id, width: 1080, height: 1920, durationS: 20, hasAudio: true });
/** `muted` of the element at the moment each play() was called. */
let mutedAtPlay: boolean[];
let playImpl: (v: HTMLMediaElement) => Promise<void>;
let pauseSpy: ReturnType<typeof vi.fn>;
let canPlayHls: string;

function asApp() {
  (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
}
const card = (i = 0) => screen.getAllByTestId("feed-video-card")[i];
const videoEl = (i = 0) => card(i).querySelector("video")!;
const controls = (i = 0) => screen.getAllByTestId("video-controls")[i];

beforeEach(() => {
  observers = []; hlsLog.length = 0; mutedAtPlay = [];
  pb.resetPlayback(); resetGrantCache(); (pb as { resetSoundPref?: () => void }).resetSoundPref?.();
  try { sessionStorage.clear(); } catch { /* */ }
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  delete (window as unknown as { MediaSource?: unknown }).MediaSource;
  canPlayHls = "maybe"; // jsdom has no HLS: the old card's native path
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(GRANT), { status: 200 })));
  playImpl = async () => {};
  pauseSpy = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value(this: HTMLMediaElement) { mutedAtPlay.push(this.muted); return playImpl(this); } });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pauseSpy });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", { configurable: true, value: () => canPlayHls });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.useRealTimers();
  delete (navigator as unknown as { userActivation?: unknown }).userActivation;
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  delete (window as unknown as { MediaSource?: unknown }).MediaSource;
});

describe("the app (Capacitor Android): autoplay WITH sound", () => {
  it("in view → it starts by itself, with sound, no tap", async () => {
    asApp();
    render(<FeedVideoCard video={vid()} />);
    fire(views()[0], 1); await flush();
    expect(mutedAtPlay).toEqual([false]);
    expect(videoEl().muted).toBe(false);
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy();
  });

  it("the Android WebView answers 'maybe' to HLS: the card still uses hls.js (MSE), never the WebView's own player", async () => {
    asApp();
    (window as unknown as { MediaSource?: unknown }).MediaSource = function MediaSource() {};
    render(<FeedVideoCard video={vid()} />);
    fire(views()[0], 1); await flush();
    expect(hlsLog).toEqual([`load ${GRANT.master_url}`, "attach"]);
    expect(videoEl().getAttribute("src")).not.toBe(GRANT.master_url);
  });

  it("a refused first play() (AbortError — the load it waited on was replaced) is tried again, not turned into a Play button", async () => {
    asApp();
    let n = 0;
    playImpl = async (v) => { if (n++ === 0) { setTimeout(() => v.dispatchEvent(new Event("canplay")), 0); throw new DOMException("interrupted by a new load request", "AbortError"); } };
    render(<FeedVideoCard video={vid()} />);
    fire(views()[0], 1);
    await flush(); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); await flush();
    expect(mutedAtPlay.length).toBe(2);
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
    expect(card().getAttribute("data-playing")).toBe("true");
  });

  it("the member mutes → the sound button changes the sound only (no pause, no restart) — and the next video starts muted", async () => {
    asApp();
    render(<><FeedVideoCard video={vid("a3333333-3333-4333-8333-333333333333")} /><FeedVideoCard video={vid("b3333333-3333-4333-8333-333333333333")} /></>);
    const [v1, v2] = views();
    fire(v1, 1); await flush();
    pauseSpy.mockClear();
    const plays = mutedAtPlay.length;
    fireEvent.click(videoEl(0)); // a tap shows the controls
    fireEvent.click(screen.getAllByRole("button", { name: "Turn sound off" })[0]);
    expect(videoEl(0).muted).toBe(true);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(mutedAtPlay.length).toBe(plays);
    fire(v1, 0); fire(v2, 1); await flush();
    expect(mutedAtPlay[mutedAtPlay.length - 1]).toBe(true); // the session remembers "muted"
  });
});

describe("the web: the browser's autoplay rule", () => {
  it("in view → starts by itself, MUTED", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(views()[0], 1); await flush();
    expect(mutedAtPlay).toEqual([true]);
  });

  it("after the member unmutes once, the next video autoplays WITH sound (page already activated)", async () => {
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: true, isActive: false } });
    render(<><FeedVideoCard video={vid("a3333333-3333-4333-8333-333333333333")} /><FeedVideoCard video={vid("b3333333-3333-4333-8333-333333333333")} /></>);
    const [v1, v2] = views();
    fire(v1, 1); await flush();
    fireEvent.click(videoEl(0));
    fireEvent.click(screen.getAllByRole("button", { name: "Turn sound on" })[0]);
    expect(videoEl(0).muted).toBe(false);
    fire(v1, 0); fire(v2, 1); await flush();
    expect(mutedAtPlay[mutedAtPlay.length - 1]).toBe(false);
  });

  it("the browser refuses play-with-sound → the video starts muted instead: no Play button, no paused card", async () => {
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: true, isActive: false } });
    sessionStorage.setItem("50mm.video.sound", "on");
    playImpl = async (v) => { if (!v.muted) throw new DOMException("play() failed because the user didn't interact", "NotAllowedError"); };
    render(<FeedVideoCard video={vid()} />);
    fire(views()[0], 1); await flush();
    expect(mutedAtPlay).toEqual([false, true]);
    expect(card().getAttribute("data-playing")).toBe("true");
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
  });

  it("only ONE video plays: the second to come into view pauses the first", async () => {
    render(<><FeedVideoCard video={vid("a3333333-3333-4333-8333-333333333333")} /><FeedVideoCard video={vid("b3333333-3333-4333-8333-333333333333")} /></>);
    const [v1, v2] = views();
    fire(v1, 1); await flush();
    pauseSpy.mockClear();
    fire(v2, 1); await flush();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(card(0).getAttribute("data-playing")).toBe("false");
    expect(card(1).getAttribute("data-playing")).toBe("true");
  });
});

describe("Meta-style controls", () => {
  it("HIDDEN by default — also while it plays", async () => {
    render(<FeedVideoCard video={vid()} />);
    expect(controls().getAttribute("data-visible")).toBe("false");
    expect(controls().className).toMatch(/opacity-0/);
    fire(views()[0], 1); await flush();
    expect(controls().getAttribute("data-visible")).toBe("false");
  });

  it("a tap on the picture shows them; ~2.5 s later they fade away again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<FeedVideoCard video={vid()} />);
    fire(views()[0], 1); await flush();
    fireEvent.click(videoEl());
    expect(controls().getAttribute("data-visible")).toBe("true");
    expect(controls().className).toMatch(/opacity-100/);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(controls().getAttribute("data-visible")).toBe("true");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(controls().getAttribute("data-visible")).toBe("false");
  });

  it("the progress bar is thin and translucent to the eye, with a ≥ 44 px touch area; seeking works while shown", async () => {
    render(<FeedVideoCard video={vid()} />);
    fire(views()[0], 1); await flush();
    fireEvent.click(videoEl());
    const track = screen.getByTestId("video-progress-track");
    expect(track.className).toMatch(/h-\[(2|2\.5|3)px\]/);
    expect(track.className).toMatch(/bg-white\/\d\d/);
    expect(screen.getByTestId("video-progress").className).toMatch(/h-11/); // 44 px
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "12.5" } });
    expect(videoEl().currentTime).toBe(12.5);
  });

  it("buttons keep their names and 44 px targets", async () => {
    render(<FeedVideoCard video={vid()} />);
    for (const name of ["Play", "Turn sound on"]) expect(screen.getByRole("button", { name }).className).toMatch(/h-11 w-11/);
  });
});
