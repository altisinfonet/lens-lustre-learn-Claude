import { Outlet, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import GlobalComposer from "@/components/GlobalComposer";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import GiftCelebrationModal from "@/components/GiftCelebrationModal";
import AnnouncementBar from "@/components/AnnouncementBar";
import AskAnything from "@/components/AskAnything";
import PageSEO from "@/components/PageSEO";
import FeedRightSidebar from "@/components/FeedRightSidebar";
import FeedLeftSidebar from "@/components/FeedLeftSidebar";
import ProfileLeftSidebar from "@/components/profile/ProfileLeftSidebar";
import OnboardingModal from "@/components/OnboardingModal";

/**
 * Suppresses the "add a profile photo" prompt for the CURRENT session only.
 * sessionStorage on purpose: the next time the member opens the app they are
 * asked again, which is exactly what the owner asked for on 2026-08-05.
 */
const PHOTO_PROMPT_SNOOZE_KEY = "dp_prompt_snoozed_v1";
import MobileBottomNav from "@/components/MobileBottomNav";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import SiteFooter from "@/components/SiteFooter";
import PageTransition from "@/components/PageTransition";
import { isOwnProfilePhoto } from "@/lib/profilePhoto";
import { useAuth } from "@/hooks/core/useAuth";
import { useLastActive } from "@/hooks/core/useLastActive";
import { useEngagementHeartbeat } from "@/hooks/core/useEngagementHeartbeat";
import { DashboardProvider, useDashboardContext } from "@/hooks/core/DashboardContext";

import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useGlobalConversionTracker } from "@/hooks/core/useGlobalConversionTracker";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence } from "framer-motion";
import { BareLayoutProvider, useIsBareShell } from "@/components/BareLayoutContext";

/** Pages where the Navbar should NOT be shown (auth screens) */
const hideNavRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin"];

/** Routes where sidebars should NOT be shown (even for logged-in users) */
const hideSidebarRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin", "/courses", "/journal", "/judge", "/featured-artist"];

/** Home page gets a transparent overlay navbar */
const Layout = () => {
  return (
    <DashboardProvider>
      {/* F-89: must sit ABOVE LayoutInner so a page rendered into the Outlet
          can raise the bare-shell flag and LayoutInner can read it. */}
      <BareLayoutProvider>
        <LayoutInner />
      </BareLayoutProvider>
    </DashboardProvider>
  );
};

