/**
 * seo-edge-injector — Cloudflare Worker
 * ---------------------------------------------------------------
 * Intercepts every request to 50mmretina.com, fetches the raw
 * HTML from ORIGIN_HOST (the Lovable .lovable.app backend),
 * asks the Supabase `seo-route-metadata` function for per-route
 * SEO metadata, and rewrites <head> on the fly.
 *
 * SAFETY:
 *   - ENABLE_REWRITE = "false" → observe-only mode (no HTML changes).
 *   - Any error or timeout → returns the original origin response untouched.
 *   - Static assets (JS/CSS/images/fonts) bypass injection entirely.
 *   - Hard 1.5s budget on metadata fetch; fail open.
 *
 * ENV BINDINGS (set in Cloudflare dashboard → Worker → Settings → Variables):
 *   ORIGIN_HOST          e.g. fiftymmretinaworld.lovable.app
 *   SUPABASE_PROJECT_REF e.g. isywidnfnjhtydmdfgtk
 *   ENABLE_REWRITE       "true" | "false"
 *   METADATA_FUNCTION_URL (optional; auto-built from PROJECT_REF if missing)
 */

const META_TIMEOUT_MS = 1500;

// Paths that should NEVER be rewritten (assets, API, sitemap, etc.)
const SKIP_PREFIXES = [
  "/assets/",
  "/static/",
  "/_app/",
  "/favicon",
  "/robots.txt",
  "/sitemap",
  "/manifest",
  "/api/",
  "/functions/",
  "/auth/v1/",
  "/rest/v1/",
  "/storage/v1/",
];

const SKIP_EXTENSIONS = [
  ".js", ".css", ".map", ".json", ".xml", ".txt",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp4", ".webm", ".mp3", ".wav", ".pdf", ".zip",
];

function shouldSkip(pathname) {
  const p = pathname.toLowerCase();
  if (SKIP_PREFIXES.some((pre) => p.startsWith(pre))) return true;
  if (SKIP_EXTENSIONS.some((ext) => p.endsWith(ext))) return true;
  return false;
}

function escapeHtml(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(s);
}

