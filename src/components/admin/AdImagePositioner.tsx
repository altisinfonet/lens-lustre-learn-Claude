import { useCallback, useEffect, useRef, useState } from "react";
import { X, Check, ZoomIn, ZoomOut, Move } from "lucide-react";
import { Slider } from "@/components/ui/slider";

type Placement = "header" | "sidebar" | "in-content" | "between-entries" | "lightbox-overlay" | "above-journal" | "below-journal" | "anchor-bottom";

/** Required output dimensions per ad placement */
export const PLACEMENT_DIMENSIONS: Record<Placement, { width: number; height: number; label: string }> = {
  header:            { width: 1920, height: 180, label: "1920 × 180 px (Wide Leaderboard, full-width)" },
  "above-journal":   { width: 1200, height: 250, label: "1200 × 250 px (Banner)" },
  "below-journal":   { width: 1200, height: 250, label: "1200 × 250 px (Banner)" },
  sidebar:           { width: 300,  height: 300, label: "300 × 300 px (Square)" },
  "in-content":      { width: 1080, height: 1350, label: "1080 × 1350 px (Post 4:5)" },
  "between-entries": { width: 1080, height: 1350, label: "1080 × 1350 px (Post 4:5)" },
  "lightbox-overlay":{ width: 900,  height: 100, label: "900 × 100 px (Compact)" },
  "anchor-bottom":   { width: 728,  height: 90,  label: "728 × 90 px (Anchor)" },
};

interface Props {
  imageSrc: string;
  placement: Placement;
  onComplete: (croppedFile: File) => void;
  onCancel: () => void;
}

