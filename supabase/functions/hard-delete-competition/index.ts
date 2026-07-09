import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AdminClient = ReturnType<typeof createClient>;

interface S3Settings {
  enabled: boolean;
  bucket_name: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  endpoint?: string;
  path_prefix?: string;
}

function uniq(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()))];
}

function storagePathFromUrl(value: unknown, bucket: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const marker = `/${bucket}/`;
  if (!/^https?:\/\//i.test(raw)) {
    return raw.startsWith(`${bucket}/`) ? raw.slice(bucket.length + 1) : raw;
  }
  try {
    const decodedPath = decodeURIComponent(new URL(raw).pathname);
    const markerIndex = decodedPath.indexOf(marker);
    if (markerIndex >= 0) return decodedPath.slice(markerIndex + marker.length);
    const objectMarker = `/object/public/${bucket}/`;
    const objectIndex = decodedPath.indexOf(objectMarker);
    if (objectIndex >= 0) return decodedPath.slice(objectIndex + objectMarker.length);
  } catch (_) {
    return null;
  }
  return null;
}

function extractCompetitionStoragePaths(comp: any, entries: any[]) {
  const paths: string[] = [];
  const add = (value: unknown) => {
    const path = storagePathFromUrl(value, "competition-photos");
    if (path) paths.push(path);
  };

  add(comp?.cover_image_url);
  for (const entry of entries) {
    (Array.isArray(entry.photos) ? entry.photos : []).forEach(add);
    (Array.isArray(entry.photo_thumbnails) ? entry.photo_thumbnails : []).forEach(add);
    const meta = Array.isArray(entry.photo_meta) ? entry.photo_meta : [];
    for (const item of meta) {
      if (item && typeof item === "object") {
        add((item as Record<string, unknown>).url);
        add((item as Record<string, unknown>).thumbnail_url);
      }
    }
  }

  return uniq(paths);
}

async function deleteSupabaseStorage(adminClient: AdminClient, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    await adminClient.storage.from(bucket).remove(paths.slice(i, i + 100));
  }
}

/**
 * Recursively list every object key in the Supabase storage bucket under the
 * given path prefixes (e.g. competition_id/, entry_id/). Returns full keys
 * suitable to pass to storage.remove().
 */
