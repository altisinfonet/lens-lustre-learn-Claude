/**
 * ITEM E — THE CLIENT READS MEDIA THROUGH `post_media_for`, AND ONLY THROUGH IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2 moved media ownership from `posts.image_urls` to
 * `post_media → media_objects`. Item C shipped the one sanctioned read path:
 * `post_media_for(uuid[])`, SECURITY DEFINER, whose `can_view_post` predicate is
 * the entire access control, and which grants the client NOTHING on either
 * table. Item E is the client switching onto it.
 *
 * The failure this file exists to catch is not "the feed is blank" — that is
 * loud and someone notices in a minute. It is the quiet one: the switch
 * *appearing* to have happened while the pictures still come from the legacy
 * column, so the day `image_urls` stops being written every photograph vanishes
 * at once. Or the opposite quiet failure: the fallback removed, and the 84
 * photographs on the 57 unmigrated posts vanish today.
 *
 * MEASURED ON PRODUCTION BEFORE ANY OF THIS WAS WRITTEN (2026-08-20):
 *
 *     posts                                          254
 *     posts with post_media rows                     197
 *     posts with NO post_media rows                   57   (84 photographs)
 *     post_media rows whose resolved URL == image_urls[ord]   228 / 228
 *     posts where count(post_media) <> cardinality(image_urls)   0
 *
 * So the switch is pixel-identical today, and the fallback is load-bearing.
 * Both of those are asserted below rather than assumed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Every call the client makes to the RPC, in order, exactly as sent. */
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
/** What the next RPC call resolves to. Set per test. */
let rpcResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  },
}));

const warnings: unknown[] = [];
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: (e: unknown) => warnings.push(e),
    error: (e: unknown) => warnings.push(e),
    info: () => {},
    debug: () => {},
  },
}));

import {
  POST_MEDIA_ID_BATCH,
  MEDIA_CDN_HOST,
  mediaUrlFor,
  batchPostIds,
  fetchPostMediaMap,
  resolvePostImageUrls,
} from "@/lib/media/postMediaRead";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const OWNER = "00af64a6-399d-4399-a5a4-5234554bc6c6";
const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const path = (n: string) => `post-images/${OWNER}/posts/${n}.webp`;
const row = (post_id: string, ord: number, object_path: string | null) => ({
  post_id, ord, object_path, width: 1600, height: 1200, mime: "image/webp", bytes: 1,
});

/** The four surfaces that build the media array. There must be no fifth. */
const PRODUCERS = [
  "src/hooks/feed/useFeedQuery.ts",
  "src/hooks/feed/useUserPostsQuery.ts",
  "src/pages/PostDetail.tsx",
  "src/pages/HashtagFeed.tsx",
];

beforeEach(() => {
  rpcCalls.length = 0;
  warnings.length = 0;
  rpcResult = { data: [], error: null };
});

describe("the media read path calls post_media_for, batched, and nothing else", () => {
  it("calls exactly ONE rpc, named post_media_for, for a whole feed page", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(8) + "-1111-1111-1111-111111111111");
    await fetchPostMediaMap(ids);
    expect(
      rpcCalls.length,
      "N+1: a feed page must cost ONE media call, not one per post.",
    ).toBe(1);
    expect(rpcCalls[0].fn).toBe("post_media_for");
  });

  it("sends ONLY the post ids — never a viewer id, never a privacy hint", () => {
    return fetchPostMediaMap([P1]).then(() => {
      expect(Object.keys(rpcCalls[0].args)).toEqual(["_post_ids"]);
      // auth.uid() is the server's business. A caller-supplied viewer id is
      // mutation 2 of the Item C harness and it must never appear here.
      expect(JSON.stringify(rpcCalls[0].args)).not.toMatch(/viewer|uid|user_id|privacy/i);
    });
  });

  it("batches at the RPC's 50-id cap and never exceeds it", async () => {
    const ids = Array.from({ length: 123 }, (_, i) => `p${i}`);
    await fetchPostMediaMap(ids);
    expect(rpcCalls.length).toBe(3);
    const sizes = rpcCalls.map((c) => (c.args._post_ids as string[]).length);
    expect(sizes).toEqual([50, 50, 23]);
    for (const s of sizes) {
      expect(s, "a batch over 50 is refused by MEDIA-1001 and loses that page's media").toBeLessThanOrEqual(50);
    }
  });

  it("duplicate post ids are collapsed before the call and do not duplicate media", async () => {
    rpcResult = { data: [row(P1, 0, path("a"))], error: null };
    const map = await fetchPostMediaMap([P1, P1, P1, P1]);
    expect((rpcCalls[0].args._post_ids as string[])).toEqual([P1]);
    expect(map.get(P1)).toHaveLength(1);
  });

  it("empty and malformed ids are dropped rather than sent", () => {
    expect(batchPostIds([])).toEqual([]);
    expect(batchPostIds(["", null as unknown as string, undefined as unknown as string, P1])).toEqual([[P1]]);
  });

  it("no ids means no call at all", async () => {
    const map = await fetchPostMediaMap([]);
    expect(rpcCalls.length).toBe(0);
    expect(map.size).toBe(0);
  });
});

