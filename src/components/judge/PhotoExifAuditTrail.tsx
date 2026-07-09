/**
 * P4 Judge — EXIF + RAW commitment audit trail (read-only).
 * Renders inside the existing EXIF panel of CinemaFullView for the active
 * (entry_id, photo_index). Surfaces:
 *   - Current image_hash fingerprints (SHA-256 + pHash) from photo_meta[i].image_hash
 *   - Full chronological raw_commitments timeline (submit → admin_request → delivery → verified → revoked)
 *
 * Source data:
 *   - photo_meta passed from the caller (already in memory, no extra fetch)
 *   - raw_commitments rows via usePhotoExifAudit (RLS-gated)
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Clock, FileWarning, Hash, ChevronDown, ChevronRight, Loader2, AlertCircle, CheckCircle2, Ban, Send } from "lucide-react";
import { usePhotoExifAudit, type RawCommitmentEvent } from "@/hooks/judging/usePhotoExifAudit";

const HEAD = { fontFamily: "var(--font-heading)" } as const;

interface Props {
  entryId: string;
  photoIndex: number;
  photoMeta: any | null;
}

const SOURCE_META: Record<RawCommitmentEvent["source"], { label: string; icon: typeof Clock; cls: string }> = {
  submit:        { label: "Committed at submit",  icon: Send,         cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30" },
  admin_request: { label: "Admin requested RAW",  icon: FileWarning,  cls: "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/30" },
  delivery:      { label: "RAW delivered",        icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  revoked:       { label: "Commitment revoked",   icon: Ban,          cls: "text-muted-foreground bg-muted/20 border-border/40" },
};

const truncateHash = (h: string) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h);

export const PhotoExifAuditTrail = ({ entryId, photoIndex, photoMeta }: Props) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = usePhotoExifAudit(open ? entryId : null, open ? photoIndex : null);

  const hash = photoMeta?.image_hash || null;
  const sha256: string | null = typeof hash?.sha256 === "string" ? hash.sha256 : null;
  const phash: string | null = typeof hash?.phash === "string" ? hash.phash : null;
  const exifAvailable = Boolean(photoMeta?.exif_available);

  return (
    <div className="mt-4 pt-4 border-t border-border/30">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left group focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none rounded"
      >
        <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-[0.25em] uppercase text-muted-foreground/60 group-hover:text-muted-foreground/90 transition-colors" style={HEAD}>
          <ShieldCheck className="h-3 w-3" />
          Audit Trail
        </span>
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground/40" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="audit"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-3 space-y-3">
              {/* Fingerprint block */}
              <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
                <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-muted-foreground/60 flex items-center gap-1" style={HEAD}>
                  <Hash className="h-3 w-3" /> Fingerprints
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-muted-foreground/50" style={HEAD}>SHA-256</span>
                    <code className="text-[9px] font-mono text-foreground/80 truncate" title={sha256 ?? "not captured"}>
                      {sha256 ? truncateHash(sha256) : "—"}
                    </code>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-muted-foreground/50" style={HEAD}>pHash</span>
                    <code className="text-[9px] font-mono text-foreground/80 truncate" title={phash ?? "not captured"}>
                      {phash ? truncateHash(phash) : "—"}
                    </code>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-muted-foreground/50" style={HEAD}>EXIF status</span>
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${exifAvailable ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} style={HEAD}>
                      {exifAvailable ? "Available" : "Missing — RAW required"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="space-y-2">
                <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-muted-foreground/60 flex items-center gap-1" style={HEAD}>
                  <Clock className="h-3 w-3" /> RAW Commitment Timeline
                </p>

                {isLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/5 border border-destructive/20">
                    <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                    <p className="text-[9px] text-destructive">{(error as Error).message}</p>
                  </div>
                )}

                {!isLoading && !error && data && data.length === 0 && (
                  <p className="text-[9px] text-muted-foreground/40 italic py-2">
                    No RAW commitments recorded for this photo.
                  </p>
                )}

                {!isLoading && data && data.length > 0 && (
                  <ol className="relative border-l border-border/40 pl-3 space-y-2.5 ml-1">
                    {data.map((evt, i) => {
                      const meta = SOURCE_META[evt.source] ?? SOURCE_META.submit;
                      const Icon = meta.icon;
                      return (
                        <motion.li
                          key={evt.id}
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="relative"
                        >
                          <span className="absolute -left-[14px] top-1 h-2 w-2 rounded-full bg-primary/60 ring-2 ring-background" />
                          <div className={`rounded-md border px-2 py-1.5 ${meta.cls}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider" style={HEAD}>
                                <Icon className="h-2.5 w-2.5" />
                                {meta.label}
                              </span>
                              <span className="text-[9px] tabular-nums opacity-80">
                                {new Date(evt.committed_at).toLocaleString()}
                              </span>
                            </div>
                            {evt.raw_delivered_at && (
                              <p className="text-[9px] mt-0.5 opacity-90">
                                Delivered {new Date(evt.raw_delivered_at).toLocaleString()}
                              </p>
                            )}
                            {evt.admin_verified_at && (
                              <p className="text-[9px] mt-0.5 opacity-90 inline-flex items-center gap-1">
                                <ShieldCheck className="h-2.5 w-2.5" />
                                Admin verified {new Date(evt.admin_verified_at).toLocaleString()}
                              </p>
                            )}
                            {evt.notes && (
                              <p className="text-[9px] mt-0.5 opacity-80 italic">"{evt.notes}"</p>
                            )}
                          </div>
                        </motion.li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
