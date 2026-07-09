import { useEffect, useRef, useState, useCallback } from "react";
import DOMPurify from "dompurify";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Save, Eye, EyeOff, Upload, X, Image as ImageIcon, Loader2, ZoomIn, ZoomOut, Move, RotateCcw, Trash2, XCircle } from "lucide-react";
import InlineImageDropZone from "@/components/InlineImageDropZone";
import EmailRichTextToolbar from "@/components/admin/EmailRichTextToolbar";
import ImageCropModal from "@/components/admin/ImageCropModal";
import { supabase } from "@/integrations/supabase/client";
import { generateImagePath, uploadImage as uploadImageCentral } from "@/lib/imageUpload";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { toast } from "@/hooks/core/use-toast";

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
          <div
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
function LivePreview({ title, excerpt, body, coverUrl, tags, gallery }: {
  title: string;
  excerpt: string;
  body: string;
  coverUrl: string;
  tags: string;
  gallery: string[];
}) {
  return (
    <div className="border border-border rounded-sm overflow-hidden bg-background">
      <div className="px-3 py-2 border-b border-border bg-card/50">
        <span className="text-[9px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
          Live Preview
        </span>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {coverUrl && (
          <div className="relative h-40 overflow-hidden">
            <img loading="lazy" decoding="async" src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
          </div>
        )}
        <div className="p-5 space-y-4">
          {tags && (
            <div className="flex flex-wrap gap-2">
              {tags.split(",").map(t => t.trim()).filter(Boolean).map((tag, i) => (
                <span key={i} className="text-[9px] tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <h2 className="text-2xl font-light tracking-tight leading-tight" style={{ fontFamily: "var(--font-display)" }}>
            {title || "Untitled Article"}
          </h2>
          {excerpt && (
            <p className="text-sm text-muted-foreground italic leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
              {excerpt}
            </p>
          )}
          <div
            className="prose-sm max-w-none text-foreground/85"
            style={{ fontFamily: "var(--font-body)" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body || '<p class="text-muted-foreground text-xs">Body content will appear here…</p>') }}
          />
          {gallery.length > 0 && (
            <div className="mt-4">
              <span className="text-[9px] tracking-[0.2em] uppercase text-primary block mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                Photo Gallery
              </span>
              <div className="grid grid-cols-3 gap-1">
                {gallery.map((url, i) => (
                  <img loading="lazy" decoding="async" key={i} src={url} alt={`Gallery ${i + 1}`} className="w-full aspect-square object-cover rounded-sm" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ========== Main Editor ==========
const JournalEditor = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();

  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [body, setBody] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [gallery, setGallery] = useState<string[]>([]);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [saving, setSaving] = useState(false);
  const [canAccess, setCanAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [showPreview, setShowPreview] = useState(true);

  // Rich text editor
  const editorRef = useRef<HTMLDivElement>(null);
  const [editorMode, setEditorMode] = useState<"visual" | "html">("visual");

  // Image upload
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  // Crop modal
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Check access
  useEffect(() => {
    const check = async () => {
      if (!user) { setCheckingAccess(false); return; }
      if (isAdmin) { setCanAccess(true); setCheckingAccess(false); return; }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "content_editor")
        .maybeSingle();
      setCanAccess(!!data);
      setCheckingAccess(false);
    };
    check();
  }, [user, isAdmin]);

  // Load existing article
  useEffect(() => {
    if (isNew || !user) return;
    const load = async () => {
      const { data } = await supabase
        .from("journal_articles")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (data) {
        setTitle(data.title);
        setExcerpt(data.excerpt || "");
        // Convert old [img:URL] format to HTML if needed
        setBody(convertLegacyBody(data.body));
        setTagsInput(data.tags.join(", "));
        setCoverUrl(data.cover_image_url || "");
        setGallery(data.photo_gallery);
        setStatus(data.status as "draft" | "published");
      }
    };
    load();
  }, [id, isNew, user]);

  // Sync editor content when switching to visual mode or opening
  useEffect(() => {
    if (editorMode === "visual" && editorRef.current) {
      editorRef.current.innerHTML = DOMPurify.sanitize(body);
    }
  }, [editorMode]);

  // Also set initial content once loaded
  useEffect(() => {
    if (body && editorMode === "visual" && editorRef.current && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = DOMPurify.sanitize(body);
    }
  }, [body]);

  const handleEditorInput = () => {
    if (editorRef.current) {
      setBody(editorRef.current.innerHTML);
    }
  };

  /** Convert legacy [img:URL] block format to HTML */
  function convertLegacyBody(rawBody: string): string {
    if (!rawBody) return "";
    // If it already contains HTML tags, assume it's already HTML
    if (/<[a-z][\s\S]*>/i.test(rawBody)) return rawBody;
    // Convert [img:URL] and plain text paragraphs to HTML
    const parts = rawBody.split("\n\n");
    return parts.map(part => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      const imgMatch = trimmed.match(/^\[img:(.*?)\]$/);
      if (imgMatch) return `<img loading="lazy" decoding="async" src="${imgMatch[1]}" alt="Article image" style="width:100%;max-width:100%;border-radius:4px;" />`;
      return `<p>${trimmed}</p>`;
    }).filter(Boolean).join("\n");
  }

  if (checkingAccess) {
    return <main className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground text-sm">Loading…</p></main>;
  }

  if (!canAccess) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">You don't have permission to edit articles.</p>
        <Link to="/journal" className="text-primary text-sm underline">Back to Journal</Link>
      </main>
    );
  }

  const generateSlug = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) +
    "-" + Date.now().toString(36);

  const uploadImage = async (file: File, folder: string): Promise<string | null> => {
    try {
      const safe = await scanFileWithToast(file, toast, { allowedTypes: "image" });
      if (!safe) return null;
      const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { webpFile } = await compressImageToFiles(file, baseName);
      const webpPath = `${folder}/${baseName}.webp`;
      const result = await uploadImageCentral({ bucket: "journal-images", file: webpFile, path: webpPath, type: "journal", fileName: `${baseName}.webp` });
      return result.url;
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      return null;
    }
  };

  // Cover upload with crop
  const handleFileSelect = (file: File) => {
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
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropSrc(null);
    setUploadingCover(true);
    try {
      const safe = await scanFileWithToast(croppedFile, toast, { allowedTypes: "image" });
      if (!safe) { setUploadingCover(false); return; }
      const baseName = `journal-cover-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { webpFile } = await compressImageToFiles(croppedFile, baseName);
      const path = generateImagePath({ type: "journal-cover", ext: "webp" });
      const result = await uploadImageCentral({ bucket: "journal-images", file: webpFile, path, type: "journal-cover", fileName: `${baseName}.webp` });
      setCoverUrl(result.url);
      toast({ title: "Cover uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
    setUploadingCover(false);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setUploadingGallery(true);
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) continue;
      const url = await uploadImage(file, "gallery");
      if (url) urls.push(url);
    }
    setGallery(prev => [...prev, ...urls]);
    setUploadingGallery(false);
  };

  const handleSave = async (publishStatus: "draft" | "published") => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!body.trim()) {
      toast({ title: "Body is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    const payload = {
      title: title.trim().slice(0, 200),
      slug: isNew ? generateSlug(title) : undefined,
      excerpt: excerpt.trim().slice(0, 500) || null,
      body,
      cover_image_url: coverUrl || null,
      tags,
      photo_gallery: gallery,
      status: publishStatus,
      published_at: publishStatus === "published" ? new Date().toISOString() : null,
      author_id: user!.id,
    };

    let error;
    if (isNew) {
      const res = await supabase.from("journal_articles").insert(payload);
      error = res.error;
    } else {
      const { slug: _, ...updatePayload } = payload;
      const res = await supabase.from("journal_articles").update(updatePayload).eq("id", id);
      error = res.error;
    }

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: publishStatus === "published" ? "Article published!" : "Draft saved" });
      navigate("/journal");
    }
    setSaving(false);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hidden file input for cover */}
      <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ""; }} />

      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-40">
        <div className="container mx-auto py-2 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border rounded-sm transition-colors ${
                showPreview ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {showPreview ? <><EyeOff className="h-3 w-3 inline mr-1" />Hide Preview</> : <><Eye className="h-3 w-3 inline mr-1" />Preview</>}
            </button>
            <button
              onClick={() => handleSave("draft")}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border text-muted-foreground hover:text-foreground transition-colors rounded-sm"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Save className="h-3.5 w-3.5" /> Save Draft
            </button>
            <button
              onClick={() => handleSave("published")}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Publish
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto py-10 md:py-16">
        <div className={`grid ${showPreview ? "lg:grid-cols-2" : ""} gap-8`}>
          {/* ===== Editor Column ===== */}
          <div className="space-y-6">
            {/* Basic fields */}
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Title *</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Article title…"
                  className={inputClass}
                  maxLength={200}
                />
              </div>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Tags (comma-separated)</label>
                <input
                  value={tagsInput}
                  onChange={e => setTagsInput(e.target.value)}
                  placeholder="Wildlife, Tutorial, Behind the Scenes"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Cover Image with ImageViewer */}
            <ImageViewer
              src={coverUrl}
              label="Cover Image"
              onUpload={() => coverInputRef.current?.click()}
              onRemove={() => setCoverUrl("")}
              uploading={uploadingCover}
            />

            {/* Excerpt */}
            <div>
              <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Excerpt (short summary)</label>
              <textarea
                value={excerpt}
                onChange={e => setExcerpt(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="A short summary of the article…"
                className="w-full border border-input bg-background px-3 py-2 text-sm rounded-sm focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Rich Text Body Editor */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Body Content *</label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (editorMode === "visual" && editorRef.current) {
                        setBody(editorRef.current.innerHTML);
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
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={14}
                  className="w-full border border-input bg-background px-3 py-2 text-sm rounded-sm focus:ring-1 focus:ring-ring font-mono"
                  placeholder="<p>Write your HTML content here...</p>"
                />
              )}
            </div>

            {/* Inline Image Inserter */}
            <InlineImageDropZone onImageInserted={(url) => {
              if (editorRef.current) {
                const imgHtml = `<div class="my-4"><img src="${url}" alt="Inline image" style="width:100%;border-radius:4px;" loading="lazy" /></div>`;
                editorRef.current.innerHTML += imgHtml;
                setBody(editorRef.current.innerHTML);
              } else {
                setBody((prev) => prev + `\n<div class="my-4"><img src="${url}" alt="Inline image" style="width:100%;border-radius:4px;" loading="lazy" /></div>\n`);
              }
            }} />

            {/* Photo Gallery */}
            <div>
              <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Photo Gallery</label>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3 mb-3">
                {gallery.map((url, i) => (
                  <div key={i} className="relative group aspect-square">
                    <img loading="lazy" decoding="async" src={url} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover rounded-sm" />
                    <button onClick={() => setGallery(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 p-1 bg-background/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <label className="flex items-center justify-center aspect-square border-2 border-dashed border-border cursor-pointer hover:border-primary/50 transition-colors rounded-sm">
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    {uploadingGallery ? (
                      <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <ImageIcon className="h-5 w-5" />
                    )}
                    <span className="text-[9px]" style={{ fontFamily: "var(--font-heading)" }}>{uploadingGallery ? "…" : "Add"}</span>
                  </div>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryUpload} disabled={uploadingGallery} />
                </label>
              </div>
            </div>
          </div>

          {/* ===== Preview Column ===== */}
          {showPreview && (
            <div className="sticky top-20 self-start">
              <LivePreview
                title={title}
                excerpt={excerpt}
                body={body}
                coverUrl={coverUrl}
                tags={tagsInput}
                gallery={gallery}
              />
            </div>
          )}
        </div>
      </div>

      {/* Crop Modal */}
      {cropSrc && (
        <ImageCropModal
          imageSrc={cropSrc}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}
    </main>
  );
};

export default JournalEditor;
