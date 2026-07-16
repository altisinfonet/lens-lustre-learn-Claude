import { useEffect } from "react";
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

/** Fire-and-forget view count increment — never blocks render.
 * BUG-066: bump only the target page's counter via a SECURITY DEFINER RPC.
 * The old approach rewrote the entire managed_pages blob through site_settings,
 * which admin-only RLS blocked for public visitors (so counts never moved) and
 * which let an admin visit overwrite newer edits from a stale cache. */
function incrementViewCount(pageId: string) {
  supabase.rpc("increment_managed_page_view", { _page_id: pageId }).then(() => {});
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

  const title = page.title;
  const content = page.content;
  const metaTitle = page.meta_title || title;
  const metaDesc = page.meta_description;
  const canonical = `${window.location.origin}/page/${page.slug}`;

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
