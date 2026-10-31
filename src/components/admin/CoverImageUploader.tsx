import { useState, useRef, useCallback } from "react";
import { Upload, Image, Trash2, Info, Maximize2 } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { compressImageToFiles } from "@/lib/imageCompression";
import { uploadImage } from "@/lib/imageUpload";

interface CoverImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  /** Recommended width in px */
  recommendedWidth?: number;
  /** Recommended height in px */
  recommendedHeight?: number;
  /** Storage bucket */
  bucket?: string;
  /** Storage folder */
  folder?: string;
  /** Label */
  label?: string;
}

interface ImageMeta {
  width: number;
  height: number;
  sizeKB: number;
  format: string;
}

function getImageMeta(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function getSizeRating(
  actual: { width: number; height: number },
  recommended: { width: number; height: number }
): { label: string; color: string } {
  if (actual.width === 0) return { label: "Unknown", color: "text-muted-foreground" };
  const wRatio = actual.width / recommended.width;
  const hRatio = actual.height / recommended.height;
  const minRatio = Math.min(wRatio, hRatio);
  if (minRatio >= 0.95) return { label: "Excellent", color: "text-green-500" };
  if (minRatio >= 0.7) return { label: "Good", color: "text-yellow-500" };
  return { label: "Low Resolution", color: "text-destructive" };
}

const CoverImageUploader = ({
  value,
  onChange,
  recommendedWidth = 1200,
  recommendedHeight = 400,
  bucket = "competition-photos",
  folder = "covers",
  label = "Cover Image",
}: CoverImageUploaderProps) => {
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const aspectRatio = recommendedWidth / recommendedHeight;

  // Load meta for displayed image
  const loadMeta = useCallback(async (url: string) => {
    const { width, height } = await getImageMeta(url);
    // Estimate size from URL fetch
    try {
      const resp = await fetch(url, { method: "HEAD" });
      const cl = resp.headers.get("content-length");
      const sizeKB = cl ? Math.round(parseInt(cl) / 1024) : 0;
      const format = url.includes(".webp") ? "WebP" : url.includes(".jpg") ? "JPEG" : url.includes(".png") ? "PNG" : "Image";
      setImageMeta({ width, height, sizeKB, format });
    } catch {
      setImageMeta({ width, height, sizeKB: 0, format: "Image" });
    }
  }, []);

  // When value changes, load meta
  useState(() => {
    if (value) loadMeta(value);
  });

  const processFile = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 50MB allowed", variant: "destructive" });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Only image files are accepted", variant: "destructive" });
      return;
    }
    // Open crop modal
    setCropSrc(URL.createObjectURL(file));
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropSrc(null);
    setUploading(true);
    try {
      const safe = await scanFileWithToast(croppedFile, toast, { allowedTypes: "image" });
      if (!safe) { setUploading(false); return; }
      const baseName = `comp-cover-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { webpFile } = await compressImageToFiles(croppedFile, baseName);
      const path = `${folder}/${baseName}.webp`;
      const result = await uploadImage({ bucket, file: webpFile, path, type: "comp-cover", fileName: `${baseName}.webp` });
      onChange(result.url);
      await loadMeta(result.url);
      toast({ title: "Cover image uploaded successfully" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
    setUploading(false);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const rating = imageMeta
    ? getSizeRating(imageMeta, { width: recommendedWidth, height: recommendedHeight })
    : null;

  return (
    <div className="md:col-span-2 space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {label}
        </label>
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70">
          <Maximize2 className="h-3 w-3" />
          <span>Recommended: {recommendedWidth} × {recommendedHeight}px</span>
          <span className="text-muted-foreground/40">({aspectRatio.toFixed(1)}:1)</span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {value ? (
        <div className="border border-border rounded-sm overflow-hidden">
          {/* Preview at correct aspect ratio */}
          <div className="relative bg-muted/20 overflow-hidden select-none" style={{ aspectRatio: `${recommendedWidth}/${recommendedHeight}` }}>
            <img loading="lazy" decoding="async"
              src={value}
              alt="Cover preview"
              className="w-full h-full object-cover"
              draggable={false}
            />
            {/* Size overlay badge */}
            {imageMeta && imageMeta.width > 0 && (
              <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white text-[8px] px-2 py-1 rounded-sm flex items-center gap-1.5">
                <span>{imageMeta.width} × {imageMeta.height}px</span>
                <span className="text-muted-foreground/60">·</span>
                <span>{imageMeta.format}</span>
                {imageMeta.sizeKB > 0 && (
                  <>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{imageMeta.sizeKB}KB</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Info bar */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-card/50">
            <div className="flex items-center gap-3">
              {/* Quality rating */}
              {rating && (
                <div className="flex items-center gap-1">
                  <div className={`h-1.5 w-1.5 rounded-full ${
                    rating.label === "Excellent" ? "bg-green-500" :
                    rating.label === "Good" ? "bg-yellow-500" : "bg-destructive"
                  }`} />
                  <span className={`text-[9px] tracking-wider uppercase ${rating.color}`} style={{ fontFamily: "var(--font-heading)" }}>
                    {rating.label}
                  </span>
                </div>
              )}
              {/* Aspect ratio check */}
              {imageMeta && imageMeta.width > 0 && (
                <span className="text-[8px] text-muted-foreground/60">
                  {Math.abs(imageMeta.width / imageMeta.height - aspectRatio) < 0.15
                    ? "✓ Aspect ratio matches"
                    : "⚠ Aspect ratio differs from recommended"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="p-1.5 rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Replace Image"
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
              <span className="text-[9px] text-muted-foreground">Replace</span>
              <button
                type="button"
                onClick={() => { onChange(""); setImageMeta(null); }}
                className="p-1.5 rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-2"
                title="Remove Image"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Drop zone */
        <div
          className={`border-2 border-dashed rounded-sm transition-all duration-300 ${
            isDragOver
              ? "border-primary bg-primary/5 scale-[1.01]"
              : "border-border hover:border-primary/40"
          }`}
          style={{ aspectRatio: `${recommendedWidth}/${recommendedHeight}`, maxHeight: "200px" }}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 cursor-pointer"
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                  Uploading…
                </span>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Image className="h-8 w-8 text-muted-foreground/40" />
                  <Upload className="h-3.5 w-3.5 text-primary absolute -bottom-0.5 -right-1 bg-background rounded-full p-0.5" />
                </div>
                <div className="text-center space-y-1">
                  <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
                    {isDragOver ? "Drop image here" : "Drag & drop or click to upload"}
                  </span>
                  <span className="text-[9px] text-muted-foreground/50 flex items-center justify-center gap-1">
                    <Info className="h-3 w-3" />
                    Best at {recommendedWidth} × {recommendedHeight}px · Max 50MB · JPG, PNG, WebP
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Crop Modal */}
      {cropSrc && (
        <ImageCropModalEnhanced
          imageSrc={cropSrc}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
          recommendedWidth={recommendedWidth}
          recommendedHeight={recommendedHeight}
          defaultAspect={aspectRatio}
        />
      )}
    </div>
  );
};

export default CoverImageUploader;

/* ─── Enhanced Crop Modal (inline, self-contained) ─── */

import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { X, Check, RotateCcw, Crop as CropIcon } from "lucide-react";

interface EnhancedCropProps {
  imageSrc: string;
  onCropComplete: (croppedFile: File) => void;
  onCancel: () => void;
  recommendedWidth: number;
  recommendedHeight: number;
  defaultAspect: number;
}

const ASPECT_OPTIONS = [
  { label: "Free", value: undefined },
  { label: "3:1", value: 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "1:1", value: 1 },
];

function ImageCropModalEnhanced({
  imageSrc,
  onCropComplete,
  onCancel,
  recommendedWidth,
  recommendedHeight,
  defaultAspect,
}: EnhancedCropProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [aspect, setAspect] = useState<number | undefined>(defaultAspect);
  const [processing, setProcessing] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const onImageLoad = useCallback(() => {
    if (imgRef.current) {
      const { width, height, naturalWidth, naturalHeight } = imgRef.current;
      setNaturalSize({ w: naturalWidth, h: naturalHeight });
      // Set default crop centered
      const cropAspect = aspect || defaultAspect;
      let cw = width * 0.85;
      let ch = cw / cropAspect;
      if (ch > height * 0.85) {
        ch = height * 0.85;
        cw = ch * cropAspect;
      }
      setCrop({
        unit: "px",
        x: (width - cw) / 2,
        y: (height - ch) / 2,
        width: cw,
        height: ch,
      });
    }
  }, [aspect, defaultAspect]);

  // Compute output dimensions
  const outputSize = (() => {
    if (!completedCrop || !imgRef.current) return null;
    const img = imgRef.current;
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    return {
      width: Math.round(completedCrop.width * scaleX),
      height: Math.round(completedCrop.height * scaleY),
    };
  })();

  const outputRating = outputSize
    ? getSizeRating(outputSize, { width: recommendedWidth, height: recommendedHeight })
    : null;

  const handleConfirm = async () => {
    if (!completedCrop || !imgRef.current) {
      const resp = await fetch(imageSrc);
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
      canvas.width = completedCrop.width * scaleX;
      canvas.height = completedCrop.height * scaleY;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");
      ctx.drawImage(
        img,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0, 0, canvas.width, canvas.height
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Blob failed"))), "image/png", 0.92);
      });
      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: "image/png" }));
    } catch {
      const resp = await fetch(imageSrc);
      const blob = await resp.blob();
      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: blob.type }));
    }
    setProcessing(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-sm shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden w-[700px]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-2">
            <CropIcon className="h-4 w-4 text-primary" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Crop Cover Image
            </span>
          </div>
          <div className="flex items-center gap-3">
            {naturalSize && (
              <span className="text-[8px] text-muted-foreground/60">
                Original: {naturalSize.w} × {naturalSize.h}px
              </span>
            )}
            <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Recommended size banner */}
        <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/10">
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-primary/70" />
            <span className="text-[9px] text-primary/80">
              Recommended output: <strong>{recommendedWidth} × {recommendedHeight}px</strong> (aspect {(recommendedWidth / recommendedHeight).toFixed(1)}:1)
            </span>
          </div>
          {outputSize && outputRating && (
            <div className="flex items-center gap-1.5">
              <div className={`h-1.5 w-1.5 rounded-full ${
                outputRating.label === "Excellent" ? "bg-green-500" :
                outputRating.label === "Good" ? "bg-yellow-500" : "bg-destructive"
              }`} />
              <span className={`text-[9px] font-medium ${outputRating.color}`}>
                {outputRating.label}
              </span>
            </div>
          )}
        </div>

        {/* Aspect ratio selector */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-muted/20">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground mr-2" style={{ fontFamily: "var(--font-heading)" }}>
            Aspect:
          </span>
          {/* Default cover aspect */}
          <button
            type="button"
            onClick={() => { setAspect(defaultAspect); setCrop(undefined); setCompletedCrop(undefined); }}
            className={`text-[9px] px-2 py-1 rounded-sm border transition-colors ${
              aspect === defaultAspect
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
            }`}
          >
            Cover ({(defaultAspect).toFixed(1)}:1)
          </button>
          {ASPECT_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => { setAspect(opt.value); setCrop(undefined); setCompletedCrop(undefined); }}
              className={`text-[9px] px-2 py-1 rounded-sm border transition-colors ${
                aspect === opt.value
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setCrop(undefined); setCompletedCrop(undefined); }}
            className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>

        {/* Crop area */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/10 min-h-[300px]">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={aspect}
            className="max-h-[55vh]"
          >
            <img loading="lazy" decoding="async"
              ref={imgRef}
              src={imageSrc}
              alt="Crop preview"
              onLoad={onImageLoad}
              className="max-h-[55vh] max-w-full object-contain"
              crossOrigin="anonymous"
            />
          </ReactCrop>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card/50">
          <div className="text-[9px] text-muted-foreground space-y-0.5">
            {outputSize ? (
              <>
                <span>
                  Output: <strong className="text-foreground">{outputSize.width} × {outputSize.height}px</strong>
                </span>
                {outputSize.width < recommendedWidth * 0.7 && (
                  <p className="text-destructive/80 flex items-center gap-1">
                    ⚠ Image may appear pixelated at display size
                  </p>
                )}
              </>
            ) : (
              <span>Drag to select crop area, or insert full image</span>
            )}
          </div>
          <div className="flex items-center gap-2">
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
