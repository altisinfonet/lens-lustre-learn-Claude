/**
 * Backfill Thumbnails — admin-triggered batch processor.
 *
 * For each legacy row missing a thumbnail:
 *  1. Resolve the storage key (Supabase /storage/v1/object/public/{bucket}/{key}
 *     OR R2 URL like pub-XYZ.r2.dev/{bucket}/{key}).
 *  2. Try Supabase's render endpoint for a 600px WebP. If the object lives in
 *     Supabase Storage already, this returns a properly-resized thumbnail.
 *  3. If the object is external (R2) OR render fails, fall back to fetching the
 *     original bytes and uploading them as `{key}-thumb.webp` so the row at
 *     least has a thumbnail URL pointing into Supabase Storage.
 *  4. Update the row's thumbnail column.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type TableSpec = {
  table: string;
  bucket: string;       // Destination bucket where thumbnail is uploaded
  imageCol: string;
  thumbCol: string;
  isArray: boolean;
};

// Real bucket names verified from storage.buckets.
const TABLES: Record<string, TableSpec> = {
  hero_banners:        { table: "hero_banners",        bucket: "site-assets",        imageCol: "image_url",  thumbCol: "thumbnail_url",   isArray: false },
  photo_of_the_day:    { table: "photo_of_the_day",    bucket: "portfolio-images",   imageCol: "image_url",  thumbCol: "thumbnail_url",   isArray: false },
  featured_photos:     { table: "featured_photos",     bucket: "portfolio-images",   imageCol: "image_url",  thumbCol: "thumbnail_url",   isArray: false },
  posts:               { table: "posts",               bucket: "post-images",        imageCol: "image_urls", thumbCol: "thumbnail_urls",  isArray: true  },
  competition_entries: { table: "competition_entries", bucket: "competition-photos", imageCol: "photos",     thumbCol: "photo_thumbnails", isArray: true  },
};

/**
 * Parse any known URL into { bucket, key }. Returns null on unrecognized formats.
 *
 * Supabase: https://*.supabase.co/storage/v1/object/public/{bucket}/{key...}
 * External (R2 / custom CDN domain, e.g. cdn.50mmretina.com): /{bucket}/{key...}
 *
 * BUG-029: the old parser only knew Supabase hosts and *.r2.dev, so production
 * URLs on the custom CDN domain parsed to null and rows got full-size originals
 * re-uploaded as "-thumb.webp". Now ANY host whose first path segment is a real
 * storage bucket (validated against `knownBuckets`) is treated as an external
 * source — config-free, and robust to future CDN domain changes.
 */
function parseUrl(
  url: string,
  knownBuckets: Set<string>,
): { bucket: string; key: string; source: "supabase" | "external" } | null {
  try {
    const u = new URL(url);
    // Supabase Storage public URL
    const sbMatch = u.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (sbMatch) return { bucket: sbMatch[1], key: decodeURIComponent(sbMatch[2]), source: "supabase" };

    // External host (R2 public domain or custom CDN) — pathname is /{bucket}/{key...}
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length >= 2 && (knownBuckets.has(parts[0]) || u.hostname.endsWith(".r2.dev"))) {
      return { bucket: parts[0], key: decodeURIComponent(parts.slice(1).join("/")), source: "external" };
    }
  } catch { /* fallthrough */ }
  return null;
}

/** Build Supabase render URL for a 600px thumbnail of an existing storage object. */
function renderUrl(bucket: string, key: string): string {
  const params = new URLSearchParams({
    width: "600", height: "600", resize: "contain", quality: "70", format: "origin",
  });
  return `${SUPABASE_URL}/storage/v1/render/image/public/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}?${params}`;
}

const RENDER_PARAMS = new URLSearchParams({
  width: "600", height: "600", resize: "contain", quality: "70", format: "webp",
});

