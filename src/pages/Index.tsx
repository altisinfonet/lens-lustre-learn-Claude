import { Camera, ArrowRight, ArrowDown, Aperture, Eye, Layers, User, Rss, Users, Globe, MessageCircle, Facebook, Instagram, Twitter, Youtube, Linkedin, Github, Music2, MapPin, Phone as PhoneIcon, Send as SendIcon, Trophy } from "lucide-react";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import PageSEO from "@/components/PageSEO";
import { Link, useNavigate } from "react-router-dom";
import { motion, type Variants, useScroll, useMotionValueEvent } from "framer-motion";
import { useEffect, useState, useCallback, lazy, Suspense, memo, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useInView } from "framer-motion";
const Lightbox = lazy(() => import("@/components/Lightbox"));
const PhotoOfTheDay = lazy(() => import("@/components/PhotoOfTheDay"));
const FeaturedArtist = lazy(() => import("@/components/FeaturedArtist"));
const GalleryMagazine = lazy(() => import("@/components/gallery/GalleryMagazine"));
const GalleryBento = lazy(() => import("@/components/gallery/GalleryBento"));
const GalleryClassic = lazy(() => import("@/components/gallery/GalleryClassic"));
const GalleryMasonry = lazy(() => import("@/components/gallery/GalleryMasonry"));
import { useAuth } from "@/hooks/core/useAuth";
import { useQueryClient } from "@tanstack/react-query";
 import { useSiteSetting } from "@/hooks/core/useSiteSetting";
import { useTheme } from "@/hooks/core/useTheme";
import { supabase } from "@/integrations/supabase/client";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { useTopContributors } from "@/hooks/useTopContributors";
import { toast } from "@/hooks/core/use-toast";
import { fireConversion } from "@/lib/adConversionContext";

/* Classic easing — gentle, cinematic transitions */
const classicEase = [0.4, 0, 0.2, 1] as const;
const slowEase = [0.25, 0.1, 0.25, 1] as const;

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.2, duration: 1.2, ease: classicEase },
  }),
};

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { delay: i * 0.2, duration: 1.4, ease: slowEase },
  }),
};

/* No hardcoded hero slides — loaded from DB hero_banners table */

const SCROLL_STOPS = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1];
const LIGHT_SCROLL_COLORS = [
  "hsl(220 6% 96%)",
  "hsl(210 8% 95%)",
  "hsl(220 4% 94%)",
  "hsl(215 8% 95%)",
  "hsl(220 6% 96%)",
  "hsl(220 4% 94%)",
  "hsl(220 6% 96%)",
];
const DARK_SCROLL_COLORS = [
  "hsl(210 12% 5%)",
  "hsl(200 18% 8%)",
  "hsl(195 14% 6%)",
  "hsl(185 20% 9%)",
  "hsl(205 16% 7%)",
  "hsl(195 14% 6%)",
  "hsl(210 12% 5%)",
];

const HERO_SLIDE_MS = 8000;
const HERO_FADE_MS = 1800;
const MAX_HOME_GALLERY_ITEMS = 31;

const optimizeHeroImageUrl = (url: string) => {
  if (!url.includes("/storage/v1/object/public/")) return url;

  const [baseUrl, queryString] = url.split("?");
  const transformedBase = baseUrl.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/"
  );

  const params = new URLSearchParams(queryString || "");
  if (!params.has("width")) params.set("width", "1920");
  if (!params.has("quality")) params.set("quality", "70");

  return `${transformedBase}?${params.toString()}`;
};

/** Optimize gallery thumbnail URLs via Supabase image transform */
const optimizeGalleryImageUrl = (url: string, isHero: boolean) => {
  if (!url) return url;

  // Supabase Storage transform path
  if (url.includes("/storage/v1/object/public/")) {
    const [baseUrl, queryString] = url.split("?");
    const transformedBase = baseUrl.replace(
      "/storage/v1/object/public/",
      "/storage/v1/render/image/public/"
    );

    const params = new URLSearchParams(queryString || "");
    const width = isHero ? "640" : "320";
    if (!params.has("width")) params.set("width", width);
    if (!params.has("quality")) params.set("quality", "55");
    if (!params.has("format")) params.set("format", "webp");

    return `${transformedBase}?${params.toString()}`;
  }

  // External S3/R2 URLs: append hints where supported by CDN workers.
  try {
    const u = new URL(url);
    if (u.hostname.includes("r2.dev")) {
      // R2 public URLs in this setup ignore transform query params; keep canonical URL
      // to avoid duplicate large downloads with different query strings.
      u.searchParams.delete("width");
      u.searchParams.delete("height");
      u.searchParams.delete("quality");
      u.searchParams.delete("format");
      u.searchParams.delete("resize");
      return u.toString();
    }
  } catch {
    // Ignore malformed external URLs and return as-is
  }

  return url;
};

const getScrollColorAtProgress = (progress: number, colors: string[]) => {
  const safeColors = colors.length === 7 ? colors : DARK_SCROLL_COLORS;
  const v = Math.max(0, Math.min(1, progress));

  let i = 0;
  for (let j = 0; j < SCROLL_STOPS.length - 1; j++) {
    if (v >= SCROLL_STOPS[j]) i = j;
  }

  const next = Math.min(i + 1, SCROLL_STOPS.length - 1);
  if (i === next) return safeColors[i];

  const t = (v - SCROLL_STOPS[i]) / (SCROLL_STOPS[next] - SCROLL_STOPS[i]);
  return t < 0.5 ? safeColors[i] : safeColors[next];
};

/* Animated community counters with counting effect on scroll */
const COUNTER_TARGETS = [
  { label: "Members", target: 100000, suffix: "+" },
  { label: "Follows", target: 6000000, suffix: "+" },
  { label: "Posts", target: 10000000, suffix: "+" },
];

const formatCounterValue = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
  return String(n);
};

