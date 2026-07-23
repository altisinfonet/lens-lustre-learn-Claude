import { useState, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Cake, Newspaper, Vote, Coins, PartyPopper } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useT } from "@/i18n/I18nContext";
import CompetitionLightbox from "@/components/CompetitionLightbox";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import AnonymousSidebarFallback from "@/components/AnonymousSidebarFallback";
import type { SidebarData } from "@/hooks/core/useDashboardInit";
import { useCompetitionVoting } from "@/hooks/competition/useCompetitionVoting";
import { useCompetitionVoteRealtime } from "@/hooks/competition/useCompetitionVoteRealtime";
import {
  buildCompetitionVotingPhotoKey,
  mapSidebarVotingEntriesToVotingPhotos,
  mergeCompetitionVotingPhotoPools,
} from "@/lib/competitionVotingPhotos";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

interface LeftSidebarSections {
  vote_and_earn: boolean;
  trending: boolean;
  milestones: boolean;
  journal: boolean;
  todays_birthday: boolean;
}

const defaultSections: LeftSidebarSections = {
  vote_and_earn: true,
  trending: true,
  milestones: true,
  journal: true,
  todays_birthday: true,
};

interface FeedLeftSidebarProps {
  sidebarData?: SidebarData | null;
  isLoading?: boolean;
}

