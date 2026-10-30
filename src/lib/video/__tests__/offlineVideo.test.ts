/**
 * S7b-6 · feed videos with no network.
 *
 * Owner gate: "saved videos play" in flight mode; one shared phone budget
 * (default 300 MB, the member can change it), a Wi-Fi-only option, and an
 * offline preview of at least the first 25 s.
 *
 * What is kept: the SMALLEST rendition (240p) of a video's first segments
 * (≥ 25 s) plus the matching audio, with the playlists rewritten to exactly
 * those files. Played back through hls.js with a loader that answers from the
 * phone. Kept per member; wiped at sign-out.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { rewritePlaylist } from "../../../../cloudflare/media-authz/handler";
import {
  planPreview, saveVideoPreview, savedPreviewUrl, hasSavedPreview, clearSavedVideos, savedVideoUsage, enforceVideoBudget,
  getVideoOfflineSettings, setVideoOfflineSettings, canSaveVideoNow, offlineLoaderFor,
  PREVIEW_MIN_S, DEFAULT_BUDGET_MB, OFFLINE_VIDEO_ORIGIN, __resetOfflineVideo,
} from "@/lib/video/offlineVideo";
import { masterPlaylist, mediaPlaylist } from "@/lib/video/shared/playlist";

/* ── a fake CDN: one 40 s video, 4 s segments, 3 renditions + audio ───────── */
const SEG = 4;
const N = 10; // 40 s
const MASTER = masterPlaylist([
  { name: "720p", width: 720, height: 1280, bandwidth: 2_500_000, videoCodec: "avc1.64001F" },
  { name: "240p", width: 240, height: 426, bandwidth: 300_000, videoCodec: "avc1.42E01E" },
  { name: "480p", width: 480, height: 854, bandwidth: 1_000_000, videoCodec: "avc1.4D401E" },
], { codec: "mp4a.40.2" });
// real VID-1 names (shared/rules.ts VIDEO_FILE_RE): `<rendition>.mp4` init, `<rendition>_<n>.m4s` segments
const level = (r: string) => mediaPlaylist(`${r}.mp4`, Array.from({ length: N }, (_, i) => ({ name: `${r}_${i}.m4s`, seconds: SEG })));
const BASE = "https://cdn.example.com/video/o/v/v1/";
const MASTER_URL = `${BASE}master.m3u8?t=tok`;

/**
 * Review #674: playlists come through the media-authz Worker, which rewrites
 * EVERY URI to `name?t=<token>` (cloudflare/media-authz/handler.ts) — the fake
 * CDN serves exactly what the real one does.
 */
function cdn(segBytes = 1000, gate?: Promise<void>) {
  const asked: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (!url.endsWith("?t=tok")) return new Response("no token", { status: 403 });
    const name = url.slice(BASE.length).replace(/\?t=tok$/, "");
    const served = (text: string) => {
      const out = rewritePlaylist(text, "tok");
      if (out === null) throw new Error("the Worker would refuse this fixture playlist");
      return new Response(out);
    };
    if (name === "master.m3u8") return served(MASTER);
    if (name.endsWith(".m3u8")) return served(level(name.replace(".m3u8", "")));
    if (gate) await gate;
    return new Response(new Uint8Array(segBytes));
  };
  return { asked, fetchImpl: fetchImpl as typeof fetch };
}

/* ── a fake Cache Storage (jsdom has none) ───────────────────────────────── */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      put: async (req: string, res: Response) => { m.set(String(req), res); },
      match: async (req: string) => m.get(String(req))?.clone(),
      delete: async (req: string) => m.delete(String(req)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
    };
  };
  return { stores, api: { open, delete: async (n: string) => stores.delete(n), has: async (n: string) => stores.has(n) } as unknown as CacheStorage };
}

let caches: ReturnType<typeof fakeCaches>;
const deps = (c = cdn()) => ({ fetch: c.fetchImpl, caches: caches.api });

beforeEach(() => {
  localStorage.clear();
  __resetOfflineVideo();
  caches = fakeCaches();
});

