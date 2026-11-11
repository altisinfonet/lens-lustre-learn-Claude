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

import { canonicalOrigin } from "../_shared/laneConfig.ts"; // one address (A2)
import { isPostHandle, postPath } from "../_shared/postPath.ts"; // A3: one post-address rule
import { answersBody, captionTags, listBody, postBody, snippet } from "./readable.ts"; // B: readable pages
import { hashtagKey, hashtagPattern } from "../_shared/hashtagRule.ts"; // H1: one hashtag rule
import { ANSWERS, ANSWERS_INTRO, ANSWERS_TITLE, answerBySlug, faqJsonLd } from "../_shared/answers.ts"; // AEO: one answer list
const SITE_URL = () => canonicalOrigin();
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
  /** B: readable HTML for robots that do not run JavaScript (readable.ts). Public content only. */
  body?: string;
  /** B: 404 when the thing the address names does not exist (the middleware sends this status). */
  status?: number;
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
  return `${SITE_URL()}${clean}`;
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
    // One address (Owner 2026-11-09, A2): never seo_global.canonical_base.
    canonical: buildCanonical(path),
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

// The only competition statuses a member of the public may see. Copied
// deliberately from supabase/functions/sitemap/index.ts so the two public
// endpoints cannot drift apart and quietly disagree about what is public.
// A DRAFT competition is absent from this list and must stay unreachable.
const PUBLIC_COMPETITION_STATUSES = [
  "upcoming", "open", "submission_open", "judging", "result", "closed",
];

async function resolveCompetition(slugOrId: string, meta: Metadata, global: any) {
  // SECURITY, 2026-08-06: this endpoint is deliberately public (verify_jwt=false)
  // and holds the service-role key, so RLS does not protect it — the filter here
  // IS the protection. Without the status filter, a draft competition's title,
  // description, cover image and dates were readable by anyone who guessed its
  // slug. The journal-article path below always filtered correctly; this one did
  // not, which is exactly the kind of gap that survives because the endpoint
  // "obviously" only serves public pages.
  let { data } = await supabase
    .from("competitions")
    .select("id, slug, title, description, cover_image_url, category, starts_at, ends_at, status")
    .eq("slug", slugOrId)
    .in("status", PUBLIC_COMPETITION_STATUSES)
    .maybeSingle();
  if (!data) {
    const r = await supabase
      .from("competitions")
      .select("id, slug, title, description, cover_image_url, category, starts_at, ends_at, status")
      .eq("id", slugOrId)
      .in("status", PUBLIC_COMPETITION_STATUSES)
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
    organizer: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL() },
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
    publisher: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL() },
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
    provider: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL() },
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
    publisher: { "@type": "Organization", name: SITE_NAME_FALLBACK, url: SITE_URL() },
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
  if (!data) return false; // never 404 here: a one-segment path may be an app route (/feed, /explore …), not a member
  // SOW §5.3 — honor per-profile search engine opt-out
  if ((data as any).indexing_disabled === true) {
    meta.noindex = true;
  }
  const name = (data as any).full_name || customUrl;
  meta.title = applyTitleTemplate(name, global);
  meta.description = clampDesc(data.bio || `${name} on ${SITE_NAME_FALLBACK} — photographer profile.`);
  if (data.avatar_url) meta.ogImage = data.avatar_url;
  // B: a banned or suspended member's page is not offered to search.
  const moderated = await moderatedIds([(data as any).id]);
  if (moderated.length) {
    meta.noindex = true;
    meta.source = "profile-moderated";
    return true;
  }
  const items = (data as any).indexing_disabled === true ? [] : await publicPostItems({ userId: (data as any).id }, customUrl, 24);
  meta.title = applyTitleTemplate(`${name} (@${customUrl}) — photographer`, global);
  meta.jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      url: meta.canonical,
      mainEntity: {
        "@type": "Person",
        name,
        alternateName: `@${customUrl}`,
        url: meta.canonical,
        ...(data.bio ? { description: data.bio } : {}),
        ...(data.avatar_url ? { image: data.avatar_url } : {}),
      },
      ...(items.length ? {
        hasPart: items.map((it) => ({ "@type": "SocialMediaPosting", url: it.url, headline: it.title })),
      } : {}),
    },
    breadcrumbs([[SITE_NAME_FALLBACK, `${SITE_URL()}/`], [name, meta.canonical]]),
  ];
  meta.body = listBody("profile", `${name} (@${customUrl})`,
    data.bio ? String(data.bio) : `Photographer on ${SITE_NAME_FALLBACK}.`, items, SITE_URL());
  meta.source = "profile";
  return true;
}

