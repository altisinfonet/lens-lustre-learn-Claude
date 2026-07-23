import { useEffect, useState } from "react";
import PageSEO from "@/components/PageSEO";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Tag, PenLine } from "lucide-react";
import EngagementFooter from "@/components/EngagementFooter";
import AdPlacement from "@/components/AdPlacement";
import { useAdZonesV2Enabled } from "@/lib/ads/useAdZonesV2Enabled";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useJournal, JournalArticle } from "@/hooks/content/useJournal";

const Journal = () => {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { data: articles = [], isLoading: loading } = useJournal();
  const adZonesV2 = useAdZonesV2Enabled();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTag = searchParams.get("tag");
  const setSelectedTag = (tag: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (tag) next.set("tag", tag);
    else next.delete("tag");
    setSearchParams(next, { replace: false });
  };
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    const checkEditorAccess = async () => {
      if (!user) return setCanEdit(false);
      if (isAdmin) return setCanEdit(true);
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "content_editor")
        .maybeSingle();
      setCanEdit(!!data);
    };
    checkEditorAccess();
  }, [user, isAdmin]);

  const allTags = [...new Set(articles.flatMap((a) => a.tags))];
  const filtered = selectedTag
    ? articles.filter((a) => a.tags.includes(selectedTag))
    : articles;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO title="Journal" description="Photography journal articles and stories." />

      <div className="container mx-auto py-6 md:py-24">
        {/* Above-Journal Ad */}
        {adZonesV2 !== true && (
          <div className="mb-6 md:mb-10">
            <AdPlacement placement="above-journal" variant="plain" />
          </div>
        )}

        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-px bg-primary" />
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              Photography Journal
            </span>
          </div>
          <h1 className="text-2xl md:text-7xl font-light tracking-tight mb-3 md:mb-6" style={{ fontFamily: "var(--font-display)" }}>
            Stories & <em className="italic">Insights</em>
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground max-w-lg leading-relaxed mb-6 md:mb-12" style={{ fontFamily: "var(--font-body)" }}>
            Dive into articles, behind-the-scenes stories, and photography techniques from our community of creators.
          </p>
        </motion.div>

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="flex gap-2 mb-6 md:mb-12 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setSelectedTag(null)}
              className={`text-[10px] tracking-[0.15em] uppercase px-3 md:px-4 py-1.5 md:py-2 border rounded-full md:rounded-none transition-all duration-300 whitespace-nowrap ${
                !selectedTag
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`text-[10px] tracking-[0.15em] uppercase px-3 md:px-4 py-1.5 md:py-2 border rounded-full md:rounded-none transition-all duration-300 whitespace-nowrap ${
                  selectedTag === tag
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-8">
            <div className="animate-pulse">
              <div className="h-80 md:h-[28rem] bg-muted mb-6" />
              <div className="h-6 bg-muted w-2/3 mb-3" />
              <div className="h-4 bg-muted w-1/2" />
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-muted-foreground text-sm" style={{ fontFamily: "var(--font-body)" }}>
              No articles published yet. Check back soon.
            </p>
          </div>
        ) : (
          <>
            {/* Featured Hero Article */}
            {(() => {
              const hero = filtered[0];
              const rest = filtered.slice(1);
              return (
                <>
                  <motion.article
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1 }}
                    className="mb-8 md:mb-16"
                  >
                    <Link to={`/journal/${hero.slug}`} className="group block">
                      <div className="grid md:grid-cols-2 gap-4 md:gap-8 items-center">
                        {hero.cover_image_url && (
                          <div className="relative overflow-hidden">
                            <img
                              src={hero.cover_image_url}
                              alt={hero.title}
                              className="w-full h-48 md:h-[26rem] object-cover transition-transform duration-[1.5s] group-hover:scale-[1.03] rounded-xl md:rounded-none"
                              loading="eager"
                            />
                            <div className="absolute top-4 left-4">
                              <span
                                className="text-[9px] tracking-[0.25em] uppercase px-3 py-1.5 bg-primary text-primary-foreground"
                                style={{ fontFamily: "var(--font-heading)" }}
                              >
                                Featured
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-col justify-center">
                          {hero.tags.length > 0 && (
                            <div className="flex gap-3 mb-4">
                              {hero.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[9px] tracking-[0.2em] uppercase text-primary"
                                  style={{ fontFamily: "var(--font-heading)" }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <h2
                            className="text-xl md:text-5xl font-light mb-3 md:mb-4 group-hover:text-primary transition-colors duration-500 leading-tight"
                            style={{ fontFamily: "var(--font-display)" }}
                          >
                            {hero.title}
                          </h2>
                          {hero.excerpt && (
                            <p
                              className="text-sm text-muted-foreground leading-relaxed mb-6 line-clamp-3"
                              style={{ fontFamily: "var(--font-body)" }}
                            >
                              {hero.excerpt}
                            </p>
                          )}
                          <div className="flex items-center gap-4 text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                            <Link to={`/profile/${hero.author_id}`} className="hover:text-primary hover:underline transition-colors">{hero.profiles?.full_name || "Unknown"}</Link>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(hero.published_at || hero.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                          <EngagementFooter id={hero.id} createdAt={hero.published_at || hero.created_at} wordCount={200} className="mt-3 px-0" />
                          <div className="mt-6 flex items-center gap-2 text-xs tracking-[0.15em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                            Read Article <ArrowRight className="h-3.5 w-3.5" />
                          </div>
                        </div>
                      </div>
                    </Link>
                  </motion.article>

                  {/* Divider */}
                  {rest.length > 0 && (
                    <div className="flex items-center gap-4 mb-6 md:mb-12">
                      <div className="w-12 h-px bg-border" />
                      <span className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                        More Stories
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}

                  {/* Remaining Articles Grid */}
                  {rest.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
                      {rest.map((article, i) => (
                        <motion.article
                          key={article.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1, duration: 0.8 }}
                        >
                          <Link to={`/journal/${article.slug}`} className="group block">
                            {article.cover_image_url && (
                              <div className="relative overflow-hidden mb-3 md:mb-4 rounded-xl md:rounded-none">
                                <img
                                  src={article.cover_image_url}
                                  alt={article.title}
                                  className="w-full h-40 md:h-56 object-cover transition-transform duration-[1.5s] group-hover:scale-[1.03]"
                                  loading="lazy"
                                />
                              </div>
                            )}
                            {article.tags.length > 0 && (
                              <div className="flex gap-2 mb-3">
                                {article.tags.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-[9px] tracking-[0.2em] uppercase text-primary"
                                    style={{ fontFamily: "var(--font-heading)" }}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            <h2
                              className="text-xl md:text-2xl font-light mb-2 group-hover:text-primary transition-colors duration-500"
                              style={{ fontFamily: "var(--font-display)" }}
                            >
                              {article.title}
                            </h2>
                            {article.excerpt && (
                              <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2" style={{ fontFamily: "var(--font-body)" }}>
                                {article.excerpt}
                              </p>
                            )}
                            <div className="flex items-center gap-4 text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                              <Link to={`/profile/${article.author_id}`} className="hover:text-primary hover:underline transition-colors">{article.profiles?.full_name || "Unknown"}</Link>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(article.published_at || article.created_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                            </div>
                            <EngagementFooter id={article.id} createdAt={article.published_at || article.created_at} wordCount={150} className="mt-2 px-0" />
                          </Link>
                        </motion.article>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* Below-Journal Ad */}
        {adZonesV2 !== true && (
          <div className="mt-10 md:mt-16">
            <AdPlacement placement="below-journal" variant="plain" />
          </div>
        )}
      </div>
    </main>
  );
};

export default Journal;
