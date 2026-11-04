/**
 * FEED PHOTO SET (`-l6`) — review blockers of #910 (Owner order, 4 Nov 2026:
 * "the photo credit is NEVER stored"; "drawn in the browser when someone saves").
 *
 *   1. No worker may write a credited / derived file for a `-l6` photo. The SQL
 *      class photo_old_credit_class (20261110_0109 / 0110) and the backfill class
 *      (0101) only skip `-l[45]f?`, so they still COUNT a `-l6` URL as an old
 *      photo; every path that can WRITE refuses it through the ONE predicate
 *      isFeedPhotoSet (src/lib/feedPhotoSet.mjs, re-exported by imageLadder.ts).
 *   2. Full screen (ZoomableImage) saves a `-l6` photo WITH the drawn credit, never
 *      the clean 2048.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const savePhotoWithCredit = vi.fn(async () => true);
vi.mock("@/lib/photoCreditSave", async () => ({ ...(await vi.importActual<object>("@/lib/photoCreditSave")), savePhotoWithCredit }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: null, loading: false }) }));

const UID = "11111111-2222-4333-8444-555555555555";
const KEY = `post-images/${UID}/posts/1762160000000-job-0-w2048h1365-l6.webp`;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("1 · one predicate: isFeedPhotoSet", () => {
  it("is exported by imageLadder and recognises the set and its copies only", async () => {
    const { isFeedPhotoSet } = await import("@/lib/imageLadder");
    expect(isFeedPhotoSet(KEY)).toBe(true);
    expect(isFeedPhotoSet(`https://cdn.50mmretina.com/${KEY}?cv=4`)).toBe(true);
    expect(isFeedPhotoSet(KEY.replace(".webp", "-r1080.webp"))).toBe(true);
    expect(isFeedPhotoSet(KEY.replace(".webp", "-thumb.webp"))).toBe(true);
    expect(isFeedPhotoSet(KEY.replace("-l6", "-l5"))).toBe(false);
    expect(isFeedPhotoSet(`post-images/${UID}/posts/1700000000000-IMG_0001.webp`)).toBe(false);
  });

  it("the plain-ESM copy the Node workers import is the same rule", async () => {
    const m = await import("@/lib/feedPhotoSet.mjs");
    expect(m.isFeedPhotoSet(KEY)).toBe(true);
    expect(m.FEED_PHOTO_MARKER).toBe("-l6");
  });
});

describe("1 · nothing credited or derived is ever written for a -l6 photo", () => {
  it("old-credit worker skips -l6 jobs before drawing", () => {
    expect(read("tools/media-derivatives/old-credit.mjs")).toMatch(/isFeedPhotoSet\(j\.src_url\)/);
  });
  it("the old-credit route flags -l6 jobs in the claim and refuses a -l6 credited PUT", () => {
    const src = read("functions/api/media/photoset/oldcredit.ts");
    expect(src).toMatch(/isFeedPhotoSet\(r\.src_url\) \? \{ skip: "feed_set" \}/);
    expect(src).toMatch(/isFeedPhotoSet\(t\.src_url\)[\s\S]{0,200}PHOTO-OC-FEED-001/);
  });
  it("the backfill worker skips -l6 jobs and the backfill source rule refuses them", async () => {
    expect(read("tools/media-derivatives/photo-set.mjs")).toMatch(/isFeedPhotoSet\(j\.source_key\)/);
    const { isBackfillSource } = await import("@/lib/media/photoSetBackfill");
    expect(isBackfillSource(KEY)).toBe(false);
    expect(read("src/lib/media/photoSetBackfill.ts")).toMatch(/isFeedPhotoSet\(key\)/);
  });
  it("retire never accepts a -l6 key", async () => {
    const { isRetireKey } = await import("@/lib/media/photoRetire");
    expect(isRetireKey("post_old", KEY)).toBe(false);
    expect(isRetireKey("post_old", KEY.replace(".webp", "-r1080.webp"))).toBe(false);
  });
});

describe("2 · full screen saves a -l6 photo with the drawn credit", () => {
  it("right-click / long-press menu on ZoomableImage → savePhotoWithCredit, never the browser's clean save", async () => {
    const { default: ZoomableImage } = await import("@/components/media/ZoomableImage");
    const url = `https://cdn.50mmretina.com/${KEY}`;
    const { container } = render(<QueryClientProvider client={new QueryClient()}><ZoomableImage src={url} /></QueryClientProvider>);
    const img = container.querySelector("img")!;
    const ev = fireEvent.contextMenu(img);
    expect(ev).toBe(false); // default prevented
    await vi.waitFor(() => expect(savePhotoWithCredit).toHaveBeenCalledWith(url));
  });

  it("iPhone Safari's long-press callout (no contextmenu there) is switched off for a -l6 photo in full screen", () => {
    // jsdom drops -webkit-touch-callout from CSSStyleDeclaration, so this reads the source.
    const src = read("src/components/media/ZoomableImage.tsx");
    expect(src).toMatch(/drawnSave \? \{ WebkitTouchCallout: "none"/);
  });
});
