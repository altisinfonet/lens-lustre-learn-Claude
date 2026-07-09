import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKETS = [
  "avatars",
  "competition-photos",
  "course-images",
  "email-assets",
  "journal-images",
  "portfolio-images",
  "post-images",
];

// All DB columns that store storage URLs (excluding external URLs like social profiles)
const IMAGE_QUERIES = [
  `SELECT image_url FROM album_photos WHERE image_url IS NOT NULL`,
  `SELECT photo_url AS image_url FROM certificate_testimonials WHERE photo_url IS NOT NULL`,
  `SELECT file_url AS image_url FROM certificates WHERE file_url IS NOT NULL`,
  `SELECT cover_image_url AS image_url FROM competitions WHERE cover_image_url IS NOT NULL`,
  `SELECT cover_image_url AS image_url FROM courses WHERE cover_image_url IS NOT NULL`,
  `SELECT artist_avatar_url AS image_url FROM featured_artists WHERE artist_avatar_url IS NOT NULL`,
  `SELECT cover_image_url AS image_url FROM featured_artists WHERE cover_image_url IS NOT NULL`,
  `SELECT image_url FROM featured_photos WHERE image_url IS NOT NULL`,
  `SELECT image_url FROM hero_banners WHERE image_url IS NOT NULL`,
  `SELECT image_url FROM highlight_items WHERE image_url IS NOT NULL`,
  `SELECT cover_url AS image_url FROM highlights WHERE cover_url IS NOT NULL`,
  `SELECT cover_image_url AS image_url FROM journal_articles WHERE cover_image_url IS NOT NULL`,
  `SELECT image_url FROM judging_tags WHERE image_url IS NOT NULL`,
  `SELECT image_url FROM lessons WHERE image_url IS NOT NULL`,
  `SELECT cover_url AS image_url FROM photo_albums WHERE cover_url IS NOT NULL`,
  `SELECT image_url FROM photo_of_the_day WHERE image_url IS NOT NULL`,
  `SELECT image_url FROM portfolio_images WHERE image_url IS NOT NULL`,
  `SELECT thumbnail_url AS image_url FROM portfolio_images WHERE thumbnail_url IS NOT NULL`,
  `SELECT image_url FROM posts WHERE image_url IS NOT NULL`,
  `SELECT avatar_url AS image_url FROM profiles WHERE avatar_url IS NOT NULL`,
  `SELECT cover_url AS image_url FROM profiles WHERE cover_url IS NOT NULL`,
  `SELECT cover_video_url AS image_url FROM profiles WHERE cover_video_url IS NOT NULL`,
  `SELECT national_id_url AS image_url FROM profiles WHERE national_id_url IS NOT NULL`,
  `SELECT image_url FROM stories WHERE image_url IS NOT NULL`,
  `SELECT attachment_url AS image_url FROM ticket_replies WHERE attachment_url IS NOT NULL`,
];

