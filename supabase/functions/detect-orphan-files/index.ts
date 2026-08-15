import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { getS3Settings, listAllS3Objects } from "../_shared/s3.ts";

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

/**
 * ⚠ THIS TABLE IS A DELETION SAFETY LIST. AN OMISSION HERE IS A DATA-LOSS BUG.
 *
 * Anything NOT named below is reported as an orphan, and `purge-s3-orphans`
 * acts on that verdict. A column left out of this file is a file deleted out
 * of a live post.
 *
 * ── WHY THIS WAS REWRITTEN, 2026-08-14 ─────────────────────────────────────
 *
 * THREE defects, in one file, compounding:
 *
 * 1. THE LIST THAT LOOKED AUTHORITATIVE WAS DEAD CODE. Two hand-maintained
 *    arrays, `IMAGE_QUERIES` and `ARRAY_QUERIES`, sat at the top of this file
 *    full of correct-looking SQL. Nothing read them. The real reference set
 *    was a second, divergent list of `addUrls(table, columns)` calls buried
 *    250 lines below. They are now ONE list, and it is the one that runs.
 *
 * 2. `posts.thumbnail_urls` was in neither. Every `-thumb.webp` in the product
 *    was unreferenced by construction.
 *
 * 3. A FAILED reference query was indistinguishable from an empty one:
 *    `if (error || !data || data.length === 0) break;` treated a transient
 *    error on `posts` as "this table references nothing", which would condemn
 *    every post image in a single run. Errors are now fatal — see collectUrls.
 *
 * Defect 2 had not caused harm for one bad reason: the scan enumerates
 * candidates from Supabase Storage while live uploads have moved to R2, so it
 * is blind to the real object store. Teaching it to see R2 is the obvious next
 * fix and was already scheduled. Doing that first would have condemned,
 * measured on production 2026-08-14:
 *
 *     posts.thumbnail_urls              249 urls across 201 posts
 *     hero_banners.thumbnail_url          7
 *     photo_of_the_day.thumbnail_url      2
 *     ad_creatives.image_url              2
 *     ad_creatives.advertiser_logo_url    1
 *     office_staff.photo_url              1
 *     scheduled_posts.image_urls          1   (a member's unpublished post)
 *     ─────────────────────────────────────────
 *     263 live files
 *
 * Individually survivable bugs whose entire risk lives in the REPAIR ORDER.
 * This file must be correct BEFORE anything teaches the scan to see R2.
 *
 * ── HOW TO EXTEND IT ───────────────────────────────────────────────────────
 *
 * Rebuilt by asking the database, not from memory:
 *
 *   select c.table_name, c.column_name, c.data_type
 *     from information_schema.columns c
 *     join information_schema.tables t
 *       on t.table_schema = c.table_schema and t.table_name = c.table_name
 *    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
 *      and c.column_name ~ '(url|urls|photo|photos|image|images|avatar|cover|attachment|file|thumb)'
 *      and c.data_type in ('text','ARRAY','character varying');
 *
 * Re-run that when a table is added and reconcile the difference. Columns
 * holding EXTERNAL links (profiles.website_url/.instagram_url/.custom_url,
 * client_errors.url, search_recents, push_config.function_url,
 * test_agent_runs.*) are deliberately absent — they never name a stored file.
 * `image_type` columns are enum-ish discriminators, not URLs.
 *
 * Array and scalar columns are handled identically by addUrls, so they live in
 * one table rather than two.
 */
