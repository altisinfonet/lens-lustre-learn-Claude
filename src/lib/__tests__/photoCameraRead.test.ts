/**
 * Photo plan U2 — camera details are read in BATCHES: every card that asks in
 * the same tick shares ONE post_photo_camera_for call (≤ 50 ids per call, the
 * RPC's own limit), the way post_media_for serves a page. Never one per post.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string, a: unknown) => rpc(fn, a) } }));

import { loadPostPhotoCamera, setPostPhotoCameraHidden } from "@/lib/photoCameraRead";

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (_fn: string, a: { p_post_ids: string[] }) => ({
    data: a.p_post_ids.filter((id) => id !== "none").map((id) => ({ post_id: id, ord: 0, info: { iso: 100 }, hidden: false })),
    error: null,
  }));
});

describe("loadPostPhotoCamera", () => {
  it("three cards in one tick → ONE call carrying all three ids", async () => {
    const [a, b, c] = await Promise.all([loadPostPhotoCamera("p1"), loadPostPhotoCamera("p2"), loadPostPhotoCamera("none")]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("post_photo_camera_for");
    expect([...rpc.mock.calls[0][1].p_post_ids].sort()).toEqual(["none", "p1", "p2"]);
    expect(a).toEqual([{ ord: 0, info: { iso: 100 }, hidden: false }]);
    expect(b).toHaveLength(1);
    expect(c).toEqual([]); // no rows = an empty list, not an error
  });

  it("the same id asked twice in a tick is sent once", async () => {
    await Promise.all([loadPostPhotoCamera("p1"), loadPostPhotoCamera("p1")]);
    expect(rpc.mock.calls[0][1].p_post_ids).toEqual(["p1"]);
  });

  it("60 ids → two calls (50 + 10), the RPC's limit is never exceeded", async () => {
    await Promise.all(Array.from({ length: 60 }, (_, i) => loadPostPhotoCamera(`p${i}`)));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((c) => c[1].p_post_ids.length).sort((x: number, y: number) => x - y)).toEqual([10, 50]);
  });

  it("a refused or failed read REJECTS (the surface then shows nothing, never a false 'no details')", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(loadPostPhotoCamera("p1")).rejects.toThrow(/boom/);
  });

  it("orders each post's rows by ord and drops anything malformed", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { post_id: "p1", ord: 1, info: { iso: 2 }, hidden: false },
        { post_id: "p1", ord: 0, info: { iso: 1 }, hidden: false },
        { post_id: "p1", ord: "x", info: { iso: 3 }, hidden: false },
        { post_id: "p1", ord: 2, info: null, hidden: false },
      ],
      error: null,
    });
    expect((await loadPostPhotoCamera("p1")).map((r) => r.ord)).toEqual([0, 1]);
  });
});

describe("setPostPhotoCameraHidden", () => {
  it("calls the author-only RPC with the post and the new state", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(setPostPhotoCameraHidden("p1", true)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_post_photo_camera_hidden", { p_post_id: "p1", p_hidden: true });
  });
  it("a refusal throws with the server's message", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "PHOTO-CAM-006: only the author" } });
    await expect(setPostPhotoCameraHidden("p1", false)).rejects.toThrow(/PHOTO-CAM-006/);
  });
});
