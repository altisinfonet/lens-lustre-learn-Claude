import { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadImageWithThumbnail } from "@/lib/imageUpload";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import {
  Upload, Loader2, Trash2, Eye, EyeOff, Pencil, Check, X,
  Clock, CheckSquare, Square, Image as ImageIcon,
  Sparkles, AlertTriangle, ArrowUp, ArrowDown, Star,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";

const MAX_ACTIVE = 20;

const CATEGORIES = [
  "General", "Wildlife", "Street", "Portrait", "Aerial", "Documentary",
  "Landscape", "Architecture", "Macro", "Sports", "Fashion",
  "Underwater", "Astrophotography", "Food", "Travel", "Abstract",
  "Nature", "Urban", "Black & White", "Night",
];

interface POTD {
  id: string;
  image_url: string;
  title: string;
  photographer_name: string | null;
  source_type: string;
  description: string | null;
  is_active: boolean;
  featured_date: string;
  created_at: string;
  active_from: string | null;
  active_until: string | null;
}

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

export default function AdminPhotoOfDay({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<POTD[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { name: string; progress: number; status: string }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", photographer_name: "", description: "", featured_date: "", active_from: "", active_until: "" });
  const [sortCol, setSortCol] = useState<string>("featured_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const activeCount = items.filter((i) => i.is_active).length;

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let av: any, bv: any;
      switch (sortCol) {
        case "title": av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
        case "status": av = a.is_active ? 1 : 0; bv = b.is_active ? 1 : 0; break;
        case "created_at": av = a.created_at || ""; bv = b.created_at || ""; break;
        default: av = a.featured_date; bv = b.featured_date;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [items, sortCol, sortDir]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("photo_of_the_day")
      .select("*")
      .order("featured_date", { ascending: false })
      .limit(50);
    setItems(
      (data || []).map((d: any) => ({
        ...d,
        active_from: d.active_from || null,
        active_until: d.active_until || null,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Upload with AI naming & progress bars
  const handleUpload = async (files: FileList) => {
    if (!user || files.length === 0) return;
    setUploading(true);

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
        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 30 } }));

        const result = await uploadImageWithThumbnail({
          bucket: "portfolio-images",
          file,
          type: "potd",
        });

        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 80 } }));

        // AI analysis for title & description
        let aiTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        let aiDescription: string | null = null;
        try {
          const { data: aiData, error: aiErr } = await supabase.functions.invoke("analyze-gallery-image", {
            body: { imageUrl: result.url },
          });
          if (!aiErr && aiData?.title) aiTitle = aiData.title;
          if (!aiErr && aiData?.description) aiDescription = aiData.description;
        } catch { /* AI failed, use defaults */ }

        await supabase.from("photo_of_the_day").insert({
          title: aiTitle,
          description: aiDescription,
          image_url: result.url,
          thumbnail_url: result.thumbnailUrl,
          featured_date: new Date().toISOString().slice(0, 10),
          source_type: "custom",
          created_by: user.id,
          is_active: false,
        } as any);

        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 100, status: "done" } }));
      } catch (err: any) {
        console.error("Upload error:", err);
        toast({ title: `Failed: ${file.name}`, description: err.message, variant: "destructive" });
        setUploadProgress((p) => ({ ...p, [key]: { ...p[key], progress: 100, status: "error" } }));
      }
    }

    setUploading(false);
    toast({ title: `${files.length} photo(s) uploaded as drafts` });
    fetchAll();
    qc.invalidateQueries({ queryKey: ["photo-of-the-day"] });
    setTimeout(() => setUploadProgress({}), 3000);
  };

  const toggleActive = async (id: string, current: boolean) => {
    if (!current && activeCount >= MAX_ACTIVE) {
      toast({ title: "Limit reached", description: `Maximum ${MAX_ACTIVE} active photos.`, variant: "destructive" });
      return;
    }
    await supabase.from("photo_of_the_day").update({ is_active: !current } as any).eq("id", id);
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: !current } : p)));
    qc.invalidateQueries({ queryKey: ["photo-of-the-day"] });
    toast({ title: !current ? "Photo is now LIVE" : "Photo set to Draft" });
  };

  const deleteItem = async (id: string) => {
    confirmAction({
      title: "Delete this Photo of the Day?",
      description: "This action cannot be undone.",
      onConfirm: async () => {
        await supabase.from("photo_of_the_day").delete().eq("id", id);
        setItems((prev) => prev.filter((p) => p.id !== id));
        setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
        qc.invalidateQueries({ queryKey: ["photo-of-the-day"] });
        toast({ title: "Removed" });
      },
    });
  };

  // Bulk actions — batched single-query operations
  const bulkActivate = async () => {
    const toActivate = [...selected].filter((id) => !items.find((p) => p.id === id)?.is_active);
    if (activeCount + toActivate.length > MAX_ACTIVE) {
      toast({ title: "Limit exceeded", description: `Only ${MAX_ACTIVE - activeCount} more can be activated.`, variant: "destructive" });
      return;
    }
    if (toActivate.length === 0) return;
    await supabase.from("photo_of_the_day").update({ is_active: true } as any).in("id", toActivate);
    toast({ title: `${toActivate.length} activated` });
    setSelected(new Set());
    fetchAll();
    qc.invalidateQueries({ queryKey: ["photo-of-the-day"] });
  };

  const bulkDeactivate = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    await supabase.from("photo_of_the_day").update({ is_active: false } as any).in("id", ids);
    toast({ title: `${ids.length} deactivated` });
    setSelected(new Set());
    fetchAll();
    qc.invalidateQueries({ queryKey: ["photo-of-the-day"] });
  };

  const bulkDelete = async () => {
    confirmAction({
      title: `Delete ${selected.size} photo(s)?`,
      description: "This cannot be undone.",
      onConfirm: async () => {
        const ids = [...selected];
        if (ids.length === 0) return;
        await supabase.from("photo_of_the_day").delete().in("id", ids);
        setSelected(new Set());
        fetchAll();
        qc.invalidateQueries({ queryKey: ["photo-of-the-day"] });
      },
    });
  };

  // Inline edit
  const startEdit = (p: POTD) => {
    setEditingId(p.id);
    setEditForm({
      title: p.title,
      photographer_name: p.photographer_name || "",
      description: p.description || "",
      featured_date: p.featured_date,
      active_from: p.active_from ? p.active_from.slice(0, 16) : "",
      active_until: p.active_until ? p.active_until.slice(0, 16) : "",
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await supabase.from("photo_of_the_day").update({
      title: editForm.title,
      photographer_name: editForm.photographer_name || null,
      description: editForm.description || null,
      featured_date: editForm.featured_date,
      active_from: editForm.active_from || null,
      active_until: editForm.active_until || null,
    } as any).eq("id", editingId);
    setItems((prev) =>
      prev.map((p) =>
        p.id === editingId
          ? { ...p, title: editForm.title, photographer_name: editForm.photographer_name || null, description: editForm.description || null, featured_date: editForm.featured_date, active_from: editForm.active_from || null, active_until: editForm.active_until || null }
          : p
      )
    );
    setEditingId(null);
    qc.invalidateQueries({ queryKey: ["photo-of-the-day"] });
    toast({ title: "Saved" });
  };

  // AI re-analyze
  const reAnalyze = async (p: POTD) => {
    toast({ title: "Analyzing…", description: `Running AI on "${p.title}"` });
    try {
      const { data: aiData, error: aiErr } = await supabase.functions.invoke("analyze-gallery-image", {
        body: { imageUrl: p.image_url },
      });
      if (aiErr) throw aiErr;
      const newTitle = aiData?.title || p.title;
      const newDesc = aiData?.description || p.description;
      await supabase.from("photo_of_the_day").update({ title: newTitle, description: newDesc } as any).eq("id", p.id);
      setItems((prev) => prev.map((item) => item.id === p.id ? { ...item, title: newTitle, description: newDesc } : item));
      toast({ title: "AI Updated", description: `"${newTitle}"` });
    } catch {
      toast({ title: "AI analysis failed", variant: "destructive" });
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((p) => p.id)));
  };

  const isScheduleActive = (p: POTD) => {
    const now = new Date();
    if (p.active_from && new Date(p.active_from) > now) return false;
    if (p.active_until && new Date(p.active_until) < now) return false;
    return true;
  };

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Star className="h-3.5 w-3.5 text-primary" />
            <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headingFont}>
              {items.length} total · {activeCount}/{MAX_ACTIVE} active
            </span>
            {activeCount >= MAX_ACTIVE && (
              <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-sm">
                <AlertTriangle className="h-3 w-3" /> Limit reached
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>
            Images compressed to WebP automatically. AI suggests titles. New uploads default to draft.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shrink-0 rounded-sm" style={headingFont}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload Photos
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
          <button onClick={bulkActivate} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors rounded-sm" style={headingFont}>Activate</button>
          <button onClick={bulkDeactivate} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-muted-foreground/30 text-muted-foreground hover:bg-muted transition-colors rounded-sm" style={headingFont}>Deactivate</button>
          <button onClick={bulkDelete} className="text-[9px] tracking-[0.1em] uppercase px-3 py-1 border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors rounded-sm" style={headingFont}>Delete</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[9px] text-muted-foreground hover:text-foreground" style={headingFont}>Clear</button>
        </div>
      )}

      {/* List view */}
      {items.length > 0 ? (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border border-border rounded-sm divide-y divide-border">
            {/* Header row */}
            <div className="flex items-center gap-3 px-3 py-2 bg-muted/30 text-[8px] tracking-[0.2em] uppercase text-muted-foreground select-none" style={headingFont}>
              <button onClick={toggleAll} className="shrink-0 p-0.5">
                {selected.size === items.length ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
              </button>
              <span className="w-8 shrink-0 text-center">Sl</span>
              <span className="w-12 shrink-0">Image</span>
              <button onClick={() => handleSort("title")} className="flex-1 min-w-0 flex items-center gap-1 hover:text-foreground transition-colors text-left">
                Title {sortCol === "title" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
              </button>
              <span className="w-24 shrink-0">Photographer</span>
              <span className="w-28 shrink-0 hidden xl:block">Description</span>
              <button onClick={() => handleSort("status")} className="w-20 shrink-0 hidden lg:flex items-center gap-1 hover:text-foreground transition-colors">
                Status {sortCol === "status" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
              </button>
              <span className="w-28 shrink-0 hidden lg:block">Schedule</span>
              <button onClick={() => handleSort("featured_date")} className="w-20 shrink-0 flex items-center gap-1 hover:text-foreground transition-colors">
                Date {sortCol === "featured_date" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-30" />}
              </button>
              <span className="w-28 shrink-0 text-right">Actions</span>
            </div>

            {sortedItems.map((p, index) => {
              const isEditing = editingId === p.id;
              const schedActive = isScheduleActive(p);
              const effectivelyActive = p.is_active && schedActive;

              return (
                <div key={p.id} className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/20 transition-colors ${!p.is_active ? "opacity-60" : ""}`}>
                  <button onClick={() => toggleSelect(p.id)} className="shrink-0 p-0.5">
                    {selected.has(p.id) ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  <span className="w-8 shrink-0 text-center text-[10px] text-muted-foreground tabular-nums" style={bodyFont}>{index + 1}</span>
                  <div className="w-12 h-12 shrink-0 rounded-sm overflow-hidden bg-muted">
                    <img src={optimizeAdminThumbnailUrl(p.image_url)} alt={p.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="w-full bg-transparent border-b border-primary text-xs py-0.5 outline-none" style={bodyFont} />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs truncate" style={bodyFont}>{p.title}</span>
                        {!schedActive && p.is_active && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
                      </div>
                    )}
                  </div>
                  <div className="w-24 shrink-0">
                    {isEditing ? (
                      <input value={editForm.photographer_name} onChange={(e) => setEditForm((f) => ({ ...f, photographer_name: e.target.value }))} className="w-full bg-transparent border-b border-primary text-[10px] py-0.5 outline-none" style={bodyFont} placeholder="Photographer" />
                    ) : (
                      <span className="text-[9px] text-muted-foreground truncate block" style={bodyFont}>{p.photographer_name || "—"}</span>
                    )}
                  </div>
                  <div className="w-28 shrink-0 hidden xl:block">
                    {isEditing ? (
                      <input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="w-full bg-transparent border-b border-primary text-[10px] py-0.5 outline-none" style={bodyFont} placeholder="Description" />
                    ) : (
                      <span className="text-[9px] text-muted-foreground truncate block" style={bodyFont}>{p.description || "—"}</span>
                    )}
                  </div>
                  <div className="w-20 shrink-0 hidden lg:block">
                    <button onClick={() => toggleActive(p.id, p.is_active)} className={`text-[9px] px-1.5 py-0.5 rounded-sm border cursor-pointer transition-colors ${effectivelyActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`} style={headingFont}>
                      {effectivelyActive ? "Live" : p.is_active ? "Scheduled" : "Draft"}
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
                        {p.active_from ? new Date(p.active_from).toLocaleDateString() : "—"}{" → "}{p.active_until ? new Date(p.active_until).toLocaleDateString() : "∞"}
                      </div>
                    )}
                  </div>
                  <div className="w-20 shrink-0">
                    {isEditing ? (
                      <input type="date" value={editForm.featured_date} onChange={(e) => setEditForm((f) => ({ ...f, featured_date: e.target.value }))} className="bg-transparent border border-border rounded-sm text-[9px] px-1 py-0.5 outline-none w-full" />
                    ) : (
                      <span className="text-[9px] text-muted-foreground" style={bodyFont}>{p.featured_date}</span>
                    )}
                  </div>
                  <div className="w-28 shrink-0 flex items-center justify-end gap-1">
                    {isEditing ? (
                      <>
                        <button onClick={saveEdit} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-sm"><Check className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 text-muted-foreground hover:bg-muted rounded-sm"><X className="h-3.5 w-3.5" /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => reAnalyze(p)} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-sm" title="Re-analyze with AI"><Sparkles className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(p)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-sm"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => toggleActive(p.id, p.is_active)} className={`p-1.5 rounded-sm ${p.is_active ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}>
                          {p.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => deleteItem(p.id)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-sm"><Trash2 className="h-3.5 w-3.5" /></button>
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
                {selected.size === items.length ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </button>
              <div className="flex items-center gap-1">
                {(["title", "featured_date", "status"] as const).map(col => (
                  <button key={col} onClick={() => handleSort(col)} className={`text-[8px] tracking-wider uppercase px-2 py-1 border rounded-sm transition-colors ${sortCol === col ? "border-primary text-primary" : "border-border text-muted-foreground"}`} style={headingFont}>
                    {col === "featured_date" ? "Date" : col}
                    {sortCol === col && (sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5 inline ml-0.5" /> : <ArrowDown className="h-2.5 w-2.5 inline ml-0.5" />)}
                  </button>
                ))}
              </div>
            </div>

            {sortedItems.map((p, index) => {
              const schedActive = isScheduleActive(p);
              const effectivelyActive = p.is_active && schedActive;

              return (
                <div key={p.id} className={`border border-border rounded-sm p-3 transition-colors ${!p.is_active ? "opacity-60" : ""} ${selected.has(p.id) ? "border-primary bg-primary/5" : ""}`}>
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center gap-2">
                      <button onClick={() => toggleSelect(p.id)} className="p-0.5">
                        {selected.has(p.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                      </button>
                      <div className="w-16 h-16 rounded-sm overflow-hidden bg-muted shrink-0">
                        <img src={optimizeAdminThumbnailUrl(p.image_url)} alt={p.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate" style={bodyFont}>{p.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {p.photographer_name && <span className="text-[8px] text-muted-foreground" style={bodyFont}>{p.photographer_name}</span>}
                          <button onClick={() => toggleActive(p.id, p.is_active)} className={`text-[8px] px-1.5 py-0.5 rounded-sm border transition-colors ${effectivelyActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`} style={headingFont}>
                            {effectivelyActive ? "Live" : p.is_active ? "Scheduled" : "Draft"}
                          </button>
                        </div>
                        {p.description && <p className="text-[8px] text-muted-foreground/70 mt-0.5 truncate" style={bodyFont}>{p.description}</p>}
                        <p className="text-[9px] text-muted-foreground mt-1" style={bodyFont}>
                          #{index + 1} · {p.featured_date}
                          {p.active_from && ` · From ${new Date(p.active_from).toLocaleDateString()}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 mt-2">
                        <button onClick={() => reAnalyze(p)} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-sm"><Sparkles className="h-3.5 w-3.5" /></button>
                        <button onClick={() => startEdit(p)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-sm"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => toggleActive(p.id, p.is_active)} className={`p-1.5 rounded-sm ${p.is_active ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}>
                          {p.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => deleteItem(p.id)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-sm"><Trash2 className="h-3.5 w-3.5" /></button>
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
          <p className="text-sm text-muted-foreground" style={bodyFont}>No Photo of the Day entries yet. Upload your first batch above.</p>
          <p className="text-[10px] text-muted-foreground/60 mt-2" style={bodyFont}>
            <Sparkles className="h-3 w-3 inline mr-1" />
            AI will auto-suggest titles for each upload
          </p>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
