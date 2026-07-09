import React, { useCallback, useState } from "react";
import { Heart, Star, Share2, Copy, ExternalLink, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/core/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import EntryTagStamps from "@/components/EntryTagStamps";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import EngagementFooter from "@/components/EngagementFooter";
import ImageEngagement from "@/components/ImageEngagement";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { buildCompetitionPhotoPath } from "@/lib/competitionVotingPhotos";
import { participantKeyForJudgingTag, participantStageLabel, PARTICIPANT_PLACEMENT_LABELS } from "@/lib/judging/participantStageLabels";
// Verification workflow removed (Spec v3 Apr 2026) — Needs Review is handled
// via email + in-app notification on round publish. No per-photo override here.

/**
 * Phase 2: Supabase render-endpoint srcset for competition grid thumbnails.
 * Skips non-Supabase URLs, already-transformed render URLs, GIF, and SVG.
 */
const SUPABASE_PUBLIC_RE = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;
const SUPABASE_RENDER_RE = /\/storage\/v1\/render\/image\/public\//;
function buildEntryCardSrcSet(url: string | undefined): string | undefined {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return undefined;
  if (SUPABASE_RENDER_RE.test(url)) return undefined;
  if (!SUPABASE_PUBLIC_RE.test(url)) return undefined;
  if (/\.(gif|svg)(\?|$)/i.test(url)) return undefined;
  try {
    const u = new URL(url);
    const m = u.pathname.match(SUPABASE_PUBLIC_RE);
    if (!m) return undefined;
    return [400, 600, 900].map((w) => {
      const params = new URLSearchParams(u.search);
      params.set("width", String(w));
      params.set("quality", "70");
      params.set("resize", "contain");
      return `${u.origin}/storage/v1/render/image/public/${m[1]}/${m[2]}?${params.toString()} ${w}w`;
    }).join(", ");
  } catch {
    return undefined;
  }
}

interface EntryCardProps {
  entry: {
    id: string;
    title: string;
    description: string | null;
    photos: string[];
    /** Per-photo metadata: source of truth for photo title/description in flattened cards. */
    photo_meta?: any[] | null;
    /** Phase 2: optional low-bandwidth thumbnail array (parallel to photos[]). */
    photo_thumbnails?: string[] | null;
    user_id: string;
    /**
     * @deprecated UI MUST NOT read entry.status directly. Always go through
     * useGatedEntryStatus / `publicStatus` prop. Kept on the type only for
     * data-fetch compatibility — see eslint-rules/no-raw-entry-status.js.
     */
    status: string;
    created_at: string;
    /**
     * @deprecated Same as `status` — read `publicPlacement` instead.
     */
    placement: string | null;
    profiles: { full_name: string | null } | null;
    vote_count: number;
    user_voted: boolean;
    badges: string[];
  };
  /** When provided, show this single photo instead of photos[0]. Full-resolution; used by lightbox + download. */
  displayPhotoUrl?: string;
  /** Phase 2: low-bandwidth thumbnail for the grid <img>. Falls back to displayPhotoUrl. Lightbox/voting still use displayPhotoUrl. */
  displayThumbnailUrl?: string;
  /** Which photo index this card represents (for lightbox) */
  displayPhotoIndex?: number;
  competitionPhase: string;
  competitionCurrentRound: string | null;
  userId: string | undefined;
  isAdmin: boolean;
  isVoting: boolean;
  isMarkingPOTD: boolean;
  openLightbox: (entryId: string, photoIndex: number) => void;
  toggleVote: (entryId: string, hasVoted: boolean, photoIndex?: number) => void;
  markAsPOTD: (entry: any) => void;
  /**
   * Audit v6 P-01 — Publish-gated placement (winner / 1st_runner_up / …).
   * Caller MUST resolve via useGatedEntryStatus and pass null when the
   * relevant round is not yet published. Never derived from entry.placement.
   */
  publicPlacement?: string | null;
  /** Audit v6 P-01 — Publish-gated status. Falls back to "judging_in_progress". */
  publicStatus?: string;
}

const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  displayPhotoUrl,
  displayThumbnailUrl,
  displayPhotoIndex,
  competitionPhase,
  competitionCurrentRound,
  userId,
  isAdmin,
  isVoting,
  isMarkingPOTD,
  openLightbox,
  toggleVote,
  markAsPOTD,
  publicPlacement = null,
  publicStatus,
}) => {
  const isOwn = userId === entry.user_id;
  const isJudging = competitionPhase === "judging";
  const isVotingPhase = competitionPhase === "voting";
  const hideEngagement = isVotingPhase || isJudging;

  const activePhotoUrl = displayPhotoUrl || entry.photos[0];
  const activePhotoIndex = displayPhotoIndex ?? 0;
  // Phase 2: thumbnail for grid <img> only. Lightbox/download still use activePhotoUrl (full-res).
  const activeThumbnailUrl =
    displayThumbnailUrl
    || (entry.photo_thumbnails && entry.photo_thumbnails[activePhotoIndex])
    || activePhotoUrl;
  const activePhotoMeta = Array.isArray((entry as any).photo_meta) ? (entry as any).photo_meta[activePhotoIndex] : null;
  const activePhotoTitle =
    typeof activePhotoMeta?.title === "string" && activePhotoMeta.title.trim().length > 0
      ? activePhotoMeta.title.trim()
      : entry.title;
  const activePhotoDescription =
    typeof activePhotoMeta?.description === "string" && activePhotoMeta.description.trim().length > 0
      ? activePhotoMeta.description.trim()
      : entry.description;

  // Per-photo vote state
  const photoVoteMap = (entry as any)._photoVoteMap || {};
  const userVotedPhotos: number[] = (entry as any)._userVotedPhotos || [];
  const photoVoteCount = photoVoteMap[String(activePhotoIndex)] || 0;
  const photoUserVoted = userVotedPhotos.includes(activePhotoIndex);

  // Per-photo derived status (consensus from judge_decisions). Falls back to entry.status
  // ONLY when the viewer has no permission to see decisions (e.g. non-owner public viewer).
  const photoStatusMap = (entry as any)._photoStatusMap || {};
  const photoR4TagMap = (entry as any)._photoR4TagMap || {};
  const activePhotoR4Tag = photoR4TagMap[activePhotoIndex] || null;
  const activePhotoR4Label = typeof activePhotoR4Tag?.label === "string" ? activePhotoR4Tag.label : null;
  // Plan Phase 5 / Task 5.6 — normalize DB tag labels and aliases through the
  // same resolver as Mark 2 (`EntryTagStamps`) before choosing the visual key.
  const resolvedPhotoPlacement = participantKeyForJudgingTag(activePhotoR4Label);
  const photoPlacement: string | null = resolvedPhotoPlacement && PARTICIPANT_PLACEMENT_LABELS[resolvedPhotoPlacement]
    ? resolvedPhotoPlacement
    : null;
  // Audit v6 P-01: prefer the gated `publicStatus` prop. Fall back to the raw column ONLY
  // when no gated value was threaded (legacy callers); the rule allowlists this single read.
  // eslint-disable-next-line audit-v6/no-raw-entry-status
  const visibleEntryStatus: string = (entry as any)._visibleStatus ?? publicStatus ?? entry.status;
  const perPhotoStatus: string = photoStatusMap[activePhotoIndex] ?? visibleEntryStatus;
  const showVerificationRequired = isOwn && perPhotoStatus === "needs_review";
  const judgingStatusChip = (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md border shrink-0 ${
        showVerificationRequired
          ? "border-orange-500/40 bg-orange-500/10 text-orange-500"
          : "border-border text-muted-foreground/40 italic"
      }`}
      style={{ fontFamily: "var(--font-heading)" }}
    >
      {showVerificationRequired && <AlertTriangle className="h-3 w-3" />}
      {showVerificationRequired ? participantStageLabel("needs_verification") : "Under Review"}
    </span>
  );

  const handleLightbox = useCallback(() => {
    openLightbox(entry.id, activePhotoIndex);
  }, [openLightbox, entry.id, activePhotoIndex]);

  const [showUnvoteConfirm, setShowUnvoteConfirm] = useState(false);

  const handleVote = useCallback(() => {
    // U-01: When user is about to UNVOTE, surface the 2× penalty warning before firing.
    // This prevents accidental taps on the highlighted heart and makes the cost explicit.
    if (photoUserVoted) {
      setShowUnvoteConfirm(true);
      return;
    }
    toggleVote(entry.id, photoUserVoted, activePhotoIndex);
  }, [toggleVote, entry.id, photoUserVoted, activePhotoIndex]);

  const confirmUnvote = useCallback(() => {
    setShowUnvoteConfirm(false);
    toggleVote(entry.id, true, activePhotoIndex);
  }, [toggleVote, entry.id, activePhotoIndex]);

  const handlePOTD = useCallback(() => {
    markAsPOTD(entry);
  }, [markAsPOTD, entry]);

  const copyEntryLink = useCallback(() => {
    navigator.clipboard.writeText(`${window.location.origin}${buildCompetitionPhotoPath(entry.id, activePhotoIndex)}`);
    toast({ title: "Photo link copied!" });
  }, [activePhotoIndex, entry.id]);


  return (
    <motion.div
      key={entry.id}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className={`border overflow-hidden group rounded-xl md:rounded-lg transition-all duration-500 hover:shadow-xl hover:-translate-y-0.5 ${
        competitionPhase === "result" && photoPlacement === "winner"
          ? "border-yellow-500/70 ring-2 ring-yellow-500/30 shadow-[0_0_30px_-4px_hsl(45_100%_50%/0.3)]"
          : competitionPhase === "result" && photoPlacement === "1st_runner_up"
          ? "border-[hsl(0_0%_70%)]/50 ring-1 ring-[hsl(0_0%_75%)]/20 shadow-[0_0_20px_-4px_hsl(0_0%_70%/0.25)]"
          : competitionPhase === "result" && photoPlacement === "2nd_runner_up"
          ? "border-amber-700/50 ring-1 ring-amber-700/20 shadow-[0_0_20px_-4px_hsl(30_80%_40%/0.25)]"
          : isJudging && isOwn ? "border-primary ring-1 ring-primary/30"
          : "border-border hover:border-primary/30"
      }`}
    >
      {entry.photos.length > 0 && (
        <div
          className="relative aspect-square overflow-hidden bg-muted cursor-pointer"
          onClick={handleLightbox}
        >
          <img
            src={activeThumbnailUrl}
            srcSet={buildEntryCardSrcSet(activeThumbnailUrl)}
            sizes="(max-width: 768px) 100vw, 600px"
            alt={activePhotoTitle}
            className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-[1.2s] ease-out select-none"
            loading="lazy"
            decoding="async"
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
          />
          {/* Watermark overlay during judging */}
          <PhaseWatermark phase={competitionPhase} currentRound={competitionCurrentRound} surface="card" />

          {/* Judging tag stamps — only in result phase */}
          {competitionPhase === "result" && activePhotoR4Tag && (
            <EntryTagStamps entryId={entry.id} photoIndex={activePhotoIndex} />
          )}
          {/* Status / placement badges — PER PHOTO (not per entry).
              Label text comes from PARTICIPANT_PLACEMENT_LABELS (canonical
              v3 contract). Only icon + visual classes are local. `most_viewed`
              is a UI-only badge with no canonical contract entry. */}
          {(() => {
            const PLACEMENT_VISUAL: Record<string, { icon: string; classes: string; sizeClasses: string }> = {
              winner:             { icon: "🏆", classes: "bg-gradient-to-r from-yellow-500 to-amber-500 text-background shadow-lg shadow-yellow-500/40 animate-pulse",         sizeClasses: "top-2.5 left-2.5 text-[10px] tracking-[0.2em] font-bold px-4 py-2 rounded-md" },
              "1st_runner_up":    { icon: "🥈", classes: "bg-gradient-to-r from-[hsl(0_0%_62%)] to-[hsl(0_0%_75%)] text-background shadow-md",                                  sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              "2nd_runner_up":    { icon: "🥉", classes: "bg-gradient-to-r from-amber-700 to-amber-600 text-background shadow-md",                                              sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              honorary_mention:   { icon: "🎖", classes: "bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-md",                                                    sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              honourable_mention: { icon: "🎖", classes: "bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-md",                                                    sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              special_jury:       { icon: "⚖️", classes: "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md",                                                sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              top_50:             { icon: "🌟", classes: "bg-gradient-to-r from-fuchsia-600 to-pink-500 text-white shadow-md",                                                  sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              top_100:            { icon: "✨", classes: "bg-gradient-to-r from-violet-600 to-purple-500 text-white shadow-md",                                                 sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              finalist:           { icon: "⭐", classes: "bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-md",                                                 sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              qualified_final:    { icon: "⭐", classes: "bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-md",                                                 sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] font-semibold px-3 py-1.5 rounded-sm" },
              most_viewed:        { icon: "👁", classes: "bg-primary/90 text-primary-foreground shadow-md",                                                                    sizeClasses: "top-2 left-2 text-[9px] tracking-[0.2em] px-3 py-1.5 rounded-sm" },
            };
            if (!photoPlacement) return null;
            const visual = PLACEMENT_VISUAL[photoPlacement];
            if (!visual) return null;
            // most_viewed is UI-only (no canonical contract entry) → fallback string.
            const label = PARTICIPANT_PLACEMENT_LABELS[photoPlacement] ?? (photoPlacement === "most_viewed" ? "Most Viewed" : photoPlacement);
            return (
              <span
                className={`absolute uppercase ${visual.sizeClasses} ${visual.classes}`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {visual.icon} {label}
              </span>
            );
          })()}
          {/* Round qualification — strictly per photo. Label text is sourced from
              the canonical participant wording contract (`participantStageLabel`)
              so it stays word-for-word in sync with EntryTagStamps (Marked 2).
              Only icon + color classes are defined locally. */}
          {!photoPlacement && perPhotoStatus !== "winner" && competitionPhase !== "submission_open" && (() => {
            // Visual map keyed by perPhotoStatus. Retired/forbidden keys
            // (round2_not_selected, round3_not_selected, needs_verification)
            // are intentionally omitted — they are no longer part of the
            // v3 participant wording contract. needs_verification is handled
            // by the dedicated `showVerificationRequired` indicator above.
            const STATUS_VISUAL: Record<string, { icon: string; classes: string }> = {
              // R1 outcomes
              r1_accepted:         { icon: "✓", classes: "bg-emerald-600/90 text-white" },
              r1_shortlisted_r2:   { icon: "★", classes: "bg-amber-600/90 text-white" },
              r1_rejected:         { icon: "✗", classes: "bg-red-600/90 text-white" },
              r1_needs_review:     { icon: "⚠", classes: "bg-yellow-500/90 text-white" },
              round1_qualified:    { icon: "✓", classes: "bg-emerald-600/90 text-white" },
              shortlisted:         { icon: "★", classes: "bg-amber-600/90 text-white" }, // R1 → R2 promotion
              // R2 outcomes
              r2_accepted:         { icon: "✓", classes: "bg-cyan-600/90 text-white" },
              r2_qualified_r3:     { icon: "★", classes: "bg-blue-600/90 text-white" },
              round2_qualified:    { icon: "★", classes: "bg-blue-600/90 text-white" }, // legacy alias
              // R3 outcomes
              r3_accepted:         { icon: "✓", classes: "bg-indigo-600/90 text-white" },
              r3_qualified_final:  { icon: "⭐", classes: "bg-purple-600/90 text-white" },
              finalist:            { icon: "⭐", classes: "bg-purple-600/90 text-white" }, // legacy alias
              // Negative / interim
              needs_review:        { icon: "⚠", classes: "bg-yellow-500/90 text-white" },
              rejected:            { icon: "✗", classes: "bg-red-600/90 text-white" },
            };
            const visual = STATUS_VISUAL[perPhotoStatus];
            if (!visual) return null;
            const label = participantStageLabel(perPhotoStatus);
            return (
              <span
                className={`absolute top-2.5 left-2.5 text-[8px] tracking-[0.15em] uppercase px-3 py-1.5 ${visual.classes} backdrop-blur-sm rounded-md font-semibold shadow-sm`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {visual.icon} {label}
              </span>
            );
          })()}
          {/* "Your Entry" indicator during judging */}
          {isJudging && isOwn && (
            <span className="absolute top-2 right-2 text-[8px] tracking-[0.15em] uppercase px-2.5 py-1 bg-primary/80 text-primary-foreground backdrop-blur-sm rounded-sm" style={{ fontFamily: "var(--font-heading)" }}>
              Your Entry
            </span>
          )}
        </div>
      )}

      {/* MOBILE FOOTER — compact app-style card */}
      <div className="block md:hidden">
        {/* Line 1: Title | By Author | Vote */}
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
          <h4 className="text-xs font-semibold tracking-tight truncate flex-1 min-w-0" style={{ fontFamily: "var(--font-display)" }}>
            {activePhotoTitle}
          </h4>
          {competitionPhase !== "judging" && (
            <div className="inline-flex items-center gap-1 shrink-0 min-w-0 max-w-[120px]">
              <span className="text-[9px] text-muted-foreground shrink-0">by</span>
              <UserIdentityBlock
                userId={entry.user_id}
                name={entry.profiles?.full_name || "Anonymous"}
                linkTo={`/profile/${entry.user_id}`}
                nameClassName="text-[9px] truncate hover:text-primary hover:underline transition-colors [font-family:var(--font-body)]"
              />
            </div>
          )}
          {competitionPhase === "voting" && !isOwn && (
            <button
              onClick={handleVote}
              disabled={isVoting}
              className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md border shrink-0 transition-all duration-300 active:scale-95 disabled:opacity-50 ${
                photoUserVoted
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Heart className={`h-3 w-3 ${photoUserVoted ? "fill-primary" : ""}`} />
              {photoVoteCount}
            </button>
          )}
          {competitionPhase === "judging" && judgingStatusChip}
          {competitionPhase === "voting" && isOwn && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md border border-border text-muted-foreground/50 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
              <Heart className="h-3 w-3" /> {photoVoteCount}
            </span>
          )}
          {competitionPhase === "result" && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 border border-border text-muted-foreground rounded-md shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
              <Heart className="h-3 w-3" /> {photoVoteCount}
            </span>
          )}
        </div>

        {/* Line 2: Description (2 lines, tap to expand handled by lightbox).
            U-03: Per-photo title (above) always renders since it identifies the
            individual image, not the photographer. Only the description and
            author attribution are suppressed during judging. */}
        {competitionPhase !== "judging" && activePhotoDescription && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 px-3 pb-1.5 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
            {activePhotoDescription}
          </p>
        )}
        {competitionPhase === "judging" && (
          <p className="text-[9px] text-muted-foreground/60 italic px-3 pb-1.5" style={{ fontFamily: "var(--font-body)" }}>
            Photographer hidden during judging · per-photo title shown above
          </p>
        )}

        {/* Share / View entry actions */}
        <div className="flex items-center border-t border-border/50">
          <Link
            to={buildCompetitionPhotoPath(entry.id, activePhotoIndex)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[9px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <ExternalLink className="h-3 w-3" /> View Photo
          </Link>
          <button
            onClick={copyEntryLink}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[9px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors border-l border-border/50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Copy className="h-3 w-3" /> Copy Photo
          </button>
        </div>

        {/* Engagement stats — compact (hidden during voting/judging) */}
        {!hideEngagement && <EngagementFooter id={entry.id} createdAt={entry.created_at} />}

        {/* Admin POTD button */}
        {competitionPhase === "result" && isAdmin && entry.photos.length > 0 && (
          <button
            onClick={handlePOTD}
            disabled={isMarkingPOTD}
            className="w-full inline-flex items-center justify-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2 border-t border-yellow-500/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition-all duration-300"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Star className="h-3 w-3" /> Photo of the Day
          </button>
        )}
        {/* Reactions — only in result phase */}
        {competitionPhase === "result" && (
          <div className="border-t border-border/50 px-3 py-2">
            <ImageEngagement imageType="competition_entry" imageId={entry.id} photoIndex={activePhotoIndex} />
          </div>
        )}
      </div>

      {/* DESKTOP FOOTER — compact two-line layout */}
      <div className="hidden md:block px-3.5 py-3">
        {/* Line 1: Title + Author + Vote/Status */}
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold tracking-tight truncate flex-1 min-w-0" style={{ fontFamily: "var(--font-display)" }}>{activePhotoTitle}</h4>
          {competitionPhase !== "judging" && (
            <div className="inline-flex items-center gap-1 shrink-0 min-w-0 max-w-[140px]">
              <span className="text-[9px] text-muted-foreground shrink-0">by</span>
              <UserIdentityBlock
                userId={entry.user_id}
                name={entry.profiles?.full_name || "Anonymous"}
                linkTo={`/profile/${entry.user_id}`}
                nameClassName="text-[9px] truncate hover:text-primary hover:underline transition-colors [font-family:var(--font-body)]"
              />
            </div>
          )}
          {competitionPhase === "voting" && !isOwn && (
            <button
              onClick={handleVote}
              disabled={isVoting}
              className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md border shrink-0 transition-all duration-300 active:scale-95 disabled:opacity-50 ${
                photoUserVoted
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Heart className={`h-3 w-3 ${photoUserVoted ? "fill-primary" : ""} ${isVoting ? "animate-pulse" : ""}`} />
              {photoVoteCount}
            </button>
          )}
          {competitionPhase === "voting" && isOwn && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md border border-border text-muted-foreground/50 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
              <Heart className="h-3 w-3" /> {photoVoteCount}
            </span>
          )}
          {competitionPhase === "result" && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 border border-border text-muted-foreground rounded-md shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
              <Heart className="h-3 w-3" /> {photoVoteCount}
            </span>
          )}
          {competitionPhase === "judging" && judgingStatusChip}
        </div>

        {/* Line 2: Description (if any).
            U-03: Per-photo title (above) always renders. Only description +
            author attribution are suppressed during judging. */}
        {competitionPhase !== "judging" && activePhotoDescription && (
          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-1 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
            {activePhotoDescription}
          </p>
        )}
        {competitionPhase === "judging" && (
          <p className="text-[9px] text-muted-foreground/60 italic mt-1" style={{ fontFamily: "var(--font-body)" }}>
            Photographer hidden during judging · per-photo title shown above
          </p>
        )}

        {/* Actions row */}
        <div className="flex items-center border-t border-border/50 mt-2 pt-2">
          <Link
            to={buildCompetitionPhotoPath(entry.id, activePhotoIndex)}
            className="flex-1 flex items-center justify-center gap-1.5 text-[9px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <ExternalLink className="h-3 w-3" /> View Photo
          </Link>
          <button
            onClick={copyEntryLink}
            className="flex-1 flex items-center justify-center gap-1.5 text-[9px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors border-l border-border/50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Copy className="h-3 w-3" /> Copy Photo
          </button>
        </div>
        {!hideEngagement && <EngagementFooter id={entry.id} createdAt={entry.created_at} className="px-0 border-t border-border/50 pt-2" />}
        {competitionPhase === "result" && isAdmin && entry.photos.length > 0 && (
          <button
            onClick={handlePOTD}
            disabled={isMarkingPOTD}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition-all duration-300"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Star className="h-3 w-3" /> Photo of the Day
          </button>
        )}
        {competitionPhase === "result" && (
          <div className="border-t border-border/50 pt-2 mt-2">
            <ImageEngagement imageType="competition_entry" imageId={entry.id} photoIndex={activePhotoIndex} />
          </div>
        )}
      </div>

      {/* U-01: Unvote confirmation — surfaces 2× penalty before deduction */}
      <AlertDialog open={showUnvoteConfirm} onOpenChange={setShowUnvoteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remove your vote?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removing your vote deducts <strong>2× the original reward</strong> from your wallet.
              This action is recorded and cannot be undone for this photo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my vote</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnvote}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove vote &amp; accept penalty
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
};

export default React.memo(EntryCard);
