import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { ArrowLeft, Trophy, Share2, Copy, MessageCircle, Globe, Heart, Scale } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import { toast } from "@/hooks/core/use-toast";
import CommentsSection from "@/components/CommentsSection";
import EngagementFooter from "@/components/EngagementFooter";
import FacebookPhotoGrid from "@/components/FacebookPhotoGrid";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import ImageEngagement from "@/components/ImageEngagement";
import UserNextStepPanel from "@/components/UserNextStepPanel";
import PageSEO from "@/components/PageSEO";
import Breadcrumbs from "@/components/Breadcrumbs";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import PublicJudgeScoresReveal from "@/components/competition/PublicJudgeScoresReveal";
import { resolveCompetitionPhase } from "@/lib/competitionPhase";
import { useCompetitionVoting } from "@/hooks/competition/useCompetitionVoting";
import { buildCompetitionPhotoPath, clampCompetitionPhotoIndex } from "@/lib/competitionVotingPhotos";
import { fetchEntryFinalVotes } from "@/lib/finalVoteTotals";
import { useGatedEntryStatus, resolveDisplayStatus } from "@/hooks/judging/useGatedEntryStatus";
import { PARTICIPANT_PLACEMENT_LABELS, normalizePlacementKey } from "@/lib/judging/participantStageLabels";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