// Array columns that store multiple URLs
const ARRAY_QUERIES = [
  `SELECT unnest(photos) AS image_url FROM competition_entries WHERE array_length(photos, 1) > 0`,
  `SELECT unnest(image_urls) AS image_url FROM posts WHERE array_length(image_urls, 1) > 0`,
  `SELECT unnest(photo_gallery) AS image_url FROM journal_articles WHERE array_length(photo_gallery, 1) > 0`,
  `SELECT unnest(photo_gallery) AS image_url FROM featured_artists WHERE array_length(photo_gallery, 1) > 0`,
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check - admin only
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller via getClaims
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: claimsData.claims.sub };

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Collect all referenced URLs from DB
    const referencedPaths = new Set<string>();

    const extractPath = (url: string) => {
      if (!url) return null;
      // Strip query params (cache busters)
      const cleanUrl = url.split("?")[0];
      // Extract path from Supabase storage URL
      // Pattern: .../storage/v1/object/public/{bucket}/{path}
      const match = cleanUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/);
      if (match) return match[1];
      // Also handle raw paths stored directly
      for (const b of BUCKETS) {
        if (cleanUrl.startsWith(b + "/")) return cleanUrl;
      }
      return null;
    };

    for (const query of [...IMAGE_QUERIES, ...ARRAY_QUERIES]) {
      const { data, error } = await adminClient.rpc("", {}).maybeSingle();
      // Use raw SQL via postgrest - not available, use from() queries instead
    }

    // Alternative: query each table individually
    const collectUrls = async () => {
      const queries: Promise<void>[] = [];

      const addUrls = async (table: string, columns: string[]) => {
        const { data } = await adminClient.from(table).select(columns.join(",")).limit(10000);
        if (data) {
          for (const row of data) {
            for (const col of columns) {
              const val = row[col];
              if (!val) continue;
              if (Array.isArray(val)) {
                for (const u of val) {
                  const p = extractPath(u);
                  if (p) referencedPaths.add(p);
                }
              } else if (typeof val === "string") {
                const p = extractPath(val);
                if (p) referencedPaths.add(p);
              }
            }
          }
        }
      };

      queries.push(addUrls("album_photos", ["image_url"]));
      queries.push(addUrls("certificate_testimonials", ["photo_url"]));
      queries.push(addUrls("certificates", ["file_url"]));
      queries.push(addUrls("competitions", ["cover_image_url"]));
      queries.push(addUrls("courses", ["cover_image_url"]));
      queries.push(addUrls("featured_artists", ["artist_avatar_url", "cover_image_url", "photo_gallery"]));
      queries.push(addUrls("featured_photos", ["image_url"]));
      queries.push(addUrls("hero_banners", ["image_url"]));
      queries.push(addUrls("highlight_items", ["image_url"]));
      queries.push(addUrls("highlights", ["cover_url"]));
      queries.push(addUrls("journal_articles", ["cover_image_url", "photo_gallery"]));
      queries.push(addUrls("judging_tags", ["image_url"]));
      queries.push(addUrls("lessons", ["image_url"]));
      queries.push(addUrls("photo_albums", ["cover_url"]));
      queries.push(addUrls("photo_of_the_day", ["image_url"]));
      queries.push(addUrls("portfolio_images", ["image_url", "thumbnail_url"]));
      queries.push(addUrls("posts", ["image_url", "image_urls"]));
      queries.push(addUrls("profiles", ["avatar_url", "cover_url", "cover_video_url", "national_id_url"]));
      queries.push(addUrls("stories", ["image_url"]));
      queries.push(addUrls("ticket_replies", ["attachment_url"]));
      queries.push(addUrls("competition_entries", ["photos"]));

      await Promise.all(queries);
    };

    await collectUrls();

    // Step 2: List all files in each bucket
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    interface OrphanFile {
      bucket: string;
      path: string;
      fullPath: string;
      size: number;
      created_at: string;
      age_days: number;
    }

    const orphans: OrphanFile[] = [];
    const bucketStats: Record<string, { total: number; orphans: number; orphanSize: number }> = {};

    for (const bucket of BUCKETS) {
      bucketStats[bucket] = { total: 0, orphans: 0, orphanSize: 0 };

      // List files recursively (up to 1000 per call)
      const listRecursive = async (prefix: string = ""): Promise<void> => {
        const { data: files, error } = await adminClient.storage
          .from(bucket)
          .list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });

        if (error || !files) return;

        for (const file of files) {
          const filePath = prefix ? `${prefix}/${file.name}` : file.name;

          // If it's a folder, recurse
          if (file.id === null) {
            await listRecursive(filePath);
            continue;
          }

          bucketStats[bucket].total++;

          const fullStoragePath = `${bucket}/${filePath}`;
          const isReferenced = referencedPaths.has(fullStoragePath);

          if (!isReferenced) {
            const createdAt = file.created_at ? new Date(file.created_at) : new Date();
            const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

            if (ageDays >= 30) {
              orphans.push({
                bucket,
                path: filePath,
                fullPath: fullStoragePath,
                size: file.metadata?.size || 0,
                created_at: file.created_at || "",
                age_days: ageDays,
              });
              bucketStats[bucket].orphans++;
              bucketStats[bucket].orphanSize += file.metadata?.size || 0;
            }
          }
        }
      };

      await listRecursive();
    }

    // Step 3: Generate report
    const totalOrphanSize = orphans.reduce((s, o) => s + o.size, 0);

    const report = {
      scan_timestamp: new Date().toISOString(),
      summary: {
        buckets_scanned: BUCKETS.length,
        db_references_found: referencedPaths.size,
        total_orphan_files: orphans.length,
        total_orphan_size_bytes: totalOrphanSize,
        total_orphan_size_mb: Math.round(totalOrphanSize / 1024 / 1024 * 100) / 100,
      },
      bucket_stats: bucketStats,
      orphan_files: orphans.sort((a, b) => b.size - a.size).slice(0, 500), // Top 500 by size
      note: "READ-ONLY REPORT. No files were deleted or modified.",
    };

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
