import { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { storageRemove } from "@/lib/storageUpload";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles, compressThumbnail } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import {
  Upload, Loader2, Trash2, Eye, EyeOff, Pencil, Check, X,
  Calendar, Clock, CheckSquare, Square, Image as ImageIcon,
  Sparkles, AlertTriangle, ArrowUp, ArrowDown, LayoutGrid, LayoutList, Columns, GalleryHorizontalEnd,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";

const MAX_ACTIVE = 31;

const LAYOUT_OPTIONS = [
  { value: "classic", label: "Classic Grid", icon: LayoutGrid, desc: "Uniform equal-size tiles" },
  { value: "magazine", label: "Magazine", icon: LayoutList, desc: "Large hero + thumbnails" },
  { value: "bento", label: "Bento", icon: GalleryHorizontalEnd, desc: "Mixed tile sizes, Apple-style" },
  { value: "masonry", label: "Masonry", icon: Columns, desc: "Pinterest waterfall columns" },
] as const;

type LayoutType = typeof LAYOUT_OPTIONS[number]["value"];

const CATEGORIES = [
  "General", "Wildlife", "Street", "Portrait", "Aerial", "Documentary",
  "Landscape", "Architecture", "Macro", "Sports", "Fashion",
  "Underwater", "Astrophotography", "Food", "Travel", "Abstract",
  "Nature", "Urban", "Black & White", "Night",
];

interface GalleryImage {
  id: string;
  title: string;
  category: string;
  image_url: string;
  thumbnail_url: string | null;
  sort_order: number;
  is_visible: boolean;
  created_at: string;
  active_from: string | null;
  active_until: string | null;
}

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

const optimizeAdminThumbnailUrl = (url: string) => {
  if (!url || !url.includes("/storage/v1/object/public/")) return url;

  const [baseUrl, queryString] = url.split("?");
  const transformedBase = baseUrl.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/"
  );

  const params = new URLSearchParams(queryString || "");
  if (!params.has("width")) params.set("width", "160");
  if (!params.has("height")) params.set("height", "160");
  if (!params.has("quality")) params.set("quality", "55");
  if (!params.has("resize")) params.set("resize", "cover");
  if (!params.has("format")) params.set("format", "webp");

  return `${transformedBase}?${params.toString()}`;
};

