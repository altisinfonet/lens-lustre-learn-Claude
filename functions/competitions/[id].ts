import { sbGet, renderSeo, getShell, stripHtml, SITE, type SeoMeta } from "../_seo";

// Edge SEO for /competitions/:id — injects the competition's real title/description/OG
// + Event JSON-LD into the SPA shell.
export const onRequest = async (context: any) => {
  const res = await getShell(context.request);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return context.next();

  const id = decodeURIComponent(String((context.params as any).id || ""));
  // Only treat UUID-shaped ids as competitions (the route also catches sub-paths).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return res;

  const c = await sbGet(
    `competitions?id=eq.${encodeURIComponent(id)}` +
      `&select=id,title,description,cover_image_url,category,status,starts_at,ends_at&limit=1`,
  );
  if (!c) return res;

  const canonical = `${SITE}/competitions/${c.id}`;
  const description = (stripHtml(c.description || "").slice(0, 200) ||
    `Enter the ${c.title} photography competition on 50mm Retina World.`).trim();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: c.title,
    description,
    image: c.cover_image_url || undefined,
    startDate: c.starts_at || undefined,
    endDate: c.ends_at || undefined,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: { "@type": "VirtualLocation", url: canonical },
    organizer: { "@type": "Organization", name: "50mm Retina World", url: SITE },
  };

  const meta: SeoMeta = {
    title: `${c.title} — Photography Competition | 50mm Retina World`,
    description,
    canonical,
    image: c.cover_image_url || undefined,
    type: "website",
    jsonLd,
  };
  return renderSeo(res, meta);
};
