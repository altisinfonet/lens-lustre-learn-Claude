import { memo, useMemo, useRef, useEffect, useState, useCallback } from "react";
import { Camera, CheckSquare, Square, BookmarkCheck, Bookmark, AlertTriangle } from "lucide-react";
import JudgingStampBadge from "@/components/JudgingStampBadge";
import ConflictBadge from "@/components/judge/ConflictBadge";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import { useInfiniteScroll } from "@/hooks/core/useInfiniteScroll";
import { getJudgePhotoTitle, type FlatPhoto, type JudgingTag, type PhotoScoreData, type PhotoTagData } from "@/hooks/judging/types";
import { useSaveError, useUnjudgedEntry, useIncompletePhoto } from "@/lib/judging/saveErrorStore";

/** Score colors using CSS custom properties from index.css (--score-0 through --score-10) */
const SCORE_BG_STYLE: Record<number, React.CSSProperties> = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => [i, { backgroundColor: `hsl(var(--score-${i}))` }])
);

interface VirtualizedPhotoGridProps {
  photos: FlatPhoto[];
  getPhotoKey: (p: FlatPhoto) => string;
  photoScoresMap: Record<string, PhotoScoreData>;
  photoTagsMap: Record<string, PhotoTagData>;
  photoDecisionsMap?: Record<string, { myDecision: string | null; allDecisions: { judge_id: string; decision: string; round_number: number }[] }>;
  availableTags: JudgingTag[];
  bulkMode: boolean;
  bulkSelected: Set<string>;
  onPhotoClick: (key: string) => void;
  onBulkToggle: (key: string) => void;
  StatusBadge: React.ComponentType<{ status: string }>;
  /** Number of CSS grid columns */
  columnCount: number;
  isRoundLocked?: boolean;
  roundNumber?: number;
  /** Step 20: canonical competition phase for every photo in this grid.
   *  Sourced from the parent (CinemaJudgeView via useJudgeCompetitions) — never
   *  derived locally. <PhaseWatermark/> only renders when phase==="judging". */
  competitionPhase?: string;
  /** Step 20: matching judging round string ("1"|"2"|"3"|"4"|null). */
  competitionCurrentRound?: string | null;
  /** Bookmarked entry id — paired with bookmarkedPhotoIndex for per-photo highlight. */
  bookmarkedEntryId?: string | null;
  /** Bookmarked photo index — only the (entryId, photoIndex) pair gets the amber ring + pin. */
  bookmarkedPhotoIndex?: number | null;
  /** Toggle bookmark for a (entry, photo) from a thumbnail (hover icon, no Cinema open). */
  onToggleBookmark?: (entryId: string, photoIndex: number) => void;
  /** The last-viewed photo key (set when judge exits Full View). When set, the
   *  matching cell is auto-scrolled into view + emits a one-shot glow-pulse so
   *  judges can immediately spot where they left off and bookmark if needed. */
  lastViewedPhotoKey?: string | null;
  /** Step 14: optional infinite-scroll wiring. When provided, a sentinel is
   *  placed at the 3rd-to-last row (or first row if total < 3) and triggers
   *  `onLoadMore` as it enters the viewport. */
  onLoadMore?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
}

/** Virtualization threshold — below this, render normally */
const VIRTUALIZE_THRESHOLD = 200;
/** How many rows to render beyond viewport */
const OVERSCAN = 5;
/** Row height = column width * (3/4) for aspect-ratio 4:3 */

