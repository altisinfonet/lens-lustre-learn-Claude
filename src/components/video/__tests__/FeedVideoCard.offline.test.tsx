/**
 * S7b-6 · the feed video card with no network.
 *
 * Gate: in flight mode "saved videos play" — a video the member scrolled to
 * while online plays from the phone (its first ≥ 25 s); one with nothing saved
 * keeps today's calm poster/Play state. Online, a card that got its play token
 * hands the video to the background saver (which applies the budget / Wi-Fi
 * rules itself). The phone copy plays through hls.js with the loader that reads
 * the phone — never the native player, which cannot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt", user: { id: "member-1" } } } }) } },
}));
const net = { online: true, slow: false, reason: null as string | null };
vi.mock("@/lib/offline/networkQuality", () => ({
  getNetState: () => net,
  subscribeNetState: () => () => {},
}));

/* hls.js: a fake that records how it was set up */
const hlsLog = vi.hoisted(() => ({ instances: [] as Array<{ config: Record<string, unknown>; source?: string; handlers: Record<string, (...a: unknown[]) => void> }> }));
vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() { return true; }
    static DefaultConfig = { loader: class DefaultLoader {} };
    levels: unknown[] = [];
    autoLevelCapping = -1;
    rec: { config: Record<string, unknown>; source?: string; handlers: Record<string, (...a: unknown[]) => void> };
    constructor(config: Record<string, unknown>) { this.rec = { config, handlers: {} }; hlsLog.instances.push(this.rec); }
    on(ev: string, f: (...a: unknown[]) => void) { this.rec.handlers[ev] = f; }
    loadSource(u: string) { this.rec.source = u; }
    attachMedia() {}
    destroy() {}
  }
  return { default: FakeHls };
});
vi.mock("hls.js/dist/hls.worker.js?url", () => ({ default: "/assets/hls.worker.js" }));

/* the phone's saved copies */
const saved = vi.hoisted(() => ({ ids: new Set<string>(), saveCalls: [] as unknown[] }));
vi.mock("@/lib/video/offlineVideo", () => ({
  hasSavedPreview: (id: string) => saved.ids.has(id),
  savedPreviewUrl: (id: string) => (saved.ids.has(id) ? `https://saved-video.invalid/member-1/${id}/master.m3u8` : null),
  savedPreviewInfo: (id: string) => (saved.ids.has(id) ? { seconds: 28, full: false } : null),
  offlineLoaderFor: (Base: unknown) => { const L = class PhoneLoader { static base = Base; }; return L; },
  maybeSaveVideoPreview: (...a: unknown[]) => { saved.saveCalls.push(a); },
}));

