import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  X,
  Check,
  RotateCcw,
  Crop as CropIcon,
  Info,
  ZoomIn,
  ZoomOut,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  SkipForward,
} from "lucide-react";

interface Props {
  imageSrc: string;
  onCropComplete: (croppedFile: File) => void;
  onCancel: () => void;
  /** If set, locks the aspect ratio (no free/aspect selector shown) */
  forcedAspect?: number;
  /** Target output width in px */
  targetWidth?: number;
  /** Target output height in px */
  targetHeight?: number;
  /** Show circular crop overlay (for avatars). Output is still square. */
  circularCrop?: boolean;
  /** Queue position (1-based) — shown as "Photo X of Y" when both provided */
  queuePosition?: number;
  /** Queue total */
  queueTotal?: number;
  /** When present + queueTotal > 1, shows a Skip button that discards this photo and advances the queue */
  onSkip?: () => void;
}

const ASPECT_OPTIONS = [
  { label: "Free", value: undefined },
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
];

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/** Pre-render a rotated / mirrored bitmap from the source image.
 *  Returns an object URL that ReactCrop can use as its source so crop
 *  coordinates line up with what the user visually sees. */
async function renderTransformedSrc(
  src: string,
  rotation: number,
  flipH: boolean,
  flipV: boolean
): Promise<string> {
  if (rotation === 0 && !flipH && !flipV) return src;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const cw = Math.round(img.naturalWidth * cos + img.naturalHeight * sin);
  const ch = Math.round(img.naturalWidth * sin + img.naturalHeight * cos);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return await new Promise<string>((resolve) => {
    canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : src), "image/png");
  });
}