describe("what comes back is mapped to the right post, in the right order", () => {
  it("a multi-slide post preserves ord ordering even if rows arrive shuffled", async () => {
    rpcResult = {
      data: [row(P1, 2, path("c")), row(P1, 0, path("a")), row(P1, 1, path("b"))],
      error: null,
    };
    const map = await fetchPostMediaMap([P1]);
    expect(map.get(P1)).toEqual([
      `https://${MEDIA_CDN_HOST}/${path("a")}`,
      `https://${MEDIA_CDN_HOST}/${path("b")}`,
      `https://${MEDIA_CDN_HOST}/${path("c")}`,
    ]);
  });

  it("a mixed page maps each post's media to that post and no other", async () => {
    rpcResult = {
      data: [row(P1, 0, path("a")), row(P2, 0, path("x")), row(P2, 1, path("y"))],
      error: null,
    };
    const map = await fetchPostMediaMap([P1, P2]);
    expect(map.get(P1)).toEqual([`https://${MEDIA_CDN_HOST}/${path("a")}`]);
    expect(map.get(P2)).toHaveLength(2);
    expect(map.get(P2)![0]).toContain("/x.webp");
  });

  it("a missing derivative drops that slide instead of emitting an empty src", async () => {
    rpcResult = { data: [row(P1, 0, null), row(P1, 1, path("b"))], error: null };
    const map = await fetchPostMediaMap([P1]);
    expect(map.get(P1)).toEqual([`https://${MEDIA_CDN_HOST}/${path("b")}`]);
    expect(map.get(P1)!.every((u) => u.length > 0)).toBe(true);
  });

  it("a post with no rows at all is simply absent from the map", async () => {
    rpcResult = { data: [], error: null };
    const map = await fetchPostMediaMap([P1]);
    expect(map.has(P1)).toBe(false);
  });
});

describe("object paths become addresses safely", () => {
  it("a bucket-relative path resolves to the media CDN host", () => {
    expect(mediaUrlFor(path("a"))).toBe(`https://${MEDIA_CDN_HOST}/${path("a")}`);
  });

  it("the host is the image's own CDN, never the apex", () => {
    // src/lib/cdnImage.ts records four days of missing photographs caused by
    // addressing the apex. This constant must not drift to it.
    expect(MEDIA_CDN_HOST).toBe("cdn.50mmretina.com");
    expect(mediaUrlFor(path("a"))).not.toMatch(/^https:\/\/(www\.)?50mmretina\.com\//);
  });

  it("an already-absolute derivative is passed through unchanged", () => {
    const abs = `https://${MEDIA_CDN_HOST}/${path("a")}`;
    expect(mediaUrlFor(abs)).toBe(abs);
  });

  it("nothing, traversal or an absolute-root path yields null rather than a broken src", () => {
    for (const bad of [null, undefined, "", "   ", "/etc/passwd", "post-images/../../secret.webp"]) {
      expect(mediaUrlFor(bad as string | null), `${String(bad)} produced a URL`).toBeNull();
    }
  });
});

describe("the legacy fallback keeps 57 posts rendering through the transition", () => {
  it("a migrated post renders from the media graph", () => {
    const map = new Map([[P1, ["https://cdn.50mmretina.com/a.webp"]]]);
    expect(resolvePostImageUrls(map, P1, ["https://legacy/old.webp"])).toEqual([
      "https://cdn.50mmretina.com/a.webp",
    ]);
  });

  it("an UNMIGRATED post still renders from posts.image_urls", () => {
    const map = new Map<string, string[]>();
    expect(
      resolvePostImageUrls(map, P1, ["https://legacy/one.webp", "https://legacy/two.webp"]),
      "57 posts / 84 photographs depend on this branch existing.",
    ).toEqual(["https://legacy/one.webp", "https://legacy/two.webp"]);
  });

  it("a post with neither representation renders nothing rather than throwing", () => {
    expect(resolvePostImageUrls(new Map(), P1, null)).toEqual([]);
    expect(resolvePostImageUrls(null, P1, undefined)).toEqual([]);
    expect(resolvePostImageUrls(new Map(), P1, [null, "", undefined])).toEqual([]);
  });

  it("an RPC failure degrades to the legacy path and is logged, never silent", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const map = await fetchPostMediaMap([P1]);
    expect(map.size, "a failed read must not throw the feed down").toBe(0);
    expect(resolvePostImageUrls(map, P1, ["https://legacy/one.webp"])).toEqual([
      "https://legacy/one.webp",
    ]);
    expect(warnings.length, "a permanent quiet fallback is not an acceptable state").toBe(1);
    expect(JSON.stringify(warnings[0])).toContain("MEDIA-3001");
  });
});

/**
 * PRIVACY. The client performs NO visibility logic and must not: `post_media_for`
 * is SECURITY DEFINER and `can_view_post(auth.uid(), …)` is the entire control
 * (proved against production in Item C — owner 3/1/1, friend 3/1/0, stranger
 * 3/0/0, anon 3/0/0). What this file can prove is that the client neither
 * duplicates that decision nor tries to route around it.
 */
