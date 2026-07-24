/**
 * Competition Submit — Per-Photo Architecture v3
 * ----------------------------------------------
 * Each photo card independently stores:
 *   • Title (required, 1–120 chars)
 *   • Description (optional, ≤500 chars, opens via collapsed checkbox)
 *   • is_ai_generated (per-photo checkbox)
 *   • EXIF (auto-read from original)
 *   • RAW commitment
 *   • SHA-256 + pHash from original bytes (pre-WebP)
 *
 * Entry-level fields are DERIVED at submit:
 *   • title       → photo_meta[0].title (DB still requires title)
 *   • description → null (per-photo descriptions are the source of truth)
 *   • is_ai_generated → true if ANY photo is AI-flagged
 *   • is_ai_advisory  → forced FALSE (no detector runs at submit; trigger blocker fix)
 */
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Upload, X, Loader2, ImagePlus, Camera, ShieldCheck,
  Ban, Clock, Trophy, ChevronDown, FileWarning, CheckCircle2, Sparkles, MessageSquarePlus,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolvePhase } from "@/lib/competitionPhase";
import { useSubmitCompetitionEntry } from "@/hooks/competition/useCompetitionEntryMutations";
import { storageRemove } from "@/lib/storageUpload";
import { uploadImageWithThumbnail } from "@/lib/imageUpload";
import { useAuth } from "@/hooks/core/useAuth";
import { useUserRoles } from "@/hooks/profile/useUserRoles";
import { useWallet } from "@/hooks/wallet/useWallet";
import { toast } from "@/hooks/core/use-toast";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { extractExif, summarizeExif, type PhotoExif } from "@/lib/exifExtract";
import { computeImageHash, type ImageHash } from "@/lib/imageHash";
import { useT } from "@/i18n/I18nContext";

interface PhotoCard {
  url: string;
  path: string;
  thumbnailUrl: string;
  thumbnailPath: string;
  title: string;                  // per-photo, REQUIRED
  description: string;            // per-photo, optional ≤500
  description_open: boolean;      // UI: description textarea visibility
  is_ai_generated: boolean;       // per-photo AI flag
  exif: PhotoExif;
  exif_available: boolean;
  raw_required: boolean;
  expanded: boolean;              // accordion: title/EXIF body
  image_hash: ImageHash | null;
}

const HEAD = { fontFamily: "var(--font-heading)" } as const;
const BODY = { fontFamily: "var(--font-body)" } as const;
const DISPLAY = { fontFamily: "var(--font-display)" } as const;

