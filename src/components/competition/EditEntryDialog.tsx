/**
 * EditEntryDialog — owner edit of a competition entry inside the submission window.
 *
 * RLS enforces the actual edit window (phase='submission_open' AND now()<=ends_at).
 * This dialog provides the UI; the DB rejects late edits regardless of UI state.
 *
 * Editable: entry title, entry description, per-photo title, per-photo description,
 *           and full photo file replacement (re-uploads WebP + thumbnail + re-extracts EXIF).
 *
 * Non-editable here (RLS-blocked): status, placement, stage_key, AI flags, round, user_id.
 */

import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, ImageIcon, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateCompetitionEntry } from "@/hooks/competition/useCompetitionEntryMutations";
import { uploadImageWithThumbnail } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { extractExif } from "@/lib/exifExtract";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "sonner";

interface EditEntryDialogProps {
  entryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

interface EntryRow {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  photo_thumbnails: string[] | null;
  photo_meta: any[];
  exif_data: any;
}

export default function EditEntryDialog({ entryId, open, onOpenChange, onSaved }: EditEntryDialogProps) {
  const { user } = useAuth();
  const update = useUpdateCompetitionEntry();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);
  const [row, setRow] = useState<EntryRow | null>(null);

  // Local editable copies
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [photoMeta, setPhotoMeta] = useState<any[]>([]);
  const [exifData, setExifData] = useState<any>(null);

