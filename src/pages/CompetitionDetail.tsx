import { Link, useParams, useNavigate } from "react-router-dom";
import { Calendar, Clock, Trophy, Heart, Upload, Users, Star, Camera, Award, PartyPopper, Medal, Scale } from "lucide-react";
import PhaseBanner from "@/components/PhaseBanner";
import CompetitionLightbox from "@/components/CompetitionLightbox";
import EntryCard from "@/components/EntryCard";
import Breadcrumbs from "@/components/Breadcrumbs";
import VotingLightbox from "@/components/VotingLightbox";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";

import { motion } from "framer-motion";
import PageSEO from "@/components/PageSEO";
import { useState, useMemo, useCallback, useEffect } from "react";

import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { toast } from "@/hooks/core/use-toast";
import { useCompetitionDetail } from "@/hooks/competition/useCompetitionDetail";
import { useCompetitionVoting } from "@/hooks/competition/useCompetitionVoting";
import { useCompetitionAdmin } from "@/hooks/competition/useCompetitionAdmin";
import { useCompetitionVoteRealtime } from "@/hooks/competition/useCompetitionVoteRealtime";
import { queryKeys } from "@/lib/queryKeys";
import { phaseStatusColors, phaseDisplayLabels } from "@/lib/competitionPhase";
import { mapCompetitionEntriesToVotingPhotos } from "@/lib/competitionVotingPhotos";
import RoundPublishPanel from "@/components/admin/RoundPublishPanel";
import PersonalResultBanner from "@/components/competition/PersonalResultBanner";
import { useEntryPublicStatus } from "@/hooks/judging/useEntryPublicStatus";
import { useT } from "@/i18n/I18nContext";


interface Competition {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  category: string;
  entry_fee: number;
  prize_info: string | null;
  status: string;
  phase: string;
  current_round: string | null;
  max_entries_per_user: number;
  max_photos_per_entry: number;
  starts_at: string;
  ends_at: string;
  ai_images_allowed: boolean;
}

interface Entry {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  user_id: string;
  status: string;
  created_at: string;
  placement: string | null;
  profiles: { full_name: string | null } | null;
  vote_count: number;
  user_voted: boolean;
  badges: string[];
}

// statusColors removed — using phaseStatusColors from competitionPhase utility