// Plan Phase 5 / Task 5.6 — labels sourced from PARTICIPANT_PLACEMENT_LABELS
// (mirror of v3_stage_catalog). Only emoji + className live here.
const PLACEMENT_CONFIG: Record<string, { label: string; emoji: string; className: string }> = {
  winner:          { label: PARTICIPANT_PLACEMENT_LABELS.winner,          emoji: "🏆", className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  "1st_runner_up": { label: PARTICIPANT_PLACEMENT_LABELS["1st_runner_up"], emoji: "🥈", className: "bg-slate-300/10 text-slate-500 border-slate-400/30" },
  "2nd_runner_up": { label: PARTICIPANT_PLACEMENT_LABELS["2nd_runner_up"], emoji: "🥉", className: "bg-amber-700/10 text-amber-700 border-amber-600/30" },
  honorary_mention: { label: PARTICIPANT_PLACEMENT_LABELS.honorary_mention, emoji: "🎖️", className: "bg-purple-500/10 text-purple-600 border-purple-500/30" },
  special_jury:     { label: PARTICIPANT_PLACEMENT_LABELS.special_jury,     emoji: "🏅", className: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30" },
  top_50:           { label: PARTICIPANT_PLACEMENT_LABELS.top_50,           emoji: "⭐", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  top_100:          { label: PARTICIPANT_PLACEMENT_LABELS.top_100,          emoji: "🌟", className: "bg-teal-500/10 text-teal-600 border-teal-500/30" },
  finalist:         { label: PARTICIPANT_PLACEMENT_LABELS.finalist,         emoji: "🏵️", className: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30" },
};

interface EntryData {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  user_id: string;
  status: string;
  placement: string | null;
  created_at: string;
  competition_id: string;
  competition_title: string;
  author_name: string | null;
  author_avatar: string | null;
  vote_count: number;
  user_voted: boolean;
  competitionPhase: string;
  competitionCurrentRound: string | null;
  photoVoteCounts: Record<number, number>;
  userVotedPhotos: number[];
}

const EntryDetail = () => {
  const { entryId } = useParams<{ entryId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<EntryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { downloading, download: downloadImg } = useDownloadImage();

  const [searchParams, setSearchParams] = useSearchParams();
  const { toggleVoteAsync, isVoting } = useCompetitionVoting({
    competitionId: entry?.competition_id || "",
    userId: user?.id,
  });

  // SINGLE SOURCE OF TRUTH for entry visibility — never read entry.status / placement directly.
  const gatedQuery = useGatedEntryStatus(entry ? [entry.id] : []);
  const gatedRow = entry ? gatedQuery.data?.[entry.id] : undefined;
  const displayStatus = resolveDisplayStatus(gatedRow);
  const displayPlacement = gatedRow?.public_placement ?? null;

  const currentPhotoParam = searchParams.get("photo");
  const selectedPhotoIndex = clampCompetitionPhotoIndex(currentPhotoParam, entry?.photos.length ?? 1);
  const selectedPhotoVoteCount = entry?.photoVoteCounts[selectedPhotoIndex] ?? 0;
  const selectedPhotoUserVoted = entry?.userVotedPhotos.includes(selectedPhotoIndex) ?? false;
  const selectedPhotoUrl = entry?.photos[selectedPhotoIndex] || entry?.photos[0] || undefined;

  useEffect(() => {
    if (!entryId) return;
    const load = async () => {
      setLoading(true);
      const { data: raw, error } = await supabase
        .from("competition_entries")
        .select("*, competitions(title, starts_at, ends_at, voting_ends_at, judging_completed, phase, status, current_round)")
        .eq("id", entryId)
        .maybeSingle();

      if (error || !raw) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const comp = (raw as any).competitions || {};
      const phase = resolveCompetitionPhase({
        starts_at: comp.starts_at,
        ends_at: comp.ends_at,
        voting_ends_at: comp.voting_ends_at,
        judging_completed: comp.judging_completed,
        phase: comp.phase,
        status: comp.status,
      });

      const profileMap = await fetchProfileMap([raw.user_id]);
      // BUG-080: fetchProfileMap returns a Map — bracket access is always undefined.
      const profile = profileMap.get(raw.user_id);

      const [{ totals: finalTotals, perPhoto: finalPerPhoto }, { data: userVoteRows }] = await Promise.all([
        fetchEntryFinalVotes([entryId]),
        user
          ? supabase
              .from("competition_votes")
              .select("photo_index")
              .eq("entry_id", entryId)
              .eq("user_id", user.id)
          : Promise.resolve({ data: null }),
      ]);

      const photoVoteCounts = Object.fromEntries(
        Object.entries(finalPerPhoto[entryId] ?? {}).map(([photoIndex, total]) => [Number(photoIndex), Number(total ?? 0)]),
      ) as Record<number, number>;

      // User's voted photo indices
      const userVotedPhotos = (userVoteRows || []).map((v: any) => v.photo_index ?? 0);

      setEntry({
        id: raw.id,
        title: raw.title,
        description: raw.description,
        photos: raw.photos || [],
        user_id: raw.user_id,
        status: raw.status,
        placement: raw.placement,
        created_at: raw.created_at,
        competition_id: raw.competition_id,
        competition_title: comp.title || "Competition",
        author_name: profile?.full_name || null,
        author_avatar: profile?.avatar_url || null,
        vote_count: Number(finalTotals[entryId] ?? 0),
        user_voted: false, // deprecated for per-photo
        competitionPhase: phase,
        competitionCurrentRound: comp.current_round ?? null,
        photoVoteCounts,
        userVotedPhotos,
      });
      setLoading(false);
    };
    load();
  }, [entryId, user?.id]);

  const handleVote = useCallback(async () => {
    if (!entry || !user) {
      toast({ title: "Please login to vote" });
      return;
    }
    const delta = selectedPhotoUserVoted ? -1 : 1;
    try {
      await toggleVoteAsync(entry.id, selectedPhotoUserVoted, selectedPhotoIndex);
      setEntry((prev) => {
        if (!prev) return prev;
        const nextPhotoVoteCounts = {
          ...prev.photoVoteCounts,
          [selectedPhotoIndex]: Math.max(0, (prev.photoVoteCounts[selectedPhotoIndex] ?? 0) + delta),
        };
        const nextUserVotedPhotos = selectedPhotoUserVoted
          ? prev.userVotedPhotos.filter((i) => i !== selectedPhotoIndex)
          : Array.from(new Set([...prev.userVotedPhotos, selectedPhotoIndex])).sort((a, b) => a - b);
        return { ...prev, vote_count: Math.max(0, prev.vote_count + delta), user_voted: nextUserVotedPhotos.length > 0, photoVoteCounts: nextPhotoVoteCounts, userVotedPhotos: nextUserVotedPhotos };
      });
    } catch { /* toast handled in hook */ }
  }, [entry, selectedPhotoIndex, selectedPhotoUserVoted, toggleVoteAsync, user]);

  const handlePhotoChange = useCallback((photoIndex: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("photo", String(clampCompetitionPhotoIndex(photoIndex, entry?.photos.length ?? 1)));
    setSearchParams(next, { replace: true });
  }, [entry?.photos.length, searchParams, setSearchParams]);

  const copyLink = () => {
    if (!entryId) return;
    navigator.clipboard.writeText(`${window.location.origin}${buildCompetitionPhotoPath(entryId, selectedPhotoIndex)}`);
    toast({ title: "Photo link copied!" });
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>Loading…</span>
      </main>
    );
  }

  if (notFound || !entry) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground" style={bodyFont}>Entry not found or has been removed.</p>
        <button onClick={() => navigate(-1)} className="text-xs text-primary hover:underline" style={headingFont}>Go back</button>
      </main>
    );
  }

  const ogImage = selectedPhotoUrl;
  const ogDescription = entry.description?.slice(0, 160) || `${entry.title} — competition entry on 50mm Retina World`;
  // Publish-gated: never show placement until Round 4 published.
  // BUG-032: normalize token/enum placement forms before lookup.
  const placementCfg = displayPlacement ? PLACEMENT_CONFIG[normalizePlacementKey(displayPlacement) ?? displayPlacement] : null;
  const isVotingPhase = entry.competitionPhase === "voting";
  const isResultPhase = entry.competitionPhase === "result";
  const isJudgingPhase = entry.competitionPhase === "judging";
  const isOwnEntry = user?.id === entry.user_id;
  const photoPath = buildCompetitionPhotoPath(entry.id, selectedPhotoIndex);

  return (
    <>
      <PageSEO
        title={entry.title}
        description={ogDescription}
        ogImage={ogImage}
        ogType="article"
      />

      <div className="py-3 md:py-14 max-w-2xl mx-auto px-2 md:px-0">
        {/* Breadcrumbs */}
        <Breadcrumbs items={[
          { label: "Competitions", to: "/competitions" },
          { label: entry.competition_title || "Competition", to: entry.competition_id ? `/competitions/${entry.competition_id}` : "/competitions" },
          { label: entry.title },
        ]} className="mb-4" />

        {/* Back */}
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary mb-4 transition-colors" style={headingFont}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <div className="border border-border rounded-xl md:rounded-none overflow-hidden">
          {/* Header */}
          <div className="p-3 pb-2">
            <div className="flex items-center gap-2.5 mb-2">
              <Link to={`/profile/${entry.user_id}`} className="shrink-0">
                {entry.author_avatar ? (
                  <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={entry.author_avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm text-primary" style={displayFont}>{(entry.author_name || "?")[0]?.toUpperCase()}</span>
                  </div>
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <UserIdentityBlock
                  userId={entry.user_id}
                  name={entry.author_name || "Photographer"}
                  linkTo={`/profile/${entry.user_id}`}
                  nameClassName="text-sm font-light hover:text-primary transition-colors truncate [font-family:var(--font-heading)]"
                />
                <Link to={`/competitions/${entry.competition_id}`} className="text-[10px] text-muted-foreground hover:text-primary transition-colors" style={headingFont}>
                  {entry.competition_title}
                </Link>
              </div>
            </div>

            <h1 className="text-base font-semibold" style={displayFont}>{entry.title}</h1>
            {entry.description && (
              <p className="text-[13px] leading-relaxed text-muted-foreground mt-1 whitespace-pre-wrap" style={bodyFont}>{entry.description}</p>
            )}

            {placementCfg && (
              <div className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full border text-[10px] tracking-[0.1em] uppercase ${placementCfg.className}`} style={headingFont}>
                <span>{placementCfg.emoji}</span> {placementCfg.label}
              </div>
            )}
          </div>

          {/* Photos */}
          {entry.photos.length > 0 && (
            <div>
              {entry.photos.length === 1 ? (
                <div className="relative group/img">
                  <img src={entry.photos[0]} alt={entry.title} className="w-full" loading="lazy" onContextMenu={(e) => e.preventDefault()} draggable={false} />
                  <PhaseWatermark
                    phase={entry.competitionPhase}
                    currentRound={entry.competitionCurrentRound}
                    surface="card"
                  />
                  <DownloadButton
                    downloading={downloading === entry.photos[0]}
                    onClick={(e) => { e.stopPropagation(); downloadImg(entry.photos[0]); }}
                    className="absolute bottom-3 right-3 p-2 rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-card shadow-sm disabled:opacity-60"
                  />
                </div>
              ) : (
                <div className="relative">
                  <FacebookPhotoGrid urls={entry.photos} />
                  <PhaseWatermark
                    phase={entry.competitionPhase}
                    currentRound={entry.competitionCurrentRound}
                    surface="card"
                  />
                </div>
              )}
            </div>
          )}

          {/* Judging banner */}
          {isJudgingPhase && (
            <div className="flex items-center gap-3 px-3 py-3 bg-amber-500/10 border-t border-amber-500/20">
              <Scale className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-pulse shrink-0" />
              <span className="text-[10px] text-amber-700 dark:text-amber-400 italic" style={headingFont}>
                ⚖️ Under Review — Judging is in progress
              </span>
            </div>
          )}

          {/* Competitor status panel — own entry during judging/result. Uses GATED status. */}
          {isOwnEntry && (isJudgingPhase || isResultPhase) && (
            <div className="px-3 py-2">
              <UserNextStepPanel status={displayStatus} />
            </div>
          )}

          {/* Stats — only show vote count during voting or result */}
          <div className="flex items-center gap-3 px-3 py-2 text-[10px] text-muted-foreground" style={headingFont}>
            {(isVotingPhase || isResultPhase) && selectedPhotoVoteCount > 0 && (
              <span>❤️ {selectedPhotoVoteCount} {selectedPhotoVoteCount === 1 ? "vote" : "votes"}</span>
            )}
            {isJudgingPhase && (
              <span className="italic text-muted-foreground/40">Votes hidden during judging</span>
            )}
            {!isVotingPhase && !isJudgingPhase && <EngagementFooter id={entry.id} createdAt={entry.created_at} inline />}
          </div>

          {/* Actions */}
          <div className="mx-2.5 border-t border-border">
            <div className="flex">
              {/* Vote button — ONLY during voting phase */}
              {isVotingPhase && (
                <button
                  onClick={handleVote}
                  disabled={isVoting}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md my-1 text-sm font-semibold transition-all duration-300 active:scale-95 disabled:opacity-50 ${
                    selectedPhotoUserVoted
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-primary hover:bg-muted/50"
                  }`}
                >
                  <Heart className={`h-5 w-5 ${selectedPhotoUserVoted ? "fill-primary" : ""} ${isVoting ? "animate-pulse" : ""}`} />
                  {selectedPhotoUserVoted ? "Voted" : "Vote"}
                </button>
              )}
              <button
                onClick={copyLink}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md my-1 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <Share2 className="h-5 w-5" /> Share
              </button>
              <Link
                to={`/competitions/${entry.competition_id}`}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md my-1 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <Trophy className="h-5 w-5" /> View Competition
              </Link>
            </div>
          </div>

          {/* SOW C-4: per-judge per-criterion reveal — RPC self-gates on round.status='completed' */}
          {isResultPhase && (
            <PublicJudgeScoresReveal
              competitionId={entry.competition_id}
              entryId={entry.id}
              photoIndex={selectedPhotoIndex}
            />
          )}

          {/* Comments & Reactions — ONLY during result phase (NOT during voting) */}
          {isResultPhase && (
            <>
              <div className="border-t border-border/50 px-3 py-2">
                <ImageEngagement imageType="competition_entry" imageId={entry.id} photoIndex={selectedPhotoIndex} />
              </div>
              <CommentsSection entryId={entry.id} />
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default EntryDetail;