const REFERENCE_COLUMNS: { table: string; columns: string[] }[] = [
  { table: "ad_creatives", columns: ["image_url", "advertiser_logo_url"] },
  { table: "album_photos", columns: ["image_url"] },
  { table: "certificate_testimonials", columns: ["photo_url"] },
  { table: "certificates", columns: ["file_url"] },
  { table: "competitions", columns: ["cover_image_url"] },
  // photo_thumbnails is empty in production today, which is exactly why it
  // would have been missed. A column is not safe merely because it is unused
  // this week.
  { table: "competition_entries", columns: ["photos", "photo_thumbnails"] },
  { table: "courses", columns: ["cover_image_url"] },
  { table: "featured_artists", columns: ["artist_avatar_url", "cover_image_url", "photo_gallery"] },
  { table: "featured_photos", columns: ["image_url", "thumbnail_url"] },
  { table: "hero_banners", columns: ["image_url", "thumbnail_url"] },
  { table: "highlight_items", columns: ["image_url"] },
  { table: "highlights", columns: ["cover_url"] },
  { table: "journal_articles", columns: ["cover_image_url", "photo_gallery"] },
  { table: "judging_tags", columns: ["image_url"] },
  { table: "lessons", columns: ["image_url"] },
  { table: "office_staff", columns: ["photo_url"] },
  { table: "photo_albums", columns: ["cover_url"] },
  { table: "photo_of_the_day", columns: ["image_url", "thumbnail_url"] },
  { table: "portfolio_images", columns: ["image_url", "thumbnail_url"] },
  // A draft holds bytes already in the object store and not yet in `posts`.
  // Omitting it deletes a member's work in progress.
  { table: "post_drafts", columns: ["image_url", "image_urls", "thumbnail_urls"] },
  // ⚠ thumbnail_urls is THE column that was missing. 249 urls / 201 posts.
  { table: "posts", columns: ["image_url", "image_urls", "thumbnail_url", "thumbnail_urls"] },
  { table: "profiles", columns: ["avatar_url", "national_id_url"] },
  // Uploaded, and simply waiting for its publish time.
  { table: "scheduled_posts", columns: ["image_url", "image_urls"] },
  { table: "stories", columns: ["image_url"] },
  { table: "ticket_replies", columns: ["attachment_url"] },
];

/**
 * Recovery snapshots, treated as REFERENCES on purpose.
 *
 * `posts_dead_host_backup_20260812` was taken when the previous image host
 * died. If a file survives only because a backup row points at it, that is
 * precisely the file a recovery would need — and precisely the file this sweep
 * must not delete.
 *
 * The cost is that genuinely dead files stay alive while a snapshot exists.
 * That is the correct trade for a tool whose companion deletes: drop the
 * snapshot table when the recovery is provably finished and these files become
 * collectable in the same motion. Deleting first and discovering the need
 * afterwards has no equivalent undo.
 *
 * These are listed separately ONLY so a missing snapshot table is tolerated —
 * a snapshot that has been dropped is a legitimate state, whereas a missing
 * table in REFERENCE_COLUMNS is a schema drift that must stop the run.
 */