async function resolvePost(postId: string, meta: Metadata, global: any) {
  const { data } = await supabase
    .from("posts")
    .select("id, content, image_url, privacy, created_at, indexing_disabled, user_id")
    .eq("id", postId)
    .maybeSingle();
  if (!data) { meta.status = 404; meta.noindex = true; meta.source = "post-missing"; return false; }
  // A3: the canonical is the long form /<handle>/post/<id> whenever the author
  // has a valid handle (same rule as src/lib/posts/postPath.ts), so /post/<id>
  // and an old handle both consolidate onto one address.
  const { data: author } = await supabase
    .from("profiles")
    .select("custom_url")
    .eq("id", (data as any).user_id)
    .maybeSingle();
  const handle = (author as any)?.custom_url ?? null;
  meta.canonical = `${SITE_URL()}${postPath(data.id, handle)}`;
  meta.ogType = "article";
  meta.source = "post";
  // SOW §5.3 — only public posts are indexable; per-post opt-out forces noindex.
  // B: a post that is NOT public gives away nothing — no caption, no photo
  // address (this function reads with the service role, so it must check).
  if (data.privacy !== "public") {
    meta.noindex = true;
    meta.source = "post-not-public";
    return true;
  }
  if ((data as any).indexing_disabled === true) meta.noindex = true;
  const moderated = await moderatedIds([data.user_id]);
  if (moderated.length) {
    meta.noindex = true;
    meta.source = "post-author-moderated";
    return true;
  }

  const [{ data: who }, { count: likes }, { count: comments }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", data.user_id).maybeSingle(),
    supabase.from("post_reactions").select("post_id", { count: "exact", head: true }).eq("post_id", data.id),
    supabase.from("post_comments").select("post_id", { count: "exact", head: true }).eq("post_id", data.id),
  ]);
  const name = (who as any)?.full_name || (handle ? `@${handle}` : "a photographer");
  const caption = (data.content || "").trim();
  const tags = captionTags(caption);
  const authorUrl = isPostHandle(handle) ? `${SITE_URL()}/${handle}` : undefined;

  meta.title = clampTitle(
    caption ? `${name}: “${snippet(caption.replace(hashtagPattern(), ""), 48)}”` : `Photo by ${name}`,
    global.site_name || SITE_NAME_FALLBACK,
  ) + ` | ${SITE_NAME_FALLBACK}`;
  meta.description = clampDesc(caption ? `Photo by ${name} on ${SITE_NAME_FALLBACK}: ${caption}` : `Photo by ${name} on ${SITE_NAME_FALLBACK}.`);
  if (data.image_url) meta.ogImage = data.image_url;

  const person = { "@type": "Person", name, ...(authorUrl ? { url: authorUrl } : {}) };
  meta.jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SocialMediaPosting",
      "@id": meta.canonical,
      url: meta.canonical,
      headline: snippet(caption, 110) || `Photo by ${name}`,
      ...(caption ? { articleBody: caption } : {}),
      datePublished: data.created_at,
      author: person,
      ...(data.image_url ? {
        image: {
          "@type": "ImageObject",
          contentUrl: data.image_url,
          creator: person,
          creditText: name,
          copyrightNotice: `© ${name}`,
          ...(caption ? { caption: snippet(caption, 200) } : {}),
        },
      } : {}),
      ...(tags.length ? { keywords: tags.map((t) => `#${t}`).join(", ") } : {}),
      interactionStatistic: [
        { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: likes ?? 0 },
        { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: comments ?? 0 },
      ],
      isPartOf: { "@type": "WebSite", name: SITE_NAME_FALLBACK, url: SITE_URL() },
    },
    breadcrumbs([
      [SITE_NAME_FALLBACK, `${SITE_URL()}/`],
      ...(authorUrl ? [[name, authorUrl] as [string, string]] : []),
      ["Photo", meta.canonical],
    ]),
  ];
  meta.body = postBody({
    url: meta.canonical, path: postPath(data.id, handle), author: name, authorUrl, caption,
    image: data.image_url || undefined, date: data.created_at, likes: likes ?? 0, comments: comments ?? 0, tags,
  }, SITE_URL());
  return true;
}

/**
 * B: banned or suspended members (same rule as public.filter_moderated_user_ids),
 * read straight from the profiles_public_data view — a read, never an rpc, in an
 * open function holding the service role.
 */
async function moderatedIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles_public_data").select("id, is_banned, is_suspended").in("id", ids);
  return ((data ?? []) as any[]).filter((p) => p.is_banned || p.is_suspended).map((p) => p.id);
}

function breadcrumbs(items: Array<[string, string]>): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
  };
}

