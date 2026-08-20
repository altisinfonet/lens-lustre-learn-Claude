/**
 * A NEWLY PUBLISHED PHOTOGRAPH MUST NOT BECOME AN `image_urls`-ONLY POST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * @decision D-004
 *
 * WHAT THIS FILE IS FOR. The fenced migration reached zero on 2026-08-20 —
 * every photograph inside the candidate pattern had a `media_objects` row and a
 * `post_media` reference. It would have gone non-zero again with the very next
 * upload, because all five production write sites created posts with bytes in a
 * bucket, a string in an array, and nothing that had ever looked at the file.
 * Migrating legacy data while the write path keeps producing more of it is
 * bailing with the tap running.
 *
 * The failures this catches are the quiet ones:
 *
 *   • the media path silently stops running and every new post is legacy-only
 *     again, with nothing in the logs to show it;
 *   • the fallback is reordered to "legacy first" so the media path is never
 *     exercised and rots;
 *   • the fallback is deleted, and a slow verification endpoint costs a member
 *     the post they just waited through an upload for;
 *   • a post publishes with SOME of its slides registered — the exact gap
 *     `post_publish_with_media`'s completeness gate exists to make
 *     unrepresentable, arriving through the client instead;
 *   • the dual-write (D-004) is removed as a tidy-up, blanking every photograph
 *     in the Android binary this repository cannot deploy;
 *   • `image_urls` becomes a SUPPLIED parameter rather than a derived one, so a
 *     caller can publish media A while the legacy readers show URL B.
 *
 * ⚠ THE SQL ASSERTIONS RESOLVE THE LAST DEFINITION ACROSS MIGRATIONS.
 * `CREATE OR REPLACE` means a later file silently wins, so a corpus-wide grep
 * would keep passing against a superseded version.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

/* ── the client under test, with the server mocked at the boundary ───────── */

type RpcCall = { fn: string; args: Record<string, unknown> };
type FnCall = { name: string; body: Record<string, unknown> };

const rpcCalls: RpcCall[] = [];
const fnCalls: FnCall[] = [];
/** Keyed by RPC name; a function so a test can vary answers per call. */
let rpcHandler: (c: RpcCall, n: number) => { data: unknown; error: { message: string } | null };
let fnHandler: (c: FnCall, n: number) => { data: unknown; error: { message: string } | null };

/**
 * ⚠ THE MOCK IS A CLASS, AND THAT IS THE WHOLE POINT.
 *
 * This mock used to be an object literal: `{ rpc: (fn, args) => … }`. An own
 * property that closes over nothing survives being detached, so
 * `const rpc = supabase.rpc; await rpc(…)` worked perfectly here — while the
 * identical line threw in production and cost the member the post. Every test
 * below passed against a client that could not exhibit the defect they exist
 * to catch. That is worse than having no test, because it reads as proof.
 *
 * `MockSupabaseClient` reproduces the real shape from
 * `node_modules/@supabase/supabase-js/dist/index.mjs:291-296`:
 *
 *     rpc(fn, args = {}, options = {…}) { return this.rest.rpc(fn, args, options) }
 *
 * — a PROTOTYPE method whose body dereferences `this`. Detach it and the call
 * runs with `this === undefined` and throws the real TypeError.
 *
 * ⚠ DO NOT "SIMPLIFY" THIS BACK TO AN OBJECT LITERAL, and do not add
 * `this.rpc = this.rpc.bind(this)` — binding in the mock re-creates exactly the
 * blind spot this class removes, because the production client does not bind.
 */
vi.mock("@/integrations/supabase/client", () => {
  class MockRest {
    rpc(fn: string, args: Record<string, unknown>) {
      const call = { fn, args };
      rpcCalls.push(call);
      return Promise.resolve(rpcHandler(call, rpcCalls.length - 1));
    }
  }

  class MockFunctions {
    invoke(name: string, opts: { body: Record<string, unknown> }) {
      const call = { name, body: opts.body };
      fnCalls.push(call);
      return Promise.resolve(fnHandler(call, fnCalls.length - 1));
    }
  }

  class MockSupabaseClient {
    rest = new MockRest();
    functions = new MockFunctions();

    /** Prototype method, exactly as supabase-js declares it. */
    rpc(fn: string, args: Record<string, unknown> = {}) {
      return this.rest.rpc(fn, args);
    }
  }

  return { supabase: new MockSupabaseClient() };
});

const warnings: { code?: string; reason?: string }[] = [];
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: (e: { code?: string }) => warnings.push(e),
    error: (e: { code?: string }) => warnings.push(e),
    info: () => {},
    debug: () => {},
  },
  newCorrelationId: () => "cid-test",
}));

import {
  shaToBytea,
  objectPathFromUrl,
  registerUploadedPhoto,
  registerAllOrNone,
  publishViaMedia,
  reportLegacyOnlyPublish,
  type UploadedPhoto,
} from "@/lib/media/postMediaWrite";
import { supabase } from "@/integrations/supabase/client";

const SHA = (n: number) => String(n).repeat(1).padStart(64, "a").slice(0, 64);
const OWNER = "11111111-1111-4111-8111-111111111111";

function photo(i: number, over: Partial<UploadedPhoto> = {}): UploadedPhoto {
  return {
    url: `https://cdn.50mmretina.com/post-images/${OWNER}/posts/p${i}-w100h100-l3.webp`,
    thumbnailUrl: `https://cdn.50mmretina.com/post-images/${OWNER}/posts/p${i}-w100h100-l3-thumb.webp`,
    stored: { sha256: SHA(i), bytes: 100 + i, width: 100, height: 100, mime: "image/webp" },
    ...over,
  };
}

/** The happy server: begin returns an id, register says ready, publish returns a post. */
function happyServer() {
  let media = 0;
  rpcHandler = (c) => {
    if (c.fn === "media_begin_upload") return { data: `media-${media++}`, error: null };
    if (c.fn === "post_publish_with_media") return { data: "post-1", error: null };
    return { data: null, error: { message: `unexpected rpc ${c.fn}` } };
  };
  fnHandler = () => ({ data: { state: "ready" }, error: null });
}

beforeEach(() => {
  rpcCalls.length = 0;
  fnCalls.length = 0;
  warnings.length = 0;
  happyServer();
});

