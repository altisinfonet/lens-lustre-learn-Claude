import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import DOMPurify from "dompurify";
import { Clock, Tag, Download, Share2, Check, Palette, ArrowRight, ExternalLink } from "lucide-react";
import PageSEO from "@/components/PageSEO";
import Breadcrumbs from "@/components/Breadcrumbs";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { generateArticlePdf } from "@/lib/generateArticlePdf";
import { htmlToPlainText } from "@/lib/htmlSanitizer";
import { toast } from "@/hooks/core/use-toast";

interface FeaturedArtistData {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  photo_gallery: string[];
  artist_name: string | null;
  artist_bio: string | null;
  artist_avatar_url: string | null;
  author_profile_id: string | null;
  tags: string[];
  published_at: string | null;
  created_at: string;
}

interface AuthorView {
  id: string | null;            // profile id if linked, else null
  name: string;
  avatar: string | null;
  bio: string | null;
  portfolio: string | null;
}


// === Distinct right-rail (NOT a card — hairline + generous space) ===
function ArtistSpotlight({
  author,
  galleryThumbs,
  onThumbClick,
  layout,
}: {
  author: AuthorView;
  galleryThumbs: string[];
  onThumbClick: (url: string) => void;
  layout: "rail" | "inline";
}) {
  const Wrapper = layout === "rail"
    ? "div"
    : "div";

  return (
    <Wrapper
      className={
        layout === "rail"
          ? "relative pl-6 border-l border-border"
          : "relative py-6 my-8 border-y border-border"
      }
    >
      <span
        className="text-[10px] tracking-[0.35em] uppercase text-primary flex items-center gap-2 mb-5"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <Palette className="h-3 w-3" />
        Artist Spotlight
      </span>

      <div className={layout === "rail" ? "" : "flex items-start gap-5"}>
        {author.avatar ? (
          <img
            src={author.avatar}
            alt={author.name}
            className={
              layout === "rail"
                ? "h-24 w-24 rounded-full object-cover mb-4 ring-1 ring-border"
                : "h-20 w-20 rounded-full object-cover shrink-0 ring-1 ring-border"
            }
            loading="lazy"
          />
        ) : (
          <div className={
            layout === "rail"
              ? "h-24 w-24 rounded-full bg-muted mb-4 flex items-center justify-center"
              : "h-20 w-20 rounded-full bg-muted shrink-0 flex items-center justify-center"
          }>
            <Palette className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          {author.id ? (
            <Link to={`/profile/${author.id}`} className="block group">
              <h3
                className="text-2xl font-light tracking-tight text-foreground group-hover:text-primary transition-colors leading-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {author.name}
              </h3>
            </Link>
          ) : (
            <h3
              className="text-2xl font-light tracking-tight text-foreground leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {author.name}
            </h3>
          )}

          {author.bio && (
            <p
              className="text-sm text-muted-foreground leading-relaxed mt-3 line-clamp-6"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {author.bio}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {author.id && (
              <Link
                to={`/profile/${author.id}`}
                className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-primary hover:gap-2.5 transition-all"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                View Profile <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            {author.portfolio && (
              <a
                href={author.portfolio}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                See Portfolio <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {galleryThumbs.length > 0 && (
        <div className={layout === "rail" ? "mt-8" : "mt-6"}>
          <span
            className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground block mb-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            From this story
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {galleryThumbs.map((url, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onThumbClick(url)}
                className="aspect-square overflow-hidden rounded-sm border border-border hover:border-primary/60 transition-colors"
              >
                <img
                  src={url}
                  alt={`Thumb ${i + 1}`}
                  loading="lazy"
                  className="w-full h-full object-cover hover:brightness-110 transition"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </Wrapper>
  );
}

const FeaturedArtistPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<FeaturedArtistData | null>(null);
  const [author, setAuthor] = useState<AuthorView | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      const { data } = await supabase
        .from("featured_artists")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();

      if (cancelled) return;
      if (!data) { setLoading(false); return; }
      const art = data as any as FeaturedArtistData;
      setArticle(art);

      // Resolve author: prefer linked profile, fallback to embedded fields.
      if (art.author_profile_id) {
        const { data: p } = await profilesPublic()
          .select("id, full_name, avatar_url, bio, portfolio_url")
          .eq("id", art.author_profile_id)
          .maybeSingle();
        if (!cancelled) {
          if (p) {
            setAuthor({
              id: p.id,
              name: p.full_name || art.artist_name || "Unknown",
              avatar: p.avatar_url || art.artist_avatar_url,
              bio: p.bio || art.artist_bio,
              portfolio: p.portfolio_url || null,
            });
          } else {
            // Linked profile not visible/found → fallback gracefully
            setAuthor({
              id: null,
              name: art.artist_name || "Unknown",
              avatar: art.artist_avatar_url,
              bio: art.artist_bio,
              portfolio: null,
            });
          }
        }
      } else {
        setAuthor({
          id: null,
          name: art.artist_name || "Unknown",
          avatar: art.artist_avatar_url,
          bio: art.artist_bio,
          portfolio: null,
        });
      }

      setLoading(false);
    };
    fetchData();
    return () => { cancelled = true; };
  }, [slug]);

  const pageRootRef = useRef<HTMLElement>(null);

  const handleDownloadPdf = async () => {
    if (!article) return;
    setGeneratingPdf(true);
    try {
      await generateArticlePdf({
        title: article.title,
        article: {
          title: article.title,
          subtitle: article.excerpt,
          body: article.body,
          coverImageUrl: article.cover_image_url,
          authorName: author?.name || null,
          authorAvatarUrl: author?.avatar || null,
          authorBio: author?.bio || null,
          publishedAt: article.published_at || article.created_at,
          tags: article.tags,
          gallery: article.photo_gallery,
          sectionLabel: "FEATURED ARTIST",
        },
      });
      toast({ title: "PDF downloaded!" });
    } catch {
      toast({ title: "PDF generation failed", variant: "destructive" });
    }
    setGeneratingPdf(false);
  };

  const handleShare = async () => {
    const url = window.location.href;
    const shareDescription = htmlToPlainText(article?.excerpt || author?.bio || "", 155);
    if (navigator.share) {
      try { await navigator.share({ title: article?.title, text: shareDescription, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Link copied to clipboard!" });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
      </main>
    );
  }

  if (!article || !author) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Article not found.</p>
        <Link to="/" className="text-primary text-sm underline">Back to Home</Link>
      </main>
    );
  }

  
  const publishedAt = article.published_at || article.created_at;
  const galleryThumbs = article.photo_gallery.slice(0, 3);
  const plainShareDescription = htmlToPlainText(article.excerpt || author.bio || "", 155) || undefined;

  return (
    <main ref={pageRootRef} className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={article.title}
        description={plainShareDescription}
        ogImage={article.cover_image_url || undefined}
        ogType="article"
        jsonLd={{
          type: "Article",
          headline: article.title,
          description: plainShareDescription,
          image: article.cover_image_url || undefined,
          datePublished: publishedAt,
          authorName: author.name || undefined,
        }}
      />

      {/* Cover */}
      {article.cover_image_url && (
        <div data-pdf-section="cover" className="relative h-[40vh] md:h-[56vh] overflow-hidden">
          <img
            loading="eager"
            decoding="async"
            fetchPriority="high"
            src={article.cover_image_url}
            alt={article.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        </div>
      )}

      <div className="container mx-auto max-w-6xl px-4 md:px-8 py-8 md:py-16">
        <Breadcrumbs
          items={[{ label: "Home", to: "/" }, { label: article.title }]}
          className="mb-8"
        />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-10 lg:gap-16">
          {/* Main column */}
          <article data-pdf-section="article" className="max-w-[720px] mx-auto lg:mx-0 w-full">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              {/* Featured Artist label */}
              <div className="flex items-center gap-3 mb-5">
                <Palette className="h-4 w-4 text-primary" />
                <span
                  className="text-[10px] tracking-[0.35em] uppercase text-primary"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Featured Artist
                </span>
              </div>

              {/* Tags */}
              {article.tags.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-6">
                  {article.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground flex items-center gap-1"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <h1
                className="text-3xl md:text-5xl lg:text-6xl font-light tracking-tight mb-6 leading-[1.05]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {article.title}
              </h1>

              {/* Lead / excerpt */}
              {article.excerpt && (
                <p
                  className="text-lg md:text-2xl text-muted-foreground leading-relaxed mb-8 italic font-light"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {article.excerpt}
                </p>
              )}

              {/* Meta row */}
              <div
                className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground mb-8 pb-6 border-b border-border"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <span className="inline-flex items-center">
                  {author.id ? (
                    <UserIdentityBlock
                      userId={author.id}
                      name={author.name}
                      linkTo={`/profile/${author.id}`}
                      nameClassName="tracking-[0.1em] uppercase hover:text-primary hover:underline transition-colors"
                    />
                  ) : (
                    <span className="tracking-[0.1em] uppercase">{author.name}</span>
                  )}
                </span>
                <span className="flex items-center gap-1 tracking-[0.1em]">
                  <Clock className="h-3 w-3" />
                  {new Date(publishedAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={handleShare}
                    className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded-sm transition-colors"
                    title="Share"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
                    Share
                  </button>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={generatingPdf}
                    className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded-sm transition-colors disabled:opacity-50"
                    title="Download PDF"
                  >
                    <Download className="h-3 w-3" />
                    {generatingPdf ? "…" : "PDF"}
                  </button>
                </div>
              </div>

              {/* Inline Artist Spotlight (mobile/tablet only) */}
              <div className="lg:hidden">
                <ArtistSpotlight
                  author={author}
                  galleryThumbs={galleryThumbs}
                  onThumbClick={setLightboxImg}
                  layout="inline"
                />
              </div>

              {/* Body — rich HTML from the admin editor.
                  Legacy `[img:url]` markers are converted to <img> first. */}
              <div
                className="featured-article-body text-foreground/85
                  [&_p]:text-[17px] md:[&_p]:text-[19px] [&_p]:leading-[1.8] [&_p]:mb-6
                  [&_h1]:text-3xl [&_h1]:md:text-4xl [&_h1]:font-light [&_h1]:tracking-tight [&_h1]:mt-12 [&_h1]:mb-5
                  [&_h2]:text-2xl [&_h2]:md:text-3xl [&_h2]:font-light [&_h2]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-4
                  [&_h3]:text-xl [&_h3]:font-medium [&_h3]:mt-8 [&_h3]:mb-3
                  [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-6 [&_ul]:space-y-2
                  [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-6 [&_ol]:space-y-2
                  [&_li]:text-[17px] md:[&_li]:text-[19px] [&_li]:leading-[1.7]
                  [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                  [&_strong]:text-foreground [&_strong]:font-semibold
                  [&_em]:italic
                  [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-5 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-6
                  [&_img]:w-full [&_img]:rounded-sm [&_img]:my-8 [&_img]:cursor-pointer
                  [&_hr]:my-8 [&_hr]:border-border"
                style={{ fontFamily: "var(--font-body)" }}
                onClick={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.tagName === "IMG") {
                    const src = (t as HTMLImageElement).src;
                    if (src) setLightboxImg(src);
                  }
                }}
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    article.body.replace(
                      /\[img:(.*?)\]/g,
                      (_m, url) => `<img src="${url.trim()}" alt="" />`
                    )
                  ),
                }}
              />

              {/* Photo gallery */}
              {article.photo_gallery.length > 0 && (
                <div className="mt-16">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-px bg-primary" />
                    <span
                      className="text-[10px] tracking-[0.3em] uppercase text-primary"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      Gallery
                    </span>
                  </div>
                  <div className="columns-2 md:columns-3 gap-3 space-y-3">
                    {article.photo_gallery.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Gallery photo ${i + 1}`}
                        className="w-full object-cover break-inside-avoid cursor-pointer hover:brightness-75 transition-all duration-500 rounded-sm"
                        loading="lazy"
                        onClick={() => setLightboxImg(url)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </article>

          {/* Sidebar (desktop only) */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <ArtistSpotlight
                author={author}
                galleryThumbs={galleryThumbs}
                onThumbClick={setLightboxImg}
                layout="rail"
              />
            </div>
          </aside>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex items-center justify-center p-6 cursor-pointer"
          onClick={() => setLightboxImg(null)}
        >
          <img
            loading="lazy"
            decoding="async"
            src={lightboxImg}
            alt="Enlarged view"
            className="max-w-full max-h-[85vh] object-contain"
          />
        </div>
      )}
    </main>
  );
};

export default FeaturedArtistPage;