const FeedLeftSidebar = ({ sidebarData, isLoading: dashboardLoading }: FeedLeftSidebarProps) => {
  const { user, loading } = useAuth();
  const t = useT();
  const hadUserRef = useRef(false);
  const [lightboxSelection, setLightboxSelection] = useState<{ entryId: string; photoIndex: number } | null>(null);
  const { toggleVote, isVoting } = useCompetitionVoting({ competitionId: "", userId: user?.id });

  useCompetitionVoteRealtime({ includeDashboard: true });

  // Derive all data from sidebarData — ZERO independent fetches
  const sections = useMemo<LeftSidebarSections>(() => {
    if (!sidebarData?.sections) return defaultSections;
    return { ...defaultSections, ...(sidebarData.sections as any) };
  }, [sidebarData?.sections]);

  const votingThumbnails = useMemo(
    () => mapSidebarVotingEntriesToVotingPhotos(sidebarData?.voting_thumbnails ?? [], { sort: false }),
    [sidebarData?.voting_thumbnails],
  );
  const votingEntries = useMemo(
    () => mapSidebarVotingEntriesToVotingPhotos(sidebarData?.voting_entries ?? []),
    [sidebarData?.voting_entries],
  );
  const votingPhotos = useMemo(
    () => mergeCompetitionVotingPhotoPools(votingThumbnails, votingEntries),
    [votingEntries, votingThumbnails],
  );
  const visibleVotingEntries = useMemo(() => votingThumbnails.slice(0, 6), [votingThumbnails]);
  const currentLightboxIndex = useMemo(() => {
    if (!lightboxSelection) return 0;
    const key = buildCompetitionVotingPhotoKey(lightboxSelection.entryId, lightboxSelection.photoIndex);
    const index = votingPhotos.findIndex((p) => buildCompetitionVotingPhotoKey(p.entryId, p.photoIndex) === key);
    return index >= 0 ? index : 0;
  }, [lightboxSelection, votingPhotos]);
  const trendingPhotos = sidebarData?.trending ?? [];
  const milestones = sidebarData?.milestones ?? [];
  const journalPreviews = sidebarData?.journal ?? [];
  const birthdayUsers = sidebarData?.birthdays ?? [];

  if (loading || dashboardLoading) return <div className="space-y-5" />;
  if (!user && !hadUserRef.current) return <AnonymousSidebarFallback type="left" />;
  if (!user && hadUserRef.current) return <div className="space-y-5" />;

  hadUserRef.current = true;

  return (
    <div className="space-y-5">
      {/* Vote & Earn */}
      {sections.vote_and_earn && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <Coins className="h-3 w-3" />
              {t("sidebar.voteEarn")}
            </span>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed" style={bodyFont}>
              {t("sidebar.voteEarnDesc")}
            </p>
            {visibleVotingEntries.length > 0 && (
              <div className="grid grid-cols-3 gap-1">
                {visibleVotingEntries.map((entry) => (
                  <button
                    key={`${entry.entryId}-${entry.photoIndex}`}
                    onClick={() => setLightboxSelection({ entryId: entry.entryId, photoIndex: entry.photoIndex })}
                    className="relative aspect-square overflow-hidden rounded-sm group"
                  >
                    <img
                      src={entry.photoUrl}
                      alt={entry.entryTitle}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <Vote className="h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            )}
            <Link
              to="/competitions"
              className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2 bg-primary/10 text-primary hover:bg-primary/20 transition-colors rounded-sm w-full justify-center"
              style={headingFont}
            >
              <Vote className="h-3 w-3" />
              {t("sidebar.startVoting")}
            </Link>
          </div>
        </div>
      )}

      {/* Trending Photos */}
      {sections.trending && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <TrendingUp className="h-3 w-3" />
              {t("sidebar.trending")}
            </span>
          </div>
          {trendingPhotos.length > 0 ? (
            <div className="grid grid-cols-2 gap-1 p-2">
              {trendingPhotos.map((photo: any) => (
                <div key={photo.id} className="relative group aspect-square overflow-hidden rounded-sm">
                  <img src={photo.image_url} alt={photo.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[8px] text-white truncate" style={headingFont}>{photo.title}</p>
                    <span className="text-[7px] text-white/70" style={bodyFont}>❤️ {photo.reaction_count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground" style={bodyFont}>No trending photos this week</p>
            </div>
          )}
        </div>
      )}

      {/* Membership Anniversaries */}
      {sections.milestones && milestones.length > 0 && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <Cake className="h-3 w-3" />
              Membership Anniversaries
            </span>
          </div>
          <div className="divide-y divide-border">
            {milestones.map((m: any) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/profile/${m.id}`} className="shrink-0">
                  {m.avatar_url ? (
                    <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={m.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-[10px] text-primary" style={displayFont}>{(m.full_name || "?")[0]?.toUpperCase()}</span>
                    </div>
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <UserIdentityBlock
                    userId={m.id}
                    name={m.full_name || "Photographer"}
                    linkTo={`/profile/${m.id}`}
                    nameClassName="text-xs font-medium truncate hover:text-primary transition-colors"
                  />
                  <span className="text-[9px] text-muted-foreground" style={bodyFont}>
                    🎉 {m.years} {m.years === 1 ? "year" : "years"} today!
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest from Journal */}
      {sections.journal && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <Newspaper className="h-3 w-3" />
              {t("sidebar.latestJournal")}
            </span>
          </div>
          {journalPreviews.length > 0 ? (
            <div className="divide-y divide-border">
              {journalPreviews.map((article: any) => (
                <Link key={article.id} to={`/journal/${article.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  {article.cover_image_url ? (
                    <img loading="lazy" decoding="async" src={article.cover_image_url} alt="" className="w-12 h-9 rounded-sm object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-9 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
                      <Newspaper className="h-4 w-4 text-primary/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium line-clamp-2 leading-snug" style={headingFont}>{article.title}</p>
                    {article.published_at && (
                      <span className="text-[9px] text-muted-foreground" style={bodyFont}>
                        {new Date(article.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground" style={bodyFont}>No articles published yet</p>
            </div>
          )}
          <div className="px-4 py-2 border-t border-border">
            <Link to="/journal" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
              {t("sidebar.readMore")} →
            </Link>
          </div>
        </div>
      )}

      {/* Today's Birthday */}
      {sections.todays_birthday && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <PartyPopper className="h-3 w-3" />
              Today's Birthday
            </span>
          </div>
          {birthdayUsers.length > 0 ? (
            <div className="divide-y divide-border">
              {birthdayUsers.map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <Link to={`/profile/${u.id}`} className="shrink-0">
                    {u.avatar_url ? (
                      <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-[10px] text-primary" style={displayFont}>{(u.full_name || "?")[0]?.toUpperCase()}</span>
                      </div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <UserIdentityBlock
                      userId={u.id}
                      name={u.full_name || "Photographer"}
                      linkTo={`/profile/${u.id}`}
                      nameClassName="text-xs font-medium truncate hover:text-primary transition-colors"
                    />
                    <span className="text-[9px] text-muted-foreground" style={bodyFont}>
                      🎂 Happy Birthday!
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground" style={bodyFont}>No birthdays today</p>
            </div>
          )}
        </div>
      )}

      {/* Unified Voting Lightbox */}
      {votingPhotos.length > 0 && (
        <CompetitionLightbox
          images={votingPhotos}
          currentIndex={currentLightboxIndex}
          isOpen={lightboxSelection !== null}
          onClose={() => setLightboxSelection(null)}
          onPrev={() => {
            const ni = currentLightboxIndex > 0 ? currentLightboxIndex - 1 : votingPhotos.length - 1;
            const p = votingPhotos[ni];
            if (p) setLightboxSelection({ entryId: p.entryId, photoIndex: p.photoIndex });
          }}
          onNext={() => {
            const ni = currentLightboxIndex < votingPhotos.length - 1 ? currentLightboxIndex + 1 : 0;
            const p = votingPhotos[ni];
            if (p) setLightboxSelection({ entryId: p.entryId, photoIndex: p.photoIndex });
          }}
          onVote={(entryId, hasVoted, photoIndex) => {
            if (!isVoting) toggleVote(entryId, hasVoted, photoIndex);
          }}
          competitionPhase="voting"
        />
      )}
    </div>
  );
};

export default FeedLeftSidebar;
