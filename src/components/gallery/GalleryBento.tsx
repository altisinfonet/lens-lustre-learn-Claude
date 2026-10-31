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

const GalleryBento = memo(({ works, onImageClick, optimizeUrl }: Props) => {
  if (works.length === 0) return null;

  const getSizeClass = (i: number): string => {
    if (i === 0) return "col-span-2 row-span-2 sm:col-span-3 sm:row-span-3";
    if (i === 1 || i === 8) return "col-span-2 row-span-1";
    if (i === 4 || i === 12) return "col-span-1 row-span-2";
    return "col-span-1 row-span-1";
  };

  const getAspect = (i: number): string => {
    if (i === 0) return "";
    if (i === 1 || i === 8) return "aspect-[2/1]";
    if (i === 4 || i === 12) return "aspect-[1/2]";
    return "aspect-square";
  };

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 auto-rows-[minmax(80px,1fr)] gap-1 sm:gap-1.5">
      {works.map((work, i) => (
        <div
          key={work.id || `${work.src}-${i}`}
          className={`group relative overflow-hidden rounded-sm cursor-pointer bg-muted ${getSizeClass(i)} ${getAspect(i)}`}
          onClick={() => onImageClick(i)}
        >
          <GalleryImage
            src={i === 0 ? work.src : (work.thumbnail || work.src)}
            alt={`${work.title} — ${work.category}`}
            category={work.category}
            className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110 group-hover:brightness-75"
            eager={i < 4}
            isHero={i === 0}
            fetchPriority={i === 0 ? "high" : "auto"}
            sizes={i === 0 ? "(min-width: 1280px) 30vw, (min-width: 768px) 37vw, 50vw" : "(min-width: 1280px) 10vw, (min-width: 768px) 12vw, 25vw"}
            optimizeUrl={optimizeUrl}
          />
          {i === 0 && (
            <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10">
              <p className="text-[9px] tracking-[0.3em] uppercase text-primary mb-1" style={headingFont}>{work.category}</p>
              <p className="text-sm font-light text-foreground" style={{ fontFamily: "var(--font-display)" }}>{work.title}</p>
            </div>
          )}
          {work.is_trending && (
            <span className="absolute top-1 left-1 text-[7px] tracking-[0.15em] uppercase px-1 py-0.5 bg-primary text-primary-foreground rounded-sm z-10" style={headingFont}>🔥</span>
          )}
          {(work.view_count || 0) > 0 && (
            <span className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 text-[7px] px-1 py-0.5 bg-background/70 backdrop-blur-sm text-foreground/80 rounded-sm z-10">
              <Eye className="h-2.5 w-2.5" /> {(work.view_count || 0).toLocaleString()}
            </span>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-background/60 z-10">
            <Expand className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      ))}
    </div>
  );
});

GalleryBento.displayName = "GalleryBento";
export default GalleryBento;
