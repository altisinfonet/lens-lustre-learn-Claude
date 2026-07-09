/**
 * AdminPanel — thin controller / router.
 * Uses URL-based routing (/admin/users, /admin/wallet, etc.) instead of localStorage tabs.
 * All business logic lives in modules under src/modules/admin/.
 * Layout (sidebar, header, RBAC guard) is in AdminLayout.
 */
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useUserRoles } from "@/hooks/profile/useUserRoles";
import { canAccessTab, resolveAdminSubRoles, type AdminTab } from "@/lib/adminRoleAccess";
import BrandLoader from "@/components/BrandLoader";
import AdminLayout from "@/components/admin/AdminLayout";
import { Loader2 } from "lucide-react";

import {
  Plus, Pencil, Trash2, Eye, Trophy, Users, CheckCircle, XCircle,
  Briefcase, MessageSquare, Image, Upload, LayoutDashboard, BookOpen,
  Newspaper, Award, UserCog, Vote, AlertTriangle, Star, Settings,
  Heart, FileText, Globe, BarChart3, Megaphone, Zap, Bell, HeartPulse,
  UserPlus, HelpCircle, Mail, ClipboardList, Database, LogIn,
  ExternalLink, Tag, Gavel, Search, Shield, BookMarked, Wallet, Gift, ShieldCheck,
} from "lucide-react";

// ─── Lazy-loaded modules ────────────────────────────────────
const CompetitionsModule = lazy(() => import("@/modules/admin/CompetitionsModule"));
const EntriesModule = lazy(() => import("@/modules/admin/EntriesModule"));
const CommentsModule = lazy(() => import("@/modules/admin/CommentsModule"));
const UsersModule = lazy(() => import("@/modules/admin/UsersModule"));
const JudgeMonitoringModule = lazy(() => import("@/modules/admin/JudgeMonitoringModule"));
const VoteAuditModule = lazy(() => import("@/modules/admin/VoteAuditModule"));
const JudgeActivityModule = lazy(() => import("@/modules/admin/JudgeActivityModule"));
const RoleApplicationsModule = lazy(() => import("@/modules/admin/RoleApplicationsModule"));
const DatabaseModule = lazy(() => import("@/modules/admin/DatabaseModule"));

// ─── Existing lazy-loaded admin components (unchanged) ──────
const AdminGiftCredit = lazy(() => import("@/components/AdminGiftCredit"));
const AdminBanners = lazy(() => import("@/components/admin/AdminBanners"));
const AdminVoteRewards = lazy(() => import("@/components/admin/AdminVoteRewards"));
const AdminCommentReports = lazy(() => import("@/components/admin/AdminCommentReports"));
const AdminPostReports = lazy(() => import("@/components/admin/AdminPostReports"));
const AdminCourses = lazy(() => import("@/components/admin/AdminCourses"));
const AdminJournal = lazy(() => import("@/components/admin/AdminJournal"));
const AdminCertificates = lazy(() => import("@/components/admin/AdminCertificates"));
const AdminPhotoOfDay = lazy(() => import("@/components/admin/AdminPhotoOfDay"));
const AdminExcellence = lazy(() => import("@/components/admin/AdminExcellence"));
const AdminFeaturedArtist = lazy(() => import("@/components/admin/AdminFeaturedArtist"));
const AdminSettings = lazy(() => import("@/components/admin/AdminSettings"));
const AdminSEO = lazy(() => import("@/components/admin/AdminSEO"));
const AdminPageManagement = lazy(() => import("@/components/admin/AdminPageManagement"));
const AdminAnalytics = lazy(() => import("@/components/admin/AdminAnalytics"));
const AdminAdvertisements = lazy(() => import("@/components/admin/AdminAdvertisements"));
const AdminPerformance = lazy(() => import("@/components/admin/AdminPerformance"));
const AdminAnnouncements = lazy(() => import("@/components/admin/AdminAnnouncements"));
const AdminHealth = lazy(() => import("@/components/admin/AdminHealth"));
const AdminEngagement = lazy(() => import("@/components/admin/AdminEngagement"));
const AdminTransactions = lazy(() => import("@/components/admin/AdminTransactions"));
const AdminReferrals = lazy(() => import("@/components/admin/AdminReferrals"));
const AdminSupportTickets = lazy(() => import("@/components/admin/AdminSupportTickets"));
const AdminEmailTemplates = lazy(() => import("@/components/admin/AdminEmailTemplates"));
const AdminActivityLogs = lazy(() => import("@/components/admin/AdminActivityLogs"));
const AdminAuthPages = lazy(() => import("@/components/admin/AdminAuthPages"));
const AdminRedirects = lazy(() => import("@/components/admin/AdminRedirects"));
const AdminMenuBuilder = lazy(() => import("@/components/admin/AdminMenuBuilder"));
const AdminJudgingTags = lazy(() => import("@/components/admin/AdminJudgingTags"));
const AdminTagSemanticsAudit = lazy(() => import("@/pages/admin/AdminTagSemanticsAudit"));
const AdminNotificationsHealth = lazy(() => import("@/pages/admin/AdminNotificationsHealth"));
const AdminCompetitionHealth = lazy(() => import("@/pages/admin/AdminCompetitionHealth"));
const AdminTestAgent = lazy(() => import("@/pages/admin/AdminTestAgent"));

