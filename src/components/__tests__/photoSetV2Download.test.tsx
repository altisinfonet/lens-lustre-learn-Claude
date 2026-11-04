/**
 * Photo plan U3 — download removal, admin/judge keep, full screen = 2048,
 * app long-press save off. Every case runs with `photo_set_v2` ON and again
 * OFF; OFF must be today's behaviour exactly (the byte-for-byte OFF snapshots
 * of PostMedia live in src/components/post/__tests__/photoSetV2Off.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withCreditVersion } from "@/lib/photoProtection";
import { render, act, screen, fireEvent, createEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";

let switchOn = true;
let roles: string[] = [];
const download = vi.fn(async () => {});
const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
  if (fn === "feature_allowed_me") return { data: args?._feature === "photo_set_v2" ? switchOn : false, error: null };
  return { data: [], error: null };
});
vi.mock("@/integrations/supabase/client", () => {
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const k of ["select", "eq", "in", "is", "not", "order", "limit", "range", "or", "neq", "gte", "lte", "match", "filter"]) chain[k] = self;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === "user_roles" ? roles.map((role) => ({ role })) : [], error: null }).then(res);
    return chain;
  };
  return {
    supabase: {
      rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args),
      from: (table: string) => chainFor(table),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
let signedIn = true;
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: signedIn ? { id: "viewer-1" } : null, loading: false }) }));
vi.mock("@/hooks/core/useDownloadImage", () => ({ useDownloadImage: () => ({ downloading: null, download }) }));
vi.mock("@/components/ImageEngagement", () => ({ default: () => null }));
vi.mock("@/components/ads/AdZone", () => ({ default: () => null }));

import PostMedia from "@/components/post/PostMedia";
import FacebookPhotoGrid from "@/components/FacebookPhotoGrid";
import Lightbox from "@/components/Lightbox";
import ZoomableImage from "@/components/media/ZoomableImage";
import AppPhotoSaveGuard from "@/components/AppPhotoSaveGuard";
import { featureAllowedKey } from "@/hooks/core/useFeatureAllowed";
import { beginDashboardBootstrap } from "@/lib/dashboardInitGate";

// The app's dashboard-init opens this gate; roles are read (from user_roles,
// mocked above) only after it — exactly the path useUserRoles takes.
beginDashboardBootstrap().resolve();
import { PHOTO_SAVE_GUARD_CLASS, __resetPhotoSaveGuardForTests } from "@/lib/native/photoSaveGuard";

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4_1080 = `${CDN}-w2048h1365-l4-r1080.webp`;
const L4B = `${CDN}-w1600h1200-l4.webp`;
const ENTRY = "https://cdn-staging.50mmretina.com/competition-photos/u1/1762000000000-e1";
const L4F = `${ENTRY}-w4000h3000-l4f.webp`;
const L4F_2048 = withCreditVersion(`${ENTRY}-w4000h3000-l4f-r2048.webp`); // as the web loads the credited copy
const L4F_1080 = `${ENTRY}-w4000h3000-l4f-r1080.webp`;
const L4F2 = `${ENTRY}-w3000h4000-l4f.webp`;
const OLD = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3.webp";

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
/**
 * A SINGLE tap on a feed photo, waited out past the 300 ms double-tap window.
 * Since 4 Nov 2026 it opens nothing (Owner, feed "like Instagram").
 */
const tapFeedPhoto = async () => {
  fireEvent.click(document.querySelector("[data-feed-photo]") as HTMLElement);
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
};
/** A post photo full screen — now opened from the post's photo grid (same `originalFor` → ZoomableImage path the feed viewer used). */
const openGridViewer = async () => {
  fireEvent.click(document.querySelector(".group\\/photo") as HTMLElement);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
};
const setApp = (on: boolean) => {
  (globalThis as { Capacitor?: unknown }).Capacitor = on ? { isNativePlatform: () => true } : undefined;
};
const downloadButtons = () => screen.queryAllByRole("button", { name: /download/i });
/** The full-screen photograph: ZoomableImage's <img> inside the open dialog. */
const fullScreenImg = () => document.querySelector("[role=dialog] img, .fixed.inset-0 img") as HTMLImageElement | null;

