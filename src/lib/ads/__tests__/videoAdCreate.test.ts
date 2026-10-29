/**
 * S7-c · VID-5 "Add a video ad": a new ad from a video takes its spot by the
 * library's unchanged rules (adSpotOrder.ts) and gets a frame as its picture.
 */
import { describe, it, expect } from "vitest";
import { createVideoAdCreative, type VideoAdDeps } from "../videoAdCreate";
import { spotsForNew } from "../adSpotOrder";

function deps(over: Partial<VideoAdDeps> = {}) {
  const calls = { frames: [] as number[], pictures: [] as File[], rows: [] as Array<Record<string, unknown>> };
  const d: VideoAdDeps = {
    frame: async (_f, s) => { calls.frames.push(s); return new Uint8Array([0xff, 0xd8, 0xff]); },
    uploadPicture: async (p) => { calls.pictures.push(p); return "https://cdn.test/ad.webp"; },
    insert: async (row) => { calls.rows.push(row); return "new-id"; },
    ...over,
  };
  return { d, calls };
}
const video = new File([new Uint8Array(10)], "promo.mp4", { type: "video/mp4" });

describe("S7-c createVideoAdCreative", () => {
  it("takes the freed spot first, exactly like a new picture (spots stay put)", async () => {
    const rows = [{ id: "a", sort_order: 0 }, { id: "c", sort_order: 2 }];
    const { d, calls } = deps();
    const r = await createVideoAdCreative(video, "story-card", rows, d);
    expect(r).toEqual({ creativeId: "new-id", spot: 1 });
    expect(r.spot).toBe(spotsForNew(rows, 1)[0]);
    expect(calls.rows).toEqual([{ zone: "story-card", image_url: "https://cdn.test/ad.webp", click_url: "", alt_text: "", is_active: true, sort_order: 1 }]);
  });

  it("no gap → after the last ad", async () => {
    const { d } = deps();
    expect((await createVideoAdCreative(video, "story-card", [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], d)).spot).toBe(2);
  });

  it("its picture is a JPEG frame 1 s in; a video too short for that uses the first frame", async () => {
    const a = deps();
    await createVideoAdCreative(video, "story-card", [], a.d);
    expect(a.calls.frames).toEqual([1]);
    expect(a.calls.pictures[0].type).toBe("image/jpeg");
    const b = deps({ frame: async (_f, s) => { if (s === 1) throw new Error("seek"); return new Uint8Array([1]); } });
    await createVideoAdCreative(video, "story-card", [], b.d);
    expect(b.calls.rows).toHaveLength(1);
  });

  it("no picture stored → no ad row (never an ad without a picture)", async () => {
    const { d, calls } = deps({ uploadPicture: async () => { throw new Error("upload failed"); } });
    await expect(createVideoAdCreative(video, "story-card", [], d)).rejects.toThrow("upload failed");
    expect(calls.rows).toEqual([]);
  });
});
