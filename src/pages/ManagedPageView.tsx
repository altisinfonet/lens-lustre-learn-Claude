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

/* ── THE VIEW COUNTER NO LONGER LIVES HERE. Ruling R-16. ──
 *
 * This file used to call `increment_managed_page_view` from the visitor's own
 * client, which is why the grant had to be open to `anon`. It is now performed
 * at the edge, with `service_role`, in `functions/page/[slug].ts` — the Pages
 * Function already registered for this exact route. The reasoning, and what
 * changes about the number, are recorded there.
 *
 * Nothing replaces it here. A client-side "fallback" increment would be the
 * `anon` grant back again under another name, and the whole point of the move
 * is that the grant can be withdrawn.
 */

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
      return pages.find((p) => p.slug === slug && p.is_published) ?? null;
    },
    enabled: !!slug,
    staleTime: 10 * 60_000,
  });

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
