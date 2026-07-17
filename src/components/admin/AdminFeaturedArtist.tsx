import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { Plus, Pencil, Trash2, Eye, EyeOff, XCircle, Loader2, Upload, Image as ImageIcon, ZoomIn, ZoomOut, Move, RotateCcw } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import EmailRichTextToolbar from "./EmailRichTextToolbar";
import ImageCropModal from "./ImageCropModal";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import ProfileTypeaheadPicker from "./ProfileTypeaheadPicker";

interface FeaturedArtistRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  artist_name: string | null;
  artist_bio: string | null;
  artist_avatar_url: string | null;
  author_profile_id: string | null;
  tags: string[];
  is_active: boolean;
  published_at: string | null;
  created_at: string;
}

const emptyForm = {
  title: "",
  slug: "",
  excerpt: "",
  body: "",
  cover_image_url: "",
  artist_name: "",
  artist_bio: "",
  artist_avatar_url: "",
  author_profile_id: null as string | null,
  tags: "",
  is_active: true,
};

const labelClass = "block text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-1.5";
const inputClass = "w-full h-9 border border-input bg-background px-3 text-sm rounded-sm focus:ring-1 focus:ring-ring";

// ========== Image Viewer with Zoom/Pan ==========
function ImageViewer({ src, label, onUpload, onRemove, uploading }: {
  src: string;
  label: string;
  onUpload: () => void;
  onRemove: () => void;
  uploading: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.25, 4));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const handleReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  };

  const handleMouseUp = () => setDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(4, Math.max(0.25, z + delta)));
  };

  return (
    <div className="space-y-2">
      <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>{label}</label>
      {src ? (
        <div className="border border-border rounded-sm overflow-hidden">
          {/* Viewer Area */}
          <div
            ref={containerRef}
            className="relative h-48 bg-muted/20 overflow-hidden select-none"
            style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            <img loading="lazy" decoding="async"
              src={src}
              alt={label}
              className="absolute top-1/2 left-1/2 max-w-none transition-transform duration-100"
              style={{
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                maxHeight: "100%",
                maxWidth: "100%",
                objectFit: "contain",
              }}
              draggable={false}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border bg-card/50">
            <button type="button" onClick={handleZoomOut} className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Zoom Out">
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[9px] text-muted-foreground w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={handleZoomIn} className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Zoom In">
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            {zoom > 1 && (
              <span className="text-[8px] text-muted-foreground/50 flex items-center gap-0.5 ml-1">
                <Move className="h-2.5 w-2.5" /> drag to pan
              </span>
            )}
            <button type="button" onClick={handleReset} className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors ml-auto" title="Reset View">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onUpload} disabled={uploading} className="p-1 rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Replace Image">
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onRemove} className="p-1 rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Remove Image">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onUpload}
          disabled={uploading}
          className="w-full h-32 border-2 border-dashed border-border rounded-sm flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          {uploading ? (
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
          <span className="text-[9px] tracking-[0.15em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>
            {uploading ? "Uploading…" : "Click to upload"}
          </span>
        </button>
      )}
    </div>
  );
}