/** Call the Supabase render endpoint for an object already in storage. */
async function renderStorageObject(bucket: string, key: string): Promise<Uint8Array> {
  const url = `${SUPABASE_URL}/storage/v1/render/image/public/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}?${RENDER_PARAMS}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!res.ok) throw new Error(`render ${bucket}/${key} → ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * BUG-029: produce a REAL 600px WebP thumbnail for any source.
 *  - Supabase-hosted objects: render endpoint directly.
 *  - External sources (CDN/R2): fetch original bytes, stage them at a temp key
 *    in the destination bucket, render THAT object, then delete the temp key.
 * On any failure this THROWS — the row is reported failed instead of silently
 * receiving a full-size original mislabeled as a thumbnail (the old behavior).
 */
async function fetchThumbnail(
  supabase: any,
  destBucket: string,
  originalUrl: string,
  parsed: ReturnType<typeof parseUrl>,
): Promise<{ data: Uint8Array; contentType: string }> {
  if (!parsed) throw new Error(`unrecognized image URL shape: ${originalUrl}`);

  if (parsed.source === "supabase") {
    return { data: await renderStorageObject(parsed.bucket, parsed.key), contentType: "image/webp" };
  }

  // External: stage → render → cleanup.
  const res = await fetch(originalUrl);
  if (!res.ok) throw new Error(`fetch ${originalUrl} → ${res.status}`);
  const original = new Uint8Array(await res.arrayBuffer());
  const tmpKey = `__thumb_tmp/${crypto.randomUUID()}`;
  const { error: tmpErr } = await supabase.storage.from(destBucket).upload(tmpKey, original, {
    contentType: res.headers.get("content-type") || "application/octet-stream",
    upsert: true,
  });
  if (tmpErr) throw new Error(`temp upload failed: ${tmpErr.message}`);
  try {
    const data = await renderStorageObject(destBucket, tmpKey);
    return { data, contentType: "image/webp" };
  } finally {
    try { await supabase.storage.from(destBucket).remove([tmpKey]); } catch { /* best-effort cleanup */ }
  }
}

/** HEAD a thumbnail URL to determine actual content-type. Returns null on error. */
async function getContentType(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    return res.headers.get("content-type");
  } catch { return null; }
}

/**
 * Compute thumbnail destination path inside the configured destination bucket.
 * Preserves the original key path when known so files stay grouped.
 */
function thumbPathFor(originalUrl: string, parsed: ReturnType<typeof parseUrl>): string {
  let key: string;
  if (parsed) {
    key = parsed.key;
  } else {
    // Last-resort: use filename only
    key = originalUrl.split("/").pop() || `legacy-${Date.now()}.bin`;
  }
  const dot = key.lastIndexOf(".");
  const base = dot > 0 ? key.slice(0, dot) : key;
  return `${base}-thumb.webp`;
}

