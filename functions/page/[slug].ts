import { sbGet, renderSeo, getShell, stripHtml, SITE, type SeoMeta } from "../_seo";

// Edge SEO for /page/:slug — managed CMS pages (about-us, privacy-policy, etc).
// These already carry their own meta_title / meta_description / og_image / json_ld
// in the site_settings.managed_pages JSON, so we use those directly.
export const onRequest = async (context: any) => {
  const res = await getShell(context.request);
  if (!(res.headers.get("content-type") || "").includes("text/html")) return context.next();

  const slug = decodeURIComponent(String(context.params?.slug || ""));
  if (!slug) return res;

  const row = await sbGet(`site_settings?key=eq.managed_pages&select=value&limit=1`);
  const pages = row?.value;
  if (!Array.isArray(pages)) return res;
  const p = pages.find((x: any) => x && x.slug === slug && x.is_published && !x.noindex);
  if (!p) return res;

  const canonical = `${SITE}/page/${p.slug}`;
  const title = p.meta_title || p.title;
  const description = (p.meta_description || stripHtml(p.content || "").slice(0, 200)).trim();
  let jsonLd: Record<string, unknown> | undefined;
  if (p.json_ld) {
    try { jsonLd = typeof p.json_ld === "string" ? JSON.parse(p.json_ld) : p.json_ld; } catch { /* ignore */ }
  }
  const meta: SeoMeta = {
    title: `${title} — 50mm Retina World`,
    description,
    canonical,
    image: p.og_image || undefined,
    type: "website",
    jsonLd,
  };
  return renderSeo(res, meta);
};
