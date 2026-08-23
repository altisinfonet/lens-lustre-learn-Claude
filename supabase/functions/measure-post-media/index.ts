/**
 * MEASURE-POST-MEDIA — READ-ONLY OBJECT MEASUREMENT FOR THE PHASE 2 MANIFEST.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR, AND WHY IT IS NOT THE BACKFILL.
 *
 * `media_objects` requires width, height, mime, bytes and sha256, all NOT NULL.
 * Cycle 2 proved every one of those is obtainable from the public object bytes,
 * but a SHA-256 needs the WHOLE file, and Postgres cannot fetch a URL. The
 * manifest therefore has to be produced by something that can make HTTP
 * requests. That is the only job this function has.
 *
 * It is deliberately NOT `backfill-media-objects` (which exists in this repo,
 * is undeployed, and WRITES). This one cannot write anything, anywhere.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SEVEN THINGS THAT MAKE IT SAFE. Each is a line of code, not a promise.
 *
 * 1. IT HOLDS NO STORAGE CREDENTIALS. Every object is read over ordinary
 *    public HTTPS from this lane's CDN host — the same bytes any visitor already
 *    gets. It never calls _shared/s3.ts, never reads s3_storage_settings, and
 *    therefore cannot reach a private bucket even by accident. This is the
 *    single strongest control here: there is no private-storage capability to
 *    misuse, so `readS3Object` and its signing key are simply absent.
 *
 * 2. IT ACCEPTS NO URL, KEY OR PATH FROM THE CALLER. The request body may
 *    contain two integers and nothing else. SSRF is impossible because there
 *    is no input that can become a request target.
 *
 * 3. THE POPULATION IS DERIVED, NOT SUPPLIED. Candidates come from
 *    `posts.image_urls` filtered by CANDIDATE_PATTERNS — three narrow shapes,
 *    the first byte-for-byte the pattern the Cycle 3 SQL proof used to
 *    establish the 207. Anything that fails all three is rejected, and the
 *    pattern is rejected, and the host is re-checked against cdnHostValue() after
 *    parsing, so a crafted row in the database could not redirect a fetch.
 *
 * 4. IT CANNOT WRITE. There is no .insert, .update, .upsert, .delete or .rpc
 *    call in this file. `src/__tests__/measurePostMediaReadOnly.test.ts` reads
 *    this source and fails the suite if one ever appears.
 *
 * 5. IT IS ADMIN-ONLY AND NOT ANONYMOUSLY CALLABLE. verify_jwt=true makes the
 *    gateway reject an unauthenticated request before this code runs; the code
 *    then independently checks user_roles for `admin`. Two gates, not one.
 *
 * 6. IT EXPIRES. After EXPIRES_AT it returns 410 and does nothing else, so it
 *    cannot quietly become a permanent media API if someone forgets to remove
 *    it. Removal is still the plan; this is what happens if the plan slips.
 *
 * 7. IT RETURNS NO IMAGE BYTES. Only status, length, content-type, width,
 *    height and a hex digest. No base64, no body, no passthrough.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT DOWNLOADS WHOLE FILES
 * A digest over a ranged read is the digest of a prefix, and most of these
 * files share a container header — different photographs would collapse onto
 * one hash. So the bytes are read whole and hashed whole. Dimensions come from
 * those same bytes; nothing is ever taken from a filename, and an ETag is
 * never treated as a hash.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { imageDimsFromBytes } from "./_shared/imageDims.ts";
import { cdnHost } from "../_shared/laneConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** The ONLY host this function will ever fetch from. Re-checked after parsing. */
// Lane-derived (G10), call-time. Allow-list, not display value.
const cdnHostValue = (): string => cdnHost();

/**
 * The verified migration population, character for character the pattern used
 * by the Cycle 3 SQL proof that established 207 candidates. If these two ever
 * drift, the manifest stops describing the population it claims to describe.
 */