async function processRow(
  supabase: any,
  spec: TableSpec,
  row: any,
  force: boolean,
  forceResize: boolean,
  knownBuckets: Set<string>,
): Promise<{ ok: boolean; error?: string; reencoded?: number }> {
  try {
    const handleOne = async (url: string): Promise<string> => {
      const parsed = parseUrl(url, knownBuckets);
      const { data } = await fetchThumbnail(supabase, spec.bucket, url, parsed);
      const path = thumbPathFor(url, parsed);
      const { error: upErr } = await supabase.storage.from(spec.bucket).upload(path, data, {
        contentType: "image/webp", upsert: true, cacheControl: "31536000",
      });
      if (upErr && !String(upErr.message).includes("already exists")) throw upErr;
      const { data: pub } = supabase.storage.from(spec.bucket).getPublicUrl(path);
      return pub.publicUrl;
    };

    if (spec.isArray) {
      const sourceUrls: string[] = row[spec.imageCol] || [];
      if (sourceUrls.length === 0) return { ok: false, error: "no source urls" };
      const existingThumbs: string[] = row[spec.thumbCol] || [];

      // force (content-type repair): only re-encode entries whose existing thumb
      // is NOT image/webp. NOTE: fake thumbs produced by the old bug were
      // UPLOADED with contentType image/webp, so this mode cannot see them —
      // use force_resize to regenerate every thumbnail from source.
      if (force && !forceResize && existingThumbs.length === sourceUrls.length) {
        let reencoded = 0;
        const newThumbs: string[] = [];
        for (let i = 0; i < sourceUrls.length; i++) {
          const ct = await getContentType(existingThumbs[i]);
          if (ct && ct.includes("webp")) {
            newThumbs.push(existingThumbs[i]);
          } else {
            newThumbs.push(await handleOne(sourceUrls[i]));
            reencoded++;
          }
        }
        if (reencoded === 0) return { ok: true, reencoded: 0 };
        const { error } = await supabase.from(spec.table).update({ [spec.thumbCol]: newThumbs }).eq("id", row.id);
        if (error) throw error;
        return { ok: true, reencoded };
      }

      const thumbs: string[] = [];
      for (const url of sourceUrls) thumbs.push(await handleOne(url));
      const { error } = await supabase.from(spec.table).update({ [spec.thumbCol]: thumbs }).eq("id", row.id);
      if (error) throw error;
      return { ok: true, reencoded: thumbs.length };
    } else {
      const url: string = row[spec.imageCol];
      if (!url) return { ok: false, error: "no source url" };

      if (force && !forceResize && row[spec.thumbCol]) {
        const ct = await getContentType(row[spec.thumbCol]);
        if (ct && ct.includes("webp")) return { ok: true, reencoded: 0 };
      }

      const thumb = await handleOne(url);
      const { error } = await supabase.from(spec.table).update({ [spec.thumbCol]: thumb }).eq("id", row.id);
      if (error) throw error;
    }
    return { ok: true, reencoded: 1 };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: u, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !u?.user) {
      return new Response(JSON.stringify({ error: "unauth", detail: uErr?.message }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: isAdmin, error: rErr } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" as any });
    if (rErr) {
      const { data: rows } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
      if (!rows) {
        return new Response(JSON.stringify({ error: "forbidden", detail: rErr?.message }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden", user: u.user.id }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const target: string = body.target || "all";
    const limit: number = Math.min(body.limit || 25, 100);
    // offset + stable id ordering let large repairs run in chunks without
    // re-processing the same rows (per-call compute limits are real).
    const offset: number = Math.max(Number(body.offset) || 0, 0);
    // force: re-encode only thumbs whose content-type isn't webp (legacy repair).
    // force_resize (BUG-029): regenerate EVERY thumbnail from source via a real
    // resize — required to repair fake thumbs that were mislabeled image/webp.
    const forceResize: boolean = body.force_resize === true;
    const force: boolean = body.force === true || forceResize;

    // BUG-029: known bucket names let parseUrl recognize custom CDN hosts
    // (path = /{bucket}/{key...}) without any hardcoded domain.
    const { data: bucketRows, error: bErr } = await supabase.storage.listBuckets();
    if (bErr) throw new Error(`listBuckets failed: ${bErr.message}`);
    const knownBuckets = new Set<string>((bucketRows ?? []).map((b: any) => b.name));

    const targets = target === "all" ? Object.keys(TABLES) : [target];
    const results: Record<string, any> = {};

    for (const t of targets) {
      const spec = TABLES[t];
      if (!spec) { results[t] = { error: "unknown target" }; continue; }
      // In force mode, scan rows that DO have thumbnails (to re-check content-type)
      const query = supabase.from(spec.table).select("*")
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      const { data: rows, error } = await (force
        ? query.not(spec.thumbCol, "is", null)
        : query.is(spec.thumbCol, null));
      if (error) { results[t] = { error: error.message }; continue; }

      const stats = { processed: 0, succeeded: 0, failed: 0, reencoded: 0, skipped: 0, errors: [] as string[] };
      for (const row of rows || []) {
        stats.processed++;
        const r = await processRow(supabase, spec, row, force, forceResize, knownBuckets);
        if (r.ok) {
          stats.succeeded++;
          if (force) {
            if ((r.reencoded || 0) > 0) stats.reencoded += r.reencoded || 0;
            else stats.skipped++;
          }
        } else { stats.failed++; if (stats.errors.length < 5) stats.errors.push(`${row.id}: ${r.error}`); }
      }
      results[t] = stats;
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("backfill-thumbnails fatal", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
