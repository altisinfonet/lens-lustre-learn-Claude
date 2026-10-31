import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, ZoomIn, ZoomOut, Maximize2, Minimize2,
  ChevronLeft, ChevronRight, RotateCcw,
  Tag, Star, XCircle, CheckCircle, Loader2, Send, MessageSquare,
} from "lucide-react";
import PhaseWatermark from "@/components/competition/PhaseWatermark";

interface JudgingTag {
  id: string;
  label: string;
  color: string;
}

interface JudgeComment {
  id: string;
  comment: string;
  created_at: string;
  round_id: string | null;
}

interface ViewerEntry {
  id: string;
  title: string;
  photos: string[];
  photographer_name: string | null;
  my_tags: string[];
  all_tags: { tag_id: string; judge_id: string }[];
  my_score: number | null;
  my_feedback: string | null;
  my_comments: JudgeComment[];
  status: string;
}

interface JuryImageViewerProps {
  entries: ViewerEntry[];
  currentIndex: number;
  availableTags: JudgingTag[];
  rounds: { id: string; name: string }[];
  onClose: () => void;
  onNavigate: (index: number) => void;
  onToggleTag: (entryId: string, tagId: string) => void;
  onScore: (entryId: string, score: number, feedback: string) => Promise<void>;
  onAddComment: (entryId: string, comment: string) => Promise<void>;
  onStatusChange?: (entryId: string, status: "rejected" | "approved") => void;
  /** Step 20: canonical phase of the competition this viewer is judging. */
  competitionPhase?: string;
  /** Step 20: active judging round ("1"|"2"|"3"|"4") for watermark labelling. */
  competitionCurrentRound?: string | null;
}

