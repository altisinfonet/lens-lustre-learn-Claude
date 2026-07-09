import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Heart, SkipForward, Copy, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import { useCompetitionVoting } from "@/hooks/competition/useCompetitionVoting";

interface VotingEntry {
  id: string; // entry_id (multiple photos can share the same entry id)
  title: string;
  photo_url: string;
  competition_title: string;
  photo_index: number; // index of this photo within the entry's photos array
  competition_id?: string;
}

interface VotingLightboxProps {
  entries: VotingEntry[];
  startIndex: number;
  onClose: () => void;
  onVoted?: () => void;
  onPhotoChange?: (entryId: string, photoIndex: number) => void;
}

const VotingLightbox = ({ entries, startIndex, onClose, onVoted, onPhotoChange }: VotingLightboxProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [showUnvoteWarning, setShowUnvoteWarning] = useState(false);
  const competitionId = entries[currentIndex]?.competition_id || (params.id as string) || "";
  const { toggleVoteAsync, isVoting: voting } = useCompetitionVoting({ competitionId, userId: user?.id });
  // Track voted state per (entry_id::photo_index) composite key
  const [votedKeys, setVotedKeys] = useState<Set<string>>(new Set());

  const current = entries[currentIndex];
  const isLast = currentIndex >= entries.length - 1;

  // Unique entry IDs for batch vote checking
  const uniqueEntryIds = useMemo(() => [...new Set(entries.map((e) => e.id))], [entries]);

  // Build a set of all (entry_id, photo_index) pairs for this entries list
  const entryPhotoKeys = useMemo(() => {
    return entries.map((e) => `${e.id}::${e.photo_index}`);
  }, [entries]);

  useEffect(() => {
    if (!user || uniqueEntryIds.length === 0) return;
    supabase
      .from("competition_votes")
      .select("entry_id, photo_index")
      .eq("user_id", user.id)
      .in("entry_id", uniqueEntryIds)
      .then(({ data }) => {
        if (data) {
          const keys = new Set(data.map((v: any) => `${v.entry_id}::${v.photo_index ?? 0}`));
          setVotedKeys(keys);
        }
      });
  }, [user, uniqueEntryIds, entryPhotoKeys]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentIndex]);

  // Notify parent when photo changes so URL can sync
  useEffect(() => {
    const cur = entries[currentIndex];
    if (cur && onPhotoChange) onPhotoChange(cur.id, cur.photo_index);
  }, [currentIndex, entries, onPhotoChange]);

  const goNext = () => {
    if (!isLast) setCurrentIndex((i) => i + 1);
    else onClose();
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  const handleVote = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (!current || voting) return;

    const voteKey = `${current.id}::${current.photo_index}`;
    const alreadyVoted = votedKeys.has(voteKey);
    if (alreadyVoted && !showUnvoteWarning) {
      setShowUnvoteWarning(true);
      return;
    }

    try {
      const action = alreadyVoted ? "unvote" : "vote";
      // Single source of truth — useCompetitionVoting handles toast (incl. wallet reward) and cache updates.
      await toggleVoteAsync(current.id, alreadyVoted, current.photo_index);

      setVotedKeys((prev) => {
        const next = new Set(prev);
        if (action === "unvote") next.delete(voteKey);
        else next.add(voteKey);
        return next;
      });
      onVoted?.();
      setShowUnvoteWarning(false);
    } catch (err: any) {
      const msg = err?.message || "Failed to vote";
      if (msg.includes("own entry")) {
        toast.error("You cannot vote on your own entry");
      } else if (msg.includes("only allowed during")) {
        toast.error("Voting is not open for this competition");
      } else if (msg.includes("Voting period has ended")) {
        toast.error("Voting period has ended");
      }
      // other errors already surfaced by useCompetitionVoting
    } finally {
      setTimeout(goNext, 400);
    }
  };

  if (!current) return null;

  const voteKey = current ? `${current.id}::${current.photo_index}` : "";
  const alreadyVoted = votedKeys.has(voteKey);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center" onClick={onClose}>
      <div className="relative w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 text-white/90 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{current.title}</p>
            <p className="text-[10px] text-white/50">{current.competition_title}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/entry/${current.id}`);
                toast("Entry link copied!");
              }}
              className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
              title="Copy entry link"
            >
              <Copy className="h-4 w-4" />
            </button>
            <span className="text-xs text-white/60 tabular-nums">
              {currentIndex + 1} / {entries.length}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden px-12">
          {currentIndex > 0 && (
            <button
              onClick={goPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <img
            src={current.photo_url}
            alt={current.title}
            className="max-w-full max-h-full object-contain rounded-sm"
          />

          {!isLast && (
            <button
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Voted indicator */}
        {alreadyVoted && (
          <div className="text-center text-[10px] text-primary/70 pb-1">
            ✓ You voted for this image
          </div>
        )}

          {showUnvoteWarning && alreadyVoted && (
            <div className="mx-auto mb-3 max-w-xs rounded-lg border border-destructive/30 bg-card px-4 py-3 text-left text-white/90">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-[10px] text-white/70">Removing your vote deducts 2× the reward from your wallet.</p>
              </div>
            </div>
          )}

        {/* Action bar */}
        <div className="flex items-center justify-center gap-4 py-4 shrink-0">
          <button
            onClick={goNext}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors text-sm"
          >
            <SkipForward className="h-4 w-4" />
            {isLast ? "Close" : "Skip"}
          </button>
          <button
            onClick={handleVote}
            disabled={voting}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
              alreadyVoted
                ? "bg-primary/30 text-primary cursor-default"
                : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
            }`}
          >
            <Heart className={`h-4 w-4 ${alreadyVoted ? "fill-current" : ""}`} />
            {voting ? "Working…" : alreadyVoted ? "Remove Vote" : "Vote"}
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center justify-center gap-0.5 pb-3 px-8 max-w-md mx-auto w-full">
          {entries.length <= 20 ? (
            entries.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === currentIndex ? "w-4 bg-primary" : i < currentIndex ? "w-1.5 bg-primary/50" : "w-1.5 bg-white/20"
                }`}
              />
            ))
          ) : (
            <div className="w-full bg-white/10 rounded-full h-1">
              <div
                className="bg-primary h-1 rounded-full transition-all"
                style={{ width: `${((currentIndex + 1) / entries.length) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default VotingLightbox;