import FeedVideoCard from "../FeedVideoCard";
import { resetPlayback, resetSoundPref } from "@/lib/video/playback";
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
const view = () => observers.find((o) => Array.isArray(o.opts?.threshold))!;
const nearObs = () => observers.find((o) => !Array.isArray(o.opts?.threshold))!;
const fire = (o: IO, ratio: number) =>
  act(() => { o.cb([{ intersectionRatio: ratio, isIntersecting: ratio > 0, target: o.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

const ID = "33333333-3333-4333-8333-333333333333";
const GRANT = { master_url: "https://cdn.example.com/video/o/v/v1/master.m3u8?t=x", poster_url: "https://cdn.example.com/video/o/v/v1/poster.jpg?t=x", expires_at: Math.floor(Date.now() / 1000) + 900 };
let fetchMock: ReturnType<typeof vi.fn>;
let playSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  observers = []; resetPlayback(); resetGrantCache(); resetSoundPref();
  hlsLog.instances.length = 0; saved.ids.clear(); saved.saveCalls.length = 0;
  net.online = true; net.slow = false;
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("MediaSource", class {}); // MSE present → hls.js (the Android app's engine)
  fetchMock = vi.fn(async () => new Response(JSON.stringify(GRANT), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  playSpy = vi.fn(async () => {});
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playSpy });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", { configurable: true, value: () => "" });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => vi.unstubAllGlobals());

const card = () => render(<FeedVideoCard video={{ id: ID, width: 1080, height: 1920, durationS: 40, hasAudio: true }} />);

describe("flight mode, a video saved on the phone", () => {
  it("plays from the phone: hls.js with the phone loader, no play-token request", async () => {
    saved.ids.add(ID);
    net.online = false;
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hlsLog.instances).toHaveLength(1);
    expect(hlsLog.instances[0].source).toBe(`https://saved-video.invalid/member-1/${ID}/master.m3u8`);
    expect((hlsLog.instances[0].config.loader as { name: string }).name).toBe("PhoneLoader");
    expect(playSpy).toHaveBeenCalled();
    const c = screen.getByTestId("feed-video-card");
    expect(c.getAttribute("data-source")).toBe("phone");
    expect(c.getAttribute("data-autoplay-hold")).not.toBe("offline");
    expect(screen.queryByText(/can't play right now/i)).toBeNull();
  });
  it("says it is the saved first part, not the whole video", async () => {
    saved.ids.add(ID);
    net.online = false;
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(screen.getByText(/Saved preview/i)).toBeTruthy();
  });
  it("review #674: online, the token is refused (a taken-down video): the phone copy is NOT played", async () => {
    saved.ids.add(ID);
    fetchMock.mockImplementation(async () => new Response("{}", { status: 404 }));
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(hlsLog.instances.some((h) => h.source?.startsWith("https://saved-video.invalid/"))).toBe(false);
  });
  it("review #674: watched on Wi-Fi, then the network drops: the next start plays the phone copy, not the dead stream", async () => {
    saved.ids.add(ID);
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(hlsLog.instances.at(-1)?.source).toBe(GRANT.master_url);
    fire(view(), 0); await flush(); // scrolled away: paused
    net.online = false;
    fire(view(), 1); await flush(); // back in view, flight mode
    expect(hlsLog.instances.at(-1)?.source).toBe(`https://saved-video.invalid/member-1/${ID}/master.m3u8`);
    expect(screen.getByTestId("feed-video-card").getAttribute("data-source")).toBe("phone");
  });
});

describe("re-review #674: the network drops in the middle of a video", () => {
  it("the stream's fatal error switches to the phone copy instead of 'can't play'", async () => {
    saved.ids.add(ID);
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(hlsLog.instances.at(-1)?.source).toBe(GRANT.master_url);
    net.online = false;
    await act(async () => { hlsLog.instances.at(-1)!.handlers.hlsError?.({}, { fatal: true, response: { code: 0 } }); });
    await flush();
    expect(hlsLog.instances.at(-1)?.source).toBe(`https://saved-video.invalid/member-1/${ID}/master.m3u8`);
    expect(screen.queryByText(/can't play right now/i)).toBeNull();
  });
  it("past the end of the saved part: the phone copy starts from its beginning", async () => {
    saved.ids.add(ID);
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    const v = screen.getByTestId("feed-video-card").querySelector("video")!;
    Object.defineProperty(v, "currentTime", { configurable: true, writable: true, value: 35 });
    fire(view(), 0); await flush();
    net.online = false;
    fire(view(), 1); await flush();
    expect(hlsLog.instances.at(-1)?.source).toBe(`https://saved-video.invalid/member-1/${ID}/master.m3u8`);
    expect(hlsLog.instances.at(-1)?.config.startPosition).toBe(-1); // 35 s is past the 28 s saved
  });
});

describe("flight mode, nothing saved", () => {
  it("as before: no autoplay, no hls.js", async () => {
    net.online = false;
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(hlsLog.instances).toHaveLength(0);
    expect(playSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("feed-video-card").getAttribute("data-autoplay-hold")).toBe("offline");
  });
});

describe("online", () => {
  it("plays from the network as before, and hands the video to the background saver", async () => {
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(hlsLog.instances.at(-1)?.source).toBe(GRANT.master_url);
    expect(hlsLog.instances.at(-1)?.config.loader).toBeUndefined(); // online playback unchanged
    expect(screen.getByTestId("feed-video-card").getAttribute("data-source")).toBe("network");
    expect(saved.saveCalls).toHaveLength(1);
    const [input, netNow, whoNow] = saved.saveCalls[0] as [unknown, () => unknown, () => Promise<string | null>];
    expect(input).toEqual({ userId: "member-1", videoId: ID, masterUrl: GRANT.master_url });
    // the saver re-reads the network and the signed-in member when it RUNS (re-review #674)
    expect(netNow()).toBe(net);
    expect(await whoNow()).toBe("member-1");
  });
  it("review #674: a device whose player cannot read the phone copy (native HLS) saves nothing", async () => {
    vi.stubGlobal("MediaSource", undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", { configurable: true, value: () => "maybe" });
    card();
    fire(nearObs(), 0.1); fire(view(), 1); await flush();
    expect(screen.getByTestId("feed-video-card").querySelector("video")!.dataset.engine).toBe("native");
    expect(saved.saveCalls).toHaveLength(0);
  });
});