const LayoutInner = () => {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  useLastActive();
  // Phase 2a — Active Engagement collector. Collect only: nothing scored,
  // nothing displayed. Signed-out visitors are never touched.
  useEngagementHeartbeat();
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
  /**
   * F-89 — A 404 HAS NO PATH, SO IT CANNOT BE ON A ROUTE LIST.
   *
   * `hideSidebarRoutes` above is matched against `pathname`. A 404 happens at
   * an ARBITRARY address, so it can never match, and it was rendering inside
   * the full two-column feed shell: a stranger who mistyped a URL got
   * "Welcome / Sign Up Free / Popular Categories" on the left and
   * "Competitions / Learn Photography" on the right, with the error squeezed
   * between them. Three competing calls to action wrapped around a dead end.
   *
   * The page raises this flag itself (see BareLayoutContext), which is the only
   * mechanism that covers BOTH ways the 404 is now reached — the catch-all
   * route AND CustomUrlProfile rendering it in place at the member's own typed
   * path. A pathname test passes the first and silently fails the second.
   */
  const bareShell = useIsBareShell();
  const isSidebarEligibleRoute = !isHome && !isSidebarHiddenRoute && !bareShell;

  const [showOnboarding, setShowOnboarding] = useState(false);
  /** True when the profile photo is the last thing missing — see the effect below. */
  const [photoPromptOnly, setPhotoPromptOnly] = useState(false);
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

      /**
       * ONBOARDING IS DONE WHEN THE STRUCTURAL FIELDS ARE DONE. THE PHOTO IS
       * NOT ONE OF THEM.
       *
       * OWNER'S REVISED ORDER, 2026-08-05, marked FINAL NOTICE:
       *
       *   "For DP dont block any users to post anything. But DP will be filled
       *    up as policy either uploaded by user or filled up by system based on
       *    the gender. BUt Final Notice : DONT BLOCK ANY USERS for DP to post -
       *    allow all"
       *
       * missingAvatar used to be part of this condition, so a member with no
       * UPLOADED photo was never considered finished and the modal reopened on
       * their next action — which is what happened seconds after registering as
       * "leeza.basu": "1st step done. when trying to post again this pop up
       * coiming."
       *
       * THE PREMISE OF THAT PROMPT NO LONGER HOLDS. Nobody is without a picture
       * any more: handle_new_user() assigns one at registration and
       * trg_ensure_member_always_has_picture refuses to let any write blank it.
       *
       * missingAvatar is still COMPUTED — isOwnProfilePhoto remains the single
       * definition of "a photo the member actually uploaded", which is what
       * gets reinstated at ~1000 members.
       */
      void missingAvatar;

      if (profile.onboarding_completed && !missingUserType && !missingUsername) {
        sessionStorage.setItem(cacheKey, "true");
        return;
      }

      // NOTE (bug fix 2026-07-28): the 24-hour "skipped recently" window that
      // used to live here was the loophole that let accounts exist without a
      // profile photo — onboarding_skipped_at delayed the modal for a day at a
      // time, indefinitely. Nothing in the current UI even sets that column.
      // Onboarding is now unskippable: incomplete profile => modal, always.

      /**
       * THE PHOTO IS A PROMPT NOW, NOT A WALL.
       *
       * Owner decision, 2026-08-05: *"allow everyone to post and to comment
       * despite DP is there yes / no. But everytime if DP is not there ask to
       * upload but if everytime ignores, no issues allow them ... but on next
       * opening again ask to upload DP."*
       *
       * So when the photo is the ONLY thing missing, the modal becomes
       * closable. `user_type` and `custom_url` still block, because those are
       * structural — the username is part of the member's URL — and the owner
       * stepped back on the photo, nothing else.
       *
       * "Ask again on next opening" is implemented with sessionStorage, and
       * that choice is the whole behaviour: a dismissal lasts exactly as long
       * as the tab / app session. It does NOT nag on every route change within
       * one session, and it does NOT persist to localStorage or to a column —
       * either of those would turn "remind me later" into "never ask again",
       * which is the loophole that let accounts exist with no photo before
       * 2026-07-28.
       */
      /**
       * Reaching here means something STRUCTURAL is missing — a username or a
       * member type — and those cannot be filled in by the system: the username
       * is part of the member's public URL and is permanent.
       */
      setPhotoPromptOnly(false);
      setOnboardingProfile(profile);
      setShowOnboarding(true);
    };
    check();
  }, [user, isAdmin, adminLoading, pathname]);

  return (
    <>
      <PageSEO />
      {/* ONE Navbar, always in the same place in the tree.
          It used to be rendered from two different JSX positions — one for the
          home route, one for everything else — so crossing that boundary
          destroyed and rebuilt the navbar and everything inside it: the
          notification bell's unread state, the search box, any open menu. The
          home page still gets its overlaid, transparent treatment, but through
          a wrapper class rather than a second element, so React keeps one
          instance across every route.
          The home-only wrapper carries `absolute top-0 left-0 right-0 z-50`
          exactly as before — see the note above about /home and the hero. */}
      {/*
        THE HEADER STICKS TO THE TOP WHILE SCROLLING — WEB ONLY.
        Owner rule, 2026-08-04: "Only for Web: top menu bar will be strict all
        the time, even on scrolling."

        The <nav> inside already carried `sticky top-0 z-50` and it never
        worked. Measured on production: the nav's computed position WAS
        `sticky`, top `0px`, z-index 50 — correct CSS — but after scrolling
        1400px its top was -1400, i.e. it had scrolled clean off.

        The reason is that `position: sticky` only holds while the element's
        CONTAINING BLOCK is on screen, and this wrapper is exactly as tall as
        the bar itself (89px measured). So the nav had 89px of travel and then
        left with its parent. Sticky has to sit on the element whose parent
        spans the page — this wrapper, whose parent is the document flow.
        Verified live before writing it: with sticky moved up here the nav
        stays at top 0 at 1600px AND 3000px of scroll.

        Because sticky keeps the element in normal flow there is no layout
        shift and no content-padding to maintain (a `fixed` bar would need it).

        NOT applied inside the installed app, per "Only for Web" — the app's
        header behaviour is left exactly as it is. The home page keeps its
        transparent overlay treatment over the hero, unchanged.
      */}
      {!hideNav && (
        <div
          className={
            isHome
              ? "absolute top-0 left-0 right-0 z-50"
              : isNativeCapacitorApp()
                ? undefined
                : "sticky top-0 z-50"
          }
        >
          <AnnouncementBar />
          <Navbar transparent={isHome} />
        </div>
      )}

      {!showOnboarding && <GiftCelebrationModal />}

      {/*
        THE ONE UPLOADER, REACHABLE FROM EVERY PAGE.
        ─────────────────────────────────────────────────────────────────────────
        Owner, 2026-08-16: "as top menu icon is fix it should be from single
        uploader while standing on any page - that is not happening. why ?"

        Because the composer lived inside the Feed PAGE, so the fixed top-bar
        button had to navigate to /feed to reach it — and that navigation was the
        bug. Pressing Create did two things at once: changed the page AND opened
        Android's photo picker, which backgrounds the WebView mid-transition.
        From the feed there was no page change and therefore no race, which is
        exactly why it worked there and nowhere else.

        Mounted here, it belongs to the SHELL rather than to a page. The button
        raises `?compose=1` on the current url, this composer opens in place, and
        nothing navigates. The race is deleted rather than patched.

        NATIVE APP ONLY, deliberately. The website's composer is an inline row on
        the feed and is not reported broken; scoping this to the app keeps the
        change off every web surface. `composerOnly` draws no post list and, since
        today, fetches none either — so this costs a mount and no query.
      */}
      {user && isNativeCapacitorApp() && (
        <GlobalComposer userId={user.id} />
      )}

      {user && showOnboarding && (
        <OnboardingModal
          open={showOnboarding}
          dismissible={photoPromptOnly}
          onDismiss={() => {
            // Session-scoped: quiet for now, asked again on the next opening.
            try { sessionStorage.setItem(PHOTO_PROMPT_SNOOZE_KEY, "1"); } catch { /* ignore */ }
            setShowOnboarding(false);
          }}
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
      {/*
        ⚠ ONE STRUCTURE, NOT TWO BRANCHES — AND THAT IS A BUG FIX, NOT A TIDY-UP.
        F-89 shipped this as a ternary: a sidebar branch that wrapped <Outlet />
        in div > div > AnimatePresence, and a bare branch with AnimatePresence at
        the top. Those are DIFFERENT TREE SHAPES, so every flip of
        isSidebarEligibleRoute destroyed and recreated the whole Outlet subtree.

        On the catch-all route that cost one extra remount and settled, because
        NotFound holds no state. On the SINGLE-SEGMENT route it was unbounded:
        the remount reset CustomUrlProfile's `checking` back to true, NotFound
        unmounted, its cleanup set the flag false, the shell came back, the
        lookup completed, NotFound mounted, the flag went true, and the subtree
        was destroyed again. Deployed staging logged UI-8006 about twice a
        second for ever; the harness scene logs 41/sec. The page never drew.

        So the layout must not change SHAPE when the flag changes — only its
        classes and whether the asides render. The middle column keeps its
        position in the children list either way, so React keeps its identity
        and nothing below it remounts.
      */}
      <div className="pb-12 lg:pb-0">
        <div className={isSidebarEligibleRoute ? "flex gap-8 container mx-auto" : undefined}>
          {isSidebarEligibleRoute ? (
            <aside className="hidden xl:block w-64 shrink-0 sticky top-24 self-start py-6 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-hide">
              <>
                <FeedLeftSidebar sidebarData={sidebarData} isLoading={dashboardLoading} />
                {isProfilePage && <ProfileLeftSidebar />}
              </>
            </aside>
          ) : null}
          <div className={isSidebarEligibleRoute ? "flex-1 min-w-0 w-full max-w-[590px] mx-auto" : undefined}>
            <AnimatePresence mode="wait">
              <PageTransition key={pathname}>
                <Outlet />
              </PageTransition>
            </AnimatePresence>
          </div>
          {isSidebarEligibleRoute ? (
            <aside className="hidden lg:block w-72 shrink-0 sticky top-24 self-start py-6 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-hide">
              <FeedRightSidebar sidebarData={sidebarData} isLoading={dashboardLoading} />
            </aside>
          ) : null}
        </div>
      </div>

      {/* Site Footer — the policy/links footer.
          Owner, 2026-08-07: inside the installed APP the footer menu belongs on
          the home page only; every other page stays clean, Instagram-style. On
          the WEB it is unchanged (shows on every page as before). The bottom
          tab bar below is separate — it is primary navigation and always shows. */}
      {!hideNav && (isHome || !isNativeCapacitorApp()) && <SiteFooter />}

      {/* Mobile bottom navigation — primary nav, untouched. */}
      <MobileBottomNav />
      <CookieConsentBanner />

      {/* "Ask anything" — home page only, on BOTH app and web (owner, 2026-08-07).
          A support-chat bubble floating over every screen is clutter the feed,
          profile and journal pages do not need. */}
      {isHome && !hideNav && <AskAnything />}
    </>
  );
};

export default Layout;