const AdminGallery = ({ user }: { user: User | null }) => {
  const qc = useQueryClient();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { name: string; progress: number; status: string }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", category: "", active_from: "", active_until: "" });
  const [sortCol, setSortCol] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [galleryLayout, setGalleryLayout] = useState<LayoutType>("classic");
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) => {
      let av: any, bv: any;
      switch (sortCol) {
        case "title": av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
        case "category": av = a.category.toLowerCase(); bv = b.category.toLowerCase(); break;
        case "status": av = a.is_visible ? 1 : 0; bv = b.is_visible ? 1 : 0; break;
        case "created_at": av = a.created_at; bv = b.created_at; break;
        default: av = a.sort_order; bv = b.sort_order;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [images, sortCol, sortDir]);

  const activeCount = images.filter((i) => i.is_visible).length;

  const fetchImages = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("portfolio_images")
      .select("id, title, category, image_url, thumbnail_url, sort_order, is_visible, created_at, active_from, active_until")
      .order("sort_order", { ascending: true })
      .limit(50);
    setImages((data as GalleryImage[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  // Fetch gallery layout setting
  useEffect(() => {
    supabase.from("site_settings").select("value").eq("key", "gallery_layout").maybeSingle().then(({ data }) => {
      if (data?.value && typeof data.value === "object" && "layout" in (data.value as any)) {
        setGalleryLayout((data.value as any).layout as LayoutType);
      }
    });
  }, []);

  const saveLayout = async (layout: LayoutType) => {
    setGalleryLayout(layout);
    setLayoutSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "gallery_layout",
      value: { layout } as any,
      updated_by: user?.id || null,
    } as any);
    setLayoutSaving(false);
    if (error) {
      toast({ title: "Failed to save layout", variant: "destructive" });
    } else {
      qc.setQueryData(["site-setting", "gallery_layout"], { layout });
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: `Layout changed to ${LAYOUT_OPTIONS.find(o => o.value === layout)?.label}` });
    }
  };


  const handleUpload = async (files: FileList) => {
    if (!user || files.length === 0) return;
    setUploading(true);
    const currentMax = images.length > 0 ? Math.max(...images.map((p) => p.sort_order)) : 0;

    const initProgress: Record<string, any> = {};
    for (let i = 0; i < files.length; i++) {
      initProgress[`f-${i}`] = { name: files[i].name, progress: 0, status: "uploading" };
    }
    setUploadProgress(initProgress);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = `f-${i}`;

      setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 10 } }));

      const safe = await scanFileWithToast(file, toast, { allowedTypes: "image" });
      if (!safe) {
        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 100, status: "error" } }));
        continue;
      }

      setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 20 } }));

      try {
        // Compress to WebP (display) + Thumbnail (grid)
        const baseName = `gallery-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
        const [displayResult, thumbResult] = await Promise.all([
          compressImageToFiles(file, baseName),
          compressThumbnail(file, baseName),
        ]);

        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 50 } }));

        const webpPath = `gallery/${baseName}.webp`;
        const thumbPath = `gallery/${baseName}-thumb.webp`;

        // Upload display + thumbnail in parallel
        const [result, thumbUpload] = await Promise.all([
          uploadImage({ bucket: "portfolio-images", file: displayResult.webpFile, path: webpPath, type: "gallery", fileName: `${baseName}.webp` }),
          uploadImage({ bucket: "portfolio-images", file: thumbResult.webpFile, path: thumbPath, type: "gallery" }),
        ]);

        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 80 } }));

        // AI analysis for title & category (fire-and-forget style, don't block)
        let aiTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        let aiCategory = "General";

        try {
          const { data: aiData, error: aiErr } = await supabase.functions.invoke("analyze-gallery-image", {
            body: { imageUrl: result.url },
          });
          if (!aiErr && aiData?.title) aiTitle = aiData.title;
          if (!aiErr && aiData?.category) aiCategory = aiData.category;
        } catch {
          // AI failed, use defaults
        }

        await supabase.from("portfolio_images").insert({
          title: aiTitle,
          category: aiCategory,
          image_url: result.url,
          thumbnail_url: thumbUpload.url,
          sort_order: currentMax + i + 1,
          uploaded_by: user.id,
          is_visible: false, // Draft by default — admin reviews first
        });

        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 100, status: "done" } }));
      } catch (err: any) {
        console.error("Upload error:", err);
        toast({ title: `Failed: ${file.name}`, description: err.message, variant: "destructive" });
        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 100, status: "error" } }));
      }
    }

    setUploading(false);
    toast({ title: `${files.length} image(s) uploaded as drafts` });
    fetchImages();
    qc.invalidateQueries({ queryKey: ["home-gallery"] });
    setTimeout(() => setUploadProgress({}), 3000);
  };

  // Toggle visibility with 31-limit check
  const toggleVisibility = async (id: string, currentVisible: boolean) => {
    if (!currentVisible && activeCount >= MAX_ACTIVE) {
      toast({ title: "Limit reached", description: `Maximum ${MAX_ACTIVE} active images allowed. Deactivate another first.`, variant: "destructive" });
      return;
    }
    await supabase.from("portfolio_images").update({ is_visible: !currentVisible }).eq("id", id);
    setImages((prev) => prev.map((p) => (p.id === id ? { ...p, is_visible: !currentVisible } : p)));
    qc.invalidateQueries({ queryKey: ["home-gallery"] });
  };

  // Delete
  const deleteImage = async (id: string, imageUrl: string) => {
    const parts = imageUrl.split("/portfolio-images/");
    const filePath = parts.length > 1 ? parts[parts.length - 1] : null;
    if (filePath) await storageRemove("portfolio-images", [filePath]);
    await supabase.from("portfolio_images").delete().eq("id", id);
    setImages((prev) => prev.filter((p) => p.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    qc.invalidateQueries({ queryKey: ["home-gallery"] });
    toast({ title: "Deleted" });
  };

  // Bulk actions — batched single-query operations
  const bulkActivate = async () => {
    const toActivate = [...selected].filter((id) => !images.find((i) => i.id === id)?.is_visible);
    if (activeCount + toActivate.length > MAX_ACTIVE) {
      toast({ title: "Limit exceeded", description: `Only ${MAX_ACTIVE - activeCount} more can be activated.`, variant: "destructive" });
      return;
    }
    if (toActivate.length === 0) return;
    await supabase.from("portfolio_images").update({ is_visible: true }).in("id", toActivate);
    toast({ title: `${toActivate.length} activated` });
    setSelected(new Set());
    fetchImages();
    qc.invalidateQueries({ queryKey: ["home-gallery"] });
  };

  const bulkDeactivate = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    await supabase.from("portfolio_images").update({ is_visible: false }).in("id", ids);
    toast({ title: `${ids.length} deactivated` });
    setSelected(new Set());
    fetchImages();
    qc.invalidateQueries({ queryKey: ["home-gallery"] });
  };

  const bulkDelete = async () => {
    confirmAction({
      title: `Delete ${selected.size} image(s)?`,
      description: "This cannot be undone.",
      onConfirm: async () => {
        const ids = [...selected];
        const cleanups = ids.map((id) => {
          const img = images.find((i) => i.id === id);
          if (!img) return Promise.resolve();
          const parts = img.image_url.split("/portfolio-images/");
          const filePath = parts.length > 1 ? parts[parts.length - 1] : null;
          return filePath ? storageRemove("portfolio-images", [filePath]) : Promise.resolve();
        });
        await Promise.all(cleanups);
        await supabase.from("portfolio_images").delete().in("id", ids);
        setImages((prev) => prev.filter((i) => !ids.includes(i.id)));
        setSelected(new Set());
        qc.invalidateQueries({ queryKey: ["home-gallery"] });
        toast({ title: `${ids.length} images deleted` });
      },
    });
  };

  // Edit inline
  const startEdit = (img: GalleryImage) => {
    setEditingId(img.id);
    setEditForm({
      title: img.title,
      category: img.category,
      active_from: img.active_from ? img.active_from.slice(0, 16) : "",
      active_until: img.active_until ? img.active_until.slice(0, 16) : "",
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await supabase.from("portfolio_images").update({
      title: editForm.title,
      category: editForm.category,
      active_from: editForm.active_from || null,
      active_until: editForm.active_until || null,
    }).eq("id", editingId);
    setImages((prev) =>
      prev.map((p) =>
        p.id === editingId
          ? { ...p, title: editForm.title, category: editForm.category, active_from: editForm.active_from || null, active_until: editForm.active_until || null }
          : p
      )
    );
    setEditingId(null);
    qc.invalidateQueries({ queryKey: ["home-gallery"] });
    toast({ title: "Saved" });
  };

  // Re-analyze existing image with AI
  const reAnalyzeImage = async (img: GalleryImage) => {
    toast({ title: "Analyzing…", description: `Running AI on "${img.title}"` });
    try {
      const { data: aiData, error: aiErr } = await supabase.functions.invoke("analyze-gallery-image", {
        body: { imageUrl: img.image_url },
      });
      if (aiErr) throw aiErr;
      const newTitle = aiData?.title || img.title;
      const newCategory = aiData?.category || img.category;
      await supabase.from("portfolio_images").update({ title: newTitle, category: newCategory }).eq("id", img.id);
      setImages((prev) => prev.map((p) => p.id === img.id ? { ...p, title: newTitle, category: newCategory } : p));
      toast({ title: "AI Updated", description: `"${newTitle}" — ${newCategory}` });
    } catch {
      toast({ title: "AI analysis failed", variant: "destructive" });
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === images.length) setSelected(new Set());
    else setSelected(new Set(images.map((i) => i.id)));
  };

  // UTC-based schedule check — dates stored as ISO strings (UTC)
  const isScheduleActive = (img: GalleryImage) => {
    const nowUTC = Date.now();
    if (img.active_from && new Date(img.active_from).getTime() > nowUTC) return false;
    if (img.active_until && new Date(img.active_until).getTime() < nowUTC) return false;
    return true;
  };

  const missingThumbCount = images.filter((i) => !i.thumbnail_url).length;

  const generateMissingThumbnails = async () => {
    const missing = images.filter((i) => !i.thumbnail_url);
    if (missing.length === 0) { toast({ title: "All images already have thumbnails" }); return; }
    confirmAction({
      title: `Generate thumbnails for ${missing.length} image(s)?`,
      description: "This will fetch and re-compress each image.",
      variant: "default",
      confirmLabel: "Generate",
      onConfirm: async () => {
        setGeneratingThumbs(true);
        let done = 0;
        for (const img of missing) {
          try {
            const resp = await fetch(img.image_url);
            if (!resp.ok) throw new Error("Fetch failed");
            const blob = await resp.blob();
            const file = new File([blob], "image.jpg", { type: blob.type });
            const baseName = `gallery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const thumbResult = await compressThumbnail(file, baseName);
            const thumbPath = `gallery/${baseName}-thumb.webp`;
            const thumbUpload = await uploadImage({ bucket: "portfolio-images", file: thumbResult.webpFile, path: thumbPath, type: "gallery" });
            await supabase.from("portfolio_images").update({ thumbnail_url: thumbUpload.url }).eq("id", img.id);
            setImages((prev) => prev.map((p) => p.id === img.id ? { ...p, thumbnail_url: thumbUpload.url } : p));
            done++;
          } catch {
            console.error(`Thumb generation failed for ${img.title}`);
          }
        }
        setGeneratingThumbs(false);
        toast({ title: `Generated ${done}/${missing.length} thumbnails` });
      },
    });
  };

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Layout Selector */}
      <div className="border border-border rounded-sm p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headingFont}>
            Home page layout {layoutSaving && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          {LAYOUT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = galleryLayout === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => saveLayout(opt.value)}
                className={`flex flex-col items-center gap-1.5 p-3 border rounded-sm transition-all ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[9px] tracking-[0.15em] uppercase" style={headingFont}>{opt.label}</span>
                <span className="text-[8px] text-muted-foreground" style={bodyFont}>{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headingFont}>
              {images.length} total · {activeCount}/{MAX_ACTIVE} active
            </span>
            {activeCount >= MAX_ACTIVE && (
              <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-sm">
                <AlertTriangle className="h-3 w-3" /> Limit reached
              </span>
            )}
            {missingThumbCount > 0 && (
              <button
                onClick={generateMissingThumbnails}
                disabled={generatingThumbs}
                className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded-sm hover:bg-amber-500/20 transition-colors"
                style={headingFont}
              >
                {generatingThumbs ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
                {generatingThumbs ? "Generating…" : `${missingThumbCount} missing thumbnails — Generate`}
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>
            3-tier optimization: Thumbnail (grid) · Display WebP (lightbox) · Original JPEG (download). New uploads auto-generate all tiers.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shrink-0" style={headingFont}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload Images
          <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} disabled={uploading} />
        </label>
      </div>

      {/* Upload progress */}
      {Object.keys(uploadProgress).length > 0 && (
        <div className="border border-border rounded-sm p-4 space-y-2">
          <p className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={headingFont}>
            Uploading {Object.values(uploadProgress).filter((p) => p.status === "done").length} / {Object.keys(uploadProgress).length}
          </p>
          {Object.entries(uploadProgress).map(([key, item]) => (
            <div key={key} className="flex items-center gap-3">
              <span className="text-[10px] truncate w-32 shrink-0" style={bodyFont}>
                {item.name.length > 20 ? item.name.slice(0, 18) + "…" : item.name}
              </span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${item.status === "error" ? "bg-destructive" : item.status === "done" ? "bg-emerald-500" : "bg-primary"}`}
                  style={{ width: `${item.progress}%` }}
                />
              </div>
              <span className={`text-[9px] w-10 text-right tabular-nums ${item.status === "error" ? "text-destructive" : item.status === "done" ? "text-emerald-500" : "text-muted-foreground"}`} style={headingFont}>
                {item.status === "error" ? "ERR" : `${item.progress}%`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-sm">
          <span className="text-[10px] text-primary" style={headingFont}>{selected.size} selected</span>
          <button onClick={bulkActivate} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors" style={headingFont}>
            Activate
          </button>
          <button onClick={bulkDeactivate} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-muted-foreground/30 text-muted-foreground hover:bg-muted transition-colors" style={headingFont}>
            Deactivate
          </button>
          <button onClick={bulkDelete} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors" style={headingFont}>
            Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[9px] text-muted-foreground hover:text-foreground" style={headingFont}>
            Clear
          </button>
        </div>
      )}

      {/* List view */}
      {images.length > 0 ? (
        <>
          {/* Desktop table view - hidden on mobile */}
          <div className="hidden md:block border border-border rounded-sm divide-y divide-border">
            {/* Header row */}
            <div className="flex items-center gap-3 px-3 py-2 bg-muted/30 text-[8px] tracking-[0.2em] uppercase text-muted-foreground select-none" style={headingFont}>
              <button onClick={toggleAll} className="shrink-0 p-0.5">
                {selected.size === images.length ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
              </button>
              <span className="w-8 shrink-0 text-center">Sl</span>
              <span className="w-12 shrink-0">Image</span>
              <button onClick={() => handleSort("title")} className="flex-1 min-w-0 flex items-center gap-1 hover:text-foreground transition-colors text-left">
                Title {sortCol === "title" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
              </button>
              <button onClick={() => handleSort("category")} className="w-24 shrink-0 flex items-center gap-1 hover:text-foreground transition-colors">
                Category {sortCol === "category" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
              </button>
              <button onClick={() => handleSort("status")} className="w-20 shrink-0 hidden lg:flex items-center gap-1 hover:text-foreground transition-colors">
                Status {sortCol === "status" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
              </button>
              <span className="w-28 shrink-0 hidden lg:block">Schedule</span>
              <button onClick={() => handleSort("created_at")} className="w-20 shrink-0 flex items-center gap-1 hover:text-foreground transition-colors">
                Created {sortCol === "created_at" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
              </button>
              <span className="w-28 shrink-0 text-right">Actions</span>
            </div>

            {sortedImages.map((img, index) => {
              const isEditing = editingId === img.id;
              const schedActive = isScheduleActive(img);
              const effectivelyActive = img.is_visible && schedActive;

              return (
                <div key={img.id} className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/20 transition-colors ${!img.is_visible ? "opacity-60" : ""}`}>
                  <button onClick={() => toggleSelect(img.id)} className="shrink-0 p-0.5">
                    {selected.has(img.id) ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  <span className="w-8 shrink-0 text-center text-[10px] text-muted-foreground tabular-nums" style={bodyFont}>{index + 1}</span>
                  <div className="w-12 h-12 shrink-0 rounded-sm overflow-hidden bg-muted relative">
                    <img src={img.thumbnail_url || optimizeAdminThumbnailUrl(img.image_url)} alt={img.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    {!img.thumbnail_url && (
                      <span className="absolute bottom-0 right-0 bg-amber-500/80 text-[6px] text-white px-0.5 leading-tight" title="No optimized thumbnail">!</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="w-full bg-transparent border-b border-primary text-xs py-0.5 outline-none" style={bodyFont} />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs truncate" style={bodyFont}>{img.title}</span>
                        {!schedActive && img.is_visible && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
                      </div>
                    )}
                  </div>
                  <div className="w-24 shrink-0">
                    {isEditing ? (
                      <select value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))} className="bg-transparent border border-border rounded-sm text-[10px] px-1 py-0.5 outline-none w-full">
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 border border-border rounded-sm" style={headingFont}>{img.category}</span>
                    )}
                  </div>
                  <div className="w-20 shrink-0 hidden lg:block">
                    <button onClick={() => toggleVisibility(img.id, img.is_visible)} className={`text-[9px] px-1.5 py-0.5 rounded-sm border cursor-pointer transition-colors ${effectivelyActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`} style={headingFont}>
                      {effectivelyActive ? "Active" : img.is_visible ? "Scheduled" : "Draft"}
                    </button>
                  </div>
                  <div className="w-28 shrink-0 hidden lg:block">
                    {isEditing ? (
                      <div className="space-y-1">
                        <input type="datetime-local" value={editForm.active_from} onChange={(e) => setEditForm((f) => ({ ...f, active_from: e.target.value }))} className="bg-transparent border border-border rounded-sm text-[9px] px-1 py-0.5 outline-none w-full" />
                        <input type="datetime-local" value={editForm.active_until} onChange={(e) => setEditForm((f) => ({ ...f, active_until: e.target.value }))} className="bg-transparent border border-border rounded-sm text-[9px] px-1 py-0.5 outline-none w-full" />
                      </div>
                    ) : (
                      <div className="text-[9px] text-muted-foreground" style={bodyFont}>
                        {img.active_from ? new Date(img.active_from).toLocaleDateString() : "—"}{" → "}{img.active_until ? new Date(img.active_until).toLocaleDateString() : "∞"}
                      </div>
                    )}
                  </div>
                  <div className="w-20 shrink-0">
                    <span className="text-[9px] text-muted-foreground" style={bodyFont}>{new Date(img.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="w-28 shrink-0 flex items-center justify-end gap-1">
                    {isEditing ? (
                      <>
                        <button onClick={saveEdit} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-sm"><Check className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 text-muted-foreground hover:bg-muted rounded-sm"><X className="h-3.5 w-3.5" /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => reAnalyzeImage(img)} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-sm" title="Re-analyze with AI"><Sparkles className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(img)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-sm"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => toggleVisibility(img.id, img.is_visible)} className={`p-1.5 rounded-sm ${img.is_visible ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}>
                          {img.is_visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => deleteImage(img.id, img.image_url)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-sm"><Trash2 className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile card view */}
          <div className="md:hidden space-y-2">
            {/* Mobile sort & select controls */}
            <div className="flex items-center justify-between px-1">
              <button onClick={toggleAll} className="flex items-center gap-1.5 text-[9px] tracking-wider uppercase text-muted-foreground" style={headingFont}>
                {selected.size === images.length ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </button>
              <div className="flex items-center gap-1">
                {(["title", "created_at", "category"] as const).map(col => (
                  <button key={col} onClick={() => handleSort(col)} className={`text-[8px] tracking-wider uppercase px-2 py-1 border rounded-sm transition-colors ${sortCol === col ? "border-primary text-primary" : "border-border text-muted-foreground"}`} style={headingFont}>
                    {col === "created_at" ? "Date" : col}
                    {sortCol === col && (sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5 inline ml-0.5" /> : <ArrowDown className="h-2.5 w-2.5 inline ml-0.5" />)}
                  </button>
                ))}
              </div>
            </div>

            {sortedImages.map((img, index) => {
              const schedActive = isScheduleActive(img);
              const effectivelyActive = img.is_visible && schedActive;

              return (
                <div key={img.id} className={`border border-border rounded-sm p-3 transition-colors ${!img.is_visible ? "opacity-60" : ""} ${selected.has(img.id) ? "border-primary bg-primary/5" : ""}`}>
                  <div className="flex gap-3">
                    {/* Checkbox + Thumbnail */}
                    <div className="flex flex-col items-center gap-2">
                      <button onClick={() => toggleSelect(img.id)} className="p-0.5">
                        {selected.has(img.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                      </button>
                      <div className="w-16 h-16 rounded-sm overflow-hidden bg-muted shrink-0 relative">
                        <img src={img.thumbnail_url || optimizeAdminThumbnailUrl(img.image_url)} alt={img.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        {!img.thumbnail_url && (
                          <span className="absolute bottom-0 right-0 bg-amber-500/80 text-[6px] text-white px-0.5 leading-tight" title="No thumbnail">!</span>
                        )}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate" style={bodyFont}>{img.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[8px] px-1.5 py-0.5 border border-border rounded-sm" style={headingFont}>{img.category}</span>
                            <button onClick={() => toggleVisibility(img.id, img.is_visible)} className={`text-[8px] px-1.5 py-0.5 rounded-sm border transition-colors ${effectivelyActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`} style={headingFont}>
                              {effectivelyActive ? "Active" : img.is_visible ? "Scheduled" : "Draft"}
                            </button>
                          </div>
                          <p className="text-[9px] text-muted-foreground mt-1" style={bodyFont}>
                            #{index + 1} · {new Date(img.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 mt-2">
                        <button onClick={() => reAnalyzeImage(img)} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-sm"><Sparkles className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(img)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-sm"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => toggleVisibility(img.id, img.is_visible)} className={`p-1.5 rounded-sm ${img.is_visible ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}>
                          {img.is_visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => deleteImage(img.id, img.image_url)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-sm"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="text-center py-16 border border-dashed border-border rounded-sm">
          <ImageIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground" style={bodyFont}>No gallery images yet. Upload your first batch above.</p>
          <p className="text-[10px] text-muted-foreground/60 mt-2" style={bodyFont}>
            <Sparkles className="h-3 w-3 inline mr-1" />
            AI will auto-suggest titles & categories for each upload
          </p>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminGallery;
