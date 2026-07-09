import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCookieConsent } from "@/hooks/core/useCookieConsent";
import { Cookie } from "lucide-react";

const bodyFont = { fontFamily: "var(--font-body)" };

interface FooterPage {
  id: string;
  title: string;
  slug: string;
  is_published: boolean;
  nav_placement: string;
}

const SiteFooter = () => {
  const { setShowPreferences } = useCookieConsent();

  // dashboard-init pre-seeds ["footer-pages"] — this queryFn is a fallback only
  const { data: footerPages = [] } = useQuery<FooterPage[]>({
    queryKey: ["footer-pages"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "managed_pages")
        .maybeSingle();
      if (!data?.value || !Array.isArray(data.value)) return [];
      return (data.value as unknown as FooterPage[]).filter(
        (p) => p.is_published && (p.nav_placement === "footer" || p.nav_placement === "both")
      );
    },
    staleTime: 30 * 60_000, // 30 min — pre-seeded by dashboard-init
  });

  return (
    <footer className="border-t border-border/40 bg-card/50 backdrop-blur-sm mt-auto" style={bodyFont}>
      <div className="container mx-auto px-4 py-2.5 pb-14 lg:pb-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <Link to="/" className="font-semibold tracking-[0.15em] uppercase text-foreground/80 hover:text-primary transition-colors text-[11px]">
          50mm Retina
        </Link>

        <span className="text-border hidden sm:inline">|</span>

        {footerPages.map((page) => (
          <Link
            key={page.id}
            to={`/page/${page.slug}`}
            className="hover:text-primary transition-colors"
          >
            {page.title}
          </Link>
        ))}

        <Link to="/cookie-policy" className="hover:text-primary transition-colors">
          Cookie Policy
        </Link>

        <button
          onClick={() => setShowPreferences(true)}
          className="inline-flex items-center gap-1 hover:text-primary transition-colors"
        >
          <Cookie className="w-3 h-3" />
          Cookies
        </button>

        <span className="text-border hidden sm:inline">|</span>

        <span className="text-muted-foreground/50">
          © {new Date().getFullYear()} 50mm Retina World
        </span>
      </div>
    </footer>
  );
};

export default SiteFooter;