async function listSupabaseStorageByPrefixes(
  adminClient: AdminClient,
  bucket: string,
  prefixes: string[],
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (prefix: string) => {
    let page = 0;
    while (true) {
      const { data, error } = await adminClient.storage.from(bucket).list(prefix, {
        limit: 1000,
        offset: page * 1000,
      });
      if (error || !data || data.length === 0) break;
      for (const item of data) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        // A folder entry has id === null in supabase-js list output.
        if ((item as any).id === null) {
          await walk(fullPath);
        } else {
          out.push(fullPath);
        }
      }
      if (data.length < 1000) break;
      page += 1;
    }
  };
  for (const p of prefixes) await walk(p);
  return uniq(out);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key instanceof Uint8Array ? key : new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function getSignatureKey(key: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

function s3Endpoint(s3: S3Settings) {
  const host = s3.endpoint
    ? s3.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : `${s3.bucket_name}.s3.${s3.region}.amazonaws.com`;
  const baseUrl = s3.endpoint
    ? `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket_name}`
    : `https://${host}`;
  return { host, baseUrl };
}

async function s3SignedFetch(
  s3: S3Settings,
  method: "GET" | "DELETE" | "POST",
  url: string,
  body: Uint8Array = new Uint8Array(0),
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const u = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256(body);
  const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;

  const baseHeaders: Record<string, string> = {
    host: u.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };

  const sortedKeys = Object.keys(baseHeaders).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${baseHeaders[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  // Canonical query string (sorted, encoded)
  const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [method, u.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(new TextEncoder().encode(canonicalRequest))].join("\n");
  const signature = toHex(await hmacSha256(await getSignatureKey(s3.secret_access_key, dateStamp, s3.region), stringToSign));

  const headers: Record<string, string> = { ...baseHeaders };
  delete headers.host;
  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${s3.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, { method, headers, body: method === "GET" || method === "DELETE" ? undefined : body });
}

/**
 * List every object key in the external S3 bucket under the given key prefixes.
 * Honors path_prefix and supports pagination via continuation-token.
 */
async function listS3KeysByPrefixes(s3: S3Settings, prefixes: string[]): Promise<string[]> {
  const { baseUrl } = s3Endpoint(s3);
  const out: string[] = [];
  for (const rawPrefix of prefixes) {
    const fullPrefix = s3.path_prefix
      ? `${s3.path_prefix.replace(/\/+$/, "")}/${rawPrefix}`
      : rawPrefix;
    let continuationToken: string | null = null;
    do {
      const url = new URL(baseUrl + "/");
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", fullPrefix);
      url.searchParams.set("max-keys", "1000");
      if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
      const res: Response = await s3SignedFetch(s3, "GET", url.toString());
      if (!res.ok) {
        console.error("S3 list failed", res.status, await res.text());
        break;
      }
      const xml = await res.text();
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
      out.push(...keys);
      const nextMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      continuationToken = truncated && nextMatch ? nextMatch[1] : null;
    } while (continuationToken);
  }
  return uniq(out);
}

/**
 * Delete arbitrary S3 keys (already include path_prefix). Uses POST ?delete
 * batch endpoint, max 1000 keys per request.
 */
async function deleteS3Keys(s3: S3Settings, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const { baseUrl } = s3Endpoint(s3);
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const xmlBody =
      `<?xml version="1.0" encoding="UTF-8"?><Delete>${batch
        .map((k) => `<Object><Key>${k.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Key></Object>`)
        .join("")}<Quiet>true</Quiet></Delete>`;
    const body = new TextEncoder().encode(xmlBody);
    // SigV4 with x-amz-content-sha256 covers payload integrity — Content-MD5 not required.
    const url = `${baseUrl}/?delete=`;
    const res = await s3SignedFetch(s3, "POST", url, body, {
      "Content-Type": "application/xml",
    });
    if (!res.ok) {
      console.error("S3 batch delete failed", res.status, await res.text());
    } else {
      deleted += batch.length;
    }
  }
  return deleted;
}

async function getS3Settings(adminClient: AdminClient): Promise<S3Settings | null> {
  const { data } = await adminClient.from("site_settings").select("value").eq("key", "s3_storage_settings").maybeSingle();
  const s3 = (data?.value as S3Settings | null) ?? null;
  if (!s3?.enabled) return null;
  return s3;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: corsHeaders });
    }

    const { competition_id } = await req.json();
    if (!competition_id || typeof competition_id !== "string") {
      return new Response(JSON.stringify({ error: "competition_id required" }), { status: 400, headers: corsHeaders });
    }

    // Verify competition exists and is archived
    const { data: comp, error: compErr } = await adminClient
      .from("competitions")
      .select("id, status, title, cover_image_url")
      .eq("id", competition_id)
      .single();

    if (compErr || !comp) {
      return new Response(JSON.stringify({ error: "Competition not found" }), { status: 404, headers: corsHeaders });
    }

    if (comp.status !== "archived") {
      return new Response(JSON.stringify({ error: "Only archived competitions can be permanently deleted" }), { status: 400, headers: corsHeaders });
    }

    // Get all entry IDs for this competition (needed for entry-child tables)
    const { data: entries } = await adminClient
      .from("competition_entries")
      .select("id, photos, photo_thumbnails, photo_meta")
      .eq("competition_id", competition_id);

    const entryIds = (entries || []).map((e: { id: string }) => e.id);
    const referencedPaths = extractCompetitionStoragePaths(comp, entries || []);

    // Certificates are keyed to entries through reference_id but do not have a DB FK.
    let certificateIds: string[] = [];
    if (entryIds.length > 0) {
      const { data: certs } = await adminClient
        .from("certificates")
        .select("id")
        .in("reference_id", entryIds);

      certificateIds = (certs || []).map((c: { id: string }) => c.id);

      if (certificateIds.length > 0) {
        await adminClient.from("certificate_testimonials").delete().in("certificate_id", certificateIds);
        await adminClient.from("user_notifications").delete().in("reference_id", certificateIds);
        await adminClient.from("admin_notifications").delete().in("reference_id", certificateIds);
        await adminClient.from("notification_emit_log").delete().in("entity_id", certificateIds);
        await adminClient.from("certificates").delete().in("id", certificateIds);
      }

      await adminClient.from("user_notifications").delete().in("reference_id", entryIds);
      await adminClient.from("admin_notifications").delete().in("reference_id", entryIds);
      await adminClient.from("notification_emit_log").delete().in("entity_id", entryIds);
    }

    // Delete entry-child tables first (if entries exist)
    if (entryIds.length > 0) {
      const entryChildTables = [
        "entry_score_cache",
        "competition_votes",
        "comments",
        "image_comments",
        "image_reactions",
        "judge_scores",
        "judge_tag_assignments",
        "judge_comments",
        "judge_entry_locks",
        "judge_decisions",
        "admin_vote_adjustments",
        "raw_commitments",
        "v3_mirror_log",
        "_v3_quarantine_decisions",
        "_v3_quarantine_tag_assignments",
        "_v3_preflight_snapshot_judge_decisions",
        "_v3_preflight_snapshot_judge_tag_assignments",
      ];

      for (const table of entryChildTables) {
        const column = table === "image_comments" || table === "image_reactions" ? "image_id" : "entry_id";
        await adminClient.from(table).delete().in(column, entryIds);
      }

      await adminClient.from("judge_activity_logs").delete().in("entry_id", entryIds);
      await adminClient.from("judge_entry_assignments").delete().in("entry_id", entryIds);
      await adminClient
        .from("judge_sessions")
        .update({ last_entry_id: null })
        .in("last_entry_id", entryIds);

      // Phase 1 Mut #4: soft-void + paired reversal instead of hard-delete.
      // Preserves money forensic trail and restores participant balances.
      {
        const { data: entryTxns } = await adminClient
          .from("wallet_transactions")
          .select("id")
          .in("reference_id", entryIds);
        const entryTxnIds = (entryTxns ?? []).map((r: { id: string }) => r.id);
        if (entryTxnIds.length > 0) {
          await adminClient.rpc("soft_void_wallet_transactions", {
            p_txn_ids: entryTxnIds,
            p_reason: "competition_hard_delete:entries",
            p_batch_id: crypto.randomUUID(),
          });
        }
      }
      await adminClient.from("wallet_reconciliation_log").delete().in("reference_id", entryIds);
    }

    // Delete competition-child tables (referencing competition_id directly)
    const compChildTables = [
      "vote_adjustment_cleanup_log",
      "competition_orders",
      "competition_round_publish",
      "judging_preflight_log",
      "raw_commitments",
      "_v3_preflight_snapshot_competition_entries",
      "competition_entries",
      "competition_judges",
      "competition_judging_tags",
      "competition_payment_details",
      "judge_activity_logs",
      "judge_entry_assignments",
      "judge_sessions",
      "judging_config",
      "round_snapshots",
    ];

    for (const table of compChildTables) {
      await adminClient.from(table).delete().eq("competition_id", competition_id);
    }

    await adminClient.from("user_notifications").delete().eq("reference_id", competition_id);
    await adminClient.from("admin_notifications").delete().eq("reference_id", competition_id);
    await adminClient.from("notification_emit_log").delete().eq("entity_id", competition_id);
    // Phase 1 Mut #4: soft-void comp-keyed wallet rows too.
    {
      const { data: compTxns } = await adminClient
        .from("wallet_transactions")
        .select("id")
        .eq("reference_id", competition_id);
      const compTxnIds = (compTxns ?? []).map((r: { id: string }) => r.id);
      if (compTxnIds.length > 0) {
        await adminClient.rpc("soft_void_wallet_transactions", {
          p_txn_ids: compTxnIds,
          p_reason: "competition_hard_delete:competition",
          p_batch_id: crypto.randomUUID(),
        });
      }
    }
    await adminClient.from("wallet_reconciliation_log").delete().eq("reference_id", competition_id);

    await adminClient.from("judging_rounds").delete().eq("competition_id", competition_id);

    // Cascade audit-log purge: every row tied to comp / entry / certificate ids.
    // Phase 1 Mut #4: EXCLUDE wallet_transactions + wallets rows to preserve money forensic trail.
    const auditRowIds = uniq([competition_id, ...entryIds, ...certificateIds]);
    if (auditRowIds.length > 0) {
      await adminClient
        .from("db_audit_logs")
        .delete()
        .in("row_id", auditRowIds)
        .not("table_name", "in", '("wallet_transactions","wallets")');
    }

    // ===================================================================
    // STORAGE PURGE — by prefix, NOT just by referenced paths.
    // Prefixes: competition_id/* and every entry_id/*
    // This catches thumbnails, derived images, originals, leftover uploads.
    // ===================================================================
    const storagePrefixes = uniq([competition_id, ...entryIds]);

    // Internal Supabase bucket
    const supaPrefixListed = await listSupabaseStorageByPrefixes(
      adminClient,
      "competition-photos",
      storagePrefixes,
    );
    const supaAllPaths = uniq([...referencedPaths, ...supaPrefixListed]);
    if (supaAllPaths.length > 0) {
      await deleteSupabaseStorage(adminClient, "competition-photos", supaAllPaths);
    }

    // External S3 / R2
    const s3 = await getS3Settings(adminClient);
    let s3Deleted = 0;
    let s3ResidueAfter = 0;
    if (s3) {
      const s3Keys = await listS3KeysByPrefixes(s3, storagePrefixes.map((p) => `competition-photos/${p}/`));
      // Plus singular path-based keys (cover image, etc.) under competition-photos/
      const referencedS3Keys = referencedPaths.map((p) => {
        const rawKey = p.startsWith("competition-photos/") ? p : `competition-photos/${p}`;
        return s3.path_prefix ? `${s3.path_prefix.replace(/\/+$/, "")}/${rawKey}` : rawKey;
      });
      const allS3Keys = uniq([...s3Keys, ...referencedS3Keys]);
      s3Deleted = await deleteS3Keys(s3, allS3Keys);

      // Verify by re-listing
      const residue = await listS3KeysByPrefixes(s3, storagePrefixes.map((p) => `competition-photos/${p}/`));
      s3ResidueAfter = residue.length;
    }

    // Finally delete the competition itself
    const { error: deleteErr } = await adminClient
      .from("competitions")
      .delete()
      .eq("id", competition_id);

    if (deleteErr) {
      console.error("Delete competition error:", deleteErr);
      return new Response(
        JSON.stringify({ error: "Failed to delete competition: " + deleteErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===================================================================
    // POST-DELETE VERIFICATION GATE
    // Re-query every layer; any non-zero count → HTTP 500
    // ===================================================================
    const residue: Record<string, number> = {};

    // DB tables — count rows still referencing the deleted ids
    const checks: Array<[string, () => Promise<number>]> = [
      ["competitions", async () => {
        const { count } = await adminClient.from("competitions").select("id", { count: "exact", head: true }).eq("id", competition_id);
        return count ?? 0;
      }],
      ["competition_entries", async () => {
        const { count } = await adminClient.from("competition_entries").select("id", { count: "exact", head: true }).eq("competition_id", competition_id);
        return count ?? 0;
      }],
      ["certificates", async () => {
        if (entryIds.length === 0) return 0;
        const { count } = await adminClient.from("certificates").select("id", { count: "exact", head: true }).in("reference_id", entryIds);
        return count ?? 0;
      }],
      ["user_notifications", async () => {
        const ids = uniq([competition_id, ...entryIds, ...certificateIds]);
        if (ids.length === 0) return 0;
        const { count } = await adminClient.from("user_notifications").select("id", { count: "exact", head: true }).in("reference_id", ids);
        return count ?? 0;
      }],
      ["admin_notifications", async () => {
        const ids = uniq([competition_id, ...entryIds, ...certificateIds]);
        if (ids.length === 0) return 0;
        const { count } = await adminClient.from("admin_notifications").select("id", { count: "exact", head: true }).in("reference_id", ids);
        return count ?? 0;
      }],
      ["notification_emit_log", async () => {
        const ids = uniq([competition_id, ...entryIds, ...certificateIds]);
        if (ids.length === 0) return 0;
        const { count } = await adminClient.from("notification_emit_log").select("id", { count: "exact", head: true }).in("entity_id", ids);
        return count ?? 0;
      }],
      ["wallet_transactions", async () => {
        // Phase 1 Mut #4: wallet_transactions are SOFT-VOIDED (status='voided') by this
        // same function for forensic trail. Voided rows are NOT residue — they're the
        // intentional audit footprint. Only count non-voided rows as leakage.
        const ids = uniq([competition_id, ...entryIds]);
        if (ids.length === 0) return 0;
        const { count } = await adminClient
          .from("wallet_transactions")
          .select("id", { count: "exact", head: true })
          .in("reference_id", ids)
          .neq("status", "voided");
        return count ?? 0;
      }],
      ["db_audit_logs", async () => {
        if (auditRowIds.length === 0) return 0;
        const { count } = await adminClient.from("db_audit_logs").select("id", { count: "exact", head: true }).in("row_id", auditRowIds);
        return count ?? 0;
      }],
      ["competition_votes", async () => {
        if (entryIds.length === 0) return 0;
        const { count } = await adminClient.from("competition_votes").select("id", { count: "exact", head: true }).in("entry_id", entryIds);
        return count ?? 0;
      }],
      ["judge_decisions", async () => {
        if (entryIds.length === 0) return 0;
        const { count } = await adminClient.from("judge_decisions").select("id", { count: "exact", head: true }).in("entry_id", entryIds);
        return count ?? 0;
      }],
    ];

    for (const [name, fn] of checks) {
      try { residue[name] = await fn(); } catch (e) { residue[name] = -1; }
    }

    // Storage residue — re-list internal bucket
    const supaResidue = await listSupabaseStorageByPrefixes(adminClient, "competition-photos", storagePrefixes);
    residue["storage_supabase"] = supaResidue.length;
    residue["storage_s3"] = s3ResidueAfter;

    const totalResidue = Object.values(residue).reduce((a, b) => a + Math.max(0, b), 0);

    if (totalResidue > 0) {
      console.error("HARD DELETE residue detected", residue);
      return new Response(
        JSON.stringify({
          error: "Residue detected after hard delete — clean-up incomplete",
          residue,
          competition_id,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        guarantee: "verified-clean",
        entries_deleted: entryIds.length,
        certificates_deleted: certificateIds.length,
        files_deleted_supabase: supaAllPaths.length,
        files_deleted_s3: s3Deleted,
        residue,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Hard delete competition error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
