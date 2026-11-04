/**
 * Photo plan U4 — switch `photo_set_v2` ON: "Save mobile data" (one size down
 * on mobile data), the feed keeps 1080, grid tiles fall back when their 320
 * copy fails, the ⓘ sheet owns the arrow keys, the hashtag page's full screen
 * has the ⓘ too, and videos start on 720p (Wi-Fi) / 480p (mobile data).
 * Switch OFF is pinned by the U2 snapshots (photoSetV2Off.test.tsx) and the
 * last test here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withCreditVersion } from "@/lib/photoProtection";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let switchOn = true;
const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
  if (fn === "feature_allowed_me") return { data: args?._feature === "photo_set_v2" ? switchOn : false, error: null };
  if (fn === "post_photo_camera_for") {
    return { data: [{ post_id: "p1", ord: 0, info: { camera: "Sony α7 IV", iso: 200 }, hidden: false }, { post_id: "p1", ord: 1, info: { camera: "Nikon Z6", iso: 400 }, hidden: false }], error: null };
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
      auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer-1" }, loading: false }) }));
vi.mock("@/hooks/core/useDownloadImage", () => ({ useDownloadImage: () => ({ downloading: null, download: vi.fn() }) }));
const NET = { online: true, slow: false, reason: null };
vi.mock("@/lib/offline/networkQuality", () => ({
  getNetState: () => NET, // one object: useSyncExternalStore needs a stable snapshot
  subscribeNetState: () => () => {},
  wireBrowserSignals: () => {},
}));
// hls.js stand-in: keeps the instance so the test can hand it levels.
type FakeHls = { levels: Array<{ height: number; bitrate: number }>; autoLevelCapping: number; startLevel: number; handlers: Record<string, (...a: unknown[]) => void> };
const hlsInstances: FakeHls[] = [];
vi.mock("hls.js", () => ({
  default: class {
    static isSupported() { return true; }
    static DefaultConfig = { loader: class {} };
    levels: Array<{ height: number; bitrate: number }> = []; autoLevelCapping = -1; startLevel = 0;
    handlers: Record<string, (...a: unknown[]) => void> = {};
    constructor() { hlsInstances.push(this as unknown as FakeHls); }
    on(e: string, f: (...a: unknown[]) => void) { this.handlers[e] = f; }
    startLoad() {} destroy() {}
    loadSource() {}
    attachMedia(v: HTMLVideoElement) { v.setAttribute("src", "blob:https://localhost/ms"); }
  },
}));
vi.mock("hls.js/dist/hls.worker.js?url", () => ({ default: "/assets/hls.worker.js" }));

import PostMedia from "@/components/post/PostMedia";
import FacebookPhotoGrid from "@/components/FacebookPhotoGrid";
import { NotificationRowThumb } from "@/components/notifications/CentreNotificationRow";

import FeedVideoCard from "@/components/video/FeedVideoCard";
import { SaveMobileDataSetting } from "@/components/settings/SaveMobileDataSetting";
import { featureAllowedKey } from "@/hooks/core/useFeatureAllowed";
import { resetDataSaver, getSaveMobileData } from "@/lib/dataSaver";
import { postMedia } from "@/lib/posts/subjectMedia";
import * as pb from "@/lib/video/playback";
import { resetGrantCache } from "@/lib/video/playGrant";

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4_1080 = `${CDN}-w2048h1365-l4-r1080.webp`;
const L4_THUMB = `${CDN}-w2048h1365-l4-thumb.webp`;
const L4_320 = `${CDN}-w2048h1365-l4-r320.webp`;
const L4B = `${CDN}-b-w2048h1365-l4.webp`;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureAllowedKey("photo_set_v2", "viewer-1"), switchOn);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const setConnection = (type: string | undefined) =>
  Object.defineProperty(globalThis.navigator, "connection", { configurable: true, value: type === undefined ? undefined : { type } });
const setApp = (on: boolean) => { (globalThis as { Capacitor?: unknown }).Capacitor = on ? { isNativePlatform: () => true, getPlatform: () => "android" } : undefined; };
const sharp = (c: HTMLElement) => [...c.querySelectorAll("img")].find((i) => i.className.includes("object-contain")) as HTMLImageElement;

async function openViewer() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const frame = document.querySelector(".cursor-zoom-in") as HTMLElement;
  for (let i = 0; i < 2 && !screen.queryByRole("dialog", { name: /full size/ }); i++) {
    fireEvent.click(frame);
    await act(async () => { vi.advanceTimersByTime(400); });
  }
  vi.useRealTimers();
  return screen.findByRole("dialog", { name: /full size/ });
}

beforeEach(() => {
  switchOn = true;
  rpc.mockClear();
  localStorage.clear();
  resetDataSaver();
  setConnection(undefined);
  setApp(false);
});
afterEach(() => { setConnection(undefined); setApp(false); vi.useRealTimers(); });

describe("the feed keeps 1080 (U3 review follow-up)", () => {
  it("a new photo's feed srcset is its 600 + 1080 copies, src = 1080, never the 2048", async () => {
    const { container } = wrap(<PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} />);
    await settle();
    const img = sharp(container);
    expect(img.getAttribute("src")).toBe(L4_1080);
    expect(img.getAttribute("srcset")).toBe(`${L4_THUMB} 600w, ${L4_1080} 1080w`);
    expect(img.getAttribute("srcset")).not.toContain(`${L4} `);
  });
});

describe("Save mobile data (decision 6)", () => {
  it("setting on + mobile data → feed one size down (600 only)", async () => {
    localStorage.setItem("50mm.saveMobileData", "on");
    setConnection("cellular");
    const { container } = wrap(<PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} />);
    await settle();
    const img = sharp(container);
    expect(img.getAttribute("src")).toBe(L4_THUMB);
    expect(img.getAttribute("srcset")).toBe(`${L4_THUMB} 600w`);
  });

  it("setting on but on Wi-Fi → no size-down", async () => {
    localStorage.setItem("50mm.saveMobileData", "on");
    setConnection("wifi");
    const { container } = wrap(<PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} />);
    await settle();
    expect(sharp(container).getAttribute("src")).toBe(L4_1080);
  });

  // A CURRENT (v3 -l5) set carries the credited copy under the context menu; a
  // v2 -l4 set has none since credit fix U1 (its master holds the retired big credit).
  const L5 = `${CDN}-w1080h720-l5.webp`;
  const L5_THUMB = `${CDN}-w1080h720-l5-thumb.webp`;

  it("full screen: the credited 2048 normally (v3); a stale v2 -l4 row → its clean 1080, never the master", async () => {
    setConnection("cellular");
    const a = wrap(<PostMedia urls={[L5]} thumbUrls={[L5_THUMB]} />);
    await settle();
    const viewer = await openViewer();
    expect(viewer.querySelector("img")!.getAttribute("src")).toBe(withCreditVersion(`${CDN}-w1080h720-l5-r2048c.webp`));
    a.unmount();
    wrap(<PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} />);
    await settle();
    const v2 = await openViewer();
    expect(v2.querySelector("img")!.getAttribute("src")).toBe(L4_1080);
  });

  it("full screen: the 600 copy is painted when saving (Unit A: the clean copy is painted, one size down)", async () => {
    localStorage.setItem("50mm.saveMobileData", "on");
    setConnection("cellular");
    wrap(<PostMedia urls={[L5]} thumbUrls={[L5_THUMB]} />);
    await settle();
    const viewer = await openViewer();
    const img = viewer.querySelector("img")!;
    expect(img.style.backgroundImage).toContain(L5_THUMB);
    expect(img.style.backgroundImage).not.toContain(L5);
  });

  it("the setting: shown only with the switch on, saved on this device", async () => {
    wrap(<SaveMobileDataSetting />);
    await settle();
    const box = screen.getByRole("checkbox", { name: /Save mobile data/ });
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box);
    expect(getSaveMobileData()).toBe(true);
    expect(localStorage.getItem("50mm.saveMobileData")).toBe("on");
    expect((screen.getByRole("checkbox", { name: /Save mobile data/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("switch off: the setting is not shown and a saved 'on' changes nothing", async () => {
    switchOn = false;
    localStorage.setItem("50mm.saveMobileData", "on");
    setConnection("cellular");
    const { container } = wrap(<><SaveMobileDataSetting /><PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} /></>);
    await settle();
    expect(screen.queryByRole("checkbox", { name: /Save mobile data/ })).toBeNull();
    const img = sharp(container);
    // Unit A: a set photo shows its clean 1080 for every viewer; only the
    // saving (one size down) stays behind the switch.
    expect(img.getAttribute("src")).toBe(L4_1080);
    expect(img.getAttribute("sizes")).not.toBe("160px");
  });
});

describe("Unit B · the switch is never frozen on a mounted card (audit M4)", () => {
  it("the answer arriving AFTER the first paint takes effect on the same card", async () => {
    localStorage.setItem("50mm.saveMobileData", "on");
    setConnection("cellular");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(featureAllowedKey("photo_set_v2", "viewer-1"), false);
    const { container } = render(
      <QueryClientProvider client={qc}><MemoryRouter><PostMedia urls={[L4]} thumbUrls={[L4_THUMB]} /></MemoryRouter></QueryClientProvider>,
    );
    await settle();
    expect(sharp(container).getAttribute("src")).toBe(L4_1080); // switch off: no saving
    await act(async () => { qc.setQueryData(featureAllowedKey("photo_set_v2", "viewer-1"), true); });
    await settle();
    // U2/U4 froze the answer per mount (`useState(v2Now)`): the card stayed on 1080.
    expect(sharp(container).getAttribute("src")).toBe(L4_THUMB);
    expect(sharp(container).getAttribute("sizes")).toBe("160px");
  });
});

describe("grid tiles fall back when their 320 copy fails (U2 review follow-up)", () => {
  it("notification thumbnail: 320 first, then the largest CLEAN copy (never the credited -l4 file), once", async () => {
    const { container } = wrap(<NotificationRowThumb media={postMedia({ image_urls: [L4] } as never)} />);
    await settle();
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(L4_320);
    fireEvent.error(img);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(L4_1080);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(L4_1080);
  });

  it("a competition (-l4f) tile falls back to its clean 1080 — never the credited 2048, never the full-size file", async () => {
    const L4F = `${CDN}-w4000h3000-l4f.webp`;
    const { container } = wrap(<NotificationRowThumb media={postMedia({ image_urls: [L4F] } as never)} />);
    await settle();
    expect(container.querySelector("img")!.getAttribute("src")).toBe(`${CDN}-w4000h3000-l4f-r320.webp`);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(`${CDN}-w4000h3000-l4f-r1080.webp`);
  });
});

describe("videos: 720p start on Wi-Fi, 480p on mobile data (decision 6)", () => {
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
  const GRANT = { master_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/master.m3u8?t=x", poster_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/poster.jpg?t=x", expires_at: Math.floor(Date.now() / 1000) + 900 };
  const LEVELS = [{ height: 240, bitrate: 300_000 }, { height: 480, bitrate: 900_000 }, { height: 720, bitrate: 2_000_000 }];
  let n = 0;
  async function start() {
    n++;
    const id = `33333333-3333-4333-8333-33333333333${n % 10}`;
    wrap(<FeedVideoCard video={{ id, width: 1080, height: 1920, durationS: 20, hasAudio: true }} />);
    const views = observers.filter((o) => Array.isArray(o.opts?.threshold));
    act(() => { views[0].cb([{ intersectionRatio: 1, isIntersecting: true, target: views[0].el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
    await settle();
    const h = hlsInstances[hlsInstances.length - 1];
    h.levels = LEVELS;
    act(() => { h.handlers.hlsManifestParsed?.(); });
    return h;
  }
  beforeEach(() => {
    observers = []; hlsInstances.length = 0;
    pb.resetPlayback(); resetGrantCache();
    (window as unknown as { MediaSource?: unknown }).MediaSource = function MediaSource() {};
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(GRANT), { status: 200 })));
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: async () => {} });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: () => {} });
    Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: () => {} });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", { configurable: true, value: () => "" });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });
  afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { MediaSource?: unknown }).MediaSource; });

  it("Wi-Fi → starts on 720p, no cap", async () => {
    setConnection("wifi");
    const h = await start();
    expect(h.startLevel).toBe(2);
    expect(h.autoLevelCapping).toBe(-1);
  });
  it("mobile data → starts on 480p", async () => {
    setConnection("cellular");
    const h = await start();
    expect(h.startLevel).toBe(1);
  });
  it("mobile data + Save mobile data → starts on 240p, capped at 480p", async () => {
    setConnection("cellular");
    localStorage.setItem("50mm.saveMobileData", "on");
    const h = await start();
    expect(h.startLevel).toBe(0);
    expect(h.autoLevelCapping).toBe(1);
  });
  it("switch off → today's rule: start 240p, no cap on a good link", async () => {
    switchOn = false;
    setConnection("wifi");
    const h = await start();
    expect(h.startLevel).toBe(0);
    expect(h.autoLevelCapping).toBe(-1);
  });
});