const AdminGallery = lazy(() => import("@/components/admin/AdminGallery"));
const AdminOnPageImages = lazy(() => import("@/components/admin/AdminOnPageImages"));
const AdminNotifications = lazy(() => import("@/components/admin/AdminNotifications"));
const AdminNewsletterFaq = lazy(() => import("@/components/admin/AdminNewsletterFaq"));
const AdminKeywordBlocklist = lazy(() => import("@/components/admin/AdminKeywordBlocklist"));
const AdminUserGuide = lazy(() => import("@/components/admin/AdminUserGuide"));
const AdminWalletTab = lazy(() => import("@/components/admin/AdminWalletTab"));
const AdminOrders = lazy(() => import("@/components/admin/AdminOrders"));

/* All valid admin route segments */
const VALID_ROUTES = new Set([
  "banners", "potd", "on_page_images", "portfolio", "featured_artist",
  "journal", "courses", "certificates", "excellence",
  "competitions", "competition_health", "entries", "judging_tags", "tag_semantics", "judge_monitoring", "vote_audit", "judge_activity", "vote_rewards",
  "users", "applications", "referrals", "engagement",
  "comments", "keyword_blocklist", "reports", "post_reports",
  "wallet", "gifts", "transactions", "orders",
  "seo", "advertisements", "performance", "announcements", "newsletter_faq", "analytics",
  "page_management", "menu_builder", "redirects",
  "settings", "auth_pages", "email_templates", "database",
  "health", "activity_logs", "admin_notifications", "notifications_health", "test_agent",
  "support_tickets", "user_guide",
]);

const DEFAULT_ROUTE: AdminTab = "banners";

const LazyTab = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
    {children}
  </Suspense>
);

const tabGroups = [
  { label: "Overview", items: [
    ["health", "Site Health", HeartPulse],
    ["notifications_health", "Notification Drift", Bell],
    ["test_agent", "Test Agent", HeartPulse],
    ["analytics", "Analytics", BarChart3],
    ["admin_notifications", "Notifications", Bell],
    ["activity_logs", "Activity Logs", ClipboardList],
  ] as const },
  { label: "Content", items: [
    ["banners", "Hero Banners", LayoutDashboard],
    ["potd", "Photo of Day", Star],
    ["portfolio", "Gallery", Image],
    ["on_page_images", "On-Page Images", Upload],
    ["featured_artist", "Featured Artist", Star],
  ] as const },
  { label: "Editorial", items: [
    ["journal", "Journal", Newspaper],
    ["courses", "Courses", BookOpen],
    ["certificates", "Certificates", Award],
    ["excellence", "Excellence", Star],
  ] as const },
  { label: "Competitions", items: [
    ["competitions", "Competitions", Trophy],
    ["competition_health", "Competition Health", HeartPulse],
    ["entries", "Entries", Users],
    ["judging_tags", "Judging Tags", Tag],
    ["tag_semantics", "Tag Semantics (Audit)", Tag],
    ["judge_monitoring", "Judge Monitor", Gavel],
    ["vote_audit", "Vote Audit", Vote],
    ["judge_activity", "Judge Activity", ClipboardList],
    ["vote_rewards", "Vote Rewards", Vote],
  ] as const },
  { label: "Users & Community", items: [
    ["users", "Users", UserCog],
    ["applications", "Role Applications", Briefcase],
    ["referrals", "Referrals", UserPlus],
    ["engagement", "Engagement", Heart],
  ] as const },
  { label: "Moderation", items: [
    ["comments", "Comments", MessageSquare],
    ["keyword_blocklist", "Keyword Blocklist", Shield],
    ["reports", "Comment Reports", AlertTriangle],
    ["post_reports", "Post Reports", AlertTriangle],
  ] as const },
  { label: "Finance", items: [
    ["wallet", "Wallet", Wallet],
    ["gifts", "Gift Credits", Gift],
    ["transactions", "Transactions", FileText],
    ["orders", "Orders", ClipboardList],
  ] as const },
  { label: "Marketing & SEO", items: [
    ["seo", "SEO Settings", Globe],
    ["advertisements", "Advertisements", Megaphone],
    ["performance", "Performance", Zap],
    ["announcements", "Announcements", Bell],
    ["newsletter_faq", "Newsletter & FAQ", Mail],
  ] as const },
  { label: "Pages & Navigation", items: [
    ["page_management", "Page Management", FileText],
    ["menu_builder", "Menu Builder", LayoutDashboard],
    ["redirects", "URL Redirects", ExternalLink],
  ] as const },
  { label: "System", items: [
    ["settings", "Integrations", Settings],
    ["auth_pages", "Login / Signup", LogIn],
    ["email_templates", "Email Templates", Mail],
    ["database", "Database", Database],
  ] as const },
  { label: "Help & Support", items: [
    ["support_tickets", "Support Tickets", HelpCircle],
    ["user_guide", "User Guide", BookOpen],
  ] as const },
];

