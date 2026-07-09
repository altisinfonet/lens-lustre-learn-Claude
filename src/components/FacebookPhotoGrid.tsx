import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import { motion, AnimatePresence } from "framer-motion";

interface FacebookPhotoGridProps {
  urls: string[];
  onPhotoClick?: (index: number) => void;
  initialIndex?: number;
}

const FacebookPhotoGrid = ({ urls, onPhotoClick, initialIndex }: FacebookPhotoGridProps) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { downloading, download } = useDownloadImage();
  const lastAppliedInitialRef = useRef<number | null>(null);
  const count = urls.length;
  if (count === 0) return null;

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    onPhotoClick?.(index);
  };

  const navigateLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    onPhotoClick?.(index);
  }, [onPhotoClick]);

  useEffect(() => {
    if (typeof initialIndex !== "number" || initialIndex < 0 || initialIndex >= urls.length) {
      lastAppliedInitialRef.current = null;
      return;
    }

    if (lastAppliedInitialRef.current === initialIndex) return;

    setLightboxIndex(initialIndex);
    lastAppliedInitialRef.current = initialIndex;
  }, [initialIndex, urls.length]);

  const Photo = ({ src, index, className = "", overlay, aspectRatio }: { src: string; index: number; className?: string; overlay?: string; aspectRatio?: string }) => (
    <div
      className={`relative group/photo overflow-hidden cursor-pointer bg-muted/30 ${className}`}
      style={aspectRatio ? { aspectRatio } : undefined}
      onClick={() => openLightbox(index)}
    >
      <img src={src} alt="" className={`w-full transition-transform duration-300 group-hover/photo:scale-[1.02] ${aspectRatio ? "h-full object-cover" : "object-contain max-h-[70vh]"}`} loading="lazy" />
      {overlay && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <span className="text-white text-3xl font-bold">+{overlay}</span>
        </div>
      )}
      <DownloadButton
        downloading={downloading === src}
        onClick={(e) => { e.stopPropagation(); download(src); }}
        className="absolute bottom-2 right-2 p-1.5 rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/photo:opacity-100 transition-opacity hover:bg-card shadow-sm z-10 disabled:opacity-60"
        iconSize="h-3.5 w-3.5"
      />
    </div>
  );

  const grid = count === 1 ? (
    <div className="mt-1.5 w-full overflow-hidden rounded-sm"><Photo src={urls[0]} index={0} /></div>
  ) : count === 2 ? (
    <div className="mt-1.5 grid grid-cols-2 gap-0.5"><Photo src={urls[0]} index={0} /><Photo src={urls[1]} index={1} /></div>
  ) : count === 3 ? (
    <div className="mt-1.5 grid grid-cols-3 gap-0.5"><Photo src={urls[0]} index={0} /><Photo src={urls[1]} index={1} /><Photo src={urls[2]} index={2} /></div>
  ) : count === 4 ? (
    <div className="mt-1.5 grid grid-cols-2 gap-0.5"><Photo src={urls[0]} index={0} /><Photo src={urls[1]} index={1} /><Photo src={urls[2]} index={2} /><Photo src={urls[3]} index={3} /></div>
  ) : (
    <div className="mt-1.5 grid grid-cols-3 gap-0.5">
      <Photo src={urls[0]} index={0} /><Photo src={urls[1]} index={1} /><Photo src={urls[2]} index={2} /><Photo src={urls[3]} index={3} />
      <Photo src={urls[4]} index={4} overlay={count - 5 > 0 ? String(count - 5) : undefined} />
    </div>
  );

  return (
    <>
      {grid}
      <PostLightbox urls={urls} currentIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} onNavigate={navigateLightbox} />
    </>
  );
};

/* ── Full-screen Lightbox ── */
interface PostLightboxProps { urls: string[]; currentIndex: number | null; onClose: () => void; onNavigate: (index: number) => void; }

const PostLightbox = ({ urls, currentIndex, onClose, onNavigate }: PostLightboxProps) => {
  const isOpen = currentIndex !== null;
  const { downloading, download } = useDownloadImage();

  const goPrev = useCallback(() => { if (currentIndex === null) return; onNavigate(currentIndex > 0 ? currentIndex - 1 : urls.length - 1); }, [currentIndex, urls.length, onNavigate]);
  const goNext = useCallback(() => { if (currentIndex === null) return; onNavigate(currentIndex < urls.length - 1 ? currentIndex + 1 : 0); }, [currentIndex, urls.length, onNavigate]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowLeft") goPrev(); if (e.key === "ArrowRight") goNext(); };
    window.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", handleKey); };
  }, [isOpen, onClose, goPrev, goNext]);

  return (
    <AnimatePresence>
      {isOpen && currentIndex !== null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm" onClick={onClose}>
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
            <span className="text-sm text-white/60 mr-2">{currentIndex + 1} / {urls.length}</span>
            <DownloadButton
              downloading={downloading === urls[currentIndex]}
              onClick={(e) => { e.stopPropagation(); download(urls[currentIndex]); }}
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors disabled:opacity-60"
              iconSize="h-5 w-5"
            />
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          {urls.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); goPrev(); }} className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); goNext(); }} className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <AnimatePresence mode="wait">
            <motion.img key={currentIndex} src={urls[currentIndex]} alt="" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }} className="max-w-[95vw] max-h-[92vh] object-contain rounded-sm shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FacebookPhotoGrid;
