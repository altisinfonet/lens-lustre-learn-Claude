import { Outlet, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import GiftCelebrationModal from "@/components/GiftCelebrationModal";
import AnnouncementBar from "@/components/AnnouncementBar";
import AskAnything from "@/components/AskAnything";
import PageSEO from "@/components/PageSEO";
import FeedRightSidebar from "@/components/FeedRightSidebar";
import FeedLeftSidebar from "@/components/FeedLeftSidebar";
import ProfileLeftSidebar from "@/components/profile/ProfileLeftSidebar";
import AdPlacement from "@/components/AdPlacement";
import OnboardingModal from "@/components/OnboardingModal";
import MobileBottomNav from "@/components/MobileBottomNav";
import AnchorAd from "@/components/AnchorAd";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import SiteFooter from "@/components/SiteFooter";
import { resetAdCounter } from "@/lib/adDensity";
import PageTransition from "@/components/PageTransition";
import { useAuth } from "@/hooks/core/useAuth";
import { useLastActive } from "@/hooks/core/useLastActive";
import { DashboardProvider, useDashboardContext } from "@/hooks/core/DashboardContext";

import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useEffect, useState } from "react";
import { useGlobalConversionTracker } from "@/hooks/core/useGlobalConversionTracker";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence } from "framer-motion";

/** Pages where the Navbar should NOT be shown (auth screens) */
const hideNavRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin"];

/** Routes where sidebars should NOT be shown (even for logged-in users) */
const hideSidebarRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin", "/courses", "/journal", "/judge", "/featured-artist"];

/** Pages where ads should NOT be shown */
const hideAdRoutes = ["/login", "/signup", "/forgot-password", "/reset-password"];

const SKIP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Home page gets a transparent overlay navbar */
const Layout = () => {
  return (
    <DashboardProvider>
      <LayoutInner />
    </DashboardProvider>
  );
};

const LayoutInner = () => {
  const { pathname } = useLocation();
  // Reset ad density counter on route change
  useEffect(() => { resetAdCounter(); }, [pathname]);
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  useLastActive();
  useGlobalConversionTracker();

  // Dashboard context — SINGLE SOURCE OF TRUTH for sidebar + settings
  const { sidebarData, isLoading: dashboardLoading } = useDashboardContext();

  const hideNav = hideNavRoutes.includes(pathname);
  const isHome = pathname === "/";
  const isProfilePage = pathname === "/profile";
  const isSidebarHiddenRoute = hideSidebarRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  const isSidebarEligibleRoute = !isHome && !isSidebarHiddenRoute;
  const showAds = !hideAdRoutes.includes(pathname) && !pathname.startsWith("/admin");

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingProfile, setOnboardingProfile] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    if (!user || adminLoading) {
      setShowOnboarding(false);
      return;
    }
    if (isAdmin) {
      setShowOnboarding(false);
      return;
    }

    // Check sessionStorage cache to avoid querying on every page load
    const cacheKey = `onboarding_done_${user.id}`;
    if (sessionStorage.getItem(cacheKey) === "true") {
      return;
    }

    const check = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!data) return;

      const profile = data as any;

      const missingUserType = !profile.user_type;

      // If onboarding was completed AND user_type is set, cache and skip
      if (profile.onboarding_completed && !missingUserType) {
        sessionStorage.setItem(cacheKey, "true");
        return;
      }

      // Check if skipped recently (within 24 hours)
      if (profile.onboarding_skipped_at) {
        const skippedAt = new Date(profile.onboarding_skipped_at).getTime();
        const now = Date.now();
        if (now - skippedAt < SKIP_COOLDOWN_MS) {
          return;
        }
        await supabase
          .from("profiles")
          .update({ onboarding_skipped_at: null } as any)
          .eq("id", user.id);
      }

      setOnboardingProfile(profile);
      setShowOnboarding(true);
    };
    check();
  }, [user, isAdmin, adminLoading]);

  return (
    <>
      <PageSEO />
      {!hideNav && isHome && (
        <div className="absolute top-0 left-0 right-0 z-50">
          <AnnouncementBar />
          <Navbar transparent />
        </div>
      )}
      {!hideNav && !isHome && (
        <>
          <AnnouncementBar />
          <Navbar />
        </>
      )}

      {showAds && !isHome && (
        <div className="container mx-auto pt-2">
          <AdPlacement placement="header" variant="plain" />
        </div>
      )}

      {!showOnboarding && <GiftCelebrationModal />}

      {user && showOnboarding && (
        <OnboardingModal
          open={showOnboarding}
          userId={user.id}
          profile={onboardingProfile}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {/* Page content with bottom nav padding on mobile */}
      <div className="pb-12 lg:pb-0">
        {isSidebarEligibleRoute ? (
          <div className="flex gap-8 container mx-auto">
            <aside className="hidden xl:block w-64 shrink-0 sticky top-24 self-start py-6 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-hide">
              <>
                <FeedLeftSidebar sidebarData={sidebarData} isLoading={dashboardLoading} />
                {isProfilePage && <ProfileLeftSidebar />}
              </>
            </aside>
            <div className="flex-1 min-w-0 w-full max-w-[590px] mx-auto">
              <AnimatePresence mode="wait">
                <PageTransition key={pathname}>
                  <Outlet />
                  {showAds && (
                    <div className="py-6">
                      <AdPlacement placement="in-content" />
                    </div>
                  )}
                </PageTransition>
              </AnimatePresence>
            </div>
            <aside className="hidden lg:block w-72 shrink-0 sticky top-24 self-start py-6 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-hide">
              <FeedRightSidebar sidebarData={sidebarData} isLoading={dashboardLoading} />
            </aside>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <PageTransition key={pathname}>
              <Outlet />
              {showAds && (
                <div className="container mx-auto py-6">
                  <AdPlacement placement="in-content" />
                </div>
              )}
            </PageTransition>
          </AnimatePresence>
        )}
      </div>

      {/* Site Footer — shows managed pages with footer placement */}
      {!hideNav && <SiteFooter />}

      {/* Mobile bottom navigation */}
      <MobileBottomNav />
      <AnchorAd />
      <CookieConsentBanner />

      {!hideNav && <AskAnything />}
    </>
  );
};

export default Layout;
