import { sbGet, renderSeo, getShell, stripHtml, SITE, type SeoMeta } from "../_seo";

// Edge SEO for /journal/:slug — injects the article's real title/description/OG +
// Article JSON-LD into the SPA shell so Google and social crawlers see complete HTML.
export const onRequest = async (context: any) => {
  const res = await getShell(context.request); // the built SPA shell (index.html)
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return context.next();

  const slug = decodeURIComponent(String((context.params as any).slug || ""));
  if (!slug) return res;

  const a = await sbGet(
    `journal_articles?slug=eq.${encodeURIComponent(slug)}&status=eq.published` +
      `&select=slug,title,excerpt,cover_image_url,published_at,tags,body&limit=1`,
  );
  if (!a) return res; // unknown/unpublished → let the SPA render (404 handled client-side)

  const canonical = `${SITE}/journal/${a.slug}`;
  const description = (a.excerpt || stripHtml(a.body || "").slice(0, 200)).trim();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description,
    image: a.cover_image_url || undefined,
    datePublished: a.published_at || undefined,
    keywords: Array.isArray(a.tags) ? a.tags.join(", ") : undefined,
    mainEntityOfPage: canonical,
    publisher: { "@type": "Organization", name: "50mm Retina World", url: SITE },
  };

  const meta: SeoMeta = {
    title: `${a.title} — 50mm Retina World`,
    description,
    canonical,
    image: a.cover_image_url || undefined,
    type: "article",
    jsonLd,
  };
  return renderSeo(res, meta);
};