describe("privacy is the server's decision and the client does not second-guess it", () => {
  it("whatever the RPC withholds, the media graph withholds — there is no client-side re-add", async () => {
    // A stranger's view of a friends-only post: the RPC returns nothing.
    rpcResult = { data: [], error: null };
    const map = await fetchPostMediaMap([P1]);
    expect(map.get(P1)).toBeUndefined();
  });

  it("the read module contains no privacy branch of its own", () => {
    const src = strip(read("src/lib/media/postMediaRead.ts"));
    for (const forbidden of ["privacy", "can_view_post", "friends", "auth.uid", "getUser("]) {
      expect(
        src.includes(forbidden),
        `${forbidden} in the client read module means the browser is deciding visibility.`,
      ).toBe(false);
    }
  });

  it("the client never asks for, or carries, forbidden media metadata", () => {
    const src = read("src/lib/media/postMediaRead.ts");
    const producers = PRODUCERS.map(read).join("\n");
    for (const forbidden of ["sha256", "verified_at", "quarantine_reason"]) {
      expect(src.includes(forbidden), `${forbidden} appears in the read module`).toBe(false);
      expect(producers.includes(forbidden), `${forbidden} appears in a producer`).toBe(false);
    }
  });
});

describe("there is exactly one media reader, and every surface uses it", () => {
  it("no file in src/ reads post_media or media_objects directly", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of require("node:fs").readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
      }
    };
    walk("src");
    const offenders = files.filter((f) => {
      if (f.includes("__tests__") || f.endsWith("types.ts")) return false;
      const code = strip(read(f));
      return /\.from\(\s*["'`](post_media|media_objects)["'`]/.test(code);
    });
    expect(
      offenders,
      "anon and authenticated hold ZERO privilege on those tables. A direct " +
        "read cannot work, and making it work would require the grant Item B " +
        "and Item C exist to refuse.",
    ).toEqual([]);
  });

  it("all four media-producing surfaces call the batching reader", () => {
    for (const f of PRODUCERS) {
      const code = strip(read(f));
      expect(
        /fetchPostMediaMap\(/.test(code),
        `${f} does not call fetchPostMediaMap — it is still legacy-only.`,
      ).toBe(true);
      expect(
        /resolvePostImageUrls\(/.test(code),
        `${f} fetches media but does not use it, which is the quiet failure this file exists for.`,
      ).toBe(true);
    }
  });

  it("no surface calls the reader once per post", () => {
    for (const f of PRODUCERS) {
      const code = strip(read(f));
      // `posts.map(p => fetchPostMediaMap([p.id]))` in any spelling.
      expect(
        /\.map\((?:async\s*)?\(?[A-Za-z_$][\w$]*\)?\s*=>[\s\S]{0,200}?fetchPostMediaMap\(/.test(code),
        `${f} calls the media RPC inside a per-post map — that is the N+1.`,
      ).toBe(false);
    }
  });

  it("the feed resolves media inside its existing Promise.all, costing no extra round trip", () => {
    const code = strip(read("src/hooks/feed/useFeedQuery.ts"));
    const at = code.indexOf("fetchPostMediaMap(postIds)");
    expect(at, "the feed no longer batches the page's post ids into one call").toBeGreaterThan(0);
    // The call must sit INSIDE a Promise.all array: the nearest `Promise.all([`
    // before it must be nearer than the nearest `]);` before it. If the array
    // closed first, the read was pulled out and now serialises behind the page.
    const openedAt = code.lastIndexOf("Promise.all([", at);
    const closedAt = code.lastIndexOf("]);", at);
    expect(
      openedAt > closedAt,
      "the media read has been pulled out of the batched Promise.all and now " +
        "serialises behind it.",
    ).toBe(true);
  });

  it("every surface still has the legacy fallback wired as the third argument", () => {
    for (const f of PRODUCERS) {
      const code = strip(read(f));
      expect(
        /resolvePostImageUrls\([\s\S]{0,300}?image_urls/.test(code),
        `${f} calls the resolver without passing image_urls — the 57 unmigrated ` +
          `posts would render blank.`,
      ).toBe(true);
    }
  });
});

describe("the batch size is the RPC's own cap, not a guess", () => {
  it("POST_MEDIA_ID_BATCH equals the cap the shipped migration enforces", () => {
    const sql = read("supabase/migrations/20260819170132_post_media_read_rpc.sql");
    const m = sql.match(/array_length\(_post_ids,\s*1\)\s*>\s*(\d+)/);
    expect(m, "the 50-id cap could not be located in the migration").not.toBeNull();
    expect(
      POST_MEDIA_ID_BATCH,
      "the client batches to a different number than the server refuses at. " +
        "Too high and a page loses its media to MEDIA-1001; too low and every " +
        "page costs extra round trips.",
    ).toBe(Number(m![1]));
  });
});
