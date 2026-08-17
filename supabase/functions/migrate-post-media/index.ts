/**
 * MANIFEST-DRIVEN MEDIA MIGRATION.
 *
 * ⚠ NOT DEPLOYED. Built and proven in Control Cycle 6; deployment is a separate
 *   approved decision. `supabase/config.toml` deliberately has no entry for it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REPLACES `backfill-media-objects`, WHICH IS ABANDONED.
 *
 * The old one derived its own population from a live `posts` scan. Measured in
 * Cycle 5A, that scan would have migrated 255 slides where the approved
 * manifest holds 207 — 28 of them members' AVATARS. It also had no transaction,
 * no fence, and a `pending` state that poisoned a post permanently.
 *
 * None of those are fixed here. They are made IMPOSSIBLE, which is a different
 * thing: there is no scan to go wrong. The manifest is the work list, the
 * database is the transaction, and every stage below can only refuse.
 *
 *   MANIFEST → INTEGRITY → FENCE → BOUNDED → PER-ITEM VERIFY → COMMIT → RECONCILE
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT CANNOT DO
 *   • it cannot choose its own population — no posts scan exists in this file
 *   • it cannot write outside a transaction — every write is one RPC per post
 *   • it cannot fetch a caller-named URL — the URL comes from the manifest and
 *     the manifest is refused unless it hashes to the approved value
 *   • it cannot touch posts.image_urls, storage, or the CDN
 *   • it cannot be called by anyone but an admin
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  assertFence, assertManifestIntegrity, groupByPost, keySetText,
  parseManifest, reconcile, verifyMeasured, CDN_HOST,
  type ManifestRow, type Measured, type Refusal,
} from "../_shared/manifestPlan.ts";
import { imageDimsFromBytes } from "../_shared/imageDims.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/** Hard ceilings. A caller cannot raise them. */
const HARD_MAX_POSTS = 25;
const DEFAULT_MAX_POSTS = 5;
const TIME_BUDGET_MS = 110_000;
const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (d: BufferSource) => hex(await crypto.subtle.digest("SHA-256", d));

/** MIME from magic bytes. Never from the extension — that was the old bug. */
function sniffMime(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 12 && s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "image/webp";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
  if (b.length >= 12 && s(4, 4) === "ftyp" && (s(8, 4) === "avif" || s(8, 4) === "avis")) return "image/avif";
  return null;
}

