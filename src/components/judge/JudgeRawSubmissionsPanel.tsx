/**
 * P4 Judge — RAW Submissions panel.
 * Lists every photo flagged `raw_required` in the active competition with its
 * commitment + delivery + verification state pulled from the immutable
 * raw_commitments ledger.
 *
 * Read-only by design: judges audit, admins verify (admin verification UI is
 * a future step — Phase-4.B). No editing happens here.
 */
import { motion } from "framer-motion";
import { FileWarning, ShieldCheck, Clock, ImageOff, AlertCircle, Loader2 } from "lucide-react";
import { useCompetitionRawCommitments } from "@/hooks/judging/useJudgeIntegrityData";
import { useT } from "@/i18n/I18nContext";

const HEAD = { fontFamily: "var(--font-heading)" } as const;

interface Props {
  competitionId: string | null;
  onJump?: (entryId: string, photoIndex: number) => void;
}

export const JudgeRawSubmissionsPanel = ({ competitionId, onJump }: Props) => {
  const t = useT();
  const { data, isLoading, error } = useCompetitionRawCommitments(competitionId);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold tracking-[0.25em] uppercase text-muted-foreground/70" style={HEAD}>
          {t("jg.rawSubmissions")}
        </h3>
        {data && data.length > 0 && (
          <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5" style={HEAD}>
            {data.length} flagged
          </span>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
        {t("jg.rawDesc")}
      </p>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-[10px] text-destructive">{(error as Error).message}</p>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="text-center py-10">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
          <p className="text-[10px] text-muted-foreground/50">No RAW commitments — every entry has full EXIF.</p>
        </div>
      )}

      <div className="space-y-2">
        {data?.map((row, i) => {
          const verified = !!row.admin_verified_at;
          const delivered = !!row.raw_delivered_at;
          const status = verified ? "verified" : delivered ? "delivered" : "pending";
          const statusClass =
            status === "verified"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
              : status === "delivered"
              ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";

          return (
            <motion.button
              key={`${row.entry_id}-${row.photo_index}`}
              onClick={() => onJump?.(row.entry_id, row.photo_index)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="w-full text-left flex gap-3 p-2 rounded-lg bg-muted/5 border border-border/30 hover:border-primary/40 hover:bg-primary/5 transition-all group"
            >
              {row.thumbnail_url ? (
                <img
                  src={row.thumbnail_url}
                  alt=""
                  loading="lazy"
                  className="w-14 h-14 rounded object-cover shrink-0 border border-border/40"
                />
              ) : (
                <div className="w-14 h-14 rounded bg-muted/20 shrink-0 flex items-center justify-center">
                  <ImageOff className="h-4 w-4 text-muted-foreground/30" />
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold text-foreground truncate" style={HEAD}>
                    {row.photo_title || row.entry_title}
                  </p>
                  <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusClass}`} style={HEAD}>
                    {status}
                  </span>
                </div>
                <p className="text-[9px] text-muted-foreground/60 truncate">
                  Entry · {row.entry_title} · photo {row.photo_index + 1}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-muted-foreground/50">
                  {row.committed_at && (
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(row.committed_at).toLocaleDateString()}
                    </span>
                  )}
                  {row.source && (
                    <span className="px-1 py-0.5 rounded bg-muted/30 text-[8px] uppercase tracking-wider" style={HEAD}>
                      {row.source}
                    </span>
                  )}
                  {!row.exif_available && (
                    <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                      <FileWarning className="h-2.5 w-2.5" />
                      {t("jg.exifMissing")}
                    </span>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