/**
 * THE POPULATION, AS THREE NARROW PATTERNS.
 *
 * Class A is the original and is FROZEN — it must stay byte-for-byte the
 * pattern the Cycle 3 SQL proof used, and byte-for-byte
 * `media_migration_fence_digest`, or a measurement would stop describing the
 * population an approved manifest was approved against.
 *
 * Classes B and C were added 2026-08-20 (docs/CANDIDATE_PATTERN_AUDIT.md) for
 * 34 slides that are real photographs the CDN serves, owned by the member who
 * posted them. Proven over all 310 production slides: the three are DISJOINT
 * (0 matched more than one), all 34 carry the owner at path segment 2, and
 * none is a thumbnail, a rung or carries a query string.
 *
 * ⚠ CONTROL 3 IS UNCHANGED BY THIS. The population is still DERIVED from
 * `posts.image_urls` and still filtered by these patterns; the caller still
 * supplies nothing that can become a request target, and the host is still
 * re-checked against cdnHostValue() after parsing.
 *
 * ⚠ WHAT MUST STAY OUT: `avatars/<uuid>/avatar.webp?t=…` (MUTABLE — overwritten
 * on every profile-photo change, so a hash taken now describes bytes that may
 * already be gone) and `avatars/covers/<uuid>/…` (the owner is at segment 3).
 * Class C reaches neither: it requires `/my-photos/<uuid>/`, and `covers` is
 * not a uuid.
 */
const CANDIDATE_PATTERNS: readonly RegExp[] = [
  /^https:\/\/cdn\.50mmretina\.com\/post-images\/[0-9a-f-]{36}\/posts\/[^/?]+$/,
  /^https:\/\/cdn\.50mmretina\.com\/post-images\/[0-9a-f-]{36}\/[^/?]+$/,
  /^https:\/\/cdn\.50mmretina\.com\/avatars\/[0-9a-f-]{36}\/my-photos\/[0-9a-f-]{36}\/[^/?]+$/,
];

const CANDIDATE_RE = {
  test: (u: string) => CANDIDATE_PATTERNS.some((re) => re.test(u)),
};

/** Control 6: a hard end date. Past it this function is inert. */
const EXPIRES_AT = Date.parse("2026-09-01T00:00:00Z");

/** Control: hard caps. A caller cannot ask for more than this, ever. */
const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 25;
const HARD_MAX_CANDIDATES = 500;
/** Control: wall-clock budget. Returns what it has rather than being killed. */
const TIME_BUDGET_MS = 50_000;
/** Refuse a body larger than any legitimate photograph on this platform. */
const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Magic bytes, never the file extension. */
function sniffMime(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 12 && s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "image/webp";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
  if (b.length >= 12 && s(4, 4) === "ftyp" && (s(8, 4) === "avif" || s(8, 4) === "avis")) {
    return "image/avif";
  }
  return null;
}

interface Candidate {
  post_id: string;
  owner_id: string;
  ord: number;
  url: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();

  // ── Control 6 — expiry, checked before anything else happens ──────────────
  if (Date.now() > EXPIRES_AT) {
    return json({
      error: "Gone",
      detail: "measure-post-media expired by design on 2026-09-01. Redeploy deliberately or delete it.",
    }, 410);
  }

