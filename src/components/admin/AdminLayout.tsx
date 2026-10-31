/**
 * AdminLayout — provides sidebar + header shell for all admin routes.
 * Uses react-router navigate() for tab navigation instead of setState.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { Search, X, ChevronDown, Shield, ArrowLeft } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import MobileAdminNav from "@/components/admin/MobileAdminNav";
import { useAuth } from "@/hooks/core/useAuth";
import { filterTabGroups, canAccessTab, type AdminTab, type AdminSubRole } from "@/lib/adminRoleAccess";
import { supabase } from "@/integrations/supabase/client";
import { userService } from "@/services/admin/userService";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/i18n/I18nContext";
import { ADMIN_GROUP_KEYS } from "@/i18n/translations";

interface AdminLayoutProps {
  currentRoute: string;
  tabGroups: { label: string; items: readonly (readonly [string, string, LucideIcon])[] }[];
  children: React.ReactNode;
  adminSubRoles: AdminSubRole[];
}

const AdminLayout = ({ currentRoute, tabGroups, children, adminSubRoles }: AdminLayoutProps) => {
  const t = useT();
  const gl = (label: string) => { const k = ADMIN_GROUP_KEYS[label]; return k ? t(k) : label; };
  const siteLogo = useSiteLogo();
  const { user } = useAuth();
  const navigate = useNavigate();
  const mainContentRef = useRef<HTMLElement | null>(null);
  const tabTopRef = useRef<HTMLDivElement | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [mobileMenuVisible, setMobileMenuVisible] = useState(true);
  const [unresolvedTicketCount, setUnresolvedTicketCount] = useState(0);
  const [unreadAdminNotificationCount, setUnreadAdminNotificationCount] = useState(0);
  const [totalUserCount, setTotalUserCount] = useState(0);

  // Memoize RBAC filtering (V6-005 fix)
  const filteredTabGroups = useMemo(
    () => filterTabGroups(tabGroups, adminSubRoles),
    [tabGroups, adminSubRoles]
  );

  // Live indicator badges
  useEffect(() => {
    if (!user) return;

    const fetchIndicators = async () => {
      const counts = await userService.getIndicatorCounts();
      setUnresolvedTicketCount(counts.tickets);
      setUnreadAdminNotificationCount(counts.notifications);
    };

    const ticketChannel = supabase
      .channel("admin-support-ticket-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, fetchIndicators)
      .subscribe();

    const notifChannel = supabase
      .channel("admin-notification-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_notifications" }, fetchIndicators)
      .subscribe();

    void fetchIndicators();

    return () => {
      supabase.removeChannel(ticketChannel);
      supabase.removeChannel(notifChannel);
    };
  }, [user?.id]);

  // Total user count + entry/competition counts for mobile stats
  const [totalEntryCount, setTotalEntryCount] = useState(0);
  const [totalCompetitionCount, setTotalCompetitionCount] = useState(0);

  useEffect(() => {
    Promise.all([
      userService.getTotalUserCount(),
      supabase.from("competition_entries").select("id", { count: "exact", head: true }),
      supabase.from("competitions").select("id", { count: "exact", head: true }),
    ]).then(([users, entries, comps]) => {
      setTotalUserCount(users);
      setTotalEntryCount(entries.count ?? 0);
      setTotalCompetitionCount(comps.count ?? 0);
    });
  }, []);

  // Scroll to top on route change
  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      mainContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
      tabTopRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [currentRoute]);

  const navigateToRoute = (route: string) => {
    navigate(`/admin/${route}`);
  };

  const handleMobileSetTab = (t: string) => {
    navigateToRoute(t);
    setMobileMenuVisible(false);
  };

  const handleBackNavigation = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  };

  const mobileStats = {
    users: totalUserCount,
    entries: totalEntryCount,
    competitions: totalCompetitionCount,
    tickets: unresolvedTicketCount,
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Mobile Admin Nav */}
      <MobileAdminNav
        tab={currentRoute}
        setTab={handleMobileSetTab}
        tabGroups={filteredTabGroups}
        unresolvedTicketCount={unresolvedTicketCount}
        stats={mobileStats}
        menuVisible={mobileMenuVisible}
        setMenuVisible={setMobileMenuVisible}
      />

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-border bg-card/50 flex-col h-screen sticky top-0 overflow-hidden">
        <div className="px-5 py-6 border-b border-border">
          <Link to="/" className="flex items-center gap-2 mb-1">
            <img src={siteLogo} alt="Logo" className="h-7 w-7 object-contain" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              50mm Retina World
            </span>
          </Link>
          <h2 className="text-lg font-light mt-3" style={{ fontFamily: "var(--font-display)" }}>
            {t("msheet.admin")} <em className="italic text-primary">{t("adm.panel")}</em>
          </h2>
        </div>
        {/* Sidebar Search */}
        <div className="px-3 py-2 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              type="text" value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
              placeholder={t("adm.searchSections")}
              className="w-full pl-8 pr-7 py-2 text-xs bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/40"
              style={{ fontFamily: "var(--font-body)" }}
            />
            {sidebarSearch && (
              <button onClick={() => setSidebarSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto overflow-x-hidden scrollbar-themed pr-1">
          {filteredTabGroups.map((group) => {
            const sq = sidebarSearch.toLowerCase().trim();
            const filteredItems = sq
              ? group.items.filter(item =>
                  item[1].toLowerCase().includes(sq) ||
                  group.label.toLowerCase().includes(sq) ||
                  t("adm.nav." + item[0], item[1]).toLowerCase().includes(sq) ||
                  gl(group.label).toLowerCase().includes(sq))
              : group.items;
            if (filteredItems.length === 0) return null;
            const isGroupActive = filteredItems.some((item) => item[0] === currentRoute);
            const forceOpen = sq.length > 0;
            return (
              <Collapsible key={group.label} defaultOpen={isGroupActive || forceOpen} open={forceOpen ? true : undefined}>
                <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-[11px] tracking-[0.2em] uppercase text-muted-foreground/60 font-semibold hover:text-muted-foreground transition-colors group/collapsible" style={{ fontFamily: "var(--font-heading)" }}>
                  <span className="truncate">{gl(group.label)}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
                  <div className="space-y-0.5 pb-2">
                    {filteredItems.map(([key, label, Icon]) => (
                      <button key={key} onClick={() => navigateToRoute(key)}
                        className={`w-full flex items-center gap-2.5 text-[13px] px-3 py-2.5 rounded-sm transition-all duration-300 border-l-2 ${
                          currentRoute === key ? "bg-primary/10 text-primary border-primary" : "text-muted-foreground hover:text-primary hover:bg-primary/5 border-transparent"
                        }`} style={{ fontFamily: "var(--font-body)" }}>
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t("adm.nav." + key, label)}</span>
                        {key === "support_tickets" && unresolvedTicketCount > 0 && (
                          <span className="ml-auto bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
                            {unresolvedTicketCount}
                          </span>
                        )}
                        {key === "admin_notifications" && unreadAdminNotificationCount > 0 && (
                          <span className="ml-auto bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
                            {unreadAdminNotificationCount}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-border">
          <Link to="/" className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
            {t("adm.backToSite")}
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main ref={mainContentRef} className={`flex-1 w-full min-h-screen overflow-y-auto md:pb-0 ${mobileMenuVisible ? "hidden md:block" : ""}`}>
        <div className="w-full max-w-none md:max-w-6xl mx-auto py-4 md:py-12 relative">
          <div ref={tabTopRef} />
          <div className="px-4 md:px-0 mb-4">
            <button
              onClick={handleBackNavigation}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-primary transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t("common.back")}
            </button>
          </div>

          {/* Route access guard */}
          {!canAccessTab(adminSubRoles, currentRoute as AdminTab) ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Shield className="h-10 w-10 text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {t("adm.noPermission")}
              </p>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
