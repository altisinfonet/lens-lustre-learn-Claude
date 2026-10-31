/**
 * VID-1 §9 · the play token (sign in the Pages Function, verify in the Worker)
 * and POST /api/video/play-token, driven with a fake Supabase.
 *
 * The properties VID-1 §12 item 14 asks for, tested here at the contract level:
 *   • a viewer who cannot see the video → 404 (never 403, never a token);
 *   • a token for video A is refused on video B's prefix;
 *   • expired, wrong host, altered by one bit, path escape → refused;
 *   • only `ready` videos get a token; delivery not private → 503.
 */
import { describe, it, expect } from "vitest";
import {
  PLAY_TOKEN_TTL_S, b64url, canonicalPayload, fromB64url, playPrefix, signPlayToken, verifyPlayToken,
} from "../shared/playToken";
import { handlePlayToken } from "../../../../functions/api/video/play-token";
import type { VideoEnv } from "../../../../functions/api/video/_lib";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const VID_A = "33333333-3333-4333-8333-333333333333";
const VID_B = "44444444-4444-4444-8444-444444444444";
const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 7)));
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 200 - i)));
const HOST = "cdn-staging.50mmretina.com";
const NOW = 1_800_000_000;

async function tokenFor(video = VID_A, opts: { exp?: number; aud?: string; key?: string } = {}) {
  return signPlayToken(
    { prefix: playPrefix(OWNER, video, 1), exp: opts.exp ?? NOW + PLAY_TOKEN_TTL_S, sub: VIEWER, aud: opts.aud ?? HOST },
    opts.key ?? KEY,
  );
}
const keyOf = (video: string, file: string) => `video/${OWNER}/${video}/v1/${file}`;

describe("play token: sign → verify", () => {
  it("a fresh token opens every file of its own version", async () => {
    const t = await tokenFor();
    for (const f of ["master.m3u8", "240p.m3u8", "240p.mp4", "240p_12.m4s", "audio_3.m4s", "poster.jpg"]) {
      const r = await verifyPlayToken(t, keyOf(VID_A, f), HOST, NOW, KEY);
      expect(r.ok, f).toBe(true);
    }
  });
  it("no token → refused", async () => {
    expect((await verifyPlayToken(null, keyOf(VID_A, "master.m3u8"), HOST, NOW, KEY)).ok).toBe(false);
  });
  it("a token for video A is refused on video B", async () => {
    const r = await verifyPlayToken(await tokenFor(VID_A), keyOf(VID_B, "master.m3u8"), HOST, NOW, KEY);
    expect(r).toEqual({ ok: false, reason: "prefix" });
  });
  it("a token for v1 is refused on v2 of the same video", async () => {
    const r = await verifyPlayToken(await tokenFor(), `video/${OWNER}/${VID_A}/v2/master.m3u8`, HOST, NOW, KEY);
    expect(r.ok).toBe(false);
  });
  it("expired → refused; one second before expiry → allowed", async () => {
    const t = await tokenFor(VID_A, { exp: NOW + 10 });
    expect((await verifyPlayToken(t, keyOf(VID_A, "poster.jpg"), HOST, NOW + 10, KEY)).ok).toBe(false);
    expect((await verifyPlayToken(t, keyOf(VID_A, "poster.jpg"), HOST, NOW + 9, KEY)).ok).toBe(true);
  });
  it("a lifetime longer than 15 min + skew is refused even when signed", async () => {
    const t = await tokenFor(VID_A, { exp: NOW + PLAY_TOKEN_TTL_S + 61 });
    expect(await verifyPlayToken(t, keyOf(VID_A, "poster.jpg"), HOST, NOW, KEY)).toEqual({ ok: false, reason: "lifetime" });
  });
  it("a token minted for the production host is refused on staging", async () => {
    const t = await tokenFor(VID_A, { aud: "cdn.50mmretina.com" });
    expect(await verifyPlayToken(t, keyOf(VID_A, "poster.jpg"), HOST, NOW, KEY)).toEqual({ ok: false, reason: "aud" });
  });
  it("a token signed with another key is refused", async () => {
    const t = await tokenFor(VID_A, { key: OTHER_KEY });
    expect(await verifyPlayToken(t, keyOf(VID_A, "poster.jpg"), HOST, NOW, KEY)).toEqual({ ok: false, reason: "signature" });
  });
  it("every single-bit change of the signature is refused", async () => {
    const t = await tokenFor();
    const [p, s] = t.split(".");
    const sig = fromB64url(s)!;
    for (let bit = 0; bit < sig.length * 8; bit += 37) {
      const flipped = sig.slice();
      flipped[bit >> 3] ^= 1 << (bit & 7);
      const r = await verifyPlayToken(`${p}.${b64url(flipped)}`, keyOf(VID_A, "poster.jpg"), HOST, NOW, KEY);
      expect(r.ok, `bit ${bit}`).toBe(false);
    }
  });
  it("a payload rewritten to another prefix fails the signature", async () => {
    const t = await tokenFor(VID_A);
    const forged = canonicalPayload({ prefix: playPrefix(OWNER, VID_B, 1), exp: NOW + 60, sub: VIEWER, aud: HOST });
    const tampered = `${b64url(new TextEncoder().encode(forged))}.${t.split(".")[1]}`;
    expect((await verifyPlayToken(tampered, keyOf(VID_B, "poster.jpg"), HOST, NOW, KEY)).ok).toBe(false);
  });
  it("no escape below the prefix: sub-folders, .., other names", async () => {
    const t = await tokenFor();
    for (const k of [keyOf(VID_A, "x/master.m3u8"), keyOf(VID_A, "../v2/master.m3u8"), keyOf(VID_A, "manifest.json"), keyOf(VID_A, "")]) {
      expect((await verifyPlayToken(t, k, HOST, NOW, KEY)).ok, k).toBe(false);
    }
  });
  it("a key that is not 32 bytes is a configuration error, not a weaker key", async () => {
    await expect(signPlayToken({ prefix: playPrefix(OWNER, VID_A, 1), exp: NOW, sub: "anon", aud: HOST }, btoa("short"))).rejects.toThrow(/VID-TOK-002/);
  });
});