const JuryImageViewer = ({
  entries,
  currentIndex,
  availableTags,
  rounds,
  onClose,
  onNavigate,
  onToggleTag,
  onScore,
  onAddComment,
  onStatusChange,
  competitionPhase,
  competitionCurrentRound,
}: JuryImageViewerProps) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [scoreInput, setScoreInput] = useState("");
  const [feedbackInput, setFeedbackInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [scoring, setScoring] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const entry = entries[currentIndex] ?? null;
  const currentPhoto = entry?.photos[photoIndex] || entry?.photos[0] || "";
  const totalPhotos = entry?.photos.length || 0;

  // Reset state on entry change
  useEffect(() => {
    if (!entry) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPhotoIndex(0);
    setLoaded(false);
    setScoreInput(entry.my_score !== null ? String(entry.my_score) : "");
    setFeedbackInput(entry.my_feedback || "");
    setCommentInput("");
  }, [currentIndex, entry?.id]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (currentIndex > 0) onNavigate(currentIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (currentIndex < entries.length - 1) onNavigate(currentIndex + 1);
          break;
        case "Escape":
          e.preventDefault();
          if (isFullscreen) {
            document.exitFullscreen?.();
          } else {
            onClose();
          }
          break;
        case "1":
          e.preventDefault();
          onStatusChange?.(entry.id, "rejected");
          // Auto-advance
          if (currentIndex < entries.length - 1) onNavigate(currentIndex + 1);
          break;
        case "2":
          e.preventDefault();
          onStatusChange?.(entry.id, "approved");
          if (currentIndex < entries.length - 1) onNavigate(currentIndex + 1);
          break;
        case "+":
        case "=":
          e.preventDefault();
          setZoom((z) => Math.min(z + 0.25, 5));
          break;
        case "-":
          e.preventDefault();
          setZoom((z) => Math.max(z - 0.25, 0.5));
          break;
        case "0":
          e.preventDefault();
          setZoom(1);
          setPan({ x: 0, y: 0 });
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, entries.length, entry.id, isFullscreen, onClose, onNavigate, onStatusChange]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Mouse drag for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((z) => Math.max(0.5, Math.min(5, z + delta)));
  };

  const handleScore = async () => {
    const score = parseInt(scoreInput);
    if (isNaN(score) || score < 1 || score > 10) return;
    setScoring(true);
    await onScore(entry.id, score, feedbackInput.trim());
    setScoring(false);
  };

  const handleComment = async () => {
    if (!commentInput.trim()) return;
    await onAddComment(entry.id, commentInput.trim());
    setCommentInput("");
  };

  if (!entry) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-background flex"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {/* Left: Image area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded transition-colors">
              <X className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {currentIndex + 1} / {entries.length}
            </span>
            <span className="text-sm font-light truncate max-w-[300px]" style={{ fontFamily: "var(--font-display)" }}>
              {entry.title}
            </span>
            {entry.photographer_name && (
              <span className="text-[10px] text-muted-foreground">by {entry.photographer_name}</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Keyboard hints */}
            <div className="hidden md:flex items-center gap-2 mr-3 text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              <span className="px-1.5 py-0.5 border border-border rounded text-[8px]">←→</span> Nav
              <span className="px-1.5 py-0.5 border border-border rounded text-[8px]">1</span> Reject
              <span className="px-1.5 py-0.5 border border-border rounded text-[8px]">2</span> Shortlist
              <span className="px-1.5 py-0.5 border border-border rounded text-[8px]">+/-</span> Zoom
            </div>
            <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="p-1.5 hover:bg-muted rounded transition-colors" title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-[10px] text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(5, z + 0.25))} className="p-1.5 hover:bg-muted rounded transition-colors" title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1.5 hover:bg-muted rounded transition-colors" title="Reset">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button onClick={toggleFullscreen} className="p-1.5 hover:bg-muted rounded transition-colors" title="Fullscreen">
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Image canvas */}
        <div
          className="flex-1 relative overflow-hidden bg-black/95 select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
        >
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <img
            ref={imageRef}
            src={currentPhoto}
            alt={entry.title}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className="absolute top-1/2 left-1/2 max-w-full max-h-full object-contain transition-transform duration-150"
            style={{
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              opacity: loaded ? 1 : 0,
            }}
            draggable={false}
          />

          {/* Step 20: judging-phase watermark over the active hero image */}
          {competitionPhase && (
            <PhaseWatermark
              phase={competitionPhase}
              currentRound={competitionCurrentRound ?? null}
              surface="cinema"
            />
          )}

          {/* Nav arrows */}
          {currentIndex > 0 && (
            <button
              onClick={() => onNavigate(currentIndex - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-background/80 backdrop-blur-sm border border-border rounded-full hover:bg-background transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {currentIndex < entries.length - 1 && (
            <button
              onClick={() => onNavigate(currentIndex + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-background/80 backdrop-blur-sm border border-border rounded-full hover:bg-background transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Photo thumbnails strip (if multiple photos) */}
        {totalPhotos > 1 && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border bg-background/95 overflow-x-auto shrink-0">
            {entry.photos.map((photo, i) => (
              <button
                key={i}
                onClick={() => { setPhotoIndex(i); setZoom(1); setPan({ x: 0, y: 0 }); setLoaded(false); }}
                className={`relative w-12 h-12 shrink-0 border-2 transition-all ${
                  photoIndex === i ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"
                }`}
              >
                <img src={photo} alt="" className="w-full h-full object-cover" loading="lazy" />
                {competitionPhase && (
                  <PhaseWatermark
                    phase={competitionPhase}
                    currentRound={competitionCurrentRound ?? null}
                    surface="cinema"
                  />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Bottom: Quick action bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-background/95 shrink-0">
          <button
            onClick={() => { onStatusChange?.(entry.id, "rejected"); if (currentIndex < entries.length - 1) onNavigate(currentIndex + 1); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-destructive/50 text-destructive text-[10px] tracking-[0.1em] uppercase hover:bg-destructive/10 transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject (1)
          </button>
          <button
            onClick={() => { onStatusChange?.(entry.id, "approved"); if (currentIndex < entries.length - 1) onNavigate(currentIndex + 1); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-green-600/50 text-green-600 text-[10px] tracking-[0.1em] uppercase hover:bg-green-600/10 transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Advance (2)
          </button>
          <div className="flex-1" />
          <span className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {entry.my_score !== null ? `Your rating: ${entry.my_score}/10` : "Not rated"}
          </span>
        </div>
      </div>

      {/* Right: Tag & action sidebar */}
      <div className="w-[320px] border-l border-border bg-background flex flex-col shrink-0 overflow-y-auto">
        {/* Tags */}
        {availableTags.length > 0 && (
          <div className="p-4 border-b border-border">
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>
              <Tag className="h-3 w-3 inline mr-1" />
              Tag This Entry
            </span>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => {
                const isActive = entry.my_tags.includes(tag.id);
                const totalCount = entry.all_tags.filter((t) => t.tag_id === tag.id).length;
                return (
                  <button
                    key={tag.id}
                    onClick={() => onToggleTag(entry.id, tag.id)}
                    className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] px-2.5 py-1 border transition-all duration-300 ${
                      isActive
                        ? "border-current bg-current/10"
                        : "border-border text-muted-foreground hover:border-foreground/50"
                    }`}
                    style={{
                      fontFamily: "var(--font-heading)",
                      color: isActive ? tag.color : undefined,
                      borderColor: isActive ? tag.color : undefined,
                    }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.label}
                    {totalCount > 0 && <span className="text-[8px] opacity-60">({totalCount})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Score */}
        <div className="p-4 border-b border-border">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>
            <Star className="h-3 w-3 inline mr-1" />
            Your Rating
          </span>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={10}
                value={scoreInput}
                onChange={(e) => setScoreInput(e.target.value)}
                placeholder="1-10"
                className="w-16 bg-transparent border border-border focus:border-primary outline-none px-2 py-1.5 text-sm text-center transition-colors"
                style={{ fontFamily: "var(--font-body)" }}
              />
              <span className="text-[10px] text-muted-foreground">/10</span>
              <button
                onClick={handleScore}
                disabled={scoring || !scoreInput}
                className="ml-auto px-3 py-1.5 bg-primary text-primary-foreground text-[9px] tracking-[0.1em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {scoring ? <Loader2 className="h-3 w-3 animate-spin" /> : entry.my_score !== null ? "Update" : "Save"}
              </button>
            </div>
            <input
              type="text"
              value={feedbackInput}
              onChange={(e) => setFeedbackInput(e.target.value)}
              placeholder="Optional feedback..."
              className="w-full bg-transparent border border-border focus:border-primary outline-none px-2 py-1.5 text-xs transition-colors"
              style={{ fontFamily: "var(--font-body)" }}
            />
          </div>
        </div>

        {/* Private notes */}
        <div className="p-4 flex-1 flex flex-col min-h-0">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>
            <MessageSquare className="h-3 w-3 inline mr-1" />
            Your Notes
          </span>

          {entry.my_comments.length > 0 && (
            <div className="space-y-1.5 mb-3 overflow-y-auto max-h-[200px]">
              {entry.my_comments.map((c) => {
                const roundName = rounds.find((r) => r.id === c.round_id)?.name;
                return (
                  <div key={c.id} className="text-[10px] px-2 py-1.5 border border-border/50 bg-muted/20" style={{ fontFamily: "var(--font-body)" }}>
                    <p className="text-foreground">{c.comment}</p>
                    <p className="text-[8px] text-muted-foreground mt-0.5">
                      {new Date(c.created_at).toLocaleString()}
                      {roundName && <> · <span className="text-primary">{roundName}</span></>}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-1.5 mt-auto">
            <input
              type="text"
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder="Add a note..."
              className="flex-1 bg-transparent border border-border focus:border-primary outline-none px-2 py-1.5 text-xs transition-colors"
              style={{ fontFamily: "var(--font-body)" }}
              maxLength={500}
              onKeyDown={(e) => e.key === "Enter" && handleComment()}
            />
            <button
              onClick={handleComment}
              disabled={!commentInput.trim()}
              className="px-2.5 py-1.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JuryImageViewer;
