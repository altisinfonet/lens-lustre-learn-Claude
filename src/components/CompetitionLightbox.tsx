import { memo, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Heart, AlertTriangle, Copy } from "lucide-react";
import ImageEngagement from "@/components/ImageEngagement";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import { toast } from "@/hooks/core/use-toast";
import { buildCompetitionPhotoUrl, type CompetitionVotingPhoto } from "@/lib/competitionVotingPhotos";

interface CompetitionLightboxProps {
  images: CompetitionVotingPhoto[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onVote: (entryId: string, hasVoted: boolean, photoIndex: number) => void;
  competitionPhase: string;
  /** Step 20: active judging round when phase==="judging". Optional. */
  competitionCurrentRound?: string | null;
}

const CompetitionLightbox = memo(({
  images,
  currentIndex,
  isOpen,
  onClose,
  onPrev,
  onNext,
  onVote,
  competitionPhase,
  competitionCurrentRound,
}: CompetitionLightboxProps) => {
  const current = images[currentIndex];
  const [showUnvoteWarning, setShowUnvoteWarning] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    },
    [onClose, onPrev, onNext],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleVoteClick = () => {
    if (!current) return;
    if (current.userVoted) {
      setShowUnvoteWarning(true);
    } else {
      onVote(current.entryId, false, current.photoIndex);
    }
  };

  const confirmUnvote = () => {
    if (!current) return;
    onVote(current.entryId, true, current.photoIndex);
    setShowUnvoteWarning(false);
  };

  // Reset warning when navigating
  useEffect(() => {
    setShowUnvoteWarning(false);
  }, [currentIndex]);

  const lightboxContent = (
    <AnimatePresence>
      {isOpen && current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] bg-background backdrop-blur-md"
          onClick={onClose}
        >
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Counter */}
          <div className="absolute top-5 left-5 z-20">
            <span
              className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {currentIndex + 1} / {images.length}
            </span>
          </div>

          {/* Prev */}
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-muted/40 hover:bg-muted/70 flex items-center justify-center text-foreground transition-all"
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* Next */}
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-muted/40 hover:bg-muted/70 flex items-center justify-center text-foreground transition-all"
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          {/* Main Content */}
          <div
            className="h-full flex flex-col lg:flex-row items-stretch overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left: Image + Vote */}
            <div className="flex-1 flex flex-col items-center justify-center p-4 pt-16 lg:pt-4 lg:pl-16 lg:pr-4 min-h-0">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentIndex}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col items-center max-h-full w-full"
                >
                  {/* Image */}
                  <div className="relative flex-1 flex items-center justify-center min-h-0 w-full max-w-4xl">
                    <img
                      src={current.photoUrl}
                      alt={`${current.entryTitle} — photo ${current.photoIndex + 1}`}
                      className="max-w-full max-h-[55vh] lg:max-h-[70vh] object-contain rounded-md shadow-2xl select-none"
                      onContextMenu={(e) => e.preventDefault()}
                      draggable={false}
                    />
                    {/* Step 20: Judging-phase watermark (renders only when phase==="judging"). */}
                    <PhaseWatermark
                      phase={competitionPhase}
                      currentRound={competitionCurrentRound ?? null}
                      surface="lightbox"
                    />
                  </div>

                  {/* Info below image */}
                  <div className="mt-4 text-center w-full max-w-lg">
                    <h3
                      className="text-lg md:text-xl font-light text-foreground truncate"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {current.entryTitle}
                    </h3>
                    {competitionPhase !== "judging" && (
                      <p
                        className="text-[10px] text-muted-foreground mt-0.5 tracking-wide"
                        style={{ fontFamily: "var(--font-body)" }}
                      >
                        by {current.photographerName || "Anonymous"}
                      </p>
                    )}
                    {current.competitionTitle && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1" style={{ fontFamily: "var(--font-body)" }}>
                        {current.competitionTitle}
                      </p>
                    )}
                    {current.totalPhotos > 1 && (
                      <span className="text-[9px] text-muted-foreground/60 mt-0.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                        Photo {current.photoIndex + 1} of {current.totalPhotos}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(buildCompetitionPhotoUrl(window.location.origin, current.entryId, current.photoIndex));
                        toast({ title: "Photo link copied!" });
                      }}
                      className="inline-flex items-center gap-1.5 mt-2 text-[10px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <Copy className="h-3 w-3" /> Copy Photo Link
                    </button>

                    {/* Big Vote Button — only for open status */}
                    {competitionPhase === "voting" && (
                      <div className="mt-4 relative">
                        <button
                          onClick={handleVoteClick}
                          className={`group inline-flex items-center gap-3 px-8 py-3 rounded-full text-sm font-semibold tracking-wide transition-all duration-300 ${
                            current.userVoted
                              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/10"
                              : "bg-muted hover:bg-primary hover:text-primary-foreground text-foreground border border-border hover:border-primary hover:shadow-lg hover:shadow-primary/20"
                          }`}
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          <Heart
                            className={`h-5 w-5 transition-transform duration-300 group-hover:scale-110 ${
                              current.userVoted ? "fill-current" : ""
                            }`}
                          />
                          <span className="tracking-[0.15em] uppercase text-xs">
                            {current.userVoted ? "Voted" : "Vote"}
                          </span>
                          <span className="text-xs opacity-70">{current.voteCount}</span>
                        </button>

                        {/* Unvote warning */}
                        <AnimatePresence>
                          {showUnvoteWarning && (
                            <motion.div
                              initial={{ opacity: 0, y: 6, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 6, scale: 0.98 }}
                              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                              className="absolute left-1/2 -translate-x-1/2 top-full mt-3 w-[320px] z-30"
                            >
                              {/* arrow */}
                              <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rotate-45 bg-card/95 border-l border-t border-border/60 backdrop-blur-xl" />
                              <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]">
                                {/* accent stripe */}
                                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-destructive/60 to-transparent" />
                                <div className="p-4">
                                  <div className="flex items-start gap-3">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 ring-1 ring-destructive/20">
                                      <AlertTriangle className="h-4 w-4 text-destructive" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p
                                        className="text-[11px] tracking-[0.18em] uppercase text-foreground"
                                        style={{ fontFamily: "var(--font-heading)" }}
                                      >
                                        Unvote Penalty
                                      </p>
                                      <p
                                        className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground"
                                        style={{ fontFamily: "var(--font-body)" }}
                                      >
                                        Removing your vote deducts <span className="text-foreground font-medium">2× the reward</span> from your wallet. This cannot be undone.
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-4 flex items-center gap-2">
                                    <button
                                      onClick={() => setShowUnvoteWarning(false)}
                                      className="flex-1 text-[10px] tracking-[0.15em] uppercase px-3 py-2 rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
                                      style={{ fontFamily: "var(--font-heading)" }}
                                    >
                                      Keep Vote
                                    </button>
                                    <button
                                      onClick={confirmUnvote}
                                      className="flex-1 text-[10px] tracking-[0.15em] uppercase px-3 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[0_4px_14px_-2px_hsl(var(--destructive)/0.5)] transition-all"
                                      style={{ fontFamily: "var(--font-heading)" }}
                                    >
                                      Remove Vote
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                      </div>
                    )}

                    {/* Show vote count (read-only) for closed status */}
                    {competitionPhase === "result" && (
                      <div className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-muted text-muted-foreground text-xs" style={{ fontFamily: "var(--font-heading)" }}>
                        <Heart className="h-4 w-4" />
                        <span className="tracking-[0.1em] uppercase">{current.voteCount} votes</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Right: Reactions & Comments Panel — only for closed status */}
            {competitionPhase === "result" && (
              <div className="w-full lg:w-[360px] xl:w-[400px] border-t lg:border-t-0 lg:border-l border-border bg-card/50 flex flex-col max-h-[35vh] lg:max-h-full overflow-hidden">
                <div className="p-4 border-b border-border/50 shrink-0">
                  <span
                    className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    Reactions & Comments
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <ImageEngagement imageType="competition_entry" imageId={current.entryId} photoIndex={current.photoIndex} />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Render via portal to document.body to escape any parent overflow/transform containment
  return createPortal(lightboxContent, document.body);
});

CompetitionLightbox.displayName = "CompetitionLightbox";
export default CompetitionLightbox;