/* ── the Function ──────────────────────────────────────────────────────── */

type VideoRow = { id: string; owner_id: string; current_version: number; state: string };

function world(opts: { visibleTo?: Array<string>; state?: string; renditions?: string[]; env?: Partial<VideoEnv> } = {}) {
  const visibleTo = opts.visibleTo ?? ["owner", "viewer", "anon"];
  const env: VideoEnv = {
    SUPABASE_PROJECT_REF: "testref", SUPABASE_ANON_KEY: "anon-key", VIDEO_DELIVERY_PRIVATE: "1",
    MEDIA_TOKEN_KEY: KEY, MEDIA_CDN_HOST: HOST, ...(opts.env ?? {}),
  };
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const who = auth === "Bearer owner-jwt" ? "owner" : auth === "Bearer viewer-jwt" ? "viewer" : auth === "Bearer anon-key" ? "anon" : null;
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/auth/v1/user")) {
      return who === "owner" ? ok({ id: OWNER }) : who === "viewer" ? ok({ id: VIEWER }) : new Response("{}", { status: 401 });
    }
    const sees = who !== null && visibleTo.includes(who);
    if (url.includes("/rest/v1/videos?")) {
      const row: VideoRow = { id: VID_A, owner_id: OWNER, current_version: 1, state: opts.state ?? "ready" };
      return ok(sees && url.includes(`id=eq.${VID_A}`) ? [row] : []);
    }
    if (url.includes("/rest/v1/video_versions?")) {
      return ok(sees ? [{ width: 1280, height: 720, declared_duration_s: "12.40", has_audio: true, renditions: opts.renditions ?? ["240p", "480p", "720p", "audio"] }] : []);
    }
    return new Response("not mocked", { status: 500 });
  }) as typeof fetch;
  const call = (body: unknown, jwt?: string) =>
    handlePlayToken(
      new Request("https://staging.50mmretina.com/api/video/play-token", {
        method: "POST",
        headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify(body),
      }),
      env, new Date(NOW * 1000), fetchImpl,
    );
  return { call, calls };
}

