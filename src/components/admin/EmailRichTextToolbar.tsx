import {
  Bold, Italic, Underline, Strikethrough, Link, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Type, Heading1, Heading2, Heading3,
  Palette, Undo, Redo, RemoveFormatting, ImagePlus, Link2, Minus,
  Table, Maximize2, Minimize2, Upload, Images, Trash2, X, Crop
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { storageList, storageGetPublicUrl } from "@/lib/storageUpload";
import { toast } from "@/hooks/core/use-toast";
import ImageCropModal from "./ImageCropModal";

interface Props {
  editorRef: React.RefObject<HTMLDivElement | null>;
  onInput: () => void;
}

interface GalleryImage {
  name: string;
  url: string;
}

const btnClass =
  "p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors";
const activeClass = "text-primary bg-primary/10";
const sepClass = "w-px h-5 bg-border mx-0.5";
const popoverClass =
  "absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-sm shadow-lg p-3";

export default function EmailRichTextToolbar({ editorRef, onInput }: Props) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showImageMenu, setShowImageMenu] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageWidth, setImageWidth] = useState("100");
  const [imageAlign, setImageAlign] = useState<"left" | "center" | "right">("center");
  const [uploading, setUploading] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [tableRows, setTableRows] = useState("2");
  const [tableCols, setTableCols] = useState("2");
  const [showGallery, setShowGallery] = useState(false);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);

  // Crop modal state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<"device" | "gallery">("device");

  // Image resize bar state
  const [resizeTarget, setResizeTarget] = useState<HTMLImageElement | null>(null);
  const [resizeWidth, setResizeWidth] = useState(100);

  const savedSelection = useRef<Range | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exec = useCallback(
    (cmd: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(cmd, false, value);
      onInput();
    },
    [editorRef, onInput]
  );

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelection.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    if (savedSelection.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelection.current);
    }
  };

  // ========== Click-to-select & drag-to-resize images in editor ==========
  const dragState = useRef<{ img: HTMLImageElement; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const clearHighlights = () => {
      editor.querySelectorAll("img").forEach(i => {
        const el = i as HTMLElement;
        el.style.outline = "";
        el.style.outlineOffset = "";
        el.style.boxShadow = "";
      });
    };

    const addResizeHandles = () => {
      editor.querySelectorAll("img").forEach((img) => {
        const el = img as HTMLElement;
        el.style.cursor = "pointer";
        // Mark as having handles set up
        if (el.dataset.resizable) return;
        el.dataset.resizable = "true";
        el.style.position = "relative";
      });
    };
    addResizeHandles();

    const observer = new MutationObserver(addResizeHandles);
    observer.observe(editor, { childList: true, subtree: true });

    // --- Click to select ---
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      if (target.tagName === "IMG") {
        const img = target as HTMLImageElement;
        e.preventDefault();
        e.stopPropagation();

        clearHighlights();
        img.style.outline = "2px solid hsl(var(--primary))";
        img.style.outlineOffset = "3px";
        img.style.boxShadow = "0 0 0 6px hsl(var(--primary) / 0.1)";

        setResizeTarget(img);
        const w = parseInt(img.style.maxWidth || img.style.width || "100");
        setResizeWidth(isNaN(w) ? 100 : w);

        // Check if click is near the right or bottom edge → start drag resize
        const rect = img.getBoundingClientRect();
        const edgeThreshold = 16;
        const nearRight = e.clientX >= rect.right - edgeThreshold;
        const nearBottom = e.clientY >= rect.bottom - edgeThreshold;

        if (nearRight || nearBottom) {
          dragState.current = {
            img,
            startX: e.clientX,
            startWidth: img.offsetWidth,
          };
          img.style.cursor = "nwse-resize";
          document.body.style.cursor = "nwse-resize";
          document.body.style.userSelect = "none";
        }
      } else if (!target.closest("[data-resize-handle]")) {
        clearHighlights();
        setResizeTarget(null);
      }
    };

    // --- Drag move ---
    const handleMouseMove = (e: MouseEvent) => {
      // Show resize cursor when hovering near edge of any image
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG" && !dragState.current) {
        const rect = target.getBoundingClientRect();
        const nearEdge = e.clientX >= rect.right - 16 || e.clientY >= rect.bottom - 16;
        target.style.cursor = nearEdge ? "nwse-resize" : "pointer";
      }

      if (!dragState.current) return;
      e.preventDefault();

      const { img, startX, startWidth } = dragState.current;
      const deltaX = e.clientX - startX;
      const newPxWidth = Math.max(40, startWidth + deltaX);

      // Convert to percentage of editor width
      const editorWidth = editor.clientWidth;
      const newPct = Math.min(100, Math.max(10, Math.round((newPxWidth / editorWidth) * 100)));

      img.style.width = `${newPct}%`;
      img.style.maxWidth = `${newPct}%`;
      img.style.height = "auto";
      setResizeWidth(newPct);
    };

    // --- Drag end ---
    const handleMouseUp = () => {
      if (!dragState.current) return;
      const { img } = dragState.current;
      img.style.cursor = "pointer";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      dragState.current = null;
      onInput();
    };

    editor.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      editor.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
    };
  }, [editorRef, onInput]);

  // ========== Image resize ==========
  const applyResize = (newWidth: number) => {
    if (!resizeTarget) return;
    const clamped = Math.min(100, Math.max(10, newWidth));
    setResizeWidth(clamped);
    resizeTarget.style.maxWidth = `${clamped}%`;
    resizeTarget.style.width = `${clamped}%`;
    resizeTarget.style.height = "auto";
    onInput();
  };

  const changeImageAlign = (align: "left" | "center" | "right") => {
    if (!resizeTarget) return;
    if (align === "center") {
      resizeTarget.style.display = "block";
      resizeTarget.style.marginLeft = "auto";
      resizeTarget.style.marginRight = "auto";
      resizeTarget.style.removeProperty("float");
    } else if (align === "right") {
      resizeTarget.style.display = "block";
      resizeTarget.style.marginLeft = "auto";
      resizeTarget.style.marginRight = "0";
      resizeTarget.style.removeProperty("float");
    } else {
      resizeTarget.style.display = "block";
      resizeTarget.style.marginLeft = "0";
      resizeTarget.style.marginRight = "auto";
      resizeTarget.style.removeProperty("float");
    }
    onInput();
  };

  const deleteSelectedImage = () => {
    if (!resizeTarget) return;
    resizeTarget.remove();
    setResizeTarget(null);
    onInput();
  };

  // ========== Link ==========
  const handleLink = () => {
    saveSelection();
    setShowLinkInput(true);
    closePopovers("link");
    setLinkUrl("https://");
  };

  const applyLink = () => {
    restoreSelection();
    if (linkUrl.trim()) document.execCommand("createLink", false, linkUrl.trim());
    setShowLinkInput(false);
    setLinkUrl("");
    onInput();
  };

  // ========== Image Upload ==========
  const openCropForFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only images allowed", variant: "destructive" });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "Max 50MB for email images", variant: "destructive" });
      return;
    }
    saveSelection();
    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    setCropSource("device");
  };

  const openCropForGalleryUrl = (url: string) => {
    saveSelection();
    setCropSrc(url);
    setCropSource("gallery");
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropSrc(null);
    setUploading(true);
    try {
      const baseName = `email-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { webpFile } = await compressImageToFiles(croppedFile, baseName);
      const path = `email-templates/${baseName}.webp`;
      const result = await uploadImage({ bucket: "journal-images", file: webpFile, path, type: "inline", fileName: `${baseName}.webp` });
      insertImageHtml(result.url);
      if (showGallery) loadGallery();
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
    setUploading(false);
  };

  const handleCropCancel = () => {
    if (cropSrc && cropSource === "device") {
      URL.revokeObjectURL(cropSrc);
    }
    setCropSrc(null);
  };

  const insertImageHtml = (url: string) => {
    const widthPct = Math.min(100, Math.max(10, parseInt(imageWidth) || 100));
    const alignStyle =
      imageAlign === "center" ? "display:block;margin:0 auto;"
      : imageAlign === "right" ? "display:block;margin-left:auto;"
      : "display:block;";

    const imgTag = `<img src="${url}" alt="Email image" style="max-width:${widthPct}%;width:${widthPct}%;height:auto;border-radius:4px;${alignStyle}" />`;

    restoreSelection();
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, imgTag);
    onInput();
    setShowImageMenu(false);
    setShowGallery(false);
    setImageUrl("");
  };

  const closePopovers = (except?: string) => {
    if (except !== "image") setShowImageMenu(false);
    if (except !== "link") setShowLinkInput(false);
    if (except !== "table") setShowTableMenu(false);
    if (except !== "gallery") setShowGallery(false);
  };

  const handleImageMenuOpen = () => {
    saveSelection();
    closePopovers("image");
    setShowImageMenu(true);
  };

  // ========== Gallery ==========
  const loadGallery = async () => {
    setGalleryLoading(true);
    const result = await storageList("journal-images", "email-templates", {
      limit: 50,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (result === null) {
      toast({ title: "Gallery not available with external storage" });
      setGalleryLoading(false);
      setShowGallery(false);
      return;
    }
    const images: GalleryImage[] = result
      .filter(f => f.name && /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f.name))
      .map(f => ({
        name: f.name,
        url: storageGetPublicUrl("journal-images", `email-templates/${f.name}`),
      }));
    setGalleryImages(images);
    setGalleryLoading(false);
  };

  const handleGalleryOpen = () => {
    saveSelection();
    closePopovers("gallery");
    setShowGallery(true);
    loadGallery();
  };

  // ========== Table ==========
  const handleTableMenuOpen = () => {
    saveSelection();
    closePopovers("table");
    setShowTableMenu(true);
  };

  const insertTable = () => {
    const rows = Math.min(10, Math.max(1, parseInt(tableRows) || 2));
    const cols = Math.min(6, Math.max(1, parseInt(tableCols) || 2));
    let html = '<table style="width:100%;border-collapse:collapse;margin:12px 0;" border="1" cellpadding="8">';
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) {
        const tag = r === 0 ? "th" : "td";
        const style = r === 0
          ? 'style="background:#f4f4f5;font-weight:600;text-align:left;border:1px solid #e4e4e7;padding:8px"'
          : 'style="border:1px solid #e4e4e7;padding:8px"';
        html += `<${tag} ${style}>${r === 0 ? `Header ${c + 1}` : ""}</${tag}>`;
      }
      html += "</tr>";
    }
    html += "</table><p></p>";
    restoreSelection();
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    onInput();
    setShowTableMenu(false);
  };

  const insertHr = () => {
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, '<hr style="border:none;border-top:1px solid #e4e4e7;margin:16px 0" />');
    onInput();
  };

  const setFontSize = (size: string) => { editorRef.current?.focus(); document.execCommand("fontSize", false, size); onInput(); };
  const setColor = (color: string) => { editorRef.current?.focus(); document.execCommand("foreColor", false, color); onInput(); };

  return (
    <>
      <div className="border border-border rounded-t-sm bg-card/60 px-2 py-1.5 flex flex-wrap items-center gap-0.5 relative">
        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) openCropForFile(f); e.target.value = ""; }}
        />

        {/* Undo / Redo */}
        <button type="button" className={btnClass} onClick={() => exec("undo")} title="Undo"><Undo className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("redo")} title="Redo"><Redo className="h-3.5 w-3.5" /></button>
        <div className={sepClass} />

        {/* Headings */}
        <button type="button" className={btnClass} onClick={() => exec("formatBlock", "h1")} title="Heading 1"><Heading1 className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("formatBlock", "h2")} title="Heading 2"><Heading2 className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("formatBlock", "h3")} title="Heading 3"><Heading3 className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("formatBlock", "p")} title="Paragraph"><Type className="h-3.5 w-3.5" /></button>
        <div className={sepClass} />

        {/* Inline */}
        <button type="button" className={btnClass} onClick={() => exec("bold")} title="Bold"><Bold className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("italic")} title="Italic"><Italic className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("underline")} title="Underline"><Underline className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("strikeThrough")} title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></button>
        <div className={sepClass} />

        {/* Lists */}
        <button type="button" className={btnClass} onClick={() => exec("insertUnorderedList")} title="Bullet List"><List className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("insertOrderedList")} title="Numbered List"><ListOrdered className="h-3.5 w-3.5" /></button>
        <div className={sepClass} />

        {/* Alignment */}
        <button type="button" className={btnClass} onClick={() => exec("justifyLeft")} title="Align Left"><AlignLeft className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("justifyCenter")} title="Align Center"><AlignCenter className="h-3.5 w-3.5" /></button>
        <button type="button" className={btnClass} onClick={() => exec("justifyRight")} title="Align Right"><AlignRight className="h-3.5 w-3.5" /></button>
        <div className={sepClass} />

        {/* Link */}
        <button type="button" className={btnClass} onClick={handleLink} title="Insert Link"><Link className="h-3.5 w-3.5" /></button>

        {/* Image */}
        <button type="button" className={`${btnClass} ${showImageMenu ? activeClass : ""}`} onClick={handleImageMenuOpen} title="Insert Image">
          <ImagePlus className="h-3.5 w-3.5" />
        </button>

        {/* Gallery */}
        <button type="button" className={`${btnClass} ${showGallery ? activeClass : ""}`} onClick={handleGalleryOpen} title="Image Gallery">
          <Images className="h-3.5 w-3.5" />
        </button>

        {/* Table */}
        <button type="button" className={`${btnClass} ${showTableMenu ? activeClass : ""}`} onClick={handleTableMenuOpen} title="Insert Table">
          <Table className="h-3.5 w-3.5" />
        </button>

        {/* Horizontal Rule */}
        <button type="button" className={btnClass} onClick={insertHr} title="Horizontal Line">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <div className={sepClass} />

        {/* Font size */}
        <select className="bg-background border border-border text-[10px] px-1.5 py-1 rounded-sm text-muted-foreground hover:text-foreground"
          onChange={e => { if (e.target.value) setFontSize(e.target.value); e.target.value = ""; }} defaultValue="">
          <option value="" disabled>Size</option>
          <option value="1">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="7">Huge</option>
        </select>

        {/* Text color */}
        <label className={btnClass + " relative cursor-pointer"} title="Text Color">
          <Palette className="h-3.5 w-3.5" />
          <input type="color" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            onChange={e => setColor(e.target.value)} defaultValue="#333333" />
        </label>

        {/* Clear formatting */}
        <button type="button" className={btnClass} onClick={() => exec("removeFormat")} title="Clear Formatting"><RemoveFormatting className="h-3.5 w-3.5" /></button>

        {/* Link input popover */}
        {showLinkInput && (
          <div className="flex items-center gap-1.5 ml-2 border border-border rounded-sm px-2 py-1 bg-background">
            <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && applyLink()}
              className="text-xs bg-transparent border-none outline-none w-40" placeholder="https://..." autoFocus />
            <button type="button" onClick={applyLink} className="text-[9px] uppercase tracking-wider text-primary hover:underline">Apply</button>
            <button type="button" onClick={() => setShowLinkInput(false)} className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        )}

        {/* Image insert popover */}
        {showImageMenu && (
          <div className={`${popoverClass} min-w-[300px]`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Insert Image</p>
              <button type="button" onClick={() => setShowImageMenu(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
            </div>

            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="w-full flex items-center gap-2 px-3 py-2.5 border border-dashed border-border rounded-sm text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors mb-3">
              {uploading
                ? <div className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload from device"}
            </button>

            <div className="flex items-center gap-1.5 mb-3">
              <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
              <input type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                className="flex-1 text-xs bg-background border border-border rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary"
                placeholder="Or paste image URL…" />
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Width %</label>
                <input type="number" min="10" max="100" value={imageWidth} onChange={e => setImageWidth(e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Align</label>
                <select value={imageAlign} onChange={e => setImageAlign(e.target.value as any)}
                  className="w-full text-xs bg-background border border-border rounded-sm px-2 py-1.5">
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { if (imageUrl.trim()) insertImageHtml(imageUrl.trim()); }}
                disabled={!imageUrl.trim()}
                className="text-[9px] uppercase tracking-wider px-3 py-1.5 bg-primary text-primary-foreground rounded-sm disabled:opacity-40">
                Insert URL
              </button>
              <button type="button" onClick={() => setShowImageMenu(false)}
                className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
            </div>
          </div>
        )}

        {/* Gallery popover */}
        {showGallery && (
          <div className={`${popoverClass} min-w-[360px] max-w-[420px]`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Image Gallery
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="text-[9px] uppercase tracking-wider text-primary hover:underline flex items-center gap-1">
                  <Upload className="h-3 w-3" /> Upload
                </button>
                <button type="button" onClick={() => setShowGallery(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            {galleryLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : galleryImages.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No images uploaded yet. Upload one to get started.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-[240px] overflow-y-auto pr-1">
                {galleryImages.map(img => (
                  <button key={img.name} type="button" onClick={() => openCropForGalleryUrl(img.url)}
                    className="group relative aspect-square rounded-sm overflow-hidden border border-border hover:border-primary transition-colors"
                    title={img.name}>
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors flex items-center justify-center">
                      <span className="text-[8px] uppercase tracking-wider text-transparent group-hover:text-primary-foreground bg-primary/80 px-1.5 py-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        Insert
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-2 pt-2 border-t border-border">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Width %</label>
                  <input type="number" min="10" max="100" value={imageWidth} onChange={e => setImageWidth(e.target.value)}
                    className="w-full text-xs bg-background border border-border rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Align</label>
                  <select value={imageAlign} onChange={e => setImageAlign(e.target.value as any)}
                    className="w-full text-xs bg-background border border-border rounded-sm px-2 py-1.5">
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Table popover */}
        {showTableMenu && (
          <div className={`${popoverClass} min-w-[220px]`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Insert Table</p>
              <button type="button" onClick={() => setShowTableMenu(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Rows</label>
                <input type="number" min="1" max="10" value={tableRows} onChange={e => setTableRows(e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Columns</label>
                <input type="number" min="1" max="6" value={tableCols} onChange={e => setTableCols(e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={insertTable} className="text-[9px] uppercase tracking-wider px-3 py-1.5 bg-primary text-primary-foreground rounded-sm">Insert</button>
              <button type="button" onClick={() => setShowTableMenu(false)} className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Image resize bar — shows below toolbar when an image is clicked */}
      {resizeTarget && (
        <div className="border border-primary/30 border-t-0 bg-primary/5 px-3 py-2 flex flex-wrap items-center gap-2.5 rounded-b-sm">
          <span className="text-[9px] uppercase tracking-[0.15em] text-primary font-medium flex items-center gap-1.5" style={{ fontFamily: "var(--font-heading)" }}>
            <Maximize2 className="h-3 w-3" /> Resize Image
          </span>
          <div className={sepClass} />

          {/* Shrink / Slider / Enlarge */}
          <div className="flex items-center gap-1.5">
            <button type="button" className={btnClass} onClick={() => applyResize(resizeWidth - 5)} title="Shrink 5%">
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
            <input
              type="range" min="10" max="100" step="1" value={resizeWidth}
              onChange={e => applyResize(parseInt(e.target.value))}
              className="w-28 h-1.5 accent-primary cursor-pointer"
            />
            <button type="button" className={btnClass} onClick={() => applyResize(resizeWidth + 5)} title="Enlarge 5%">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Width input */}
          <div className="flex items-center gap-1">
            <input
              type="number" min="10" max="100" value={resizeWidth}
              onChange={e => applyResize(parseInt(e.target.value) || 10)}
              className="w-12 text-[10px] font-mono text-center bg-background border border-border rounded-sm px-1 py-0.5 focus:outline-none focus:border-primary"
            />
            <span className="text-[9px] text-muted-foreground">%</span>
          </div>
          <div className={sepClass} />

          {/* Quick sizes */}
          {[25, 50, 75, 100].map(s => (
            <button key={s} type="button" onClick={() => applyResize(s)}
              className={`text-[9px] px-2 py-1 rounded-sm border transition-colors ${resizeWidth === s ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}>
              {s}%
            </button>
          ))}
          <div className={sepClass} />

          {/* Alignment */}
          <button type="button" className={btnClass} onClick={() => changeImageAlign("left")} title="Align Left"><AlignLeft className="h-3.5 w-3.5" /></button>
          <button type="button" className={btnClass} onClick={() => changeImageAlign("center")} title="Align Center"><AlignCenter className="h-3.5 w-3.5" /></button>
          <button type="button" className={btnClass} onClick={() => changeImageAlign("right")} title="Align Right"><AlignRight className="h-3.5 w-3.5" /></button>
          <div className={sepClass} />

          {/* Delete */}
          <button type="button" className="p-1.5 rounded-sm text-destructive hover:bg-destructive/10 transition-colors" onClick={deleteSelectedImage} title="Remove Image">
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          {/* Deselect */}
          <button type="button" className="ml-auto p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" 
            onClick={() => {
              const editor = editorRef.current;
              if (editor) {
                editor.querySelectorAll("img").forEach(i => {
                  (i as HTMLElement).style.outline = "";
                  (i as HTMLElement).style.outlineOffset = "";
                  (i as HTMLElement).style.boxShadow = "";
                });
              }
              setResizeTarget(null);
            }} 
            title="Deselect">
            <X className="h-3.5 w-3.5" />
          </button>
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
    </>
  );
}