const input = (photos: UploadedPhoto[]) => ({
  photos,
  content: "a caption",
  privacy: "public",
  categories: ["street"],
  indexingDisabled: false,
  idempotencyKey: "idem-1",
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE 19 REQUIRED BEHAVIOURAL CASES
   ═══════════════════════════════════════════════════════════════════════════ */

describe("write path — behaviour", () => {
  it("1. a one-photo post goes through the media path", async () => {
    const out = await publishViaMedia(input([photo(1)]));
    expect(out).toEqual({ postId: "post-1", viaMedia: true, failure: null });
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "media_begin_upload",
      "post_publish_with_media",
    ]);
    expect(fnCalls.map((c) => c.name)).toEqual(["media-register-upload"]);
  });

  it("2. a multi-photo post registers every slide before publishing", async () => {
    const out = await publishViaMedia(input([photo(1), photo(2), photo(3)]));
    expect(out.viaMedia).toBe(true);
    expect(rpcCalls.filter((c) => c.fn === "media_begin_upload")).toHaveLength(3);
    expect(fnCalls).toHaveLength(3);
    // The publish is LAST: no post exists until every photograph is ready.
    expect(rpcCalls[rpcCalls.length - 1].fn).toBe("post_publish_with_media");
  });

  it("3. ordering is the composer's order, and it is carried positionally", async () => {
    await publishViaMedia(input([photo(7), photo(8), photo(9)]));
    const publish = rpcCalls.find((c) => c.fn === "post_publish_with_media")!;
    // ords are derived server-side from THIS array's ordinality, so the array
    // order is the slide order. A set would have lost it.
    expect(publish.args._media_ids).toEqual(["media-0", "media-1", "media-2"]);
    expect(publish.args._thumbnail_urls).toEqual([
      photo(7).thumbnailUrl, photo(8).thumbnailUrl, photo(9).thumbnailUrl,
    ]);
  });

  it("4. a duplicate upload resolves to ONE media object, not two", async () => {
    // media_begin_upload is idempotent on UNIQUE(owner, sha256): the same bytes
    // twice come back as the same id. The client must not "helpfully" dedupe
    // them away — it passes both and the server refuses the repeat.
    rpcHandler = (c) => {
      if (c.fn === "media_begin_upload") return { data: "media-same", error: null };
      if (c.fn === "post_publish_with_media") {
        return { data: null, error: { message: "the same photograph appears more than once in this post" } };
      }
      return { data: null, error: { message: "?" } };
    };
    const same = photo(1);
    const out = await publishViaMedia(input([same, same]));
    expect(out.viaMedia).toBe(false);
    expect(warnings.some((w) => w.code === "MEDIA-4004")).toBe(true);
  });

  it("5. a retry carries the SAME idempotency key, so the server can return the first post", async () => {
    const i = input([photo(1)]);
    await publishViaMedia(i);
    await publishViaMedia(i);
    const keys = rpcCalls
      .filter((c) => c.fn === "post_publish_with_media")
      .map((c) => c.args._idempotency_key);
    expect(keys).toEqual(["idem-1", "idem-1"]);
  });

  it("6. failed verification does NOT publish, and says why", async () => {
    fnHandler = () => ({ data: { state: "quarantined", reason: "checksum mismatch" }, error: null });
    const out = await publishViaMedia(input([photo(1)]));
    expect(out).toEqual({ postId: null, viaMedia: false, failure: "media-path-failed" });
    expect(rpcCalls.some((c) => c.fn === "post_publish_with_media")).toBe(false);
    const w = warnings.find((x) => x.code === "MEDIA-4003");
    expect(w, "a quarantine must be reported, not swallowed").toBeTruthy();
    expect(String(w!.reason)).toContain("quarantined");
  });

  it("7. a refused media insert stops the post reaching the media path", async () => {
    rpcHandler = (c) =>
      c.fn === "media_begin_upload"
        ? { data: null, error: { message: "too many uploads in flight (50)" } }
        : { data: "post-1", error: null };
    const out = await publishViaMedia(input([photo(1)]));
    expect(out.viaMedia).toBe(false);
    expect(fnCalls).toHaveLength(0);
    expect(warnings.some((w) => w.code === "MEDIA-4002")).toBe(true);
  });

  it("8. a refused post insert reports MEDIA-4004 and yields no post id", async () => {
    rpcHandler = (c) =>
      c.fn === "media_begin_upload"
        ? { data: "media-0", error: null }
        : { data: null, error: { message: "rate limit" } };
    const out = await publishViaMedia(input([photo(1)]));
    expect(out).toEqual({ postId: null, viaMedia: false, failure: "media-path-failed" });
    expect(warnings.some((w) => w.code === "MEDIA-4004")).toBe(true);
  });

  it("9. rollback safety: a refused publish leaves NO post id to act on", async () => {
    // The transaction is the server's; the client's obligation is to not
    // invent a post id when the publish failed. A truthy id here would send
    // the composer on to navigate, invalidate caches and toast success for a
    // post that does not exist.
    rpcHandler = (c) =>
      c.fn === "media_begin_upload" ? { data: "m", error: null } : { data: null, error: { message: "x" } };
    const out = await publishViaMedia(input([photo(1)]));
    expect(out.postId).toBeNull();
  });

  it("10. owner mismatch is the server's answer, and the client does not paper over it", async () => {
    rpcHandler = (c) =>
      c.fn === "media_begin_upload"
        ? { data: "m", error: null }
        : { data: null, error: { message: "1 of 1 photographs are not yours, do not exist, or are not finished uploading" } };
    const out = await publishViaMedia(input([photo(1)]));
    expect(out.viaMedia).toBe(false);
    expect(String(warnings.find((w) => w.code === "MEDIA-4004")!.reason)).toContain("not yours");
  });

  it("11. an unauthorized caller never reaches the publish", async () => {
    rpcHandler = (c) =>
      c.fn === "media_begin_upload"
        ? { data: null, error: { message: "media_begin_upload requires an authenticated caller" } }
        : { data: "post-1", error: null };
    const out = await publishViaMedia(input([photo(1)]));
    expect(out.viaMedia).toBe(false);
    expect(rpcCalls.some((c) => c.fn === "post_publish_with_media")).toBe(false);
  });

  it.each(["public", "friends", "private"])(
    "12/13/14. privacy=%s is passed through verbatim, never defaulted",
    async (privacy) => {
      await publishViaMedia({ ...input([photo(1)]), privacy });
      const publish = rpcCalls.find((c) => c.fn === "post_publish_with_media")!;
      expect(publish.args._privacy).toBe(privacy);
    },
  );

  it("15. concurrent publishes of the same composition share one idempotency key", async () => {
    const i = input([photo(1)]);
    const [a, b] = await Promise.all([publishViaMedia(i), publishViaMedia(i)]);
    expect(a.postId).toBe("post-1");
    expect(b.postId).toBe("post-1");
    const keys = rpcCalls
      .filter((c) => c.fn === "post_publish_with_media")
      .map((c) => c.args._idempotency_key);
    expect(new Set(keys).size).toBe(1);
  });

  it("16. an existing legacy post stays readable — nothing here touches image_urls of other posts", () => {
    const src = readFileSync(join(ROOT, "src/lib/media/postMediaWrite.ts"), "utf8");
    expect(/\.from\(\s*["']posts["']\s*\)/.test(src), "the media write path must not write posts directly").toBe(false);
    expect(/update|delete/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "no update/delete of anything").toBe(false);
  });

  it("17/18. a successful publish is the ONLY way viaMedia is true, and it means both tables were written", async () => {
    const out = await publishViaMedia(input([photo(1), photo(2)]));
    expect(out.viaMedia).toBe(true);
    // post_publish_with_media is a single transaction that inserts the post AND
    // its post_media rows; there is no code path that reports viaMedia without
    // it having returned a post id.
    expect(out.postId).toBe("post-1");
  });

  it("19. no orphan on failure: a post is never published with only SOME slides registered", async () => {
    // Slide 2 of 3 refuses. The whole post must go legacy — every photograph
    // present, nothing half-migrated.
    let n = 0;
    fnHandler = () => (n++ === 1 ? { data: { state: "pending" }, error: null } : { data: { state: "ready" }, error: null });
    const out = await publishViaMedia(input([photo(1), photo(2), photo(3)]));
    expect(out.viaMedia).toBe(false);
    expect(
      rpcCalls.some((c) => c.fn === "post_publish_with_media"),
      "publishing a subset of the slides is exactly the gap the completeness gate exists to prevent",
    ).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE FALLBACK IS DELIBERATE, ORDERED, AND LOUD
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the legacy fallback", () => {
  const composer = readFileSync(join(ROOT, "src/components/WallPosts.tsx"), "utf8");

  it("the media path runs FIRST — legacy is only reached when it did not complete", () => {
    const mediaAt = composer.indexOf("await publishViaMedia(");
    const legacyAt = composer.indexOf('await supabase.from("posts").insert(');
    expect(mediaAt).toBeGreaterThan(-1);
    expect(legacyAt).toBeGreaterThan(-1);
    expect(
      mediaAt < legacyAt,
      "the legacy insert comes first — the media path would never be exercised and would rot",
    ).toBe(true);
    expect(
      /if \(!viaMedia\.viaMedia\) \{/.test(composer),
      "the legacy insert is no longer conditional on the media path having failed",
    ).toBe(true);
  });

  it("every legacy-only publish is counted — MEDIA-4001", () => {
    expect(
      /reportLegacyOnlyPublish\(/.test(composer),
      "a fallback nobody counts is a regression that reintroduces itself: the " +
        "legacy-only population starts growing again and the graph looks flat",
    ).toBe(true);
    const lib = readFileSync(join(ROOT, "src/lib/media/postMediaWrite.ts"), "utf8");
    expect(/code: "MEDIA-4001"/.test(lib)).toBe(true);
  });

  it("the fallback still exists — a slow endpoint must not cost a member their post", () => {
    expect(
      /image_urls: uploadedUrls/.test(composer),
      "the legacy insert was deleted; a member who waited through an upload now " +
        "loses the post whenever verification is slow",
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT IS DECLARED IS WHAT WAS STORED
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the declaration describes the uploaded bytes, not the picked file", () => {
  const up = readFileSync(join(ROOT, "src/lib/imageUpload.ts"), "utf8");
  const so = readFileSync(join(ROOT, "src/lib/media/storedObject.ts"), "utf8");

  it("the hash is taken from the ENCODED file", () => {
    expect(
      /describeStoredObject\(fullResFile/.test(up),
      "hashing the picked file instead of the encoded one declares a fingerprint " +
        "the stored object cannot match, and EVERY upload quarantines itself",
    ).toBe(true);
  });

  it("every return of uploadImageWithThumbnail carries it", () => {
    const returns = up.match(/return \{[\s\S]*?\};/g) ?? [];
    const uploadReturns = returns.filter((r) => /thumbnailPath:/.test(r));
    expect(uploadReturns.length).toBeGreaterThanOrEqual(3);
    for (const r of uploadReturns) {
      expect(/\bstored,/.test(r), `an upload return path omits \`stored\`:\n${r}`).toBe(true);
    }
  });

  it("unknown dimensions produce null, never a guess", () => {
    expect(/if \(!dims\) return null;/.test(so)).toBe(true);
    expect(
      /a FALSE declaration|quarantine/i.test(so),
      "the reason for refusing to guess is not written down",
    ).toBe(true);
  });

  it("a slide with no declaration is not sent to the media path", async () => {
    const out = await publishViaMedia(input([photo(1, { stored: null })]));
    expect(out.viaMedia).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   INPUT SHAPES
   ═══════════════════════════════════════════════════════════════════════════ */

describe("shaToBytea / objectPathFromUrl", () => {
  it("a 64-char lowercase digest becomes a bytea literal", () => {
    expect(shaToBytea("a".repeat(64))).toBe(`\\x${"a".repeat(64)}`);
    expect(shaToBytea("A".repeat(64))).toBe(`\\x${"a".repeat(64)}`);
  });

  it("anything that is not a digest is refused rather than sent", () => {
    for (const bad of ["", "zz", "a".repeat(63), "a".repeat(65), `${"a".repeat(63)}g`]) {
      expect(shaToBytea(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("a CDN url becomes the bucket-relative key", () => {
    expect(objectPathFromUrl("https://cdn.50mmretina.com/post-images/x/posts/a.webp"))
      .toBe("post-images/x/posts/a.webp");
  });

  it("query strings and fragments are not part of the object", () => {
    expect(objectPathFromUrl("https://cdn.50mmretina.com/post-images/x/posts/a.webp?t=1"))
      .toBe("post-images/x/posts/a.webp");
  });

  it("traversal and absolute paths are refused", () => {
    expect(objectPathFromUrl("https://cdn.50mmretina.com/../secret")).toBeNull();
    expect(objectPathFromUrl("/post-images/x/a.webp")).toBeNull();
    expect(objectPathFromUrl("")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE SERVER SIDE, ASSERTED AGAINST THE LAST DEFINITION IN THE MIGRATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const bodies = files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));

function lastDefinitionOf(fn: string): string {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$`,
    "gi",
  );
  let latest = "";
  for (const body of bodies) {
    const hits = [...body.matchAll(re)];
    if (hits.length) latest = hits[hits.length - 1][0];
  }
  return latest;
}

describe("post_publish_with_media — the dual-write (D-004)", () => {
  const fn = lastDefinitionOf("post_publish_with_media");

  it("is defined (vacuity guard)", () => {
    expect(fn.length, "no migration defines post_publish_with_media").toBeGreaterThan(0);
  });

  it("writes image_urls — an empty array blanks every Android member's photograph", () => {
    expect(
      /image_urls\s*=\s*'\{\}'|,\s*'\{\}'\s*\)/.test(fn) === false || /_image_urls\[1\], _image_urls/.test(fn),
      "post_publish_with_media writes an empty image_urls. D-004 records why that " +
        "blanks the photograph in a binary this repository cannot deploy.",
    ).toBe(true);
    expect(/INSERT INTO public\.posts[\s\S]*?image_urls/.test(fn)).toBe(true);
    expect(/thumbnail_urls/.test(fn)).toBe(true);
  });

  it("DERIVES image_urls from the media rows — it is never a parameter", () => {
    // If it were supplied, a caller could publish media A while every legacy
    // reader shows URL B.
    expect(
      /_image_urls\s+text\[\]\s*DEFAULT|_image_urls\s+text\[\]\s*,/.test(
        fn.slice(0, fn.indexOf("AS $function$")),
      ),
      "image_urls became a parameter — the legacy array can now disagree with post_media",
    ).toBe(false);
    expect(
      /mo\.derivatives->>'original'/.test(fn),
      "image_urls is no longer derived from media_objects.derivatives",
    ).toBe(true);
  });

  it("CONSTRAINS thumbnail_urls to the photograph or its -thumb sibling", () => {
    expect(/MEDIA-2113/.test(fn), "the thumbnail constraint is gone").toBe(true);
    expect(/-thumb\\\.|-thumb\./.test(fn)).toBe(true);
  });

  it("keeps every property the shipped version had", () => {
    expect(/FROM unnest\(_media_ids\) WITH ORDINALITY AS t\(mid, ord\)/.test(fn), "R15: ords from ordinality").toBe(true);
    expect(/SELECT _post_id, ord - 1, mid/.test(fn), "ords no longer start at 0").toBe(true);
    expect(/publish aborted: % of % photographs attached/.test(fn), "completeness gate").toBe(true);
    expect(/mo\.owner_id <> _uid OR mo\.state <> 'ready'/.test(fn), "ownership + readiness").toBe(true);
    expect(/RETURN _existing;/.test(fn), "idempotency short-circuit").toBe(true);
    expect(/at most 10 photographs/.test(fn), "the 10-photograph cap").toBe(true);
  });

  it("carries the caller's privacy into the row — it is never re-defaulted", () => {
    /**
     * ⚠ FOUND BY MUTATION, 2026-08-20, and it was a real hole. Replacing
     * `_privacy` with a literal `'public'` in the INSERT left every assertion
     * green — so a member choosing "Only me" would have published a PUBLIC
     * post, and the one surface that honours privacy today (the database)
     * would have been the surface that broke it. The parameter existing is not
     * the property; the parameter REACHING THE ROW is.
     */
    const insert = /INSERT INTO public\.posts[\s\S]*?RETURNING id INTO _post_id;/.exec(fn)?.[0] ?? "";
    expect(insert.length, "the INSERT could not be located").toBeGreaterThan(0);
    expect(
      /COALESCE\(_content, ''\), _privacy,/.test(insert),
      "post_publish_with_media no longer inserts the caller's _privacy — a " +
        "restricted post would publish as whatever the literal says",
    ).toBe(true);
    for (const literal of ["'public'", "'friends'", "'private'"]) {
      expect(
        insert.includes(literal),
        `the INSERT hardcodes privacy as ${literal} instead of carrying _privacy`,
      ).toBe(false);
    }
  });

  it("the origin is read from settings and never guessed", () => {
    expect(/MEDIA-2110/.test(fn), "a missing public_url must fail loud, not publish half a URL").toBe(true);
    expect(
      /'https:\/\/cdn\.50mmretina\.com'/.test(fn),
      "the delivery host is hardcoded in the function — it belongs in settings",
    ).toBe(false);
  });

  it("ships with a rollback that says what reverting actually costs", () => {
    const m = files.find((f) => /media_write_path_live/.test(f));
    expect(m, "the live write-path migration is missing").toBeTruthy();
    const rb = join(ROOT, "supabase/rollback", m!.replace(/\.sql$/, "_ROLLBACK.sql"));
    expect(existsSync(rb), "no rollback at supabase/rollback/ for the live write path").toBe(true);
    const src = readFileSync(rb, "utf8");
    // A rollback that silently reopens the delta is worse than none: whoever
    // runs it must know that new posts go back to being image_urls-only.
    expect(/MEDIA-4001|image_urls.-only|delta starts growing/i.test(src)).toBe(true);
    // The phrase wraps across a SQL comment line, so normalise before matching.
    const flat = src.replace(/\s*\n\s*--\s*/g, " ").replace(/\s+/g, " ");
    expect(
      /MUST NOT BE "CLEANED UP"/i.test(flat),
      "the rollback does not warn against deleting the media rows of posts already " +
        "published through the new path — that would destroy verified provenance",
    ).toBe(true);
  });

  it("stays revoked from anon", () => {
    const all = bodies.join("\n");
    expect(
      /REVOKE ALL ON FUNCTION public\.post_publish_with_media\([^)]*\) FROM PUBLIC, anon;/.test(all),
    ).toBe(true);
  });
});

describe("media_mark_ready — the object must be the owner's", () => {
  const fn = lastDefinitionOf("media_mark_ready");

  it("is defined (vacuity guard)", () => {
    expect(fn.length).toBeGreaterThan(0);
  });

  it("refuses an original outside the ROW OWNER's folder, in either media prefix", () => {
    /**
     * Widened 2026-08-20 from `post-images/<owner>/` to
     * `(post-images|avatars)/<owner>/` so class C — album uploads that landed
     * under the avatars prefix of the same R2 bucket — can be migrated.
     * docs/CANDIDATE_PATTERN_AUDIT.md §7.
     *
     * ⚠ THE OWNER SEGMENT IS THE PROPERTY, NOT THE PREFIX. What must never
     * move is that the path is pinned to THIS ROW'S owner. The prefix list is
     * checked separately below so it cannot quietly grow to include platform
     * assets.
     */
    expect(
      /MEDIA-2102/.test(fn),
      "media_mark_ready no longer checks that the stored object belongs to the row's " +
        "owner — a writer that accepts a caller-supplied path can now mark a member's " +
        "row ready against somebody else's photograph",
    ).toBe(true);
    const guard = /'\^\(([a-z|-]+)\)\/' \|\| _owner::text \|\| '\/'/.exec(fn);
    expect(guard, "the owner-folder guard is no longer built from _owner").toBeTruthy();
    expect(
      guard![1].split("|").sort(),
      "the allowed media prefixes changed — anything beyond the member-media prefixes " +
        "lets a writer point a member's row at platform assets",
    ).toEqual(["avatars", "post-images"]);
  });

  it("the LIVE write path stays narrower than the migration", () => {
    /**
     * ⚠ THIS ASSERTION CHANGED SHAPE ON 2026-08-20, AND IT GOT STRICTER.
     *
     * It used to say: the live registrar must not contain the string
     * "avatars" outside a comment. That was a proxy, and a bad one — it would
     * have passed a rename and failed an honest widening. It failed the honest
     * widening first.
     *
     * The invariant it was PROTECTING is real and unchanged: `media_mark_ready`
     * accepts `(post-images|avatars)/<owner>/` because its caller is the
     * migrator running as service_role against an approved manifest, whereas
     * the live registrar's caller is a MEMBER — so a member must never be able
     * to register their own MUTABLE avatar as a post photograph.
     *
     * `avatars/<owner>/my-photos/` is now accepted because album objects are
     * written once under a per-album uuid and never overwritten. That is the
     * whole difference, and it is what these assertions now check directly.
     */
    const edge = readFileSync(join(ROOT, "supabase/functions/media-register-upload/index.ts"), "utf8");

    // The two prefixes that ARE accepted, named exactly.
    expect(
      /key\.startsWith\(`post-images\/\$\{ownerId\}\//.test(edge),
      "the composer's own prefix is no longer accepted",
    ).toBe(true);
    expect(
      /key\.startsWith\(`avatars\/\$\{ownerId\}\/my-photos\//.test(edge),
      "album objects are no longer accepted — MyPhotos posts fall back to legacy",
    ).toBe(true);

    // The prefix that must NEVER be accepted: the whole avatars folder, which
    // holds avatar.webp and cover.webp.
    expect(
      /startsWith\(`avatars\/\$\{ownerId\}\/`\)/.test(edge),
      "the registrar accepts the WHOLE avatars folder — a member can register " +
        "their own mutable avatar as a post photograph",
    ).toBe(false);

    // And the name-level backstop, so a future prefix change cannot re-open it.
    expect(
      /\(avatar\|cover\)/.test(edge),
      "the mutable-name backstop is gone",
    ).toBe(true);
  });

  it("refuses traversal, absolute paths and hosts", () => {
    expect(/MEDIA-2103/.test(fn)).toBe(true);
  });

  it("keeps the rung allow-list — an unknown rung means the reader serves nothing", () => {
    expect(/original', '1440', '1080', '600'/.test(fn)).toBe(true);
  });

  it("is service_role only — a member marking their own bytes ready is the whole gap", () => {
    const all = bodies.join("\n");
    expect(/REVOKE ALL ON FUNCTION public\.media_mark_ready\(uuid, jsonb\) FROM PUBLIC, anon;/.test(all)).toBe(true);
    expect(/REVOKE ALL ON FUNCTION public\.media_mark_ready\(uuid, jsonb\) FROM authenticated;/.test(all)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE VERIFIER
   ═══════════════════════════════════════════════════════════════════════════ */

describe("media-register-upload", () => {
  const fnPath = join(ROOT, "supabase/functions/media-register-upload/index.ts");
  const src = existsSync(fnPath) ? readFileSync(fnPath, "utf8") : "";

  it("exists and is registered with verify_jwt=false for the documented reason", () => {
    expect(src.length, "the verifier is gone — nothing can move an upload to ready").toBeGreaterThan(1000);
    const toml = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
    expect(/\[functions\.media-register-upload\]\s*\n\s*verify_jwt = false/.test(toml)).toBe(true);
  });

  it("re-reads the object and re-hashes it — the check the design rests on", () => {
    expect(/readS3Object\(/.test(src)).toBe(true);
    expect(/crypto\.subtle\.digest\("SHA-256", bytes\)/.test(src)).toBe(true);
    expect(/media_quarantine/.test(src), "a mismatch must quarantine, not merely refuse").toBe(true);
  });

  it("refuses any row that is not the caller's", () => {
    expect(/row\.owner_id !== callerId/.test(src)).toBe(true);
  });

  it("refuses any path outside the ROW OWNER's folder — never the request's", () => {
    expect(/key\.startsWith\(`post-images\/\$\{ownerId\}\//.test(src)).toBe(true);
    expect(
      /objectKeyForOwner\(rawPath, row\.owner_id\)/.test(src),
      "the path is checked against something other than the row's owner",
    ).toBe(true);
  });

  it("refuses a thumbnail or a rung as an original", () => {
    expect(/-thumb\\\.\[A-Za-z0-9\]\+\$/.test(src)).toBe(true);
    expect(/-r\(\?:600\|1080\|1440\)/.test(src)).toBe(true);
  });

  it("the superseded verifier is NOT deployed", () => {
    const toml = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
    expect(
      /\[functions\.media-verify-upload\]/.test(toml),
      "media-verify-upload derives post-images/<owner>/media/<id>/original.* — a " +
        "layout ZERO of the 229 production objects use. Deploying it strands every " +
        "upload at pending. See docs/WRITE_PATH.md.",
    ).toBe(false);
  });
});

describe("reportLegacyOnlyPublish", () => {
  it("names the counter that would show the delta growing again", () => {
    reportLegacyOnlyPublish("because", "cid");
    const w = warnings.find((x) => x.code === "MEDIA-4001");
    expect(w).toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEFERRED PUBLISH PATHS — DRAFTS AND SCHEDULED POSTS
   ═══════════════════════════════════════════════════════════════════════════ */

describe("post_attach_media — the deferred paths", () => {
  const fn = lastDefinitionOf("post_attach_media");

  it("is defined (vacuity guard)", () => {
    expect(fn.length, "no migration defines post_attach_media").toBeGreaterThan(0);
  });

  it("reads the author from the POST, never from the caller", () => {
    /**
     * The scheduled publisher runs hours later as service_role with no session,
     * so there is no auth.uid() to fall back on. If the author came from the
     * caller, that publisher would be asserting whose photograph this is.
     */
    expect(/SELECT user_id, coalesce\(image_urls, '\{\}'\) INTO _author, _slides/.test(fn)).toBe(true);
    expect(/mo\.owner_id <> _author/.test(fn)).toBe(true);
  });

  it("MEDIA-2205: every media must resolve to the photograph the post SHOWS", () => {
    /**
     * ⚠ THIS IS THE ONE THAT MATTERS. Ownership and readiness would happily
     * accept the member's OTHER photographs — the feed would then show a
     * different picture from every other surface, and nothing would be
     * technically wrong.
     */
    expect(/MEDIA-2205/.test(fn), "the resolve-to-the-same-photograph check is gone").toBe(true);
    expect(/_origin \|\| '\/' \|\| \(mo\.derivatives->>'original'\) IS DISTINCT FROM _slides\[t\.ord\]/.test(fn)).toBe(true);
  });

  it("is whole-post or nothing", () => {
    expect(/MEDIA-2204/.test(fn), "a post may now carry fewer references than photographs").toBe(true);
    expect(/MEDIA-2203/.test(fn), "media may now be attached twice").toBe(true);
    expect(/MEDIA-2202/.test(fn), "the same photograph may now appear twice").toBe(true);
  });

  it("offering nothing is a no-op, not an error", () => {
    // A draft written before the media path exists must still publish.
    expect(/RETURN 0;/.test(fn)).toBe(true);
  });

  it("is service_role only — a member attaching their own references is the gap", () => {
    const all = bodies.join("\n");
    expect(/REVOKE ALL ON FUNCTION public\.post_attach_media\(uuid, uuid\[\]\) FROM PUBLIC, anon;/.test(all)).toBe(true);
    expect(/REVOKE ALL ON FUNCTION public\.post_attach_media\(uuid, uuid\[\]\) FROM authenticated;/.test(all)).toBe(true);
  });
});

describe("publish_post_draft — attaches, but never at the cost of the post", () => {
  const fn = lastDefinitionOf("publish_post_draft");

  it("is defined (vacuity guard)", () => {
    expect(fn.length).toBeGreaterThan(0);
  });

  it("ships with a rollback that refuses to drop the media_ids columns", () => {
    const m = files.find((f) => /media_attach_for_deferred_publish/.test(f));
    expect(m, "the deferred-publish migration is missing").toBeTruthy();
    const rb = join(ROOT, "supabase/rollback", m!.replace(/\.sql$/, "_ROLLBACK.sql"));
    expect(existsSync(rb), "no rollback for the deferred-publish migration").toBe(true);
    const flat = readFileSync(rb, "utf8").replace(/\s*\n\s*--\s*/g, " ").replace(/\s+/g, " ");
    // Dropping them would strand media_objects the client already registered:
    // nothing would point at them, and re-applying could not recover the link.
    expect(
      /THE COLUMNS ARE NOT DROPPED/i.test(flat),
      "the rollback does not say the media_ids columns are kept — dropping them " +
        "strands registered media that re-applying cannot recover",
    ).toBe(true);
    expect(/DROP COLUMN/i.test(flat), "the rollback drops a media_ids column").toBe(false);
  });

  it("calls post_attach_media", () => {
    expect(/PERFORM public\.post_attach_media\(_post_id, _d\.media_ids\);/.test(fn)).toBe(true);
  });

  it("wraps it so a refusal cannot cost the member their post", () => {
    /**
     * Same guarded shape the people-tags block has used since drafts shipped.
     * PL/pgSQL's BEGIN…EXCEPTION is a subtransaction, so a refusal rolls back
     * the WHOLE attach — a partial carousel is not reachable.
     */
    const block = /BEGIN\s+PERFORM public\.post_attach_media[\s\S]{0,400}?EXCEPTION WHEN OTHERS THEN[\s\S]{0,200}?DRAFT-005/;
    expect(
      block.test(fn),
      "the attach is no longer wrapped — a refused media reference now fails the whole publish",
    ).toBe(true);
  });

  it("still deletes the draft and still keeps its images", () => {
    expect(/DELETE FROM public\.post_drafts WHERE id = _draft_id;/.test(fn)).toBe(true);
    expect(/Its IMAGES DO NOT/.test(fn)).toBe(true);
  });
});

describe("the client registers deferred media at UPLOAD time", () => {
  const composer = readFileSync(join(ROOT, "src/components/WallPosts.tsx"), "utf8");
  const sched = readFileSync(join(ROOT, "src/hooks/feed/useScheduledPosts.ts"), "utf8");
  const publisher = readFileSync(join(ROOT, "supabase/functions/publish-scheduled-posts/index.ts"), "utf8");
  const lib = readFileSync(join(ROOT, "src/lib/media/postMediaWrite.ts"), "utf8");

  it("Save draft registers and stores media_ids", () => {
    expect(/media_ids: mediaIds,/.test(composer)).toBe(true);
    expect(/registerAllOrNone\(/.test(composer)).toBe(true);
  });

  it("Schedule registers and stores media_ids", () => {
    expect(/media_ids: await registerAllOrNone\(/.test(composer)).toBe(true);
    expect(/media_ids: input\.media_ids \?\? null,/.test(sched)).toBe(true);
  });

  it("registerAllOrNone declines the whole set when one slide cannot be declared", async () => {
    const out = await registerAllOrNone([photo(1), photo(2, { stored: null }), photo(3)]);
    expect(
      out,
      "a subset would publish a post with an ord gap — the one shape every gate " +
        "in this engine exists to make unreachable",
    ).toBeNull();
  });

  it("stops at the first refusal — it does not keep creating media nobody will reference", async () => {
    /**
     * ⚠ FOUND BY MUTATION, 2026-08-20. Removing the early return left the
     * final length check to catch it, so the RETURN VALUE was still null and
     * the suite stayed green — but the loop had gone on to register the
     * remaining slides, creating `media_objects` rows that no post would ever
     * reference. Unreferenced media is exactly what the orphan sweep now
     * reports, and manufacturing it on every failed draft save is a slow leak.
     */
    const out = await registerAllOrNone([photo(1), photo(2, { stored: null }), photo(3)]);
    expect(out).toBeNull();
    expect(
      rpcCalls.filter((c) => c.fn === "media_begin_upload"),
      "registration continued past the slide that could not be declared",
    ).toHaveLength(1);
  });

  it("registerAllOrNone returns every id, in order, when they all register", async () => {
    const out = await registerAllOrNone([photo(1), photo(2)]);
    expect(out).toEqual(["media-0", "media-1"]);
  });

  it("resumed draft slides carry no declaration, so the draft declines rather than half-registers", () => {
    expect(
      /let stored: \(StoredObjectFacts \| null\)\[\] = resumedUrls\.map\(\(\) => null\);/.test(composer),
      "resumed slides no longer default to null — a draft could now register a subset",
    ).toBe(true);
  });

  it("the scheduled publisher attaches, counts failures, and never fails the publish", () => {
    /**
     * ⚠ ASSERT ON THE CALL, NOT ON THE NAME. Found by mutation, 2026-08-20:
     * `/post_attach_media/` and `/MEDIA-4005/` both matched the explanatory
     * COMMENT above the call, so deleting the call itself and deleting the
     * counter both left the suite green. A test that a comment can satisfy is
     * not a test.
     */
    expect(
      /await admin\.rpc\(\s*"post_attach_media"/.test(publisher),
      "the scheduled publisher no longer calls post_attach_media — every scheduled " +
        "post rejoins the legacy-only population",
    ).toBe(true);
    expect(
      /console\.warn\(\s*`MEDIA-4005/.test(publisher),
      "an unattached scheduled post is no longer reported",
    ).toBe(true);
    expect(/summary\.mediaUnattached\+\+;/.test(publisher)).toBe(true);
    // The attach must come AFTER the insert and must not be inside the insErr
    // branch — a member must get their post at the time they asked for it.
    const insertAt = publisher.indexOf('.from("posts")');
    const attachAt = publisher.indexOf('await admin.rpc("post_attach_media"');
    expect(attachAt).toBeGreaterThan(insertAt);
  });

  it("MyPhotos and profilePostHelper are NOT wired, and the reason is written down", () => {
    /**
     * Not an oversight. MyPhotos uploads to `avatars/<uid>/my-photos/…` (the
     * wrong bucket prefix) and profilePostHelper posts the member's
     * `avatars/<uid>/avatar.webp?t=…` — a MUTABLE path overwritten on every
     * profile-photo change, which cannot carry stable content identity at all.
     * `media_mark_ready` refuses both today (MEDIA-2102). Closing them needs
     * the Priority-2 class C/D decision, not a patch.
     */
    const myPhotos = readFileSync(join(ROOT, "src/pages/MyPhotos.tsx"), "utf8");
    expect(/bucket: "avatars"/.test(myPhotos), "MyPhotos no longer uploads to avatars/ — re-open the question").toBe(true);
    const mig = readFileSync(
      join(ROOT, "supabase/migrations/20260820073000_media_attach_for_deferred_publish.sql"),
      "utf8",
    );
    expect(/MyPhotos album posts upload to/.test(mig)).toBe(true);
    expect(/MUTABLE path/.test(mig)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE STALE-CLIENT HOLE — closed 2026-08-20, after it cost a real post.

   THE INCIDENT, because the tests below only make sense with it.

   The write path went live at 05:16 UTC. At 07:08:49 a member published one
   photograph and it landed `image_urls`-only. Every instrument aimed at that
   failure stayed silent: no `media_begin_upload` in the edge logs, no
   MEDIA-4001 in client_errors. The browser was running a bundle from before
   the deploy, so none of the reporting code existed in it.

   Two separate defects, and they need two separate fixes:

     1. `registerUploadedPhoto` returned null on `!photo.stored` with NO log at
        all — the only refusal that makes no network call, and therefore the
        only one that can leave no trace anywhere. MEDIA-4006 now names it.

     2. Every counter lived inside the client. `media_write_path_delta()` reads
        committed rows instead, so it cannot be blinded by an old bundle.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the stale-client hole", () => {
  it("MEDIA-4006: an undescribable photograph is REFUSED OUT LOUD, not silently", async () => {
    /**
     * Before this, `if (!photo.stored) return null;` was the whole branch. The
     * post fell back to legacy and MEDIA-4001 said so — but MEDIA-4001 cannot
     * distinguish "the bytes could not be measured" from "this browser is
     * running last week's code", and those have different fixes.
     */
    const id = await registerUploadedPhoto({
      url: "https://cdn.50mmretina.com/post-images/o/posts/x.webp",
      thumbnailUrl: "",
      stored: null,
    });
    expect(id, "an undescribed slide must never yield a media id").toBeNull();
    const w = warnings.find((x) => x.code === "MEDIA-4006");
    expect(w, "a slide that never reaches the server must still be reported").toBeTruthy();
  });

  it("MEDIA-4006 is raised BEFORE any network call, so it cannot be confused with a server refusal", async () => {
    await registerUploadedPhoto({
      url: "https://cdn.50mmretina.com/post-images/o/posts/x.webp",
      thumbnailUrl: "",
      stored: null,
    });
    expect(rpcCalls.length, "no RPC may be attempted for an undescribed slide").toBe(0);
    expect(fnCalls.length, "no function may be invoked for an undescribed slide").toBe(0);
    expect(warnings.some((w) => w.code === "MEDIA-4002")).toBe(false);
    expect(warnings.some((w) => w.code === "MEDIA-4003")).toBe(false);
  });

  it("every MEDIA-40xx code the client emits is in the error catalog", () => {
    /**
     * They were not, until today. `log_app_event` accepts any PREFIX-NNNN, so
     * the rows persisted and nothing failed — but docs/error-codes.md, which is
     * what the owner reads when a member quotes a code, described none of them.
     */
    const src = readFileSync(join(ROOT, "src/lib/media/postMediaWrite.ts"), "utf8");
    const catalog = readFileSync(join(ROOT, "src/lib/errorCodes.ts"), "utf8");
    const used = [...src.matchAll(/code: "(MEDIA-\d{4})"/g)].map((m) => m[1]);
    expect(used.length, "no MEDIA codes found — has the file moved?").toBeGreaterThan(3);
    for (const code of used) {
      expect(catalog, `${code} is emitted but not catalogued`).toContain(`code: "${code}"`);
    }
  });

  it("the build marker was bumped past the bundle that caused the incident", () => {
    /**
     * "2026-08-10-3" is the value that was still being reported by the client
     * that published the legacy-only post, three releases after it was current.
     * A marker that is never bumped cannot tell a stale client from a current
     * one, which is the whole reason it exists.
     */
    const main = readFileSync(join(ROOT, "src/main.tsx"), "utf8");
    const m = main.match(/__APP_BUILD = "([^"]+)"/);
    expect(m, "the build marker is gone").toBeTruthy();
    expect(m![1], "the marker still reads the pre-incident build").not.toBe("2026-08-10-3");
  });
});

describe("media_write_path_delta — the check that does not trust the client", () => {
  const fn = lastDefinitionOf("media_write_path_delta");

  it("is defined (vacuity guard)", () => {
    expect(fn.length, "no migration defines media_write_path_delta").toBeGreaterThan(0);
  });

  it("reads only committed rows — it never consults a log table", () => {
    /**
     * THE POINT OF THE WHOLE FUNCTION. client_errors is written by the client,
     * so a client that is not running the new code writes nothing there. If
     * this function ever starts reading it, it inherits the blindness it was
     * built to escape.
     */
    expect(/client_errors/.test(fn), "the delta check must not depend on client logs").toBe(false);
    expect(/from public\.posts/.test(fn)).toBe(true);
    expect(/public\.post_media/.test(fn)).toBe(true);
  });

  it("reports the growing delta specifically, not just a total", () => {
    /**
     * A shrinking total can hide a growing edge: migration removes ten old
     * legacy-only posts while the write path adds one new one, and the headline
     * number improves. `new_legacy_only_posts` is scoped to posts created after
     * the cutoff, so it cannot be masked that way.
     */
    expect(/'new_legacy_only_posts'/.test(fn)).toBe(true);
    expect(/'new_legacy_only_slides'/.test(fn)).toBe(true);
    expect(/'delta_growing'/.test(fn)).toBe(true);
    expect(/'newest_legacy_only_post'/.test(fn)).toBe(true);
  });

  it("is read-only and grants nothing to a client", () => {
    /**
     * Phase 2's standing rule: media_objects and post_media carry no client
     * grants. A diagnostic is not a reason to break it.
     */
    expect(/\b(insert|update|delete)\s+(into|from)?\s*public\./i.test(fn)).toBe(false);
    expect(/\bstable\b/i.test(fn)).toBe(true);
    const file = readFileSync(
      join(MIGRATIONS, "20260820110000_media_write_path_delta.sql"),
      "utf8",
    );
    expect(/revoke all on function public\.media_write_path_delta/.test(file)).toBe(true);
    expect(/grant execute on function public\.media_write_path_delta/i.test(file)).toBe(false);
  });

  it("has a rollback that says what is lost by running it", () => {
    const rb = join(ROOT, "supabase/rollback/20260820110000_media_write_path_delta_ROLLBACK.sql");
    expect(existsSync(rb)).toBe(true);
    const src = readFileSync(rb, "utf8");
    expect(/drop function if exists public\.media_write_path_delta/.test(src)).toBe(true);
    expect(/07:08/.test(src), "the rollback must carry the incident that justifies the function").toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOURTH WRITE SURFACE — `create_system_post`, found 2026-08-20.

   The write-path work closed the composer, the draft and the scheduler. A
   repository-wide re-trace found a path that had been looked at and waved
   through: an RPC granted to `authenticated` that does a bare INSERT INTO
   posts with image_urls and nothing else — reached from MyPhotos album uploads
   and from every profile-photo change, and reporting NOTHING, because
   MEDIA-4001 lives in the composer's client code.

   Its two callers are different problems and must not get the same fix:

     ALBUM POSTS    `avatars/<owner>/my-photos/…` — immutable, real
                    photographs. They now go through the media engine, and a
                    legacy-only album post is a REGRESSION.

     PROFILE POSTS  `avatars/<owner>/avatar.webp?t=…` — overwritten on every
                    change. They can NEVER carry content identity. Legacy-only
                    is correct for them; MEDIA-4007 counts them so the floor is
                    explainable rather than merely small.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("create_system_post — the fourth write surface", () => {
  const fn = lastDefinitionOf("create_system_post");

  it("is defined (vacuity guard)", () => {
    expect(fn.length, "no migration defines create_system_post").toBeGreaterThan(0);
  });

  it("takes media ids and attaches them", () => {
    expect(/_media_ids\s+uuid\[\]/.test(fn), "the RPC cannot accept media at all").toBe(true);
    expect(/post_attach_media\(_id, _media_ids\)/.test(fn)).toBe(true);
  });

  it("the attach is GUARDED, so a refusal does not cost the member the post", () => {
    /**
     * Same rule as publish_post_draft's DRAFT-005. PL/pgSQL's BEGIN…EXCEPTION
     * is a subtransaction, so the attach is all-or-none — a partial carousel is
     * unreachable — but the post itself survives a refusal. The member's photos
     * are already in their album; losing the announcement too would be a second
     * failure caused by the first.
     */
    const guarded = /BEGIN\s+PERFORM public\.post_attach_media[\s\S]*?EXCEPTION WHEN OTHERS THEN[\s\S]*?MEDIA-4008/.test(fn);
    expect(guarded, "the attach is unguarded, or no longer reports MEDIA-4008").toBe(true);
  });

  it("still writes user_id from auth.uid(), never from a parameter", () => {
    expect(/_uid uuid := auth\.uid\(\)/.test(fn)).toBe(true);
    expect(/VALUES \(_uid,/.test(fn)).toBe(true);
    expect(/_user_id|_owner_id/.test(fn), "a caller-supplied identity appeared").toBe(false);
  });

  it("the old 4-argument overload is DROPPED, not left alongside", () => {
    /**
     * ⚠ FOUND BY APPLYING IT. With a DEFAULT on the fifth argument, a 4-argument
     * call matches BOTH candidates and Postgres refuses it with 42725
     * `function ... is not unique`. Leaving both would have broken the two live
     * callers the moment either ran.
     */
    const mig = readFileSync(
      join(MIGRATIONS, "20260820120000_system_post_media.sql"),
      "utf8",
    );
    expect(
      /drop function if exists public\.create_system_post\(text, text, text\[\], text\[\]\);/.test(mig),
      "the 4-arg overload is not dropped — a 4-arg call would be ambiguous",
    ).toBe(true);
  });

  it("the PUBLIC grant that CREATE OR REPLACE hands out is revoked", () => {
    /**
     * A new signature takes the server default of EXECUTE to PUBLIC, which
     * silently gave `anon` a post-creating SECURITY DEFINER function. The
     * auth.uid() guard refuses it at runtime, but the grant should not be there.
     */
    const mig = readFileSync(
      join(MIGRATIONS, "20260820120000_system_post_media.sql"),
      "utf8",
    );
    expect(/revoke all on function public\.create_system_post\([^)]*\) from public, anon;/.test(mig)).toBe(true);
    expect(/grant execute on function public\.create_system_post\([^)]*\) to authenticated;/.test(mig)).toBe(true);
  });
});

describe("MyPhotos album posts now reach the media engine", () => {
  const src = readFileSync(join(ROOT, "src/pages/MyPhotos.tsx"), "utf8");

  it("registers every photograph, all-or-none, BEFORE creating the post", () => {
    /**
     * ⚠ THE BINDING, NOT THE CALL. An earlier version of this asserted only
     * that the string `registerAllOrNone(` appeared. Mutation 30 defeated it by
     * writing `const mediaIds = null && await registerAllOrNone(...)` — the
     * call is still there, still spelled correctly, and its result is thrown
     * away. Assert that `mediaIds` IS the awaited result.
     */
    expect(
      /const mediaIds = await registerAllOrNone\(/.test(src),
      "mediaIds is no longer the result of registerAllOrNone — the call may be present but discarded",
    ).toBe(true);
    const registerAt = src.indexOf("registerAllOrNone(");
    const rpcAt = src.indexOf('"create_system_post"');
    expect(registerAt).toBeGreaterThan(-1);
    expect(rpcAt).toBeGreaterThan(-1);
    expect(registerAt, "the post is created before the media is registered").toBeLessThan(rpcAt);
  });

  it("passes the media ids to the RPC", () => {
    expect(/_media_ids: mediaIds/.test(src)).toBe(true);
  });

  it("carries the stored facts through the upload loop", () => {
    /**
     * Without these the register call has nothing to declare and every album
     * post silently falls back to legacy — the failure mode MEDIA-4006 exists
     * to name.
     */
    expect(/uploadedStored\.push\(result\.stored\)/.test(src)).toBe(true);
  });

  it("reports MEDIA-4001 when the album post lands legacy-only", () => {
    expect(/reportLegacyOnlyPublish\(/.test(src), "a legacy-only album post is silent again").toBe(true);
  });
});

describe("profile-update posts are permanently legacy-only, and counted", () => {
  const src = readFileSync(join(ROOT, "src/lib/profilePostHelper.ts"), "utf8");

  it("passes NULL media ids, deliberately", () => {
    expect(/_media_ids: null/.test(src)).toBe(true);
  });

  it("emits MEDIA-4007, which is NOT MEDIA-4001", () => {
    /**
     * MEDIA-4001 means "the media path was tried and did not complete" — a
     * regression that should trend to zero. MEDIA-4007 means "this post can
     * never carry media references" — a floor. Filing both under one code makes
     * a healthy floor look like a growing fault, and then the threshold gets
     * raised and nobody reads either.
     */
    expect(/code: "MEDIA-4007"/.test(src)).toBe(true);
    expect(/code: "MEDIA-4001"/.test(src), "the floor is being reported as a regression").toBe(false);
  });

  it("says WHY it can never be migrated, next to the null", () => {
    expect(/MUTABLE/.test(src)).toBe(true);
    expect(/MEDIA-2102/.test(src)).toBe(true);
  });
});

describe("media-register-upload accepts album objects but never a mutable avatar", () => {
  const src = readFileSync(
    join(ROOT, "supabase/functions/media-register-upload/index.ts"),
    "utf8",
  );

  it("accepts avatars/<owner>/my-photos/ — the immutable album prefix", () => {
    expect(/avatars\/\$\{ownerId\}\/my-photos\//.test(src)).toBe(true);
  });

  it("does NOT accept the whole avatars/<owner>/ folder", () => {
    /**
     * That folder also holds avatar.webp and cover.webp, which are overwritten
     * in place. A member could otherwise register their own mutable avatar as a
     * post photograph and post_media_for would serve bytes nobody published.
     */
    expect(
      /startsWith\(`avatars\/\$\{ownerId\}\/`\)/.test(src),
      "the prefix was widened to the whole avatars folder — mutable objects are now registrable",
    ).toBe(false);
  });

  it("refuses avatar/cover by name even inside an allowed prefix", () => {
    expect(/\(avatar\|cover\)/.test(src), "the mutable-name backstop is gone").toBe(true);
  });

  it("still refuses thumbnails and ladder rungs", () => {
    expect(/-thumb\\\.\[A-Za-z0-9\]\+\$/.test(src)).toBe(true);
    expect(/-r\(\?:600\|1080\|1440\)/.test(src)).toBe(true);
  });
});

describe("media_write_path_delta tells a floor from a leak", () => {
  const fn = lastDefinitionOf("media_write_path_delta");

  it("splits permanent from migratable", () => {
    expect(/'permanent_legacy_posts'/.test(fn)).toBe(true);
    expect(/'migratable_legacy_posts'/.test(fn)).toBe(true);
  });

  it("the growing-edge counter EXCLUDES the permanent floor", () => {
    /**
     * A profile-photo change is expected to land legacy-only. If it flipped
     * delta_growing, the alarm would fire on healthy behaviour, the threshold
     * would be raised, and the alarm would stop meaning anything.
     */
    expect(/'new_unexplained_legacy_posts'/.test(fn)).toBe(true);
    expect(
      /'delta_growing',\s*\(select count\(\*\) > 0 from recent_legacy where not has_mutable_media\)/.test(fn),
      "delta_growing no longer excludes mutable-media posts",
    ).toBe(true);
  });

  it("classifies by URL SHAPE, not by post_kind", () => {
    /**
     * The 14 oldest profile-update posts predate post_kind entirely, so keying
     * off the kind would misclassify every one of them as a regression.
     */
    expect(/has_mutable_media/.test(fn)).toBe(true);
    expect(/avatar\|cover/.test(fn)).toBe(true);
  });

  it("is still read-only and still grants nothing to a client", () => {
    expect(/\b(insert|update|delete)\s+(into|from)?\s*public\./i.test(fn)).toBe(false);
    const file = readFileSync(join(MIGRATIONS, "20260820130000_delta_attribution.sql"), "utf8");
    expect(/revoke all on function public\.media_write_path_delta/.test(file)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   RED-1 — THE DETACHED `supabase.rpc` METHOD
   ═══════════════════════════════════════════════════════════════════════════

   This module shipped with

       const rpc = supabase.rpc as unknown as <T>(…) => …;
       await rpc<string>("media_begin_upload", {…});

   on BOTH of its call sites. supabase-js declares `rpc` as a prototype method
   whose body is `return this.rest.rpc(...)`, so the copy ran with
   `this === undefined` and threw. `publishViaMedia` has no try/catch, so the
   throw propagated past the legacy fallback: the member got "Could not publish"
   and NO POST AT ALL. Production proof it never once succeeded: 0 of 252 posts
   carried an `idempotency_key`, which `post_publish_with_media` always sets.

   The identical defect had already broken draft publishing on 2026-08-17
   (`usePostDrafts.ts:89-108`). It came back three days later in a different
   file. So the guard here is deliberately three-layered:

     1. the mock can now REPRODUCE the failure (it is a class — see above);
     2. these tests prove detaching throws and the shipped form does not;
     3. the last test scans the WHOLE repository, so the next recurrence is
        caught wherever it lands, not only in this file.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The forbidden shapes. `(?!\s*\()` is what separates a DETACH from a CALL:
 * `const q = supabase.from("posts").select()` is fine — the method is invoked
 * immediately, with its receiver attached. Only a reference that is stored
 * without being called is dangerous.
 */
const DETACHING_ASSIGNMENT =
  /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=;]*)?=\s*supabase\s*\.\s*(?:rpc|from)\b(?!\s*\()/;
const DETACHING_DESTRUCTURE = /(?:const|let|var)\s*\{[^}]*\b(?:rpc|from)\b[^}]*\}\s*=\s*supabase\b/;
const DETACHING_PROPERTY = /\b(?:rpc|from)\s*:\s*supabase\s*\.\s*(?:rpc|from)\s*[,}]/;

describe("RED-1 — supabase.rpc must be called in call position", () => {
  it("the mock reproduces the production failure: detaching rpc throws", async () => {
    /**
     * ⚠ IF THIS TEST EVER PASSES TRIVIALLY, THE MOCK HAS BEEN WEAKENED.
     *
     * Under the old object-literal mock this expectation FAILED — the detached
     * copy resolved happily — which is precisely why the suite was green while
     * production was broken. The assertion is on the mock, not on the SUT, and
     * that is intentional: it is the test harness's own fidelity under test.
     */
    const detached = supabase.rpc;
    expect(() => (detached as (f: string, a: Record<string, unknown>) => unknown)("media_begin_upload", {}))
      .toThrowError(TypeError);
    expect(() => (detached as (f: string, a: Record<string, unknown>) => unknown)("media_begin_upload", {}))
      .toThrowError(/reading 'rest'|of undefined|undefined \(reading/);
  });

  it("a destructured rpc throws for the same reason", () => {
    const { rpc } = supabase;
    expect(() => (rpc as (f: string, a: Record<string, unknown>) => unknown)("post_publish_with_media", {}))
      .toThrowError(TypeError);
  });

  it("the in-call-position cast — the shipped form — does not throw", async () => {
    const out = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>)("media_begin_upload", {});
    expect(out.error).toBeNull();
    expect(typeof out.data).toBe("string");
  });

  it("an arrow wrapper is also safe — the member expression is re-resolved", async () => {
    const wrapped = (fn: string, args: Record<string, unknown>) =>
      (supabase.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { message: string } | null }>)(fn, args);
    const out = await wrapped("media_begin_upload", {});
    expect(out.error).toBeNull();
  });

  it("registerUploadedPhoto reaches the server rather than throwing", async () => {
    /**
     * The end-to-end proof. Before the fix this REJECTED with the TypeError
     * instead of resolving, and no `media_begin_upload` call was ever recorded.
     */
    await expect(registerUploadedPhoto(photo(1))).resolves.toBe("media-0");
    expect(rpcCalls.map((c) => c.fn)).toContain("media_begin_upload");
  });

  it("publishViaMedia reaches post_publish_with_media rather than throwing", async () => {
    await expect(publishViaMedia(input([photo(1)]))).resolves.toEqual({
      postId: "post-1",
      viaMedia: true,
      failure: null,
    });
    expect(rpcCalls.map((c) => c.fn)).toContain("post_publish_with_media");
  });

  it("publishViaMedia does not throw even when the server refuses", async () => {
    /**
     * A REFUSAL and a THROW are different failures with different blast radii.
     * A refusal must return {postId:null, viaMedia:false} so the caller can
     * decide; a throw escapes past the caller's fallback entirely. RED-1 turned
     * every refusal path in this module into the second kind.
     */
    rpcHandler = (c) =>
      c.fn === "media_begin_upload"
        ? { data: "media-0", error: null }
        : { data: null, error: { message: "refused" } };
    await expect(publishViaMedia(input([photo(1)]))).resolves.toEqual({
      postId: null,
      viaMedia: false,
      failure: "media-path-failed",
    });
    expect(warnings.map((w) => w.code)).toContain("MEDIA-4004");
  });

  it("NO source file anywhere in src/ stores supabase.rpc or supabase.from", () => {
    /**
     * ⚠ THE ONLY LAYER THAT COVERS FILES NOBODY THOUGHT TO TEST.
     *
     * This bug has now appeared twice, in two different modules, three days
     * apart. A per-file test would have caught neither occurrence in advance.
     * This walks every .ts/.tsx under src/ and fails on the assignment form.
     *
     * SAFE (not matched): `const rpc: T = (fn, a) => (supabase.rpc as T)(fn, a)`
     *   — the RHS begins with `(`, not with `supabase.`.
     * UNSAFE (matched):   `const rpc = supabase.rpc as unknown as …`
     *                     `const { rpc } = supabase`
     *                     `{ rpc: supabase.rpc }`
     */
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        // __tests__ is excluded ON PURPOSE and this is the only exclusion: the
        // tests immediately above DELIBERATELY detach `supabase.rpc` to prove
        // that doing so throws. Scanning them would make the guard fail on the
        // very evidence that it works.
        if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" ? [] : walk(full);
        return /\.tsx?$/.test(e.name) ? [full] : [];
      });

    const files = walk(join(ROOT, "src"));

    /**
     * ⚠ A SCAN THAT READS NOTHING PASSES EVERYTHING.
     *
     * This is the same failure mode as the Postgres `\b` regex in the
     * Workstream 1 audit: the query was well-formed, returned zero rows, and
     * read exactly like proof that nothing was wrong. If `walk` is ever broken
     * — a changed directory layout, an over-eager exclusion — the offenders
     * list is empty and this test goes green while guarding nothing.
     */
    expect(files.length, "the source walk found almost no files — the scan is vacuous").toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("postMediaWrite.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("usePostDrafts.ts"))).toBe(true);

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Strip block and line comments so the cautionary notes that QUOTE the
      // bad line (this file, postMediaWrite.ts, usePostDrafts.ts) do not trip it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      code.split("\n").forEach((line, i) => {
        if (
          DETACHING_ASSIGNMENT.test(line) ||
          DETACHING_DESTRUCTURE.test(line) ||
          DETACHING_PROPERTY.test(line)
        ) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}  ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      "supabase.rpc/from stored in a variable — it is a prototype method and " +
        "will throw with `this === undefined`. Call it in call position instead:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the static scan actually matches the historical bug line", () => {
    /**
     * A scan that matches nothing is indistinguishable from a scan that is
     * broken — the same class of mistake as the Postgres `\b` regex in the
     * Workstream 1 audit, which silently returned zero rows. So assert the
     * pattern against the exact line that shipped, and against the safe forms.
     */
    expect(DETACHING_ASSIGNMENT.test("  const rpc = supabase.rpc as unknown as <T>(")).toBe(true);
    expect(DETACHING_ASSIGNMENT.test("const rpc = supabase.rpc;")).toBe(true);
    expect(DETACHING_ASSIGNMENT.test("let from: UntypedFrom = supabase.from")).toBe(true);

    // A CALL is not a detach — these must NOT be flagged, or the guard becomes
    // noise and gets deleted.
    expect(DETACHING_ASSIGNMENT.test('const countsP = supabase.rpc("get_x" as any);')).toBe(false);
    expect(DETACHING_ASSIGNMENT.test('let q = supabase.from("competition_judges").select("id");')).toBe(false);

    expect(
      DETACHING_ASSIGNMENT.test(
        "const rpc: UntypedRpc = (fn, args) => (supabase.rpc as unknown as UntypedRpc)(fn, args);",
      ),
    ).toBe(false);
    expect(
      DETACHING_ASSIGNMENT.test("const from = (t: string) => (supabase.from as unknown as UntypedFrom)(t);"),
    ).toBe(false);
    expect(DETACHING_ASSIGNMENT.test("  const { data } = await (supabase.rpc as unknown as (")).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   PRIORITY 3 — THE LEGACY FALLBACK MUST NOT MASK A MEDIA-PATH FAILURE
   ═══════════════════════════════════════════════════════════════════════════

   @decision D-005

   Two things were being counted as one. A resumed draft has no original bytes,
   so its slides can never be declared and the post is legacy-only BY DESIGN —
   that is the permanent floor. A post whose photographs were all describable
   and still did not make it through is a LEAK.

   Under RED-1 the second kind looked exactly like the first for four days: the
   only signal either produced was a single MEDIA-4001, and MEDIA-4001 was
   already expected to be non-zero. A counter that cannot distinguish "correctly
   legacy" from "broken" reports a healthy floor while the tap runs.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("P3 — the two fallback conditions are separated", () => {
  it("an undescribable slide is classified unmigratable, not as a failure", async () => {
    const out = await publishViaMedia(input([photo(1, { stored: null })]));
    expect(out).toEqual({ postId: null, viaMedia: false, failure: "unmigratable-slides" });
  });

  it("an undescribable slide STILL emits MEDIA-4006 on the composer path", async () => {
    /**
     * ⚠ REGRESSION GUARD FOR THE FIX ITSELF. Moving the classification up front
     * short-circuited before the registrar ran, and MEDIA-4006 — the only code
     * for a refusal that leaves no server-side trace — silently stopped firing
     * on the path that matters most. One reporter, two callers.
     */
    await publishViaMedia(input([photo(1, { stored: null }), photo(2, { stored: null })]));
    expect(warnings.filter((w) => w.code === "MEDIA-4006")).toHaveLength(2);
  });

  it("an undescribable slide makes NO network call at all", async () => {
    /**
     * Classification happens from the INPUT, before anything is attempted.
     * Deciding it afterwards, from a refusal, is exactly the conflation this
     * separation removes — a server that is down would then be indistinguishable
     * from a resumed draft.
     */
    await publishViaMedia(input([photo(1, { stored: null })]));
    expect(rpcCalls).toHaveLength(0);
    expect(fnCalls).toHaveLength(0);
  });

  it("ONE undescribable slide out of three sends the whole post to unmigratable", async () => {
    const out = await publishViaMedia(input([photo(1), photo(2, { stored: null }), photo(3)]));
    expect(out.failure).toBe("unmigratable-slides");
    expect(rpcCalls).toHaveLength(0);
  });

  it("a describable post that the server refuses is classified as a FAILURE", async () => {
    rpcHandler = () => ({ data: null, error: { message: "too many uploads in flight (50)" } });
    const out = await publishViaMedia(input([photo(1)]));
    expect(out.failure).toBe("media-path-failed");
  });

  it("a describable post refused at PUBLISH is classified as a FAILURE", async () => {
    rpcHandler = (c) =>
      c.fn === "media_begin_upload"
        ? { data: "media-0", error: null }
        : { data: null, error: { message: "rate limit" } };
    const out = await publishViaMedia(input([photo(1)]));
    expect(out.failure).toBe("media-path-failed");
  });

  it("a quarantined object is a FAILURE, not an unmigratable slide", async () => {
    fnHandler = () => ({ data: { state: "quarantined" }, error: null });
    const out = await publishViaMedia(input([photo(1)]));
    expect(out.failure).toBe("media-path-failed");
  });

  it("MEDIA-4010 exists, is an ERROR, and is not confusable with the floor", () => {
    const catalog = readFileSync(join(ROOT, "src/lib/errorCodes.ts"), "utf8");
    expect(/code: "MEDIA-4010",\s*\n\s*severity: "error"/.test(catalog)).toBe(true);
    expect(/code: "MEDIA-4009",\s*\n\s*severity: "error"/.test(catalog)).toBe(true);
    const composer = readFileSync(join(ROOT, "src/components/WallPosts.tsx"), "utf8");
    // The composer must branch on the classification, not just count.
    expect(/viaMedia\.failure === "unmigratable-slides"/.test(composer)).toBe(true);
    expect(/if \(!unmigratable\) reportMediaPathFailure\(/.test(composer)).toBe(true);
  });

  it("MEDIA-4001 still counts BOTH kinds — the delta must stay complete", () => {
    /**
     * ⚠ The temptation after splitting the signal is to stop counting the
     * "expected" kind. That would make the legacy-only population in the logs
     * smaller than the one in the database, and the database is the one that is
     * right. Exactly ONE call site, unconditional inside the fallback branch.
     */
    const composer = readFileSync(join(ROOT, "src/components/WallPosts.tsx"), "utf8");
    const calls = composer.match(/reportLegacyOnlyPublish\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(/const unmigratable = viaMedia\.failure === "unmigratable-slides";\s*\n\s*if \(!unmigratable\) reportMediaPathFailure\(correlationId\);\s*\n\s*reportLegacyOnlyPublish\(/.test(composer)).toBe(true);
  });

  it("a THROW inside the media path becomes MEDIA-4009 and a null, never an exception", async () => {
    /**
     * RED-1's real cost was not that the media path failed — it is that it
     * THREW. The throw escaped the composer's fallback, so the member lost the
     * post entirely. This closes that boundary for every caller at once.
     */
    rpcHandler = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    };
    await expect(registerUploadedPhoto(photo(1))).resolves.toBeNull();
    const e = warnings.find((w) => w.code === "MEDIA-4009");
    expect(e, "a throw must be reported, not swallowed").toBeTruthy();
    expect(String(e!.reason)).toContain("rest");
  });

  it("publishViaMedia degrades rather than throwing when the path throws", async () => {
    rpcHandler = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    };
    await expect(publishViaMedia(input([photo(1)]))).resolves.toEqual({
      postId: null,
      viaMedia: false,
      failure: "media-path-failed",
    });
  });

  it("registerAllOrNone degrades rather than throwing — drafts and schedules too", async () => {
    rpcHandler = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    };
    await expect(registerAllOrNone([photo(1), photo(2)])).resolves.toBeNull();
  });

  it("the legacy insert is still SECOND, and still present", () => {
    const composer = readFileSync(join(ROOT, "src/components/WallPosts.tsx"), "utf8");
    const media = composer.indexOf("const viaMedia = await publishViaMedia(");
    const legacy = composer.indexOf('const legacy = await supabase.from("posts").insert(');
    expect(media).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(-1);
    expect(legacy, "the legacy insert must not be tried first").toBeGreaterThan(media);
  });
});