beforeEach(() => {
  switchOn = true;
  signedIn = true;
  roles = [];
  download.mockClear();
  rpc.mockClear();
  setApp(false);
  __resetPhotoSaveGuardForTests();
});
afterEach(() => { setApp(false); __resetPhotoSaveGuardForTests(); });

describe("members: no download anywhere they see photos (switch ON)", () => {
  it("feed single photo: no download button on the card, and a tap opens no full screen", async () => {
    wrap(<PostMedia urls={[L4]} />);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
    await tapFeedPhoto();
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(downloadButtons()).toHaveLength(0);
  });

  it("feed album: no download button on the card, and a tap opens no full screen", async () => {
    wrap(<PostMedia urls={[L4, L4B]} />);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
    await tapFeedPhoto();
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(downloadButtons()).toHaveLength(0);
  });

  it("post page / hashtag photo grid: no download, even for an admin on a POST", async () => {
    roles = ["admin"];
    wrap(<FacebookPhotoGrid urls={[L4, L4B]} />);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
    fireEvent.click(document.querySelectorAll(".cursor-pointer")[0] as HTMLElement);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /close photo viewer/i })).toBeTruthy();
  });

  it("portfolio lightbox: no download", async () => {
    wrap(<Lightbox images={[{ src: L4, title: "t", category: "c" }]} currentIndex={0} isOpen onClose={() => {}} onPrev={() => {}} onNext={() => {}} />);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /close lightbox/i })).toBeTruthy();
  });

  it("competition entry: a member gets no download", async () => {
    wrap(<FacebookPhotoGrid urls={[L4F, L4F2]} competitionEntry />);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
  });
});

describe("admins and judges keep download on competition entries (switch ON)", () => {
  for (const role of ["admin", "judge"]) {
    it(`${role}: download is offered on the grid and in full screen, and it fetches the stored entry file`, async () => {
      roles = [role];
      wrap(<FacebookPhotoGrid urls={[L4F, L4F2]} competitionEntry />);
      await settle();
      const onGrid = downloadButtons();
      expect(onGrid.length).toBe(2);
      fireEvent.click(onGrid[0]);
      await settle();
      expect((download.mock.calls[0] as unknown[])[0]).toBe(L4F);
      fireEvent.click(document.querySelectorAll(".cursor-pointer")[0] as HTMLElement);
      await settle();
      expect(within(screen.getByRole("dialog")).queryAllByRole("button", { name: /download photo/i })).toHaveLength(1);
    });
  }

  it("…but not inside the installed app (decision 3: no download at all in the app)", async () => {
    setApp(true);
    roles = ["admin"];
    wrap(<FacebookPhotoGrid urls={[L4F, L4F2]} competitionEntry />);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
  });
});

