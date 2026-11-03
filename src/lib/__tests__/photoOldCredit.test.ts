/**
 * Photo plan 0109 — an OLD (unmarked) photo's web save target is its credited
 * copy, found by a LOOKUP (post_photo_credit_for), batched like the camera
 * details: one call per tick for every card that asks, ≤ 50 ids per call.
 * The screen keeps the URL the post shows; a new-set photo never consults it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string, a: unknown) => rpc(fn, a) } }));

import { __resetOldPhotoCredit, hasOldPhoto, oldPhotoCreditedUrl, requestOldPhotoCredit } from "@/lib/photoOldCredit";
import { fullScreenPhoto, saveAsPhotoUrl } from "@/lib/photoProtection";

const OLD = "https://cdn.50mmretina.com/post-images/11111111-2222-4333-8444-555555555555/posts/1700000000-abc.webp";
const OLD_CREDITED = "https://cdn.50mmretina.com/post-images/11111111-2222-4333-8444-555555555555/posts/credit/aaaaaaaa-0000-4000-8000-000000000001-0-0123456789ab.webp";
const NEW = "https://cdn.50mmretina.com/post-images/11111111-2222-4333-8444-555555555555/posts/1762-abc-w1080h720-l5.webp";
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetOldPhotoCredit();
  rpc.mockReset();
  rpc.mockImplementation(async (_fn: string, a: { p_post_ids: string[] }) => ({
    data: a.p_post_ids.includes("p1") ? [{ post_id: "p1", ord: 0, src_url: OLD, credited_url: OLD_CREDITED }] : [],
    error: null,
  }));
});

describe("old photo → its credited copy (save target only)", () => {
  it("before the lookup answers, an old photo has no save target (today's behaviour)", () => {
    expect(saveAsPhotoUrl(OLD)).toBeNull();
    expect(fullScreenPhoto(OLD)).toEqual({ shown: OLD, saveAs: null });
  });

  it("after the lookup: save image as gets the credited copy; the screen still shows the original", async () => {
    requestOldPhotoCredit("p1");
    requestOldPhotoCredit("p2");
    await tick(); await tick();
    expect(rpc).toHaveBeenCalledTimes(1); // one call for both cards
    expect(rpc.mock.calls[0][0]).toBe("post_photo_credit_for");
    expect(oldPhotoCreditedUrl(OLD)).toBe(OLD_CREDITED);
    const fs = fullScreenPhoto(OLD);
    expect(fs.shown).toBe(OLD);
    expect(fs.saveAs?.startsWith(OLD_CREDITED)).toBe(true);
    expect(saveAsPhotoUrl(OLD)?.startsWith(OLD_CREDITED)).toBe(true);
  });

  it("a post is asked once (even when the call failed: a lane without 0109 is not hammered); a new-set photo never uses the lookup", async () => {
    requestOldPhotoCredit("p1"); await tick(); await tick();
    requestOldPhotoCredit("p1"); await tick();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(oldPhotoCreditedUrl(NEW)).toBeNull();
    expect(hasOldPhoto([NEW])).toBe(false);
    expect(hasOldPhoto([NEW, OLD])).toBe(true);
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: "boom" } }));
    requestOldPhotoCredit("p9"); await tick(); await tick();
    requestOldPhotoCredit("p9"); await tick(); await tick();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(saveAsPhotoUrl(OLD)?.startsWith(OLD_CREDITED)).toBe(true); // p1's answer still stands
  });

  it("51 posts in one tick → two calls (≤ 50 ids each)", async () => {
    for (let i = 0; i < 51; i++) requestOldPhotoCredit(`q${i}`);
    await tick(); await tick();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((c) => c[1].p_post_ids.length).sort()).toEqual([1, 50]);
  });
});
