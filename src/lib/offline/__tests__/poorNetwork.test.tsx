/**
 * OFF-3 · poor-network behaviour, simulated: offline, a declared slow link, and
 * slow / failing reads observed by the Supabase client.
 *
 *  - networkQuality turns those signals into one state;
 *  - NetworkBanner says so (and renders nothing on a good connection);
 *  - PostMedia asks for the smallest image rung on a slow link;
 *  - the retry policy retries what the network broke and never a refusal.
 * Each is shown failing first in the evidence (mutants).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { noteOutcome, getNetState, resetNetState, SLOW_MEDIAN_MS } from "../networkQuality";
import { shouldRetry, retryDelay, MAX_NETWORK_RETRIES } from "../retryPolicy";
import NetworkBanner from "@/components/NetworkBanner";
import PostMedia, { SLOW_FEED_SIZES, FEED_SIZES } from "@/components/post/PostMedia";

vi.mock("@/hooks/core/useDownloadImage", () => ({ useDownloadImage: () => ({ download: vi.fn(), downloading: false }) }));

const setOnline = (v: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => v });
const setConnection = (c: object | undefined) => Object.defineProperty(navigator, "connection", { configurable: true, value: c });

beforeEach(() => { setOnline(true); setConnection(undefined); resetNetState(); });
afterEach(() => { setOnline(true); setConnection(undefined); resetNetState(); });

describe("networkQuality", () => {
  it("good connection -> online, not slow", () => {
    for (let i = 0; i < 6; i++) noteOutcome(200, false);
    expect(getNetState()).toEqual({ online: true, slow: false, reason: null });
  });
  it("navigator offline -> offline", () => {
    setOnline(false); resetNetState();
    expect(getNetState().reason).toBe("offline");
  });
  it("declared 2g or Data Saver -> slow (declared)", () => {
    setConnection({ effectiveType: "2g" }); resetNetState();
    expect(getNetState().reason).toBe("declared");
    setConnection({ effectiveType: "4g", saveData: true }); resetNetState();
    expect(getNetState().reason).toBe("declared");
  });
  it("declared 3g, a weak downlink or a long round trip -> slow (Owner 2026-10-29)", () => {
    for (const c of [{ effectiveType: "3g" }, { effectiveType: "4g", downlink: 1.0 }, { effectiveType: "4g", rtt: 800 }]) {
      setConnection(c); resetNetState();
      expect(getNetState().reason, JSON.stringify(c)).toBe("declared");
    }
  });
  it("a good 4g link, or an unknown downlink of 0, is not slow", () => {
    for (const c of [{ effectiveType: "4g", downlink: 10, rtt: 100 }, { effectiveType: "4g", downlink: 0 }]) {
      setConnection(c); resetNetState();
      expect(getNetState().slow, JSON.stringify(c)).toBe(false);
    }
  });
  it("the observed threshold is 1.5 s, not 3 s (a weak 4G read takes ~2 s)", () => {
    expect(SLOW_MEDIAN_MS).toBeLessThanOrEqual(1500);
    for (let i = 0; i < 6; i++) noteOutcome(2000, false);
    expect(getNetState().reason).toBe("observed");
  });
  it("phones ask for ~1080 px (Instagram's feed width), never the 1440 rung or the original", () => {
    expect(FEED_SIZES.startsWith("(max-width: 430px) 360px")).toBe(true);
  });
  it(`observed: median read > ${SLOW_MEDIAN_MS} ms -> slow, then recovers`, () => {
    for (let i = 0; i < 6; i++) noteOutcome(SLOW_MEDIAN_MS + 500, false);
    expect(getNetState().reason).toBe("observed");
    for (let i = 0; i < 6; i++) noteOutcome(150, false);
    expect(getNetState().slow).toBe(false);
  });
  it("observed: two timeouts in the window -> slow", () => {
    noteOutcome(25_000, true); noteOutcome(25_000, true);
    expect(getNetState().reason).toBe("observed");
  });
});

describe("NetworkBanner", () => {
  it("renders nothing on a good connection", () => {
    const { container } = render(<NetworkBanner />);
    expect(container.innerHTML).toBe("");
  });
  it("offline -> an offline status line", () => {
    setOnline(false); resetNetState();
    render(<NetworkBanner />);
    const b = screen.getByTestId("network-banner");
    expect(b.getAttribute("data-state")).toBe("offline");
    expect(b.getAttribute("role")).toBe("status");
    // S7b-5: the Owner's wording — "No internet — showing saved".
    expect(b.textContent).toMatch(/No internet — showing saved/);
  });
  it("turning slow while mounted shows the slow line (live)", async () => {
    render(<NetworkBanner />);
    await act(async () => { noteOutcome(25_000, true); noteOutcome(25_000, true); });
    expect(screen.getByTestId("network-banner").getAttribute("data-state")).toBe("slow");
  });
});

const photo = (name: string) => `https://abc.supabase.co/storage/v1/object/public/post-images/u/p${name}`;
const sharpSizes = (c: HTMLElement) => [...c.querySelectorAll("img")].map((i) => i.getAttribute("sizes")).filter(Boolean);

describe("PostMedia on a slow link", () => {
  it("good link -> the normal sizes", () => {
    const { container } = render(<PostMedia urls={[photo("-w3000h2000.webp")]} />);
    expect(sharpSizes(container)).toEqual([FEED_SIZES]);
  });
  it("slow link -> the smallest rung", () => {
    noteOutcome(25_000, true); noteOutcome(25_000, true);
    const { container } = render(<PostMedia urls={[photo("-w3000h2000.webp")]} />);
    expect(sharpSizes(container)).toEqual([SLOW_FEED_SIZES]);
  });
});

describe("retry policy", () => {
  it.each([
    ["network failure, 1st", new TypeError("Failed to fetch"), 0, true],
    ["network failure, 3rd", new TypeError("Failed to fetch"), MAX_NETWORK_RETRIES - 1, true],
    [`network failure after ${MAX_NETWORK_RETRIES}`, new TypeError("Failed to fetch"), MAX_NETWORK_RETRIES, false],
    ["our timeout", Object.assign(new Error("Request timed out"), { name: "TimeoutError" }), 1, true],
    ["5xx once", { status: 503, message: "unavailable" }, 0, true],
    ["5xx twice", { status: 503, message: "unavailable" }, 1, false],
    ["RLS refusal", { code: "42501", message: "permission denied" }, 0, false],
    ["404", { status: 404, message: "not found" }, 0, false],
  ])("%s", (_n, err, count, want) => {
    expect(shouldRetry(count as number, err)).toBe(want);
  });
  it("backs off 1, 2, 4, 8, 8 s", () => {
    expect([0, 1, 2, 3, 4].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});
