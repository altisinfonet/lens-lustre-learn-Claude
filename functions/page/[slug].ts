import {
  sbGet,
  renderSeo,
  getShell,
  stripHtml,
  site,
  supabaseUrl,
  serviceRoleKey,
  type SeoEnv,
  type SeoMeta,
} from "../_seo";

// Edge SEO for /page/:slug — managed CMS pages (about-us, privacy-policy, etc).
// These already carry their own meta_title / meta_description / og_image / json_ld
// in the site_settings.managed_pages JSON, so we use those directly.
//
// This route also owns the page's view counter — see incrementViewCount below.

/** The counter's own log prefix, so an operator can grep the edge log for it. */
const VIEW_COUNT_LOG_PREFIX = "[managed-page-view]";

/**
 * ── THE VIEW COUNTER, MOVED HERE FROM THE BROWSER. Ruling R-16. ──
 *
 * WHY IT MOVED. `increment_managed_page_view` was called from
 * `src/pages/ManagedPageView.tsx` by the visitor's own client, which meant the
 * grant had to be open to `anon` — a managed page is public, and the
 * signed-out visitor is the population it exists for. Owner Decision 3 was
 * never "should a public page count signed-out visitors" (yes, obviously) but
 * HOW, and of the three answers the P32 gate permits, requiring a session
 * defeats the feature. So: the edge counts, with `service_role`, and the
 * `anon` grant can be withdrawn without the counter noticing.
 *
 * SEQUENCING, WHICH IS NOT NEGOTIABLE. This lands and goes live on staging
 * FIRST; only then does D1 revoke `anon` on the function. Reversed, the client
 * call would start returning 42501 into a console warning that reaches no user
 * and fails no test — a silent stop, which is worse than a loud one.
 *
 * WHAT CHANGES ABOUT THE NUMBER ITSELF, stated rather than discovered later:
 *   · Ad blockers and privacy extensions used to suppress the client call
 *     entirely. Those visits are now counted. The number will step up.
 *   · Crawlers, social unfurlers and link previewers do not run JS and were
 *     never counted. They are now. The number includes non-human traffic, and
 *     that is a property of counting at the edge, not a defect in this code.
 *   · `renderSeo` returns `s-maxage=1800`, so a request the CDN serves from
 *     its own cache never reaches this function and is never counted. The
 *     counter is therefore bounded by cache misses, not by visits. Raised with
 *     the Auditor rather than fixed here: making the count exact means giving
 *     up edge caching on a public content route, which is a trade this unit
 *     was not asked to make.
 *
 * WHY IT CANNOT BREAK THE PAGE. The write is handed to `waitUntil`, so the
 * visitor's HTML is never waiting on it, and every failure path ends in one
 * log line at the edge. A view counter must never be able to break the page it
 * counts — that was true in the browser and it is true here.
 */
async function incrementViewCount(pageId: string, env: SeoEnv | undefined): Promise<void> {
  const key = serviceRoleKey(env);
  if (!key) {
    // Loud, and no anon-keyed retry. A lane with no service-role key cannot do
    // this write; pretending otherwise with the anon key would re-open by hand
    // exactly the grant this move exists to close.
    console.error(
      `${VIEW_COUNT_LOG_PREFIX} SUPABASE_SERVICE_ROLE_KEY is not set for this lane — ` +
      `view counts are NOT being recorded. Set it in the Pages project environment.`,
    );
    return;
  }

  try {
    const res = await fetch(`${supabaseUrl(env)}/rest/v1/rpc/increment_managed_page_view`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // PostgREST wants both: the key identifies the project, the JWT the role.
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ _page_id: pageId }),
    });
    if (!res.ok) {
      console.error(
        `${VIEW_COUNT_LOG_PREFIX} increment failed: ${res.status} ${await res.text()}`,
      );
    }
  } catch (cause) {
    const message =
      typeof cause === "object" && cause !== null && "message" in cause
        ? String((cause as { message?: unknown }).message)
        : String(cause);
    console.error(`${VIEW_COUNT_LOG_PREFIX} increment failed: ${message}`);
  }
}

export const onRequest = async (context: any) => {
  const SITE = site(context.env);
  const res = await getShell(context.request);
  if (!(res.headers.get("content-type") || "").includes("text/html")) return context.next();

  const slug = decodeURIComponent(String(context.params?.slug || ""));
  if (!slug) return res;

  const row = await sbGet(`site_settings?key=eq.managed_pages&select=value&limit=1`, context.env);
  const pages = row?.value;
  if (!Array.isArray(pages)) return res;
  const p = pages.find((x: any) => x && x.slug === slug && x.is_published && !x.noindex);
  if (!p) return res;

  // Count the view the same visit the page is served, without making the
  // visitor wait for it. Only a published page that was actually found is
  // counted — a 404 or an unpublished slug is not a page view.
  if (p.id) {
    const counted = incrementViewCount(String(p.id), context.env);
    if (typeof context.waitUntil === "function") context.waitUntil(counted);
  }

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