const PhotoCell = memo(({
  photo, photoKey, scoreData, tagData, availableTags, bulkMode, isBulkSelected,
  onPhotoClick, onBulkToggle, StatusBadge, isRoundLocked, myDecision, roundNumber,
  competitionPhase, competitionCurrentRound, isBookmarked, onToggleBookmark, isJustViewed,
}: {
  photo: FlatPhoto;
  photoKey: string;
  scoreData: PhotoScoreData | undefined;
  tagData: PhotoTagData | undefined;
  availableTags: JudgingTag[];
  bulkMode: boolean;
  isBulkSelected: boolean;
  onPhotoClick: (key: string) => void;
  onBulkToggle: (key: string) => void;
  StatusBadge: React.ComponentType<{ status: string }>;
  isRoundLocked?: boolean;
  myDecision?: string | null;
  roundNumber?: number;
  competitionPhase?: string;
  competitionCurrentRound?: string | null;
  isBookmarked?: boolean;
  onToggleBookmark?: (entryId: string, photoIndex: number) => void;
  /** True when this is the photo the judge just exited Full View on — drives
   *  the auto-scroll + one-shot glow-pulse so the judge spots it instantly. */
  isJustViewed?: boolean;
}) => {
  const myScore = scoreData?.myScore ?? null;
  const hasScore = myScore !== null;
  const myTags = tagData?.myTags ?? [];
  // PER-PHOTO RULE: status is strictly the judge's per-photo decision. Never fall back
  // to entry.status (entry-level aggregation would mislabel unjudged photos of partially-judged entries).
  const displayStatus = myDecision || "submitted";
  const photoTitle = getJudgePhotoTitle(photo);
  // Save-error highlight: if the last score/tag/comment/feedback save for this
  // (entry, photo) failed, paint a red destructive ring + corner badge with
  // the reason. Cleared automatically on next successful save for the slot.
  const saveError = useSaveError(photo.entryId, photo.photoIndex);
  // BUG-2: backend flagged this entry as blocking Complete Round. Paint an
  // amber pulsing ring + bottom badge so the judge sees the exact cards.
  const unjudgedFlag = useUnjudgedEntry(photo.entryId);
  // Fix C: per-photo "missing criteria" flag — takes precedence over the
  // whole-entry flag so novice judges see the EXACT criteria still to fill.
  const incompletePhoto = useIncompletePhoto(photo.entryId, photo.photoIndex);

  // Auto-scroll into view + brief glow when this is the just-exited photo.
  const cellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isJustViewed || !cellRef.current) return;
    cellRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [isJustViewed]);

  const statusBorder = displayStatus === "accept" || displayStatus === "accepted" || displayStatus === "approved" || displayStatus === "round1_qualified" ? "border-primary/60"
    : displayStatus === "reject" || displayStatus === "rejected" ? "border-destructive/60"
    : displayStatus === "shortlist" || displayStatus === "shortlisted" ? "border-primary/60"
    : displayStatus === "needs_review" ? "border-amber-500/60"
    : "border-transparent";

  const incompleteMsg = incompletePhoto
    ? `Fill: ${incompletePhoto.missingCriteriaLabels.join(", ")}`
    : null;

  return (
    <div
      ref={cellRef}
      data-photo-key={photoKey}
      onClick={() => bulkMode ? onBulkToggle(photoKey) : onPhotoClick(photoKey)}
      title={
        saveError ? `⚠ Save failed (${saveError.kind}): ${saveError.message}`
        : incompletePhoto ? `⚠ ${incompletePhoto.entryTitle ?? ""} · ${incompletePhoto.photoLabel} — ${incompleteMsg}`
        : unjudgedFlag ? `⚠ ${unjudgedFlag.message}`
        : photoTitle
      }
      role="button"
      tabIndex={0}
      aria-label={`Photo: ${photoTitle}${myScore !== null ? `, scored ${myScore}` : ""}${myTags.length > 0 ? ", tagged" : ""}${isBookmarked ? ", bookmarked" : ""}${saveError ? `, save error: ${saveError.message}` : ""}${incompletePhoto ? `, ${incompleteMsg}` : unjudgedFlag ? `, ${unjudgedFlag.message}` : ""}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bulkMode ? onBulkToggle(photoKey) : onPhotoClick(photoKey); } }}
      className={`relative group cursor-pointer aspect-[4/3] overflow-hidden rounded-lg border-2 will-change-transform animate-photo-reveal neon-border ${
        saveError ? "border-destructive ring-2 ring-destructive/60 animate-pulse"
        : incompletePhoto ? "border-amber-500 ring-2 ring-amber-500/70 animate-pulse"
        : unjudgedFlag ? "border-amber-500 ring-2 ring-amber-500/60 animate-pulse"
        : isBulkSelected ? "border-primary ring-2 ring-primary/30"
        : isBookmarked ? "border-amber-400 ring-2 ring-amber-400/40"
        : statusBorder
      } ${isJustViewed ? "animate-glow-pulse ring-2 ring-primary/50" : ""} hover:border-primary/60 hover:-translate-y-1 hover:shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.35)] motion-safe:hover:[transform:perspective(800px)_rotateX(2deg)_translateY(-4px)] transition-all duration-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
    >
      {/* SOW v2.1 Step 5: render lightweight thumbnail; full original reserved for lightbox. */}
      {photo.photoThumbUrl ? (
        <img src={photo.photoThumbUrl} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" decoding="async" />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center">
          <Camera className="h-6 w-6 text-muted-foreground/30" />
        </div>
      )}
      {/* Step 20: Judging-phase watermark (renders only when phase==="judging"). */}
      {competitionPhase && (
        <PhaseWatermark
          phase={competitionPhase}
          currentRound={competitionCurrentRound ?? null}
          surface="cinema"
        />
      )}
      {saveError && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-1 bg-destructive/95 text-destructive-foreground px-1.5 py-1 text-[9px] leading-tight font-medium shadow-md"
          title={`${saveError.kind.toUpperCase()} save failed: ${saveError.message}`}
          aria-live="polite"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {saveError.kind === "score" ? "Score not saved" :
             saveError.kind === "tag" ? "Tag not saved" :
             saveError.kind === "comment" ? "Comment not saved" :
             "Feedback not saved"}
          </span>
        </div>
      )}
      {!saveError && incompletePhoto && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-1 bg-amber-500/95 text-black px-1.5 py-1 text-[9px] leading-tight font-semibold shadow-md"
          title={`${incompletePhoto.entryTitle ?? ""} · ${incompletePhoto.photoLabel} — ${incompleteMsg}`}
          aria-live="polite"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {incompletePhoto.missingCriteriaLabels.length === 0
              ? "Fill all 10 criteria"
              : `Fill: ${incompletePhoto.missingCriteriaLabels.slice(0, 3).join(", ")}${incompletePhoto.missingCriteriaLabels.length > 3 ? ` +${incompletePhoto.missingCriteriaLabels.length - 3}` : ""}`}
          </span>
        </div>
      )}
      {!saveError && !incompletePhoto && unjudgedFlag && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-1 bg-amber-500/95 text-black px-1.5 py-1 text-[9px] leading-tight font-semibold shadow-md"
          title={unjudgedFlag.message}
          aria-live="polite"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {unjudgedFlag.reason === "missing_scores" ? "Missing 10-criteria score" :
             unjudgedFlag.reason === "needs_review_unresolved" ? "Needs review — resolve" :
             "Missing decision"}
          </span>
        </div>
      )}
      {bulkMode && (
        <div className="absolute top-1.5 left-1.5 z-20">
          {isBulkSelected ? <CheckSquare className="h-5 w-5 text-primary drop-shadow-md" /> : <Square className="h-5 w-5 text-foreground/70 drop-shadow-md" />}
        </div>
      )}
      {!bulkMode && isBookmarked && (
        <div
          className="absolute top-1.5 left-1.5 z-20 w-6 h-6 rounded-full bg-amber-400 text-background flex items-center justify-center shadow-md ring-1 ring-background"
          title="Bookmarked — resume here"
          aria-label="Bookmarked"
        >
          <BookmarkCheck className="h-3.5 w-3.5" />
        </div>
      )}
      {/* Hover-to-bookmark (desktop). Hidden on touch devices via md:flex; click toggles without opening Cinema. */}
      {!bulkMode && onToggleBookmark && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleBookmark(photo.entryId, photo.photoIndex); }}
          className={`absolute z-30 ${isBookmarked ? "top-1.5 left-1.5 w-6 h-6 opacity-0 group-hover:opacity-100" : "top-1.5 left-1.5 w-6 h-6 opacity-0 group-hover:opacity-100"} hidden md:flex items-center justify-center rounded-full bg-background/85 backdrop-blur-sm text-foreground hover:bg-amber-400 hover:text-background transition-all shadow-md ring-1 ring-border`}
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this photo"}
          title={isBookmarked ? "Remove bookmark" : "Bookmark"}
        >
          {isBookmarked ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        </button>
      )}
      {hasScore && (
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
          {scoreData?.allScores && scoreData.allScores.length >= 2 && (
            <ConflictBadge scores={scoreData.allScores} />
          )}
          <div
            key={`score-${myScore}`}
            className="w-7 h-7 rounded-full text-primary-foreground flex items-center justify-center text-[10px] font-bold shadow-md animate-badge-pop"
            style={SCORE_BG_STYLE[Math.min(10, Math.max(0, myScore!))]}
          >
            {myScore}
          </div>
        </div>
      )}
      {!bulkMode && displayStatus !== "submitted" && myTags.length === 0 && (
        <div className="absolute bottom-1 left-1 z-10 max-w-[calc(100%-8px)]"><StatusBadge status={displayStatus} /></div>
      )}
      {(() => {
        // Per-round tag display: only stamps whose `visible_in_round` includes
        // the CURRENT round (or is empty/null = always visible) are shown.
        // Prevents prior-round qualifier tags (e.g. "Qualified for 2nd Round")
        // from leaking into the next round's grid.
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
          <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/70 to-transparent z-10">
            {visibleTags.map((tag) => (
              <JudgingStampBadge key={tag.id} label={tag.label} color={tag.color} icon={tag.icon || "award"} imageUrl={tag.image_url} size="sm" />
            ))}
          </div>
        );
      })()}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 pointer-events-none">
        <p className="text-[9px] text-white font-medium truncate" style={{ fontFamily: "var(--font-heading)" }}>{photoTitle}</p>
        {photo.entry.photographer_name && (
          <p className="text-[8px] text-white/60 truncate">{photo.entry.photographer_name}</p>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  // Step 10: custom equality — only re-render when THIS cell's data changed.
  // Parents pass new map references on every score/tag mutation; without this
  // every cell re-renders. We compare only the slices this cell consumes.
  if (prev.photoKey !== next.photoKey) return false;
  if (prev.photo !== next.photo) return false;
  if (prev.scoreData !== next.scoreData) return false;
  if (prev.tagData !== next.tagData) return false;
  if (prev.bulkMode !== next.bulkMode) return false;
  if (prev.isBulkSelected !== next.isBulkSelected) return false;
  if (prev.isRoundLocked !== next.isRoundLocked) return false;
  if (prev.myDecision !== next.myDecision) return false;
  if (prev.roundNumber !== next.roundNumber) return false;
  if (prev.availableTags !== next.availableTags) return false;
  if (prev.StatusBadge !== next.StatusBadge) return false;
  if (prev.onPhotoClick !== next.onPhotoClick) return false;
  if (prev.onBulkToggle !== next.onBulkToggle) return false;
  if (prev.competitionPhase !== next.competitionPhase) return false;
  if (prev.competitionCurrentRound !== next.competitionCurrentRound) return false;
  if (prev.isBookmarked !== next.isBookmarked) return false;
  if (prev.onToggleBookmark !== next.onToggleBookmark) return false;
  if (prev.isJustViewed !== next.isJustViewed) return false;
  return true;
});
PhotoCell.displayName = "PhotoCell";