/** Read one approved object over public HTTPS and measure it from its bytes. */
async function measure(row: ManifestRow): Promise<Measured | Refusal> {
  let host = "";
  try { host = new URL(row.source_url).host; } catch { /* refuse below */ }
  if (host !== CDN_HOST) return { code: "MIG-1080", detail: `${row.source_url}: host is not ${CDN_HOST}` };
  try {
    const res = await fetch(row.source_url, { redirect: "error" });
    if (!res.ok) return { code: "MIG-1081", detail: `${row.object_path}: HTTP ${res.status}` };
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_OBJECT_BYTES) {
      return { code: "MIG-1082", detail: `${row.object_path}: ${cl} bytes exceeds the cap` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const d = imageDimsFromBytes(buf);
    return {
      status: res.status, bytes: buf.byteLength,
      width: d?.width ?? -1, height: d?.height ?? -1,
      mime: sniffMime(buf) ?? "", sha256: await sha256Hex(buf),
    };
  } catch (e) {
    return { code: "MIG-1083", detail: `${row.object_path}: fetch failed: ${String(e).slice(0, 160)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(URL_, SR);
    const { data: role } = await admin.from("user_roles").select("role")
      .eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const manifestText: string = typeof body?.manifest === "string" ? body.manifest : "";
    const approvedHash: string = typeof body?.approved_hash === "string" ? body.approved_hash : "";
    const fence: string = typeof body?.fence === "string" ? body.fence : "";
    const dryRun: boolean = body?.dry_run !== false;                       // dry by default
    const maxPosts = Number.isInteger(body?.max_posts)
      ? Math.min(Math.max(1, body.max_posts), HARD_MAX_POSTS) : DEFAULT_MAX_POSTS;
    const offset = Number.isInteger(body?.offset) && body.offset >= 0 ? body.offset : 0;

    if (!manifestText) return json({ error: "MIG-1000", detail: "manifest is required" }, 400);
    if (!fence) return json({ error: "MIG-1005", detail: "fence timestamp is required" }, 400);

    // ── 1. INTEGRITY ──────────────────────────────────────────────────────
    const actualHash = await sha256Hex(new TextEncoder().encode(manifestText));
    const bad = assertManifestIntegrity(actualHash, approvedHash);
    if (bad) return json({ refused: bad, manifest_sha256: actualHash }, 409);

    // ── 2. PARSE ──────────────────────────────────────────────────────────
    const { rows, refusal: parseRefusal } = parseManifest(manifestText);
    if (parseRefusal) return json({ refused: parseRefusal }, 409);

    // ── 3. FENCE — a SET comparison, computed in the database ─────────────
    const { data: fenceRows, error: fenceErr } =
      await admin.rpc("media_migration_fence_digest", { _fence: fence });
    if (fenceErr) return json({ error: "MIG-1042", detail: fenceErr.message }, 500);
    const live = Array.isArray(fenceRows) ? fenceRows[0] : fenceRows;
    const manifestDigest = await md5Hex(keySetText(rows));
    const fenceBad = assertFence(rows, live?.key_set_md5 ?? "", manifestDigest, live?.item_count ?? -1);
    if (fenceBad) {
      return json({ refused: fenceBad, live_fence: live, manifest_items: rows.length }, 409);
    }

    // ── 4. BOUNDED ────────────────────────────────────────────────────────
    const byPost = groupByPost(rows);
    const postIds = [...byPost.keys()].sort();
    const slice = postIds.slice(offset, offset + maxPosts);

    const { data: doneRows, error: doneErr } =
      await admin.from("post_media").select("post_id").in("post_id", slice);
    if (doneErr) return json({ error: "MIG-1043", detail: doneErr.message }, 500);
    const done = new Set((doneRows ?? []).map((r: { post_id: string }) => r.post_id));

    const results: unknown[] = [];
    let migrated = 0, skipped = 0, refused = 0, bytesRead = 0;

    for (const postId of slice) {
      if (Date.now() - t0 > TIME_BUDGET_MS) { results.push({ post_id: postId, result: "deferred-time-budget" }); break; }
      const group = byPost.get(postId)!;
      if (done.has(postId)) { skipped++; results.push({ post_id: postId, result: "skipped", reason: "already has references" }); continue; }

      // ── 5. PER-ITEM VERIFICATION, against the manifest ──────────────────
      const items: Record<string, unknown>[] = [];
      let postRefusal: Refusal | null = null;
      for (const row of group) {
        const m = await measure(row);
        if ("code" in m) { postRefusal = m; break; }
        bytesRead += m.bytes;
        const v = verifyMeasured(row, m);
        if (v) { postRefusal = v; break; }
        items.push({
          ord: row.ord, sha256: row.sha256, width: row.width, height: row.height,
          bytes: row.bytes, mime: row.mime, visibility: row.visibility, object_path: row.object_path,
        });
      }
      if (postRefusal) { refused++; results.push({ post_id: postId, result: "refused", refusal: postRefusal }); continue; }

      if (dryRun) { results.push({ post_id: postId, result: "would-migrate", slides: items.length }); continue; }

      // ── 6. COMMIT — one post, one transaction, inside the database ──────
      const { data: out, error: rpcErr } =
        await admin.rpc("media_migrate_post", { _post_id: postId, _owner_id: group[0].owner_id, _items: items });
      if (rpcErr) { refused++; results.push({ post_id: postId, result: "failed", error: rpcErr.message }); continue; }
      migrated++;
      results.push({ post_id: postId, result: "committed", detail: out });
    }

    // ── 7. RECONCILE ──────────────────────────────────────────────────────
    const { data: rec } = await admin.rpc("media_migration_reconcile");
    const finished = offset + slice.length >= postIds.length;
    const recCheck = (!dryRun && finished && rec)
      ? reconcile(rows, {
          postMediaCount: rec.post_media_rows, mediaObjectCount: rec.media_objects_rows,
          unreferencedMediaCount: rec.unreferenced_media, nonReadyMediaCount: rec.non_ready_media,
        })
      : null;

    return json({
      dry_run: dryRun,
      production_writes: dryRun ? 0 : migrated,
      manifest_sha256: actualHash,
      fence, fence_live: live,
      manifest_items: rows.length, manifest_posts: postIds.length,
      offset, max_posts: maxPosts, finished,
      migrated, skipped, refused, bytes_read: bytesRead,
      duration_ms: Date.now() - t0,
      reconciliation: rec ?? null,
      reconciliation_check: recCheck,
      results,
    });
  } catch (e) {
    console.error("migrate-post-media:", e);
    return json({ error: "MIG-1099", detail: String(e).slice(0, 400) }, 500);
  }
});

/** md5 of a string, to match `media_migration_fence_digest`'s md5 in SQL. */
async function md5Hex(s: string): Promise<string> {
  // Deno's SubtleCrypto has no MD5; the digest is a change-detector between two
  // sets we both hold, not a security primitive, so a small local
  // implementation is honest here. Content identity remains SHA-256.
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(s, "utf8").digest("hex");
}