describe("POST /api/video/play-token", () => {
  it("a viewer who may see a ready video gets a token that opens only that video", async () => {
    const { call } = world();
    const res = await call({ video_id: VID_A }, "viewer-jwt");
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.master_url.startsWith(`https://${HOST}/video/${OWNER}/${VID_A}/v1/master.m3u8?t=`)).toBe(true);
    expect(b.expires_at).toBe(NOW + PLAY_TOKEN_TTL_S);
    expect(b).toMatchObject({ width: 1280, height: 720, duration_s: 12.4, has_audio: true });
    const t = decodeURIComponent(new URL(b.master_url).searchParams.get("t")!);
    expect((await verifyPlayToken(t, keyOf(VID_A, "240p_0.m4s"), HOST, NOW, KEY)).ok).toBe(true);
    expect((await verifyPlayToken(t, keyOf(VID_B, "240p_0.m4s"), HOST, NOW, KEY)).ok).toBe(false);
    expect(JSON.stringify(b)).not.toContain(KEY);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("signed out: the anon key reads through RLS and the token says sub=anon", async () => {
    const { call } = world();
    const b = await (await call({ video_id: VID_A })).json();
    const t = decodeURIComponent(new URL(b.master_url).searchParams.get("t")!);
    const r = await verifyPlayToken(t, keyOf(VID_A, "poster.jpg"), HOST, NOW, KEY);
    expect(r.ok && r.claims.sub).toBe("anon");
  });
  it("a viewer RLS hides the video from → 404, never 403, no URL", async () => {
    const { call } = world({ visibleTo: ["owner"] });
    const res = await call({ video_id: VID_A }, "viewer-jwt");
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/https?:/);
  });
  for (const state of ["uploading", "checking", "music_blocked", "failed", "taken_down", "deleted"]) {
    it(`a ${state} video gets no token, even for its owner`, async () => {
      const { call } = world({ state });
      expect((await call({ video_id: VID_A }, "owner-jwt")).status).toBe(404);
    });
  }
  it("a version without the 240p rendition is not playable → 404", async () => {
    const { call } = world({ renditions: ["720p", "audio"] });
    expect((await call({ video_id: VID_A }, "viewer-jwt")).status).toBe(404);
  });
  it("delivery not private on this lane → 503, and no database call is made", async () => {
    const { call, calls } = world({ env: { VIDEO_DELIVERY_PRIVATE: undefined } });
    const res = await call({ video_id: VID_A }, "viewer-jwt");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("VID-ENV-002");
    expect(calls).toEqual([]);
  });
  it("a missing or malformed key / host is a 500 that names it", async () => {
    expect((await (await world({ env: { MEDIA_TOKEN_KEY: undefined } }).call({ video_id: VID_A }, "viewer-jwt")).json()).message).toMatch(/MEDIA_TOKEN_KEY/);
    expect((await world({ env: { MEDIA_TOKEN_KEY: btoa("too short") } }).call({ video_id: VID_A }, "viewer-jwt")).status).toBe(500);
    expect((await world({ env: { MEDIA_CDN_HOST: "https://cdn.x.com/" } }).call({ video_id: VID_A }, "viewer-jwt")).status).toBe(500);
  });
  it("a bad JWT is 401, not a quiet fall back to anon", async () => {
    expect((await world().call({ video_id: VID_A }, "forged")).status).toBe(401);
  });
  it("video_id must be a lowercase uuid (no PostgREST filter injection)", async () => {
    const { call, calls } = world();
    for (const bad of [`${VID_A}&state=eq.ready`, "ABCDEF01-2345-4678-89AB-CDEF01234567", 7, null]) {
      expect((await call({ video_id: bad }, "viewer-jwt")).status).toBe(400);
    }
    expect(calls.filter((c) => c.includes("/rest/v1/"))).toEqual([]);
  });
});
