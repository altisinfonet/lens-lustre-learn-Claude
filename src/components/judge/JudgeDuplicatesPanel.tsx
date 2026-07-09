/**
 * P4 Judge — Duplicate Report panel.
 * Surfaces clusters of (entry, photo_index) pairs that share an exact SHA-256
 * hash or a perceptually-similar pHash within the active competition.
 *
 * Hard policy: 'exact' = byte-identical re-upload, 'similar' = pHash hamming ≤6.
 * Click a row to jump to the offending photo in CinemaFullView.
 */
import { useMemo } from "react";
import { motion } from "framer-motion";
import { Copy, AlertTriangle, Loader2, ShieldCheck, ImageOff } from "lucide-react";
import { useCompetitionDuplicateClusters, type DuplicateClusterRow } from "@/hooks/judging/useJudgeIntegrityData";

const HEAD = { fontFamily: "var(--font-heading)" } as const;

interface Props {
  competitionId: string | null;
  onJump?: (entryId: string, photoIndex: number) => void;
}

export const JudgeDuplicatesPanel = ({ competitionId, onJump }: Props) => {
  const { data, isLoading, error } = useCompetitionDuplicateClusters(competitionId);

  // Group raw pair-rows into unique clusters keyed by cluster_key.
  const clusters = useMemo(() => {
    if (!data) return [] as Array<{ key: string; match_type: "exact" | "similar"; rows: DuplicateClusterRow[] }>;
    const map = new Map<string, { key: string; match_type: "exact" | "similar"; rows: DuplicateClusterRow[] }>();
    for (const row of data) {
      const k = `${row.match_type}:${row.cluster_key}`;
      if (!map.has(k)) map.set(k, { key: k, match_type: row.match_type, rows: [] });
      const cluster = map.get(k)!;
      const dupId = `${row.entry_id}-${row.photo_index}`;
      if (!cluster.rows.some((r) => `${r.entry_id}-${r.photo_index}` === dupId)) {
        cluster.rows.push(row);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.match_type === b.match_type ? 0 : a.match_type === "exact" ? -1 : 1,
    );
  }, [data]);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold tracking-[0.25em] uppercase text-muted-foreground/70" style={HEAD}>
          Duplicate Report
        </h3>
        {clusters.length > 0 && (
          <span className="text-[9px] font-bold text-destructive bg-destructive/10 border border-destructive/30 rounded-full px-2 py-0.5" style={HEAD}>
            {clusters.length} cluster{clusters.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
        Photos with identical bytes (exact) or perceptually similar appearance (similar, hamming ≤ 6) within this competition.
      </p>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-[10px] text-destructive">{(error as Error).message}</p>
        </div>
      )}

      {clusters.length === 0 && !isLoading && !error && (
        <div className="text-center py-10">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
          <p className="text-[10px] text-muted-foreground/50">No duplicates detected.</p>
        </div>
      )}

      <div className="space-y-3">
        {clusters.map((cluster, ci) => {
          const isExact = cluster.match_type === "exact";
          return (
            <motion.div
              key={cluster.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ci * 0.04 }}
              className={`rounded-lg border p-2 space-y-2 ${
                isExact ? "bg-destructive/5 border-destructive/30" : "bg-amber-500/5 border-amber-500/30"
              }`}
            >
              <div className="flex items-center gap-2 px-1">
                {isExact ? (
                  <Copy className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider ${
                    isExact ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                  }`}
                  style={HEAD}
                >
                  {isExact ? "Exact match (SHA-256)" : "Similar (pHash)"}
                </span>
                <span className="text-[8px] text-muted-foreground/50 ml-auto">{cluster.rows.length} photos</span>
              </div>
              <div className="space-y-1">
                {cluster.rows.map((row) => (
                  <button
                    key={`${row.entry_id}-${row.photo_index}`}
                    onClick={() => onJump?.(row.entry_id, row.photo_index)}
                    className="w-full text-left flex gap-2 p-1.5 rounded bg-card/50 border border-border/30 hover:border-primary/40 hover:bg-primary/5 transition-all"
                  >
                    {row.thumbnail_url ? (
                      <img
                        src={row.thumbnail_url}
                        alt=""
                        loading="lazy"
                        className="w-10 h-10 rounded object-cover shrink-0 border border-border/40"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-muted/20 shrink-0 flex items-center justify-center">
                        <ImageOff className="h-3 w-3 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-foreground truncate" style={HEAD}>
                        {row.entry_title}
                      </p>
                      <p className="text-[9px] text-muted-foreground/50">
                        Photo {row.photo_index + 1}
                        {!isExact && row.hamming_distance != null && (
                          <span className="ml-1.5">· dist {row.hamming_distance}</span>
                        )}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