  try {
    // ── Control 5 — authentication, then authorisation ──────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);

    // Service role is used for exactly two reads: the role check, and the
    // posts scan. It is never used to write, and never handed a caller value.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin access required" }, 403);

    // ── Control 2 — the body may contain two integers. Nothing else is read.
    let offset = 0;
    let limit = DEFAULT_LIMIT;
    try {
      const body = await req.json();
      if (Number.isInteger(body?.offset) && body.offset >= 0) offset = body.offset;
      if (Number.isInteger(body?.limit) && body.limit > 0) limit = Math.min(body.limit, HARD_LIMIT);
    } catch (_) {
      // empty body — defaults
    }

    // ── Control 3 — derive the population; never accept one ─────────────────
    const candidates: Candidate[] = [];
    {
      const PAGE = 500;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("posts").select("id, user_id, image_urls, privacy")
          .order("id").range(from, from + PAGE - 1);
        if (error) throw new Error(`post scan failed at offset ${from}: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const row of data as {
          id: string; user_id: string; image_urls: string[] | null; privacy: string;
        }[]) {
          // Public posts only. This function has no business reading the bytes
          // of anything a logged-out visitor could not already open.
          if (row.privacy !== "public") continue;
          const urls = row.image_urls ?? [];
          for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            if (typeof url !== "string" || !CANDIDATE_RE.test(url)) continue;
            candidates.push({ post_id: row.id, owner_id: row.user_id, ord: i + 1, url });
          }
        }
        if (data.length < PAGE) break;
        if (candidates.length > HARD_MAX_CANDIDATES) {
          throw new Error(
            `candidate count exceeded HARD_MAX_CANDIDATES (${HARD_MAX_CANDIDATES}) — refusing to continue`,
          );
        }
      }
    }
    // Deterministic order, so offset/limit mean the same thing on every call.
    candidates.sort((a, b) => (a.post_id === b.post_id ? a.ord - b.ord : (a.post_id < b.post_id ? -1 : 1)));

    const slice = candidates.slice(offset, offset + limit);
    const results: unknown[] = [];
    let bytesRead = 0;
    let timedOut = false;

    for (const c of slice) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { timedOut = true; break; }

      // Control 3, second gate: re-check the HOST after parsing, so a crafted
      // row that somehow satisfied the regex still cannot redirect the fetch.
      let host = "";
      try { host = new URL(c.url).host; } catch { /* falls through to reject */ }
      if (host !== cdnHostValue()) {
        results.push({ post_id: c.post_id, ord: c.ord, url: c.url, ok: false, reason: "host-not-permitted" });
        continue;
      }

      try {
        // `redirect: "error"` — a redirect is a request target this function
        // did not choose, which is exactly what control 2 exists to prevent.
        const res = await fetch(c.url, { redirect: "error" });
        const contentType = res.headers.get("content-type");
        const contentLength = res.headers.get("content-length");
        const etag = res.headers.get("etag");
        const lastModified = res.headers.get("last-modified");

        if (!res.ok) {
          results.push({
            post_id: c.post_id, owner_id: c.owner_id, ord: c.ord, url: c.url,
            ok: false, status: res.status, reason: "http-not-ok",
          });
          continue;
        }
        if (contentLength && Number(contentLength) > MAX_OBJECT_BYTES) {
          results.push({
            post_id: c.post_id, owner_id: c.owner_id, ord: c.ord, url: c.url,
            ok: false, status: res.status, reason: "object-too-large", content_length: Number(contentLength),
          });
          continue;
        }

        const buf = new Uint8Array(await res.arrayBuffer());
        bytesRead += buf.byteLength;

        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
        const dims = imageDimsFromBytes(buf);
        const mime = sniffMime(buf);

        results.push({
          post_id: c.post_id,
          owner_id: c.owner_id,
          ord: c.ord,
          url: c.url,
          ok: true,
          status: res.status,
          content_length: contentLength ? Number(contentLength) : null,
          content_type: contentType,
          etag,
          last_modified: lastModified,
          bytes: buf.byteLength,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          mime,                       // from bytes
          sha256: toHex(digest),      // Control 7: a digest, never the body
        });
      } catch (e) {
        results.push({
          post_id: c.post_id, owner_id: c.owner_id, ord: c.ord, url: c.url,
          ok: false, reason: `fetch-failed: ${String(e).slice(0, 200)}`,
        });
      }
    }

    return json({
      read_only: true,
      expires_at: new Date(EXPIRES_AT).toISOString(),
      total_candidates: candidates.length,
      offset,
      limit,
      returned: results.length,
      timed_out: timedOut,
      bytes_read: bytesRead,
      duration_ms: Date.now() - startedAt,
      results,
    });
  } catch (e) {
    return json({ error: String(e).slice(0, 500) }, 500);
  }
});
