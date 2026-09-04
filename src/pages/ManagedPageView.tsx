import { useEffect } from "react";
import { publicUrl } from "@/lib/publicUrl";
import { useParams, Navigate } from "react-router-dom";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageSEO from "@/components/PageSEO";
import { Loader2 } from "lucide-react";


interface ManagedPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  meta_title: string;
  meta_description: string;
  og_image: string;
  noindex: boolean;
  is_published: boolean;
  view_count: number;
  json_ld: string;
  translations: Record<string, { title: string; content: string; meta_title: string; meta_description: string }>;
}

const bodyFont = { fontFamily: "var(--font-body)" };

/** The counter's own log prefix, so an operator can grep for it and so its
 *  tests can tell this warning apart from unrelated console noise. */
const VIEW_COUNT_LOG_PREFIX = "[managed-page-view]";

/** One line per failed increment. Not rate-limited on purpose: this fires once
 *  per page navigation, not on a timer, so there is no flood to suppress — and
 *  suppressing repeats would hide the SCALE of an outage, which is the thing
 *  worth seeing. */
function warnViewCountFailed(cause: unknown) {
  const message =
    typeof cause === "object" && cause !== null && "message" in cause
      ? String((cause as { message?: unknown }).message)
      : String(cause);
  console.warn(`${VIEW_COUNT_LOG_PREFIX} view count increment failed:`, message);
}

/** Fire-and-forget view count increment — never blocks render.
 * BUG-066: bump only the target page's counter via a SECURITY DEFINER RPC.
 * The old approach rewrote the entire managed_pages blob through site_settings,
 * which admin-only RLS blocked for public visitors (so counts never moved) and
 * which let an admin visit overwrite newer edits from a stale cache.
 *
 * P31: this used to be `.then(() => {})` — no handler of any kind, on a PUBLIC
 * page. Measured from the installed @supabase/postgrest-js: PostgrestBuilder
 * .then() attaches its own .catch() whenever throwOnError() was not called (it
 * is not called here), and that catch RETURNS a resolved
 * `{ data: null, error, status: 0 }`. So a withdrawn grant does not crash the
 * page — it resolves with `error.code = "42501"`, and the empty callback threw
 * that on the floor. The counter would have stopped working permanently with
 * nothing to notice it by.
 *
 * So both halves are handled, and neither is allowed to reach the visitor:
 * the resolved-error path is the one a revoke actually takes, and the rejection
 * handler covers the rejecting path that becomes reachable if this call site is
 * ever given .throwOnError() or the client throws before the builder is reached.
 * A view counter must never be able to break the page it counts. */
function incrementViewCount(pageId: string) {
  // Two-argument .then, not .then().catch(): PostgrestBuilder.then() is typed
  // PromiseLike<T>, which has no .catch(). Passing the rejection handler as the
  // second argument covers the same path and typechecks.
  void supabase
    .rpc("increment_managed_page_view", { _page_id: pageId })
    .then(
      ({ error }) => {
        if (error) warnViewCountFailed(error);
      },
      (cause: unknown) => {
        warnViewCountFailed(cause);
      },
    );
}

const ManagedPageView = () => {
  const { slug } = useParams<{ slug: string }>();

  // Phase-3: on-demand fetch of full page by slug.
  // dashboard-init no longer seeds full managed_pages payload — it ships
  // metadata-only for the footer. We hit site_settings here only when the
  // route is actually visited.
  const { data: page, isLoading } = useQuery<ManagedPage | null>({
    queryKey: ["managed-page", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "managed_pages")
        .maybeSingle();
      if (!data?.value || !Array.isArray(data.value)) return null;
      const pages = data.value as unknown as ManagedPage[];
      const found = pages.find((p) => p.slug === slug && p.is_published) ?? null;
      // Fire-and-forget view count increment using the full payload we just fetched.
      if (found) incrementViewCount(found.id);
      return found;
    },
    enabled: !!slug,
    staleTime: 10 * 60_000,
  });

  // No-op effect kept for symmetry — view_count fires inside queryFn so it
  // only runs once per fetch (not on every render).
  useEffect(() => {}, [page?.id]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!page) {
    return <Navigate to="/404" replace />;
  }

  // BUG-090: honor the visitor's selected language — use the stored per-page
  // translation when one exists, falling back to the default-locale fields.
  const lang =
    (typeof localStorage !== "undefined" && localStorage.getItem("preferred_translate_lang")) || "en";
  const tr = page.translations ? page.translations[lang] : undefined;
  const title = tr?.title || page.title;
  const content = tr?.content || page.content;
  const metaTitle = tr?.meta_title || page.meta_title || title;
  const metaDesc = tr?.meta_description || page.meta_description;
  const canonical = publicUrl(`/page/${page.slug}`);

  let jsonLdScript: string | null = null;
  if (page.json_ld) {
    try {
      JSON.parse(page.json_ld);
      jsonLdScript = page.json_ld;
    } catch {
      // Invalid JSON-LD, skip
    }
  }

  return (
    <div className="py-10 md:py-16">
      <PageSEO
        title={metaTitle}
        description={metaDesc || undefined}
        ogImage={page.og_image || undefined}
        rawJsonLd={jsonLdScript || undefined}
      />
      <article className="max-w-3xl">
        <div
          className="prose prose-sm md:prose-base max-w-none text-foreground
            [&_h1]:text-2xl [&_h1]:md:text-3xl [&_h1]:font-light [&_h1]:tracking-tight [&_h1]:mb-6
            [&_h2]:text-xl [&_h2]:font-light [&_h2]:mt-8 [&_h2]:mb-4
            [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mt-6 [&_h3]:mb-3
            [&_p]:text-sm [&_p]:md:text-base [&_p]:leading-relaxed [&_p]:mb-4 [&_p]:text-foreground/80
            [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4
            [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4
            [&_li]:text-sm [&_li]:md:text-base [&_li]:mb-1.5 [&_li]:text-foreground/80
            [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
            [&_strong]:text-foreground [&_strong]:font-semibold
            [&_em]:italic
            [&_img]:max-w-full [&_img]:rounded-sm [&_img]:my-4
            [&_hr]:my-8 [&_hr]:border-border
            [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground"
          style={bodyFont}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
        />
      </article>
    </div>
  );
};

export default ManagedPageView;
