import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence, motion } from "framer-motion";
import { Star, Camera, Calendar, ImageOff } from "lucide-react";

interface POTD {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  title: string;
  photographer_name: string | null;
  description: string | null;
  featured_date: string;
}

const CYCLE_MS = 5000; // 5 seconds per photo

export default function PhotoOfTheDay() {
  const [current, setCurrent] = useState(0);

  const { data: photos = [], isLoading: loading } = useQuery({
    queryKey: ["photo-of-the-day"],
    queryFn: async () => {
      const { data } = await supabase
        .from("photo_of_the_day")
        .select("id, image_url, thumbnail_url, title, photographer_name, description, featured_date")
        .eq("is_active", true)
        .order("featured_date", { ascending: false })
        .limit(20);
      return (data as POTD[]) || [];
    },
    staleTime: 5 * 60_000,
  });

  // Auto-cycle through photos
  useEffect(() => {
    if (photos.length <= 1) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % photos.length);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [photos.length]);

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
  if (photos.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 1 }}
        className="flex flex-col"
      >
        <div className="flex items-center gap-3 mb-4">
          <Star className="h-4 w-4 text-primary fill-primary" />
          <span className="text-[10px] tracking-[0.35em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
            Photo of the Day
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

  const potd = photos[current];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 1 }}
      className="flex flex-col"
    >
      {/* Label */}
      <div className="flex items-center gap-3 mb-4">
        <Star className="h-4 w-4 text-primary fill-primary" />
        <span className="text-[10px] tracking-[0.35em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
          Photo of the Day
        </span>
      </div>

      {/* Image with fade transition */}
      <div className="group relative overflow-hidden rounded-sm aspect-square bg-muted mb-4 cursor-pointer">
        <AnimatePresence mode="wait">
          <motion.img
            key={potd.id}
            src={potd.thumbnail_url || potd.image_url}
            alt={potd.title}
            className="absolute inset-0 w-full h-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            loading="lazy"
            decoding="async"
          />
        </AnimatePresence>

        {/* Dark overlay on hover */}
        <div className="absolute inset-0 bg-background/0 group-hover:bg-background/70 transition-all duration-500 z-10" />

        {/* Content that slides up on hover */}
        <div className="absolute inset-0 flex flex-col justify-end p-5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out z-20">
          <h3 className="text-xl md:text-2xl font-light tracking-tight text-foreground mb-2" style={{ fontFamily: "var(--font-display)" }}>
            {potd.title}
          </h3>
          <div className="w-10 h-px bg-primary mb-3" />
          {potd.photographer_name && (
            <div className="flex items-center gap-2 mb-2">
              <Camera className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {potd.photographer_name}
              </span>
            </div>
          )}
          {potd.description && (
            <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2" style={{ fontFamily: "var(--font-body)" }}>
              {potd.description}
            </p>
          )}
        </div>

        {/* Date badge - always visible */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1.5 z-20">
          <Calendar className="h-3 w-3 text-primary" />
          <span className="text-[9px] tracking-[0.15em] uppercase text-foreground" style={{ fontFamily: "var(--font-body)" }}>
            {new Date(potd.featured_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>

        {/* Photo counter */}
        {photos.length > 1 && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1.5 z-20">
            <span className="text-[9px] tracking-[0.1em] text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {current + 1} / {photos.length}
            </span>
          </div>
        )}

        {/* Dot indicators */}
        {photos.length > 1 && photos.length <= 10 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${
                  i === current ? "bg-primary scale-125" : "bg-foreground/30"
                }`}
              />
            ))}
          </div>
        )}

        {/* Bottom gradient - hidden on hover */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/40 to-transparent group-hover:opacity-0 transition-opacity duration-500 z-10" />
      </div>
    </motion.div>
  );
}