const AdminPanel = () => {
  const { user, loading: authLoading } = useAuth();
  const { roles: userRoles, loading: rolesLoading } = useUserRoles();
  const adminSubRoles = useMemo(() => resolveAdminSubRoles(userRoles), [userRoles]);
  const navigate = useNavigate();
  const location = useLocation();
  const accessibleRoutes = useMemo<AdminTab[]>(() => {
    const routes: AdminTab[] = [];

    for (const group of tabGroups) {
      for (const item of group.items) {
        const key = item[0] as AdminTab;
        if (canAccessTab(adminSubRoles, key)) {
          routes.push(key);
        }
      }
    }

    return routes;
  }, [adminSubRoles]);
  const hasAdminPanelAccess = accessibleRoutes.length > 0;
  const defaultRoute: AdminTab = accessibleRoutes[0] ?? DEFAULT_ROUTE;

  // Extract current route from URL — /admin/users → "users"
  const rawRoute = location.pathname.split("/")[2] || "";
  const currentRoute: AdminTab =
    VALID_ROUTES.has(rawRoute) && canAccessTab(adminSubRoles, rawRoute as AdminTab)
      ? (rawRoute as AdminTab)
      : defaultRoute;

  // Redirect to first accessible route if invalid, unauthorized, or bare /admin
  useEffect(() => {
    if (
      !authLoading &&
      !rolesLoading &&
      hasAdminPanelAccess &&
      (!rawRoute || !VALID_ROUTES.has(rawRoute) || !canAccessTab(adminSubRoles, rawRoute as AdminTab))
    ) {
      navigate(`/admin/${defaultRoute}`, { replace: true });
    }
  }, [rawRoute, authLoading, rolesLoading, hasAdminPanelAccess, adminSubRoles, defaultRoute, navigate]);

  useEffect(() => {
    if (!authLoading && !rolesLoading && !hasAdminPanelAccess && user !== undefined) navigate("/");
  }, [hasAdminPanelAccess, authLoading, rolesLoading, navigate, user]);

  if (authLoading || rolesLoading) return <BrandLoader fullScreen />;
  if (!hasAdminPanelAccess) return null;

  return (
    <AdminLayout currentRoute={currentRoute} tabGroups={tabGroups} adminSubRoles={adminSubRoles}>
      {/* ─── Route-based content ─── */}
      {/* Content */}
      {currentRoute === "banners" && <LazyTab><AdminBanners user={user} /></LazyTab>}
      {currentRoute === "potd" && <LazyTab><AdminPhotoOfDay user={user} /></LazyTab>}
      {currentRoute === "on_page_images" && <LazyTab><AdminOnPageImages user={user} /></LazyTab>}
      {currentRoute === "portfolio" && <LazyTab><AdminGallery user={user} /></LazyTab>}
      {currentRoute === "featured_artist" && <LazyTab><AdminFeaturedArtist user={user} /></LazyTab>}

      {/* Editorial */}
      {currentRoute === "journal" && <LazyTab><AdminJournal /></LazyTab>}
      {currentRoute === "courses" && <LazyTab><AdminCourses /></LazyTab>}
      {currentRoute === "certificates" && <LazyTab><AdminCertificates user={user} /></LazyTab>}
      {currentRoute === "excellence" && <LazyTab><AdminExcellence user={user} /></LazyTab>}

      {/* Competitions — modularized */}
      {currentRoute === "competitions" && <LazyTab><CompetitionsModule user={user} /></LazyTab>}
      {currentRoute === "competition_health" && <LazyTab><AdminCompetitionHealth /></LazyTab>}
      {currentRoute === "entries" && <LazyTab><EntriesModule /></LazyTab>}
      {currentRoute === "judging_tags" && user && <LazyTab><AdminJudgingTags adminId={user.id} /></LazyTab>}
      {currentRoute === "tag_semantics" && <LazyTab><AdminTagSemanticsAudit /></LazyTab>}
      {currentRoute === "judge_monitoring" && <LazyTab><JudgeMonitoringModule /></LazyTab>}
      {currentRoute === "vote_audit" && user && <LazyTab><VoteAuditModule user={user} /></LazyTab>}
      {currentRoute === "judge_activity" && <LazyTab><JudgeActivityModule /></LazyTab>}
      {currentRoute === "vote_rewards" && <LazyTab><AdminVoteRewards user={user} /></LazyTab>}

      {/* Users — modularized */}
      {currentRoute === "users" && <LazyTab><UsersModule user={user} /></LazyTab>}
      {currentRoute === "applications" && <LazyTab><RoleApplicationsModule userId={user?.id || ""} /></LazyTab>}

      {/* Moderation — modularized */}
      {currentRoute === "comments" && <LazyTab><CommentsModule user={user} /></LazyTab>}
      {currentRoute === "keyword_blocklist" && <LazyTab><AdminKeywordBlocklist user={user} /></LazyTab>}
      {currentRoute === "reports" && <LazyTab><AdminCommentReports user={user} /></LazyTab>}
      {currentRoute === "post_reports" && <LazyTab><AdminPostReports user={user} /></LazyTab>}

      {/* Finance */}
      {currentRoute === "wallet" && <LazyTab><AdminWalletTab user={user} /></LazyTab>}
      {currentRoute === "gifts" && <LazyTab><AdminGiftCredit user={user} /></LazyTab>}
      {currentRoute === "transactions" && <LazyTab><AdminTransactions user={user} /></LazyTab>}
      {currentRoute === "orders" && <LazyTab><AdminOrders /></LazyTab>}

      {/* Marketing & SEO */}
      {currentRoute === "seo" && <LazyTab><AdminSEO user={user} /></LazyTab>}
      {currentRoute === "advertisements" && <LazyTab><AdminAdvertisements user={user} /></LazyTab>}
      {currentRoute === "performance" && <LazyTab><AdminPerformance user={user} /></LazyTab>}
      {currentRoute === "announcements" && <LazyTab><AdminAnnouncements user={user} /></LazyTab>}
      {currentRoute === "newsletter_faq" && <LazyTab><AdminNewsletterFaq /></LazyTab>}
      {currentRoute === "analytics" && <LazyTab><AdminAnalytics user={user} /></LazyTab>}

      {/* Pages & Navigation */}
      {currentRoute === "page_management" && <LazyTab><AdminPageManagement user={user} /></LazyTab>}
      {currentRoute === "menu_builder" && <LazyTab><AdminMenuBuilder user={user} /></LazyTab>}
      {currentRoute === "redirects" && <LazyTab><AdminRedirects user={user} /></LazyTab>}

      {/* System */}
      {currentRoute === "settings" && <LazyTab><AdminSettings user={user} /></LazyTab>}
      {currentRoute === "auth_pages" && <LazyTab><AdminAuthPages user={user} /></LazyTab>}
      {currentRoute === "email_templates" && <LazyTab><AdminEmailTemplates user={user} /></LazyTab>}
      {currentRoute === "database" && <LazyTab><DatabaseModule /></LazyTab>}

      {/* Overview */}
      {currentRoute === "health" && <LazyTab><AdminHealth user={user} /></LazyTab>}
      {currentRoute === "notifications_health" && <LazyTab><AdminNotificationsHealth /></LazyTab>}
      {currentRoute === "test_agent" && <LazyTab><AdminTestAgent /></LazyTab>}
      {currentRoute === "activity_logs" && <LazyTab><AdminActivityLogs /></LazyTab>}
      {currentRoute === "admin_notifications" && <LazyTab><AdminNotifications /></LazyTab>}

      {/* Users & Community */}
      {currentRoute === "engagement" && <LazyTab><AdminEngagement user={user} /></LazyTab>}
      {currentRoute === "referrals" && <LazyTab><AdminReferrals user={user} /></LazyTab>}

      {/* Help & Support */}
      {currentRoute === "support_tickets" && <LazyTab><AdminSupportTickets user={user} /></LazyTab>}
      {currentRoute === "user_guide" && <LazyTab><AdminUserGuide /></LazyTab>}
    </AdminLayout>
  );
};

export default AdminPanel;
