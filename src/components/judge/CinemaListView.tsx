import { memo, useRef, useState, useEffect, useCallback } from "react";
import { Camera, CheckSquare, Square, BookmarkCheck, Bookmark } from "lucide-react";
import ConflictBadge from "@/components/judge/ConflictBadge";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import JudgingStampBadge from "@/components/JudgingStampBadge";
import { getJudgePhotoTitle, type FlatPhoto, type JudgingTag, type PhotoScoreData, type PhotoTagData } from "@/hooks/judging/types";

const SCORE_BG_STYLE: Record<number, React.CSSProperties> = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => [i, { backgroundColor: `hsl(var(--score-${i}))` }])
);

interface CinemaListViewProps {
  filteredPhotos: FlatPhoto[];
  getPhotoKey: (p: FlatPhoto) => string;
  photoScoresMap: Record<string, PhotoScoreData>;
  photoTagsMap: Record<string, PhotoTagData>;
  photoDecisionsMap?: Record<string, { myDecision: string | null }>;
  availableTags: JudgingTag[];
  bulkMode: boolean;
  bulkSelected: Set<string>;
  toggleBulkSelect: (key: string) => void;
  setSelectedPhotoKey: (key: string | null) => void;
  setMobileTab: (tab: "comps" | "photos" | "judge") => void;
  StatusBadge: React.ComponentType<{ status: string }>;
  isRoundLocked?: boolean;
  /** Step 20: canonical phase for the active competition (from CinemaJudgeView). */
  competitionPhase?: string;
  /** Step 20: active judging round ("1"|"2"|"3"|"4"|null). */
  competitionCurrentRound?: string | null;
  /** Active round number (1-4). Used to filter tags via `visible_in_round`, mirroring grid view. */
  roundNumber?: number;
  /** Bookmarked entry id — paired with bookmarkedPhotoIndex for per-photo highlight. */
  bookmarkedEntryId?: string | null;
  /** Bookmarked photo index — only the (entryId, photoIndex) pair gets the amber ring. */
  bookmarkedPhotoIndex?: number | null;
  /** Toggle bookmark for a (entry, photo) without opening Cinema (hover icon). */
  onToggleBookmark?: (entryId: string, photoIndex: number) => void;
}

/** Page size for progressive loading */
const PAGE_SIZE = 50;