export default function AdImagePositioner({ imageSrc, placement, onComplete, onCancel }: Props) {
  const dim = PLACEMENT_DIMENSIONS[placement];
  const aspect = dim.width / dim.height;

  // Scale frame to fit within modal (max 560px wide)
  const maxFrameW = 560;
  const frameScale = Math.min(1, maxFrameW / dim.width);
  const frameW = Math.round(dim.width * frameScale);
  const frameH = Math.round(dim.height * frameScale);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [processing, setProcessing] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampPanToFrame = useCallback(
    (
      nextPan: { x: number; y: number },
      nextZoom: number,
      naturalSize = imgNatural
    ) => {
      if (!naturalSize.w || !naturalSize.h) return nextPan;

      const renderedWidth = naturalSize.w * nextZoom;
      const renderedHeight = naturalSize.h * nextZoom;

      const x =
        renderedWidth <= frameW
          ? (frameW - renderedWidth) / 2
          : Math.min(0, Math.max(frameW - renderedWidth, nextPan.x));
      const y =
        renderedHeight <= frameH
          ? (frameH - renderedHeight) / 2
          : Math.min(0, Math.max(frameH - renderedHeight, nextPan.y));

      return { x, y };
    },
    [frameH, frameW, imgNatural]
  );

  const getCoverZoom = useCallback(
    (w: number, h: number) => Math.max(frameW / w, frameH / h),
    [frameH, frameW]
  );

  const onImageLoad = useCallback(() => {
    if (!imgRef.current) return;
    const { naturalWidth: w, naturalHeight: h } = imgRef.current;
    const naturalSize = { w, h };
    const coverZoom = getCoverZoom(w, h);

    setImgNatural(naturalSize);
    setZoom(coverZoom);
    setPan(
      clampPanToFrame(
        { x: (frameW - w * coverZoom) / 2, y: (frameH - h * coverZoom) / 2 },
        coverZoom,
        naturalSize
      )
    );
  }, [clampPanToFrame, frameH, frameW, getCoverZoom]);

  // Mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPanStart(pan);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const nextPan = {
        x: panStart.x + (e.clientX - dragStart.x),
        y: panStart.y + (e.clientY - dragStart.y),
      };
      setPan(clampPanToFrame(nextPan, zoom));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [clampPanToFrame, dragging, dragStart, panStart, zoom]);

  // Touch drag
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    setDragging(true);
    setDragStart({ x: t.clientX, y: t.clientY });
    setPanStart(pan);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const nextPan = {
        x: panStart.x + (t.clientX - dragStart.x),
        y: panStart.y + (t.clientY - dragStart.y),
      };
      setPan(clampPanToFrame(nextPan, zoom));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [clampPanToFrame, dragging, dragStart, panStart, zoom]);

  const handleConfirm = async () => {
    if (!imgRef.current || !imgNatural.w) return;
    setProcessing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = dim.width;
      canvas.height = dim.height;
      const ctx = canvas.getContext("2d")!;

      const safePan = clampPanToFrame(pan, zoom);
      const sx = -safePan.x / zoom;
      const sy = -safePan.y / zoom;
      const sw = frameW / zoom;
      const sh = frameH / zoom;

      ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, dim.width, dim.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Blob failed"))),
          "image/png",
          0.95
        );
      });
      onComplete(new File([blob], `ad-${placement}-${Date.now()}.png`, { type: "image/png" }));
    } catch {
      const resp = await fetch(imageSrc);
      const blob = await resp.blob();
      onComplete(new File([blob], `ad-${placement}-${Date.now()}.png`, { type: blob.type }));
    }
    setProcessing(false);
  };

  const coverZoom = imgNatural.w ? getCoverZoom(imgNatural.w, imgNatural.h) : 0.05;
  const minZoom = coverZoom;
  const maxZoom = imgNatural.w ? coverZoom * 4 : 5;

  const headingFont = { fontFamily: "var(--font-heading)" };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-sm shadow-2xl max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden w-[640px]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-2">
            <Move className="h-4 w-4 text-primary" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>
              Position Image
            </span>
          </div>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Dimensions info */}
        <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center justify-between">
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>
            Required: {dim.label}
          </span>
          <span className="text-[9px] text-muted-foreground/60">
            Drag to reposition · Scroll or slider to zoom
          </span>
        </div>

        {/* Positioning area */}
        <div className="flex-1 overflow-hidden p-4 flex flex-col items-center gap-4 bg-muted/10 min-h-[280px]">
          {/* Frame */}
          <div
            ref={containerRef}
            className="relative overflow-hidden border-2 border-primary/40 bg-black/20"
            style={{
              width: frameW,
              height: frameH,
              cursor: dragging ? "grabbing" : "grab",
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.02 : 0.02;
              const nextZoom = Math.max(minZoom, Math.min(maxZoom, zoom + delta));
              setZoom(nextZoom);
              setPan((current) => clampPanToFrame(current, nextZoom));
            }}
          >
            <img loading="lazy" decoding="async"
              ref={imgRef}
              src={imageSrc}
              alt="Position preview"
              onLoad={onImageLoad}
              className="absolute select-none pointer-events-none"
              draggable={false}
              style={{
                left: pan.x,
                top: pan.y,
                width: imgNatural.w ? imgNatural.w * zoom : "auto",
                height: imgNatural.h ? imgNatural.h * zoom : "auto",
                maxWidth: "none",
              }}
              crossOrigin="anonymous"
            />
            {/* Corner guides */}
            <div className="absolute inset-0 pointer-events-none border border-white/10" />
            {/* Center crosshair */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
              <div className="w-6 h-px bg-white" />
              <div className="absolute w-px h-6 bg-white" />
            </div>
          </div>

          {/* Zoom slider */}
          <div className="flex items-center gap-3 w-full max-w-[400px]">
            <ZoomOut className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Slider
              min={minZoom * 100}
              max={maxZoom * 100}
              step={1}
              value={[zoom * 100]}
              onValueChange={([v]) => {
                const nextZoom = v / 100;
                setZoom(nextZoom);
                setPan((current) => clampPanToFrame(current, nextZoom));
              }}
              className="flex-1"
            />
            <ZoomIn className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground w-12 text-right tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
          </div>
        </div>

        {/* Live preview label */}
        <div className="px-4 py-2 border-t border-border bg-muted/10">
          <p className="text-[9px] tracking-[0.2em] uppercase text-primary/60 text-center" style={headingFont}>
            ↑ Live Preview — What you see is what gets saved
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card/50">
          <span className="text-[9px] text-muted-foreground">
            Output: {dim.width} × {dim.height}px
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors rounded-sm"
              style={headingFont}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={processing}
              className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm disabled:opacity-50 flex items-center gap-1.5"
              style={headingFont}
            >
              {processing ? (
                <div className="h-3 w-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {processing ? "Processing…" : "Save & Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