describe("what a preview is", () => {
  it("the 240p rendition only, at least the first 25 s, the audio to the same length, as a finished (VOD) stream", () => {
    const p = planPreview(MASTER, level("240p"), level("audio"), PREVIEW_MIN_S)!;
    expect(PREVIEW_MIN_S).toBeGreaterThanOrEqual(25);
    expect(p.level).toBe("240p.m3u8");
    expect(p.seconds).toBeGreaterThanOrEqual(25);
    expect(p.seconds).toBe(28); // 7 × 4 s
    expect(p.full).toBe(false);
    expect(p.master).toContain("240p.m3u8");
    expect(p.master).not.toMatch(/720p|480p/);
    expect(p.master).toContain('URI="audio.m3u8"');
    expect(p.playlists["240p.m3u8"]).toContain("#EXT-X-ENDLIST");
    expect(p.playlists["240p.m3u8"].match(/#EXTINF/g)).toHaveLength(7);
    expect(p.playlists["audio.m3u8"].match(/#EXTINF/g)).toHaveLength(7);
    expect(p.files).toEqual([
      "240p.mp4", ...Array.from({ length: 7 }, (_, i) => `240p_${i}.m4s`),
      "audio.mp4", ...Array.from({ length: 7 }, (_, i) => `audio_${i}.m4s`),
    ]);
  });
  it("a video shorter than the preview is kept whole", () => {
    const short = mediaPlaylist("240p.mp4", [{ name: "240p_0.m4s", seconds: 4 }, { name: "240p_1.m4s", seconds: 3.5 }]);
    const p = planPreview(MASTER, short, null, PREVIEW_MIN_S)!;
    expect(p.full).toBe(true);
    expect(p.seconds).toBe(7.5);
  });
  it("a playlist with no segments is not a preview", () => {
    expect(planPreview(MASTER, "", null, PREVIEW_MIN_S)).toBeNull();
  });
  it("refuses anything that is not a plain relative file name (never fetches elsewhere)", () => {
    const evil = level("240p").replace("240p_0.m4s", "https://evil.example/x.m4s");
    expect(planPreview(MASTER, evil, null, PREVIEW_MIN_S)).toBeNull();
    expect(planPreview(MASTER, level("240p").replace("240p_1.m4s", "../x.m4s"), null, PREVIEW_MIN_S)).toBeNull();
  });
});

describe("saving one", () => {
  it("fetches the 240p files with the play token and keeps them on the phone under the member", async () => {
    const c = cdn();
    expect(await saveVideoPreview({ userId: "u1", videoId: "vid1", masterUrl: MASTER_URL }, deps(c))).toBe("saved");
    expect(c.asked.every((u) => u.startsWith(BASE) && u.endsWith("?t=tok"))).toBe(true);
    expect(c.asked.some((u) => /720p|480p/.test(u))).toBe(false);
    expect(hasSavedPreview("vid1")).toBe(true);
    const url = savedPreviewUrl("vid1")!;
    expect(url).toBe(`${OFFLINE_VIDEO_ORIGIN}/u1/vid1/master.m3u8`);
    const store = caches.stores.values().next().value as Map<string, Response>;
    expect(store.has(url)).toBe(true);
    expect(store.has(`${OFFLINE_VIDEO_ORIGIN}/u1/vid1/240p_6.m4s`)).toBe(true);
    expect(store.has(`${OFFLINE_VIDEO_ORIGIN}/u1/vid1/240p_7.m4s`)).toBe(false);
    // the kept playlists name the kept files, with no (expiring) token in them
    const lvl = await store.get(`${OFFLINE_VIDEO_ORIGIN}/u1/vid1/240p.m3u8`)!.clone().text();
    expect(lvl).toContain("\n240p_0.m4s\n");
    expect(lvl).not.toContain("?t=");
    expect(await store.get(url)!.clone().text()).not.toContain("?t=");
    // 16 media files of 1000 B, plus the three small rewritten playlists
    expect(savedVideoUsage().bytes).toBeGreaterThan(16 * 1000);
    expect(savedVideoUsage().bytes).toBeLessThan(16 * 1000 + 5000);
    expect(savedVideoUsage().videos).toBe(1);
  });
  it("saving the same video again fetches nothing", async () => {
    await saveVideoPreview({ userId: "u1", videoId: "vid1", masterUrl: MASTER_URL }, deps());
    const c = cdn();
    expect(await saveVideoPreview({ userId: "u1", videoId: "vid1", masterUrl: MASTER_URL }, deps(c))).toBe("exists");
    expect(c.asked).toEqual([]);
  });
  it("a failed fetch keeps nothing half-saved", async () => {
    const c = cdn();
    const broken = (async (u: RequestInfo | URL) => (String(u).includes("240p_3") ? new Response("", { status: 500 }) : c.fetchImpl(u))) as typeof fetch;
    expect(await saveVideoPreview({ userId: "u1", videoId: "vid1", masterUrl: MASTER_URL }, { fetch: broken, caches: caches.api })).toBe("failed");
    expect(hasSavedPreview("vid1")).toBe(false);
    const store = caches.stores.values().next().value as Map<string, Response> | undefined;
    expect(store ? [...store.keys()].filter((k) => k.includes("/vid1/")) : []).toEqual([]);
  });
});

describe("one shared phone budget", () => {
  it("defaults to 300 MB and Wi-Fi only; the member can change both", () => {
    expect(DEFAULT_BUDGET_MB).toBe(300);
    expect(getVideoOfflineSettings()).toEqual({ budgetMB: 300, wifiOnly: true });
    setVideoOfflineSettings({ budgetMB: 1000 });
    setVideoOfflineSettings({ wifiOnly: false });
    expect(getVideoOfflineSettings()).toEqual({ budgetMB: 1000, wifiOnly: false });
  });
  it("over the budget: the oldest saved videos make room; a video bigger than the whole budget is not kept", async () => {
    // each preview = 16 files × 20 kB = 320 kB; a 1 MB budget holds 3
    setVideoOfflineSettings({ budgetMB: 1 });
    for (const id of ["a", "b", "c", "d"]) {
      expect(await saveVideoPreview({ userId: "u1", videoId: id, masterUrl: MASTER_URL }, deps(cdn(20_000)))).toBe("saved");
    }
    expect(hasSavedPreview("a")).toBe(false); // the oldest made room
    expect(["b", "c", "d"].every(hasSavedPreview)).toBe(true);
    expect(savedVideoUsage().bytes).toBeLessThanOrEqual(1024 * 1024);
    const store = caches.stores.values().next().value as Map<string, Response>;
    expect([...store.keys()].some((k) => k.includes("/a/"))).toBe(false);
    expect(await saveVideoPreview({ userId: "u1", videoId: "huge", masterUrl: MASTER_URL }, deps(cdn(200_000)))).toBe("too-big");
    expect(hasSavedPreview("huge")).toBe(false);
    expect(["b", "c", "d"].every(hasSavedPreview)).toBe(true); // nothing thrown away for it
  });
  it("budget 0 = saving is off", () => {
    setVideoOfflineSettings({ budgetMB: 0 });
    expect(canSaveVideoNow({ online: true, slow: false, connectionType: "wifi", saveData: false, native: true, hasCaches: true })).toBe(false);
  });
});

describe("when it may save", () => {
  const ok = { online: true, slow: false, connectionType: "wifi" as string | undefined, saveData: false, native: true, hasCaches: true };
  it("Wi-Fi only (default): Wi-Fi yes, mobile data no", () => {
    expect(canSaveVideoNow(ok)).toBe(true);
    expect(canSaveVideoNow({ ...ok, connectionType: "cellular" })).toBe(false);
    expect(canSaveVideoNow({ ...ok, connectionType: "ethernet" })).toBe(true);
    // the app cannot tell what the link is: not Wi-Fi as far as we know
    expect(canSaveVideoNow({ ...ok, connectionType: undefined })).toBe(false);
  });
  it("Wi-Fi only off: mobile data too", () => {
    setVideoOfflineSettings({ wifiOnly: false });
    expect(canSaveVideoNow({ ...ok, connectionType: "cellular" })).toBe(true);
  });
  it("never offline, on a slow link, with Data Saver, or without Cache Storage", () => {
    setVideoOfflineSettings({ wifiOnly: false });
    expect(canSaveVideoNow({ ...ok, online: false })).toBe(false);
    expect(canSaveVideoNow({ ...ok, slow: true })).toBe(false);
    expect(canSaveVideoNow({ ...ok, saveData: true })).toBe(false);
    expect(canSaveVideoNow({ ...ok, hasCaches: false })).toBe(false);
  });
});

describe("playing it back with no network", () => {
  class FakeBase {
    stats = { loaded: 0, total: 0, aborted: false, retry: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
    context: unknown = null;
    networkCalls: string[] = [];
    constructor(_cfg: unknown) {}
    load(ctx: { url: string }) { this.networkCalls.push(ctx.url); }
    abort() {}
    destroy() {}
  }
  it("the loader answers saved files from the phone and leaves every other URL to the network", async () => {
    await saveVideoPreview({ userId: "u1", videoId: "vid1", masterUrl: MASTER_URL }, deps());
    const Loader = offlineLoaderFor(FakeBase, caches.api);
    const l = new Loader({}) as unknown as FakeBase & { load: (c: unknown, cfg: unknown, cb: unknown) => void };
    const got = await new Promise<{ data: unknown; url: string }>((resolve, reject) => {
      l.load({ url: savedPreviewUrl("vid1"), responseType: "text", type: "manifest" }, {}, {
        onSuccess: (r: { data: unknown; url: string }) => resolve(r), onError: reject, onTimeout: reject,
      });
    });
    expect(String(got.data)).toContain("240p.m3u8");
    const seg = await new Promise<{ data: unknown }>((resolve, reject) => {
      l.load({ url: `${OFFLINE_VIDEO_ORIGIN}/u1/vid1/240p_0.m4s`, responseType: "arraybuffer", type: "media-fragment" }, {}, {
        onSuccess: (r: { data: unknown }) => resolve(r), onError: reject, onTimeout: reject,
      });
    });
    expect((seg.data as ArrayBuffer).byteLength).toBe(1000);
    l.load({ url: "https://cdn.example.com/x.m4s", responseType: "arraybuffer", type: "media-fragment" }, {}, {});
    expect(l.networkCalls).toEqual(["https://cdn.example.com/x.m4s"]);
  });
  it("an aborted load never calls back (hls.js aborts on seek / level switch)", async () => {
    await saveVideoPreview({ userId: "u1", videoId: "vid1", masterUrl: MASTER_URL }, deps());
    const Loader = offlineLoaderFor(FakeBase, caches.api);
    const l = new Loader({}) as unknown as FakeBase & { load: (c: unknown, cfg: unknown, cb: unknown) => void; abort: () => void };
    const calls: string[] = [];
    l.load({ url: savedPreviewUrl("vid1"), responseType: "text", type: "manifest" }, {}, {
      onSuccess: () => calls.push("ok"), onError: () => calls.push("err"), onTimeout: () => calls.push("timeout"),
    });
    l.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([]);
    expect(l.stats.aborted).toBe(true);
  });
  it("a file that is not on the phone is an error, never a network call", async () => {
    const Loader = offlineLoaderFor(FakeBase, caches.api);
    const l = new Loader({}) as unknown as FakeBase & { load: (c: unknown, cfg: unknown, cb: unknown) => void };
    const err = await new Promise<{ code: number }>((resolve) => {
      l.load({ url: `${OFFLINE_VIDEO_ORIGIN}/u1/nope/master.m3u8`, responseType: "text", type: "manifest" }, {}, {
        onSuccess: () => resolve({ code: 200 }), onError: (e: { code: number }) => resolve(e), onTimeout: () => resolve({ code: 0 }),
      });
    });
    expect(err.code).toBe(404);
    expect(l.networkCalls).toEqual([]);
  });
});

describe("review #674: the budget holds when it is lowered", () => {
  it("lowering it removes the oldest saved videos down to the new budget; Off removes them all", async () => {
    setVideoOfflineSettings({ budgetMB: 1 });
    for (const id of ["a", "b", "c"]) await saveVideoPreview({ userId: "u1", videoId: id, masterUrl: MASTER_URL }, deps(cdn(20_000)));
    expect(savedVideoUsage().videos).toBe(3);
    setVideoOfflineSettings({ budgetMB: 0.5 });
    await enforceVideoBudget(caches.api);
    expect(hasSavedPreview("a")).toBe(false);
    expect(savedVideoUsage().bytes).toBeLessThanOrEqual(0.5 * 1024 * 1024);
    setVideoOfflineSettings({ budgetMB: 0 });
    await enforceVideoBudget(caches.api);
    expect(savedVideoUsage()).toEqual({ bytes: 0, videos: 0 });
    const store = caches.stores.get("video-offline-v1");
    expect(store ? store.size : 0).toBe(0);
  });
});

describe("review #674: a save still running at sign-out leaves nothing behind", () => {
  it("clearSavedVideos during a save: the save keeps nothing, and the old list is not written back", async () => {
    await saveVideoPreview({ userId: "u1", videoId: "old", masterUrl: MASTER_URL }, deps());
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const running = saveVideoPreview({ userId: "u1", videoId: "late", masterUrl: MASTER_URL }, deps(cdn(1000, gate)));
    await new Promise((r) => setTimeout(r, 10)); // the save is waiting on its segments
    await clearSavedVideos(caches.api);
    open();
    expect(await running).toBe("failed");
    expect(hasSavedPreview("late")).toBe(false);
    expect(hasSavedPreview("old")).toBe(false);
    expect(savedVideoUsage()).toEqual({ bytes: 0, videos: 0 });
    expect(localStorage.getItem("retina:video-offline:index") ?? "[]").toBe("[]");
    const store = caches.stores.get("video-offline-v1");
    expect(store ? [...store.keys()] : []).toEqual([]);
  });
});

describe("re-review #674: checks made when a save RUNS, not when it was queued", () => {
  it("a save still WAITING in the queue at sign-out keeps nothing", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const first = saveVideoPreview({ userId: "u1", videoId: "a", masterUrl: MASTER_URL }, deps(cdn(1000, gate)));
    const queued = saveVideoPreview({ userId: "u1", videoId: "b", masterUrl: MASTER_URL }, deps());
    await new Promise((r) => setTimeout(r, 10));
    await clearSavedVideos(caches.api);
    open();
    expect(await first).toBe("failed");
    expect(await queued).toBe("failed");
    expect(hasSavedPreview("b")).toBe(false);
    expect(savedVideoUsage()).toEqual({ bytes: 0, videos: 0 });
  });
  it("Wi-Fi only: the phone left Wi-Fi before the save ran → it fetches nothing", async () => {
    const c = cdn();
    expect(await saveVideoPreview({ userId: "u1", videoId: "a", masterUrl: MASTER_URL }, { ...deps(c), allowed: () => false })).toBe("failed");
    expect(c.asked).toEqual([]);
  });
  it("Wi-Fi only: the phone leaves Wi-Fi in the middle of a save → it stops and keeps nothing", async () => {
    const c = cdn();
    let calls = 0;
    expect(await saveVideoPreview({ userId: "u1", videoId: "a", masterUrl: MASTER_URL }, { ...deps(c), allowed: () => ++calls < 6 })).toBe("failed");
    expect(c.asked.length).toBeLessThan(8);
    expect(hasSavedPreview("a")).toBe(false);
  });
  it("the member is no longer the one signed in when the save runs → nothing is kept", async () => {
    expect(await saveVideoPreview({ userId: "u1", videoId: "a", masterUrl: MASTER_URL }, { ...deps(), currentUserId: async () => "u2" })).toBe("failed");
    expect(hasSavedPreview("a")).toBe(false);
    const store = caches.stores.get("video-offline-v1");
    expect(store ? [...store.keys()].filter((k) => k.includes("/a/")) : []).toEqual([]);
  });
});

describe("sign-out", () => {
  it("clearSavedVideos removes every saved video and the list", async () => {
    await saveVideoPreview({ userId: "u1", videoId: "vid1", masterUrl: MASTER_URL }, deps());
    await clearSavedVideos(caches.api);
    expect(hasSavedPreview("vid1")).toBe(false);
    expect(savedVideoUsage()).toEqual({ bytes: 0, videos: 0 });
    expect(caches.stores.size).toBe(0);
  });
});