const SNAPSHOT_COLUMNS: { table: string; columns: string[] }[] = [
  { table: "posts_dead_host_backup_20260812", columns: ["image_urls", "thumbnail_urls"] },
  { table: "_v3_preflight_snapshot_competition_entries", columns: ["photos", "photo_thumbnails"] },
  { table: "_v3_preflight_snapshot_judging_tags", columns: ["image_url"] },
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
    // Snapshot tables that could not be read. Surfaced in the response: a
    // skipped snapshot means the reference set is narrower than intended, and
    // whoever reads this report before deleting anything needs to know.
    const snapshotSkips: string[] = [];

    const extractPath = (url: string) => {
      if (!url) return null;
      // Strip query params (cache busters)
      const cleanUrl = url.split("?")[0];
      // Extract path from Supabase storage URL
      // Pattern: .../storage/v1/object/public/{bucket}/{path}
      const match = cleanUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/);
      if (match) return match[1];
      // BUG-071: media is served from the R2/CDN host (e.g.
      // https://cdn.50mmretina.com/<bucket>/<path>). Strip any absolute origin so
      // an R2/CDN URL normalizes to the same <bucket>/<path> key as the stored
      // object — otherwise referenced files were missed and flagged as orphans.
      let pathPart = cleanUrl;
      const hostMatch = cleanUrl.match(/^https?:\/\/[^/]+\/(.+)$/);
      if (hostMatch) pathPart = hostMatch[1];
      for (const b of BUCKETS) {
        if (pathPart.startsWith(b + "/")) return pathPart;
        if (cleanUrl.startsWith(b + "/")) return cleanUrl;
      }
      return null;
    };

    // Query each table individually and collect all referenced storage paths.
    const collectUrls = async () => {
      const queries: Promise<void>[] = [];

      const addUrls = async (table: string, columns: string[]) => {
        // BUG-071: paginate. A flat .limit(10000) truncated large tables, so
        // referenced URLs beyond the cap were missed and their live files were
        // then falsely reported as orphans.
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await adminClient
            .from(table)
            .select(columns.join(","))
            .range(from, from + PAGE - 1);
          // ⚠ AN ERROR IS NOT AN EMPTY TABLE.
          //
          // This used to read `if (error || !data || ...) break;` — a transient
          // failure on `posts` was silently indistinguishable from "this table
          // references nothing", and every post image would be condemned in
          // that run. The reference set is a deletion safety list: an
          // incomplete one is worse than no answer at all, so this throws and
          // the whole report fails.
          if (error) {
            throw new Error(
              `reference scan failed on ${table}.${columns.join(",")} at offset ${from}: ` +
              `${error.message ?? String(error)} — aborting rather than reporting a partial reference set`,
            );
          }
          if (!data || data.length === 0) break;
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
          if (data.length < PAGE) break;
        }
      };

      // ONE list, and it is this one. See REFERENCE_COLUMNS for why that
      // sentence had to be written down.
      for (const { table, columns } of REFERENCE_COLUMNS) {
        queries.push(addUrls(table, columns));
      }

      // Snapshots are best-effort: a dropped snapshot table is a legitimate
      // state, unlike a missing live table. Tolerated, but never silently — a
      // snapshot that fails for any OTHER reason still needs to be visible.
      for (const { table, columns } of SNAPSHOT_COLUMNS) {
        queries.push(
          addUrls(table, columns).catch((e) => {
            snapshotSkips.push(`${table}: ${e?.message ?? String(e)}`);
          }),
        );
      }

      await Promise.all(queries);
    };

    await collectUrls();

    // ── B3d-1: DERIVED rung addresses count as referenced. ────────────────
    // Rung files (`…-l3-r1080.webp`, `…-l3-r1440.webp`) are stored beside a
    // marked original but appear in NO database column — the renderer derives
    // their URLs from the original's name, and so must this reference set, or
    // every rung in the store reads as an orphan and the companion deletes the
    // exact files that make the feed fast. The derivation here MUST mirror
    // src/lib/imageLadder.ts (marker `-l3`, rungs 1080/1440); a naming change
    // there changes this line with it — locked by orphanReferenceSet.test.ts.
    for (const key of [...referencedPaths]) {
      const m = key.match(/^(.*)-l3(\.[a-z0-9]+)$/i);
      if (m) {
        referencedPaths.add(`${m[1]}-l3-r1080${m[2]}`);
        referencedPaths.add(`${m[1]}-l3-r1440${m[2]}`);
      }
    }

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

    // ── Step 2b: THE REAL OBJECT STORE. Live uploads go to R2; the Supabase
    // Storage scan above sees only the legacy buckets. This is the cycle the
    // whole B3a reference-set repair existed to make safe (the 263-file
    // near-miss was precisely "make this R2-aware with the old reference set").
    //
    // Read-only, like everything in this function. The R2 orphan list feeds a
    // HUMAN review and the Deletion Protocol in purge-s3-orphans — it deletes
    // nothing here.
    interface R2Orphan {
      key: string;
      bucket: string;
      size: number;
      last_modified: string;
      age_days: number;
    }
    let r2Scanned = false;
    let r2ScanError: string | null = null;
    const r2Stats: Record<string, { total: number; orphans: number; orphanSize: number }> = {};
    const r2Orphans: R2Orphan[] = [];
    let r2TotalObjects = 0;
    let r2UnknownPrefix = 0;

    try {
      const s3 = await getS3Settings(adminClient);
      if (!s3) {
        r2ScanError = "S3/R2 not configured or not enabled in site_settings";
      } else {
        const pathPrefix = s3.path_prefix ? s3.path_prefix.replace(/\/+$/, "") + "/" : "";
        const objects = await listAllS3Objects(s3, pathPrefix);
        r2TotalObjects = objects.length;
        for (const b of BUCKETS) r2Stats[b] = { total: 0, orphans: 0, orphanSize: 0 };

        for (const obj of objects) {
          // Reference keys are `<bucket>/<path>`; strip the deployment prefix
          // so both sides speak the same key.
          const key = pathPrefix && obj.key.startsWith(pathPrefix) ? obj.key.slice(pathPrefix.length) : obj.key;
          const bucket = key.split("/")[0];
          if (!BUCKETS.includes(bucket)) {
            // A prefix we do not recognise is NOT an orphan — it is a gap in
            // this function's knowledge, and deleting from ignorance is how
            // the near-miss happened. Counted and surfaced instead.
            r2UnknownPrefix++;
            continue;
          }
          r2Stats[bucket].total++;

          if (!referencedPaths.has(key)) {
            const ageDays = obj.lastModified
              ? Math.floor((Date.now() - new Date(obj.lastModified).getTime()) / 86400000)
              : 0;
            if (ageDays >= 30) {
              r2Orphans.push({ key: obj.key, bucket, size: obj.size, last_modified: obj.lastModified, age_days: ageDays });
              r2Stats[bucket].orphans++;
              r2Stats[bucket].orphanSize += obj.size;
            }
          }
        }
        r2Scanned = true;
      }
    } catch (e) {
      // The R2 half failing must not take down the legacy report, but it must
      // be IMPOSSIBLE to mistake "scan failed" for "no orphans on R2".
      r2ScanError = (e as Error)?.message ?? String(e);
    }

    // Step 3: Generate report
    const totalOrphanSize = orphans.reduce((s, o) => s + o.size, 0);

    const report = {
      scan_timestamp: new Date().toISOString(),
      summary: {
        buckets_scanned: BUCKETS.length,
        db_references_found: referencedPaths.size,
        reference_tables_scanned: REFERENCE_COLUMNS.length,
        total_orphan_files: orphans.length,
        total_orphan_size_bytes: totalOrphanSize,
        total_orphan_size_mb: Math.round(totalOrphanSize / 1024 / 1024 * 100) / 100,
      },
      bucket_stats: bucketStats,
      orphan_files: orphans.sort((a, b) => b.size - a.size).slice(0, 500), // Top 500 by size
      r2: {
        scanned: r2Scanned,
        // null when the scan succeeded; the reason when it did not. A reader
        // must never infer "clean" from a section that simply failed to run.
        scan_error: r2ScanError,
        total_objects: r2TotalObjects,
        unknown_prefix_objects: r2UnknownPrefix,
        bucket_stats: r2Stats,
        orphan_files: r2Orphans.sort((a, b) => b.size - a.size).slice(0, 500),
        total_orphan_files: r2Orphans.length,
        total_orphan_size_bytes: r2Orphans.reduce((s2, o) => s2 + o.size, 0),
      },
      // A skipped snapshot narrows the reference set. Whoever reads this before
      // deleting anything has to see it, so it rides in the report rather than
      // only in the logs.
      snapshot_tables_skipped: snapshotSkips,
      // Scope, stated truthfully per run: the legacy Supabase Storage buckets
      // are always scanned; R2 — the live object store — is scanned when
      // configured, and `r2.scanned=false` + `r2.scan_error` say so loudly
      // when it is not. Never read an absent R2 section as "storage is clean".
      scope_warning: r2Scanned
        ? "Supabase Storage and R2 both scanned. R2 orphans are REPORT-ONLY; deletion goes through purge-s3-orphans under the Deletion Protocol."
        : `R2 was NOT scanned this run (${r2ScanError ?? "unknown reason"}). Supabase Storage only — do not read this as 'storage is clean'.`,
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
