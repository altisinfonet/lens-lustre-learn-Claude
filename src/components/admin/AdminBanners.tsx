import { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { storageRemove } from "@/lib/storageUpload";
import { uploadImageWithThumbnail } from "@/lib/imageUpload";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import {
  Upload, Loader2, Trash2, Eye, EyeOff, Pencil, Check, X,
  Clock, CheckSquare, Square, Image as ImageIcon, Plus,
  Sparkles, AlertTriangle, ArrowUp, ArrowDown, Type, Save,
  Globe,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";

const MAX_BANNERS = 20;

const CATEGORIES = [
  "General", "Wildlife", "Street", "Portrait", "Aerial", "Documentary",
  "Landscape", "Architecture", "Macro", "Sports", "Fashion",
  "Underwater", "Astrophotography", "Food", "Travel", "Abstract",
  "Nature", "Urban", "Black & White", "Night",
];

interface Banner {
  id: string;
  title: string;
  category: string;
  image_url: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  active_from: string | null;
  active_until: string | null;
}

interface HeroContent {
  label: string;
  heading: string;
  heading_accent: string;
  subtitle: string;
  cta_text: string;
  cta_link: string;
}

const DEFAULT_HERO: HeroContent = {
  label: "Photography Platform",
  heading: "Every Frame",
  heading_accent: "Tells",
  subtitle: "A curated space for photographers who see the world differently. Compete globally. Learn from masters. Share your stories.",
  cta_text: "Begin Your Journey",
  cta_link: "/signup",
};

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

const optimizeAdminThumbnailUrl = (url: string) => {
  if (!url || !url.includes("/storage/v1/object/public/")) return url;
  const [baseUrl, queryString] = url.split("?");
  const transformedBase = baseUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const params = new URLSearchParams(queryString || "");
  if (!params.has("width")) params.set("width", "160");
  if (!params.has("height")) params.set("height", "160");
  if (!params.has("quality")) params.set("quality", "55");
  if (!params.has("resize")) params.set("resize", "cover");
  if (!params.has("format")) params.set("format", "webp");
  return `${transformedBase}?${params.toString()}`;
};

const AdminBanners = ({ user }: { user: User | null }) => {
  const qc = useQueryClient();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { name: string; progress: number; status: string }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", category: "", active_from: "", active_until: "" });
  const [sortCol, setSortCol] = useState<string>("sort_order");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Hero content state
  const [heroContent, setHeroContent] = useState<HeroContent>(DEFAULT_HERO);
  const [heroSaving, setHeroSaving] = useState(false);

  const activeCount = banners.filter((b) => b.is_active).length;
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const sortedBanners = useMemo(() => {
    return [...banners].sort((a, b) => {
      let av: any, bv: any;
      switch (sortCol) {
        case "title": av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
        case "category": av = a.category.toLowerCase(); bv = b.category.toLowerCase(); break;
        case "status": av = a.is_active ? 1 : 0; bv = b.is_active ? 1 : 0; break;
        case "created_at": av = a.created_at || ""; bv = b.created_at || ""; break;
        default: av = a.sort_order; bv = b.sort_order;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [banners, sortCol, sortDir]);

  const fetchBanners = useCallback(async () => {
    setLoading(true);
    const [bannersRes, heroRes] = await Promise.all([
      supabase.from("hero_banners").select("*").order("sort_order", { ascending: true }),
      supabase.from("site_settings").select("value").eq("key", "hero_content").maybeSingle(),
    ]);
    const raw = bannersRes.data || [];
    setBanners(raw.map((b: any) => ({
      ...b,
      created_at: b.created_at || "",
      active_from: b.active_from || null,
      active_until: b.active_until || null,
    })));
    if (heroRes.data?.value) setHeroContent(heroRes.data.value as unknown as HeroContent);
    setLoading(false);
  }, []);

  useEffect(() => { fetchBanners(); }, [fetchBanners]);

  const handleHeroSave = async () => {
    setHeroSaving(true);
    const { error } = await supabase.from("site_settings").upsert({
      key: "hero_content",
      value: heroContent as any,
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null,
    });
    if (error) {
      toast({ title: "Failed to save hero content", variant: "destructive" });
    } else {
      qc.setQueryData(["site-setting", "hero_content"], heroContent);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Hero content updated" });
    }
    setHeroSaving(false);
  };

  // Upload with AI naming & progress bars
  const handleUpload = async (files: FileList) => {
    if (!user || files.length === 0) return;
    if (banners.length + files.length > MAX_BANNERS) {
      toast({ title: `Maximum ${MAX_BANNERS} banners. You can add ${MAX_BANNERS - banners.length} more.`, variant: "destructive" });
      return;
    }
    setUploading(true);
    const currentMax = banners.length > 0 ? Math.max(...banners.map((b) => b.sort_order)) : 0;

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
        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 50 } }));

        const result = await uploadImageWithThumbnail({
          bucket: "portfolio-images",
          file,
          type: "banner",
        });

        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 80 } }));

        // AI analysis for title & category
        let aiTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        let aiCategory = "General";
        try {
          const { data: aiData, error: aiErr } = await supabase.functions.invoke("analyze-gallery-image", {
            body: { imageUrl: result.url },
          });
          if (!aiErr && aiData?.title) aiTitle = aiData.title;
          if (!aiErr && aiData?.category) aiCategory = aiData.category;
        } catch { /* AI failed, use defaults */ }

        await supabase.from("hero_banners").insert({
          title: aiTitle,
          category: aiCategory,
          image_url: result.url,
          thumbnail_url: result.thumbnailUrl,
          sort_order: currentMax + i + 1,
          is_active: false, // Draft by default
        } as any);

        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 100, status: "done" } }));
      } catch (err: any) {
        console.error("Upload error:", err);
        toast({ title: `Failed: ${file.name}`, description: err.message, variant: "destructive" });
        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 100, status: "error" } }));
      }
    }

    setUploading(false);
    toast({ title: `${files.length} banner(s) uploaded as drafts` });
    fetchBanners();
    qc.invalidateQueries({ queryKey: ["home-banners"] });
    setTimeout(() => setUploadProgress({}), 3000);
  };

  // Toggle active with limit check
  const toggleActive = async (id: string, current: boolean) => {
    if (!current && activeCount >= MAX_BANNERS) {
      toast({ title: "Limit reached", description: `Maximum ${MAX_BANNERS} active banners.`, variant: "destructive" });
      return;
    }
    await supabase.from("hero_banners").update({ is_active: !current, updated_at: new Date().toISOString() }).eq("id", id);
    setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, is_active: !current } : b)));
    qc.invalidateQueries({ queryKey: ["home-banners"] });
    toast({ title: !current ? "Banner is now LIVE" : "Banner set to Draft" });
  };

  // Delete
  const deleteBanner = async (id: string, imageUrl: string) => {
    const parts = imageUrl.split("/portfolio-images/");
    const filePath = parts.length > 1 ? parts[parts.length - 1] : null;
    if (filePath) await storageRemove("portfolio-images", [filePath]);
    await supabase.from("hero_banners").delete().eq("id", id);
    setBanners((prev) => prev.filter((b) => b.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    qc.invalidateQueries({ queryKey: ["home-banners"] });
    toast({ title: "Banner deleted" });
  };

  // Bulk actions — batched single-query operations
  const bulkActivate = async () => {
    const toActivate = [...selected].filter((id) => !banners.find((b) => b.id === id)?.is_active);
    if (activeCount + toActivate.length > MAX_BANNERS) {
      toast({ title: "Limit exceeded", description: `Only ${MAX_BANNERS - activeCount} more can be activated.`, variant: "destructive" });
      return;
    }
    if (toActivate.length === 0) return;
    await supabase.from("hero_banners").update({ is_active: true, updated_at: new Date().toISOString() }).in("id", toActivate);
    toast({ title: `${toActivate.length} activated` });
    setSelected(new Set());
    fetchBanners();
    qc.invalidateQueries({ queryKey: ["home-banners"] });
  };

  const bulkDeactivate = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    await supabase.from("hero_banners").update({ is_active: false, updated_at: new Date().toISOString() }).in("id", ids);
    toast({ title: `${ids.length} deactivated` });
    setSelected(new Set());
    fetchBanners();
    qc.invalidateQueries({ queryKey: ["home-banners"] });
  };

  const bulkDelete = async () => {
    confirmAction({
      title: `Delete ${selected.size} banner(s)?`,
      description: "This cannot be undone.",
      onConfirm: async () => {
        const ids = [...selected];
        const storageCleanups = ids.map((id) => {
          const b = banners.find((bn) => bn.id === id);
          if (!b) return Promise.resolve();
          const parts = b.image_url.split("/portfolio-images/");
          const filePath = parts.length > 1 ? parts[parts.length - 1] : null;
          return filePath ? storageRemove("portfolio-images", [filePath]) : Promise.resolve();
        });
        await Promise.all(storageCleanups);
        await supabase.from("hero_banners").delete().in("id", ids);
        setBanners((prev) => prev.filter((b) => !ids.includes(b.id)));
        setSelected(new Set());
        qc.invalidateQueries({ queryKey: ["home-banners"] });
        toast({ title: `${ids.length} banners deleted` });
      },
    });
  };

  // Inline edit
  const startEdit = (b: Banner) => {
    setEditingId(b.id);
    setEditForm({
      title: b.title,
      category: b.category,
      active_from: b.active_from ? b.active_from.slice(0, 16) : "",
      active_until: b.active_until ? b.active_until.slice(0, 16) : "",
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await supabase.from("hero_banners").update({
      title: editForm.title,
      category: editForm.category,
      active_from: editForm.active_from ? new Date(editForm.active_from).toISOString() : null,
      active_until: editForm.active_until ? new Date(editForm.active_until).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", editingId);
    setBanners((prev) =>
      prev.map((b) =>
        b.id === editingId
          ? { ...b, title: editForm.title, category: editForm.category, active_from: editForm.active_from ? new Date(editForm.active_from).toISOString() : null, active_until: editForm.active_until ? new Date(editForm.active_until).toISOString() : null }
          : b
      )
    );
    setEditingId(null);
    qc.invalidateQueries({ queryKey: ["home-banners"] });
    toast({ title: "Saved" });
  };

  // AI re-analyze
  const reAnalyzeBanner = async (b: Banner) => {
    toast({ title: "Analyzing…", description: `Running AI on "${b.title}"` });
    try {
      const { data: aiData, error: aiErr } = await supabase.functions.invoke("analyze-gallery-image", {
        body: { imageUrl: b.image_url },
      });
      if (aiErr) throw aiErr;
      const newTitle = aiData?.title || b.title;
      const newCategory = aiData?.category || b.category;
      await supabase.from("hero_banners").update({ title: newTitle, category: newCategory, updated_at: new Date().toISOString() }).eq("id", b.id);
      setBanners((prev) => prev.map((bn) => bn.id === b.id ? { ...bn, title: newTitle, category: newCategory } : bn));
      toast({ title: "AI Updated", description: `"${newTitle}" — ${newCategory}` });
    } catch {
      toast({ title: "AI analysis failed", variant: "destructive" });
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleAll = () => {
    if (selected.size === banners.length) setSelected(new Set());
    else setSelected(new Set(banners.map((b) => b.id)));
  };

  // UTC-based schedule check — dates stored as ISO strings (UTC)
  const isScheduleActive = (b: Banner) => {
    const nowUTC = Date.now();
    if (b.active_from && new Date(b.active_from).getTime() > nowUTC) return false;
    if (b.active_until && new Date(b.active_until).getTime() < nowUTC) return false;
    return true;
  };

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>;

  return (
    <div className="space-y-8">
      {/* Hero Content Editor */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Type className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary font-medium" style={headingFont}>Hero Text & CTA</span>
          <div className="flex-1 h-px bg-primary/20" />
        </div>
        <div className="border border-border p-4 rounded-sm space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 block">Top Label</label>
              <input value={heroContent.label} onChange={(e) => setHeroContent(h => ({ ...h, label: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 block">Heading (main)</label>
              <input value={heroContent.heading} onChange={(e) => setHeroContent(h => ({ ...h, heading: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 block">Heading Accent (italic)</label>
              <input value={heroContent.heading_accent} onChange={(e) => setHeroContent(h => ({ ...h, heading_accent: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 block">CTA Button Text</label>
              <input value={heroContent.cta_text} onChange={(e) => setHeroContent(h => ({ ...h, cta_text: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 block">CTA Link</label>
              <input value={heroContent.cta_link} onChange={(e) => setHeroContent(h => ({ ...h, cta_link: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 block">Subtitle</label>
            <textarea value={heroContent.subtitle} onChange={(e) => setHeroContent(h => ({ ...h, subtitle: e.target.value }))} rows={2}
              className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary resize-none" />
          </div>
          <div className="flex justify-end">
            <button onClick={handleHeroSave} disabled={heroSaving}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm disabled:opacity-50"
              style={headingFont}>
              {heroSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save Hero Content
            </button>
          </div>
        </div>
      </div>

      {/* Banner Images Section */}
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headingFont}>
                {banners.length}/{MAX_BANNERS} total · {activeCount} active
              </span>
              {activeCount >= MAX_BANNERS && (
                <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-sm">
                  <AlertTriangle className="h-3 w-3" /> Limit reached
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>
              Images compressed to WebP automatically. AI suggests title & category. New uploads default to draft.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shrink-0 rounded-sm" style={headingFont}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload Banners
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
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-sm flex-wrap">
            <span className="text-[10px] text-primary" style={headingFont}>{selected.size} selected</span>
            <button onClick={bulkActivate} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors rounded-sm" style={headingFont}>
              Activate
            </button>
            <button onClick={bulkDeactivate} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-muted-foreground/30 text-muted-foreground hover:bg-muted transition-colors rounded-sm" style={headingFont}>
              Deactivate
            </button>
            <button onClick={bulkDelete} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors rounded-sm" style={headingFont}>
              Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-[9px] text-muted-foreground hover:text-foreground" style={headingFont}>
              Clear
            </button>
          </div>
        )}

        {/* List view */}
        {banners.length > 0 ? (
          <>
            {/* Desktop table view */}
            <div className="hidden md:block border border-border rounded-sm divide-y divide-border">
              {/* Header row */}
              <div className="flex items-center gap-3 px-3 py-2 bg-muted/30 text-[8px] tracking-[0.2em] uppercase text-muted-foreground select-none" style={headingFont}>
                <button onClick={toggleAll} className="shrink-0 p-0.5">
                  {selected.size === banners.length ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
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

              {sortedBanners.map((b, index) => {
                const isEditing = editingId === b.id;
                const schedActive = isScheduleActive(b);
                const effectivelyActive = b.is_active && schedActive;

                return (
                  <div key={b.id} className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/20 transition-colors ${!b.is_active ? "opacity-60" : ""}`}>
                    <button onClick={() => toggleSelect(b.id)} className="shrink-0 p-0.5">
                      {selected.has(b.id) ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                    <span className="w-8 shrink-0 text-center text-[10px] text-muted-foreground tabular-nums" style={bodyFont}>{index + 1}</span>
                    <div className="w-12 h-12 shrink-0 rounded-sm overflow-hidden bg-muted">
                      <img src={optimizeAdminThumbnailUrl(b.image_url)} alt={b.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="w-full bg-transparent border-b border-primary text-xs py-0.5 outline-none" style={bodyFont} />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs truncate" style={bodyFont}>{b.title}</span>
                          {!schedActive && b.is_active && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
                        </div>
                      )}
                    </div>
                    <div className="w-24 shrink-0">
                      {isEditing ? (
                        <select value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))} className="bg-transparent border border-border rounded-sm text-[10px] px-1 py-0.5 outline-none w-full">
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 border border-border rounded-sm" style={headingFont}>{b.category}</span>
                      )}
                    </div>
                    <div className="w-20 shrink-0 hidden lg:block">
                      <button onClick={() => toggleActive(b.id, b.is_active)} className={`text-[9px] px-1.5 py-0.5 rounded-sm border cursor-pointer transition-colors ${effectivelyActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`} style={headingFont}>
                        {effectivelyActive ? "Live" : b.is_active ? "Scheduled" : "Draft"}
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
                          {b.active_from ? new Date(b.active_from).toLocaleDateString() : "—"}{" → "}{b.active_until ? new Date(b.active_until).toLocaleDateString() : "∞"}
                        </div>
                      )}
                    </div>
                    <div className="w-20 shrink-0">
                      <span className="text-[9px] text-muted-foreground" style={bodyFont}>{b.created_at ? new Date(b.created_at).toLocaleDateString() : "—"}</span>
                    </div>
                    <div className="w-28 shrink-0 flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button onClick={saveEdit} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-sm"><Check className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 text-muted-foreground hover:bg-muted rounded-sm"><X className="h-3.5 w-3.5" /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => reAnalyzeBanner(b)} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-sm" title="Re-analyze with AI"><Sparkles className="h-3.5 w-3.5" /></button>
                          <button onClick={() => startEdit(b)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-sm"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => toggleActive(b.id, b.is_active)} className={`p-1.5 rounded-sm ${b.is_active ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}>
                            {b.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                          <button onClick={() => deleteBanner(b.id, b.image_url)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-sm"><Trash2 className="h-3.5 w-3.5" /></button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-2">
              <div className="flex items-center justify-between px-1">
                <button onClick={toggleAll} className="flex items-center gap-1.5 text-[9px] tracking-wider uppercase text-muted-foreground" style={headingFont}>
                  {selected.size === banners.length ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
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

              {sortedBanners.map((b, index) => {
                const schedActive = isScheduleActive(b);
                const effectivelyActive = b.is_active && schedActive;

                return (
                  <div key={b.id} className={`border border-border rounded-sm p-3 transition-colors ${!b.is_active ? "opacity-60" : ""} ${selected.has(b.id) ? "border-primary bg-primary/5" : ""}`}>
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center gap-2">
                        <button onClick={() => toggleSelect(b.id)} className="p-0.5">
                          {selected.has(b.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                        </button>
                        <div className="w-16 h-16 rounded-sm overflow-hidden bg-muted shrink-0">
                          <img src={optimizeAdminThumbnailUrl(b.image_url)} alt={b.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate" style={bodyFont}>{b.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[8px] px-1.5 py-0.5 border border-border rounded-sm" style={headingFont}>{b.category}</span>
                              <button onClick={() => toggleActive(b.id, b.is_active)} className={`text-[8px] px-1.5 py-0.5 rounded-sm border transition-colors ${effectivelyActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`} style={headingFont}>
                                {effectivelyActive ? "Live" : b.is_active ? "Scheduled" : "Draft"}
                              </button>
                            </div>
                            <p className="text-[9px] text-muted-foreground mt-1" style={bodyFont}>
                              #{index + 1} · {b.created_at ? new Date(b.created_at).toLocaleDateString() : "—"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 mt-2">
                          <button onClick={() => reAnalyzeBanner(b)} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-sm"><Sparkles className="h-3.5 w-3.5" /></button>
                          <button onClick={() => startEdit(b)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-sm"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => toggleActive(b.id, b.is_active)} className={`p-1.5 rounded-sm ${b.is_active ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}>
                            {b.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                          <button onClick={() => deleteBanner(b.id, b.image_url)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-sm"><Trash2 className="h-3.5 w-3.5" /></button>
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
            <p className="text-sm text-muted-foreground" style={bodyFont}>No banners yet. Upload your first batch above.</p>
            <p className="text-[10px] text-muted-foreground/60 mt-2" style={bodyFont}>
              <Sparkles className="h-3 w-3 inline mr-1" />
              AI will auto-suggest titles & categories for each upload
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminBanners;
