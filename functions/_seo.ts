/// <reference path="./pages-runtime.d.ts" />
// Shared SEO edge-rendering helpers for Cloudflare Pages Functions.
// These run only for content routes (functions/journal, functions/competitions);
// all other paths stay pure static assets (free/unlimited). Humans still get the
// full SPA — we only inject correct per-page <head> meta into the shell so crawlers
// and social unfurlers (which don't run JS) see complete, unique HTML.
//
// ⚠ LANE-DERIVED AT RUNTIME SINCE 2026-08-22. NO PRODUCTION DEFAULTS SINCE G5b.
//
// These three were literals pointing at production. A Pages Function deployed
// to any other lane would have read production's database and emitted
// production canonical URLs into that lane's crawlable HTML — the worst place
// for a wrong origin, because search engines keep it.
//
// Until G5b they merely DEFAULTED to production when unset, which is the same
// failure wearing a nicer coat: a lane that forgot to set them silently became
// production. They are now REQUIRED. Unset throws, set-but-empty throws, and
// the build-time guard scans this directory so a re-introduced literal fails
// the build rather than shipping.
//
// Pages Functions have no build step: `context.env` is the only lane signal
// they get, so every lane's Pages project MUST define all three:
//   SUPABASE_PROJECT_REF   SUPABASE_ANON_KEY   SITE_ORIGIN
export interface SeoEnv {
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_ANON_KEY?: string;
  SITE_ORIGIN?: string;
}

/**
 * Read one lane value from the Pages environment. There is deliberately no
 * default: an absent variable is a misconfigured lane, and guessing production
 * is precisely the bug this function exists to prevent.
 */
function laneValue(name: string, raw: unknown): string {
  if (raw === undefined || raw === null) {
    throw new Error(
      `${name} is not set. Pages Functions have no build step, so this must be ` +
      `defined in the Pages project's environment for this lane. There is no ` +
      `production default — falling back would silently make every lane production.`,
    );
  }
  const value = String(raw).trim();
  if (value === "") {
    throw new Error(
      `${name} is set but empty. An empty string is a configuration error, not a default.`,
    );
  }
  return value;
}

/** This lane's Supabase REST base, from the Pages environment. */
export function supabaseUrl(env: SeoEnv | undefined): string {
  return `https://${laneValue("SUPABASE_PROJECT_REF", env?.SUPABASE_PROJECT_REF)}.supabase.co`;
}

/** This lane's anon key, from the Pages environment. */
export function supabaseAnon(env: SeoEnv | undefined): string {
  return laneValue("SUPABASE_ANON_KEY", env?.SUPABASE_ANON_KEY);
}

/** This lane's public origin — what canonical URLs and JSON-LD must name. */
export function site(env: SeoEnv | undefined): string {
  return laneValue("SITE_ORIGIN", env?.SITE_ORIGIN).replace(/\/+$/, "");
}
export const DEFAULT_OG =
  "https://pub-f3e7af944f2746b7bb4fb6e679dd78de.r2.dev/site-assets/seo/1775321074863-k3b5rusybos.jpg";

export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * ⚠ THIS IS NOT esc(), AND IT MUST NOT BECOME esc().
 *
 * A JSON-LD payload is placed BETWEEN <script> tags, not into an attribute.
 * HTML-escaping it would put &quot; inside the JSON document and destroy it,
 * so the ten attribute sinks below use esc() and this one cannot.
 *
 * The defect being fixed: JSON.stringify does not escape `<`. A string field
 * whose value contains the sequence </script> therefore CLOSES the script
 * element, and everything after it is parsed by the browser as HTML. That is
 * the standard JSON-LD injection, and neither esc() nor stripHtml() is the
 * remedy -- stripHtml removes tag-shaped substrings and is not an escape at
 * all, so nothing must ever be relied on it here.
 *
 * Unicode escapes are the one fix that satisfies both grammars at once:
 * \u003c is valid JSON and a conforming parser reads it back as `<`, while
 * the HTML parser never sees a `<` and so cannot be made to close the
 * element. `>` and `&` are escaped by the same convention so that no bracket
 * or entity sequence can be reconstructed from the output.
 *
 * Threat model, stated so it is not over-read: meta.jsonLd originates from
 * database content whose writers are admin / content_editor. This is an
 * AUTHENTICATED-PRIVILEGED-ACTOR exposure, not an anonymous one. It is fixed
 * anyway -- the control exists to make a mistaken or deliberate write safe.
 */
export function escapeJsonLd(json: string): string {
  return String(json ?? "")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function stripHtml(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Fetch a single row from Supabase REST (public data via anon key).
export async function sbGet(path: string, env?: SeoEnv): Promise<any | null> {
  try {
    const anon = supabaseAnon(env);
    const r = await fetch(`${supabaseUrl(env)}/rest/v1/${path}`, {
      headers: { apikey: anon, authorization: `Bearer ${anon}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? (j[0] ?? null) : j;
  } catch {
    return null;
  }
}

// Fetch the built SPA shell (index.html) reliably, independent of SPA-fallback config.
export async function getShell(request: Request): Promise<Response> {
  const u = new URL(request.url);
  u.pathname = "/index.html";
  u.search = "";
  return fetch(u.toString(), { headers: { "x-seo-shell": "1" } });
}

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  type?: string;
  jsonLd?: Record<string, unknown>;
}

// Inject per-page SEO into the SPA shell's <head> via streaming HTMLRewriter.
export function renderSeo(response: Response, meta: SeoMeta): Response {
  const title = meta.title;
  const desc = (meta.description || "").slice(0, 300);
  const image = meta.image || DEFAULT_OG;
  const canonical = meta.canonical;
  const jsonLd = meta.jsonLd
    ? `<script type="application/ld+json">${escapeJsonLd(JSON.stringify(meta.jsonLd))}</script>`
    : "";
  const inject =
    `<meta property="og:title" content="${esc(title)}">` +
    `<meta property="og:description" content="${esc(desc)}">` +
    `<meta property="og:image" content="${esc(image)}">` +
    `<meta property="og:url" content="${esc(canonical)}">` +
    `<meta property="og:type" content="${esc(meta.type || "article")}">` +
    `<meta name="twitter:card" content="summary_large_image">` +
    `<meta name="twitter:title" content="${esc(title)}">` +
    `<meta name="twitter:description" content="${esc(desc)}">` +
    `<meta name="twitter:image" content="${esc(image)}">` +
    `<link rel="canonical" href="${esc(canonical)}">` +
    jsonLd;

  const rw = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", desc); } })
    // strip the static homepage og:/twitter: tags so the fresh ones don't duplicate
    .on('meta[property^="og:"]', { element(el) { el.remove(); } })
    .on('meta[name^="twitter:"]', { element(el) { el.remove(); } })
    .on("head", { element(el) { el.append(inject, { html: true }); } })
    .transform(response);

  const out = new Response(rw.body, rw);
  out.headers.set("Content-Type", "text/html; charset=utf-8");
  // Edge-cache the rewritten HTML (Phase 2 adds purge-on-publish for instant freshness).
  out.headers.set("Cache-Control", "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400");
  return out;
}
