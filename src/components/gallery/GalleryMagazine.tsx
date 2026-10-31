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

const GalleryMagazine = memo(({ works, onImageClick, optimizeUrl }: Props) => {
  if (works.length === 0) return null;

  const hero = works[0];
  const rest = works.slice(1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-1.5">
      {/* Hero — spans 5 columns, 3 rows tall */}
      <div
        className="lg:col-span-5 lg:row-span-3 relative group overflow-hidden rounded-sm cursor-pointer bg-muted aspect-[3/4] lg:aspect-auto lg:min-h-[480px]"
        onClick={() => onImageClick(0)}
      >
        <GalleryImage
          src={hero.src}
          alt={`${hero.title} — ${hero.category}`}
          category={hero.category}
          className="w-full h-full object-cover transition-all duration-700 group-hover:scale-105 group-hover:brightness-75"
          eager
          isHero
          fetchPriority="high"
          sizes="(min-width: 1024px) 42vw, 100vw"
          optimizeUrl={optimizeUrl}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10" />
        <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-500 z-10">
          <p className="text-[9px] tracking-[0.3em] uppercase text-primary mb-1" style={headingFont}>{hero.category}</p>
          <p className="text-sm font-light text-foreground" style={{ fontFamily: "var(--font-display)" }}>{hero.title}</p>
        </div>
        {hero.is_trending && (
          <div className="absolute top-2 left-2 z-10">
            <span className="inline-flex items-center gap-1 text-[7px] tracking-[0.15em] uppercase px-1.5 py-0.5 bg-primary text-primary-foreground rounded-sm" style={headingFont}>🔥 Trending</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
          <Expand className="h-5 w-5 text-primary" />
        </div>
      </div>

      {/* Thumbnails grid — right side */}
      <div className="lg:col-span-7 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 sm:gap-1.5">
        {rest.map((work, i) => (
          <div
            key={work.id || `${work.src}-${i}`}
            className="group relative overflow-hidden rounded-sm cursor-pointer bg-muted aspect-square"
            onClick={() => onImageClick(i + 1)}
          >
            <GalleryImage
              src={work.thumbnail || work.src}
              alt={`${work.title} — ${work.category}`}
              category={work.category}
              className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110 group-hover:brightness-75"
              eager={i < 5}
              sizes="(min-width: 1280px) 11vw, (min-width: 768px) 14vw, 33vw"
              optimizeUrl={optimizeUrl}
            />
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
    </div>
  );
});

GalleryMagazine.displayName = "GalleryMagazine";
export default GalleryMagazine;