export default function ImageCropModal({
  imageSrc,
  onCropComplete,
  onCancel,
  forcedAspect,
  targetWidth,
  targetHeight,
  circularCrop,
  queuePosition,
  queueTotal,
  onSkip,
}: Props) {
  const isLocked = forcedAspect !== undefined;
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [aspect, setAspect] = useState<number | undefined>(forcedAspect);
  const [processing, setProcessing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [activeSrc, setActiveSrc] = useState(imageSrc);
  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const showQueue = typeof queuePosition === "number" && typeof queueTotal === "number" && queueTotal > 1;
  const canSkip = showQueue && typeof onSkip === "function";

  // Re-render active source whenever rotation / mirror changes.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      const url = await renderTransformedSrc(imageSrc, rotation, flipH, flipV);
      if (cancelled) {
        if (url !== imageSrc) URL.revokeObjectURL(url);
        return;
      }
      if (url !== imageSrc) createdUrl = url;
      setActiveSrc(url);
      // Reset crop so ReactCrop re-initialises against the new pixel space
      setCrop(undefined);
      setCompletedCrop(undefined);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [imageSrc, rotation, flipH, flipV]);

  // Live before/after preview — redraws when completedCrop changes.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !completedCrop || completedCrop.width === 0 || completedCrop.height === 0) return;
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    const sx = completedCrop.x * scaleX;
    const sy = completedCrop.y * scaleY;
    const sw = completedCrop.width * scaleX;
    const sh = completedCrop.height * scaleY;
    const maxDim = 160;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, [completedCrop, zoom]);

  const onImageLoad = useCallback(() => {
    if (imgRef.current) {
      const { width, height } = imgRef.current;
      const currentAspect = forcedAspect ?? aspect;

      let cropW: number, cropH: number;
      if (currentAspect) {
        if (width / height > currentAspect) {
          cropH = height * 0.9;
          cropW = cropH * currentAspect;
        } else {
          cropW = width * 0.9;
          cropH = cropW / currentAspect;
        }
      } else {
        const size = Math.min(width, height) * 0.8;
        cropW = size;
        cropH = size;
      }

      setCrop({
        unit: "px",
        x: (width - cropW) / 2,
        y: (height - cropH) / 2,
        width: cropW,
        height: cropH,
      });
    }
  }, [aspect, forcedAspect]);

  const handleConfirm = async () => {
    if (!completedCrop || !imgRef.current) {
      const resp = await fetch(activeSrc);
      const blob = await resp.blob();
      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: blob.type }));
      return;
    }

    setProcessing(true);
    try {
      const canvas = document.createElement("canvas");
      const img = imgRef.current;
      const scaleX = img.naturalWidth / img.width;
      const scaleY = img.naturalHeight / img.height;

      const outW = targetWidth || completedCrop.width * scaleX;
      const outH = targetHeight || completedCrop.height * scaleY;

      canvas.width = outW;
      canvas.height = outH;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");

      ctx.drawImage(
        img,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        outW,
        outH
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))),
          "image/png",
          0.92
        );
      });

      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: "image/png" }));
    } catch {
      const resp = await fetch(activeSrc);
      const blob = await resp.blob();
      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: blob.type }));
    }
    setProcessing(false);
  };

  const resetAll = () => {
    setCrop(undefined);
    setCompletedCrop(undefined);
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  };

  const effectiveAspect = isLocked ? forcedAspect : aspect;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-sm shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden w-[640px]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-2">
            <CropIcon className="h-4 w-4 text-primary" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Crop & Adjust Image
            </span>
            {showQueue && (
              <span
                className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Photo {queuePosition} of {queueTotal}
              </span>
            )}
          </div>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Aspect / target info row */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border bg-muted/20">
          {isLocked && targetWidth && targetHeight ? (
            <div className="flex items-center gap-1.5 text-[9px] text-primary">
              <Info className="h-3 w-3" />
              <span style={{ fontFamily: "var(--font-heading)" }}>
                Output: {targetWidth}×{targetHeight}px — aspect ratio locked
              </span>
            </div>
          ) : isLocked ? (
            <div className="flex items-center gap-1.5 text-[9px] text-primary">
              <Info className="h-3 w-3" />
              <span style={{ fontFamily: "var(--font-heading)" }}>Aspect ratio locked</span>
            </div>
          ) : (
            <>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground mr-2" style={{ fontFamily: "var(--font-heading)" }}>
                Aspect:
              </span>
              {ASPECT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    setAspect(opt.value);
                    setCrop(undefined);
                    setCompletedCrop(undefined);
                  }}
                  className={`text-[9px] px-2 py-1 rounded-sm border transition-colors ${
                    aspect === opt.value
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            onClick={resetAll}
            className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center gap-1"
            title="Reset zoom, rotation, mirror, and crop selection"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>

        {/* Zoom + rotate + mirror toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/10">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
              disabled={zoom <= ZOOM_MIN}
              className="p-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 disabled:opacity-40 disabled:hover:text-muted-foreground"
              title="Zoom out"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <span className="text-[9px] tabular-nums w-10 text-center text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
              disabled={zoom >= ZOOM_MAX}
              className="p-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 disabled:opacity-40 disabled:hover:text-muted-foreground"
              title="Zoom in"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          </div>

          <div className="h-4 w-px bg-border/60" />

          <button
            type="button"
            onClick={() => setRotation((r) => (r + 270) % 360)}
            className="p-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
            title="Rotate 90° left"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="p-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
            title="Rotate 90° right"
          >
            <RotateCw className="h-3 w-3" />
          </button>
          <span className="text-[9px] tabular-nums w-8 text-center text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {rotation}°
          </span>

          <div className="h-4 w-px bg-border/60" />

          <button
            type="button"
            onClick={() => setFlipH((v) => !v)}
            className={`p-1 rounded-sm border transition-colors ${
              flipH ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
            }`}
            title="Mirror horizontally"
          >
            <FlipHorizontal2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setFlipV((v) => !v)}
            className={`p-1 rounded-sm border transition-colors ${
              flipV ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
            }`}
            title="Flip vertically"
          >
            <FlipVertical2 className="h-3 w-3" />
          </button>
        </div>

        {/* Crop area */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/10 min-h-[300px]">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={effectiveAspect}
            circularCrop={circularCrop}
            className="max-h-[60vh]"
          >
            <img
              loading="lazy"
              decoding="async"
              ref={imgRef}
              src={activeSrc}
              alt="Crop preview"
              onLoad={onImageLoad}
              className="max-h-[60vh] object-contain"
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              crossOrigin="anonymous"
            />
          </ReactCrop>
        </div>

        {/* Before / After preview strip */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-muted/10">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
            Preview:
          </span>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-0.5">
              <img
                src={activeSrc}
                alt="Before"
                className="h-16 max-w-[90px] object-contain border border-border rounded-sm bg-background"
                crossOrigin="anonymous"
              />
              <span className="text-[8px] uppercase tracking-wider text-muted-foreground/70">Before</span>
            </div>
            <span className="text-muted-foreground/50 text-[10px]">→</span>
            <div className="flex flex-col items-center gap-0.5">
              <div className="h-16 min-w-[40px] flex items-center justify-center border border-primary/40 rounded-sm bg-background overflow-hidden">
                {completedCrop && completedCrop.width > 0 ? (
                  <canvas ref={previewCanvasRef} className="max-h-16 max-w-[90px] object-contain" />
                ) : (
                  <span className="text-[8px] text-muted-foreground/50 px-2 text-center">Drag to crop</span>
                )}
              </div>
              <span className="text-[8px] uppercase tracking-wider text-primary/80">After</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card/50">
          <span className="text-[9px] text-muted-foreground">
            {completedCrop
              ? `${Math.round(completedCrop.width)} × ${Math.round(completedCrop.height)}px selected`
              : "Drag to select crop area, or insert as-is"}
            {targetWidth && targetHeight ? ` → ${targetWidth}×${targetHeight}px output` : ""}
          </span>
          <div className="flex items-center gap-2">
            {canSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors rounded-sm flex items-center gap-1.5"
                style={{ fontFamily: "var(--font-heading)" }}
                title="Skip this photo and keep going through the queue"
              >
                <SkipForward className="h-3 w-3" /> Skip
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors rounded-sm"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={processing}
              className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm disabled:opacity-50 flex items-center gap-1.5"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {processing ? (
                <div className="h-3 w-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {processing ? "Processing…" : "Crop & Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
