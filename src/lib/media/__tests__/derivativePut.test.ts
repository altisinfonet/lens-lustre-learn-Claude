import { describe, expect, it } from "vitest";
import { handlePut } from "../../../../functions/api/media/derivatives/put";

const O = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const KEY = `post-images/${O}/d/${M}/w600.webp`;

function webp(w: number, h: number, pad = 0): Uint8Array {
  const head = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8X"].map((c) => c.charCodeAt(0)),
    [0, 0, 0, 0, 0, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0]);
  return new Uint8Array(head.concat(new Array(pad).fill(0)));
}

function setup(opts: { key?: string; done?: boolean; existing?: number | null } = {}) {
  const calls: string[] = [];
  const puts: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: O }), { status: 200 });
    if (u.endsWith("/rpc/media_derivative_target")) {
      calls.push("target");
      return new Response(JSON.stringify([{ object_key: opts.key ?? KEY, width: 600, height: 450, done: !!opts.done }]), { status: 200 });
    }
    if (u.endsWith("/rpc/media_derivative_record")) { calls.push(`record ${String(init?.body)}`); return new Response("true", { status: 200 }); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const bucket = {
    head: async () => (opts.existing == null ? null : { size: opts.existing }),
    get: async () => null,
    put: async (k: string) => { puts.push(k); return {}; },
    delete: async () => { throw new Error("never deletes"); },
    list: async () => ({ objects: [], truncated: false }),
  };
  const env = { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ANON_KEY: "anon", PHOTOS: bucket, MEDIA: bucket };
  const req = (body: Uint8Array, q = `media_id=${M}&target=public&rung=600`) =>
    new Request(`https://site.example/api/media/derivatives/put?${q}`, { method: "PUT", headers: { authorization: "Bearer jwt" }, body });
  return { calls, puts, env, req, fetchImpl };
}

describe("S3-b derivative writer (put)", () => {
  it("stores a WebP of the exact size at the derivative key, then records it", async () => {
    const s = setup();
    const res = await handlePut(s.req(webp(600, 450)), s.env as never, s.fetchImpl);
    expect(res.status).toBe(201);
    expect(s.puts).toEqual([KEY]);
    expect(s.calls.at(-1)).toMatch(/^record .*w600\.webp/);
  });

  it("never overwrites: a different object at the key is 409 and nothing is written", async () => {
    const s = setup({ existing: 999_999 });
    const res = await handlePut(s.req(webp(600, 450)), s.env as never, s.fetchImpl);
    expect(res.status).toBe(409);
    expect(s.puts).toEqual([]);
  });

  it("refuses a key outside the derivative folder even if the database names it", async () => {
    const s = setup({ key: `post-images/${O}/posts/original-w600h450.webp` });
    const res = await handlePut(s.req(webp(600, 450)), s.env as never, s.fetchImpl);
    expect(res.status).toBe(500);
    expect(s.puts).toEqual([]);
  });

  it("refuses wrong dimensions, non-WebP bodies and bad parameters", async () => {
    const s = setup();
    expect((await handlePut(s.req(webp(601, 450)), s.env as never, s.fetchImpl)).status).toBe(422);
    expect((await handlePut(s.req(new Uint8Array(64)), s.env as never, s.fetchImpl)).status).toBe(415);
    expect((await handlePut(s.req(webp(600, 450), `media_id=${M}&target=public&rung=720`), s.env as never, s.fetchImpl)).status).toBe(400);
    expect(s.puts).toEqual([]);
  });

  it("an already-recorded rung touches nothing", async () => {
    const s = setup({ done: true });
    const res = await handlePut(s.req(webp(600, 450)), s.env as never, s.fetchImpl);
    expect(res.status).toBe(200);
    expect(s.puts).toEqual([]);
    expect(s.calls).toEqual(["target"]);
  });
});
