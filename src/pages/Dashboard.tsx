import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  User, Camera, Trophy, Calendar, Edit2, Shield, Briefcase, Send, CheckCircle,
  Clock, XCircle, Award, GraduationCap, Wallet, UserCheck, UserX, Users,
  MessageSquare, Heart, Globe, Lock, Settings, ImageIcon, Rss, ExternalLink,
  KeyRound, Mail, MapPin, Phone, ChevronRight, Eye, TrendingUp, Star
} from "lucide-react";
import ParticipantStageBadge, { ParticipantStageTimeline } from "@/components/judge/ParticipantStageBadge";
import { PARTICIPANT_PLACEMENT_LABELS, participantLabelForJudgingTag, normalizePlacementKey } from "@/lib/judging/participantStageLabels";
import PhotographerUpgradeCard from "@/components/PhotographerUpgradeCard";
import UserNextStepPanel from "@/components/UserNextStepPanel";
import JudgingStampBadge from "@/components/JudgingStampBadge";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { useApplyForRole, usePasswordReset } from "@/hooks/dashboard/useDashboardMutations";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { useAcceptFriendRequest, useRemoveFriendship } from "@/hooks/social/useFriendshipMutations";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/core/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

import VerificationRequestCard from "@/components/profile/VerificationRequestCard";
import ActiveDevices from "@/components/ActiveDevices";
import DeleteAccountSection from "@/components/settings/DeleteAccountSection";
import ProfileAnalytics from "@/components/profile/ProfileAnalytics";
import UserBadgeInline from "@/components/UserBadgeInline";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveBadges } from "@/lib/adminBrand";
import { useDashboardData, type MyCompEntry, type FriendRequest, type RecentPost, type RoleApplication } from "@/hooks/dashboard/useDashboardData";
import { useEntryPublicStatus, type EntryPublicStatusRow } from "@/hooks/judging/useEntryPublicStatus";
import { useUserEntriesInfinite } from "@/hooks/competition/useUserEntries";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
/* ───── animation helpers ───── */
const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
};
const tabContent = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

/* ───── types ───── */
interface Profile { full_name: string | null; avatar_url: string | null; bio: string | null; portfolio_url: string | null; photography_interests: string[] | null; created_at: string; city?: string; state?: string; country?: string; phone?: string; }
interface UserRole { role: string; created_at: string; }
interface ImageReport { photo_index: number; scores: { score: number; feedback: string | null }[]; comments: string[]; avg: number | null; }
interface CompGroup { competition_id: string; competition_slug: string | null; competition_title: string; competition_status: string; competition_current_round: string | null; competition_cover: string | null; entries: MyCompEntry[]; all_tags: { label: string; color: string; icon?: string; image_url?: string | null }[]; has_certificate: boolean; certificate_id: string | null; }

type TabKey = "overview" | "submissions" | "social" | "settings";

const TABS: { key: TabKey; label: string; icon: React.ElementType; }[] = [
  { key: "overview", label: "Overview", icon: TrendingUp },
  { key: "submissions", label: "My Submissions", icon: ImageIcon },
  { key: "social", label: "Social", icon: Users },
  { key: "settings", label: "Settings", icon: Settings },
];

