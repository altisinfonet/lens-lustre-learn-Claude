import { memo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import ImageEngagement from "@/components/ImageEngagement";
import AdPlacement from "@/components/AdPlacement";
import DownloadButton from "@/components/DownloadButton";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";

interface LightboxProps {
  images: { id?: string; src: string; title: string; category: string; photoIndex?: number }[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  imageType?: "portfolio" | "competition_entry";
}

const Lightbox = memo(({ images, currentIndex, isOpen, onClose, onPrev, onNext, imageType = "portfolio" }: LightboxProps) => {
  const current = images[currentIndex];
  const { downloading, download } = useDownloadImage();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    },
    [onClose, onPrev, onNext],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  return createPortal(
    <AnimatePresence>
      {isOpen && current && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
          onClick={onClose}
        >
          <div className="absolute top-6 left-6 right-6 z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{current.category}</span>
              <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{currentIndex + 1} / {images.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {imageType !== "competition_entry" && (
                <DownloadButton
                  downloading={downloading === current.src}
                  onClick={(e) => { e.stopPropagation(); download(current.src, `${current.title || "photo"}.jpg`); }}
                  className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                  iconSize="h-5 w-5"
                />
              )}
              <button onClick={onClose} className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center text-foreground hover:bg-muted transition-colors" aria-label="Close lightbox">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-muted/40 hover:bg-muted/70 flex items-center justify-center text-foreground transition-all" aria-label="Previous photo">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-muted/40 hover:bg-muted/70 flex items-center justify-center text-foreground transition-all" aria-label="Next photo">
            <ChevronRight className="h-6 w-6" />
          </button>

          <div className="absolute bottom-4 left-1/2 z-20 w-[min(92vw,640px)] -translate-x-1/2" onClick={(e) => e.stopPropagation()}>
            <AdPlacement placement="lightbox-overlay" variant="plain" />
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={currentIndex} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.3 }}
              className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
              <img src={current.src} alt={`${current.title} — ${current.category}`} className="max-w-full max-h-[65vh] object-contain rounded-sm shadow-2xl"
                {...(imageType === "competition_entry" ? { onContextMenu: (e: React.MouseEvent) => e.preventDefault(), draggable: false, style: { pointerEvents: "auto" as const, userSelect: "none" as const } } : {})} />
              <div className="mt-4 text-center">
                <h3 className="text-2xl md:text-3xl font-light text-foreground" style={{ fontFamily: "var(--font-display)" }}>{current.title}</h3>
              </div>
              {current.id && (
                <div className="mt-3 w-full max-w-md">
                  <ImageEngagement imageType={imageType} imageId={current.id} photoIndex={current.photoIndex ?? 0} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
});

Lightbox.displayName = "Lightbox";
export default Lightbox;
