/**
 * PHOTO PLAN UNIT A — "THE CREDIT IS NEVER ON SCREEN" (Owner, 3 Nov 2026,
 * confirmed sheet point 3; audit B1 + B2).
 *
 * WRITTEN TO FAIL FIRST on staging cf27807e: there a `-l4` photo's URL IS the
 * credited 2048 and the feed's srcset offers it (`-l4-thumb 600w, -l4 2048w`)
 * whenever the switch answer is not ON — so at DPR 1.5 / 2 / 3 the browser
 * picks the credited file — and full screen paints the credited 2048.
 *
 * "Credited" is judged HERE by the file names the uploader writes (not by the
 * module under test): a `-l4` master, any `-r2048c`, a `-l4f-r2048`.
 *
 *   1. FEED: for every photo shape × viewer (switch ON, OFF, answer not in yet
 *      = cold start, signed out) no credited URL appears ANYWHERE in the card's
 *      markup, and the copy a browser picks from the srcset at DPR 1, 1.5, 2
 *      and 3 (desktop 1280, tablet 768, phone 390) is never credited — also
 *      after the switch answer arrives, and after an image error (fallback).
 *   2. FULL SCREEN: the pixels painted are a CLEAN copy, while the <img>'s own
 *      source — what right-click "save image" / "copy image address" acts on —
 *      is the credited file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCreditVersion } from "@/lib/photoProtection";
import { render, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type Answer = "on" | "off" | "pending";
let answer: Answer = "off";
let resolvePending: ((v: { data: boolean; error: null }) => void) | null = null;
const rpc = vi.fn((fn: string) => {
  if (fn !== "feature_allowed_me") return Promise.resolve({ data: [], error: null });
  if (answer === "pending") return new Promise((r) => { resolvePending = r; });
  return Promise.resolve({ data: answer === "on", error: null });
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
      rpc: (fn: string) => rpc(fn),
      from: () => chain,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
let signedIn = true;
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: signedIn ? { id: "viewer-1" } : null, loading: false }) }));
vi.mock("@/hooks/core/useDownloadImage", () => ({ useDownloadImage: () => ({ downloading: null, download: vi.fn() }) }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k, useI18n: () => ({ lang: "en", t: (_k: string, fb?: string) => fb ?? _k }) }));

import PostMedia from "@/components/post/PostMedia";
import ZoomableImage from "@/components/media/ZoomableImage";

const CDN = "https://cdn.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const COMP = "https://cdn.50mmretina.com/competition-photos/u1/competitions/1762000000000-abc";
/** Every set shape a post or entry URL can have today. */
const SHAPES: Record<string, string> = {
  "v2 -l4 large (URL = credited 2048)": `${CDN}-w2048h1365-l4.webp`,
  "v2 -l4 small 1000 px (no clean 1080)": `${CDN}-w1000h667-l4.webp`,
  "v2 -l4f competition": `${COMP}-w4000h2667-l4f.webp`,
  // credit fix U1 (review of #874): a set name without dimensions has no srcset
  // widths (photoSetWidth null) — PostMedia must still never paint the master.
  "v2 -l4 without dimensions": `${CDN}-l4.webp`,
  "v3 -l5 large (URL = clean 1080)": `${CDN}-w1080h720-l5.webp`,
  "v3 -l5 small 1000 px": `${CDN}-w1000h667-l5.webp`,
  "v3 -l5 portrait": `${CDN}-w720h1080-l5.webp`,
  "v3 -l5f competition": `${COMP}-w4000h2667-l5f.webp`,
};
const thumbOf = (u: string) => u.replace(/\.webp$/, "-thumb.webp");

