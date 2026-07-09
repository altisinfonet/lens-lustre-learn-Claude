// seo-route-metadata — v2 (Loop B fix: full_name not display_name)
// Returns SEO metadata (title, description, OG, JSON-LD) for any route on 50mmretina.com.
// Called by the Cloudflare Worker (seo-edge-injector) when a crawler requests a page.
// Public, no auth. Read-only. Hard 5s budget; falls back to global defaults on any error.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const SITE_URL = "https://50mmretina.com";
const SITE_NAME_FALLBACK = "50mm Retina World";
const DEFAULT_TITLE = "50mm Retina World — Competitions, Education & Journal for Photographers";
const DEFAULT_DESC = "Join 50mm Retina World — the ultimate platform for photographers.";

interface Metadata {
  title: string;
  description: string;
  ogImage: string;
  ogType: "website" | "article";
  canonical: string;
  noindex: boolean;
  jsonLd: object[];
  source: string; // debug: which branch matched
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

function clampTitle(t: string, siteName: string): string {
  // Keep <=60 chars where possible
  const max = 60;
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trim() + "…";
}

function clampDesc(d: string): string {
  const max = 158;
  if (!d) return DEFAULT_DESC;
  const clean = d.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trim() + "…";
}

function buildCanonical(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean}`;
}

async function loadGlobals(): Promise<{
  global: any;
  pages: any[];
  schemas: any[];
}> {
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["seo_global", "seo_pages", "seo_schemas"]);
  const out: any = { global: {}, pages: [], schemas: [] };
  for (const row of data || []) {
    if (row.key === "seo_global") out.global = row.value || {};
    else if (row.key === "seo_pages") out.pages = Array.isArray(row.value) ? row.value : [];
    else if (row.key === "seo_schemas") out.schemas = Array.isArray(row.value) ? row.value : [];
  }
  return out;
}

function baseMeta(path: string, global: any): Metadata {
  return {
    title: global.default_title || DEFAULT_TITLE,
    description: global.default_description || DEFAULT_DESC,
    ogImage: global.default_og_image || "",
    ogType: "website",
    canonical: global.canonical_base
      ? `${global.canonical_base}${path}`
      : buildCanonical(path),
    noindex: false,
    jsonLd: [],
    source: "default",
  };
}

function applyTitleTemplate(pageTitle: string, global: any): string {
  const siteName = global.site_name || SITE_NAME_FALLBACK;
  const tpl = global.title_template || "%s | %s";
  if (tpl.includes("%s")) {
    // First %s = page, second %s = site
    let out = tpl.replace("%s", pageTitle);
    out = out.replace("%s", siteName);
    return out;
  }
  return `${pageTitle} | ${siteName}`;
}

function siteSchemas(globals: any[]): object[] {
  const out: object[] = [];
  for (const s of globals) {
    if (!s?.json) continue;
    try {
      out.push(JSON.parse(s.json));
    } catch { /* skip invalid */ }
  }
  return out;
}

// --------- Route resolvers ---------

async function resolveCompetition(slugOrId: string, meta: Metadata, global: any) {
  // Try slug first, then id
  let { data } = await supabase
    .from("competitions")
    .select("id, slug, title, description, cover_image_url, category, starts_at, ends_at, status")
    .eq("slug", slugOrId)
    .maybeSingle();
  if (!data) {
    const r = await supabase
      .from("competitions")
      .select("id, slug, title, description, cover_image_url, category, starts_at, ends_at, status")
      .eq("id", slugOrId)
      .maybeSingle();
    data = r.data;
  }
  if (!data) return false;
  meta.title = applyTitleTemplate(data.title, global);
  meta.description = clampDesc(data.description || `${data.title} — photo competition on ${SITE_NAME_FALLBACK}.`);
  if (data.cover_image_url) meta.ogImage = data.cover_image_url;
  meta.ogType = "website";
  meta.jsonLd = [{
    "@context": "https://schema.org",
    "@type": "Event",
    name: data.title,
    description: data.description || "",
    image: data.cover_image_url || "",
    url: meta.canonical,
    startDate: data.starts_at || "",
    endDate: data.ends_at || "",
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    organizer: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL },
  }];
  meta.source = "competition";
  return true;
}

async function resolveJournal(slug: string, meta: Metadata, global: any) {
  const { data } = await supabase
    .from("journal_articles")
    .select("id, slug, title, excerpt, cover_image_url, published_at, updated_at, author_id, tags, status")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return false;

  let authorName = "";
  if (data.author_id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, custom_url")
      .eq("id", data.author_id)
      .maybeSingle();
    authorName = (prof as any)?.full_name || "";
  }

  meta.title = applyTitleTemplate(data.title, global);
  meta.description = clampDesc(data.excerpt || `${data.title} — read on ${SITE_NAME_FALLBACK}.`);
  if (data.cover_image_url) meta.ogImage = data.cover_image_url;
  meta.ogType = "article";
  meta.jsonLd = [{
    "@context": "https://schema.org",
    "@type": "Article",
    headline: data.title,
    description: data.excerpt || "",
    image: data.cover_image_url || "",
    datePublished: data.published_at || "",
    dateModified: data.updated_at || data.published_at || "",
    url: meta.canonical,
    publisher: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL },
    ...(authorName ? { author: { "@type": "Person", name: authorName } } : {}),
    ...(Array.isArray(data.tags) && data.tags.length ? { keywords: data.tags.join(", ") } : {}),
  }];
  meta.source = "journal";
  return true;
}

async function resolveCourse(slug: string, meta: Metadata, global: any) {
  const { data } = await supabase
    .from("courses")
    .select("id, slug, title, description, cover_image_url, difficulty, status")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return false;
  meta.title = applyTitleTemplate(data.title, global);
  meta.description = clampDesc(data.description || `${data.title} — photography course on ${SITE_NAME_FALLBACK}.`);
  if (data.cover_image_url) meta.ogImage = data.cover_image_url;
  meta.jsonLd = [{
    "@context": "https://schema.org",
    "@type": "Course",
    name: data.title,
    description: data.description || "",
    image: data.cover_image_url || "",
    url: meta.canonical,
    provider: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL },
    ...(data.difficulty ? { educationalLevel: data.difficulty } : {}),
  }];
  meta.source = "course";
  return true;
}

async function resolveFeaturedArtist(slug: string, meta: Metadata, global: any) {
  const { data } = await supabase
    .from("featured_artists")
    .select("id, slug, title, artist_name, excerpt, cover_image_url, published_at, is_active")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return false;
  meta.title = applyTitleTemplate(data.title, global);
  meta.description = clampDesc(
    data.excerpt || `${data.artist_name || data.title} — featured artist on ${SITE_NAME_FALLBACK}.`
  );
  if (data.cover_image_url) meta.ogImage = data.cover_image_url;
  meta.ogType = "article";
  meta.jsonLd = [{
    "@context": "https://schema.org",
    "@type": "Article",
    headline: data.title,
    description: data.excerpt || "",
    image: data.cover_image_url || "",
    datePublished: data.published_at || "",
    url: meta.canonical,
    publisher: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL },
    ...(data.artist_name ? { author: { "@type": "Person", name: data.artist_name } } : {}),
  }];
  meta.source = "featured-artist";
  return true;
}

async function resolveManagedPage(slug: string, meta: Metadata, global: any) {
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "managed_pages")
    .maybeSingle();
  if (!data?.value || !Array.isArray(data.value)) return false;
  const page = (data.value as any[]).find((p) => p.slug === slug && p.is_published);
  if (!page) return false;
  meta.title = applyTitleTemplate(page.meta_title || page.title, global);
  meta.description = clampDesc(page.meta_description || "");
  if (page.og_image) meta.ogImage = page.og_image;
  if (page.noindex) meta.noindex = true;
  if (page.json_ld) {
    try { meta.jsonLd = [JSON.parse(page.json_ld)]; } catch { /* skip */ }
  }
  meta.source = "managed-page";
  return true;
}

async function resolveProfile(customUrl: string, meta: Metadata, global: any) {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, custom_url, bio, avatar_url, indexing_disabled")
    .eq("custom_url", customUrl)
    .maybeSingle();
  if (!data) return false;
  // SOW §5.3 — honor per-profile search engine opt-out
  if ((data as any).indexing_disabled === true) {
    meta.noindex = true;
  }
  const name = (data as any).full_name || customUrl;
  meta.title = applyTitleTemplate(name, global);
  meta.description = clampDesc(data.bio || `${name} on ${SITE_NAME_FALLBACK} — photographer profile.`);
  if (data.avatar_url) meta.ogImage = data.avatar_url;
  meta.jsonLd = [{
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: meta.canonical,
    mainEntity: {
      "@type": "Person",
      name,
      ...(data.bio ? { description: data.bio } : {}),
      ...(data.avatar_url ? { image: data.avatar_url } : {}),
    },
  }];
  meta.source = "profile";
  return true;
}

async function resolvePost(postId: string, meta: Metadata, global: any) {
  const { data } = await supabase
    .from("posts")
    .select("id, content, image_url, privacy, created_at, indexing_disabled, user_id")
    .eq("id", postId)
    .maybeSingle();
  if (!data) return false;
  // SOW §5.3 — only public posts are indexable; per-post opt-out forces noindex
  if (data.privacy !== "public" || (data as any).indexing_disabled === true) {
    meta.noindex = true;
  }
  const snippet = (data.content || "").replace(/\s+/g, " ").trim();
  if (snippet) meta.description = clampDesc(snippet);
  if (data.image_url) meta.ogImage = data.image_url;
  meta.ogType = "article";
  meta.source = "post";
  return true;
}

// --------- Main router ---------

async function resolve(path: string): Promise<Metadata> {
  const { global, pages, schemas } = await loadGlobals();
  const meta = baseMeta(path, global);

  // 1) Per-path override from site_settings.seo_pages
  // Admin-saved override titles in seo_pages are already final — do NOT re-apply title_template.
  const override = pages.find((p: any) => p.path === path);
  if (override) {
    if (override.title) meta.title = override.title;
    if (override.description) meta.description = clampDesc(override.description);
    if (override.og_image) meta.ogImage = override.og_image;
    if (override.noindex) meta.noindex = true;
    meta.source = "seo_pages-override";
  }

  // Strip query/hash, normalize trailing slash (except root)
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const segments = clean.split("/").filter(Boolean);

  // 2) Dynamic route resolvers
  try {
    if (segments[0] === "competitions" && segments[1]) {
      await resolveCompetition(segments[1], meta, global);
    } else if (segments[0] === "journal" && segments[1]) {
      await resolveJournal(segments[1], meta, global);
    } else if (segments[0] === "courses" && segments[1]) {
      await resolveCourse(segments[1], meta, global);
    } else if (segments[0] === "featured-artist" && segments[1]) {
      await resolveFeaturedArtist(segments[1], meta, global);
    } else if (segments[0] === "page" && segments[1]) {
      await resolveManagedPage(segments[1], meta, global);
    } else if ((segments[0] === "post" || segments[0] === "posts") && segments[1]) {
      await resolvePost(segments[1], meta, global);
    } else if (segments[0] === "profile" && segments[1]) {
      // /profile/:id — just use defaults; ID-based, hard to resolve cleanly
      meta.source = "profile-id-fallback";
    } else if (segments.length === 1) {
      // Single-segment path: could be /:customUrl OR a static page
      const STATIC_PATHS = new Set([
        "competitions", "journal", "courses", "featured-artist", "discover",
        "winners", "certificates", "auth", "login", "signup", "about",
        "privacy", "terms", "contact", "page", "404",
      ]);
      if (!STATIC_PATHS.has(segments[0])) {
        await resolveProfile(segments[0], meta, global);
      }
    }
  } catch (e) {
    console.error("[seo-route-metadata] resolver error:", (e as Error).message);
    // keep meta as-is (defaults or override)
  }

  // 3) Global JSON-LD schemas (only on default/home routes — like the SPA does)
  if (clean === "/" || meta.source === "default" || meta.source === "seo_pages-override") {
    const extras = siteSchemas(schemas);
    if (extras.length) meta.jsonLd = [...meta.jsonLd, ...extras];
  }

  return meta;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // Health check
  if (url.searchParams.get("health") === "1") {
    return new Response(
      JSON.stringify({ ok: true, function: "seo-route-metadata", time: new Date().toISOString() }),
      { headers: corsHeaders }
    );
  }

  // Accept ?path=/competitions/foo OR POST { path }
  let path = url.searchParams.get("path") || "/";
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (typeof body?.path === "string") path = body.path;
    } catch { /* ignore */ }
  }

  // Hard 5s budget
  const budget = new Promise<Metadata>((_, reject) =>
    setTimeout(() => reject(new Error("metadata-timeout")), 5000)
  );

  try {
    const meta = await Promise.race([resolve(path), budget]);
    return new Response(JSON.stringify(meta), {
      headers: {
        ...corsHeaders,
        // CDN-cache for 5 min, browser 1 min, allow stale for a day
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    console.error("[seo-route-metadata] fatal:", (e as Error).message);
    // Always return SOMETHING so the Worker never breaks the page
    const fallback: Metadata = {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESC,
      ogImage: "",
      ogType: "website",
      canonical: buildCanonical(path),
      noindex: false,
      jsonLd: [],
      source: "fallback-error",
    };
    return new Response(JSON.stringify(fallback), {
      headers: { ...corsHeaders, "Cache-Control": "no-store" },
      status: 200, // never fail the Worker
    });
  }
});