/* ================================================================ */
const Dashboard = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const acceptFriendMutation = useAcceptFriendRequest();
  const removeFriendMutation = useRemoveFriendship();
  const applyForRoleMutation = useApplyForRole();
  const passwordResetMutation = usePasswordReset();
  const queryClient = useQueryClient();

  const activeTab = (searchParams.get("tab") as TabKey) || "overview";
  const setTab = (t: TabKey) => setSearchParams({ tab: t }, { replace: true });

  const { data: profileCore } = useProfileCore(user?.id);
  const profile = profileCore as (Profile | null);
  const { data: dashboardData, isLoading: dashLoading } = useDashboardData(user?.id);

  const roles = dashboardData?.roles || [];
  const applications = dashboardData?.applications || [];
  const friendRequests = dashboardData?.friendRequests || [];
  const recentPosts = dashboardData?.recentPosts || [];
  const myEntries = dashboardData?.myEntries || [];
  const upcomingComps = dashboardData?.upcomingComps || [];
  const certificates = dashboardData?.certificates || [];
  const enrollments = dashboardData?.enrollments || [];
  const suggestedPeople = dashboardData?.suggestedPeople || [];
  const userBadges = dashboardData?.userBadges || [];
  const loading = dashLoading;

  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyRole, setApplyRole] = useState<"judge" | "content_editor" | "registered_photographer">("judge");
  const [applyReason, setApplyReason] = useState("");
  const [applyPortfolio, setApplyPortfolio] = useState("");
  const [applyExperience, setApplyExperience] = useState("");
  const submitting = applyForRoleMutation.isPending;
  const [friendActionLoading, setFriendActionLoading] = useState<string | null>(null);
  const sendingReset = passwordResetMutation.isPending;
  const [statusFilter, setStatusFilter] = useState<string>("all");

  /* ── stats ── */
  const totalVotes = useMemo(() => myEntries.reduce((s, e) => s + e.vote_count, 0), [myEntries]);

  // Audit v6 P-01..P-06 — Single Source of Truth: entry status displayed
  // anywhere on the dashboard MUST come from useEntryPublicStatus / useGated-
  // EntryStatus, never from the raw `entry.status` column. Reading the raw
  // column leaks unpublished round outcomes (e.g. "rejected" / "shortlisted"
  // appearing on the photographer's submission card before the admin clicks
  // Publish Round N).
  const allEntryIdsForStatus = useMemo(
    () => myEntries.map(e => e.id).filter(Boolean),
    [myEntries],
  );
  const { data: publicStatusMap = {} } = useEntryPublicStatus(allEntryIdsForStatus);
  const gatedStatusOf = useCallback((e: MyCompEntry): string => {
    const ps = publicStatusMap[e.id];
    return ps?.public_status || "judging_in_progress";
  }, [publicStatusMap]);

  const filteredEntries = statusFilter === "all"
    ? myEntries
    : myEntries.filter(e => gatedStatusOf(e) === statusFilter);
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: myEntries.length };
    myEntries.forEach(e => {
      const s = gatedStatusOf(e);
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [myEntries, gatedStatusOf]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  // Realtime: listen to friendships filtered to current user only
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'friendships',
        filter: `requester_id=eq.${user.id}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(user.id) });
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'friendships',
        filter: `addressee_id=eq.${user.id}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(user.id) });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, queryClient]);

  /* ── handlers ── */
  const handleFriendAction = async (friendshipId: string, action: "accept" | "decline", requesterId?: string) => {
    setFriendActionLoading(friendshipId);
    try {
      if (action === "accept") {
        await acceptFriendMutation.mutateAsync({ friendshipId, targetUserId: requesterId || friendshipId });
      } else {
        await removeFriendMutation.mutateAsync(friendshipId);
      }
      if (user) queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(user.id) });
    } catch { /* errors handled by mutation hooks */ }
    setFriendActionLoading(null);
  };

  const handleApply = async () => {
    if (!user) return;
    if (!applyReason.trim()) { toast({ title: "Please provide a reason", variant: "destructive" }); return; }
    applyForRoleMutation.mutate(
      {
        userId: user.id,
        role: applyRole,
        reason: applyReason.trim().slice(0, 1000),
        portfolioUrl: applyPortfolio.trim().slice(0, 500) || null,
        experience: applyExperience.trim().slice(0, 1000) || null,
      },
      {
        onSuccess: () => {
          setShowApplyForm(false); setApplyReason(""); setApplyPortfolio(""); setApplyExperience("");
        },
      },
    );
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    passwordResetMutation.mutate(user.email);
  };

  if (authLoading || loading || !user) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>Loading...</div>
      </main>
    );
  }

  const memberSince = profile?.created_at ? new Date(profile.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long" }) : "—";
  const displayName = profile?.full_name || "Photographer";
  const initials = displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const hasRole = (role: string) => roles.some((r) => r.role === role);
  const getRoleDate = (role: string) => { const r = roles.find((r) => r.role === role); return r ? new Date(r.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : ""; };
  const hasPendingApp = (role: string) => applications.some((a) => a.requested_role === role && a.status === "pending");
  const canApplyFor = (role: string) => !hasRole(role) && !hasPendingApp(role);
  const appStatusIcon = (status: string) => {
    switch (status) { case "pending": return <Clock className="h-3.5 w-3.5 text-accent-foreground" />; case "approved": return <CheckCircle className="h-3.5 w-3.5 text-primary" />; case "rejected": return <XCircle className="h-3.5 w-3.5 text-destructive" />; default: return null; }
  };


  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-10 max-w-6xl">
{/* ═══════ Profile Header Bar ═══════ */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}
          className="flex flex-col sm:flex-row items-center sm:items-start gap-3 p-3 md:p-5 border border-border mb-3 md:mb-4 bg-card/30 rounded-xl md:rounded-none"
        >
          {/* Avatar */}
          <Link to="/profile" className="shrink-0 group">
            {profile?.avatar_url ? (
              <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={profile.avatar_url} alt={displayName} className="w-14 h-14 rounded-full object-cover border-2 border-border group-hover:border-primary transition-colors" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center border-2 border-border group-hover:border-primary transition-colors">
                <span className="text-lg font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{initials}</span>
              </div>
            )}
          </Link>

          {/* Info */}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div className="flex items-center gap-2 justify-center sm:justify-start flex-wrap">
              <h1 className="text-lg md:text-xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>{displayName}</h1>
              {userBadges.length > 0 && <UserBadgeInline badges={userBadges} size="full" />}
              <TooltipProvider>
                {hasRole("admin") && (
                  <Tooltip><TooltipTrigger><span className="text-[8px] tracking-[0.2em] uppercase px-2 py-0.5 bg-primary text-primary-foreground rounded-full" style={{ fontFamily: "var(--font-heading)" }}>Admin</span></TooltipTrigger><TooltipContent>Since {getRoleDate("admin")}</TooltipContent></Tooltip>
                )}
                {hasRole("judge") && (
                  <Tooltip><TooltipTrigger><span className="text-[8px] tracking-[0.2em] uppercase px-2 py-0.5 bg-accent text-accent-foreground rounded-full" style={{ fontFamily: "var(--font-heading)" }}>Judge</span></TooltipTrigger><TooltipContent>Since {getRoleDate("judge")}</TooltipContent></Tooltip>
                )}
                {hasRole("registered_photographer") && (
                  <Tooltip><TooltipTrigger><span className="text-[8px] tracking-[0.2em] uppercase px-2 py-0.5 bg-primary/20 text-primary rounded-full" style={{ fontFamily: "var(--font-heading)" }}>Photographer</span></TooltipTrigger><TooltipContent>Verified {getRoleDate("registered_photographer")}</TooltipContent></Tooltip>
                )}
                {hasRole("content_editor") && (
                  <Tooltip><TooltipTrigger><span className="text-[8px] tracking-[0.2em] uppercase px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full" style={{ fontFamily: "var(--font-heading)" }}>Contributor</span></TooltipTrigger><TooltipContent>Since {getRoleDate("content_editor")}</TooltipContent></Tooltip>
                )}
                {hasRole("student") && (
                  <Tooltip><TooltipTrigger><span className="text-[8px] tracking-[0.2em] uppercase px-2 py-0.5 bg-accent/20 text-accent-foreground rounded-full" style={{ fontFamily: "var(--font-heading)" }}>Student</span></TooltipTrigger><TooltipContent>Since {getRoleDate("student")}</TooltipContent></Tooltip>
                )}
              </TooltipProvider>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
              {user.email} · Member since {memberSince}
            </p>
          </div>

          {/* Quick stat pills */}
          <div className="flex gap-3 shrink-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex flex-col items-center px-3 py-1.5 border border-border rounded-sm hover:border-primary/50 transition-colors cursor-default">
                    <span className="text-base font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{myEntries.length}</span>
                    <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Entries</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Total competition entries submitted</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex flex-col items-center px-3 py-1.5 border border-border rounded-sm hover:border-primary/50 transition-colors cursor-default">
                    <span className="text-base font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{totalVotes}</span>
                    <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Votes</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Total votes received on entries</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex flex-col items-center px-3 py-1.5 border border-border rounded-sm hover:border-primary/50 transition-colors cursor-default">
                    <span className="text-base font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{friendRequests.length}</span>
                    <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Requests</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Pending friend requests</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </motion.div>

        {/* ═══════ Tab Navigation ═══════ */}
        <div className="flex items-center gap-0 border-b border-border mb-3 md:mb-4 overflow-x-auto scrollbar-hide sticky top-0 z-20 bg-background/95 backdrop-blur-md -mx-2 px-2 md:mx-0 md:px-0">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const badge = tab.key === "social" && friendRequests.length > 0 ? friendRequests.length : tab.key === "submissions" && myEntries.length > 0 ? myEntries.length : null;
            return (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key)}
                className={`relative flex items-center gap-1 px-3 md:px-4 py-2.5 md:py-3 text-[9px] md:text-[10px] tracking-[0.15em] md:tracking-[0.2em] uppercase transition-colors whitespace-nowrap ${
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
                {badge && (
                  <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[1rem] px-1 text-[8px] bg-primary text-primary-foreground rounded-full">
                    {badge}
                  </span>
                )}
                {isActive && (
                  <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                )}
              </button>
            );
          })}
        </div>

        {/* ═══════ Tab Content ═══════ */}
        <AnimatePresence mode="wait">
          {activeTab === "overview" && (
            <motion.div key="overview" {...tabContent}>
              {/* Photographer Upgrade CTA — show if user doesn't have the role */}
              {!hasRole("registered_photographer") && !hasPendingApp("registered_photographer") && (
                <div className="mb-6">
                  <PhotographerUpgradeCard onUpgraded={() => {
                    if (user) queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(user.id) });
                  }} />
                </div>
              )}
              <OverviewTab
                displayName={displayName} user={user} profile={profile}
                myEntries={myEntries} recentPosts={recentPosts} roles={roles}
                memberSince={memberSince} friendRequests={friendRequests}
                hasRole={hasRole} upcomingComps={upcomingComps}
                certificates={certificates} enrollments={enrollments}
                suggestedPeople={suggestedPeople}
                gatedStatusOf={gatedStatusOf}
              />
            </motion.div>
          )}
          {activeTab === "submissions" && (
            <motion.div key="submissions" {...tabContent}>
              <SubmissionsTab
                myEntries={filteredEntries} statusFilter={statusFilter}
                setStatusFilter={setStatusFilter} statusCounts={statusCounts}
                certificates={certificates}
                userId={user?.id}
                loadedCount={myEntries.length}
              />
            </motion.div>
          )}
          {activeTab === "social" && (
            <motion.div key="social" {...tabContent}>
              <SocialTab
                friendRequests={friendRequests} recentPosts={recentPosts}
                user={user} handleFriendAction={handleFriendAction}
                friendActionLoading={friendActionLoading}
              />
            </motion.div>
          )}
          {activeTab === "settings" && (
            <motion.div key="settings" {...tabContent}>
              <SettingsTab
                user={user} profile={profile} roles={roles} applications={applications}
                hasRole={hasRole} canApplyFor={canApplyFor} showApplyForm={showApplyForm}
                setShowApplyForm={setShowApplyForm} applyRole={applyRole} setApplyRole={setApplyRole}
                applyReason={applyReason} setApplyReason={setApplyReason}
                applyPortfolio={applyPortfolio} setApplyPortfolio={setApplyPortfolio}
                applyExperience={applyExperience} setApplyExperience={setApplyExperience}
                submitting={submitting} handleApply={handleApply}
                sendingReset={sendingReset} handlePasswordReset={handlePasswordReset}
                appStatusIcon={appStatusIcon} setRoles={() => user && queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(user.id) })}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
};

/* ================================================================
   OVERVIEW TAB
   ================================================================ */
const OverviewTab = ({ displayName, user, profile, myEntries, recentPosts, roles, memberSince, friendRequests, hasRole, upcomingComps, certificates, enrollments, suggestedPeople, gatedStatusOf }: any) => (
  <div className="space-y-4">
    {/* Welcome + Quick Actions */}
    <motion.div variants={fadeUp} custom={0} initial="hidden" animate="visible">
      <h2 className="text-xl md:text-2xl font-light tracking-tight mb-3" style={{ fontFamily: "var(--font-display)" }}>
        Welcome, <em className="italic text-primary">{displayName.split(" ")[0]}</em>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { icon: User, label: "Profile", desc: "View profile", to: "/profile" },
          { icon: Trophy, label: "Competitions", desc: "Enter contests", to: "/competitions" },
          { icon: Edit2, label: "Edit Profile", desc: "Update info", to: "/edit-profile" },
          { icon: Wallet, label: "Wallet", desc: "Balance & history", to: "/wallet" },
          { icon: Award, label: "Certificates", desc: "Achievements", to: "/certificates" },
          { icon: Rss, label: "Feed", desc: "Latest updates", to: "/feed" },
          { icon: GraduationCap, label: "Courses", desc: "Learn photography", to: "/courses" },
          ...(hasRole("admin") ? [{ icon: Shield, label: "Admin", desc: "Manage site", to: "/admin" }] : []),
        ].map((a) => (
          <Link key={a.label} to={a.to} className="group flex items-center gap-3 p-3 border border-border hover:border-primary/50 transition-all duration-300">
            <a.icon className="h-4 w-4 text-primary shrink-0 group-hover:scale-110 transition-transform" strokeWidth={1.5} />
            <div className="min-w-0">
              <h3 className="text-[11px] tracking-[0.1em] uppercase truncate" style={{ fontFamily: "var(--font-heading)" }}>{a.label}</h3>
              <p className="text-[9px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>{a.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </motion.div>

    {/* Two-column: Recent Entries + Recent Posts */}
    <div className="grid md:grid-cols-2 gap-4">
      {/* Recent Entries with Scores */}
      <motion.div variants={fadeUp} custom={1} initial="hidden" animate="visible">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Recent Entries
          </span>
          <Link to="/dashboard?tab=submissions" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>View All →</Link>
        </div>
        <div className="border border-border divide-y divide-border">
          {myEntries.slice(0, 4).map((entry: MyCompEntry) => (
            <Link key={entry.id} to={`/competitions/${entry.competition_slug || entry.competition_id}`} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors group">
              {entry.photos.length > 0 && (
                <img src={entry.photos[0]} alt={entry.title} className="w-10 h-10 object-cover shrink-0 border border-border" loading="lazy" onContextMenu={(e) => e.preventDefault()} draggable={false} data-watermark="skip" />
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-light truncate" style={{ fontFamily: "var(--font-display)" }}>{entry.title}</h4>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {/* Audit v6 P-01: render publish-gated status, never raw entry.status. */}
                  <StatusBadge status={gatedStatusOf(entry)} />
                  {entry.vote_count > 0 && <span className="text-[9px] text-muted-foreground inline-flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{entry.vote_count}</span>}
                  {entry.score_avg !== null && (
                    <span className="text-[9px] text-primary inline-flex items-center gap-0.5 font-medium">
                      <Star className="h-2.5 w-2.5 fill-primary" />{entry.score_avg}/10
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary transition-colors" />
            </Link>
          ))}
          {myEntries.length === 0 && (
            <div className="p-6 text-center">
              <ImageIcon className="h-5 w-5 text-muted-foreground/20 mx-auto mb-1.5" />
              <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No entries yet</p>
              <Link to="/competitions" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline mt-1 inline-block" style={{ fontFamily: "var(--font-heading)" }}>Browse competitions →</Link>
            </div>
          )}
        </div>
      </motion.div>

      {/* Recent Posts */}
      <motion.div variants={fadeUp} custom={1.2} initial="hidden" animate="visible">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Recent Posts</span>
          <Link to={`/profile/${user.id}?section=wall`} className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>My Wall →</Link>
        </div>
        <div className="border border-border divide-y divide-border">
          {recentPosts.slice(0, 4).map((post: RecentPost) => (
            <div key={post.id} className="p-3">
              <p className="text-xs text-foreground line-clamp-2 mb-1" style={{ fontFamily: "var(--font-body)" }}>{post.content}</p>
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                {post.privacy === "public" ? <Globe className="h-2.5 w-2.5" /> : post.privacy === "friends" ? <Users className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                <TimeAgo date={post.created_at} />
                {post.like_count > 0 && <span className="inline-flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{post.like_count}</span>}
                {post.comment_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{post.comment_count}</span>}
              </div>
            </div>
          ))}
          {recentPosts.length === 0 && (
            <div className="p-6 text-center">
              <MessageSquare className="h-5 w-5 text-muted-foreground/20 mx-auto mb-1.5" />
              <p className="text-[10px] text-muted-foreground mb-2" style={{ fontFamily: "var(--font-body)" }}>No posts yet</p>
              <Link to={`/profile/${user.id}`} className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>Write your first post →</Link>
            </div>
          )}
        </div>
      </motion.div>
    </div>

    {/* Three-column: Upcoming Competitions + Certificates + Courses */}
    <div className="grid md:grid-cols-3 gap-4">
      {/* Upcoming Competitions */}
      <motion.div variants={fadeUp} custom={1.5} initial="hidden" animate="visible">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Upcoming Competitions</span>
          <Link to="/competitions" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>All →</Link>
        </div>
        <div className="border border-border divide-y divide-border">
          {upcomingComps.length > 0 ? upcomingComps.map((comp: any) => (
            <Link key={comp.id} to={`/competitions/${(comp as any).slug || comp.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors group">
              {comp.cover_image_url && <img src={comp.cover_image_url} alt={comp.title} className="w-10 h-10 object-cover shrink-0 border border-border" loading="lazy" />}
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-light truncate" style={{ fontFamily: "var(--font-display)" }}>{comp.title}</h4>
                <p className="text-[9px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-2.5 w-2.5" />
                  {new Date(comp.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
              <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary transition-colors" />
            </Link>
          )) : (
            <div className="p-6 text-center">
              <Trophy className="h-5 w-5 text-muted-foreground/20 mx-auto mb-1.5" />
              <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No upcoming competitions</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* My Certificates */}
      <motion.div variants={fadeUp} custom={1.7} initial="hidden" animate="visible">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Certificates</span>
          <Link to="/certificates" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>All →</Link>
        </div>
        <div className="border border-border divide-y divide-border">
          {certificates.length > 0 ? certificates.slice(0, 3).map((cert: any) => (
            <div key={cert.id} className="p-3">
              <div className="flex items-center gap-2">
                <Award className="h-3.5 w-3.5 text-primary shrink-0" />
                <h4 className="text-xs font-light truncate" style={{ fontFamily: "var(--font-display)" }}>{cert.title}</h4>
              </div>
              <p className="text-[9px] text-muted-foreground mt-0.5 pl-5.5">
                {cert.type} · {new Date(cert.issued_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </p>
            </div>
          )) : (
            <div className="p-6 text-center">
              <Award className="h-5 w-5 text-muted-foreground/20 mx-auto mb-1.5" />
              <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No certificates yet</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* My Courses */}
      <motion.div variants={fadeUp} custom={1.9} initial="hidden" animate="visible">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>My Courses</span>
          <Link to="/courses" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>Browse →</Link>
        </div>
        <div className="border border-border divide-y divide-border">
          {enrollments.length > 0 ? enrollments.map((enr: any) => {
            const course = enr.courses;
            return (
              <Link key={enr.id} to={course ? `/courses/${course.slug}` : "/courses"} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors group">
                {course?.cover_image_url && <img src={course.cover_image_url} alt={course.title} className="w-10 h-10 object-cover shrink-0 border border-border" loading="lazy" />}
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-light truncate" style={{ fontFamily: "var(--font-display)" }}>{course?.title || "Course"}</h4>
                  <p className="text-[9px] text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="h-2.5 w-2.5" />
                    Enrolled {new Date(enr.enrolled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary transition-colors" />
              </Link>
            );
          }) : (
            <div className="p-6 text-center">
              <GraduationCap className="h-5 w-5 text-muted-foreground/20 mx-auto mb-1.5" />
              <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>Not enrolled in any courses</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>

    {/* People You May Know (Facebook-style) */}
    {suggestedPeople.length > 0 && (
      <motion.div variants={fadeUp} custom={2} initial="hidden" animate="visible">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>People You May Know</span>
          <Link to="/discover" className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>Discover →</Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {suggestedPeople.map((person: any) => (
            <Link key={person.id} to={`/profile/${person.id}`} className="shrink-0 w-28 border border-border hover:border-primary/40 transition-all duration-300 text-center p-3 group">
              {person.avatar_url ? (
                <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={person.avatar_url} alt={person.full_name || ""} className="w-12 h-12 rounded-full object-cover mx-auto mb-2 border border-border group-hover:border-primary transition-colors" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2 border border-border">
                  <User className="h-5 w-5 text-primary/40" />
                </div>
              )}
              <UserIdentityBlock
                userId={person.id}
                name={person.full_name || "Photographer"}
                nameClassName="text-[10px] font-light truncate [font-family:var(--font-heading)]"
              />
              <p className="text-[8px] text-muted-foreground truncate mt-0.5" style={{ fontFamily: "var(--font-body)" }}>{person.bio?.slice(0, 30) || ""}</p>
            </Link>
          ))}
        </div>
      </motion.div>
    )}

    {/* Activity Timeline */}
    <motion.div variants={fadeUp} custom={2.5} initial="hidden" animate="visible">
      <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>Activity</span>
      <div className="border border-border divide-y divide-border">
        <ActivityItem icon={<User className="h-3 w-3" />} title="Account created" description="Welcome to 50mm Retina World" time={memberSince} />
        {roles.map((r: UserRole) => (
          <ActivityItem key={r.role} icon={<Trophy className="h-3 w-3" />} title={`Role: ${r.role}`} description="Role-specific features unlocked" time={new Date(r.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })} />
        ))}
      </div>
    </motion.div>
  </div>
);
/* ================================================================
   SUBMISSIONS TAB — Competition-grouped 1:1 cards
   ================================================================ */
// Plan Phase 5 / Task 5.6 — labels sourced from PARTICIPANT_PLACEMENT_LABELS
// (mirror of v3_stage_catalog). Only gradient + emoji live here.
const PLACEMENT_CONFIG: Record<string, { label: string; gradient: string; emoji: string }> = {
  winner:          { label: PARTICIPANT_PLACEMENT_LABELS.winner,          gradient: "from-yellow-500 via-amber-400 to-yellow-600", emoji: "🏆" },
  "1st_runner_up": { label: PARTICIPANT_PLACEMENT_LABELS["1st_runner_up"], gradient: "from-slate-300 via-gray-200 to-slate-400",    emoji: "🥈" },
  "2nd_runner_up": { label: PARTICIPANT_PLACEMENT_LABELS["2nd_runner_up"], gradient: "from-amber-700 via-orange-600 to-amber-800",  emoji: "🥉" },
  honorary_mention: { label: PARTICIPANT_PLACEMENT_LABELS.honorary_mention, gradient: "from-purple-600 via-violet-500 to-purple-700", emoji: "🎖️" },
  special_jury:     { label: PARTICIPANT_PLACEMENT_LABELS.special_jury,     gradient: "from-cyan-600 via-sky-500 to-cyan-700",       emoji: "🏅" },
  top_50:           { label: PARTICIPANT_PLACEMENT_LABELS.top_50,           gradient: "from-emerald-600 via-green-500 to-emerald-700", emoji: "⭐" },
  top_100:          { label: PARTICIPANT_PLACEMENT_LABELS.top_100,          gradient: "from-teal-600 via-emerald-500 to-teal-700",   emoji: "🌟" },
  finalist:         { label: PARTICIPANT_PLACEMENT_LABELS.finalist,         gradient: "from-indigo-600 via-blue-500 to-indigo-700",  emoji: "🏵️" },
};

const PlacementBadge = ({ placement }: { placement: string }) => {
  // BUG-032: public_placement arrives in token form (runner_up_1) or enum
  // form (1st_runner_up); normalize before lookup so badges always render.
  const normalized = normalizePlacementKey(placement) ?? placement;
  const config = PLACEMENT_CONFIG[normalized];
  if (!config) return null;
  return (
    <motion.div
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.2 }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r ${config.gradient} text-white shadow-lg`}
    >
      <motion.span
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        className="text-sm"
      >
        {config.emoji}
      </motion.span>
      <span className="text-[10px] tracking-[0.2em] uppercase font-bold" style={{ fontFamily: "var(--font-heading)" }}>
        {config.label}
      </span>
    </motion.div>
  );
};

/**
 * U-4 (Audit v6 P-01/P-05) — gated participant pill.
 *
 * Previous behaviour read raw `entryStatus` (DB `competition_entries.status`)
 * which leaks unpublished round outcomes (rejected / shortlisted / winner)
 * to the participant before the admin clicks "Declare Round N". Per Spec v3
 * §7 and the publish-gate contract, every participant-facing surface MUST
 * derive its display status from the gated source (`useEntryPublicStatus` /
 * `useGatedEntryStatus`).
 *
 * Caller (SubmissionsTab) now passes the already-loaded gated row from
 * `publicStatusMap`. We honour the verification override and fall back to
 * `judging_in_progress` whenever the row is missing or unpublished.
 *
 * The `compStatus === "result"` short-circuit kept the old "Results Declared"
 * pill — but only fires when there is NO gated outcome yet (i.e. competition
 * is in result phase but THIS entry's round has not yet been declared).
 */
const CompetitionStatusLabel = ({
  gatedRow,
  compStatus,
}: {
  gatedRow: EntryPublicStatusRow | undefined;
  compStatus: string;
}) => {
  const gated = gatedRow?.public_status;
  const placement = gatedRow?.public_placement;
  const isPublished = gated && gated !== "judging_in_progress";

  // Competition is being judged and this entry has no published outcome yet.
  if (!isPublished && (compStatus === "judging" || compStatus === "result")) {
    if (compStatus === "result") {
      return <ParticipantStageBadge status="results_declared" tags={[]} compact />;
    }
    return (
      <span className="inline-flex items-center gap-1 text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 border border-yellow-500/40 text-yellow-600 bg-yellow-500/5 rounded-full font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
        <Clock className="h-2.5 w-2.5" /> Judging in Progress
      </span>
    );
  }

  // Submission phase or pre-publish for any other state — show neutral.
  if (!gated) {
    return <ParticipantStageBadge status="submitted" tags={[]} compact />;
  }

  // R4 Awards integrity (mem://judging/awards-integrity-phase2.4):
  // when an award placement is set (special_jury / honorary_mention /
  // runner_up_1 / runner_up_2 / winner), the badge MUST reflect the AWARD,
  // not the bare "finalist" progression status. Without this, a Special
  // Jury entry looks identical to a non-awarded finalist on the dashboard.
  const PLACEMENT_AWARDS = new Set([
    "winner",
    "runner_up_1",
    "runner_up_2",
    "honorary_mention",
    "honourable_mention",
    "special_jury",
  ]);
  if (placement && PLACEMENT_AWARDS.has(placement)) {
    return <ParticipantStageBadge status={placement} tags={[]} compact />;
  }

  return <ParticipantStageBadge status={gated} tags={[]} compact />;
};

const SubmissionsTab = ({ myEntries, statusFilter, setStatusFilter, statusCounts, certificates, userId, loadedCount }: { myEntries: MyCompEntry[]; statusFilter: string; setStatusFilter: (s: string) => void; statusCounts: Record<string, number>; certificates: any[]; userId: string | undefined; loadedCount: number }) => {
  const navigate = useNavigate();
  const statuses = ["all", "submitted", "approved", "round1_qualified", "round2_qualified", "finalist", "winner", "rejected", "hold"];

  // Judging v5 / Rule #5 + #6 — photographer sees nothing about their entry's
  // round status/tags until the admin explicitly publishes that round's results.
  const allEntryIds = useMemo(() => myEntries.map(e => (e as any).id).filter(Boolean), [myEntries]);
  const { data: publicStatusMap = {} } = useEntryPublicStatus(allEntryIds);

  // Audit v6 / P-05 — surface entries beyond the dashboard's first 50 so heavy
  // participants don't silently lose visibility of older submissions. The dashboard
  // pre-loads the enriched first page (used for stats + filters above); anything
  // older is paginated in here as a lightweight "older entries" section.
  const olderEntriesQuery = useUserEntriesInfinite(userId);
  const olderEntries = useMemo(() => {
    const all = olderEntriesQuery.data?.pages.flat() ?? [];
    // Drop rows we already have in the enriched first page (stable de-dupe by id).
    const known = new Set(allEntryIds);
    return all.filter((row) => !known.has(row.id));
  }, [olderEntriesQuery.data, allEntryIds]);

  // Group entries by competition
  const compGroups = useMemo(() => {
    const groups: Record<string, CompGroup> = {};
    // Certificates are written with reference_id = ENTRY id (Certificates.tsx
    // handleRequest), while legacy rows hold the COMPETITION id. Dual-match
    // both so "View Certificate" surfaces for entry-referenced certs.
    const entryIdToCompId = new Map(myEntries.map(e => [e.id, e.competition_id]));
    const certForCompetition = (competitionId: string) =>
      certificates.find(c =>
        c.reference_id === competitionId || entryIdToCompId.get(c.reference_id) === competitionId
      );
    myEntries.forEach(entry => {
      if (!groups[entry.competition_id]) {
        const cert = certForCompetition(entry.competition_id);
        groups[entry.competition_id] = {
          competition_id: entry.competition_id,
          competition_slug: entry.competition_slug,
          competition_title: entry.competition_title,
          competition_status: entry.competition_status,
          competition_current_round: entry.competition_current_round,
          competition_cover: entry.competition_cover,
          entries: [],
          all_tags: [],
          has_certificate: !!cert,
          certificate_id: cert?.id || null,
        };
      }
      groups[entry.competition_id].entries.push(entry);
      entry.tags.forEach(tag => {
        if (!groups[entry.competition_id].all_tags.some(t => t.label === tag.label)) {
          groups[entry.competition_id].all_tags.push(tag);
        }
      });
    });
    return Object.values(groups);
  }, [myEntries, certificates]);

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground mr-1" style={{ fontFamily: "var(--font-heading)" }}>Filter:</span>
        {statuses.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`text-[9px] tracking-[0.15em] uppercase px-3 py-1 border transition-all duration-300 ${statusFilter === s ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/50"}`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {s === "all" ? "All" : s === "round1_qualified" ? "Round 1" : s === "round2_qualified" ? "Round 2" : s === "hold" ? "On Hold" : s}
            {statusCounts[s] ? <span className="ml-1 text-[8px] opacity-60">({statusCounts[s]})</span> : null}
          </button>
        ))}
      </div>

      {/* Competition Cards Grid — click navigates to inner page */}
      {compGroups.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {compGroups.map((group, i) => {
            // Judging v5: only reveal placement/tags if at least one of this
            // group's entries has a public_status other than `judging_in_progress`
            // (i.e. the admin has published this round's results).
            const anyPublished = group.entries.some(e => {
              const ps = publicStatusMap[(e as any).id];
              return ps && ps.public_status && ps.public_status !== "judging_in_progress";
            });
            const judgingInProgress = !anyPublished &&
              (group.competition_status === "judging" || group.competition_status === "result");
            // Audit v6 P-01: derive winner / placement from the gated public_status map,
            // never from raw entry.status / entry.placement (those leak before publish).
            const gatedFor = (e: any) => publicStatusMap[e.id];
            const hasWinner = anyPublished && group.entries.some(e => {
              const g = gatedFor(e);
              return g?.public_status === "winner" || g?.public_placement === "winner";
            });
            const hasRunnerUp = anyPublished && group.entries.some(e => {
              const g = gatedFor(e);
              return g?.public_placement === "1st_runner_up" || g?.public_placement === "2nd_runner_up";
            });
            const bestPlacement = anyPublished
              ? (group.entries.map(gatedFor).find(g => g?.public_placement)?.public_placement
                  || (group.entries.map(gatedFor).find(g => g?.public_status === "winner") ? "winner" : null))
              : null;
            const firstPhoto = group.entries[0]?.photos[0];

            return (
              <motion.div
                key={group.competition_id}
                variants={fadeUp}
                custom={i * 0.06}
                initial="hidden"
                animate="visible"
                className="col-span-1"
              >
                <div
                  className="group relative cursor-pointer border-2 border-border hover:border-primary/50 transition-all duration-300 overflow-hidden"
                  onClick={() => navigate(`/dashboard/submission/${group.competition_id}`)}
                >
                  <div className="aspect-square relative overflow-hidden">
                    {/* Show cover image or first entry photo as fallback */}
                    {(group.competition_cover || firstPhoto) ? (
                      <img
                        src={group.competition_cover || firstPhoto}
                        alt={group.competition_title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        loading="lazy"
                        onContextMenu={(e) => e.preventDefault()}
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                        <Trophy className="h-10 w-10 text-primary/30" />
                      </div>
                    )}

                    {/* Step 20: phase watermark on competition cover during judging */}
                    <PhaseWatermark
                      phase={group.competition_status}
                      currentRound={group.competition_current_round}
                      surface="card"
                    />

                    {/* Dark gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                    {/* Placement badge — always shows */}
                    {bestPlacement && (
                      <div className="absolute top-2 right-2 z-10">
                        <PlacementBadge placement={bestPlacement} />
                      </div>
                    )}

                    {/* Competition title overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <h4 className="text-white text-sm font-light leading-tight line-clamp-2" style={{ fontFamily: "var(--font-display)" }}>
                        {group.competition_title}
                      </h4>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-white/60 text-[9px]" style={{ fontFamily: "var(--font-heading)" }}>
                          {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
                        </span>
                        <CompetitionStatusLabel
                          gatedRow={publicStatusMap[(group.entries[0] as any)?.id]}
                          compStatus={group.competition_status}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Tags + Certificate below card — gated by Publish (Rule #5/#6) */}
                  <div className="p-2 bg-card space-y-1.5">
                    {judgingInProgress ? (
                      <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>
                        Judging in progress
                      </p>
                    ) : (
                      <>
                        {anyPublished && group.all_tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {group.all_tags.map(tag => (
                              <JudgingStampBadge key={tag.label} label={participantLabelForJudgingTag(tag.label)} color={tag.color} icon={tag.icon} imageUrl={tag.image_url} size="sm" />
                            ))}
                          </div>
                        )}
                        {group.has_certificate && group.certificate_id && (
                          <Link
                            to="/certificates"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[8px] tracking-[0.15em] uppercase text-primary hover:underline"
                            style={{ fontFamily: "var(--font-heading)" }}
                          >
                            <Award className="h-3 w-3" /> View Certificate
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="border border-dashed border-border p-10 text-center">
          <ImageIcon className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground mb-3" style={{ fontFamily: "var(--font-body)" }}>
            {statusFilter === "all" ? "No entries yet. Enter a competition to get started!" : "No entries with this status."}
          </p>
          <Link to="/competitions" className="inline-flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border hover:border-primary hover:text-primary transition-all duration-500" style={{ fontFamily: "var(--font-heading)" }}>
            <Trophy className="h-3 w-3" /> Browse Competitions
          </Link>
        </div>
      )}

      {/*
        Audit v6 / P-05 — paginated tail for participants with >50 entries.
        Only shown on the unfiltered view (status filter operates on the
        enriched dashboard slice). Older entries are listed in compact form
        and link out to the per-competition submission page for full detail.
      */}
      {statusFilter === "all" && loadedCount >= 50 && userId && (
        <div className="space-y-3">
          {olderEntries.length > 0 && (
            <>
              <div className="border-t border-border pt-4">
                <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                  Older Entries
                </span>
              </div>
              <div className="border border-border divide-y divide-border">
                {olderEntries.map((entry) => (
                  <Link
                    key={entry.id}
                    to={`/dashboard/submission/${entry.competition_id}`}
                    className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors group"
                  >
                    {entry.photos[0] && (
                      <img
                        src={entry.photos[0]}
                        alt={entry.title}
                        className="h-12 w-12 object-cover border border-border"
                        loading="lazy"
                        onContextMenu={(e) => e.preventDefault()}
                        draggable={false}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate group-hover:text-primary transition-colors" style={{ fontFamily: "var(--font-body)" }}>
                        {entry.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-heading)" }}>
                        {entry.competition?.title ?? "—"} · {new Date(entry.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </Link>
                ))}
              </div>
            </>
          )}
          <InfiniteScrollSentinel
            onLoadMore={() => olderEntriesQuery.fetchNextPage()}
            hasNextPage={!!olderEntriesQuery.hasNextPage}
            isFetching={olderEntriesQuery.isFetchingNextPage || olderEntriesQuery.isLoading}
            showEndMarker={olderEntries.length > 0}
            endLabel="No more entries"
            loadingLabel="Loading older entries…"
          />
        </div>
      )}
    </div>
  );
};
/* ================================================================
   SETTINGS TAB
   ================================================================ */
const SettingsTab = ({ user, profile, roles, applications, hasRole, canApplyFor, showApplyForm, setShowApplyForm, applyRole, setApplyRole, applyReason, setApplyReason, applyPortfolio, setApplyPortfolio, applyExperience, setApplyExperience, submitting, handleApply, sendingReset, handlePasswordReset, appStatusIcon, setRoles }: any) => (
  <div className="space-y-4">
    {/* Profile Insights - Only Me */}
    {user && profile && (
      <ProfileAnalytics userId={user.id} createdAt={profile.created_at} />
    )}
    {/* Account Info */}
    <div className="border border-border p-4 md:p-5">
      <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>Account Information</span>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>Email Address</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3 w-3" />
            <span style={{ fontFamily: "var(--font-body)" }}>{user.email}</span>
            <span className="text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-border text-muted-foreground/60" style={{ fontFamily: "var(--font-heading)" }}>Fixed</span>
          </div>
        </div>
        <div>
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>Password</span>
          <button onClick={handlePasswordReset} disabled={sendingReset} className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 border border-border hover:border-primary hover:text-primary transition-all duration-500 disabled:opacity-50" style={{ fontFamily: "var(--font-heading)" }}>
            <KeyRound className="h-3 w-3" />
            {sendingReset ? "Sending…" : "Reset Password"}
          </button>
        </div>
      </div>
      {profile?.city && (
        <div className="mt-3 pt-3 border-t border-border">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>Location</span>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" />{[profile.city, profile.state, profile.country].filter(Boolean).join(", ")}</p>
        </div>
      )}
      {profile?.phone && (
        <div className="mt-3 pt-3 border-t border-border">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>Phone</span>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{profile.phone}</p>
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-border">
        <Link to="/edit-profile" className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
          <Edit2 className="h-3 w-3" /> Edit Profile
        </Link>
      </div>
    </div>

    {/* Active Devices */}
    {user && <ActiveDevices userId={user.id} />}

    {/* Verification Request */}
    <VerificationRequestCard />


    {/* Role Applications */}
    <div className="border border-border p-4 md:p-5">
      <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-heading)" }}>Role Applications</span>
      {(canApplyFor("judge") || canApplyFor("content_editor")) && !showApplyForm && (
        <div className="flex flex-wrap gap-2 mb-3">
          {canApplyFor("judge") && (
            <button onClick={() => { setApplyRole("judge"); setShowApplyForm(true); }} className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-border hover:border-primary/50 transition-all duration-500" style={{ fontFamily: "var(--font-heading)" }}>
              <Briefcase className="h-3 w-3 text-primary" /> Apply: Judge
            </button>
          )}
          {canApplyFor("content_editor") && (
            <button onClick={() => { setApplyRole("content_editor"); setShowApplyForm(true); }} className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-border hover:border-primary/50 transition-all duration-500" style={{ fontFamily: "var(--font-heading)" }}>
              <Briefcase className="h-3 w-3 text-primary" /> Apply: Editor
            </button>
          )}
        </div>
      )}

      {showApplyForm && (
        <div className="border border-border p-4 mb-3 space-y-3 bg-muted/10">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              {`Apply as ${applyRole === "judge" ? "Judge" : applyRole === "registered_photographer" ? "Photographer" : "Content Editor"}`}
            </span>
            <button onClick={() => setShowApplyForm(false)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          <div>
            <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>Why? *</label>
            <Textarea value={applyReason} onChange={(e: any) => setApplyReason(e.target.value)} placeholder="Your reason..." className="bg-transparent text-sm" maxLength={1000} />
          </div>
          <div>
            <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>Portfolio URL</label>
            <Input value={applyPortfolio} onChange={(e: any) => setApplyPortfolio(e.target.value)} placeholder="https://..." className="bg-transparent text-sm" maxLength={500} />
          </div>
          <div>
            <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>Experience</label>
            <Textarea value={applyExperience} onChange={(e: any) => setApplyExperience(e.target.value)} placeholder="Awards, years..." className="bg-transparent text-sm" maxLength={1000} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleApply} disabled={submitting} className="text-[10px] tracking-[0.1em] uppercase bg-primary text-primary-foreground h-8" style={{ fontFamily: "var(--font-heading)" }}>
              <Send className="h-3 w-3 mr-1" /> {submitting ? "Submitting…" : "Submit"}
            </Button>
            <Button variant="ghost" onClick={() => setShowApplyForm(false)} className="text-[10px] tracking-[0.1em] uppercase h-8" style={{ fontFamily: "var(--font-heading)" }}>Cancel</Button>
          </div>
        </div>
      )}

      {applications.length > 0 ? (
        <div className="divide-y divide-border">
          {applications.map((app: any) => (
            <div key={app.id} className="flex items-start gap-3 py-3">
              <div className="mt-0.5">{appStatusIcon(app.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-light" style={{ fontFamily: "var(--font-heading)" }}>
                  {app.requested_role === "content_editor" ? "Content Editor" : app.requested_role === "registered_photographer" ? "Photographer" : "Judge"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  <span className={app.status === "approved" ? "text-primary" : app.status === "rejected" ? "text-destructive" : "text-yellow-500"}>{app.status}</span>
                </p>
                {app.admin_message && <p className="text-[10px] text-muted-foreground mt-1 p-1.5 bg-muted/50 border-l-2 border-primary">{app.admin_message}</p>}
              </div>
              <span className="text-[9px] text-muted-foreground shrink-0">{new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No applications yet.</p>
      )}
    </div>

    {/* Danger Zone — self-serve permanent account deletion (Play/Apple requirement) */}
    <DeleteAccountSection />
  </div>
);

/* ================================================================
   SOCIAL TAB
   ================================================================ */
const SocialTab = ({ friendRequests, recentPosts, user, handleFriendAction, friendActionLoading }: any) => (
  <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {[
        { icon: Users, label: "Friends & Network", to: "/friends" },
        { icon: MessageSquare, label: "My Wall", to: `/profile/${user.id}?section=wall` },
        { icon: Rss, label: "Feed", to: "/feed" },
        { icon: Star, label: "Discover Photographers", to: "/discover" },
      ].map(l => (
        <Link key={l.label} to={l.to} className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-2 border border-border hover:border-primary hover:text-primary transition-all duration-300" style={{ fontFamily: "var(--font-heading)" }}>
          <l.icon className="h-3 w-3" /> {l.label}
        </Link>
      ))}
    </div>
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-3.5 w-3.5 text-primary" />
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Friend Requests
          {friendRequests.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[1rem] px-1 text-[8px] bg-primary text-primary-foreground rounded-full">{friendRequests.length}</span>}
        </span>
      </div>
      {friendRequests.length > 0 ? (
        <div className="border border-border divide-y divide-border">
          {friendRequests.map((req: FriendRequest) => {
            const name = req.requester_name || "Unknown User";
            const reqInitials = name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
            return (
              <div key={req.id} className="flex items-center gap-3 p-3">
                <Link to={`/profile/${req.requester_id}`} className="shrink-0">
                  {req.requester_avatar ? <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={req.requester_avatar} alt={name} className="w-9 h-9 rounded-full object-cover" /> : <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><span className="text-xs font-light text-primary">{reqInitials}</span></div>}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link to={`/profile/${req.requester_id}`} className="text-xs font-light hover:text-primary transition-colors" style={{ fontFamily: "var(--font-heading)" }}>{name}</Link>
                  <p className="text-[9px] text-muted-foreground"><TimeAgo date={req.created_at} /></p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => handleFriendAction(req.id, "accept", req.requester_id)} disabled={friendActionLoading === req.id} className="text-[9px] tracking-[0.1em] uppercase px-2.5 py-1 border border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300 disabled:opacity-50" style={{ fontFamily: "var(--font-heading)" }}>Accept</button>
                  <button onClick={() => handleFriendAction(req.id, "decline")} disabled={friendActionLoading === req.id} className="text-[9px] tracking-[0.1em] uppercase px-2.5 py-1 border border-border text-muted-foreground hover:border-destructive hover:text-destructive transition-all duration-300 disabled:opacity-50" style={{ fontFamily: "var(--font-heading)" }}>Decline</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-dashed border-border p-6 text-center">
          <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No pending friend requests</p>
        </div>
      )}
    </div>
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Wall Posts</span>
        <Link to={`/profile/${user.id}`} className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>View All →</Link>
      </div>
      {recentPosts.length > 0 ? (
        <div className="border border-border divide-y divide-border">
          {recentPosts.map((post: RecentPost) => (
            <div key={post.id} className="p-3">
              <p className="text-xs text-foreground line-clamp-2 mb-1" style={{ fontFamily: "var(--font-body)" }}>{post.content}</p>
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                <TimeAgo date={post.created_at} />
                {post.like_count > 0 && <span className="inline-flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{post.like_count}</span>}
                {post.comment_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{post.comment_count}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-border p-6 text-center">
          <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No posts yet</p>
        </div>
      )}
    </div>
  </div>
);

/* ================================================================
   SHARED COMPONENTS
   ================================================================ */
const StatusBadge = ({ status }: { status: string }) => (
  <ParticipantStageBadge status={status} tags={[]} compact />
);

const TimeAgo = ({ date }: { date: string }) => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  let text = "Just now";
  if (mins >= 1 && mins < 60) text = `${mins}m`;
  else if (mins >= 60 && mins < 1440) text = `${Math.floor(mins / 60)}h`;
  else if (mins >= 1440 && mins < 10080) text = `${Math.floor(mins / 1440)}d`;
  else if (mins >= 10080) text = new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return <span>{text}</span>;
};

const ActivityItem = ({ icon, title, description, time }: { icon: React.ReactNode; title: string; description: string; time: string; }) => (
  <div className="flex items-start gap-3 p-3">
    <div className="mt-0.5 text-primary">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-light" style={{ fontFamily: "var(--font-heading)" }}>{title}</p>
      <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>{description}</p>
    </div>
    <span className="text-[9px] text-muted-foreground shrink-0">{time}</span>
  </div>
);

export default Dashboard;
