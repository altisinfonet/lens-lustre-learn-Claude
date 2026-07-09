import { memo, useMemo } from "react";
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

const GalleryMasonry = memo(({ works, onImageClick, optimizeUrl }: Props) => {
  const aspectRatios = useMemo(() => {
    const ratios = ["aspect-[3/4]", "aspect-square", "aspect-[4/5]", "aspect-[3/2]", "aspect-[2/3]", "aspect-[4/3]"];
    return works.map((_, i) => ratios[i % ratios.length]);
  }, [works.length]);

  if (works.length === 0) return null;

  return (
    <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-1.5 space-y-1.5">
      {works.map((work, i) => (
        <div
          key={work.id || `${work.src}-${i}`}
          className={`group relative overflow-hidden rounded-sm cursor-pointer bg-muted break-inside-avoid ${aspectRatios[i]}`}
          onClick={() => onImageClick(i)}
        >
          <GalleryImage
            src={work.thumbnail || work.src}
            alt={`${work.title} — ${work.category}`}
            category={work.category}
            className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110 group-hover:brightness-75"
            eager={i < 6}
            isHero={i === 0}
            sizes="(min-width: 1280px) 16vw, (min-width: 768px) 25vw, 50vw"
            optimizeUrl={optimizeUrl}
          />
          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-background/80 to-transparent translate-y-full group-hover:translate-y-0 transition-transform duration-400 z-10">
            <p className="text-[8px] tracking-[0.2em] uppercase text-primary" style={headingFont}>{work.category}</p>
            <p className="text-[11px] font-light text-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>{work.title}</p>
          </div>
          {work.is_trending && (
            <span className="absolute top-1 left-1 text-[7px] tracking-[0.15em] uppercase px-1 py-0.5 bg-primary text-primary-foreground rounded-sm z-10" style={headingFont}>🔥</span>
          )}
          {(work.view_count || 0) > 0 && (
            <span className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 text-[7px] px-1 py-0.5 bg-background/70 backdrop-blur-sm text-foreground/80 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <Eye className="h-2.5 w-2.5" /> {(work.view_count || 0).toLocaleString()}
            </span>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-background/40 z-10">
            <Expand className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      ))}
    </div>
  );
});

GalleryMasonry.displayName = "GalleryMasonry";
export default GalleryMasonry;
