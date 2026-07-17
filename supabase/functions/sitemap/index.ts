import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://50mmretina.com";

const corsHeaders = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "Access-Control-Allow-Origin": "*",
};

// Static routes with their priorities and change frequencies
const staticRoutes = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/competitions", priority: "0.9", changefreq: "daily" },
  { path: "/courses", priority: "0.9", changefreq: "weekly" },
  { path: "/journal", priority: "0.8", changefreq: "daily" },
  { path: "/winners", priority: "0.7", changefreq: "weekly" },
  { path: "/discover", priority: "0.7", changefreq: "daily" },
  { path: "/feed", priority: "0.6", changefreq: "daily" },
  { path: "/certificates", priority: "0.5", changefreq: "monthly" },
  { path: "/signup", priority: "0.5", changefreq: "monthly" },
  { path: "/login", priority: "0.4", changefreq: "monthly" },
  { path: "/help-support", priority: "0.4", changefreq: "monthly" },
  { path: "/cookie-policy", priority: "0.3", changefreq: "monthly" },
  { path: "/verify", priority: "0.3", changefreq: "monthly" },
];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: string, image?: string): string {
  let entry = `  <url>\n    <loc>${escapeXml(loc)}</loc>\n`;
  if (lastmod) entry += `    <lastmod>${lastmod}</lastmod>\n`;
  if (changefreq) entry += `    <changefreq>${changefreq}</changefreq>\n`;
  if (priority) entry += `    <priority>${priority}</priority>\n`;
  if (image) entry += `    <image:image>\n      <image:loc>${escapeXml(image)}</image:loc>\n    </image:image>\n`;
  entry += `  </url>\n`;
  return entry;
}

// SOW §6 Loop C — sitemaps.org limit is 50,000 URLs per file.
// Cap each dynamic section so we never silently exceed the limit.
const HARD_CAP_PER_SECTION = 8000;

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split("T")[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
    xml += `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

    // 1. Static routes
    for (const route of staticRoutes) {
      xml += urlEntry(`${SITE_URL}${route.path}`, today, route.changefreq, route.priority);
    }

    // 2. Competitions
    const { data: competitions } = await supabase
      .from("competitions")
      .select("id, updated_at, cover_image_url, title")
      .in("status", ["open", "closed", "judging", "completed"])
      .limit(HARD_CAP_PER_SECTION); // BUG-096: cap all sections, not just profiles/posts

    if (competitions) {
      for (const c of competitions) {
        xml += urlEntry(
          `${SITE_URL}/competitions/${c.id}`,
          c.updated_at?.split("T")[0],
          "weekly",
          "0.7",
          c.cover_image_url || undefined
        );
      }
    }

    // 3. Journal articles
    const { data: articles } = await supabase
      .from("journal_articles")
      .select("slug, updated_at, cover_image_url")
      .eq("status", "published")
      .limit(HARD_CAP_PER_SECTION); // BUG-096

    if (articles) {
      for (const a of articles) {
        xml += urlEntry(
          `${SITE_URL}/journal/${a.slug}`,
          a.updated_at?.split("T")[0],
          "monthly",
          "0.6",
          a.cover_image_url || undefined
        );
      }
    }

    // 4. Courses
    const { data: courses } = await supabase
      .from("courses")
      .select("slug, updated_at, cover_image_url")
      .eq("status", "published")
      .limit(HARD_CAP_PER_SECTION); // BUG-096

    if (courses) {
      for (const c of courses) {
        xml += urlEntry(
          `${SITE_URL}/courses/${c.slug}`,
          c.updated_at?.split("T")[0],
          "monthly",
          "0.7",
          c.cover_image_url || undefined
        );
      }
    }

    // 5. Featured artists
    const { data: artists } = await supabase
      .from("featured_artists")
      .select("slug, updated_at, cover_image_url")
      .eq("is_active", true)
      .limit(HARD_CAP_PER_SECTION); // BUG-096

    if (artists) {
      for (const a of artists) {
        xml += urlEntry(
          `${SITE_URL}/featured-artist/${a.slug}`,
          a.updated_at?.split("T")[0],
          "monthly",
          "0.6",
          a.cover_image_url || undefined
        );
      }
    }

    // 6. Managed pages
    const { data: pagesData } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "managed_pages")
      .maybeSingle();

    if (pagesData?.value && Array.isArray(pagesData.value)) {
      for (const p of pagesData.value as any[]) {
        if (p.is_published && !p.noindex) {
          xml += urlEntry(
            `${SITE_URL}/page/${p.slug}`,
            undefined,
            "monthly",
            "0.4"
          );
        }
      }
    }

    // 7. Public profiles — SOW §5.3: filter out indexing_disabled = true
    const { data: profiles } = await supabase
      .from("profiles")
      .select("custom_url, updated_at, avatar_url")
      .eq("indexing_disabled", false)
      .not("custom_url", "is", null)
      .limit(HARD_CAP_PER_SECTION);

    if (profiles) {
      for (const p of profiles as any[]) {
        if (!p.custom_url) continue;
        xml += urlEntry(
          `${SITE_URL}/${p.custom_url}`,
          p.updated_at?.split("T")[0],
          "weekly",
          "0.5",
          p.avatar_url || undefined
        );
      }
    }

    // 8. Public posts — SOW §5.3: only privacy=public AND indexing_disabled=false
    const { data: posts } = await supabase
      .from("posts")
      .select("id, created_at, image_url")
      .eq("privacy", "public")
      .eq("indexing_disabled", false)
      .order("created_at", { ascending: false })
      .limit(HARD_CAP_PER_SECTION);

    if (posts) {
      for (const p of posts as any[]) {
        xml += urlEntry(
          `${SITE_URL}/post/${p.id}`,
          p.created_at?.split("T")[0],
          "monthly",
          "0.4",
          p.image_url || undefined
        );
      }
    }

    xml += `</urlset>`;

    return new Response(xml, { headers: corsHeaders });
  } catch (error) {
    console.error("Sitemap generation error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