/**
 * Virtualized photo grid using IntersectionObserver-based windowing.
 * For <200 items renders directly; for 200+ only renders visible rows.
 */
const VirtualizedPhotoGrid = (props: VirtualizedPhotoGridProps) => {
  const {
    photos, getPhotoKey, photoScoresMap, photoTagsMap, photoDecisionsMap, availableTags,
    bulkMode, bulkSelected, onPhotoClick, onBulkToggle,
    StatusBadge, columnCount, isRoundLocked, roundNumber,
    competitionPhase, competitionCurrentRound, bookmarkedEntryId, bookmarkedPhotoIndex, onToggleBookmark,
    lastViewedPhotoKey,
    onLoadMore, hasNextPage = false, isFetchingNextPage = false,
  } = props;

  // Step 14: shared sentinel observer. No-op when caller doesn't pass `onLoadMore`.
  const loadMoreSentinelRef = useInfiniteScroll<HTMLDivElement>({
    onLoadMore: onLoadMore ?? (() => {}),
    hasNextPage: Boolean(onLoadMore) && hasNextPage,
    isFetching: isFetchingNextPage,
    rootMargin: "400px",
    enabled: Boolean(onLoadMore),
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 40 });

  // Chunk photos into rows
  const rows = useMemo(() => {
    const result: FlatPhoto[][] = [];
    for (let i = 0; i < photos.length; i += columnCount) {
      result.push(photos.slice(i, i + columnCount));
    }
    return result;
  }, [photos, columnCount]);

  // Use IntersectionObserver for efficient windowing on large datasets
  const shouldVirtualize = photos.length > VIRTUALIZE_THRESHOLD;

  // FIX #10: Use requestAnimationFrame to ensure sentinels are in DOM before observing
  useEffect(() => {
    if (!shouldVirtualize || !containerRef.current) return;

    let observer: IntersectionObserver | null = null;
    let rafId: number;

    const attachObserver = () => {
      const container = containerRef.current;
      if (!container) return;
      const sentinels = container.querySelectorAll("[data-row-sentinel]");
      if (sentinels.length === 0) {
        // Retry on next frame if sentinels aren't painted yet
        rafId = requestAnimationFrame(attachObserver);
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          let minVisible = Infinity;
          let maxVisible = -Infinity;
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const idx = parseInt((entry.target as HTMLElement).dataset.rowSentinel || "0");
              minVisible = Math.min(minVisible, idx);
              maxVisible = Math.max(maxVisible, idx);
            }
          });
          if (minVisible <= maxVisible) {
            setVisibleRange({
              start: Math.max(0, minVisible - OVERSCAN),
              end: Math.min(rows.length - 1, maxVisible + OVERSCAN),
            });
          }
        },
        { root: container.closest("[data-scroll-container]") || undefined, rootMargin: "200px 0px" }
      );

      sentinels.forEach((s) => observer!.observe(s));
    };

    rafId = requestAnimationFrame(attachObserver);

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [shouldVirtualize, rows.length]);

  // Step 14: row index where the sentinel sits (3rd-to-last, or row 0 if list short).
  const sentinelRowIdx = Math.max(0, rows.length - 3);
  // CSS grid uses 1-based line numbers.
  const sentinelGridRow = sentinelRowIdx + 1;

  if (!shouldVirtualize) {
    // Simple non-virtualized grid
    return (
      <div className="grid gap-2 relative" style={{ gridTemplateColumns: `repeat(${columnCount}, 1fr)` }}>
        {photos.map((photo) => {
          const key = getPhotoKey(photo);
          return (
            <PhotoCell
              key={key}
              photo={photo}
              photoKey={key}
              scoreData={photoScoresMap[key]}
              tagData={photoTagsMap[key]}
              availableTags={availableTags}
              bulkMode={bulkMode}
              isBulkSelected={bulkSelected.has(key)}
              onPhotoClick={onPhotoClick}
              onBulkToggle={onBulkToggle}
              StatusBadge={StatusBadge}
              isRoundLocked={isRoundLocked}
               myDecision={photoDecisionsMap?.[`${photo.entryId}::${photo.photoIndex}`]?.myDecision}
              roundNumber={roundNumber}
              competitionPhase={competitionPhase}
              competitionCurrentRound={competitionCurrentRound}
              isBookmarked={!!bookmarkedEntryId && photo.entryId === bookmarkedEntryId && (bookmarkedPhotoIndex ?? 0) === (photo.photoIndex ?? 0)}
              onToggleBookmark={onToggleBookmark}
              isJustViewed={lastViewedPhotoKey === key}
            />
          );
        })}
        {onLoadMore && rows.length > 0 && (
          <div
            ref={loadMoreSentinelRef}
            data-load-more-sentinel
            aria-hidden="true"
            className="pointer-events-none h-px w-px"
            style={{ gridColumn: "1 / -1", gridRow: sentinelGridRow }}
          />
        )}
      </div>
    );
  }

  // Virtualized: render sentinel divs for all rows, only render content for visible ones
  return (
    <div ref={containerRef} className="grid gap-2 relative" style={{ gridTemplateColumns: `repeat(${columnCount}, 1fr)` }}>
      {rows.map((row, rowIdx) => {
        const isVisible = rowIdx >= visibleRange.start && rowIdx <= visibleRange.end;
        return row.map((photo, colIdx) => {
          const key = getPhotoKey(photo);
          if (!isVisible) {
            // Placeholder preserving layout
            return (
              <div
                key={key}
                data-row-sentinel={rowIdx}
                className="aspect-[4/3] bg-muted/5 rounded-lg"
              />
            );
          }
          return (
            <div key={key} data-row-sentinel={rowIdx}>
              <PhotoCell
                photo={photo}
                photoKey={key}
                scoreData={photoScoresMap[key]}
                tagData={photoTagsMap[key]}
                availableTags={availableTags}
                bulkMode={bulkMode}
                isBulkSelected={bulkSelected.has(key)}
                onPhotoClick={onPhotoClick}
                onBulkToggle={onBulkToggle}
                StatusBadge={StatusBadge}
                isRoundLocked={isRoundLocked}
                myDecision={photoDecisionsMap?.[`${photo.entryId}::${photo.photoIndex}`]?.myDecision}
                roundNumber={roundNumber}
                competitionPhase={competitionPhase}
                competitionCurrentRound={competitionCurrentRound}
                isBookmarked={!!bookmarkedEntryId && photo.entryId === bookmarkedEntryId && (bookmarkedPhotoIndex ?? 0) === (photo.photoIndex ?? 0)}
                onToggleBookmark={onToggleBookmark}
                isJustViewed={lastViewedPhotoKey === key}
              />
            </div>
          );
        });
      })}
      {onLoadMore && rows.length > 0 && (
        <div
          ref={loadMoreSentinelRef}
          data-load-more-sentinel
          aria-hidden="true"
          className="pointer-events-none h-px w-px"
          style={{ gridColumn: "1 / -1", gridRow: sentinelGridRow }}
        />
      )}
    </div>
  );
};

export default memo(VirtualizedPhotoGrid);
