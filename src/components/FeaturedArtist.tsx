import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Palette, ArrowRight, ImageOff } from "lucide-react";

interface FeaturedArtistData {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  artist_name: string | null;
  artist_avatar_url: string | null;
}

const slowEase = [0.25, 0.1, 0.25, 1] as const;

export default function FeaturedArtist() {
  const { data: artist = null, isLoading: loading } = useQuery({
    queryKey: ["featured-artist-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("featured_artists")
        .select("id, title, slug, excerpt, cover_image_url, artist_name, artist_avatar_url")
        .eq("is_active", true)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as FeaturedArtistData | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });

  // Loading skeleton
  if (loading) {
    return (
      <div className="flex flex-col animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-4 w-4 rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
        </div>
        <div className="aspect-square bg-muted rounded-sm mb-4" />
      </div>
    );
  }

  // Empty state fallback
  if (!artist) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 1, delay: 0.15, ease: slowEase }}
        className="flex flex-col"
      >
        <div className="flex items-center gap-3 mb-4">
          <Palette className="h-4 w-4 text-primary" />
          <span
            className="text-[10px] tracking-[0.35em] uppercase text-primary"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Featured Artist
          </span>
        </div>
        <div className="aspect-square bg-muted/30 rounded-sm mb-4 flex flex-col items-center justify-center border border-border/50">
          <ImageOff className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <span className="text-xs text-muted-foreground/50" style={{ fontFamily: "var(--font-body)" }}>
            Coming Soon
          </span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 1, delay: 0.15, ease: slowEase }}
      className="flex flex-col"
    >
      {/* Label */}
      <div className="flex items-center gap-3 mb-4">
        <Palette className="h-4 w-4 text-primary" />
        <span
          className="text-[10px] tracking-[0.35em] uppercase text-primary"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Featured Artist
        </span>
      </div>

      {/* Image with hover overlay */}
      <Link
        to={`/featured-artist/${artist.slug}`}
        className="group relative overflow-hidden rounded-sm aspect-square bg-muted mb-4 block"
      >
        {artist.cover_image_url ? (
          <motion.img
            src={artist.cover_image_url}
            alt={artist.title}
            className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            initial={{ scale: 1.06 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 5, ease: slowEase }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/10 to-muted flex items-center justify-center">
            <Palette className="h-16 w-16 text-primary/20" />
          </div>
        )}

        {/* Dark overlay on hover */}
        <div className="absolute inset-0 bg-background/0 group-hover:bg-background/70 transition-all duration-500" />

        {/* Content that slides up on hover */}
        <div className="absolute inset-0 flex flex-col justify-end p-5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out">
          <h3
            className="text-xl md:text-2xl font-light tracking-tight text-foreground mb-2"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {artist.title}
          </h3>
          <div className="w-10 h-px bg-primary mb-3" />
          {artist.artist_name && (
            <div className="flex items-center gap-3 mb-2">
              {artist.artist_avatar_url && (
                <img loading="lazy" decoding="async"
                  src={artist.artist_avatar_url}
                  alt={artist.artist_name}
                  className="h-6 w-6 rounded-full object-cover border border-border"
                />
              )}
              <span className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {artist.artist_name}
              </span>
            </div>
          )}
          {artist.excerpt && (
            <p
              className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2 mb-3"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {artist.excerpt}
            </p>
          )}
          <span
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-primary"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Read More
            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform duration-500" />
          </span>
        </div>

        {/* Artist badge - always visible */}
        {artist.artist_name && (
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1.5">
            {artist.artist_avatar_url && (
              <img loading="lazy" decoding="async"
                src={artist.artist_avatar_url}
                alt={artist.artist_name}
                className="h-4 w-4 rounded-full object-cover"
              />
            )}
            <span
              className="text-[9px] tracking-[0.15em] uppercase text-foreground"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {artist.artist_name}
            </span>
          </div>
        )}

        {/* Bottom gradient - hidden on hover */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/40 to-transparent group-hover:opacity-0 transition-opacity duration-500" />
      </Link>
    </motion.div>
  );
}
