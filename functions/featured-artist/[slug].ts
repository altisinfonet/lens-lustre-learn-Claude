import { sbGet, renderSeo, getShell, SITE, type SeoMeta } from "../_seo";

// Edge SEO for /featured-artist/:slug — Person JSON-LD + per-page meta.
export const onRequest = async (context: any) => {
  const res = await getShell(context.request);
  if (!(res.headers.get("content-type") || "").includes("text/html")) return context.next();

  const slug = decodeURIComponent(String(context.params?.slug || ""));
  if (!slug) return res;

  const a = await sbGet(
    `featured_artists?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true` +
      `&select=slug,title,artist_name,cover_image_url&limit=1`,
  );
  if (!a) return res;

  const canonical = `${SITE}/featured-artist/${a.slug}`;
  const name = a.artist_name || a.title;
  const description = `Featured photographer ${name} on 50mm Retina World — ${a.title}.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name,
    image: a.cover_image_url || undefined,
    url: canonical,
  };
  const meta: SeoMeta = {
    title: `${a.title} — Featured Artist | 50mm Retina World`,
    description,
    canonical,
    image: a.cover_image_url || undefined,
    type: "profile",
    jsonLd,
  };
  return renderSeo(res, meta);
};