const CompetitionSubmit = () => {
  const t = useT();
  const { id: slugOrId } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { loading: rolesLoading } = useUserRoles();
  const { balance, deductFunds, loading: walletLoading } = useWallet();
  const navigate = useNavigate();
  const submitMutation = useSubmitCompetitionEntry();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Competition meta
  const [compTitle, setCompTitle] = useState("");
  const [maxPhotos, setMaxPhotos] = useState(5);
  const [entryFee, setEntryFee] = useState(0);
  const [aiImagesAllowed, setAiImagesAllowed] = useState(true);
  const [id, setId] = useState<string | undefined>(undefined);
  const [competitionPhase, setCompetitionPhase] = useState<string>("submission_open");

  // Form state — entry-level title/description/AI fields REMOVED.
  const [photos, setPhotos] = useState<PhotoCard[]>([]);
  const [ownershipDisclaimer, setOwnershipDisclaimer] = useState(false);

  // Process state
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  /* ── Auth gate ── */
  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  /* ── Load competition by slug or id ── */
  useEffect(() => {
    if (!slugOrId) return;
    (async () => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
      const col = isUuid ? "id" : "slug";
      const { data } = await supabase
        .from("competitions")
        .select("id, title, max_photos_per_entry, status, phase, entry_fee, ai_images_allowed, starts_at, ends_at, voting_ends_at, judging_completed")
        .eq(col, slugOrId)
        .single();
      if (data) {
        setId(data.id);
        const phase = resolvePhase(data as any);
        setCompetitionPhase(phase);
        setCompTitle(data.title);
        if (phase === "submission_open") {
          setMaxPhotos(data.max_photos_per_entry || 5);
          setEntryFee((data as any).entry_fee || 0);
          setAiImagesAllowed((data as any).ai_images_allowed !== false);
        }
      }
      setLoading(false);
    })();
  }, [slugOrId]);

  /* ── Upload handler: read EXIF from ORIGINAL, then compress & upload ── */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user || !id) return;

    const remaining = maxPhotos - photos.length;
    if (remaining <= 0) {
      toast({ title: `${t("csub.maxPhotosAllowed")}: ${maxPhotos}`, variant: "destructive" });
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remaining);
    setUploading(true);

    const skippedNames: string[] = [];

    for (const file of filesToUpload) {
      if (!file.type.startsWith("image/")) {
        skippedNames.push(`${file.name} (not an image)`);
        continue;
      }

      try {
        const safe = await scanFileWithToast(file, toast, { allowedTypes: "image" });
        if (!safe) {
          skippedNames.push(file.name);
          continue;
        }

        const { exif, exif_available } = await extractExif(file);

        let image_hash: ImageHash | null = null;
        try { image_hash = await computeImageHash(file); } catch { image_hash = null; }

        const baseName = crypto.randomUUID();
        const { webpFile } = await compressImageToFiles(file, baseName);

        const uploadResult = await uploadImageWithThumbnail({
          bucket: "competition-photos",
          file: webpFile,
          type: "competition",
          userId: user.id,
          cacheControl: "3600",
        });

        // Default per-photo title: filename without extension (user can edit)
        const fallbackTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Untitled";

        setPhotos((prev) => [
          ...prev,
          {
            url: uploadResult.url,
            path: uploadResult.path,
            thumbnailUrl: uploadResult.thumbnailUrl,
            thumbnailPath: uploadResult.thumbnailPath,
            title: fallbackTitle,
            description: "",
            description_open: false,
            is_ai_generated: false,
            exif,
            exif_available,
            raw_required: !exif_available,
            expanded: !exif_available,
            image_hash,
          },
        ]);
      } catch (err: any) {
        skippedNames.push(file.name);
        toast({ title: `${t("csub.uploadFailed")} ${file.name}`, description: err?.message, variant: "destructive" });
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (skippedNames.length > 0) {
      toast({
        title: `${skippedNames.length} ${t("csub.filesSkipped")}`,
        description: skippedNames.slice(0, 3).join(", ") + (skippedNames.length > 3 ? `, +${skippedNames.length - 3} more` : ""),
        variant: "destructive",
      });
    }
  };

  const removePhoto = async (index: number) => {
    const p = photos[index];
    const paths = [p.path];
    if (p.thumbnailPath && p.thumbnailPath !== p.path) paths.push(p.thumbnailPath);
    await storageRemove("competition-photos", paths);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const updatePhoto = (index: number, patch: Partial<PhotoCard>) => {
    setPhotos((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const updateExif = (index: number, key: keyof PhotoExif, value: string) => {
    setPhotos((prev) =>
      prev.map((p, i) => {
        if (i !== index) return p;
        const next: any = { ...p.exif };
        if (value === "") {
          delete next[key];
        } else if (key === "iso" || key === "aperture" || key === "focal_length" || key === "shutter_speed") {
          const n = parseFloat(value);
          if (!isNaN(n)) next[key] = n;
          else delete next[key];
        } else {
          next[key] = value;
        }
        return { ...p, exif: next, exif_available: true };
      })
    );
  };

  /* ── Submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !id) return;

    if (photos.length === 0) {
      toast({ title: t("csub.uploadAtLeastOne"), variant: "destructive" });
      return;
    }

    // Per-photo title required
    const missingTitleIdx = photos.findIndex((p) => !p.title.trim());
    if (missingTitleIdx >= 0) {
      toast({
        title: `${t("csub.photo")} ${missingTitleIdx + 1}: ${t("csub.titleIsRequired")}`,
        description: t("csub.titleReqDesc"),
        variant: "destructive",
      });
      updatePhoto(missingTitleIdx, { expanded: true });
      return;
    }

    // Per-photo description length
    const longDescIdx = photos.findIndex((p) => p.description.length > 500);
    if (longDescIdx >= 0) {
      toast({
        title: `${t("csub.photo")} ${longDescIdx + 1}: ${t("csub.descTooLong")}`,
        description: t("csub.descTooLongDesc"),
        variant: "destructive",
      });
      updatePhoto(longDescIdx, { expanded: true, description_open: true });
      return;
    }

    // AI flag policy
    const anyAi = photos.some((p) => p.is_ai_generated);
    if (!aiImagesAllowed && anyAi) {
      toast({ title: t("csub.aiNotAllowedToast"), variant: "destructive" });
      return;
    }

    if (!ownershipDisclaimer) {
      toast({ title: t("csub.confirmOwnership"), variant: "destructive" });
      return;
    }

    // EXIF integrity gate
    const blocking = photos.findIndex((p) => !p.exif_available && !p.raw_required);
    if (blocking >= 0) {
      toast({
        title: `${t("csub.photo")} ${blocking + 1}: ${t("csub.missingExif")}`,
        description: t("csub.missingExifDesc"),
        variant: "destructive",
      });
      updatePhoto(blocking, { expanded: true });
      return;
    }

    // Pre-flight UX guard (atomic RPC will re-validate server-side):
    if (entryFee > 0 && balance < entryFee) {
      toast({ title: t("csub.insufficientBalance"), description: `${t("csub.required")}: ${formatUSDFixed(entryFee)} · ${t("csub.available")}: ${formatUSDFixed(Number(balance))}`, variant: "destructive" });
      return;
    }

    // Build photo_meta — every per-photo field flows in.
    const photo_meta = photos.map((p) => ({
      url: p.url,
      thumbnail_url: p.thumbnailUrl,
      title: p.title.trim().slice(0, 120),
      description: p.description.trim() ? p.description.trim().slice(0, 500) : undefined,
      is_ai_generated: p.is_ai_generated,
      exif: p.exif,
      exif_available: p.exif_available,
      raw_required: p.raw_required,
      image_hash: p.image_hash,
    }));

    // Derive entry-level fields (DB still requires title 3-200).
    const derivedTitle = photos[0].title.trim().slice(0, 200) || "Untitled";

    setSubmitting(true);
    try {
      const result = await submitMutation.mutateAsync({
        competition_id: id,
        title: derivedTitle.length >= 3 ? derivedTitle : `${derivedTitle} entry`,
        description: null,
        photos: photos.map((p) => p.url),
        photo_thumbnails: photos.map((p) => p.thumbnailUrl),
        photo_meta,
        is_ai_generated: anyAi,
        exif_data: photos[0]?.exif ?? null,
      });
      // Fire-and-forget referral reward only if a fee was actually charged.
      if (entryFee > 0 && result?.wallet_txn_id) {
        supabase.rpc("process_referral_reward" as any, {
          _referred_user_id: user.id,
          _activity_type: "competition entry",
          _txn_amount: entryFee,
        }).then(() => {});
      }
      toast({ title: `${t("csub.entrySubmitted")} ${result?.order_no ?? ""}`.trim() });
      navigate(`/competitions/${slugOrId}`);
    } catch {
      /* mutation toasts on its own */
    }
    setSubmitting(false);
  };

  if (authLoading || loading || rolesLoading || walletLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={HEAD}>{t("common.loading")}</div>
      </main>
    );
  }

  /* ── HARD BLOCK: phase gate ── */
  if (competitionPhase !== "submission_open") {
    const phaseMessage =
      competitionPhase === "judging" ? t("csub.closedJudging") :
      competitionPhase === "result" ? t("csub.closedResult") :
      t("csub.notOpenYet");
    const PhaseIcon = competitionPhase === "judging" ? Clock : competitionPhase === "result" ? Trophy : Ban;

    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto py-10 md:py-20 max-w-2xl">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-px bg-primary" />
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={HEAD}>{t("csub.submitEntry")}</span>
          </div>
          <h1 className="text-xl md:text-4xl font-light tracking-tight mb-8" style={DISPLAY}>{compTitle}</h1>
          <div className="border-2 border-destructive/30 bg-destructive/5 p-6 md:p-10 text-center space-y-4">
            <PhaseIcon className="h-10 w-10 text-destructive/60 mx-auto" />
            <p className="text-sm font-medium text-destructive" style={HEAD}>{phaseMessage}</p>
            <p className="text-xs text-muted-foreground" style={BODY}>{t("csub.cannotSubmitNow")}</p>
            <Link
              to={`/competitions/${slugOrId}`}
              className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-border hover:border-primary hover:text-primary transition-all duration-500 mt-2"
              style={HEAD}
            >
              {t("csub.backToComp")}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const anyAiSelected = photos.some((p) => p.is_ai_generated);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-20 max-w-2xl">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-12 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={HEAD}>{t("csub.submitEntry")}</span>
        </div>
        <h1 className="text-xl md:text-4xl font-light tracking-tight mb-2" style={DISPLAY}>{compTitle}</h1>
        <p className="text-[11px] text-muted-foreground mb-6 md:mb-12" style={BODY}>
          {t("csub.intro")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-6 md:space-y-8">
          {/* Photos — per-photo accordion (the entire form is now per-photo) */}
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-3" style={HEAD}>
              {t("csub.photosLabel")} * ({photos.length}/{maxPhotos}) — {t("csub.oneCardPerImage")}
            </label>

            <div className="space-y-3">
              {photos.map((photo, i) => {
                const summary = summarizeExif(photo.exif);
                return (
                  <div key={photo.url} className="border border-border bg-card/30">
                    {/* Card header (always visible) */}
                    <div className="flex items-stretch gap-3 p-3">
                      <img
                        loading="lazy"
                        decoding="async"
                        src={photo.thumbnailUrl || photo.url}
                        alt={photo.title || `Photo ${i + 1}`}
                        className="w-20 h-20 object-cover border border-border shrink-0"
                      />
                      <div className="flex-1 min-w-0 flex flex-col">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={HEAD}>
                            {t("csub.photo")} {i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removePhoto(i)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            aria-label="Remove photo"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Title shown inline (this is the photo's identity) */}
                        <span className="text-xs font-medium text-foreground truncate" style={BODY}>
                          {photo.title || <span className="text-amber-500">{t("csub.titleRequired")}</span>}
                        </span>

                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {photo.exif_available ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500" style={BODY}>
                              <CheckCircle2 className="h-3 w-3" /> EXIF
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-500" style={BODY}>
                              <FileWarning className="h-3 w-3" /> No EXIF
                            </span>
                          )}
                          {photo.is_ai_generated && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-purple-400" style={BODY}>
                              <Sparkles className="h-3 w-3" /> AI
                            </span>
                          )}
                          {photo.description.trim() && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-primary/80" style={BODY}>
                              <MessageSquarePlus className="h-3 w-3" /> Description
                            </span>
                          )}
                          {summary && (
                            <span className="text-[10px] text-muted-foreground truncate" style={BODY}>{summary}</span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => updatePhoto(i, { expanded: !photo.expanded })}
                          className="mt-auto self-start inline-flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase text-primary hover:opacity-70 transition-opacity"
                          style={HEAD}
                        >
                          <ChevronDown className={`h-3 w-3 transition-transform ${photo.expanded ? "rotate-180" : ""}`} />
                          {photo.expanded ? t("csub.hideDetails") : t("csub.editPhoto")}
                        </button>
                      </div>
                    </div>

                    {/* Expanded body */}
                    {photo.expanded && (
                      <div className="border-t border-border p-4 space-y-4 bg-muted/10">
                        {/* Photo title — REQUIRED */}
                        <div>
                          <label className="block text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1" style={HEAD}>
                            {t("csub.photoTitle")}
                          </label>
                          <input
                            type="text"
                            value={photo.title}
                            onChange={(e) => updatePhoto(i, { title: e.target.value })}
                            maxLength={120}
                            required
                            className="w-full bg-transparent border border-border focus:border-primary outline-none px-3 py-2 text-xs"
                            placeholder={t("csub.phNamePhoto")}
                            style={BODY}
                          />
                          <p className="text-[9px] text-muted-foreground mt-1" style={BODY}>
                            {photo.title.length}/120
                          </p>
                        </div>

                        {/* Description — OPTIONAL, collapsed checkbox */}
                        <div>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={photo.description_open}
                              onChange={(e) => updatePhoto(i, {
                                description_open: e.target.checked,
                                description: e.target.checked ? photo.description : "",
                              })}
                              className="h-3.5 w-3.5 accent-primary"
                            />
                            <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={HEAD}>
                              {t("csub.addDescription")}
                            </span>
                          </label>
                          {photo.description_open && (
                            <div className="mt-2">
                              <textarea
                                value={photo.description}
                                onChange={(e) => updatePhoto(i, { description: e.target.value })}
                                maxLength={500}
                                rows={3}
                                className="w-full bg-transparent border border-border focus:border-primary outline-none p-3 text-xs resize-none"
                                placeholder={t("csub.phStory")}
                                style={BODY}
                              />
                              <p className="text-[9px] text-muted-foreground mt-1" style={BODY}>
                                {photo.description.length}/500
                              </p>
                            </div>
                          )}
                        </div>

                        {/* AI-generated checkbox — per-photo */}
                        <div className={`p-3 border ${!aiImagesAllowed && photo.is_ai_generated ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/20"}`}>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={photo.is_ai_generated}
                              onChange={(e) => updatePhoto(i, { is_ai_generated: e.target.checked })}
                              className="h-3.5 w-3.5 accent-primary mt-0.5"
                            />
                            <span>
                              <span className="text-[11px] font-medium block flex items-center gap-1.5" style={HEAD}>
                                <Sparkles className="h-3 w-3 text-purple-400" />
                                {t("csub.isAiImage")}
                              </span>
                              <span className="text-[9px] text-muted-foreground" style={BODY}>
                                {t("csub.isAiHint")}
                              </span>
                            </span>
                          </label>
                          {!aiImagesAllowed && photo.is_ai_generated && (
                            <div className="text-[10px] text-destructive font-medium mt-2 pl-6" style={HEAD}>
                              {t("csub.aiNotAllowedWarn")}
                            </div>
                          )}
                        </div>

                        {/* EXIF section */}
                        <div className="flex items-center gap-2 pt-2">
                          <Camera className="h-3.5 w-3.5 text-primary" />
                          <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={HEAD}>{t("csub.exifMetadata")}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <ExifField label={t("csub.exifCamera")} placeholder="Canon EOS R5" value={photo.exif.camera ?? ""} onChange={(v) => updateExif(i, "camera", v)} />
                          <ExifField label={t("csub.exifLens")} placeholder="24-70mm f/2.8" value={photo.exif.lens ?? ""} onChange={(v) => updateExif(i, "lens", v)} />
                          <ExifField label={t("csub.exifIso")} placeholder="400" type="number" value={photo.exif.iso?.toString() ?? ""} onChange={(v) => updateExif(i, "iso", v)} />
                          <ExifField label={t("csub.exifAperture")} placeholder="2.8" type="number" value={photo.exif.aperture?.toString() ?? ""} onChange={(v) => updateExif(i, "aperture", v)} />
                          <ExifField label={t("csub.exifShutter")} placeholder="0.004" type="number" value={photo.exif.shutter_speed?.toString() ?? ""} onChange={(v) => updateExif(i, "shutter_speed", v)} />
                          <ExifField label={t("csub.exifFocal")} placeholder="50" type="number" value={photo.exif.focal_length?.toString() ?? ""} onChange={(v) => updateExif(i, "focal_length", v)} />
                          <div className="col-span-2">
                            <ExifField label={t("csub.exifDate")} type="date" value={photo.exif.date_taken ? photo.exif.date_taken.slice(0, 10) : ""} onChange={(v) => updateExif(i, "date_taken", v)} />
                          </div>
                        </div>

                        {/* RAW-on-request commitment (per-photo) */}
                        <label className="flex items-start gap-3 pt-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={photo.raw_required}
                            onChange={(e) => updatePhoto(i, { raw_required: e.target.checked })}
                            className="h-4 w-4 accent-primary mt-0.5"
                          />
                          <span>
                            <span className="text-xs font-medium block" style={HEAD}>
                              {t("csub.rawCommit")}
                            </span>
                            <span className="text-[10px] text-muted-foreground" style={BODY}>
                              {t("csub.rawHint")}
                            </span>
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}

              {photos.length < maxPhotos && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full border border-dashed border-border hover:border-primary/50 py-6 flex flex-col items-center justify-center gap-2 transition-colors duration-500 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={HEAD}>{t("csub.addPhoto")}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <p className="text-[10px] text-muted-foreground mt-2" style={BODY}>
              {t("csub.uploadNote")}
            </p>
          </div>

          {/* Entry fee */}
          {entryFee > 0 && (
            <div className="p-4 border border-border bg-muted/30 space-y-2">
              <p className="text-xs" style={HEAD}>{t("csub.entryFeeLabel")} <strong>{formatUSDFixed(entryFee)}</strong></p>
              <p className="text-xs text-muted-foreground" style={BODY}>
                {t("csub.walletBalance")} {formatUSDFixed(Number(balance))}
                {balance < entryFee && <> — <Link to="/wallet" className="text-primary underline">{t("csub.addFunds")}</Link></>}
              </p>
            </div>
          )}

          {/* Ownership disclaimer */}
          <div className="p-4 border border-border bg-muted/20">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ownershipDisclaimer}
                onChange={(e) => setOwnershipDisclaimer(e.target.checked)}
                className="h-4 w-4 accent-primary mt-0.5"
              />
              <span>
                <span className="text-xs font-medium block" style={HEAD}>
                  <ShieldCheck className="h-3.5 w-3.5 inline mr-1" />
                  {t("csub.ownershipTitle")}
                </span>
                <span className="text-[10px] text-muted-foreground" style={BODY}>
                  {t("csub.ownershipHint")}
                </span>
              </span>
            </label>
          </div>

          {/* Submit */}
          <div className="pt-4 border-t border-border">
            <button
              type="submit"
              disabled={
                submitting ||
                photos.length === 0 ||
                !ownershipDisclaimer ||
                (entryFee > 0 && balance < entryFee) ||
                (!aiImagesAllowed && anyAiSelected)
              }
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
              style={HEAD}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {entryFee > 0 ? `${t("csub.pay")} ${formatUSDFixed(entryFee)} ${t("csub.andSubmit")}` : t("csub.submitEntry")}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
};

/* ── Small EXIF input field ── */
function ExifField({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "date";
}) {
  return (
    <div>
      <label className="block text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1" style={HEAD}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        step="any"
        className="w-full bg-transparent border border-border focus:border-primary outline-none px-3 py-2 text-xs transition-colors duration-500"
        style={BODY}
      />
    </div>
  );
}

export default CompetitionSubmit;
