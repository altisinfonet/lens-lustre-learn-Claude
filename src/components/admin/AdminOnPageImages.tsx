import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Image, Upload, Trash2, Loader2, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { toast } from "@/hooks/core/use-toast";
import ImageCropModal from "./ImageCropModal";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface ImageSlot {
  key: string;
  label: string;
  description: string;
  recommended: string;
  width: number;
  height: number;
}

const IMAGE_SLOTS: ImageSlot[] = [
  {
    key: "site_logo",
    label: "Site Logo",
    description: "Main logo displayed in Navbar, Footer, Login, Signup, Admin Panel, Onboarding, and PDF exports.",
    recommended: "PNG with transparent background, 512×512px",
    width: 512,
    height: 512,
  },
  {
    key: "quote_background_image",
    label: "Quote Section Background",
    description: "Full-width background image behind the photography quote on the homepage.",
    recommended: "Landscape, 1920×800px, dark/moody works best",
    width: 1920,
    height: 800,
  },
  {
    key: "login_background",
    label: "Login Page Background",
    description: "Background image shown on the left side of the Login page.",
    recommended: "Portrait, 1200×1600px",
    width: 1200,
    height: 1600,
  },
  {
    key: "signup_background",
    label: "Signup Page Background",
    description: "Background image shown on the left side of the Signup page.",
    recommended: "Portrait, 1200×1600px",
    width: 1200,
    height: 1600,
  },
];

interface Props {
  user: any;
}

const AdminOnPageImages = ({ user }: Props) => {
  const qc = useQueryClient();
  const [images, setImages] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [cropState, setCropState] = useState<{ slot: ImageSlot; src: string } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchImages();
  }, []);

  const fetchImages = async () => {
    const keys = IMAGE_SLOTS.map((s) => s.key);
    const { data } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", keys);
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((row: any) => {
        const val = row.value;
        let url = "";
        if (typeof val === "string") url = val.replace(/^"+|"+$/g, '');
        else if (val && typeof val === "object" && "url" in val) url = val.url;
        if (url) map[row.key] = url;
      });
      setImages(map);
    }
  };

  const handleFileSelect = (slot: ImageSlot, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Only images allowed", variant: "destructive" });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setCropState({ slot, src: objectUrl });
  };

  const handleCropComplete = async (croppedFile: File) => {
    const slot = cropState!.slot;
    URL.revokeObjectURL(cropState!.src);
    setCropState(null);

    if (!user) return;
    const safe = await scanFileWithToast(croppedFile, toast);
    if (!safe) return;

    setUploading(slot.key);
    setProgress(10);

    try {
      const maxDim = slot.key === "site_logo" ? 1024 : 2400;
      const { webpFile } = await compressImageToFiles(croppedFile, slot.key, { maxDimension: maxDim });
      setProgress(40);

      const path = `on-page/${slot.key}.webp`;
      const result = await uploadImage({ bucket: "portfolio-images", file: webpFile, path, type: "seo", upsertOverride: true });
      setProgress(80);

      if (!result?.url) throw new Error("Upload failed");
      const url = `${result.url}?t=${Date.now()}`;

      const { error } = await supabase.from("site_settings").upsert(
        { key: slot.key, value: url as any, updated_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (error) throw error;

      setImages((prev) => ({ ...prev, [slot.key]: url }));
      setProgress(100);
      // Sync cache
      if (slot.key === "site_logo") {
        const { queryKeys } = await import("@/lib/queryKeys");
        qc.setQueryData(queryKeys.siteLogo(), url);
      }
      qc.setQueryData(["site-setting", slot.key], url);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: `${slot.label} updated` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setTimeout(() => {
        setUploading(null);
        setProgress(0);
      }, 600);
    }
  };

  const handleCropCancel = () => {
    if (cropState) URL.revokeObjectURL(cropState.src);
    setCropState(null);
  };

  const handleRemove = async (slot: ImageSlot) => {
    const { error } = await supabase.from("site_settings").upsert(
      { key: slot.key, value: "" as any, updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (!error) {
      setImages((prev) => {
        const copy = { ...prev };
        delete copy[slot.key];
        return copy;
      });
      qc.setQueryData(["site-setting", slot.key], "");
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: `${slot.label} removed` });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-light tracking-tight" style={headingFont}>On-Page Images</h2>
        <p className="text-xs text-muted-foreground mt-1" style={bodyFont}>
          Upload and manage site-wide images. Each image will be cropped to its recommended size.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {IMAGE_SLOTS.map((slot) => {
          const currentUrl = images[slot.key];
          const isUploading = uploading === slot.key;

          return (
            <div key={slot.key} className="border border-border rounded-lg overflow-hidden bg-card">
              {/* Preview */}
              <div className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden">
                {currentUrl ? (
                  <img loading="lazy" decoding="async"
                    src={currentUrl}
                    alt={slot.label}
                    className={`w-full h-full ${slot.key === "site_logo" ? "object-contain p-6" : "object-cover"}`}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Image className="h-8 w-8 opacity-30" />
                    <span className="text-[10px] tracking-wider uppercase" style={headingFont}>No image</span>
                  </div>
                )}

                {isUploading && (
                  <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <div className="w-3/4 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{progress}%</span>
                  </div>
                )}
              </div>

              {/* Info & Actions */}
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-medium" style={headingFont}>{slot.label}</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed" style={bodyFont}>
                    {slot.description}
                  </p>
                  <p className="text-[10px] text-primary/70 mt-1" style={headingFont}>
                    Required: {slot.width}×{slot.height}px ({slot.width > slot.height ? "Landscape" : slot.width === slot.height ? "Square" : "Portrait"})
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => { fileRefs.current[slot.key] = el; }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileSelect(slot, f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => fileRefs.current[slot.key]?.click()}
                    disabled={isUploading}
                    className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 rounded-md border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-all disabled:opacity-50"
                    style={headingFont}
                  >
                    <Upload className="h-3 w-3" />
                    {currentUrl ? "Replace" : "Upload"}
                  </button>
                  {currentUrl && (
                    <button
                      onClick={() => handleRemove(slot)}
                      disabled={isUploading}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all disabled:opacity-50"
                      style={headingFont}
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </button>
                  )}
                </div>

                {currentUrl && (
                  <div className="flex items-center gap-1.5 text-[10px] text-primary">
                    <CheckCircle className="h-3 w-3" />
                    <span style={bodyFont}>Active</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Crop Modal */}
      {cropState && (
        <ImageCropModal
          imageSrc={cropState.src}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
          forcedAspect={cropState.slot.width / cropState.slot.height}
          targetWidth={cropState.slot.width}
          targetHeight={cropState.slot.height}
        />
      )}
    </div>
  );
};

export default AdminOnPageImages;