describe("web full screen shows the 2048 copy (switch ON); old photos unchanged", () => {
  // Credit fix U1: a v2 set's credited files (-l4f-r2048, the -l4 master) carry
  // the retired big credit — full screen holds the CLEAN copy, never those.
  it("competition -l4f → its clean -r1080 (never the retired -r2048, never the full-size file)", async () => {
    wrap(<ZoomableImage src={L4F} />);
    await settle();
    expect((document.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(L4F_1080);
  });

  it("post -l4 (a stale pre-repoint row) → its clean -r1080, never the -l4 master", async () => {
    wrap(<FacebookPhotoGrid urls={[L4]} />);
    await settle();
    await openGridViewer();
    await settle();
    expect(fullScreenImg()?.getAttribute("src")).toBe(L4_1080);
  });

  it("entry grid opened full screen → clean -r1080; inline grid photo → -r1080 (inline keeps 1080)", async () => {
    roles = [];
    wrap(<FacebookPhotoGrid urls={[L4F, L4F2]} competitionEntry />);
    await settle();
    const inline = Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(inline).toContain(L4F_1080);
    expect(inline).not.toContain(L4F);
    fireEvent.click(document.querySelectorAll(".cursor-pointer")[0] as HTMLElement);
    await settle();
    expect(fullScreenImg()?.getAttribute("src")).toBe(L4F_1080);
    expect(fullScreenImg()?.getAttribute("src")).not.toBe(L4F_2048);
  });

  it("an old photo keeps today's full-screen source", async () => {
    wrap(<ZoomableImage src={OLD} />);
    await settle();
    expect((document.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(OLD);
  });
});

describe("app long-press save is off (app shell — whatever the switch says, Unit B)", () => {
  const longPressOnPhoto = () => {
    const img = document.createElement("img");
    document.body.appendChild(img);
    const ev = createEvent.contextMenu(img);
    fireEvent(img, ev);
    const drag = createEvent.dragStart(img);
    fireEvent(img, drag);
    img.remove();
    return { menu: ev.defaultPrevented, drag: drag.defaultPrevented };
  };
  const longPressOnText = () => {
    const p = document.createElement("p");
    p.textContent = "caption";
    document.body.appendChild(p);
    const ev = createEvent.contextMenu(p);
    fireEvent(p, ev);
    p.remove();
    return ev.defaultPrevented;
  };

  it("in the app with the switch on: <html> carries the class and the photo menu/drag are cancelled; text keeps its menu", async () => {
    setApp(true);
    wrap(<AppPhotoSaveGuard />);
    await settle();
    expect(document.documentElement.classList.contains(PHOTO_SAVE_GUARD_CLASS)).toBe(true);
    expect(longPressOnPhoto()).toEqual({ menu: true, drag: true });
    expect(longPressOnText()).toBe(false);
  });

  it("on the web (switch on): nothing is installed", async () => {
    wrap(<AppPhotoSaveGuard />);
    await settle();
    expect(document.documentElement.classList.contains(PHOTO_SAVE_GUARD_CLASS)).toBe(false);
    expect(longPressOnPhoto()).toEqual({ menu: false, drag: false });
  });

  it("in the app with the switch OFF: the guard is installed too (Owner: 'App: no save at all')", async () => {
    switchOn = false;
    setApp(true);
    wrap(<AppPhotoSaveGuard />);
    await settle();
    expect(document.documentElement.classList.contains(PHOTO_SAVE_GUARD_CLASS)).toBe(true);
    expect(longPressOnPhoto()).toEqual({ menu: true, drag: true });
    expect(longPressOnText()).toBe(false);
  });

  it("the CSS rule exists for the class, and the guard is mounted in App", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");
    expect(css).toMatch(new RegExp(`html\\.${PHOTO_SAVE_GUARD_CLASS} img\\s*\\{[^}]*-webkit-touch-callout:\\s*none`));
    const app = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");
    expect(app).toMatch(/<AppPhotoSaveGuard\s*\/>/);
  });
});

/*
 * PHOTO PLAN UNIT B — download and app save are POLICY, not the switch
 * (Owner-confirmed requirements 3 + 4, 3 Nov 2026; audit H2). Written to FAIL
 * on Unit A (staging before Unit B): there switch off / unknown / signed out
 * meant "today's download button", and the app's long-press save stayed on.
 */
const viewers = [
  { name: "switch OFF", on: false, signed: true },
  { name: "signed out", on: false, signed: false },
  { name: "switch ON", on: true, signed: true },
] as const;
describe("Unit B · no download icon for anyone but admins/judges on competition entries — whatever the switch says", () => {
  for (const v of viewers) {
    it(`${v.name}: feed single photo (old and new) — no download, and a tap opens no full screen`, async () => {
      switchOn = v.on; signedIn = v.signed;
      for (const url of [OLD, L4F]) {
        const { unmount } = wrap(<PostMedia urls={[url]} />);
        await settle();
        expect(downloadButtons(), url).toHaveLength(0);
        await tapFeedPhoto();
        await settle();
        expect(screen.queryByRole("dialog"), url).toBeNull();
        expect(downloadButtons(), url).toHaveLength(0);
        unmount();
      }
    });

    it(`${v.name}: photo grid (post) and portfolio lightbox — no download for a member`, async () => {
      switchOn = v.on; signedIn = v.signed;
      const g = wrap(<FacebookPhotoGrid urls={[OLD, L4F2]} />);
      await settle();
      expect(downloadButtons()).toHaveLength(0);
      g.unmount();
      wrap(<Lightbox images={[{ src: OLD, title: "t", category: "c" }]} currentIndex={0} isOpen onClose={() => {}} onPrev={() => {}} onNext={() => {}} />);
      await settle();
      expect(downloadButtons()).toHaveLength(0);
    });

    it(`${v.name}: competition entry — a member gets no download`, async () => {
      switchOn = v.on; signedIn = v.signed;
      wrap(<FacebookPhotoGrid urls={[L4F, L4F2]} competitionEntry />);
      await settle();
      expect(downloadButtons()).toHaveLength(0);
    });

    it(`${v.name}: the installed app — no download, and long-press save is off`, async () => {
      switchOn = v.on; signedIn = v.signed;
      setApp(true);
      wrap(<><AppPhotoSaveGuard /><PostMedia urls={[OLD]} /></>);
      await settle();
      expect(downloadButtons()).toHaveLength(0);
      expect(document.documentElement.classList.contains(PHOTO_SAVE_GUARD_CLASS)).toBe(true);
    });
  }

  it("switch OFF: an ADMIN keeps download on a competition entry (web), and only there", async () => {
    switchOn = false; roles = ["admin"];
    const g = wrap(<FacebookPhotoGrid urls={[L4F, L4F2]} competitionEntry />);
    await settle();
    await settle();
    expect(downloadButtons()).toHaveLength(2);
    g.unmount();
    wrap(<FacebookPhotoGrid urls={[OLD, L4F2]} />);
    await settle();
    expect(downloadButtons()).toHaveLength(0);
  });

  it("the web installs no long-press guard (right-click on full screen gives the credited copy)", async () => {
    switchOn = true;
    wrap(<AppPhotoSaveGuard />);
    await settle();
    expect(document.documentElement.classList.contains(PHOTO_SAVE_GUARD_CLASS)).toBe(false);
  });
});

describe("switch OFF · which copy is shown (Unit A)", () => {
  beforeEach(() => { switchOn = false; });

  // A CURRENT (v3 -l5f) set: the credited -r2048c is under the context menu. (A
  // v2 set has no save target since credit fix U1 — see the block above.)
  const L5F = `${ENTRY}-w4000h3000-l5f.webp`;
  const L5F_CRED = withCreditVersion(`${ENTRY}-w4000h3000-l5f-r2048c.webp`);
  const L5F_1080 = `${ENTRY}-w4000h3000-l5f-r1080.webp`;

  it("post photo full screen paints the CLEAN copy; the credited file is only under the context menu", async () => {
    wrap(<FacebookPhotoGrid urls={[L5F]} />);
    await settle();
    await openGridViewer();
    await settle();
    expect(fullScreenImg()?.getAttribute("src")).toBe(L5F_CRED);
    expect(fullScreenImg()?.style.backgroundImage).toContain(L5F_1080);
  });

  it("photo grid (post): the inline copy is the clean 1080", async () => {
    wrap(<FacebookPhotoGrid urls={[L4F, L4F2]} />);
    await settle();
    expect(Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual([L4F_1080, L4F2.replace(/\.webp$/, "-r1080.webp")]);
  });

  it("ZoomableImage: a set photo paints its clean copy whatever the switch says (Unit A)", async () => {
    wrap(<ZoomableImage src={L5F} />);
    await settle();
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(L5F_CRED);
    expect(img.style.backgroundImage).toContain(L5F_1080);
  });

  it("ZoomableImage: a v2 -l4f set paints its clean copy and hands NO retired credited file (credit fix U1)", async () => {
    wrap(<ZoomableImage src={L4F} />);
    await settle();
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(L4F_1080);
    expect(img.style.backgroundImage).toBe("");
  });
});
