/**
 * S7-b · POST /api/video/takedown and the admin client call. The database
 * decides who may take a video down (PROBE 20261030_0701); this proves the
 * route passes the member's own JWT, writes the Worker's revoked list only
 * after the database said yes, and reports when no list is bound.
 */
import { describe, it, expect } from "vitest";
import { handleTakedown, type TakedownEnv } from "../../../../functions/api/video/takedown";
import { takedownVideo } from "../takedown";

const VID = "33333333-3333-4333-8333-333333333333";
const REPORT = "55555555-5555-4555-8555-555555555555";

function setup(opts: { dbStatus?: number; dbBody?: unknown; kv?: boolean | "throws" } = {}) {
  const kv = new Map<string, string>();
  const rpc: Array<{ body: Record<string, unknown>; auth: string | null }> = [];
  const env: TakedownEnv = {
    SUPABASE_PROJECT_REF: "testref", SUPABASE_ANON_KEY: "anon",
    ...(opts.kv === false ? {} : { VIDEO_REVOKED: { put: async (k: string, v: string) => { if (opts.kv === "throws") throw new Error("KV down"); kv.set(k, v); } } }),
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200 });
    if (url.endsWith("/rest/v1/rpc/video_takedown")) {
      rpc.push({ body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(opts.dbBody ?? "taken_down"), { status: opts.dbStatus ?? 200 });
    }
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  const call = (body: unknown) => handleTakedown(new Request("https://site.test/api/video/takedown", {
    method: "POST", headers: { authorization: "Bearer admin-jwt", "content-type": "application/json" }, body: JSON.stringify(body),
  }), env, fetchImpl);
  return { kv, rpc, call };
}

describe("S7-b /api/video/takedown", () => {
  it("takes down as the caller, then puts the video on the revoked list", async () => {
    const w = setup();
    const res = await w.call({ video_id: VID, report_id: REPORT, reason: "copyright (music)" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ video_id: VID, status: "taken_down", revoked_list: true });
    expect(w.rpc).toEqual([{ body: { _video_id: VID, _reason: "copyright (music)", _report_id: REPORT }, auth: "Bearer admin-jwt" }]);
    expect(w.kv.get(VID)).toBe("taken_down");
  });

  it("a refusal from the database (not an admin) writes nothing to the list", async () => {
    const w = setup({ dbStatus: 403, dbBody: { message: "VID-TD-001: only an admin may take a video down" } });
    const res = await w.call({ video_id: VID });
    expect(res.status).toBe(409);
    expect(w.kv.size).toBe(0);
  });

  it("no list bound → still taken down, and says so", async () => {
    const w = setup({ kv: false });
    expect(await (await w.call({ video_id: VID })).json()).toMatchObject({ status: "taken_down", revoked_list: false });
  });

  it("the list write fails AFTER the database took it down → still reported as taken down, revoked_list false", async () => {
    const w = setup({ kv: "throws" });
    const res = await w.call({ video_id: VID });
    expect(w.rpc).toHaveLength(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ video_id: VID, status: "taken_down", revoked_list: false });
  });

  it("a bad video id never reaches the database", async () => {
    const w = setup();
    expect((await w.call({ video_id: "../x" })).status).toBe(400);
    expect(w.rpc).toEqual([]);
  });
});

describe("S7-b takedownVideo (admin page)", () => {
  it("sends the session token and reads the answer", async () => {
    let seen: RequestInit | undefined;
    const r = await takedownVideo(VID, REPORT, "spam", {
      token: async () => "tok",
      fetch: (async (_p: string, init?: RequestInit) => { seen = init; return new Response(JSON.stringify({ status: "already", revoked_list: true }), { status: 200 }); }) as never,
    });
    expect(r).toEqual({ status: "already", revokedList: true });
    expect(new Headers(seen?.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(seen?.body))).toEqual({ video_id: VID, report_id: REPORT, reason: "spam" });
  });
  it("throws the server's message on a refusal", async () => {
    await expect(takedownVideo(VID, null, null, {
      token: async () => null,
      fetch: (async () => new Response(JSON.stringify({ message: "VID-TD-002: only a published (ready) video" }), { status: 409 })) as never,
    })).rejects.toThrow(/VID-TD-002/);
  });
});
