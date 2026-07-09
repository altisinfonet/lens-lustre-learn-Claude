// SEO Crawler Verification — Loop E
// Two responsibilities:
//   1) Domain-level: HTML + /favicon.ico hash drift across all production hosts.
//   2) Per-route: bot vs default UA <head> diff, JSON-LD validity, OG preview.
//      This proves Loop D's Cloudflare Worker is rewriting <head> for crawlers
//      and that seo-route-metadata is producing valid structured data.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const TARGETS = [
  "https://50mmretina.com",
  "https://www.50mmretina.com",
  "https://fiftymmretinaworld.lovable.app",
];

// Sample one URL per route family — covers every shape the SOW cares about.
// Keep the list small so a full run finishes well under the 60s edge budget.
const ROUTE_SAMPLES: { path: string; family: string }[] = [
  { path: "/", family: "home" },
  { path: "/competitions", family: "competitions-list" },
  { path: "/journal", family: "journal-list" },
  { path: "/courses", family: "courses-list" },
  { path: "/winners", family: "winners" },
  { path: "/discover", family: "discover" },
];

const BOT_UA = "Googlebot/2.1 (+http://www.google.com/bot.html)";
const HUMAN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractTags(html: string) {
  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? m[0] : null;
  };
  const all = (re: RegExp) => {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) out.push(m[0]);
    return out;
  };
  return {
    title: pick(/<title>[^<]*<\/title>/i),
    canonical: pick(/<link[^>]+rel=["']canonical["'][^>]*>/i),
    description: pick(/<meta[^>]+name=["']description["'][^>]*>/i),
    robots: pick(/<meta[^>]+name=["']robots["'][^>]*>/i),
    ogTitle: pick(/<meta[^>]+property=["']og:title["'][^>]*>/i),
    ogDescription: pick(/<meta[^>]+property=["']og:description["'][^>]*>/i),
    ogImage: pick(/<meta[^>]+property=["']og:image["'][^>]*>/i),
    ogType: pick(/<meta[^>]+property=["']og:type["'][^>]*>/i),
    ogUrl: pick(/<meta[^>]+property=["']og:url["'][^>]*>/i),
    twitterCard: pick(/<meta[^>]+name=["']twitter:card["'][^>]*>/i),
    iconLinks: all(/<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi),
    manifest: pick(/<link[^>]+rel=["']manifest["'][^>]*>/i),
    jsonLd: all(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi).length,
  };
}

// Pull the attribute value out of a meta/link tag string ("<meta ... content='X' />").
function attrValue(tag: string | null, attr: string): string | null {
  if (!tag) return null;
  const re = new RegExp(`${attr}=["']([^"']*)["']`, "i");
  const m = tag.match(re);
  return m ? m[1] : null;
}

function extractJsonLdBlocks(html: string): { raw: string; valid: boolean; type?: string; error?: string }[] {
  const blocks: { raw: string; valid: boolean; type?: string; error?: string }[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const type = Array.isArray(parsed)
        ? parsed.map((p) => p["@type"]).filter(Boolean).join(",")
        : (parsed["@type"] || "(no @type)");
      blocks.push({ raw: raw.length > 1500 ? raw.slice(0, 1500) + "…" : raw, valid: true, type });
    } catch (e) {
      blocks.push({ raw: raw.slice(0, 500), valid: false, error: (e as Error).message });
    }
  }
  return blocks;
}

async function fetchAs(url: string, ua: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": ua },
    redirect: "follow",
  });
  const html = await res.text();
  return {
    status: res.status,
    finalUrl: res.url,
    bytes: html.length,
    sha256: await sha256Hex(new TextEncoder().encode(html).buffer),
    tags: extractTags(html),
    jsonLd: extractJsonLdBlocks(html),
  };
}

async function inspectDomain(origin: string) {
  const result: Record<string, unknown> = { origin };
  try {
    const htmlRes = await fetch(origin, {
      headers: { "User-Agent": BOT_UA },
      redirect: "follow",
    });
    const html = await htmlRes.text();
    result.html = {
      status: htmlRes.status,
      finalUrl: htmlRes.url,
      bytes: html.length,
      sha256: await sha256Hex(new TextEncoder().encode(html).buffer),
      tags: extractTags(html),
    };
  } catch (e) {
    result.html = { error: (e as Error).message };
  }
  try {
    const favRes = await fetch(`${origin}/favicon.ico`, {
      headers: { "User-Agent": "Googlebot-Image/1.0" },
      redirect: "follow",
    });
    const buf = await favRes.arrayBuffer();
    result.favicon = {
      status: favRes.status,
      finalUrl: favRes.url,
      bytes: buf.byteLength,
      contentType: favRes.headers.get("content-type"),
      etag: favRes.headers.get("etag"),
      lastModified: favRes.headers.get("last-modified"),
      cacheControl: favRes.headers.get("cache-control"),
      sha256: await sha256Hex(buf),
    };
  } catch (e) {
    result.favicon = { error: (e as Error).message };
  }
  return result;
}

async function inspectRoute(origin: string, path: string, family: string) {
  const url = `${origin}${path}`;
  const out: Record<string, unknown> = { origin, path, family, url };
  try {
    const [bot, human] = await Promise.all([fetchAs(url, BOT_UA), fetchAs(url, HUMAN_UA)]);
    out.bot = bot;
    out.human = human;
    // Diff signals — what changed between the two responses.
    out.diff = {
      headDiffers: bot.sha256 !== human.sha256,
      titleChanged: bot.tags.title !== human.tags.title,
      canonicalChanged: bot.tags.canonical !== human.tags.canonical,
      ogImageChanged: bot.tags.ogImage !== human.tags.ogImage,
      jsonLdCountDelta: bot.tags.jsonLd - human.tags.jsonLd,
    };
    // OG preview card the bot would render (Facebook/LinkedIn/Twitter scrape this).
    out.ogPreview = {
      title: attrValue(bot.tags.ogTitle, "content") || attrValue(bot.tags.title?.replace(/<\/?title>/gi, "<meta content='" + (bot.tags.title?.replace(/<\/?title>/gi, "") ?? "") + "'>") ?? null, "content") || null,
      description: attrValue(bot.tags.ogDescription, "content"),
      image: attrValue(bot.tags.ogImage, "content"),
      url: attrValue(bot.tags.ogUrl, "content"),
      type: attrValue(bot.tags.ogType, "content"),
      twitterCard: attrValue(bot.tags.twitterCard, "content"),
    };
    // JSON-LD validation summary
    const allBlocks = bot.jsonLd;
    out.jsonLdSummary = {
      total: allBlocks.length,
      valid: allBlocks.filter((b) => b.valid).length,
      invalid: allBlocks.filter((b) => !b.valid).length,
      types: allBlocks.filter((b) => b.valid).map((b) => b.type),
      errors: allBlocks.filter((b) => !b.valid).map((b) => b.error),
    };
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    return new Response(
      JSON.stringify({ ok: true, function: "seo-crawler-verify", time: new Date().toISOString() }),
      { headers: corsHeaders }
    );
  }

  // --- SECURITY: admin JWT gate (non-health paths) ---
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const { data: role } = await admin
      .from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: corsHeaders });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  // Optional ?mode=routes runs only the per-route inspection (faster).
  // Optional ?mode=domains runs only the favicon/HTML domain check.
  // Default runs both.
  const mode = url.searchParams.get("mode") || "all";
  const originParamRaw = url.searchParams.get("origin");
  // --- SECURITY: SSRF allowlist — only known production origins permitted ---
  let originParam: string | null = null;
  if (originParamRaw) {
    if (!TARGETS.includes(originParamRaw)) {
      return new Response(
        JSON.stringify({ error: "origin not in allowlist", allowed: TARGETS }),
        { status: 400, headers: corsHeaders }
      );
    }
    originParam = originParamRaw;
  }


  try {
    const tasks: Promise<unknown>[] = [];
    let domainReports: any[] = [];
    let routeReports: any[] = [];

    if (mode === "all" || mode === "domains") {
      tasks.push(
        Promise.all(TARGETS.map(inspectDomain)).then((r) => {
          domainReports = r;
        })
      );
    }
    if (mode === "all" || mode === "routes") {
      const origins = originParam ? [originParam] : [TARGETS[0]]; // canonical host only by default
      const work: Promise<unknown>[] = [];
      for (const origin of origins) {
        for (const sample of ROUTE_SAMPLES) {
          work.push(
            inspectRoute(origin, sample.path, sample.family).then((r) => {
              routeReports.push(r);
            })
          );
        }
      }
      tasks.push(Promise.all(work));
    }

    await Promise.all(tasks);

    const faviconHashes = new Set(
      domainReports
        .map((r) => (r.favicon as { sha256?: string } | undefined)?.sha256)
        .filter(Boolean) as string[]
    );

    const headDiffCount = routeReports.filter((r) => r.diff?.headDiffers).length;
    const invalidJsonLdCount = routeReports.reduce(
      (sum, r) => sum + (r.jsonLdSummary?.invalid || 0),
      0
    );

    const summary = {
      generatedAt: new Date().toISOString(),
      mode,
      faviconConsistentAcrossDomains: faviconHashes.size <= 1,
      uniqueFaviconHashes: Array.from(faviconHashes),
      perRoute: {
        sampled: routeReports.length,
        botRewriteDetected: headDiffCount > 0,
        rewrittenCount: headDiffCount,
        jsonLdInvalidCount: invalidJsonLdCount,
      },
      googlebotWillFetchNext: {
        html: TARGETS.map((t) => `${t}/`),
        favicon: TARGETS.map((t) => `${t}/favicon.ico`),
      },
    };
    return new Response(
      JSON.stringify({ summary, reports: domainReports, routes: routeReports }, null, 2),
      { headers: corsHeaders }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