const CinemaListView = memo(({
  filteredPhotos, getPhotoKey, photoScoresMap, photoTagsMap, photoDecisionsMap, availableTags,
  bulkMode, bulkSelected, toggleBulkSelect, setSelectedPhotoKey, setMobileTab,
  StatusBadge, isRoundLocked, competitionPhase, competitionCurrentRound, roundNumber,
  bookmarkedEntryId, bookmarkedPhotoIndex, onToggleBookmark,
}: CinemaListViewProps) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset visible count when filter changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filteredPhotos.length]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (visibleCount >= filteredPhotos.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filteredPhotos.length));
      }
    }, { rootMargin: "200px" });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [visibleCount, filteredPhotos.length]);

  const visiblePhotos = filteredPhotos.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-2">
      {visiblePhotos.map((photo) => {
        const key = getPhotoKey(photo);
        const scoreData = photoScoresMap[key];
        const tagData = photoTagsMap[key];
        const myScore = scoreData?.myScore ?? null;
        const hasScore = myScore !== null;
        const myTags = tagData?.myTags ?? [];
        const isBulkSelected = bulkSelected.has(key);
        const isBookmarked = !!bookmarkedEntryId && photo.entryId === bookmarkedEntryId && (bookmarkedPhotoIndex ?? 0) === (photo.photoIndex ?? 0);
        const photoTitle = getJudgePhotoTitle(photo);

        const getCardBorder = () => {
          if (isBulkSelected) return "ring-2 ring-primary/50 border-primary";
          if (isBookmarked) return "ring-2 ring-amber-400/70 border-amber-400/60";
          if (myScore === 0) return "border-destructive/30";
          if (hasScore && myScore! >= 7) return "border-primary/30";
          if (hasScore) return "border-primary/20";
          return "border-border";
        };

        return (
          <div
            key={key}
            data-photo-key={key}
            onClick={() => { if (bulkMode) toggleBulkSelect(key); else { setSelectedPhotoKey(key); setMobileTab("judge"); } }}
            role="button"
            tabIndex={0}
            aria-label={`Photo: ${photoTitle}${myScore !== null ? `, scored ${myScore}` : ""}${isBookmarked ? ", bookmarked" : ""}`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (bulkMode) toggleBulkSelect(key); else setSelectedPhotoKey(key); } }}
            className={`group cursor-pointer flex items-center gap-4 rounded-xl border transition-all duration-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${getCardBorder()} bg-card px-3 py-2`}
          >
            {bulkMode && (
              <div className="shrink-0">
                {isBulkSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground/40" />}
              </div>
            )}
            <div className="w-16 h-12 rounded-lg overflow-hidden shrink-0 relative">
              {/* SOW v2.1 Step 5: list thumb uses lightweight variant. */}
              {photo.photoThumbUrl ? (
                <img src={photo.photoThumbUrl} alt={photoTitle} className="w-full h-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <div className="w-full h-full bg-muted/10 flex items-center justify-center">
                  <Camera className="h-4 w-4 text-muted-foreground/20" />
                </div>
              )}
              {/* Step 20: Judging watermark (only renders when phase==="judging"). */}
              {competitionPhase && (
                <PhaseWatermark
                  phase={competitionPhase}
                  currentRound={competitionCurrentRound ?? null}
                  surface="cinema"
                />
              )}
              {isBookmarked && (
                <div
                  className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-amber-400 text-background flex items-center justify-center shadow-md ring-1 ring-background"
                  title="Bookmarked — resume here"
                  aria-label="Bookmarked"
                >
                  <BookmarkCheck className="h-3 w-3" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-foreground truncate" style={{ fontFamily: "var(--font-heading)" }}>
                  {photoTitle}
                </span>
                <StatusBadge status={photoDecisionsMap?.[`${photo.entryId}::${photo.photoIndex}`]?.myDecision || "submitted"} />
              </div>
              <span className="text-[10px] text-muted-foreground/50 truncate block" style={{ fontFamily: "var(--font-heading)" }}>
                {photo.entry.photographer_name || "Unknown"}
              </span>
            </div>
            {(() => {
              // Mirror grid view: filter tags by `visible_in_round` so prior-round
              // qualifier tags don't leak into the next round's list.
              const visibleTags = myTags
                .map((tagId) => availableTags.find((t) => t.id === tagId))
                .filter((tag): tag is JudgingTag => {
                  if (!tag) return false;
                  if (roundNumber == null) return true;
                  const vis = tag.visible_in_round;
                  if (!vis || vis.length === 0) return true;
                  return vis.includes(roundNumber);
                });
              if (visibleTags.length === 0) return null;
              return (
                <div className="hidden sm:flex items-center gap-1 shrink-0 max-w-[40%] flex-wrap justify-end">
                  {visibleTags.map((tag) => (
                    <JudgingStampBadge
                      key={tag.id}
                      label={tag.label}
                      color={tag.color}
                      icon={tag.icon || "award"}
                      imageUrl={tag.image_url}
                      size="sm"
                    />
                  ))}
                </div>
              );
            })()}
            <div className="shrink-0 flex items-center gap-2">
              {onToggleBookmark && !bulkMode && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleBookmark(photo.entryId, photo.photoIndex); }}
                  className={`hidden md:flex w-7 h-7 items-center justify-center rounded-full transition-all ${
                    isBookmarked
                      ? "bg-amber-400 text-background opacity-100"
                      : "opacity-0 group-hover:opacity-100 bg-background/85 text-foreground hover:bg-amber-400 hover:text-background ring-1 ring-border"
                  }`}
                  aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this photo"}
                  title={isBookmarked ? "Remove bookmark" : "Bookmark"}
                >
                  {isBookmarked ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                </button>
              )}
              {scoreData?.allScores && scoreData.allScores.length >= 2 && (
                <ConflictBadge scores={scoreData.allScores} />
              )}
              {hasScore ? (
                <div className="w-8 h-8 rounded-full text-primary-foreground flex items-center justify-center text-[11px] font-bold" style={SCORE_BG_STYLE[Math.min(10, Math.max(0, Math.round(myScore!)))]}>
                  {myScore}
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full border-2 border-dashed border-muted-foreground/20 flex items-center justify-center text-[9px] text-muted-foreground/30">—</div>
              )}
            </div>
          </div>
        );
      })}
      {visibleCount < filteredPhotos.length && (
        <div ref={sentinelRef} className="h-10 flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground/40" style={{ fontFamily: "var(--font-heading)" }}>
            Loading more… ({visibleCount} of {filteredPhotos.length})
          </span>
        </div>
      )}
    </div>
  );
});

CinemaListView.displayName = "CinemaListView";
export default CinemaListView;
