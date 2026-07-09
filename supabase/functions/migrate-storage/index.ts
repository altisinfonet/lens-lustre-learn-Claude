import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface S3Settings {
  enabled: boolean;
  bucket_name: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  endpoint?: string;
  path_prefix?: string;
  public_url?: string;
}

// AWS Signature V4 helpers
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const rawKey = key instanceof Uint8Array ? new Uint8Array(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256(data: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(hash);
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

async function uploadToS3(fileBytes: Uint8Array, contentType: string, s3Key: string, s3: S3Settings): Promise<string> {
  const host = s3.endpoint
    ? s3.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : `${s3.bucket_name}.s3.${s3.region}.amazonaws.com`;
  const baseUrl = s3.endpoint
    ? `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket_name}`
    : `https://${host}`;
  const url = `${baseUrl}/${s3Key}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const contentHash = await sha256(fileBytes);
  const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${new URL(url).host}`,
    `x-amz-content-sha256:${contentHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n") + "\n";

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalUri = new URL(url).pathname;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    contentHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = await getSignatureKey(s3.secret_access_key, dateStamp, s3.region, "s3");
  const signature = toHex(await hmacSha256(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${s3.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const s3Response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": contentHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body: fileBytes,
  });

  if (!s3Response.ok) {
    const errText = await s3Response.text();
    throw new Error(`S3 upload failed for ${s3Key}: ${errText}`);
  }

  return url;
}

function guessContentType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", bmp: "image/bmp", tiff: "image/tiff", svg: "image/svg+xml",
    pdf: "application/pdf",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mp4: "video/mp4", mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Admin check
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get S3 settings
    const { data: settingsRow } = await adminClient
      .from("site_settings")
      .select("value")
      .eq("key", "s3_storage_settings")
      .maybeSingle();

    if (!settingsRow?.value) {
      return new Response(JSON.stringify({ error: "S3 storage not configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const s3: S3Settings = settingsRow.value as any;
    if (!s3.enabled) {
      return new Response(JSON.stringify({ error: "S3 storage is disabled. Enable it first." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { buckets, action } = body;

    // Action: "list" returns file counts per bucket, "migrate" does actual migration
    if (action === "list") {
      const results: Record<string, number> = {};
      const bucketNames = buckets || ["competition-photos", "journal-images", "course-images", "portfolio-images", "avatars", "post-images"];
      
      for (const bucket of bucketNames) {
        try {
          // Count root files + count subfolders (one level only for speed)
          const { data: items } = await adminClient.storage.from(bucket).list("", {
            limit: 1000,
            sortBy: { column: "created_at", order: "asc" },
          });
          let count = 0;
          const folders: string[] = [];
          if (items) {
            for (const f of items) {
              if (f.id) count++;
              else folders.push(f.name);
            }
          }
          // Count files inside each top-level subfolder (one level deep)
          for (const folder of folders) {
            try {
              const { data: subItems } = await adminClient.storage.from(bucket).list(folder, {
                limit: 1000,
                sortBy: { column: "created_at", order: "asc" },
              });
              if (subItems) {
                count += subItems.filter(f => f.id).length;
              }
            } catch { /* skip */ }
          }
          results[bucket] = count;
        } catch {
          results[bucket] = 0;
        }
      }
      
      return new Response(JSON.stringify({ counts: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "migrate") {
      const targetBucket = body.bucket;
      const folder = body.folder || "";
      const limit = body.limit || 50; // Process in batches
      const offset = body.offset || 0;
      
      if (!targetBucket) {
        return new Response(JSON.stringify({ error: "Bucket name required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // List files from Supabase storage
      const { data: files, error: listError } = await adminClient.storage.from(targetBucket).list(folder, {
        limit,
        offset,
        sortBy: { column: "created_at", order: "asc" },
      });

      if (listError) {
        return new Response(JSON.stringify({ error: `Failed to list files: ${listError.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const migrated: string[] = [];
      const failed: { name: string; error: string }[] = [];
      const skipped: string[] = [];

      for (const file of (files || [])) {
        if (!file.id) {
          // It's a folder, skip
          skipped.push(file.name);
          continue;
        }

        const filePath = folder ? `${folder}/${file.name}` : file.name;
        
        try {
          // Download from Supabase storage
          const { data: fileData, error: dlError } = await adminClient.storage.from(targetBucket).download(filePath);
          if (dlError || !fileData) {
            failed.push({ name: filePath, error: dlError?.message || "Download failed" });
            continue;
          }

          const fileBytes = new Uint8Array(await fileData.arrayBuffer());
          const contentType = guessContentType(file.name);
          const s3Key = s3.path_prefix
            ? `${s3.path_prefix.replace(/\/+$/, "")}/${targetBucket}/${filePath}`
            : `${targetBucket}/${filePath}`;

          await uploadToS3(fileBytes, contentType, s3Key, s3);
          migrated.push(filePath);
        } catch (err: any) {
          failed.push({ name: filePath, error: err.message || "Upload failed" });
        }
      }

      const hasMore = (files || []).length === limit;

      return new Response(JSON.stringify({
        migrated: migrated.length,
        failed: failed.length,
        skipped: skipped.length,
        migratedFiles: migrated,
        failedFiles: failed,
        skippedFolders: skipped,
        hasMore,
        nextOffset: offset + (files?.length || 0),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Action: "migrate-folder" - list subfolders then migrate each
    if (action === "list-folders") {
      const targetBucket = body.bucket;
      const parentFolder = body.folder || "";
      
      const { data: items } = await adminClient.storage.from(targetBucket).list(parentFolder, { limit: 1000 });
      const folders: string[] = [];
      let rootFiles = 0;
      for (const item of (items || [])) {
        if (!item.id) {
          const fullPath = parentFolder ? `${parentFolder}/${item.name}` : item.name;
          folders.push(fullPath);
        } else {
          rootFiles++;
        }
      }
      
      return new Response(JSON.stringify({ folders, rootFiles }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'list', 'migrate', or 'list-folders'" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("Migration error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