/** Recent public posts of one author (or of a list of ids), newest first, as list items. */
async function publicPostItems(filter: { userId?: string; ids?: string[] }, handle: string | null, limit: number) {
  let q = supabase.from("posts").select("id, content, image_url, user_id, created_at")
    .eq("privacy", "public").eq("indexing_disabled", false)
    .order("created_at", { ascending: false }).limit(limit);
  if (filter.userId) q = q.eq("user_id", filter.userId);
  if (filter.ids) q = q.in("id", filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data: rows } = await q;
  const list = (rows ?? []) as any[];
  const handles = new Map<string, { h: string | null; n: string }>();
  const ids = [...new Set(list.map((r) => r.user_id))];
  if (ids.length) {
    const { data: ps } = await supabase.from("profiles").select("id, custom_url, full_name").in("id", ids);
    for (const p of (ps ?? []) as any[]) handles.set(p.id, { h: p.custom_url ?? null, n: p.full_name || "" });
  }
  const hidden = new Set(await moderatedIds(ids));
  return list.filter((r) => !hidden.has(r.user_id)).map((r) => {
    const a = handles.get(r.user_id);
    const by = a?.n || (a?.h ? `@${a.h}` : "a photographer");
    const cap = snippet((r.content || "").trim(), 90);
    return {
      url: `${SITE_URL()}${postPath(r.id, handle ?? a?.h ?? null)}`,
      title: cap ? `${cap} — photo by ${by}` : `Photo by ${by}`,
      image: r.image_url || undefined,
    };
  });
}

async function resolveHashtag(raw: string, meta: Metadata, global: any) {
  // H1: tags in every language (one rule, _shared/hashtagRule.ts).
  const tag = hashtagKey(raw);
  if (!tag) { meta.status = 404; meta.noindex = true; meta.source = "hashtag-invalid"; return false; }
  const { data: h } = await supabase.from("hashtags")
    .select("id, tag, display_tag, unique_user_count, post_count").eq("tag", tag).maybeSingle();
  if (!h || !(h as any).post_count) { meta.status = 404; meta.noindex = true; meta.source = "hashtag-missing"; return false; }
  const { data: links } = await supabase.from("post_hashtags").select("post_id")
    .eq("hashtag_id", (h as any).id).order("post_created_at", { ascending: false }).limit(60);
  const items = await publicPostItems({ ids: ((links ?? []) as any[]).map((l) => l.post_id) }, null, 24);
  const shown = `#${(h as any).display_tag || tag}`;
  const people = (h as any).unique_user_count ?? 0;
  meta.title = clampTitle(`${shown} — ${people} photographer${people === 1 ? "" : "s"}`, global.site_name || SITE_NAME_FALLBACK) + ` | ${SITE_NAME_FALLBACK}`;
  meta.description = clampDesc(`${shown} photography on ${SITE_NAME_FALLBACK}: ${(h as any).post_count} posts by ${people} photographer${people === 1 ? "" : "s"}.`);
  if (items[0]?.image) meta.ogImage = items[0].image;
  if (!items.length) meta.noindex = true; // nothing public to show
  meta.jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      url: meta.canonical,
      name: `${shown} on ${SITE_NAME_FALLBACK}`,
      about: { "@type": "Thing", name: shown },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: items.length,
        itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: it.url, name: it.title })),
      },
    },
    breadcrumbs([[SITE_NAME_FALLBACK, `${SITE_URL()}/`], [shown, meta.canonical]]),
  ];
  meta.body = listBody("hashtag", `${shown} photography`,
    `${(h as any).post_count} posts by ${people} photographer${people === 1 ? "" : "s"} on ${SITE_NAME_FALLBACK}.`, items, SITE_URL());
  meta.source = "hashtag";
  return true;
}

/** AEO (Owner 2026-11-10): /help and /help/<slug> — no database, the one answer list. */
function resolveHelp(slug: string | undefined, meta: Metadata) {
  const site = SITE_URL();
  const one = slug ? answerBySlug(slug) : undefined;
  if (slug && !one) { meta.status = 404; meta.noindex = true; meta.source = "help-missing"; return; }
  const items = one ? [one] : ANSWERS;
  meta.title = `${clampTitle(one ? one.question : ANSWERS_TITLE, SITE_NAME_FALLBACK)} | ${SITE_NAME_FALLBACK}`;
  meta.description = clampDesc(one ? one.answer.join(" ") : ANSWERS_INTRO);
  const crumbs: Array<[string, string]> = [[SITE_NAME_FALLBACK, `${site}/`], [ANSWERS_TITLE, `${site}/help`]];
  if (one) crumbs.push([one.question, meta.canonical]);
  meta.jsonLd = [faqJsonLd(items, site), breadcrumbs(crumbs)];
  meta.body = one
    ? answersBody(one.question, "", [one], ANSWERS.filter((a) => a.slug !== one.slug), site)
    : answersBody(ANSWERS_TITLE, ANSWERS_INTRO, ANSWERS, [], site);
  meta.source = one ? "help-answer" : "help";
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
    } else if (segments[0] === "hashtag" && segments[1] && segments.length === 2) {
      await resolveHashtag(segments[1], meta, global); // B: hashtag pages readable
    } else if (segments[0] === "help" && segments.length <= 2) {
      resolveHelp(segments[1], meta); // AEO answer pages
    } else if (segments.length === 3 && segments[1] === "post" && segments[2]) {
      // A3 (Owner 7 Nov): /<handle>/post/<id>, the long form of every post address.
      await resolvePost(segments[2], meta, global);
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
