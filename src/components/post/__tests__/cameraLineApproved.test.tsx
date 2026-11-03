/**
 * Camera line — THE OWNER-APPROVED FIX (2026-11-03,
 * _control/out/OWNER/50mm-camera-line-FIX.html / .png).
 *
 * Root cause this locks: U2 (#825) built TWO designs. The web feed reused the
 * web PHOTO-PAGE "Camera details" box (50mm-camera-details-WEB.png, a side
 * panel that sits under the caption) as a bordered strip under the caption,
 * with the sample's "Location removed" line. The approved feed design is ONE
 * small line directly under the photo, above Like / Comment / Share, on the
 * web AND in the app, opening in place — no box, no location line.
 *
 * So: on BOTH platforms the line must be the element right after the media
 * and before the action row, and no "Location removed" text may render, closed
 * or opened. Owner v2 (same day): EVERYONE sees that one line only (no arrow,
 * not clickable); SITE ADMINS get the arrow that opens Lens + Taken.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { UnifiedPost } from "@/types/post";

type Row = { post_id: string; ord: number; info: Record<string, unknown>; hidden: boolean };
let cameraRows: Row[] = [];
/** Site admin (user_roles role = admin)? Only admins get the arrow + 2nd line (Owner v2). */
let admin = false;
/** How the camera read answers: normally, never (still reading), or with an error. */
let cameraRead: "ok" | "hang" | "fail" = "ok";
const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
  if (fn === "feature_allowed_me") return { data: args?._feature === "photo_set_v2", error: null };
  if (fn === "post_photo_camera_for") {
    if (cameraRead === "hang") return new Promise<never>(() => {});
    if (cameraRead === "fail") return { data: null, error: { message: "network down" } };
    const ids = (args?.p_post_ids as string[]) ?? [];
    return { data: cameraRows.filter((r) => ids.includes(r.post_id)), error: null };
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
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer-1" }, loading: false }) }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: admin, loading: false }) }));
vi.mock("@/hooks/core/useDownloadImage", () => ({ useDownloadImage: () => ({ downloading: null, download: vi.fn() }) }));
vi.mock("@/contexts/CommentsOverlayContext", () => ({ useCommentsOverlay: () => ({ openPostComments: () => {} }), usePostCommentsDeepLink: () => {} }));
vi.mock("@/hooks/feed/FeedSignalsContext", () => ({ useFeedSignals: () => ({ watch: () => {}, dwell: () => {}, open: () => {} }) }));
vi.mock("@/components/ContributorScore", () => ({ default: () => null }));
vi.mock("@/components/UserIdentityBlock", () => ({ default: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("@/components/ShareSummaryTooltip", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/video/VideoPoster", () => ({ default: () => <span /> }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k, useI18n: () => ({ lang: "en", t: (_k: string, fb?: string) => fb ?? _k }) }));

import PostCard from "@/components/post/PostCard";
import { featureAllowedKey } from "@/hooks/core/useFeatureAllowed";

const L4 = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc-w2048h1365-l4.webp";
const L4_THUMB = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc-w2048h1365-l4-thumb.webp";
/** What live stores for a Nikon today (EXIF Make + Model, joined at upload). */
const NIKON = { camera: "NIKON CORPORATION NIKON Z 6_2", lens: "NIKKOR Z 24-70mm f/4 S", focal_length: 24, aperture: 7.1, shutter: "1/125", iso: 5000, taken_at: "2023-04-08T10:00:00" };

const post = (): UnifiedPost =>
  ({
    id: "p1", user_id: "author-1", content: "After the Prayer", image_url: L4, image_urls: [L4],
    thumbnail_urls: [L4_THUMB], created_at: "2026-11-02T10:00:00Z", privacy: "public", like_count: 3, comment_count: 1,
    share_count: 0, author_name: "Dipannita Sen", author_handle: "dipannita", author_avatar: null, user_reaction: null,
    reaction_counts: {}, tagged_people: [],
  }) as unknown as UnifiedPost;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureAllowedKey("photo_set_v2", "viewer-1"), true);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const setApp = (on: boolean) => {
  (globalThis as { Capacitor?: unknown }).Capacitor = on ? { isNativePlatform: () => true } : undefined;
};
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  rpc.mockClear();
  cameraRead = "ok";
  cameraRows = [{ post_id: "p1", ord: 0, info: NIKON, hidden: false }];
  setApp(false);
});

describe("no layout shift: the line's height is held only while a NEW photo's details are being read (audit M5)", () => {
  const OLD = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1750000000000-old-w1920h1280-l3.webp";
  it("still reading → the held box sits where the line will be (after the photo, before the actions)", async () => {
    cameraRead = "hang";
    const { container } = wrap(card());
    await settle();
    const held = container.querySelector("[data-camera-line-reserve]") as HTMLElement;
    expect(held).not.toBeNull();
    expect((held.previousElementSibling as HTMLElement).querySelector(".cursor-zoom-in")).not.toBeNull();
    expect(container.querySelector("[data-camera-line]")).toBeNull();
  });
  it("the read FAILED → no held gap left behind", async () => {
    cameraRead = "fail";
    const { container } = wrap(card());
    await settle();
    expect(container.querySelector("[data-camera-line-reserve]")).toBeNull();
    expect(container.querySelector("[data-camera-line]")).toBeNull();
  });
  it("an OLD photo (never read at upload) → nothing held", async () => {
    cameraRead = "hang";
    const { container } = wrap(<PostCard post={{ ...post(), image_url: OLD, image_urls: [OLD], thumbnail_urls: [] } as UnifiedPost} currentUserId="viewer-1" onReact={() => {}} onUnreact={() => {}} />);
    await settle();
    expect(container.querySelector("[data-camera-line-reserve]")).toBeNull();
  });
});
afterEach(() => setApp(false));

const card = () => <PostCard post={post()} currentUserId="viewer-1" onReact={() => {}} onUnreact={() => {}} />;
const LOCATION = /Location removed|owner can hide this|Location is always removed/;

/** The line must be the element right after the media and before the action row. */
function expectPlaced(container: HTMLElement): HTMLElement {
  const line = container.querySelector("[data-camera-line]") as HTMLElement;
  expect(line).not.toBeNull();
  const prev = line.previousElementSibling as HTMLElement;
  expect(prev?.querySelector(".cursor-zoom-in")).not.toBeNull();
  const comment = screen.getByRole("button", { name: "post.comment" });
  const caption = screen.getByText(/After the Prayer/);
  expect(before(line, comment)).toBe(true);
  expect(before(comment, caption)).toBe(true);
  expect(line.className).not.toMatch(/\bborder\b|rounded-lg|bg-muted/);
  expect(container.querySelector("[data-camera-strip]")).toBeNull();
  expect(line.textContent).toContain("Nikon Z 6II · 24 mm · f/7.1 · 1/125 s · ISO 5000");
  expect(line.textContent).not.toMatch(/NIKON CORPORATION/);
  // Entry animation: the swappable "lens focus" hook (src/index.css .camLineEnter).
  expect(line.classList.contains("camLineEnter")).toBe(true);
  return line;
}

describe("web and app shell: exact same to same", () => {
  const lineHtml = async (app: boolean, isAdmin: boolean, open: boolean) => {
    setApp(app);
    admin = isAdmin;
    const r = wrap(card());
    await settle();
    const line = r.container.querySelector("[data-camera-line]") as HTMLElement;
    if (open) fireEvent.click(line.querySelector("button")!);
    const out = line.outerHTML.replace(/:r[0-9a-z]+:|«r[0-9a-z]+»|_r_[0-9a-z]+_/g, "ID");
    r.unmount();
    setApp(false);
    return out;
  };
  it.each([["member", false, false], ["admin closed", true, false], ["admin opened", true, true]] as const)(
    "%s: the feed card's camera line markup is identical in the web and the app",
    async (_n, isAdmin, open) => {
      expect(await lineHtml(true, isAdmin, open)).toBe(await lineHtml(false, isAdmin, open));
    },
  );
});

describe.each([["WEB", false], ["APP", true]] as const)("%s card: the approved camera line", (_name, app) => {
  it("EVERYONE: one line directly after the photo, before Like / Comment / Share — no arrow, not clickable, no 2nd line, no location", async () => {
    setApp(app);
    admin = false;
    const { container } = wrap(card());
    await settle();
    const line = expectPlaced(container);
    expect(line.querySelector("button")).toBeNull();
    expect(line.querySelector("[aria-expanded]")).toBeNull();
    expect(line.querySelectorAll("svg")).toHaveLength(1); // the camera icon only — no chevron
    expect(line.textContent).not.toContain("NIKKOR");
    expect(line.textContent).not.toContain("8 Apr 2023");
    fireEvent.click(line);
    expect(line.textContent).not.toContain("NIKKOR");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.textContent).not.toMatch(LOCATION);
  });

  it("the post's OWNER sees the same single line", async () => {
    setApp(app);
    admin = false;
    const { container } = wrap(
      <PostCard post={{ ...post(), user_id: "viewer-1" } as UnifiedPost} currentUserId="viewer-1" onReact={() => {}} onUnreact={() => {}} />,
    );
    await settle();
    const line = expectPlaced(container);
    expect(line.querySelector("button")).toBeNull();
    expect(line.textContent).not.toContain("NIKKOR");
  });

  it("ADMIN: arrow → Lens + Taken slide open below the line (0.25 s), tap again closes; still above the actions", async () => {
    setApp(app);
    admin = true;
    const { container } = wrap(card());
    await settle();
    const line = expectPlaced(container);
    const toggle = line.querySelector("button") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(line.querySelectorAll("svg")).toHaveLength(2); // camera + chevron
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(line.contains(panel)).toBe(true);
    expect(panel.textContent).toContain("NIKKOR Z 24-70mm f/4 S");
    expect(panel.textContent).toContain("8 Apr 2023");
    expect(panel.className).toMatch(/transition-\[max-height,opacity\]/);
    expect(panel.className).toMatch(/duration-\[250ms\]/);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toMatch(LOCATION);
  });

  it("no camera details on a new photo → nothing at all (no line, no grey text)", async () => {
    setApp(app);
    admin = true;
    cameraRows = [];
    const { container } = wrap(card());
    await settle();
    expect(container.querySelector("[data-camera-line]")).toBeNull();
    expect(container.textContent).not.toMatch(/camera/i);
  });
});
