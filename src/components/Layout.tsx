import { Outlet, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import GiftCelebrationModal from "@/components/GiftCelebrationModal";
import AnnouncementBar from "@/components/AnnouncementBar";
import AskAnything from "@/components/AskAnything";
import PageSEO from "@/components/PageSEO";
import FeedRightSidebar from "@/components/FeedRightSidebar";
import FeedLeftSidebar from "@/components/FeedLeftSidebar";
import ProfileLeftSidebar from "@/components/profile/ProfileLeftSidebar";
import OnboardingModal from "@/components/OnboardingModal";
import MobileBottomNav from "@/components/MobileBottomNav";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import SiteFooter from "@/components/SiteFooter";
import PageTransition from "@/components/PageTransition";
import { isOwnProfilePhoto } from "@/lib/profilePhoto";
import { useAuth } from "@/hooks/core/useAuth";
import { useLastActive } from "@/hooks/core/useLastActive";
import { DashboardProvider, useDashboardContext } from "@/hooks/core/DashboardContext";

import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useGlobalConversionTracker } from "@/hooks/core/useGlobalConversionTracker";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence } from "framer-motion";

/** Pages where the Navbar should NOT be shown (auth screens) */
const hideNavRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin"];

/** Routes where sidebars should NOT be shown (even for logged-in users) */
const hideSidebarRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin", "/courses", "/journal", "/judge", "/featured-artist"];

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
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  useLastActive();
  useGlobalConversionTracker();

  // Dashboard context — SINGLE SOURCE OF TRUTH for sidebar + settings
  const { sidebarData, isLoading: dashboardLoading } = useDashboardContext();

  const hideNav = hideNavRoutes.includes(pathname);
  // The marketing home page lives at BOTH "/" (logged-out) and "/home"
  // (logged-in — IndexGate redirects "/" to "/feed", so the logo links here).
  // Treating only "/" as home meant "/home" fell through to the feed shell:
  // Index rendered inside `flex gap-8 container mx-auto` with a max-w-[590px]
  // column, so the full-bleed hero was squeezed to 590px on desktop and the
  // 90%-wide .container left blank bands down both edges on mobile/app.
  const isHome = pathname === "/" || pathname === "/home";
  const isProfilePage = pathname === "/profile";
  const isSidebarHiddenRoute = hideSidebarRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  const isSidebarEligibleRoute = !isHome && !isSidebarHiddenRoute;

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
    // Never show onboarding over auth screens. A password-recovery link signs
    // the user in and lands on /reset-password — with an incomplete profile the
    // onboarding modal was covering the "set new password" form, so users could
    // never actually reset their password.
    if (hideNavRoutes.includes(pathname) || sessionStorage.getItem("password_recovery_active") === "true") {
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
      // Permanent username (custom_url) is claimed during onboarding and is
      // mandatory for every account. Existing accounts without one are pulled
      // through the gate once on their next visit.
      const missingUsername = !profile.custom_url;
      // A profile photo is mandatory (owner policy), and it only counts if the
      // member UPLOADED it.
      //
      // `!profile.avatar_url` was not enough. Google sign-in writes the
      // member's Google account picture into avatar_url automatically, before
      // they touch anything — so the check was already false at account
      // creation and the gate never opened. Measured 2026-08-01: 31 of 77
      // accounts had a lh3.googleusercontent.com URL as their "profile photo",
      // never chosen, often Google's grey letter placeholder. See
      // src/lib/profilePhoto.ts.
      //
      // Using isOwnProfilePhoto here pulls all 31 through the gate on their
      // next visit, web or app, and the modal cannot be dismissed.
      const missingAvatar = !isOwnProfilePhoto(profile.avatar_url);

      // Onboarding is DONE only when completed AND user_type AND username AND
      // profile photo are all present.
      if (profile.onboarding_completed && !missingUserType && !missingUsername && !missingAvatar) {
        sessionStorage.setItem(cacheKey, "true");
        return;
      }

      // NOTE (bug fix 2026-07-28): the 24-hour "skipped recently" window that
      // used to live here was the loophole that let accounts exist without a
      // profile photo — onboarding_skipped_at delayed the modal for a day at a
      // time, indefinitely. Nothing in the current UI even sets that column.
      // Onboarding is now unskippable: incomplete profile => modal, always.

      setOnboardingProfile(profile);
      setShowOnboarding(true);
    };
    check();
  }, [user, isAdmin, adminLoading, pathname]);

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

      {!showOnboarding && <GiftCelebrationModal />}

      {user && showOnboarding && (
        <OnboardingModal
          open={showOnboarding}
          userId={user.id}
          profile={onboardingProfile}
          onComplete={() => {
            setShowOnboarding(false);
            // The avatar/profile saved during onboarding must show INSTANTLY —
            // without this, the header kept the stale cached profile (no avatar)
            // until a manual refresh refetched it.
            if (user) {
              queryClient.invalidateQueries({ queryKey: queryKeys.profileCore(user.id) });
              queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(user.id) });
              queryClient.invalidateQueries({ queryKey: queryKeys.profileMapPrefix() });
            }
          }}
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
            </PageTransition>
          </AnimatePresence>
        )}
      </div>

      {/* Site Footer — shows managed pages with footer placement */}
      {!hideNav && <SiteFooter />}

      {/* Mobile bottom navigation */}
      <MobileBottomNav />
      <CookieConsentBanner />

      {!hideNav && <AskAnything />}
    </>
  );
};

export default Layout;
