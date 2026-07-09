/**
 * Fix Cache-Control Headers — admin-only batch processor.
 *
 * Supabase Storage's public endpoint serves the cacheControl that was set
 * at UPLOAD time. Updating storage.objects.metadata after the fact does NOT
 * change the response header. The only fix is to re-upload (with upsert)
 * passing the correct cacheControl option.
 *
 * Strategy per file:
 *   1. Download bytes via service-role client.
 *   2. Re-upload to the same path with upsert + cacheControl: '31536000'.
 *   3. Track success/failure per bucket.
 *
 * Body: { buckets?: string[], limit?: number, prefix?: string }
 *   - buckets: defaults to all 4 image buckets
 *   - limit:   max files PER bucket per invocation (default 100, max 500)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_BUCKETS = ["post-images", "portfolio-images", "site-assets", "competition-photos"];
const TARGET_CACHE = "31536000"; // 1 year

type FileEntry = { bucket: string; path: string };

async function listAllFiles(supabase: any, bucket: string, prefix = "", limit = 1000): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [prefix];
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    const { data, error } = await supabase.storage.from(bucket).list(dir, { limit: 1000, offset: 0 });
    if (error) { console.warn(`list ${bucket}/${dir} → ${error.message}`); continue; }
    for (const item of data || []) {
      const full = dir ? `${dir}/${item.name}` : item.name;
      // Folders have id === null in Supabase's list response
      if (item.id === null) stack.push(full);
      else out.push(full);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Check whether a file's currently-served Cache-Control already meets target. */
async function isAlreadyFixed(bucket: string, path: string): Promise<boolean> {
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
    const res = await fetch(url, { method: "HEAD" });
    const cc = res.headers.get("cache-control") || "";
    return cc.includes("max-age=31536000");
  } catch { return false; }
}

async function reuploadFile(supabase: any, bucket: string, path: string): Promise<void> {
  // Download
  const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path);
  if (dlErr) throw new Error(`download: ${dlErr.message}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Detect content-type from extension (preserve existing)
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const ctMap: Record<string, string> = {
    webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
  };
  const contentType = ctMap[ext] || blob.type || "application/octet-stream";
  // Re-upload with upsert + correct cacheControl
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType, upsert: true, cacheControl: TARGET_CACHE,
  });
  if (upErr) throw new Error(`upload: ${upErr.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: u, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !u?.user) return new Response(JSON.stringify({ error: "unauth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" as any });
    if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const buckets: string[] = Array.isArray(body.buckets) && body.buckets.length ? body.buckets : DEFAULT_BUCKETS;
    const limit: number = Math.min(Number(body.limit) || 100, 500);
    const prefix: string = typeof body.prefix === "string" ? body.prefix : "";

    const results: Record<string, { listed: number; skipped: number; fixed: number; failed: number; errors: string[] }> = {};

    for (const bucket of buckets) {
      const stats = { listed: 0, skipped: 0, fixed: 0, failed: 0, errors: [] as string[] };
      try {
        const paths = await listAllFiles(supabase, bucket, prefix, limit);
        stats.listed = paths.length;
        for (const path of paths) {
          if (await isAlreadyFixed(bucket, path)) { stats.skipped++; continue; }
          try {
            await reuploadFile(supabase, bucket, path);
            stats.fixed++;
          } catch (e: any) {
            stats.failed++;
            if (stats.errors.length < 5) stats.errors.push(`${path}: ${e?.message || e}`);
          }
        }
      } catch (e: any) {
        stats.errors.push(`bucket-level: ${e?.message || e}`);
      }
      results[bucket] = stats;
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("fix-cache-headers fatal", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