const CompetitionDetail = () => {
  const t = useT();
  const { id: slugOrId, entryId: urlEntryId, photoIndex: urlPhotoIndex } = useParams<{ id: string; entryId?: string; photoIndex?: string }>();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const { data, isLoading: loading, fetchNextPage, hasNextPage, isFetchingNextPage } = useCompetitionDetail(slugOrId, user?.id);

  const competition = data?.competition || null;
  const entries = data?.entries ?? [];
  
  const userEntryCount = data?.userEntryCount ?? 0;
  const { toggleVote: rawToggleVote, isVoting } = useCompetitionVoting({ competitionId: competition?.id || "", userId: user?.id });
  const { markAsPOTD: rawMarkAsPOTD, isMarkingPOTD } = useCompetitionAdmin();

  const toggleVote = useCallback(
    (entryId: string, hasVoted: boolean, photoIndex?: number) => rawToggleVote(entryId, hasVoted, photoIndex),
    [rawToggleVote]
  );
  const markAsPOTD = useCallback(
    (entry: any) => rawMarkAsPOTD(entry),
    [rawMarkAsPOTD]
  );
  const [lightboxSelection, setLightboxSelection] = useState<{ entryId: string; photoIndex: number } | null>(null);
  const [showVotingLightbox, setShowVotingLightbox] = useState(false);

  useCompetitionVoteRealtime({ competitionId: competition?.id, includeDashboard: true });

  const photoItems = useMemo(() => mapCompetitionEntriesToVotingPhotos(entries), [entries]);
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  // Audit v6 P-01 — Single Source of Truth for placement / status badges on
  // public entry cards. We pass publicPlacement / publicStatus into <EntryCard>
  // so it never has to read entry.placement / entry.status directly.
  const entryIdsForGate = useMemo(() => entries.map((e) => e.id), [entries]);
  const { data: gatedStatusMap = {} } = useEntryPublicStatus(entryIdsForGate);
  const lightboxIndex = useMemo(() => {
    if (!lightboxSelection) return 0;
    const index = photoItems.findIndex(
      (photo) => photo.entryId === lightboxSelection.entryId && photo.photoIndex === lightboxSelection.photoIndex,
    );
    return index >= 0 ? index : 0;
  }, [lightboxSelection, photoItems]);

  const selectLightboxPhoto = useCallback((index: number) => {
    const nextPhoto = photoItems[index];
    if (!nextPhoto) return;
    setLightboxSelection({ entryId: nextPhoto.entryId, photoIndex: nextPhoto.photoIndex });
  }, [photoItems]);

  const openLightbox = useCallback((entryId: string, photoIndex: number) => {
    setLightboxSelection({ entryId, photoIndex });
  }, []);

  // Sync lightbox state ↔ URL (Facebook-style per-photo URLs)
  const baseCompetitionPath = useMemo(
    () => (slugOrId ? `/competitions/${slugOrId}` : null),
    [slugOrId],
  );

  // Read URL on mount / change → open lightbox
  useEffect(() => {
    if (!urlEntryId || urlPhotoIndex === undefined) return;
    const pi = Number.parseInt(urlPhotoIndex, 10);
    if (!Number.isFinite(pi) || pi < 0) return;
    setLightboxSelection((prev) =>
      prev && prev.entryId === urlEntryId && prev.photoIndex === pi
        ? prev
        : { entryId: urlEntryId, photoIndex: pi },
    );
  }, [urlEntryId, urlPhotoIndex]);

  // Push URL when lightbox photo changes
  useEffect(() => {
    if (!baseCompetitionPath) return;
    if (lightboxSelection) {
      const target = `${baseCompetitionPath}/entry/${lightboxSelection.entryId}/photo/${lightboxSelection.photoIndex}`;
      if (window.location.pathname !== target) {
        navigate(target, { replace: true });
      }
    } else if (urlEntryId) {
      // Lightbox was closed → strip /entry/.../photo/... back to base
      navigate(baseCompetitionPath, { replace: true });
    }
  }, [lightboxSelection, baseCompetitionPath, navigate, urlEntryId]);

  const lightboxPrev = useCallback(() => {
    if (photoItems.length === 0) return;
    const nextIndex = lightboxIndex > 0 ? lightboxIndex - 1 : photoItems.length - 1;
    selectLightboxPhoto(nextIndex);
  }, [lightboxIndex, photoItems.length, selectLightboxPhoto]);

  const lightboxNext = useCallback(() => {
    if (photoItems.length === 0) return;
    const nextIndex = lightboxIndex < photoItems.length - 1 ? lightboxIndex + 1 : 0;
    selectLightboxPhoto(nextIndex);
  }, [lightboxIndex, photoItems.length, selectLightboxPhoto]);


  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>{t("common.loading")}</div>
      </main>
    );
  }

  if (!competition) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-light mb-4" style={{ fontFamily: "var(--font-display)" }}>{t("cdet.notFound")}</h1>
          <Link to="/competitions" className="text-xs text-primary tracking-[0.15em] uppercase hover:underline" style={{ fontFamily: "var(--font-heading)" }}>{t("dash.browseCompetitions")}</Link>
        </div>
      </main>
    );
  }

  const canSubmit = competition.phase === "submission_open" && user && userEntryCount < competition.max_entries_per_user;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={competition.title}
        description={competition.description || undefined}
        ogImage={competition.cover_image_url || undefined}
        jsonLd={{
          type: "Event",
          name: competition.title,
          description: competition.description || undefined,
          image: competition.cover_image_url || undefined,
          startDate: competition.starts_at,
          endDate: competition.ends_at,
        }}
      />
      <div className="container mx-auto pt-3 pb-0">
        <Breadcrumbs items={[
          { label: t("nav.competitions"), to: "/competitions" },
          { label: competition.title },
        ]} className="mb-3" />
      </div>
      {/* Hero */}
      <div className="relative h-48 md:h-96 overflow-hidden bg-muted">
        {competition.cover_image_url ? (
          <img loading="eager" decoding="async" fetchPriority="high" src={competition.cover_image_url} alt={competition.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-card to-background" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 container mx-auto pb-4 md:pb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[9px] tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{competition.category}</span>
            <span className={`text-[9px] tracking-[0.2em] uppercase px-3 py-1 border ${phaseStatusColors[competition.phase] || ""}`} style={{ fontFamily: "var(--font-heading)" }}>
              {t("phase." + competition.phase, phaseDisplayLabels[competition.phase] || competition.phase)}
            </span>
          </div>
          <h1 className="text-xl md:text-5xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            {competition.title}
          </h1>
        </div>
      </div>

      {/* Phase Banner with Countdown */}
      <PhaseBanner competition={competition} />

      {/* Judging in Progress banner — visible to all users during judging phase */}
      {competition.phase === "judging" && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="container mx-auto mt-4 md:mt-6"
        >
          <div className="flex items-center gap-4 px-5 py-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <Scale className="h-6 w-6 shrink-0 animate-pulse" />
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                {t("cdet.judgingGoingOn")}
              </p>
              <p className="text-xs opacity-80" style={{ fontFamily: "var(--font-body)" }}>
                {t("cdet.judgingGoingOnDesc")}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Personal result feedback banner — Judging v5: gated on per-round publish */}
      <PersonalResultBanner
        phase={competition.phase}
        userId={user?.id}
        entries={entries}
      />

      <div className="container mx-auto py-4 md:py-12">
        <div className="flex flex-col gap-4 md:gap-12">
          {/* Main content */}
          <div>
            {competition.description && (
              <div className="mb-4 md:mb-12">
                <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-2 md:mb-3" style={{ fontFamily: "var(--font-heading)" }}>{t("cdet.about")}</span>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line" style={{ fontFamily: "var(--font-body)" }}>
                  {competition.description}
                </p>
              </div>
            )}

            {/* Entries — One card per photo */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                  {t("cdet.submissions")} ({photoItems.length})
                </span>
                <div className="flex items-center gap-3">
                  {competition.phase === "voting" && photoItems.length > 0 && (
                    <button
                      onClick={() => setShowVotingLightbox(true)}
                      className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-primary text-primary hover:bg-primary/10 transition-colors duration-500"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <Heart className="h-3 w-3" /> {t("cdet.quickVote")}
                    </button>
                  )}
                  {canSubmit && (
                    <Link
                      to={`/competitions/${slugOrId}/submit`}
                      className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <Upload className="h-3 w-3" /> {t("cdet.submitEntry")}
                    </Link>
                  )}
                </div>
              </div>

              {photoItems.length === 0 ? (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-20 border border-dashed border-border rounded-xl">
                  <Camera className="h-10 w-10 text-muted-foreground/15 mx-auto mb-4" />
                  <p className="text-sm font-medium text-muted-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                    {t("cdet.noSubmissions")}
                  </p>
                  <p className="text-xs text-muted-foreground/60 mb-4" style={{ fontFamily: "var(--font-body)" }}>
                    {t("cdet.beFirst")}
                  </p>
                  {canSubmit && (
                    <button onClick={() => navigate(`/competitions/${slugOrId}/submit`)} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                      {t("cdet.submitEntry")}
                    </button>
                  )}
                </motion.div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-1 gap-3 md:gap-5">
                  {photoItems.map((img) => {
                    const entry = entryMap.get(img.entryId);
                    if (!entry) return null;
                    const ps = gatedStatusMap[img.entryId];
                    return (
                      <EntryCard
                        key={`${img.entryId}-${img.photoIndex}`}
                        entry={entry}
                        displayPhotoUrl={img.photoUrl}
                        displayThumbnailUrl={img.thumbnailUrl}
                        displayPhotoIndex={img.photoIndex}
                        competitionPhase={competition.phase}
                        competitionCurrentRound={competition.current_round}
                        userId={user?.id}
                        isAdmin={isAdmin}
                        isVoting={isVoting}
                        isMarkingPOTD={isMarkingPOTD}
                        openLightbox={openLightbox}
                        toggleVote={toggleVote}
                        markAsPOTD={markAsPOTD}
                        publicPlacement={ps?.public_placement ?? null}
                        publicStatus={ps?.public_status ?? "judging_in_progress"}
                      />
                    );
                  })}
                </div>
              )}

              {/* Infinite scroll sentinel */}
              <InfiniteScrollSentinel
                onLoadMore={() => fetchNextPage()}
                hasNextPage={!!hasNextPage}
                isFetching={isFetchingNextPage}
                showEndMarker={false}
              />
            </div>

          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            <div className="border border-border p-4 md:p-6 space-y-4 md:space-y-5 rounded-xl md:rounded-none">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>{t("cdet.details")}</span>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                <div style={{ fontFamily: "var(--font-body)" }}>
                  <div>{t("cdet.opens")} {new Date(competition.starts_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
                  <div>{t("cdet.closes")} {new Date(competition.ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
                </div>
              </div>

              {competition.entry_fee > 0 && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  <span style={{ fontFamily: "var(--font-body)" }}>{t("cdet.entryFee")} ${competition.entry_fee}</span>
                </div>
              )}

              {competition.prize_info && (
                <div className="flex items-start gap-3 text-xs text-muted-foreground">
                  <Trophy className="h-3.5 w-3.5 text-primary mt-0.5" />
                  <span style={{ fontFamily: "var(--font-body)" }}>{competition.prize_info}</span>
                </div>
              )}

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5 text-primary" />
                <span style={{ fontFamily: "var(--font-body)" }}>{t("cdet.maxPhotos")} {competition.max_photos_per_entry}</span>
              </div>

              {/* AI Policy */}
              <div className={`flex items-start gap-3 text-xs ${competition.ai_images_allowed ? 'text-muted-foreground' : 'text-orange-600 dark:text-orange-400'}`}>
                <span className="text-base mt-[-2px]">{competition.ai_images_allowed ? '✅' : '🚫'}</span>
                <span style={{ fontFamily: "var(--font-body)" }}>
                  {competition.ai_images_allowed
                    ? t("cdet.aiAllowed")
                    : t("cdet.aiNotAllowed")
                  }
                </span>
              </div>
            </div>

            {/* Judging v5 — Admin-only Round Publish controls */}
            {isAdmin && competition?.id && (
              <RoundPublishPanel competitionId={competition.id} />
            )}

            {canSubmit && (
              <Link
                to={`/competitions/${slugOrId}/submit`}
                className="block w-full text-center py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {t("cdet.submitYourEntry")}
              </Link>
            )}

            {competition.phase === "submission_open" && !user && (
              <Link
                to="/login"
                className="block w-full text-center py-3.5 border border-primary text-primary text-xs tracking-[0.2em] uppercase hover:bg-primary hover:text-primary-foreground transition-all duration-500"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {t("cdet.loginToSubmit")}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Competition Lightbox */}
      <CompetitionLightbox
        images={photoItems}
        currentIndex={lightboxIndex}
        isOpen={lightboxSelection !== null && photoItems.length > 0}
        onClose={() => setLightboxSelection(null)}
        onPrev={lightboxPrev}
        onNext={lightboxNext}
        onVote={(entryId, hasVoted, photoIndex) => { if (!isVoting) toggleVote(entryId, hasVoted, photoIndex); }}
        competitionPhase={competition.phase}
      />
      {showVotingLightbox && photoItems.length > 0 && (
        <VotingLightbox
          entries={photoItems.map((p) => ({
            id: p.entryId,
            title: entryMap.get(p.entryId)?.title || "",
            photo_url: p.photoUrl,
            competition_title: competition.title,
            photo_index: p.photoIndex,
          }))}
          startIndex={0}
          onClose={() => setShowVotingLightbox(false)}
          onVoted={() => {}}
          onPhotoChange={(entryId, photoIndex) => {
            if (baseCompetitionPath) {
              navigate(`${baseCompetitionPath}/entry/${entryId}/photo/${photoIndex}`, { replace: true });
            }
          }}
        />
      )}
    </main>
  );
};

export default CompetitionDetail;