  useEffect(() => {
    if (!open || !entryId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("competition_entries")
        // F-04: exif_data column revoked from `authenticated`; fetch via RPC.
        .select("id, title, description, photos, photo_thumbnails, photo_meta")
        .eq("id", entryId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Could not load entry");
        onOpenChange(false);
        return;
      }
      // F-04: pull EXIF via SECURITY DEFINER RPC (owner-gated).
      const { data: metaRows } = await (supabase.rpc as any)(
        "get_entries_private_meta",
        { _entry_ids: [entryId] },
      );
      const exif = ((metaRows as any[]) || [])[0]?.exif_data ?? null;
      const r = { ...(data as any), exif_data: exif } as EntryRow;
      setRow(r);
      setTitle(r.title ?? "");
      setDescription(r.description ?? "");
      setPhotos(Array.isArray(r.photos) ? r.photos : []);
      setThumbnails(Array.isArray(r.photo_thumbnails) ? r.photo_thumbnails : []);
      setPhotoMeta(Array.isArray(r.photo_meta) ? r.photo_meta : []);
      setExifData(r.exif_data ?? null);
      setLoading(false);

    })();
    return () => { cancelled = true; };
  }, [entryId, open, onOpenChange]);

  const updateMetaField = (i: number, field: "title" | "description", value: string) => {
    setPhotoMeta((prev) => {
      const next = [...prev];
      next[i] = { ...(next[i] ?? {}), [field]: value };
      return next;
    });
  };

  /** Manual EXIF edit (mirrors CompetitionSubmit.updateExif). Flips exif_available=true and clears raw_required. */
  const updateExifField = (
    i: number,
    field: "camera" | "lens" | "iso" | "aperture" | "shutter_speed" | "focal_length" | "date_taken",
    raw: string
  ) => {
    setPhotoMeta((prev) => {
      const next = [...prev];
      const meta = { ...(next[i] ?? {}) };
      const exif: any = { ...(meta.exif ?? {}) };
      if (raw === "") {
        delete exif[field];
      } else if (field === "iso" || field === "aperture" || field === "shutter_speed" || field === "focal_length") {
        const n = Number(raw);
        if (Number.isFinite(n)) exif[field] = n;
      } else if (field === "date_taken") {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) exif[field] = d.toISOString();
      } else {
        exif[field] = raw;
      }
      const hasAny = Boolean(
        exif.camera || exif.iso || exif.aperture || exif.shutter_speed || exif.date_taken
      );
      meta.exif = exif;
      meta.exif_available = hasAny;
      if (hasAny) meta.raw_required = false;
      next[i] = meta;
      return next;
    });
  };

  const toggleRawRequired = (i: number, checked: boolean) => {
    setPhotoMeta((prev) => {
      const next = [...prev];
      next[i] = { ...(next[i] ?? {}), raw_required: checked };
      return next;
    });
  };

  const handleReplacePhoto = async (i: number, file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setReplacingIndex(i);
    try {
      const { exif, exif_available } = await extractExif(file);
      const baseName = crypto.randomUUID();
      const { webpFile } = await compressImageToFiles(file, baseName);
      const uploadResult = await uploadImageWithThumbnail({
        bucket: "competition-photos",
        file: webpFile,
        type: "competition",
        userId: user.id,
        cacheControl: "3600",
      });
      setPhotos((prev) => {
        const next = [...prev];
        next[i] = uploadResult.url;
        return next;
      });
      setThumbnails((prev) => {
        const next = [...prev];
        next[i] = uploadResult.thumbnailUrl;
        return next;
      });
      setPhotoMeta((prev) => {
        const next = [...prev];
        next[i] = {
          ...(next[i] ?? {}),
          url: uploadResult.url,
          path: uploadResult.path,
          thumbnailUrl: uploadResult.thumbnailUrl,
          thumbnailPath: uploadResult.thumbnailPath,
          exif,
          exif_available,
        };
        return next;
      });
      // Refresh top-level exif_data with the latest replaced photo's exif (when present).
      if (exif_available && exif) setExifData(exif);
      toast.success(`Photo ${i + 1} replaced`);
    } catch (err: any) {
      toast.error("Replace failed", { description: err?.message ?? String(err) });
    } finally {
      setReplacingIndex(null);
    }
  };

  const handleSave = async () => {
    if (!row) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Title is required");
      return;
    }
    if (photoMeta.length !== photos.length) {
      toast.error("Photo metadata mismatch — please re-open the dialog");
      return;
    }
    // EXIF integrity gate (mirrors CompetitionSubmit). Only triggers when a replaced photo
    // came back without EXIF AND the user has not committed to RAW.
    const blocking = photoMeta.findIndex(
      (m) => m && m.exif_available === false && !m.raw_required
    );
    if (blocking >= 0) {
      toast.error(`Photo ${blocking + 1}: missing EXIF`, {
        description: "Either fill EXIF manually or commit to send RAW on request.",
      });
      return;
    }
    try {
      await update.mutateAsync({
        entryId: row.id,
        patch: {
          title: trimmedTitle,
          description: description.trim() || null,
          photos,
          photo_thumbnails: thumbnails.length === photos.length ? thumbnails : undefined,
          photo_meta: photoMeta,
          exif_data: exifData,
        },
      });
      onOpenChange(false);
      onSaved?.();
    } catch {
      /* error toasted by hook */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit submission</DialogTitle>
          <p className="text-xs text-muted-foreground">
            You can edit this submission until the competition's submission deadline.
            Judging, placement and round data cannot be changed.
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <Label htmlFor="entry-title">Entry title</Label>
              <Input id="entry-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div>
              <Label htmlFor="entry-desc">Description (optional)</Label>
              <Textarea id="entry-desc" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="space-y-4">
              <Label>Photos</Label>
              {photos.map((url, i) => (
                <div key={`${i}-${url}`} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex gap-3">
                    <div className="w-24 h-24 shrink-0 bg-muted rounded overflow-hidden flex items-center justify-center">
                      {url ? (
                        <img src={thumbnails[i] || url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder={`Photo ${i + 1} title`}
                        maxLength={120}
                        value={photoMeta[i]?.title ?? ""}
                        onChange={(e) => updateMetaField(i, "title", e.target.value)}
                      />
                      <Textarea
                        placeholder="Photo description (optional)"
                        rows={2}
                        maxLength={1000}
                        value={photoMeta[i]?.description ?? ""}
                        onChange={(e) => updateMetaField(i, "description", e.target.value)}
                      />
                      <div>
                        <input
                          ref={i === 0 ? fileInputRef : undefined}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          id={`replace-${i}`}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleReplacePhoto(i, f);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={replacingIndex !== null}
                          onClick={() => document.getElementById(`replace-${i}`)?.click()}
                        >
                          {replacingIndex === i ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Uploading…</>
                          ) : (
                            <><RefreshCw className="h-3.5 w-3.5 mr-2" />Replace photo</>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Manual EXIF fallback — only when replaced photo had no EXIF */}
                  {photoMeta[i]?.exif_available === false && (
                    <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
                      <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        No EXIF detected in the replaced file. Fill manually OR commit to RAW below.
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <ExifInput label="Camera" placeholder="Canon EOS R5"
                          value={photoMeta[i]?.exif?.camera ?? ""} onChange={(v) => updateExifField(i, "camera", v)} />
                        <ExifInput label="Lens" placeholder="24-70mm f/2.8"
                          value={photoMeta[i]?.exif?.lens ?? ""} onChange={(v) => updateExifField(i, "lens", v)} />
                        <ExifInput label="ISO" placeholder="400" type="number"
                          value={photoMeta[i]?.exif?.iso?.toString() ?? ""} onChange={(v) => updateExifField(i, "iso", v)} />
                        <ExifInput label="Aperture (f-number)" placeholder="2.8" type="number"
                          value={photoMeta[i]?.exif?.aperture?.toString() ?? ""} onChange={(v) => updateExifField(i, "aperture", v)} />
                        <ExifInput label="Shutter (sec)" placeholder="0.004" type="number"
                          value={photoMeta[i]?.exif?.shutter_speed?.toString() ?? ""} onChange={(v) => updateExifField(i, "shutter_speed", v)} />
                        <ExifInput label="Focal length (mm)" placeholder="50" type="number"
                          value={photoMeta[i]?.exif?.focal_length?.toString() ?? ""} onChange={(v) => updateExifField(i, "focal_length", v)} />
                        <div className="sm:col-span-2">
                          <ExifInput label="Date taken" type="date"
                            value={photoMeta[i]?.exif?.date_taken ? String(photoMeta[i].exif.date_taken).slice(0, 10) : ""}
                            onChange={(v) => updateExifField(i, "date_taken", v)} />
                        </div>
                      </div>
                      <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={Boolean(photoMeta[i]?.raw_required)}
                          onChange={(e) => toggleRawRequired(i, e.target.checked)}
                        />
                        <span>
                          EXIF unavailable — I commit to submit the RAW file on request.
                          <span className="block text-muted-foreground mt-0.5">
                            Required if EXIF cannot be filled. Failure to provide RAW after shortlisting will disqualify this photo.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={update.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading || update.isPending || replacingIndex !== null}>
            {update.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Small EXIF input field (mirrors CompetitionSubmit.ExifField) ── */
function ExifInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "date";
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}
