import { useState, useRef, useMemo, useEffect } from "react";
import AdZone from "@/components/ads/AdZone";
import { Link } from "react-router-dom";
import ProfileLink from "@/components/ProfileLink";
import { UserPlus, Users, Trophy, Clock, BookOpen, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { useT } from "@/i18n/I18nContext";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import AnonymousSidebarFallback from "@/components/AnonymousSidebarFallback";
import SidebarTopContributors from "@/components/sidebar/SidebarTopContributors";
import type { SidebarData } from "@/hooks/core/useDashboardInit";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

interface RightSidebarSections {
  sponsored: boolean;
  people_you_may_know: boolean;
  competitions: boolean;
  courses: boolean;
  winners: boolean;
}

const defaultSections: RightSidebarSections = {
  sponsored: true,
  people_you_may_know: true,
  competitions: true,
  courses: true,
  winners: true,
};

interface FeedRightSidebarProps {
  sidebarData?: SidebarData | null;
  isLoading?: boolean;
}

const FeedRightSidebar = ({ sidebarData, isLoading: dashboardLoading }: FeedRightSidebarProps) => {
  const { user, loading } = useAuth();
  const t = useT();
  const hadUserRef = useRef(false);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());

  // Derive all data from sidebarData â ZERO independent fetches
  const sections = useMemo<RightSidebarSections>(() => {
    if (!sidebarData?.sections) return defaultSections;
    return { ...defaultSections, ...(sidebarData.sections as any) };
  }, [sidebarData?.sections]);

  const rawSuggestions = sidebarData?.suggestions ?? [];
  const upcomingComps = sidebarData?.competitions ?? [];
  const coursePreviews = sidebarData?.courses ?? [];
  const winners = sidebarData?.winners ?? [];

  // Admin profiles cannot receive friend requests (follow-only).
  // Probe each suggestion via has_role SECURITY DEFINER RPC and drop admins.
  useEffect(() => {
    if (rawSuggestions.length === 0) return;
    let cancelled = false;
    (async () => {
      const checks = await Promise.all(
        rawSuggestions.map(async (s: any) => {
          const { data } = await supabase.rpc("app_has_role" as any, { _user_id: s.id, _role: "admin" });
          return { id: s.id, isAdmin: !!data };
        })
      );
      if (cancelled) return;
      setAdminIds(new Set(checks.filter((c) => c.isAdmin).map((c) => c.id)));
    })();
    return () => { cancelled = true; };
  }, [rawSuggestions]);

  const suggestions = rawSuggestions.filter((s: any) => !adminIds.has(s.id));

  const sendFriendRequest = async (targetId: string) => {
    if (!user) return;
    const { error } = await supabase.from("friendships").insert({
      requester_id: user.id,
      addressee_id: targetId,
      status: "pending",
    });
    if (!error) {
      setRequestedIds((prev) => new Set(prev).add(targetId));
    }
  };

  const timeUntil = (dateStr: string) => {
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff <= 0) return "Now";
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days}d left`;
    const hrs = Math.floor(diff / 3600000);
    return `${hrs}h left`;
  };

  const placementIcon = (p: string | null) => {
    if (!p) return "ð";
    const lower = p.toLowerCase();
    if (lower === "gold" || lower === "1st") return "ð¥";
    if (lower === "silver" || lower === "2nd") return "ð¥";
    if (lower === "bronze" || lower === "3rd") return "ð¥";
    return "ð";
  };

  if (loading || dashboardLoading) return <div className="space-y-5" />;
  if (!user && !hadUserRef.current) return <AnonymousSidebarFallback type="right" />;
  if (!user && hadUserRef.current) return <div className="space-y-5" />;

  hadUserRef.current = true;

  return (
    <div className="space-y-5">
      <AdZone zone="sidebar" />

      {/* People You May Know */}
      {sections.people_you_may_know && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <Users className="h-3 w-3" />
              {t("sidebar.peopleYouMayKnow")}
            </span>
          </div>
          <div className="divide-y divide-border">
            {suggestions.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-[10px] text-muted-foreground" style={bodyFont}>No suggestions yet</p>
              </div>
            ) : (
              suggestions.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <ProfileLink userId={s.id} className="shrink-0">
                    {s.avatar_url ? (
                      <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={s.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-xs text-primary" style={displayFont}>
                          {(s.full_name || "?")[0]?.toUpperCase()}
                        </span>
                      </div>
                    )}
                  </ProfileLink>
                  <div className="flex-1 min-w-0">
                    <UserIdentityBlock
                      userId={s.id}
                      name={s.full_name || "Photographer"}
                      linkTo={`/profile/${s.id}`}
                      nameClassName="text-xs font-medium truncate hover:text-primary transition-colors"
                    />
                    {s.mutual_count > 0 && (
                      <span className="text-[9px] text-muted-foreground" style={bodyFont}>
                        {s.mutual_count} mutual {s.mutual_count === 1 ? "friend" : "friends"}
                      </span>
                    )}
                  </div>
                  {requestedIds.has(s.id) ? (
                    <span className="text-[8px] tracking-[0.15em] uppercase text-muted-foreground px-2 py-1 border border-border rounded-sm" style={headingFont}>
                      Sent
                    </span>
                  ) : (
                    <button
                      onClick={() => sendFriendRequest(s.id)}
                      className="inline-flex items-center gap-1 text-[8px] tracking-[0.15em] uppercase px-2 py-1 border border-primary/40 text-primary hover:bg-primary/10 transition-all rounded-sm"
                      style={headingFont}
                    >
                      <UserPlus className="h-3 w-3" /> Add
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="px-4 py-2 border-t border-border">
            <Link to="/discover" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
              See All â
            </Link>
          </div>
        </div>
      )}

      {/* Upcoming Competitions */}
      {sections.competitions && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <Trophy className="h-3 w-3" />
              Competitions
            </span>
          </div>
          {upcomingComps.length > 0 ? (
            <div className="divide-y divide-border">
              {upcomingComps.map((comp: any) => (
                <Link key={comp.id} to={`/competitions/${comp.slug || comp.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  {comp.cover_image_url ? (
                    <img loading="lazy" decoding="async" src={comp.cover_image_url} alt="" className="w-10 h-10 rounded-sm object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
                      <Trophy className="h-4 w-4 text-primary/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={headingFont}>{comp.title}</p>
                    <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground" style={bodyFont}>
                      <Clock className="h-2.5 w-2.5" />
                      {comp.phase === "submission_open"
                        ? timeUntil(comp.ends_at)
                        : comp.phase === "voting"
                        ? `Voting ends ${new Date(comp.voting_ends_at || comp.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : comp.phase === "upcoming"
                        ? `Starts ${new Date(comp.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : comp.phase === "judging"
                        ? "Judging in progress"
                        : "Results announced"}
                    </span>
                  </div>
                  <span className={`text-[7px] tracking-[0.15em] uppercase px-1.5 py-0.5 border rounded-sm ${
                    comp.phase === "submission_open" ? "text-green-500 border-green-500/40"
                    : comp.phase === "voting" ? "text-emerald-500 border-emerald-500/40"
                    : comp.phase === "judging" ? "text-yellow-500 border-yellow-500/40"
                    : comp.phase === "upcoming" ? "text-blue-500 border-blue-500/40"
                    : "text-muted-foreground border-muted-foreground/40"
                  }`} style={headingFont}>
                    {comp.phase === "submission_open" ? "Open"
                      : comp.phase === "voting" ? "Voting"
                      : comp.phase === "judging" ? "Judging"
                      : comp.phase === "upcoming" ? "Upcoming"
                      : "Results"}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground" style={bodyFont}>No upcoming competitions</p>
            </div>
          )}
          <div className="px-4 py-2 border-t border-border">
            <Link to="/competitions" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
              View All â
            </Link>
          </div>
        </div>
      )}

      {/* Recent Courses */}
      {sections.courses && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <BookOpen className="h-3 w-3" />
              Recent Courses
            </span>
          </div>
          {coursePreviews.length > 0 ? (
            <div className="divide-y divide-border">
              {coursePreviews.map((course: any) => (
                <Link key={course.id} to={`/courses/${course.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  {course.cover_image_url ? (
                    <img loading="lazy" decoding="async" src={course.cover_image_url} alt="" className="w-12 h-9 rounded-sm object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-9 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
                      <BookOpen className="h-4 w-4 text-primary/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={headingFont}>{course.title}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground" style={bodyFont}>{course.difficulty}</span>
                      {course.is_free && (
                        <span className="text-[7px] tracking-[0.15em] uppercase text-green-500 border border-green-500/40 px-1 py-0.5 rounded-sm" style={headingFont}>Free</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground" style={bodyFont}>No courses available yet</p>
            </div>
          )}
          <div className="px-4 py-2 border-t border-border">
            <Link to="/courses" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
              Browse Courses â
            </Link>
          </div>
        </div>
      )}

      {/* Top Contributors â anonymous only */}
      {!user && <SidebarTopContributors />}

      {sections.winners && (
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5" style={headingFont}>
              <Award className="h-3 w-3" />
              Winners
            </span>
          </div>
          {winners.length > 0 ? (
            <div className="divide-y divide-border">
              {winners.map((w: any) => (
                <Link key={w.id} to={`/competitions`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  {w.photos?.[0] ? (
                    <img loading="lazy" decoding="async" src={w.photos[0]} alt="" className="w-10 h-10 rounded-sm object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
                      <Award className="h-4 w-4 text-primary/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {w.user_avatar ? (
                        <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={w.user_avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                      ) : null}
                      <span className="text-[9px] text-muted-foreground truncate" style={bodyFont}>
                        {w.user_name || "Photographer"}
                      </span>
                    </div>
                    <p className="text-xs font-medium truncate" style={headingFont}>{w.title}</p>
                    <span className="text-[8px] text-muted-foreground" style={bodyFont}>
                      {placementIcon(w.placement)} {w.competition_title}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center">
              <p className="text-[10px] text-muted-foreground" style={bodyFont}>No winners yet</p>
            </div>
          )}
          <div className="px-4 py-2 border-t border-border">
            <Link to="/winners" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
              View All Winners â
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedRightSidebar;