// ========== Live Preview ==========
function LivePreview({ form }: { form: typeof emptyForm }) {
  return (
    <div className="border border-border rounded-sm overflow-hidden bg-background">
      <div className="px-3 py-2 border-b border-border bg-card/50">
        <span className="text-[9px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
          Live Preview
        </span>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {/* Cover */}
        {form.cover_image_url && (
          <div className="relative h-40 overflow-hidden">
            <img loading="lazy" decoding="async" src={form.cover_image_url} alt="Cover" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
          </div>
        )}

        <div className="p-5 space-y-4">
          {/* Tags */}
          {form.tags && (
            <div className="flex flex-wrap gap-2">
              {form.tags.split(",").map(t => t.trim()).filter(Boolean).map((tag, i) => (
                <span key={i} className="text-[9px] tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Title */}
          <h2 className="text-2xl font-light tracking-tight leading-tight" style={{ fontFamily: "var(--font-display)" }}>
            {form.title || "Untitled Article"}
          </h2>

          {/* Artist info */}
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            {form.artist_avatar_url && (
              <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={form.artist_avatar_url} alt="" className="h-8 w-8 rounded-full object-cover border border-border" />
            )}
            <div>
              <span className="text-[10px] tracking-[0.1em] uppercase block" style={{ fontFamily: "var(--font-heading)" }}>
                {form.artist_name || "Artist Name"}
              </span>
            </div>
          </div>

          {/* Artist Bio */}
          {form.artist_bio && (
            <div className="bg-card border border-border p-4 rounded-sm">
              <span className="text-[8px] tracking-[0.2em] uppercase text-primary block mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                About the Artist
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
                {form.artist_bio}
              </p>
            </div>
          )}

          {/* Excerpt */}
          {form.excerpt && (
            <p className="text-sm text-muted-foreground italic leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
              {form.excerpt}
            </p>
          )}

          {/* Body (rendered as HTML) */}
          <div
            className="prose-sm max-w-none text-foreground/85"
            style={{ fontFamily: "var(--font-body)" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(form.body || '<p class="text-muted-foreground text-xs">Body content will appear here…</p>') }}
          />
        </div>
      </div>
    </div>
  );
}

// ========== Main Component ==========
export default function AdminFeaturedArtist({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<FeaturedArtistRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  // Rich text editor
  const editorRef = useRef<HTMLDivElement>(null);
  const [editorMode, setEditorMode] = useState<"visual" | "html">("visual");

  // Image upload
  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Crop modal
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<"cover" | "avatar">("cover");
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const fetchAll = async () => {
    const { data } = await supabase
      .from("featured_artists")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(100);
    setItems((data as any) || []);
  };

  useEffect(() => { fetchAll(); }, []);

  // Sync editor content when switching to visual mode or opening edit
  useEffect(() => {
    if (showForm && editorMode === "visual" && editorRef.current) {
      editorRef.current.innerHTML = DOMPurify.sanitize(form.body || "");
    }
  }, [showForm, editorMode]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const openEdit = (item: FeaturedArtistRow) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      slug: item.slug,
      excerpt: item.excerpt || "",
      body: item.body,
      cover_image_url: item.cover_image_url || "",
      artist_name: item.artist_name || "",
      artist_bio: item.artist_bio || "",
      artist_avatar_url: item.artist_avatar_url || "",
      author_profile_id: item.author_profile_id ?? null,
      tags: (item.tags || []).join(", "),
      is_active: item.is_active,
    });
    setEditorMode("visual");
    setShowForm(true);
  };

  const generateSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleEditorInput = () => {
    if (editorRef.current) {
      setForm(prev => ({ ...prev, body: editorRef.current!.innerHTML }));
    }
  };

  const handleSave = async () => {
    if (!user || !form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const slug = form.slug.trim() || generateSlug(form.title);
    const payload = {
      title: form.title.trim(),
      slug,
      excerpt: form.excerpt.trim() || null,
      body: form.body,
      cover_image_url: form.cover_image_url.trim() || null,
      artist_name: form.artist_name.trim() || null,
      artist_bio: form.artist_bio.trim() || null,
      artist_avatar_url: form.artist_avatar_url.trim() || null,
      author_profile_id: form.author_profile_id || null,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from("featured_artists").update(payload).eq("id", editingId));
    } else {
      ({ error } = await supabase.from("featured_artists").insert({ ...payload, created_by: user.id }));
    }
    setSaving(false);

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editingId ? "Updated" : "Created" });
      resetForm();
      fetchAll();
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      qc.invalidateQueries({ queryKey: ["featured-artist-active"] });
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("featured_artists").update({ is_active: !current }).eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_active: !current } : i)));
    qc.invalidateQueries({ queryKey: ["featured-artist-active"] });
  };

  const deleteItem = async (id: string) => {
    confirmAction({
      title: "Delete this featured artist article?",
      onConfirm: async () => {
        await supabase.from("featured_artists").delete().eq("id", id);
        toast({ title: "Deleted" });
        fetchAll();
        qc.invalidateQueries({ queryKey: ["featured-artist-active"] });
      },
    });
  };

  // ========== Image Upload Handlers ==========
  const handleFileSelect = (file: File, target: "cover" | "avatar") => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only images allowed", variant: "destructive" });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "Max 50MB", variant: "destructive" });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    setCropTarget(target);
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropSrc(null);
    const isAvatar = cropTarget === "avatar";
    if (isAvatar) setUploadingAvatar(true); else setUploadingCover(true);

    try {
      const safe = await scanFileWithToast(croppedFile, toast, { allowedTypes: "image" });
      if (!safe) {
        if (isAvatar) setUploadingAvatar(false); else setUploadingCover(false);
        return;
      }
      const baseName = `featured-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { webpFile } = await compressImageToFiles(croppedFile, baseName);
      const path = generateImagePath({ type: "featured-artist", ext: "webp" });
      const result = await uploadImage({ bucket: "journal-images", file: webpFile, path, type: "featured-artist", fileName: `${baseName}.webp` });
      
      if (isAvatar) {
        setForm(prev => ({ ...prev, artist_avatar_url: result.url }));
      } else {
        setForm(prev => ({ ...prev, cover_image_url: result.url }));
      }
      toast({ title: "Image uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
    if (isAvatar) setUploadingAvatar(false); else setUploadingCover(false);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  return (
    <div>
      {/* Hidden file inputs */}
      <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, "cover"); e.target.value = ""; }} />
      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, "avatar"); e.target.value = ""; }} />

      <div className="flex items-center justify-between mb-6">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {items.length} featured artist{items.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={() => { resetForm(); setShowForm(true); setEditorMode("visual"); }}
          className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Plus className="h-3.5 w-3.5" /> New Article
        </button>
      </div>

      {showForm && (
        <div className="border border-border p-6 md:p-8 mb-8 space-y-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              {editingId ? "Edit Article" : "New Featured Artist"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border rounded-sm transition-colors ${
                  showPreview ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"
                }`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Eye className="h-3 w-3 inline mr-1" />
                Preview
              </button>
              <button onClick={resetForm} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
            </div>
          </div>

          <div className={`grid ${showPreview ? "lg:grid-cols-2" : ""} gap-6`}>
            {/* ===== Editor Column ===== */}
            <div className="space-y-5">
              {/* Basic fields */}
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Title *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.slug || generateSlug(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Slug</label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Linked author profile (preferred) */}
              <ProfileTypeaheadPicker
                value={form.author_profile_id}
                onChange={async (p) => {
                  if (!p) {
                    setForm(prev => ({ ...prev, author_profile_id: null }));
                    return;
                  }
                  // Fetch full profile (incl. bio) and auto-fill fallback fields
                  // only when they are currently empty — never overwrite admin edits.
                  const { data } = await supabase.rpc("get_profile_admin", { _id: p.id });
                  const row = (data as any[] | null)?.[0];
                  const name = row?.full_name ?? p.full_name ?? "";
                  const avatar = row?.avatar_url ?? p.avatar_url ?? "";
                  const bio = (row?.bio ?? "").toString();
                  setForm(prev => ({
                    ...prev,
                    author_profile_id: p.id,
                    artist_name: prev.artist_name?.trim() ? prev.artist_name : (name || ""),
                    artist_avatar_url: prev.artist_avatar_url?.trim() ? prev.artist_avatar_url : (avatar || ""),
                    artist_bio: prev.artist_bio?.trim() ? prev.artist_bio : bio,
                    excerpt: prev.excerpt?.trim() ? prev.excerpt : (bio ? bio.slice(0, 240) : ""),
                  }));
                }}
              />

              {/* Legacy / fallback fields */}
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Artist Name (fallback)</label>
                  <input
                    value={form.artist_name}
                    onChange={(e) => setForm({ ...form, artist_name: e.target.value })}
                    className={inputClass}
                    placeholder={form.author_profile_id ? "Overridden by linked profile" : ""}
                  />
                </div>
                <div>
                  <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Tags (comma-separated)</label>
                  <input
                    value={form.tags}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Image Uploads */}
              <div className="grid md:grid-cols-2 gap-5">
                <ImageViewer
                  src={form.cover_image_url}
                  label="Cover Image"
                  onUpload={() => coverInputRef.current?.click()}
                  onRemove={() => setForm(prev => ({ ...prev, cover_image_url: "" }))}
                  uploading={uploadingCover}
                />
                <ImageViewer
                  src={form.artist_avatar_url}
                  label="Artist Avatar"
                  onUpload={() => avatarInputRef.current?.click()}
                  onRemove={() => setForm(prev => ({ ...prev, artist_avatar_url: "" }))}
                  uploading={uploadingAvatar}
                />
              </div>

              {/* Excerpt */}
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Excerpt (short intro)</label>
                <textarea
                  value={form.excerpt}
                  onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                  rows={2}
                  className="w-full border border-input bg-background px-3 py-2 text-sm rounded-sm focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Artist Bio */}
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Artist Bio</label>
                <textarea
                  value={form.artist_bio}
                  onChange={(e) => setForm({ ...form, artist_bio: e.target.value })}
                  rows={2}
                  className="w-full border border-input bg-background px-3 py-2 text-sm rounded-sm focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Rich Text Body Editor */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Body Content</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (editorMode === "visual" && editorRef.current) {
                          setForm(prev => ({ ...prev, body: editorRef.current!.innerHTML }));
                        }
                        setEditorMode(editorMode === "visual" ? "html" : "visual");
                      }}
                      className={`text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 border rounded-sm transition-colors ${
                        editorMode === "html" ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {editorMode === "visual" ? "HTML" : "Visual"}
                    </button>
                  </div>
                </div>

                {editorMode === "visual" ? (
                  <div>
                    <EmailRichTextToolbar editorRef={editorRef} onInput={handleEditorInput} />
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={handleEditorInput}
                      className="min-h-[300px] border border-border border-t-0 rounded-b-sm bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring prose-sm max-w-none"
                      style={{ fontFamily: "var(--font-body)" }}
                    />
                  </div>
                ) : (
                  <textarea
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    rows={14}
                    className="w-full border border-input bg-background px-3 py-2 text-sm rounded-sm focus:ring-1 focus:ring-ring font-mono"
                    placeholder="<p>Write your HTML content here...</p>"
                  />
                )}
              </div>

              {/* Active toggle + Save */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Active</span>
                </label>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-6 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingId ? "Update" : "Create"}
                </button>
              </div>
            </div>

            {/* ===== Preview Column ===== */}
            {showPreview && (
              <div className="sticky top-4">
                <LivePreview form={form} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Crop Modal */}
      {cropSrc && (
        <ImageCropModal
          imageSrc={cropSrc}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}

      {/* List */}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-4 p-4 border border-border hover:border-primary/30 transition-colors">
            {item.cover_image_url && (
              <img loading="lazy" decoding="async" src={item.cover_image_url} alt={item.title} className="h-12 w-12 object-cover rounded-sm shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <p className="text-[10px] text-muted-foreground">{item.artist_name || "No artist"} · {item.is_active ? "Active" : "Hidden"}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => toggleActive(item.id, item.is_active)} className="p-1.5 hover:text-primary">
                {item.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => openEdit(item)} className="p-1.5 hover:text-primary">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => deleteItem(item.id)} className="p-1.5 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No featured artist articles yet.</p>
        )}
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
