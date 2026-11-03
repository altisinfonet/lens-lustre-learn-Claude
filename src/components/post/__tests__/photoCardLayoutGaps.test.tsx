/**
 * Owner report 3 Nov 2026 (live app + web screenshot, Tanmay De's posts):
 *   (a) "the gap between the photo and Like / Comment / Share got bigger";
 *   (b) "on posts with several photos the slider dots have a huge gap".
 *
 * MEASURED before this fix (live www, signed out, Chromium, 390 px DPR 3 and
 * 1280 px DPR 1, posts ecd31245 [3 photos] and 904596b4 [1 photo]):
 *   (a) photo frame bottom → action row top = 0 px in every case; the action
 *       row is h-12 (48 px) and unchanged since 31 Aug. The one path that
 *       leaves an EMPTY band under the photo is the camera line's height hold
 *       (`reserve`, 28 px) with `photo_set_v2` ON: the read is a react-query
 *       query in the default networkMode "online", so OFFLINE it is paused,
 *       its status stays "pending" for good, and the empty band never goes.
 *   (b) every dot sits in its own 44 × 32 px button with no gap (a11y fix of
 *       16 Aug, 5c4420ae), so the dots are 44 px apart centre to centre.
 *       The album already has keyboard/screen-reader navigation that does
 *       not need the dots: Previous / Next buttons (44 px) and the "1/3"
 *       counter, plus swipe.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { usePostPhotoCameraRead } from "@/hooks/feed/usePostPhotoCamera";
import PostMedia from "@/components/post/PostMedia";

afterEach(() => onlineManager.setOnline(true));

describe("(a) the camera line's height hold never stays when the read cannot run", () => {
  it("offline: the read is not 'pending' forever (it fails, so the empty 28 px band goes)", async () => {
    onlineManager.setOnline(false);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePostPhotoCameraRead("aaaaaaaa-0000-4000-8000-000000000001", true), { wrapper });
    await waitFor(() => expect(result.current.pending).toBe(false), { timeout: 3000 });
  });
});

describe("(b) the slider dots sit close together again", () => {
  const urls = [1, 2, 3].map((i) => `https://cdn.test/post-images/u/posts/p${i}-w2048h1365-l3.webp`);

  it("the dots are an indicator row with a small gap — not 44 px buttons", () => {
    const { container } = render(<PostMedia urls={urls} />);
    const row = container.querySelector("[data-slider-dots]");
    expect(row, "the dots row").not.toBeNull();
    expect(row!.getAttribute("aria-hidden")).toBe("true");
    expect(row!.className).toMatch(/\bgap-1\.5\b/);
    expect(row!.querySelectorAll("button").length).toBe(0);
    expect(row!.querySelectorAll("span").length).toBe(3);
  });

  it("navigation stays reachable without the dots: Previous / Next buttons and the counter", () => {
    const { getByLabelText, getByText } = render(<PostMedia urls={urls} />);
    expect(getByLabelText("Previous photo").tagName).toBe("BUTTON");
    expect(getByLabelText("Next photo").tagName).toBe("BUTTON");
    expect(getByText("1/3")).toBeTruthy();
  });
});
