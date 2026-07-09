import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, FolderOpen, FileText, Image, FileSpreadsheet, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { scanFileWithToast, type AllowedFileType } from "@/lib/fileSecurityScanner";
import { compressImageToFiles } from "@/lib/imageCompression";
import { uploadImage } from "@/lib/imageUpload";
import { storageList, storageGetPublicUrl } from "@/lib/storageUpload";

export interface UploadedFile {
  url: string;
  name: string;
  type: string;
  size: number;
}

interface GalleryFile {
  name: string;
  url: string;
}

interface FileUploadDropZoneProps {
  /** Storage bucket name */
  bucket: string;
  /** Folder path within the bucket */
  folder: string;
  /** Allowed file types */
  allowedTypes?: AllowedFileType;
  /** Max file size in bytes (default 50MB) */
  maxSize?: number;
  /** Whether to compress images (default true for images) */
  compressImages?: boolean;
  /** Called when a file is successfully uploaded */
  onFileUploaded: (file: UploadedFile) => void;
  /** Show the gallery browser (default true) */
  showGallery?: boolean;
  /** Allow multiple file selection (default false) */
  multiple?: boolean;
  /** Compact mode – smaller layout */
  compact?: boolean;
  /** Custom label */
  label?: string;
}

const ACCEPT_MAP: Record<AllowedFileType, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/heic",
  pdf: "application/pdf",
  "image+pdf": "image/jpeg,image/png,image/webp,image/gif,application/pdf",
  document: "application/msword,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image+pdf+document": "image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|bmp|tiff|heic)$/i.test(lower)) return <Image className="h-3.5 w-3.5 text-blue-500" />;
  if (/\.pdf$/i.test(lower)) return <FileText className="h-3.5 w-3.5 text-red-500" />;
  if (/\.(docx?|xlsx?)$/i.test(lower)) return <FileSpreadsheet className="h-3.5 w-3.5 text-green-500" />;
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
}

