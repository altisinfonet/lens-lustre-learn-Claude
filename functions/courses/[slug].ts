import { sbGet, renderSeo, getShell, stripHtml, SITE, type SeoMeta } from "../_seo";

// Edge SEO for /courses/:slug — Course JSON-LD + per-page meta.
export const onRequest = async (context: any) => {
  const res = await getShell(context.request);
  if (!(res.headers.get("content-type") || "").includes("text/html")) return context.next();

  const slug = decodeURIComponent(String(context.params?.slug || ""));
  if (!slug) return res;

  const c = await sbGet(
    `courses?slug=eq.${encodeURIComponent(slug)}&status=eq.published` +
      `&select=slug,title,description,cover_image_url,category,difficulty&limit=1`,
  );
  if (!c) return res;

  const canonical = `${SITE}/courses/${c.slug}`;
  const description = (stripHtml(c.description || "").slice(0, 200) ||
    `Learn photography with the ${c.title} course on 50mm Retina World.`).trim();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: c.title,
    description,
    image: c.cover_image_url || undefined,
    provider: { "@type": "Organization", name: "50mm Retina World", url: SITE },
  };
  const meta: SeoMeta = {
    title: `${c.title} — Photography Course | 50mm Retina World`,
    description,
    canonical,
    image: c.cover_image_url || undefined,
    type: "website",
    jsonLd,
  };
  return renderSeo(res, meta);
};