const CommunityCounters = () => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const [values, setValues] = useState([0, 0, 0]);

  useEffect(() => {
    if (!isInView) return;
    const duration = 1800;
    const steps = 60;
    const interval = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const progress = Math.min(step / steps, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValues(COUNTER_TARGETS.map(c => Math.floor(c.target * eased)));
      if (step >= steps) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, [isInView]);

  return (
    <div ref={ref} className="grid grid-cols-3 gap-2 mt-4">
      {COUNTER_TARGETS.map((c, i) => (
        <div key={c.label} className="text-center py-2 bg-background/30 rounded-lg border border-border/20">
          <span className="text-base font-light block" style={{ fontFamily: "var(--font-display)" }}>
            {formatCounterValue(values[i])}{c.suffix}
          </span>
          <span className="text-[8px] tracking-[0.12em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{c.label}</span>
        </div>
      ))}
    </div>
  );
};

/* No hardcoded gallery fallback — loaded from DB portfolio_images table */

interface PortfolioImage {
  id?: string;
  src: string;
  thumbnail?: string;
  title: string;
  category: string;
  is_pinned?: boolean;
  is_trending?: boolean;
  view_count?: number;
}

const Index = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const siteLogo = useSiteLogo();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { data: topContributors = [] } = useTopContributors();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [previousSlide, setPreviousSlide] = useState<number | null>(null);
  const [heroSlides, setHeroSlides] = useState<{src: string; title: string; category: string}[]>([]);
  const [heroReady, setHeroReady] = useState(false);
  const [galleryWorks, setGalleryWorks] = useState<PortfolioImage[]>([]);
  const [latestPost, setLatestPost] = useState<{ user_id: string; user_name: string; avatar_url: string | null; content: string; image_url: string | null; created_at: string; badges: string[] } | null>(null);
  const [recentMembers, setRecentMembers] = useState<{ id: string; full_name: string | null; avatar_url: string | null }[]>([]);
  const [communityStats, setCommunityStats] = useState({ users: 0, followers: 0, posts: 0 });
  // topContributors now comes from useTopContributors hook (newTop)
  const [dataLoading, setDataLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const [galleryLayout, setGalleryLayout] = useState<string>("classic");
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [heroContent, setHeroContent] = useState({
    label: "Photography Platform",
    heading: "Every Frame",
    heading_accent: "Tells",
    subtitle: "A curated space for photographers who see the world differently. Compete globally. Learn from masters. Share your stories.",
    cta_text: "Begin Your Journey",
    cta_link: "/signup",
  });
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [quoteBackground, setQuoteBackground] = useState<string>("");

   // ── Reactive site-setting subscriptions (pre-seeded by dashboard-init) ──
   const { data: _heroData } = useSiteSetting<any>("hero_content");
   const { data: _socialData } = useSiteSetting<Record<string, string>>("social_media_links");
   const { data: _layoutData } = useSiteSetting<any>("gallery_layout");
   const { data: _quoteBgData } = useSiteSetting<any>("quote_background_image");
 
   // Sync reactive settings → local state (re-runs whenever cache updates)
   useEffect(() => { if (_heroData) setHeroContent(_heroData); }, [_heroData]);
   useEffect(() => { if (_socialData) setSocialLinks(_socialData); }, [_socialData]);
   useEffect(() => {
     if (_layoutData && typeof _layoutData === "object" && "layout" in _layoutData)
       setGalleryLayout(_layoutData.layout);
   }, [_layoutData]);
   useEffect(() => {
     if (!_quoteBgData) return;
     let url = "";
     if (typeof _quoteBgData === "string") url = _quoteBgData.replace(/^"+|"+$/g, "");
     else if (typeof _quoteBgData === "object" && "url" in (_quoteBgData as any)) url = (_quoteBgData as any).url;
     if (url) setQuoteBackground(url);
   }, [_quoteBgData]);
 
  const middleRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: middleRef, offset: ["start start", "end end"] });

  const scrollColors = theme === "dark" ? DARK_SCROLL_COLORS : LIGHT_SCROLL_COLORS;

  const scrollColorsRef = useRef(scrollColors);
  useEffect(() => {
    scrollColorsRef.current = scrollColors;
  }, [scrollColors]);

  const [scrollBgValue, setScrollBgValue] = useState(() => getScrollColorAtProgress(0, scrollColors));

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setScrollBgValue(getScrollColorAtProgress(v, scrollColorsRef.current));
  });

  // Also update when theme changes (scrollColors updates)
  useEffect(() => {
    setScrollBgValue(getScrollColorAtProgress(scrollYProgress.get(), scrollColors));
  }, [scrollColors, scrollYProgress]);

  const openLightbox = useCallback((index: number) => { setLightboxIndex(index); setLightboxOpen(true); }, []);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  const prevLightbox = useCallback(() => setLightboxIndex((i) => (i - 1 + galleryWorks.length) % galleryWorks.length), [galleryWorks.length]);
  const nextLightbox = useCallback(() => setLightboxIndex((i) => (i + 1) % galleryWorks.length), [galleryWorks.length]);

  useEffect(() => {
    let cancelled = false;
    setHeroReady(false);

    if (heroSlides.length === 0) {
      setHeroReady(true);
      requestAnimationFrame(() => {
        (window as any).__dismissLoader?.();
      });
      return;
    }

    const preloaders = heroSlides.map(
      (slide) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.src = slide.src;
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    );

    const safetyTimeout = window.setTimeout(() => {
      if (!cancelled) setHeroReady(true);
    }, 2500);

    Promise.all(preloaders).then(() => {
      if (cancelled) return;
      window.clearTimeout(safetyTimeout);
      setHeroReady(true);
      // Dismiss the init-loader once hero images are ready, aligned to next paint frame
      requestAnimationFrame(() => {
        (window as any).__dismissLoader?.();
      });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimeout);
    };
  }, [heroSlides]);

  useEffect(() => {
    if (heroSlides.length <= 1 || !heroReady) return;
    const interval = setInterval(() => {
      setCurrentSlide((prev) => {
        setPreviousSlide(prev);
        return (prev + 1) % heroSlides.length;
      });
    }, HERO_SLIDE_MS);
    return () => clearInterval(interval);
  }, [heroSlides.length, heroReady]);

  useEffect(() => {
    if (previousSlide === null) return;
    const timeout = window.setTimeout(() => setPreviousSlide(null), HERO_FADE_MS + 60);
    return () => window.clearTimeout(timeout);
  }, [previousSlide]);

  useEffect(() => {
    if (currentSlide >= heroSlides.length) {
      setCurrentSlide(0);
    }
    if (previousSlide !== null && previousSlide >= heroSlides.length) {
      setPreviousSlide(null);
    }
  }, [currentSlide, heroSlides.length, previousSlide]);

  // ── Reactive queries for banners & gallery (A3-04, A3-08) ──
  const { data: _bannersData } = useQuery({
    queryKey: ["home-banners"],
    queryFn: async () => {
      const { data } = await supabase.from("hero_banners").select("id, title, category, image_url, sort_order").eq("is_active", true).order("sort_order", { ascending: true });
      return data || [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: _galleryData } = useQuery({
    queryKey: ["home-gallery"],
    queryFn: async () => {
      const { data } = await supabase.from("portfolio_images").select("id, title, category, image_url, thumbnail_url, sort_order, is_pinned, is_trending, view_count, active_from, active_until").eq("is_visible", true).order("is_pinned", { ascending: false }).order("sort_order", { ascending: true }).limit(MAX_HOME_GALLERY_ITEMS);
      return data || [];
    },
    staleTime: 5 * 60_000,
  });

  // Sync banner query data → local state
  useEffect(() => {
    if (_bannersData && _bannersData.length > 0) {
      setHeroSlides(_bannersData.map((b: any) => ({
        src: optimizeHeroImageUrl(b.image_url),
        title: b.title,
        category: b.category,
      })));
    }
  }, [_bannersData]);

  // Sync gallery query data → local state
  useEffect(() => {
    if (!_galleryData) return;
    if (_galleryData.length > 0) {
      const nowMs = Date.now();
      const filtered = _galleryData.filter((p: any) => {
        if (p.active_from && new Date(p.active_from).getTime() > nowMs) return false;
        if (p.active_until && new Date(p.active_until).getTime() < nowMs) return false;
        return true;
      }).slice(0, MAX_HOME_GALLERY_ITEMS);
      setGalleryWorks(filtered.map((p: any) => ({ id: p.id, src: p.image_url, thumbnail: p.thumbnail_url || undefined, title: p.title, category: p.category, is_pinned: p.is_pinned, is_trending: p.is_trending, view_count: p.view_count })));
    } else {
      setGalleryWorks([]);
    }
  }, [_galleryData]);

  // Community data fetch (kept as one-time — not admin-controlled)
  useEffect(() => {
    let isActive = true;
    setDataLoading(true);
    const safety = window.setTimeout(() => { if (isActive) setDataLoading(false); }, 3000);
    const fetchData = async () => {
      try {
        const results = await Promise.allSettled([
          supabase.from("posts").select("id, user_id, content, image_url, created_at").eq("privacy", "public").order("created_at", { ascending: false }).limit(1),
          (supabase.from("profiles_public_data" as any) as any).select("id, full_name, avatar_url").eq("is_suspended", false).order("created_at", { ascending: false }).limit(5),
          (supabase.from("profiles_public_data" as any) as any).select("id", { count: "exact", head: true }).eq("is_suspended", false),
          supabase.from("follows").select("id", { count: "exact", head: true }),
          supabase.from("posts").select("id", { count: "exact", head: true }),
        ]);

        const [postRes, membersRes, totalUsersRes, totalFollowsRes, totalPostsRes] = results;

        if (postRes.status === "fulfilled" && postRes.value.data?.[0]) {
          const post = postRes.value.data[0] as any;
          try {
            const authorProfileMap = await (await import("@/lib/profileMapCache")).fetchProfileMap([post.user_id]);
            const authorEntry = authorProfileMap.get(post.user_id);
            setLatestPost({
              user_id: post.user_id,
              user_name: authorEntry?.full_name || "Photographer",
              avatar_url: authorEntry?.avatar_url || null,
              content: post.content || "",
              image_url: post.image_url || null,
              created_at: post.created_at,
              badges: authorEntry?.badges || [],
            });
          } catch (e) { console.warn("Latest post author resolution failed:", e); }
        } else if (postRes.status === "rejected") {
          console.warn("Latest post fetch failed:", postRes.reason);
        }

        if (membersRes.status === "fulfilled" && membersRes.value.data && membersRes.value.data.length > 0) {
          setRecentMembers(membersRes.value.data.map((m: any) => ({ id: m.id, full_name: m.full_name, avatar_url: m.avatar_url })));
        } else if (membersRes.status === "rejected") {
          console.warn("Recent members fetch failed:", membersRes.reason);
        }

        setCommunityStats({
          users: totalUsersRes.status === "fulfilled" ? (totalUsersRes.value.count || 0) : 0,
          followers: totalFollowsRes.status === "fulfilled" ? (totalFollowsRes.value.count || 0) : 0,
          posts: totalPostsRes.status === "fulfilled" ? (totalPostsRes.value.count || 0) : 0,
        });
      } catch (err) { console.error("Failed to load showcase data:", err); }
      finally { window.clearTimeout(safety); if (isActive) setDataLoading(false); }
    };
    fetchData();
    return () => { isActive = false; window.clearTimeout(safety); };
  }, []);


  return (
    <main className="min-h-screen text-foreground overflow-hidden">
      <PageSEO jsonLd={{ type: "WebSite" }} />

      {/* Hero */}
      <section className="relative h-screen-safe flex items-end pb-32 md:pb-28 overflow-hidden bg-background" aria-label="Featured photography">
        {/* Pre-render all slides, only toggle opacity — avoids mount/unmount flicker */}
        {heroSlides.map((slide, i) => {
          const isCurrent = i === currentSlide;
          const isExiting = i === previousSlide;

          return (
          <div
            key={i}
            className="absolute inset-0 will-change-[opacity]"
            style={{
              opacity: isCurrent ? 1 : 0,
              zIndex: isCurrent ? 3 : isExiting ? 2 : 1,
              transition: `opacity ${HERO_FADE_MS}ms ease-in-out`,
            }}
          >
            <img
              src={slide.src}
              alt={`${slide.title} — ${slide.category} photography`}
              className={`w-full h-full object-cover will-change-transform transition-opacity duration-700 ${heroReady ? "opacity-100" : "opacity-0"}`}
              loading={i <= 1 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : "auto"}
              decoding="async"
              style={{
                animation: isCurrent && heroReady ? `kenburns ${HERO_SLIDE_MS}ms ease-in-out forwards` : "none",
                transform: isExiting ? "scale(1.08) translate(-1%, -1%)" : "scale(1) translate(0, 0)",
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none transition-[background] duration-700 ease-in-out"
              style={{
                background: theme === "dark"
                  ? "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.5) 100%)"
                  : "linear-gradient(to bottom, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.55) 100%)",
              }}
            />
          </div>
        )})}
        {/* Theme-reactive bottom gradient with smooth transition */}
        <div
          className="absolute inset-0 pointer-events-none transition-[background] duration-700 ease-in-out"
          style={{
            background: theme === "dark"
              ? "linear-gradient(to top, hsl(222 47% 11%) 0%, hsl(222 47% 11% / 0.75) 20%, hsl(222 47% 11% / 0.35) 45%, transparent 100%)"
              : "linear-gradient(to top, hsl(209 40% 96%) 0%, hsl(209 40% 96% / 0.7) 20%, hsl(209 40% 96% / 0.3) 45%, transparent 100%)",
          }}
        />
        <div className="container mx-auto relative z-10">
          <motion.div initial="hidden" animate="visible" className="max-w-3xl">
            <motion.div variants={fadeUp} custom={0} className="flex items-center gap-4 mb-6">
              <div className="w-12 h-px bg-primary" />
              <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{heroContent.label}</span>
            </motion.div>
            <motion.h1 variants={fadeUp} custom={1} className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-light leading-[0.95] tracking-tight mb-8 whitespace-nowrap" style={{ fontFamily: "var(--font-display)" }}>
              {heroContent.heading} <em className="italic text-primary">{heroContent.heading_accent}</em>
            </motion.h1>
            <motion.p variants={fadeUp} custom={2} className="text-sm md:text-base text-muted-foreground max-w-[min(100%,32rem)] mb-10 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>{heroContent.subtitle}</motion.p>
            <motion.div variants={fadeUp} custom={3}>
              <Link to={heroContent.cta_link} className="group inline-flex items-center gap-4 text-sm tracking-[0.15em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>
                <span className="w-14 h-14 rounded-full border border-primary flex items-center justify-center group-hover:bg-primary group-hover:scale-105 transition-all duration-[1s]">
                  <ArrowRight className="h-5 w-5 text-primary group-hover:text-primary-foreground transition-colors duration-700" />
                </span>
                {heroContent.cta_text}
              </Link>
            </motion.div>
          </motion.div>
        </div>
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3, duration: 1 }} onClick={() => document.getElementById("spotlight")?.scrollIntoView({ behavior: "smooth" })} className="absolute bottom-20 md:bottom-10 left-1/2 -translate-x-1/2 z-20 group cursor-pointer" aria-label="Scroll to spotlight">
          <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}>
            <ArrowDown className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors duration-500" />
          </motion.div>
        </motion.button>
      </section>

      {/* Spotlight */}
      <section id="spotlight" className="py-12 md:py-18" aria-label="Spotlight">
        <div className="container mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} className="flex items-center gap-4 mb-12">
            <motion.div variants={fadeUp} custom={0} className="flex items-center gap-4">
              <div className="w-12 h-px bg-primary" />
              <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Spotlight</span>
            </motion.div>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            <Suspense fallback={<div className="h-64 bg-muted/20 animate-pulse rounded-lg" />}><PhotoOfTheDay /></Suspense>
            <Suspense fallback={<div className="h-64 bg-muted/20 animate-pulse rounded-lg" />}><FeaturedArtist /></Suspense>
          </div>
        </div>
      </section>

      {/* Scroll-linked background sections */}
      <motion.div ref={middleRef} style={{ background: scrollBgValue, transition: "background 0.3s ease" }}>


      {/* Featured Works — Redesigned */}
      <section id="works" className="py-9 md:py-16 relative" aria-label="Selected photography works">
        {/* Background accent */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent pointer-events-none" />

        <div className="container mx-auto relative z-10">
          <motion.header
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="text-center mb-20"
          >
            <motion.div variants={fadeUp} custom={0} className="flex items-center justify-center gap-4 mb-6">
              <div className="w-16 h-px bg-primary" />
              <span className="text-[10px] tracking-[0.4em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                Portfolio
              </span>
              <div className="w-16 h-px bg-primary" />
            </motion.div>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light tracking-tight whitespace-nowrap"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Selected <em className="italic text-primary">Works</em>
            </motion.h2>
            <motion.p
              variants={fadeIn}
              custom={2}
              className="text-sm text-muted-foreground mt-4 max-w-md mx-auto"
              style={{ fontFamily: "var(--font-body)" }}
            >
              A curated collection of moments frozen in time — click any image to explore
            </motion.p>
          </motion.header>

          {/* Category filter tabs */}
          {(() => {
            if (dataLoading && galleryWorks.length === 0) {
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1 sm:gap-1.5">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-muted/50 animate-pulse rounded-sm" />
                  ))}
                </div>
              );
            }

            if (!dataLoading && galleryWorks.length === 0) {
              return (
                <div className="text-center py-16 border border-dashed border-border rounded-sm">
                  <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    No active works available right now.
                  </p>
                </div>
              );
            }

            const categories = ["All", ...Array.from(new Set(galleryWorks.map(w => w.category)))];
            const filtered = activeCategory === "All" ? galleryWorks : galleryWorks.filter(w => w.category === activeCategory);
            const visibleWorks = filtered.slice(0, MAX_HOME_GALLERY_ITEMS);
            // Build lightbox index map: visible index → original galleryWorks index
            const filteredIndexMap = visibleWorks.map(w => galleryWorks.indexOf(w));

            return (
              <>
                <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`text-[10px] tracking-[0.25em] uppercase px-4 py-2 border transition-all duration-500 ${
                        activeCategory === cat
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <Suspense fallback={<div className="grid grid-cols-4 gap-1">{Array.from({length:12}).map((_,i)=><div key={i} className="aspect-square bg-muted/50 animate-pulse rounded-sm"/>)}</div>}>
                  {galleryLayout === "magazine" ? (
                    <GalleryMagazine works={visibleWorks} onImageClick={(i) => openLightbox(filteredIndexMap[i])} optimizeUrl={optimizeGalleryImageUrl} />
                  ) : galleryLayout === "bento" ? (
                    <GalleryBento works={visibleWorks} onImageClick={(i) => openLightbox(filteredIndexMap[i])} optimizeUrl={optimizeGalleryImageUrl} />
                  ) : galleryLayout === "masonry" ? (
                    <GalleryMasonry works={visibleWorks} onImageClick={(i) => openLightbox(filteredIndexMap[i])} optimizeUrl={optimizeGalleryImageUrl} />
                  ) : (
                    <GalleryClassic works={visibleWorks} onImageClick={(i) => openLightbox(filteredIndexMap[i])} optimizeUrl={optimizeGalleryImageUrl} />
                  )}
                </Suspense>

                {/* No pagination — limited to 31 images */}
              </>
            );
          })()}
        </div>
      </section>

      {/* Lightbox */}
      {lightboxOpen && (
        <Suspense fallback={null}>
          <Lightbox
            images={galleryWorks}
            currentIndex={lightboxIndex}
            isOpen={lightboxOpen}
            onClose={closeLightbox}
            onPrev={prevLightbox}
            onNext={nextLightbox}
          />
        </Suspense>
      )}
      </motion.div>




      {/* Social Engagement Showcase */}
      <section className="relative py-16 md:py-20 overflow-hidden" aria-label="Community and social features" style={{ background: "hsl(var(--scroll-bg-2))" }}>
        {/* Subtle diagonal line accent */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full opacity-[0.03]" style={{ background: "radial-gradient(circle, hsl(var(--primary)), transparent 70%)" }} />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full opacity-[0.02]" style={{ background: "radial-gradient(circle, hsl(var(--secondary)), transparent 70%)" }} />
        </div>

        <div className="container mx-auto relative z-10">
          {/* Header — compact */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="mb-12 md:mb-16"
          >
            <div className="flex items-end justify-between">
              <div>
                <motion.div variants={fadeUp} custom={0} className="flex items-center gap-4 mb-3">
                  <div className="w-10 h-px bg-primary" />
                  <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                    Community
                  </span>
                </motion.div>
                <motion.h2 variants={fadeUp} custom={1} className="text-3xl sm:text-4xl md:text-5xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                  Connect & <em className="italic text-primary">Engage</em>
                </motion.h2>
                <motion.p variants={fadeUp} custom={2} className="text-sm text-muted-foreground mt-3 max-w-md" style={{ fontFamily: "var(--font-body)" }}>
                  More than a portfolio — react, comment, share, and grow with photographers worldwide.
                </motion.p>
              </div>
              <motion.div variants={fadeIn} custom={2} className="hidden sm:block">
                <Link
                  to={user ? "/feed" : "/signup"}
                  className="group inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors duration-500"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {user ? "Go to Feed" : "Join Now"} <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform duration-500" />
                </Link>
              </motion.div>
            </div>
          </motion.div>

          {/* Bento Grid — asymmetric layout */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-5">

            {/* Card 1 — Share Your Story (large, spans 7 cols) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: classicEase }}
              className="md:col-span-4 h-full group bg-card/60 backdrop-blur-sm border border-border/60 hover:border-primary/30 rounded-xl p-5 md:p-6 transition-all duration-700 relative overflow-hidden flex flex-col"
            >
              {/* Glow */}
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/5 rounded-full group-hover:scale-[2] transition-transform duration-[2s]" />
              <div className="relative z-10 flex-1 flex flex-col">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Rss className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>Share Your Story</h3>
                </div>
                {/* Live post from DB */}
                <div className="bg-background/50 border border-border/40 rounded-lg p-3.5 shadow-sm">
                  {latestPost ? (
                    <>
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="w-8 h-8 rounded-full bg-muted overflow-hidden">
                          {latestPost.avatar_url ? (
                            <img loading="lazy" decoding="async" src={latestPost.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] font-medium text-muted-foreground uppercase">{latestPost.user_name?.[0] || "?"}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <UserIdentityBlock
                            userId={latestPost.user_id}
                            name={latestPost.user_name || "Photographer"}
                            nameClassName="text-xs font-medium truncate [font-family:var(--font-body)]"
                          />
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {(() => { const mins = Math.floor((Date.now() - new Date(latestPost.created_at).getTime()) / 60000); if (mins < 60) return `${mins}m`; const hrs = Math.floor(mins / 60); if (hrs < 24) return `${hrs}h`; return `${Math.floor(hrs / 24)}d`; })()} · <Globe className="h-2.5 w-2.5" />
                          </span>
                        </div>
                      </div>
                      {latestPost.content && (
                        <p className="text-xs text-muted-foreground mb-2.5 leading-relaxed line-clamp-2" style={{ fontFamily: "var(--font-body)" }}>{latestPost.content}</p>
                      )}
                      {latestPost.image_url && (
                        <div className="h-36 md:h-44 rounded-md overflow-hidden bg-muted mb-2.5">
                          <img loading="lazy" decoding="async" src={latestPost.image_url} alt="" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>Be the first to share your story!</p>
                    </div>
                  )}
                  <div className="border-t border-border/40 pt-2 flex items-center justify-around text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5 cursor-default"><span className="text-sm">👍</span> Like</span>
                    <span className="flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Comment</span>
                    <span className="flex items-center gap-1.5"><Rss className="h-3.5 w-3.5" /> Share</span>
                  </div>
                </div>
                {/* Reaction bar */}
                <div className="flex items-center gap-1.5 mt-3 bg-card border border-border/40 rounded-full px-3 py-1.5 w-fit shadow-sm">
                  {["👍", "❤️", "😂", "😮", "😢", "😡"].map((e, i) => (
                    <motion.span
                      key={e}
                      initial={{ opacity: 0, y: 6 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.6 + i * 0.06, duration: 0.25 }}
                      className="text-xl cursor-default hover:scale-125 hover:-translate-y-0.5 transition-transform duration-150"
                    >
                      {e}
                    </motion.span>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Card 2 — Build Your Circle (spans 5 cols) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1, duration: 0.8, ease: classicEase }}
              className="md:col-span-4 h-full group bg-card/60 backdrop-blur-sm border border-border/60 hover:border-primary/30 rounded-xl p-5 md:p-6 transition-all duration-700 relative overflow-hidden flex flex-col"
            >
              <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-primary/5 rounded-full group-hover:scale-[2] transition-transform duration-[2s]" />
              <div className="relative z-10 flex-1 flex flex-col">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>Build Your Circle</h3>
                </div>
                <div className="space-y-2 flex-1">
                  {[
                    { name: "Akira Tanaka", country: "🇯🇵", img: "https://i.pravatar.cc/80?img=11" },
                    { name: "Sofia Müller", country: "🇩🇪", img: "https://i.pravatar.cc/80?img=32" },
                    { name: "Carlos Rivera", country: "🇲🇽", img: "https://i.pravatar.cc/80?img=53" },
                    { name: "Amara Osei", country: "🇬🇭", img: "https://i.pravatar.cc/80?img=44" },
                    { name: "Priya Sharma", country: "🇮🇳", img: "https://i.pravatar.cc/80?img=25" },
                  ].map((m, i) => (
                    <motion.div
                      key={m.name}
                      initial={{ opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }}
                      className="flex items-center gap-2.5 bg-background/50 border border-border/40 rounded-lg px-3 py-2"
                    >
                      <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                        <img src={m.img} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <span className="text-xs flex-1 truncate" style={{ fontFamily: "var(--font-body)" }}>{m.name} {m.country}</span>
                      <span className="text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-sm border border-primary/40 text-primary bg-primary/5" style={{ fontFamily: "var(--font-heading)" }}>
                        Member
                      </span>
                    </motion.div>
                  ))}
                </div>
                <CommunityCounters />
              </div>
            </motion.div>

            {/* Card 3 — Your Feed (spans 4 cols) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, duration: 0.8, ease: classicEase }}
              className="md:col-span-4 h-full group bg-card/60 backdrop-blur-sm border border-border/60 hover:border-primary/30 rounded-xl p-5 md:p-6 transition-all duration-700 relative overflow-hidden flex flex-col"
            >
              <div className="absolute -top-12 -left-12 w-28 h-28 bg-primary/5 rounded-full group-hover:scale-[2] transition-transform duration-[2s]" />
              <div className="relative z-10 flex-1 flex flex-col">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Rss className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>Your Feed</h3>
                </div>
                <div className="space-y-2 flex-1">
                  {[
                    { text: "shared a wildlife photo", emoji: "📸", time: "5m" },
                    { text: "won 1st in Portrait Masters", emoji: "🏆", time: "1h" },
                    { text: "reacted ❤️ to your shot", emoji: "❤️", time: "2h" },
                    { text: "started following you", emoji: "👋", time: "3h" },
                    { text: "commented on your post", emoji: "💬", time: "4h" },
                    { text: "entered Landscape Challenge", emoji: "🏔️", time: "5h" },
                    { text: "earned a new badge", emoji: "🎖️", time: "6h" },
                    { text: "uploaded 3 new photos", emoji: "🖼️", time: "8h" },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + i * 0.08, duration: 0.35 }}
                      className="flex items-center gap-2 bg-background/30 rounded-lg px-2.5 py-1.5 border border-border/20"
                    >
                      <span className="text-sm shrink-0">{item.emoji}</span>
                      <span className="flex-1 text-muted-foreground text-[11px] truncate" style={{ fontFamily: "var(--font-body)" }}>{item.text}</span>
                      <span className="text-[9px] text-muted-foreground/40 shrink-0">{item.time}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Card 4 — Privacy (spans 4 cols) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.25, duration: 0.8, ease: classicEase }}
              className="md:col-span-4 group bg-card/60 backdrop-blur-sm border border-border/60 hover:border-primary/30 rounded-xl p-5 md:p-6 transition-all duration-700 relative overflow-hidden"
            >
              <div className="absolute -bottom-10 -right-10 w-28 h-28 bg-primary/5 rounded-full group-hover:scale-[2] transition-transform duration-[2s]" />
              <div className="relative z-10">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Eye className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>Privacy Controls</h3>
                </div>
                <div className="space-y-2">
                  {[
                    { icon: Globe, label: "Public", desc: "Everyone", active: true },
                    { icon: Users, label: "Friends Only", desc: "Friends", active: false },
                    { icon: Eye, label: "Only Me", desc: "Private", active: false },
                  ].map((p, i) => (
                    <motion.div
                      key={p.label}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + i * 0.08, duration: 0.35 }}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 border transition-colors ${
                        p.active ? "border-primary/30 bg-primary/5" : "border-border/30 bg-background/30"
                      }`}
                    >
                      <p.icon className={`h-3.5 w-3.5 shrink-0 ${p.active ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`text-xs flex-1 ${p.active ? "text-primary font-medium" : "text-muted-foreground"}`} style={{ fontFamily: "var(--font-body)" }}>{p.label}</span>
                      <span className="text-[9px] text-muted-foreground/50">{p.desc}</span>
                      {p.active && (
                        <div className="w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center">
                          <ArrowRight className="h-2 w-2 text-primary-foreground rotate-[-45deg]" />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Card 5 — CTA card (spans 4 cols) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3, duration: 0.8, ease: classicEase }}
              className="md:col-span-4 group border border-primary/20 hover:border-primary/50 rounded-xl p-5 md:p-6 transition-all duration-700 relative overflow-hidden flex flex-col justify-center items-center text-center"
              style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.06), hsl(var(--primary) / 0.02))" }}
            >
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-full border border-primary/30 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary group-hover:border-primary transition-all duration-500">
                  <ArrowRight className="h-5 w-5 text-primary group-hover:text-primary-foreground transition-colors duration-500" />
                </div>
                <p className="text-xs text-muted-foreground mb-3 max-w-[200px]" style={{ fontFamily: "var(--font-body)" }}>
                  Join a vibrant community of photographers
                </p>
                <Link
                  to={user ? "/feed" : "/signup"}
                  className="text-[10px] tracking-[0.2em] uppercase text-primary hover:text-foreground transition-colors duration-500"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {user ? "Explore Feed" : "Get Started Free"}
                </Link>
              </div>
            </motion.div>

            {/* Card 6 — Top Contributors (spans 4 cols) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.35, duration: 0.8, ease: classicEase }}
              className="md:col-span-4 group bg-card/60 backdrop-blur-sm border border-border/60 hover:border-primary/30 rounded-xl p-5 md:p-6 transition-all duration-700 relative overflow-hidden"
            >
              <div className="absolute -top-16 -right-16 w-32 h-32 bg-primary/5 rounded-full group-hover:scale-[2] transition-transform duration-[2s]" />
              <div className="relative z-10">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Trophy className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>Top Contributors</h3>
                  <span className="ml-auto text-[8px] tracking-[0.1em] uppercase text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>This Month</span>
                </div>
                <div className="space-y-2">
                  {topContributors.length > 0 ? topContributors.map((c, i) => {
                    const medals = ["🥇", "🥈", "🥉"];
                    const barWidth = topContributors[0]?.score ? Math.round((c.score / topContributors[0].score) * 100) : 0;
                    return (
                      <motion.div
                        key={c.id}
                        initial={{ opacity: 0, x: -12 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }}
                        className="flex items-center gap-2.5 bg-background/50 border border-border/40 rounded-lg px-3 py-2 relative overflow-hidden"
                      >
                        <div className="absolute inset-y-0 left-0 bg-primary/5 transition-all duration-700" style={{ width: `${barWidth}%` }} />
                        <span className="text-sm shrink-0 relative z-10">{medals[i] || ""}</span>
                        <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0 relative z-10">
                          {c.avatar_url ? (
                            <img loading="lazy" decoding="async" src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[9px] font-medium text-muted-foreground uppercase">{c.full_name?.[0] || "?"}</div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 relative z-10">
                          <UserIdentityBlock
                            userId={c.id}
                            name={c.full_name || "Photographer"}
                            nameClassName="text-xs truncate [font-family:var(--font-body)]"
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground/60 shrink-0 relative z-10" style={{ fontFamily: "var(--font-heading)" }}>{c.posts_count} posts</span>
                      </motion.div>
                    );
                  }) : (
                    <div className="py-8 text-center">
                      <Trophy className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-[10px] text-muted-foreground/50" style={{ fontFamily: "var(--font-body)" }}>Contributors loading…</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Quote */}
      <section className="relative py-14 md:py-30 overflow-hidden" aria-label="Photography quote">
        {quoteBackground ? (
          <div className="absolute inset-0">
            <img src={quoteBackground} alt="" className="w-full h-full object-cover brightness-[0.15]" aria-hidden="true" loading="lazy" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-background/95" aria-hidden="true" />
        )}
        <div className="container mx-auto relative z-10 text-center">
          <motion.blockquote
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 2, ease: slowEase }}
          >
            <Layers className="h-6 w-6 md:h-8 md:w-8 text-primary mx-auto mb-4 md:mb-8" strokeWidth={1} />
            <p className="text-xl md:text-5xl lg:text-6xl font-light leading-[1.2] max-w-4xl mx-auto mb-4 md:mb-8 text-white" style={{ fontFamily: "var(--font-display)" }}>
              "The camera is an instrument that teaches people how to see
              <em className="italic text-primary"> without a camera</em>"
            </p>
            <cite className="text-[10px] tracking-[0.3em] uppercase text-white/60 not-italic" style={{ fontFamily: "var(--font-heading)" }}>
              — Dorothea Lange
            </cite>
          </motion.blockquote>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 md:py-24" aria-label="Join 50mm Retina World">
        <div className="container mx-auto text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <motion.h2 variants={fadeUp} custom={0} className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light tracking-tight mb-4 md:mb-8 whitespace-nowrap" style={{ fontFamily: "var(--font-display)" }}>
              Start <em className="italic text-primary">Creating</em>
            </motion.h2>
            <motion.p variants={fadeUp} custom={1} className="text-sm text-muted-foreground max-w-md mx-auto mb-8 md:mb-12 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
              Your lens has stories to tell. Join a community that celebrates the art of photography in its purest form.
            </motion.p>
            <motion.div variants={fadeUp} custom={2}>
              <Link
                to="/signup"
                className="group inline-flex items-center gap-4 text-sm tracking-[0.15em] uppercase"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <span className="w-16 h-16 rounded-full border border-primary flex items-center justify-center group-hover:bg-primary group-hover:scale-105 transition-all duration-[1s]">
                  <ArrowRight className="h-5 w-5 text-primary group-hover:text-primary-foreground transition-colors duration-700" />
                </span>
                Create Free Account
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10 md:py-16" role="contentinfo">
        <div className="container mx-auto">
          <div className="grid md:grid-cols-3 gap-12 items-start">
            <div className="text-center md:text-left">
              <div className="flex items-center gap-3 mb-4 justify-center md:justify-start">
                <img loading="eager" decoding="async" fetchPriority="high" src={siteLogo} alt="50mm Retina World" className="h-9 w-9 object-contain" />
                <span className="text-sm tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>
                  50mm Retina World
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-5" style={{ fontFamily: "var(--font-body)" }}>
                A curated platform for photographers who see the world differently.
              </p>
              {/* Social Media Icons */}
              {(() => {
                const socialConfig: { key: string; icon: any; hoverClass: string; label: string }[] = [
                  { key: "facebook", icon: Facebook, hoverClass: "hover:text-[#1877F2] hover:border-[#1877F2]", label: "Facebook" },
                  { key: "instagram", icon: Instagram, hoverClass: "hover:text-[#E4405F] hover:border-[#E4405F]", label: "Instagram" },
                  { key: "twitter", icon: Twitter, hoverClass: "hover:text-foreground hover:border-foreground", label: "X (Twitter)" },
                  { key: "youtube", icon: Youtube, hoverClass: "hover:text-[#FF0000] hover:border-[#FF0000]", label: "YouTube" },
                  { key: "linkedin", icon: Linkedin, hoverClass: "hover:text-[#0A66C2] hover:border-[#0A66C2]", label: "LinkedIn" },
                  { key: "github", icon: Github, hoverClass: "hover:text-foreground hover:border-foreground", label: "GitHub" },
                  { key: "tiktok", icon: Music2, hoverClass: "hover:text-foreground hover:border-foreground", label: "TikTok" },
                  { key: "pinterest", icon: MapPin, hoverClass: "hover:text-[#E60023] hover:border-[#E60023]", label: "Pinterest" },
                  { key: "whatsapp_link", icon: PhoneIcon, hoverClass: "hover:text-[#25D366] hover:border-[#25D366]", label: "WhatsApp" },
                  { key: "telegram", icon: SendIcon, hoverClass: "hover:text-[#0088CC] hover:border-[#0088CC]", label: "Telegram" },
                  { key: "website", icon: Globe, hoverClass: "hover:text-primary hover:border-primary", label: "Website" },
                ];
                const activeLinks = socialConfig.filter(({ key }) => socialLinks[key]?.trim());
                if (activeLinks.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                    {activeLinks.map(({ key, icon: Icon, hoverClass, label }) => (
                      <a
                        key={key}
                        href={socialLinks[key]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`p-2 rounded-full border border-border text-muted-foreground transition-all duration-300 hover:scale-110 ${hoverClass}`}
                        title={label}
                        aria-label={label}
                        onClick={() => {
                          if (key === "whatsapp_link") {
                            fireConversion("whatsapp_click", { source: "footer" });
                          } else {
                            fireConversion("cta_click", { source: "footer", social: key });
                          }
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </a>
                    ))}
                  </div>
                );
              })()}
            </div>
            <nav aria-label="Footer navigation">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>Navigate</span>
              <div className="grid grid-cols-[1fr_1fr] gap-y-3 md:grid-cols-1">
                <a href="#works" className="text-xs text-foreground/70 hover:text-foreground transition-colors duration-500" style={{ fontFamily: "var(--font-body)" }}>Works</a>
                <Link to="/competitions" className="text-xs text-foreground/70 hover:text-foreground transition-colors duration-500" style={{ fontFamily: "var(--font-body)" }}>Competitions</Link>
                <Link to="/courses" className="text-xs text-foreground/70 hover:text-foreground transition-colors duration-500" style={{ fontFamily: "var(--font-body)" }}>Education</Link>
                <Link to="/journal" className="text-xs text-foreground/70 hover:text-foreground transition-colors duration-500" style={{ fontFamily: "var(--font-body)" }}>Journal</Link>
                <Link to="/#featured-artist" className="text-xs text-foreground/70 hover:text-foreground transition-colors duration-500" style={{ fontFamily: "var(--font-body)" }}>Featured Artist</Link>
                <Link to="/verify" className="text-xs text-foreground/70 hover:text-foreground transition-colors duration-500" style={{ fontFamily: "var(--font-body)" }}>Verify Certificate</Link>
              </div>
            </nav>
            <div className="text-center md:text-right">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>Newsletter</span>
              <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
                Stay inspired with updates & insights.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const email = (form.elements.namedItem("newsletter_email") as HTMLInputElement).value;
                  if (email) {
                    try {
                      const { supabase } = await import("@/integrations/supabase/client");
                      await (supabase.from("newsletter_subscribers" as any).upsert(
                        { email: email.toLowerCase().trim(), source: "website" } as any,
                        { onConflict: "email" }
                      ) as any);
                      toast({ title: "Subscribed!", description: "You'll receive our latest updates soon." });
                      form.reset();
                    } catch {
                      toast({ title: "Subscribed!", description: "You'll receive our latest updates soon." });
                      form.reset();
                    }
                  }
                }}
                className="flex gap-1.5 justify-center md:justify-end"
              >
                <input
                  name="newsletter_email"
                  type="email"
                  required
                  placeholder="your@email.com"
                  className="flex-1 max-w-[200px] md:max-w-none h-8 rounded-sm border border-input bg-background px-2.5 text-[11px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  style={{ fontFamily: "var(--font-body)" }}
                />
                <button
                  type="submit"
                  className="h-8 px-3 rounded-sm bg-primary text-primary-foreground text-[9px] tracking-[0.15em] uppercase hover:bg-primary/90 transition-colors duration-300 shrink-0"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Subscribe
                </button>
              </form>
              <p className="text-[10px] text-muted-foreground mt-6 text-center" style={{ fontFamily: "var(--font-body)" }}>
                © 2026 50mm Retina World. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default Index;