const FileUploadDropZone = ({
  bucket,
  folder,
  allowedTypes = "image+pdf+document",
  maxSize = 50 * 1024 * 1024,
  compressImages = true,
  onFileUploaded,
  showGallery = true,
  multiple = false,
  compact = false,
  label,
}: FileUploadDropZoneProps) => {
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showGalleryPanel, setShowGalleryPanel] = useState(false);
  const [galleryFiles, setGalleryFiles] = useState<GalleryFile[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadSingleFile = useCallback(async (file: File) => {
    const safe = await scanFileWithToast(file, toast, { allowedTypes, maxSize });
    if (!safe) return;

    const isImage = file.type.startsWith("image/");
    const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      if (isImage && compressImages) {
        try {
          const { webpFile } = await compressImageToFiles(file, baseName);
          const webpPath = `${folder}/${baseName}.webp`;
          const result = await uploadImage({ bucket, file: webpFile, path: webpPath, type: "inline", fileName: `${baseName}.webp` });
          onFileUploaded({ url: result.url, name: file.name, type: file.type, size: file.size });
          return;
        } catch {
          toast({ title: "Compression failed, uploading original", variant: "default" });
        }
      }

      // Non-image or compression failed
      const ext = file.name.split(".").pop() || "bin";
      const uploadPath = `${folder}/${baseName}.${ext}`;
      const result = await uploadImage({ bucket, file, path: uploadPath, type: "inline", fileName: file.name });
      onFileUploaded({ url: result.url, name: file.name, type: file.type, size: file.size });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  }, [bucket, folder, allowedTypes, maxSize, compressImages, onFileUploaded]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    const fileArr = Array.from(files);
    const toProcess = multiple ? fileArr : fileArr.slice(0, 1);
    for (const file of toProcess) {
      await uploadSingleFile(file);
    }
    setUploading(false);
  }, [uploadSingleFile, multiple]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = "";
  };

  const loadGallery = async () => {
    setGalleryLoading(true);
    const result = await storageList(bucket, folder, {
      limit: 60,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (result === null) {
      // S3 mode — gallery browsing not available
      toast({ title: "Gallery not available with external storage" });
      setGalleryLoading(false);
      setShowGalleryPanel(false);
      return;
    }
    const files: GalleryFile[] = result
      .filter(f => f.name && !f.name.startsWith("."))
      .map(f => ({
        name: f.name,
        url: storageGetPublicUrl(bucket, `${folder}/${f.name}`),
      }));
    setGalleryFiles(files);
    setGalleryLoading(false);
  };

  const handleGalleryOpen = () => {
    setShowGalleryPanel(true);
    loadGallery();
  };

  const handleGallerySelect = (file: GalleryFile) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isImage = /^(jpg|jpeg|png|webp|gif|bmp|tiff|heic)$/.test(ext);
    const isPdf = ext === "pdf";
    const type = isImage ? `image/${ext === "jpg" ? "jpeg" : ext}` : isPdf ? "application/pdf" : "application/octet-stream";
    onFileUploaded({ url: file.url, name: file.name, type, size: 0 });
    setShowGalleryPanel(false);
  };

  const typeLabels: string[] = [];
  if (["image", "image+pdf", "image+pdf+document"].includes(allowedTypes)) typeLabels.push("images");
  if (["pdf", "image+pdf", "image+pdf+document"].includes(allowedTypes)) typeLabels.push("PDFs");
  if (["document", "image+pdf+document"].includes(allowedTypes)) typeLabels.push("documents");

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-sm transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
        } ${compact ? "p-3" : "p-6"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs">Uploading…</span>
          </div>
        ) : (
          <div className={`flex ${compact ? "flex-row items-center gap-3" : "flex-col items-center gap-3"}`}>
            <Upload className={`${compact ? "h-4 w-4" : "h-6 w-6"} text-muted-foreground`} />
            <div className={`${compact ? "" : "text-center"}`}>
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                {label || `Drop ${typeLabels.join(", ")} here`}
              </p>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                Max {Math.round(maxSize / 1024 / 1024)}MB
              </p>
            </div>
            <div className={`flex items-center gap-2 ${compact ? "ml-auto" : ""}`}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.1em] uppercase px-3 py-1.5 border border-border hover:border-primary text-muted-foreground hover:text-primary transition-colors rounded-sm"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Upload className="h-3 w-3" /> Browse Device
              </button>
              {showGallery && (
                <button
                  type="button"
                  onClick={handleGalleryOpen}
                  className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.1em] uppercase px-3 py-1.5 border border-border hover:border-primary text-muted-foreground hover:text-primary transition-colors rounded-sm"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  <FolderOpen className="h-3 w-3" /> Gallery
                </button>
              )}
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_MAP[allowedTypes]}
          multiple={multiple}
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Gallery panel */}
      {showGalleryPanel && (
        <div className="border border-border rounded-sm bg-card p-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              File Gallery
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="text-[9px] uppercase tracking-wider text-primary hover:underline flex items-center gap-1">
                <Upload className="h-3 w-3" /> Upload New
              </button>
              <button type="button" onClick={() => setShowGalleryPanel(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {galleryLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          ) : galleryFiles.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              No files uploaded yet.
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-[200px] overflow-y-auto">
              {galleryFiles.map(f => {
                const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name);
                return (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => handleGallerySelect(f)}
                    className="group relative aspect-square rounded-sm overflow-hidden border border-border hover:border-primary transition-colors flex items-center justify-center bg-muted/30"
                    title={f.name}
                  >
                    {isImage ? (
                      <img src={f.url} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 p-1">
                        {getFileIcon(f.name)}
                        <span className="text-[7px] text-muted-foreground truncate w-full text-center">{f.name.split(".").pop()?.toUpperCase()}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors flex items-center justify-center">
                      <span className="text-[7px] uppercase tracking-wider text-transparent group-hover:text-primary-foreground bg-primary/80 px-1.5 py-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        Select
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUploadDropZone;
