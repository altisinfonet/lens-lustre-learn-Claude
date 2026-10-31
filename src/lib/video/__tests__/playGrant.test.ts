/**
 * VID-1 · play grants are shared (review #415): one play-token call per
 * (viewer, video) while the grant is fresh, a request in flight is shared, a
 * 403 asks again (`fresh`), failures are never kept, and a URL that could
 * break out of CSS url("…") is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let session: { access_token: string; user: { id: string } } | null = { access_token: "jwt-a", user: { id: "viewer-a" } };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session } }) } },
}));

import { grantDue, requestGrant, resetGrantCache } from "@/lib/video/playGrant";

const OK = { master_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/master.m3u8?t=abc", poster_url: "https://cdn-staging.50mmretina.com/video/o/v/v1/poster.jpg?t=abc", expires_at: 1 };
let perf = 1_000_000;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetGrantCache();
  session = { access_token: "jwt-a", user: { id: "viewer-a" } };
  perf = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => perf);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(OK), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("one grant per viewer and video while it is fresh", () => {
  it("two screens asking at once share ONE request", async () => {
    const [a, b] = await Promise.all([requestGrant("v1"), requestGrant("v1")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
  it("a fresh grant is reused; a due one is asked again", async () => {
    await requestGrant("v1");
    perf += 60_000;
    await requestGrant("v1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    perf += 14 * 60_000;
    const g = await requestGrant("v1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(grantDue(g)).toBe(false);
  });
  it("fresh: true always asks (a segment was refused with 403)", async () => {
    await requestGrant("v1");
    await requestGrant("v1", { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("another viewer (signed in as someone else) never gets this viewer's grant", async () => {
    await requestGrant("v1");
    session = { access_token: "jwt-b", user: { id: "viewer-b" } };
    await requestGrant("v1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer jwt-b");
  });
  it("a refusal is not kept: the next ask tries again", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 404 }));
    expect(await requestGrant("v1")).toBeNull();
    expect(await requestGrant("v1")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("only plain absolute URLs are accepted", () => {
  it.each([
    'https://cdn/p.jpg") ; background:url("https://evil/x',
    "javascript:alert(1)",
    "https://cdn/p.jpg\\",
    "/relative/poster.jpg",
  ])("refuses %s", async (bad) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...OK, poster_url: bad }), { status: 200 }));
    expect(await requestGrant("v-bad")).toBeNull();
  });
});
