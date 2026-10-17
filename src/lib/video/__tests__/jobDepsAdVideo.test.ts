/**
 * VID-5 · replacing an ad's video marks the old one deleted (review #412), so
 * video_housekeeping purges it instead of keeping it ready and unlinked for ever.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let prevVideo: string | null = "old-video";
let upsertError: { message: string } | null = null;
const upserts: unknown[] = [];
const rpcs: Array<[string, Record<string, unknown>]> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: prevVideo ? { video_id: prevVideo } : null, error: null }) }) }),
      upsert: async (row: unknown) => { upserts.push(row); return { data: null, error: upsertError }; },
    }),
    rpc: async (f: string, a: Record<string, unknown>) => { rpcs.push([f, a]); return { data: "deleted", error: null }; },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/lib/offline/networkQuality", () => ({ getNetState: () => ({ online: true }) }));

import { realJobDeps } from "../jobDeps";

beforeEach(() => { prevVideo = "old-video"; upsertError = null; upserts.length = 0; rpcs.length = 0; });

describe("realJobDeps.linkAdVideo", () => {
  it("replacing: links the new video, then marks the old one deleted", async () => {
    expect((await realJobDeps.linkAdVideo("c1", "new-video", ["travel"])).error).toBeNull();
    expect(upserts).toEqual([{ ad_creative_id: "c1", video_id: "new-video", categories: ["travel"] }]);
    expect(rpcs).toEqual([["video_delete", { _video_id: "old-video" }]]);
  });

  it("first video on the ad: nothing to delete", async () => {
    prevVideo = null;
    await realJobDeps.linkAdVideo("c1", "new-video", ["travel"]);
    expect(rpcs).toEqual([]);
  });

  it("a retry with the same video deletes nothing", async () => {
    prevVideo = "new-video";
    await realJobDeps.linkAdVideo("c1", "new-video", ["travel"]);
    expect(rpcs).toEqual([]);
  });

  it("a refused link deletes nothing (the old video stays on the ad)", async () => {
    upsertError = { message: "VID-LINK-001" };
    expect((await realJobDeps.linkAdVideo("c1", "new-video", ["travel"])).error).toEqual({ message: "VID-LINK-001" });
    expect(rpcs).toEqual([]);
  });
});