/** Credited by the uploader's naming — independent of the code under test. */
function credited(u: string): boolean {
  const p = u.replace(/[?#].*$/, "");
  return /-l4\.webp$/i.test(p) || /-r2048c\.webp$/i.test(p) || /-l4f-r2048\.webp$/i.test(p);
}

/** Every URL the markup mentions: src, srcset candidates, inline styles. */
function urlsIn(root: HTMLElement): string[] {
  const out: string[] = [];
  root.querySelectorAll("img").forEach((img) => {
    const s = img.getAttribute("src");
    if (s) out.push(s);
    (img.getAttribute("srcset") ?? "").split(",").map((c) => c.trim().split(/\s+/)[0]).filter(Boolean).forEach((c) => out.push(c));
  });
  root.querySelectorAll("[style]").forEach((el) => {
    for (const m of (el.getAttribute("style") ?? "").matchAll(/url\(["']?([^"')]+)["']?\)/g)) out.push(m[1]);
  });
  return out;
}

/** The slot `sizes` (FEED_SIZES) gives at a viewport width. */
function slot(vw: number): number {
  if (vw <= 430) return 360;
  if (vw <= 768) return vw;
  return 600;
}
/** What a browser fetches from a `w`-descriptor srcset: the smallest candidate ≥ need, else the largest. */
function pick(srcset: string, need: number): string {
  const c = srcset.split(",").map((s) => s.trim().split(/\s+/)).map(([u, w]) => ({ u, w: Number(String(w).replace(/w$/, "")) })).sort((a, b) => a.w - b.w);
  return (c.find((x) => x.w >= need) ?? c[c.length - 1]).u;
}

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PostMedia urls={[url]} thumbUrls={[thumbOf(url)]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function sharp(root: HTMLElement): HTMLImageElement {
  const imgs = [...root.querySelectorAll("img")].filter((i) => !i.getAttribute("aria-hidden"));
  expect(imgs.length).toBeGreaterThan(0);
  return imgs[imgs.length - 1] as HTMLImageElement;
}

function assertFeedClean(root: HTMLElement, label: string) {
  const bad = urlsIn(root).filter(credited);
  expect(bad, `${label}: credited file in the feed markup`).toEqual([]);
  const img = sharp(root);
  const srcset = img.getAttribute("srcset");
  for (const vw of [1280, 768, 390]) {
    for (const dpr of [1, 1.5, 2, 3]) {
      const got = srcset ? pick(srcset, slot(vw) * dpr) : (img.getAttribute("src") ?? "");
      expect(credited(got), `${label}: ${vw}px DPR ${dpr} picks ${got.split("/").pop()}`).toBe(false);
    }
  }
}

const VIEWERS: Array<{ name: string; answer: Answer; signedIn: boolean }> = [
  { name: "switch ON", answer: "on", signedIn: true },
  { name: "switch OFF", answer: "off", signedIn: true },
  { name: "switch answer not in yet (cold start)", answer: "pending", signedIn: true },
  { name: "signed out", answer: "off", signedIn: false },
];

describe("Unit A · the feed never offers a credited file", () => {
  beforeEach(() => { resolvePending = null; });
  for (const [shape, url] of Object.entries(SHAPES)) {
    for (const v of VIEWERS) {
      it(`${shape} · ${v.name}`, async () => {
        answer = v.answer;
        signedIn = v.signedIn;
        const { container, unmount } = mount(url);
        await settle();
        assertFeedClean(container, `${shape} · ${v.name}`);
        if (v.answer === "pending" && resolvePending) {
          // the switch answer arrives ON after the first paint
          await act(async () => { resolvePending!({ data: true, error: null }); });
          await settle();
          assertFeedClean(container, `${shape} · answer arrived`);
        }
        // the photo fails to load → the fallback copy is clean too
        fireEvent.error(sharp(container));
        await settle();
        const after = sharp(container).getAttribute("src") ?? "";
        expect(credited(after), `${shape} · ${v.name}: error fallback ${after.split("/").pop()}`).toBe(false);
        expect(urlsIn(container).filter(credited), `${shape} · ${v.name}: after error`).toEqual([]);
        unmount();
      });
    }
  }
});

/** The URL whose pixels a full-screen <img> paints: its background when its own picture is moved out of the box. */
function painted(img: HTMLImageElement): string {
  const pos = img.style.objectPosition;
  const hidden = /-\d{4,}px/.test(pos);
  if (hidden) {
    const m = /url\(["']?([^"')]+)["']?\)/.exec(img.style.backgroundImage);
    return m ? m[1] : "";
  }
  return img.getAttribute("src") ?? "";
}

describe("Unit A · full screen paints a clean copy; the context menu gets the credited file", () => {
  for (const v of VIEWERS) {
    for (const [shape, url] of Object.entries(SHAPES)) {
      it(`${shape} · ${v.name}`, async () => {
        answer = v.answer;
        signedIn = v.signedIn;
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { container, unmount } = render(
          <QueryClientProvider client={qc}><ZoomableImage src={url} className="max-w-[95vw] max-h-[92vh] object-contain" /></QueryClientProvider>,
        );
        await settle();
        const img = container.querySelector("img") as HTMLImageElement;
        const shown = painted(img);
        expect(shown, `${shape}: something is painted`).not.toBe("");
        expect(credited(shown), `${shape} · ${v.name}: full screen paints ${shown.split("/").pop()}`).toBe(false);
        // right-click / copy image address act on the <img>'s own source: the
        // CURRENT credited copy for a v3 set; for a v2 set (a stale -l4/-l4f row)
        // the clean copy — never its retired big-credit file (credit fix U1).
        const target = img.getAttribute("src") ?? "";
        const v3 = /-l5f?\.webp$/.test(url);
        expect(credited(target), `${shape}: the context-menu file ${target.split("/").pop()}`).toBe(v3);
        if (v3) expect(/-r2048c\.webp$/.test(target.replace(/[?#].*$/, ""))).toBe(true);
        // never a competition full size, painted or saved
        expect(/-l[45]f\.webp$/.test(shown) || /-l[45]f\.webp$/.test(target), `${shape}: full size reached full screen`).toBe(false);
        // the credited file fails → the clean copy is shown plainly, never an empty viewer
        fireEvent.error(img);
        await settle();
        const plain = container.querySelector("img") as HTMLImageElement;
        expect(credited(painted(plain))).toBe(false);
        expect(painted(plain)).not.toBe("");
        unmount();
      });
    }
  }

  it("an old photo (no set marker) is untouched: the URL itself, no layer (full screen)", async () => {
    answer = "on";
    signedIn = true;
    const old = "https://cdn.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3.webp";
    const qc = new QueryClient();
    const { container } = render(<QueryClientProvider client={qc}><ZoomableImage src={old} /></QueryClientProvider>);
    await settle();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(old);
    expect(img.style.backgroundImage).toBe("");
    expect(img.style.objectPosition).toBe("");
  });
});

/*
 * FAULT 2 (Owner web check, 3 Nov 2026): "right-click on the FEED photo saves
 * the small clean copy with NO credit". Written to FAIL on main f66cdf51 (there
 * the feed <img> only ever holds the clean copy). Now: at a right-button press
 * (or a still long-press) the feed photo hands the browser the credited copy,
 * the PIXELS stay the clean picture already on screen, and scrolling (no press)
 * never asks for a credited file. In the app (save guard on) nothing changes.
 */
describe("Fault 2 · a web save of the FEED photo gets the credited copy; the screen stays clean", () => {
  const L5 = `${CDN}-w1080h720-l5.webp`;
  const L5_CRED = withCreditVersion(`${CDN}-w1080h720-l5-r2048c.webp`); // the credited copy as the web loads it (geometry version)
  const loadedAs = (img: HTMLImageElement, current: string) => {
    Object.defineProperty(img, "complete", { configurable: true, get: () => true });
    Object.defineProperty(img, "naturalWidth", { configurable: true, get: () => 1080 });
    Object.defineProperty(img, "currentSrc", { configurable: true, get: () => current });
  };
  // jsdom has no PointerEvent: a MouseEvent that carries pointerType (as browsers do).
  if (typeof window.PointerEvent === "undefined") {
    class PE extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
        Object.defineProperty(this, "movementX", { value: init.movementX ?? 0 });
        Object.defineProperty(this, "movementY", { value: init.movementY ?? 0 });
      }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
  }
  beforeEach(() => { answer = "on"; signedIn = true; document.documentElement.classList.remove("app-photo-save-off"); });

  it("before any press: no credited file anywhere in the card (feed weight unchanged)", async () => {
    const { container } = mount(L5);
    await settle();
    expect(urlsIn(container).filter(credited)).toEqual([]);
  });

  it("right-button press → the <img> source is the credited copy; the painted picture is the clean copy it showed", async () => {
    const { container } = mount(L5);
    await settle();
    const img = sharp(container);
    loadedAs(img, L5);
    fireEvent.pointerDown(img, { pointerType: "mouse", button: 2 });
    expect(img.getAttribute("src")).toBe(L5_CRED);
    expect(img.getAttribute("srcset")).toBeNull();
    expect(painted(img)).toBe(L5);
    expect(credited(painted(img))).toBe(false);
  });

  it("a left click does not arm it (it opens full screen, which has its own)", async () => {
    const { container } = mount(L5);
    await settle();
    const img = sharp(container);
    loadedAs(img, L5);
    fireEvent.pointerDown(img, { pointerType: "mouse", button: 0 });
    expect(credited(img.getAttribute("src") ?? "")).toBe(false);
  });

  it("phone browser: a still long-press arms it; a scroll (finger moves) does not", async () => {
    vi.useFakeTimers();
    try {
      const a = mount(L5);
      const img = sharp(a.container);
      loadedAs(img, L5);
      fireEvent.pointerDown(img, { pointerType: "touch", clientX: 10, clientY: 10 });
      fireEvent.pointerMove(img, { pointerType: "touch", clientX: 10, clientY: 60 });
      act(() => { vi.advanceTimersByTime(600); });
      expect(credited(img.getAttribute("src") ?? "")).toBe(false);
      fireEvent.pointerDown(img, { pointerType: "touch", clientX: 10, clientY: 10 });
      act(() => { vi.advanceTimersByTime(400); });
      expect(img.getAttribute("src")).toBe(L5_CRED);
      expect(painted(img)).toBe(L5);
      a.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a cursor parked over a scrolling feed (synthetic, zero-movement events) never arms — feed weight unchanged; Chromium/WebKit never arm on a rest", async () => {
    vi.useFakeTimers();
    try {
      const a = mount(L5);
      const img = sharp(a.container);
      loadedAs(img, L5);
      fireEvent.pointerEnter(img, { pointerType: "mouse" });
      fireEvent.pointerMove(img, { pointerType: "mouse", movementX: 0, movementY: 0 });
      act(() => { vi.advanceTimersByTime(1500); });
      expect(credited(img.getAttribute("src") ?? "")).toBe(false);
      // a real movement + rest, but not Firefox: nothing (the right-button press is enough there)
      fireEvent.pointerMove(img, { pointerType: "mouse", movementX: 4, movementY: 2 });
      act(() => { vi.advanceTimersByTime(1500); });
      expect(credited(img.getAttribute("src") ?? "")).toBe(false);
      a.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Firefox: a real mouse movement on the photo + a rest loads the credited copy before the right-click; a scroll does not", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0");
    vi.useFakeTimers();
    try {
      const a = mount(L5);
      const img = sharp(a.container);
      loadedAs(img, L5);
      fireEvent.pointerMove(img, { pointerType: "mouse", movementX: 0, movementY: 0 }); // synthetic after a scroll
      act(() => { vi.advanceTimersByTime(1500); });
      expect(credited(img.getAttribute("src") ?? "")).toBe(false);
      fireEvent.pointerMove(img, { pointerType: "mouse", movementX: 3, movementY: 1 });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.pointerLeave(img, { pointerType: "mouse" });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(credited(img.getAttribute("src") ?? "")).toBe(false); // passed over
      fireEvent.pointerMove(img, { pointerType: "mouse", movementX: 3, movementY: 1 });
      act(() => { vi.advanceTimersByTime(350); });
      expect(img.getAttribute("src")).toBe(L5_CRED);
      expect(painted(img)).toBe(L5);
      a.unmount();
    } finally {
      vi.useRealTimers();
      ua.mockRestore();
    }
  });

  it("the installed app (save guard on): nothing is armed — no save at all there", async () => {
    document.documentElement.classList.add("app-photo-save-off");
    const { container } = mount(L5);
    await settle();
    const img = sharp(container);
    loadedAs(img, L5);
    fireEvent.pointerDown(img, { pointerType: "mouse", button: 2 });
    expect(credited(img.getAttribute("src") ?? "")).toBe(false);
    document.documentElement.classList.remove("app-photo-save-off");
  });

  it("an old photo (no credited copy) is untouched", async () => {
    const old = "https://cdn.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3.webp";
    const { container } = mount(old);
    await settle();
    const img = sharp(container);
    loadedAs(img, old);
    fireEvent.pointerDown(img, { pointerType: "mouse", button: 2 });
    expect(img.style.objectPosition).toBe("");
  });
});
