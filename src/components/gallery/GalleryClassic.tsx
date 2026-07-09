import { memo } from "react";
import { Eye, Expand } from "lucide-react";
import GalleryImage from "./GalleryImage";

interface GalleryItem {
  id?: string;
  src: string;
  thumbnail?: string;
  title: string;
  category: string;
  is_pinned?: boolean;
  is_trending?: boolean;
  view_count?: number;
}

interface Props {
  works: GalleryItem[];
  onImageClick: (index: number) => void;
  optimizeUrl: (url: string, isHero: boolean) => string;
}

const headingFont = { fontFamily: "var(--font-heading)" };

const GalleryClassic = memo(({ works, onImageClick, optimizeUrl }: Props) => {
  if (works.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1 sm:gap-1.5">
      {works.map((work, i) => (
        <div
          key={work.id || `${work.src}-${i}`}
          className="group relative overflow-hidden rounded-sm cursor-pointer bg-muted aspect-square"
          onClick={() => onImageClick(i)}
        >
          <GalleryImage
            src={work.thumbnail || work.src}
            alt={`${work.title} — ${work.category}`}
            category={work.category}
            className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110 group-hover:brightness-75"
            eager={i < 10}
            fetchPriority={i === 0 ? "high" : "low"}
            sizes="(min-width: 1280px) 10vw, (min-width: 1024px) 12vw, (min-width: 768px) 16vw, 50vw"
            optimizeUrl={optimizeUrl}
          />
          {work.is_trending && (
            <div className="absolute top-1.5 left-1.5 z-10">
              <span className="inline-flex items-center gap-1 text-[7px] tracking-[0.15em] uppercase px-1.5 py-0.5 bg-primary text-primary-foreground rounded-sm" style={headingFont}>🔥 Trending</span>
            </div>
          )}
          {work.is_pinned && (
            <div className={`absolute ${work.is_trending ? "top-6" : "top-1.5"} left-1.5 z-10`}>
              <span className="inline-flex items-center gap-0.5 text-[7px] tracking-[0.15em] uppercase px-1.5 py-0.5 bg-background/80 backdrop-blur-sm text-primary border border-primary/30 rounded-sm" style={headingFont}>📌 Pinned</span>
            </div>
          )}
          {(work.view_count || 0) > 0 && (
            <div className="absolute bottom-1.5 right-1.5 z-10 opacity-80">
              <span className="inline-flex items-center gap-0.5 text-[7px] px-1.5 py-0.5 bg-background/70 backdrop-blur-sm text-foreground/80 rounded-sm">
                <Eye className="h-2.5 w-2.5" /> {(work.view_count || 0).toLocaleString()}
              </span>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-background/60 z-10">
            <Expand className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      ))}
    </div>
  );
});

GalleryClassic.displayName = "GalleryClassic";
export default GalleryClassic;