async function fetchMetadata(env, pathname) {
  const base =
    env.METADATA_FUNCTION_URL ||
    `https://${env.SUPABASE_PROJECT_REF}.functions.supabase.co/seo-route-metadata`;
  const url = `${base}?path=${encodeURIComponent(pathname)}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      cf: { cacheTtl: 300, cacheEverything: true },
      headers: { "accept": "application/json" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * HTMLRewriter handler that replaces existing meta/title tags
 * with values from the metadata payload, and appends JSON-LD.
 */
class HeadRewriter {
  constructor(meta) {
    this.meta = meta;
    this.removed = new Set();
  }

  // Strip existing tags we'll be replacing — match by selector below.
  element(element) {
    // <head> itself: append our block at the end
    if (element.tagName === "head") {
      const m = this.meta;
      const title = escapeHtml(m.title || "");
      const desc = escapeAttr(m.description || "");
      const ogImage = m.ogImage ? escapeAttr(m.ogImage) : "";
      const canonical = m.canonical ? escapeAttr(m.canonical) : "";
      const ogType = escapeAttr(m.ogType || "website");
      const robots = m.noindex ? "noindex, nofollow" : "index, follow";

      let html = "";
      html += `<title data-seo="edge">${title}</title>`;
      html += `<meta name="description" content="${desc}" data-seo="edge">`;
      html += `<meta name="robots" content="${robots}" data-seo="edge">`;
      if (canonical) {
        html += `<link rel="canonical" href="${canonical}" data-seo="edge">`;
        html += `<meta property="og:url" content="${canonical}" data-seo="edge">`;
      }
      html += `<meta property="og:title" content="${title}" data-seo="edge">`;
      html += `<meta property="og:description" content="${desc}" data-seo="edge">`;
      html += `<meta property="og:type" content="${ogType}" data-seo="edge">`;
      if (ogImage) {
        html += `<meta property="og:image" content="${ogImage}" data-seo="edge">`;
        html += `<meta name="twitter:image" content="${ogImage}" data-seo="edge">`;
      }
      html += `<meta name="twitter:card" content="summary_large_image" data-seo="edge">`;
      html += `<meta name="twitter:title" content="${title}" data-seo="edge">`;
      html += `<meta name="twitter:description" content="${desc}" data-seo="edge">`;

      if (Array.isArray(m.jsonLd)) {
        for (const obj of m.jsonLd) {
          try {
            // Safe JSON: HTMLRewriter inserts as raw, so escape </script
            const json = JSON.stringify(obj).replace(/</g, "\\u003c");
            html += `<script type="application/ld+json" data-seo="edge">${json}</script>`;
          } catch (_) { /* skip */ }
        }
      }

      element.append(html, { html: true });
    }
  }
}

/** Removes existing tags that we're going to replace, so we don't duplicate. */
class StripHandler {
  element(element) {
    element.remove();
  }
}

async function rewriteResponse(response, meta) {
  const rewriter = new HTMLRewriter()
    // Remove originals first
    .on("head > title", new StripHandler())
    .on('head > meta[name="description"]', new StripHandler())
    .on('head > meta[name="robots"]', new StripHandler())
    .on('head > link[rel="canonical"]', new StripHandler())
    .on('head > meta[property^="og:"]', new StripHandler())
    .on('head > meta[name^="twitter:"]', new StripHandler())
    // Then append new ones at the end of <head>
    .on("head", new HeadRewriter(meta));

  return rewriter.transform(response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Build origin URL — fetch raw HTML from Lovable backend
    const originUrl = new URL(url.pathname + url.search, `https://${env.ORIGIN_HOST}`);

    // 2) Forward request to origin, preserving method/headers/body
    const originReq = new Request(originUrl.toString(), request);
    // Make sure origin sees its own Host header (avoids loops/SNI issues)
    originReq.headers.set("host", env.ORIGIN_HOST);

    let originResponse;
    try {
      originResponse = await fetch(originReq);
    } catch (e) {
      return new Response("Bad gateway", { status: 502 });
    }

    // 3) Skip non-HTML, asset paths, non-GET, error responses
    const ct = originResponse.headers.get("content-type") || "";
    const isHtml = ct.toLowerCase().includes("text/html");
    if (
      request.method !== "GET" ||
      !isHtml ||
      shouldSkip(url.pathname) ||
      originResponse.status >= 400
    ) {
      return originResponse;
    }

    // 4) Observe-only mode: pass through, but log
    const enabled = (env.ENABLE_REWRITE || "false").toLowerCase() === "true";
    if (!enabled) {
      // Add a debug header so you can verify the Worker is in the path
      const passthrough = new Response(originResponse.body, originResponse);
      passthrough.headers.set("x-seo-edge", "observe");
      return passthrough;
    }

    // 5) Fetch metadata (with timeout). Fail open on any error.
    const meta = await fetchMetadata(env, url.pathname);
    if (!meta || !meta.title) {
      const passthrough = new Response(originResponse.body, originResponse);
      passthrough.headers.set("x-seo-edge", "fallback");
      return passthrough;
    }

    // 6) Rewrite HTML
    try {
      const rewritten = await rewriteResponse(originResponse, meta);
      const finalResp = new Response(rewritten.body, rewritten);
      finalResp.headers.set("x-seo-edge", `injected:${meta.source || "ok"}`);
      // Don't let the rewritten HTML be cached longer than 60s at edge
      // (metadata can change when admins edit content).
      finalResp.headers.set("cache-control", "public, max-age=0, s-maxage=60");
      return finalResp;
    } catch (_e) {
      // Last-resort fail-open
      const passthrough = new Response(originResponse.body, originResponse);
      passthrough.headers.set("x-seo-edge", "error");
      return passthrough;
    }
  },
};
