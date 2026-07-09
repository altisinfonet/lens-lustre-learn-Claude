import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import { Clock, Tag, Download, Share2, Check, ArrowRight } from "lucide-react";
import CommentsSection from "@/components/CommentsSection";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { generateArticlePdf } from "@/lib/generateArticlePdf";
import PageSEO from "@/components/PageSEO";
import { toast } from "@/hooks/core/use-toast";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import Breadcrumbs from "@/components/Breadcrumbs";

interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  tags: string[];
  photo_gallery: string[];
  published_at: string | null;
  created_at: string;
  author_id: string;
}

interface AuthorInfo {
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

/** Convert legacy [img:URL] block format to HTML if needed */
function ensureHtmlBody(rawBody: string): string {
  if (!rawBody) return "";
  if (/<[a-z][\s\S]*>/i.test(rawBody)) return rawBody;
  const parts = rawBody.split("\n\n");
  return parts
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      const imgMatch = trimmed.match(/^\[img:(.*?)\]$/);
      if (imgMatch)
        return `<div class="my-8"><img src="${imgMatch[1]}" alt="Article image" loading="lazy" /></div>`;
      return `<p>${trimmed}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

const AuthorCard = ({
  authorId,
  author,
  publishedAt,
  variant,
}: {
  authorId: string;
  author: AuthorInfo | null;
  publishedAt: string;
  variant: "inline" | "sidebar";
}) => {
  const date = new Date(publishedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (variant === "sidebar") {
    return (
      <div className="border border-border rounded-sm p-5 bg-card/40">
        <span
          className="text-[9px] tracking-[0.25em] uppercase text-primary block mb-4"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          About the Author
        </span>
        <Link to={`/profile/${authorId}`} className="flex items-center gap-3 mb-3 group">
          {author?.avatar_url ? (
            <img
              src={author.avatar_url}
              alt={author.full_name || ""}
              className="h-12 w-12 rounded-full object-cover border border-border"
              loading="lazy"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
              {(author?.full_name || "?")[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate"
              style={{ fontFamily: "var(--font-display)" }}>
              {author?.full_name || "Unknown"}
            </div>
            <div className="text-[11px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {date}
            </div>
          </div>
        </Link>
        {author?.bio && (
          <p className="text-xs text-muted-foreground leading-relaxed mb-4 line-clamp-4"
            style={{ fontFamily: "var(--font-body)" }}>
            {author.bio}
          </p>
        )}
        <Link
          to={`/profile/${authorId}`}
          className="inline-flex items-center gap-1 text-[11px] tracking-[0.15em] uppercase text-primary hover:gap-2 transition-all"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          View Profile <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  // inline (mobile/tablet)
  return (
    <div className="flex items-start gap-4 border-y border-border py-5 my-8">
      <Link to={`/profile/${authorId}`} className="shrink-0">
        {author?.avatar_url ? (
          <img
            src={author.avatar_url}
            alt={author.full_name || ""}
            className="h-14 w-14 rounded-full object-cover border border-border"
            loading="lazy"
          />
        ) : (
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center font-semibold text-muted-foreground">
            {(author?.full_name || "?")[0]?.toUpperCase()}
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <span
          className="text-[9px] tracking-[0.25em] uppercase text-primary block mb-1"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Written by
        </span>
        <Link to={`/profile/${authorId}`} className="block">
          <div className="text-base font-medium text-foreground hover:text-primary transition-colors"
            style={{ fontFamily: "var(--font-display)" }}>
            {author?.full_name || "Unknown"}
          </div>
        </Link>
        {author?.bio && (
          <p className="text-sm text-muted-foreground leading-relaxed mt-1.5 line-clamp-3"
            style={{ fontFamily: "var(--font-body)" }}>
            {author.bio}
          </p>
        )}
      </div>
    </div>
  );
};

interface OtherArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  created_at: string;
}

const JournalArticle = () => {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [author, setAuthor] = useState<AuthorInfo | null>(null);
  const [others, setOthers] = useState<OtherArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("journal_articles")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();

      if (data) {
        setArticle(data);
        const [{ data: profile }, { data: otherRows }] = await Promise.all([
          profilesPublic()
            .select("full_name, avatar_url, bio")
            .eq("id", data.author_id)
            .maybeSingle(),
          supabase
            .from("journal_articles")
            .select("id, slug, title, excerpt, cover_image_url, published_at, created_at")
            .eq("status", "published")
            .neq("id", data.id)
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(5),
        ]);
        setAuthor({
          full_name: profile?.full_name || null,
          avatar_url: (profile as any)?.avatar_url || null,
          bio: (profile as any)?.bio || null,
        });
        setOthers((otherRows as OtherArticle[]) || []);
      }
      setLoading(false);
    };
    fetch();
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
          authorName: author?.full_name || null,
          authorAvatarUrl: author?.avatar_url || null,
          authorBio: author?.bio || null,
          publishedAt: article.published_at || article.created_at,
          tags: article.tags,
          gallery: article.photo_gallery,
          sectionLabel: "JOURNAL",
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
    if (navigator.share) {
      try {
        await navigator.share({ title: article?.title, url });
      } catch {}
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

  if (!article) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Article not found.</p>
        <Link to="/journal" className="text-primary text-sm underline">
          Back to Journal
        </Link>
      </main>
    );
  }

  const htmlBody = ensureHtmlBody(article.body);
  const publishedAt = article.published_at || article.created_at;
  const readingTimeMin = Math.max(1, Math.round((article.body || "").replace(/<[^>]+>/g, " ").split(/\s+/).length / 220));

  return (
    <main ref={pageRootRef} className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={article.title}
        description={article.excerpt || undefined}
        ogImage={article.cover_image_url || undefined}
        ogType="article"
        jsonLd={{
          type: "Article",
          headline: article.title,
          description: article.excerpt || undefined,
          image: article.cover_image_url || undefined,
          datePublished: publishedAt,
          authorName: author?.full_name || undefined,
        }}
      />

      {/* Cover */}
      {article.cover_image_url && (
        <div data-pdf-section="cover" className="relative h-[38vh] md:h-[56vh] overflow-hidden">
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
          items={[{ label: "Journal", to: "/journal" }, { label: article.title }]}
          className="mb-8"
        />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-10 lg:gap-16">
          {/* Main column */}
          <article data-pdf-section="article" className="max-w-[720px] mx-auto lg:mx-0 w-full">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              {/* Tags */}
              {article.tags.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-6">
                  {article.tags.map((tag) => (
                    <Link
                      key={tag}
                      to={`/journal?tag=${encodeURIComponent(tag)}`}
                      className="text-[10px] tracking-[0.2em] uppercase text-primary hover:text-primary/80 hover:underline underline-offset-4 flex items-center gap-1 transition-colors"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </Link>
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
                className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground mb-6 pb-6 border-b border-border"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <span className="inline-flex items-center">
                  <UserIdentityBlock
                    userId={article.author_id}
                    name={author?.full_name || "Unknown"}
                    linkTo={`/profile/${article.author_id}`}
                    nameClassName="tracking-[0.1em] uppercase hover:text-primary hover:underline transition-colors"
                  />
                </span>
                <span className="flex items-center gap-1 tracking-[0.1em]">
                  <Clock className="h-3 w-3" />
                  {new Date(publishedAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <span className="tracking-[0.1em] text-muted-foreground/70">{readingTimeMin} min read</span>

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

              {/* Inline author card (mobile/tablet only) */}
              <div className="lg:hidden">
                <AuthorCard
                  authorId={article.author_id}
                  author={author}
                  publishedAt={publishedAt}
                  variant="inline"
                />
              </div>

              {/* Body */}
              <div
                className="prose-editorial prose-editorial-dropcap max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlBody) }}
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
                      Photo Gallery
                    </span>
                  </div>
                  <div className="columns-1 md:columns-2 gap-3 space-y-3">
                    {article.photo_gallery.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`${article.title} gallery photo ${i + 1}`}
                        className="w-full object-cover break-inside-avoid cursor-pointer hover:brightness-75 transition-all duration-500 rounded-sm"
                        loading="lazy"
                        onClick={() => setLightboxImg(url)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Comments */}
              {/* Other Articles (mobile/tablet only — desktop shows in sidebar) */}
              {others.length > 0 && (
                <div className="lg:hidden mt-16">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-px bg-primary" />
                    <span
                      className="text-[10px] tracking-[0.3em] uppercase text-primary"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      Other Articles
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {others.slice(0, 4).map((o) => (
                      <Link
                        key={o.id}
                        to={`/journal/${o.slug}`}
                        className="group border border-border rounded-sm overflow-hidden bg-card/40 hover:border-primary/50 transition-colors"
                      >
                        {o.cover_image_url && (
                          <img
                            src={o.cover_image_url}
                            alt={o.title}
                            loading="lazy"
                            className="w-full h-32 object-cover group-hover:brightness-110 transition"
                          />
                        )}
                        <div className="p-3">
                          <h4
                            className="text-sm leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2"
                            style={{ fontFamily: "var(--font-display)" }}
                          >
                            {o.title}
                          </h4>
                          <span
                            className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground/70 mt-1.5 block"
                            style={{ fontFamily: "var(--font-heading)" }}
                          >
                            {new Date(o.published_at || o.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-16">
                <CommentsSection articleId={article.id} />
              </div>
            </motion.div>
          </article>

          {/* Sidebar (desktop only) */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-6">
              <AuthorCard
                authorId={article.author_id}
                author={author}
                publishedAt={publishedAt}
                variant="sidebar"
              />
              {article.tags.length > 0 && (
                <div className="border border-border rounded-sm p-5 bg-card/40">
                  <span
                    className="text-[9px] tracking-[0.25em] uppercase text-primary block mb-3"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    Topics
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {article.tags.map((tag) => (
                      <Link
                        key={tag}
                        to={`/journal?tag=${encodeURIComponent(tag)}`}
                        className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-primary hover:border-primary border border-border px-2 py-1 rounded-sm transition-colors"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {others.length > 0 && (
                <div className="border border-border rounded-sm p-5 bg-card/40">
                  <div className="flex items-center justify-between mb-4">
                    <span
                      className="text-[9px] tracking-[0.25em] uppercase text-primary"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      Other Articles
                    </span>
                    <Link
                      to="/journal"
                      className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      All <ArrowRight className="h-2.5 w-2.5" />
                    </Link>
                  </div>
                  <ul className="space-y-4">
                    {others.map((o) => (
                      <li key={o.id}>
                        <Link
                          to={`/journal/${o.slug}`}
                          className="group flex gap-3 items-start"
                        >
                          {o.cover_image_url ? (
                            <img
                              src={o.cover_image_url}
                              alt={o.title}
                              loading="lazy"
                              className="h-14 w-14 shrink-0 object-cover rounded-sm border border-border group-hover:brightness-110 transition"
                            />
                          ) : (
                            <div className="h-14 w-14 shrink-0 rounded-sm bg-muted border border-border" />
                          )}
                          <div className="min-w-0 flex-1">
                            <h4
                              className="text-[13px] leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2"
                              style={{ fontFamily: "var(--font-display)" }}
                            >
                              {o.title}
                            </h4>
                            <span
                              className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground/70 mt-1 block"
                              style={{ fontFamily: "var(--font-heading)" }}
                            >
                              {new Date(o.published_at || o.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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

export default JournalArticle;
