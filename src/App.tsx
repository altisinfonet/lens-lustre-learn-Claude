import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./App.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/core/useAuth";
import { ThemeProvider } from "@/hooks/core/useTheme";

import { CookieConsentProvider } from "@/hooks/core/useCookieConsent";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import { HelmetProvider } from "react-helmet-async";
import { lazy, Suspense, useEffect, useState } from "react";
import Layout from "@/components/Layout";
import RedirectHandler from "@/components/RedirectHandler";
import BrandLoader from "@/components/BrandLoader";
import DynamicFavicon from "@/components/DynamicFavicon";
import SplashScreen from "@/components/SplashScreen";
import AdFullscreenProvider from "@/components/ads/AdFullscreenProvider";
import { I18nProvider } from "@/i18n/I18nContext";
import LanguageAccountSync from "@/components/LanguageAccountSync";
import PushNotificationsGate from "@/components/PushNotificationsGate";
import AppUpdatePrompt from "@/components/AppUpdatePrompt";
import AppErrorBoundary from "@/components/AppErrorBoundary";


/**
 * lazy() with self-healing: after a deploy, a phone still holding the old
 * index.html asks for hashed chunks that no longer exist -> the route failed
 * and the page went BLANK (owner report 2026-07-28). On a chunk-load failure
 * we reload once (session-guarded) so the browser picks up the new build;
 * if it still fails, AppErrorBoundary shows a Reload screen instead of blank.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyRetry = (factory: () => Promise<any>, key: string) =>
  lazy(() =>
    factory().then(
      (m) => {
        try { sessionStorage.removeItem("chunk_reload_" + key); } catch { /* ignore */ }
        return m;
      },
      async (err) => {
        /**
         * ROOT CAUSE, finally evidenced 2026-08-05 from the owner's console:
         *
         *   Failed to load module script: Expected a JavaScript-or-Wasm module
         *   script but the server responded with a MIME type of "text/html".
         *   TypeError: Failed to fetch dynamically imported module:
         *   https://50mmretina.com/assets/AdminPushBroadcast-D_bNnshh.js
         *
         * Measured against production the same hour:
         *   GET /assets/<a chunk that no longer exists>  ->  200 text/html
         *
         * The host answers a MISSING asset with the SPA fallback — index.html,
         * status 200 — instead of 404. And `public/_headers` gives EVERYTHING
         * under `/assets/*` `Cache-Control: public, max-age=31536000, immutable`.
         *
         * So the browser stores that HTML under the .js URL, marked immutable,
         * FOR A YEAR. Every later attempt is served the poisoned entry from
         * disk. That is why this has persisted for ~30 days and why reloading
         * looked like it did nothing.
         *
         * Two further faults made it worse:
         *   1. the retry flag was GLOBAL and only cleared on a successful lazy
         *      load, so the first failure in a session disarmed the healing for
         *      every other route — the second failure went straight to the
         *      error screen. It is now keyed per chunk.
         *   2. a plain reload re-reads the same poisoned Cache Storage entry.
         *      We now delete the cached responses first.
         *
         * The structural fix belongs in hosting (a missing /assets/* file must
         * 404, not return HTML). Until that lands, this makes the client
         * self-heal instead of staying broken for a year.
         */
        const flag = "chunk_reload_" + key;
        let firstTry = false;
        try { firstTry = !sessionStorage.getItem(flag); } catch { /* ignore */ }

        void import("@/lib/reportClientError").then(({ reportClientError }) => {
          reportClientError("blank_page", err, { cause: "chunk_load", chunk: key, firstTry });
        }).catch(() => { /* reporting must never block healing */ });

        if (!firstTry) throw err;

        try { sessionStorage.setItem(flag, "1"); } catch { /* ignore */ }

        // Evict the poisoned HTML-under-a-.js-URL entries before reloading,
        // otherwise the reload is served the same broken bytes from disk.
        try {
          if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            await Promise.all(keys.map(async (k) => {
              const c = await caches.open(k);
              const reqs = await c.keys();
              await Promise.all(
                reqs.filter((r) => r.url.includes("/assets/")).map((r) => c.delete(r)),
              );
            }));
          }
        } catch { /* best effort */ }

        // `?cb=` defeats any intermediate cache still holding the old
        // index.html, which is what names the dead chunk in the first place.
        // stripCacheBusterParam() in main.tsx cleans it out of the address bar.
        try {
          const u = new URL(window.location.href);
          u.searchParams.set("cb", String(Date.now()));
          window.location.replace(u.toString());
          return new Promise(() => { /* navigating */ });
        } catch {
          window.location.reload();
          return new Promise(() => { /* navigating */ });
        }
      },
    ),
  );

/* Lazy-load all pages for faster initial load on non-home routes */
const Index = lazyRetry(() => import("./pages/Index"), "Index");
const CropTest = lazyRetry(() => import("./pages/CropTest"), "CropTest");
const Login = lazyRetry(() => import("./pages/Login"), "Login");
const Signup = lazyRetry(() => import("./pages/Signup"), "Signup");
const ForgotPassword = lazyRetry(() => import("./pages/ForgotPassword"), "ForgotPassword");
const ResetPassword = lazyRetry(() => import("./pages/ResetPassword"), "ResetPassword");
const Dashboard = lazyRetry(() => import("./pages/Dashboard"), "Dashboard");
const EditProfile = lazyRetry(() => import("./pages/EditProfile"), "EditProfile");
const Profile = lazyRetry(() => import("./pages/Profile"), "Profile");
const Competitions = lazyRetry(() => import("./pages/Competitions"), "Competitions");
const CompetitionDetail = lazyRetry(() => import("./pages/CompetitionDetail"), "CompetitionDetail");
const CompetitionSubmit = lazyRetry(() => import("./pages/CompetitionSubmit"), "CompetitionSubmit");
const AdminPanel = lazyRetry(() => import("./pages/AdminPanel"), "AdminPanel");
const Journal = lazyRetry(() => import("./pages/Journal"), "Journal");
const JournalArticle = lazyRetry(() => import("./pages/JournalArticle"), "JournalArticle");
const JournalEditor = lazyRetry(() => import("./pages/JournalEditor"), "JournalEditor");
const Courses = lazyRetry(() => import("./pages/Courses"), "Courses");
const CourseDetail = lazyRetry(() => import("./pages/CourseDetail"), "CourseDetail");
const CourseEditor = lazyRetry(() => import("./pages/CourseEditor"), "CourseEditor");
const LessonView = lazyRetry(() => import("./pages/LessonView"), "LessonView");
const Certificates = lazyRetry(() => import("./pages/Certificates"), "Certificates");
const VerifyCertificate = lazyRetry(() => import("./pages/VerifyCertificate"), "VerifyCertificate");
const CertificateVerifyByToken = lazyRetry(() => import("./pages/CertificateVerifyByToken"), "CertificateVerifyByToken");
const Winners = lazyRetry(() => import("./pages/Winners"), "Winners");
const JudgePanel = lazyRetry(() => import(/* webpackChunkName: "judge-panel", vite: { chunkName: "judge-panel" } */ "./pages/JudgePanel"), "JudgePanel");
const Wallet = lazyRetry(() => import("./pages/Wallet"), "Wallet");
const PublicProfile = lazyRetry(() => import("./pages/PublicProfile"), "PublicProfile");
const Friends = lazyRetry(() => import("./pages/Friends"), "Friends");
const Feed = lazyRetry(() => import("./pages/Feed"), "Feed");
const Discover = lazyRetry(() => import("./pages/Discover"), "Discover");
const NotFound = lazyRetry(() => import("./pages/NotFound"), "NotFound");
const Phase7BadgesQA = lazyRetry(() => import("./pages/dev/Phase7BadgesQA"), "Phase7BadgesQA");
const FeaturedArtistPage = lazyRetry(() => import("./pages/FeaturedArtistPage"), "FeaturedArtistPage");
const Referrals = lazyRetry(() => import("./pages/Referrals"), "Referrals");
const HelpSupport = lazyRetry(() => import("./pages/HelpSupport"), "HelpSupport");
const ManagedPageView = lazyRetry(() => import("./pages/ManagedPageView"), "ManagedPageView");
const SubmissionDetail = lazyRetry(() => import("./pages/SubmissionDetail"), "SubmissionDetail");
const HashtagFeed = lazyRetry(() => import("./pages/HashtagFeed"), "HashtagFeed");
const PostDetail = lazyRetry(() => import("./pages/PostDetail"), "PostDetail");
const EntryDetail = lazyRetry(() => import("./pages/EntryDetail"), "EntryDetail");
const CustomUrlProfile = lazyRetry(() => import("./pages/CustomUrlProfile"), "CustomUrlProfile");
const Unsubscribe = lazyRetry(() => import("./pages/Unsubscribe"), "Unsubscribe");
const MyPhotos = lazyRetry(() => import("./pages/MyPhotos"), "MyPhotos");
const CookiePolicy = lazyRetry(() => import("./pages/CookiePolicy"), "CookiePolicy");
const NotificationSettings = lazyRetry(() => import("./pages/NotificationSettings"), "NotificationSettings");
const Notifications = lazyRetry(() => import("./pages/Notifications"), "Notifications");
const WatermarkQAMatrix = lazyRetry(() => import("./pages/qa/WatermarkQAMatrix"), "WatermarkQAMatrix");
const ScheduledPostsPage = lazyRetry(() => import("./pages/ScheduledPosts"), "ScheduledPosts");
const IDVerification = lazyRetry(() => import("./pages/IDVerification"), "IDVerification");

/**
 * The vanity route `/:customUrl` greedily matches every single-segment path,
 * including the staff-ID URL shape `/IDverification=<ID>` (printed on staff
 * QR codes). This discriminator sends those to the verification page and
 * everything else to the vanity profile resolver.
 */
const CustomUrlOrIdVerification = () => {
  const { customUrl } = useParams<{ customUrl: string }>();
  if (customUrl && /^IDverification=/i.test(customUrl)) return <IDVerification />;
  return <CustomUrlProfile />;
};
/**
 * P7 — "everything feels delayed, instantly nothing happening".
 *
 * Owner report, 2026-08-06: *"like comments anything coming delay, instantly
 * nothing happening, delay is there"*. It was located precisely to these
 * settings on the same day and deliberately NOT changed, because it alters
 * fetch behaviour for every member on every screen against a free-tier
 * database and that session had no capacity left to watch it or revert.
 *
 * WHAT IT IS NOT. Likes and comments are not slow: both already apply
 * optimistically before the server answers (`usePostReactionMutations` has
 * onMutate with an onError rollback, and `useAddComment` has its own). The
 * WRITE is instant. It is the READ that never happened again.
 *
 * With `refetchOnWindowFocus: false`, returning to the app or switching back to
 * the tab refreshed nothing at all — so something done on another device, or by
 * another member, stayed invisible until an action happened to force a refetch.
 * That is exactly what "instantly nothing happening" describes.
 *
 * WHY THIS IS SAFER THAN IT SOUNDS, and why staleTime is deliberately NOT
 * touched in the same change: a focus refetch RESPECTS staleTime. React Query
 * only refetches queries whose data is already stale, so this cannot produce a
 * request storm on a free tier — data less than five minutes old is still
 * served from cache exactly as before. One setting, one revert point.
 *
 * IF REQUEST VOLUME LOOKS WRONG: set this back to false. It is one line, and
 * nothing else depends on it. Watch Admin -> Error Log and the feed.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      gcTime: 10 * 60 * 1000,   // 10 min
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

// Wire up QueryClient for non-React imperative helpers
import { setSiteLogoQueryClient } from "@/hooks/core/useSiteLogo";
import { setProfileBatchQueryClient } from "@/lib/profileBatch";
import { setProfileMapQueryClient } from "@/lib/profileMapCache";
import { setLiveAdminSyncQueryClient } from "@/lib/liveAdminSync";
setSiteLogoQueryClient(queryClient);
setProfileBatchQueryClient(queryClient);
setProfileMapQueryClient(queryClient);
setLiveAdminSyncQueryClient(queryClient);

const PageLoader = () => <BrandLoader />;

/**
 * MEMBERS-ONLY ROUTES REDIRECT TO /login. ALWAYS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner requirement, 2026-08-03: "any link which is accessible to a logged-in
 * user, if a logged-out user tries to open it, the sign-in page must open."
 *
 * There was no central guard. Every page hand-wrote
 * `if (!authLoading && !user) navigate("/login")` — and nine pages forgot.
 * Verified logged-out, per route, in a rendered browser before this change:
 *
 *   /profile          rendered a fake "Photographer" profile skeleton
 *   /photos           rendered header+footer with a LITERALLY BLANK body
 *                     (MyPhotos ends in `if (!user) return null`)
 *   /notifications    rendered "Nothing here yet." — a lie; you are logged out
 *   /entry/:entryId   "Entry not found" — wrong: entries are not anon-readable
 *                     in the database, so the true state is "sign in first"
 *   /journal/new      "You don't have permission" — wrong message for
 *   /journal/edit/:id   a logged-out visitor, same for the two below
 *   /courses/new
 *   /courses/edit/:id
 *   /courses/:slug/lessons/:lessonId   "Lesson not found" (its parent,
 *                     /courses/:slug, HAS a guard — the child forgot)
 *
 * The routes wrapped in <RequireAuth> in the tree below are EXACTLY that list.
 * Nothing else changed:
 *   - deliberately public and staying public: /hashtag/:tag (its own UI says
 *     "public posts"), /IDverification (public staff-card check), /post/:postId
 *     (posts are anon-readable by RLS — share links), profiles by URL, journal,
 *     competitions, winners, courses catalogue.
 *   - /admin and /judge are ROLE-gated inside their pages (they redirect to "/")
 *     — a stricter rule than sign-in, left exactly as it was.
 *   - pages that already guard themselves keep their own guard too; this is
 *     defence in depth, not a replacement.
 *
 * While auth is still resolving we render the brand loader, NOT a redirect —
 * kicking a signed-in member to /login because their session had not hydrated
 * yet would be a worse bug than the one this fixes.
 */
const RequireAuth = () => {
  const { user, loading } = useAuth();
  if (loading) return <BrandLoader fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
};

declare global {
  interface Window {
    __dismissLoader?: () => void;
  }
}

/**
 * IndexGate — at "/", logged-in users are sent to /feed (their default landing).
 * The marketing home page stays reachable at "/home" (logo click for logged-in users).
 */
const IndexGate = () => {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (user) window.__dismissLoader?.();
  }, [user]);
  if (loading) return null;
  if (user) return <Navigate to="/feed" replace />;
  return <Index />;
};

const App = () => {
  const [allowSuspenseFallback, setAllowSuspenseFallback] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  // Dismiss init-loader — route-aware:
  // "/" lets Index.tsx handle dismissal after hero loads; all other routes dismiss immediately.
  useEffect(() => {
    const isHomepage = window.location.pathname === "/";

    // BLANK PAGE BUG (owner report 2026-08-01, screenshots of an empty Compete
    // and Profile tab in the Android app).
    //
    // Every route below is lazy(). While its chunk is loading, <Suspense>
    // renders `fallback`, and `fallback` was `allowSuspenseFallback ? <PageLoader/> : null`.
    // On a non-home route that flag was only flipped INSIDE requestAnimationFrame
    // — and rAF is throttled or entirely suspended in a backgrounded Android
    // webview (the same trap as PROJECT_MASTER_RECORD §12.14). If the frame
    // never ran, the fallback stayed `null`, so the app rendered its header and
    // bottom nav with NOTHING in between: a full blank page, exactly as
    // reported, until the chunk happened to resolve.
    //
    // The flag is now set synchronously, so there is always something to show.
    // rAF still owns dismissing the init loader, which is what it was for.
    setAllowSuspenseFallback(true);

    if (!isHomepage) {
      // Non-homepage: dismiss on first paint
      requestAnimationFrame(() => {
        window.__dismissLoader?.();
      });
    } else {
      // Homepage: Index.tsx calls __dismissLoader after the hero image loads.
      // Nothing extra to do here now that the flag is set above.
    }

    // Safety timeout — guarantees loader is dismissed even if hero never loads
    const safety = setTimeout(() => {
      window.__dismissLoader?.();
    }, 5000);

    return () => clearTimeout(safety);
  }, []);

  return (
  <>
  <HelmetProvider>
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
    {!splashDone && <SplashScreen onComplete={() => setSplashDone(true)} />}
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppUpdatePrompt />
      <BrowserRouter>
        <DynamicFavicon />
        <AuthProvider>
          <ThemeProvider>
          
          <CookieConsentProvider>
          <GoogleAnalytics />
          <RedirectHandler />
          <LanguageAccountSync />
          <PushNotificationsGate />
          <AdFullscreenProvider>
          <AppErrorBoundary>
          <Suspense fallback={allowSuspenseFallback ? <PageLoader /> : null}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<IndexGate />} />
                <Route path="/__crop-test" element={<CropTest />} />
                <Route path="/home" element={<Index />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/edit-profile" element={<EditProfile />} />
                {/* ── Members-only: signed-out visitors are sent to /login ──
                    The census behind this exact list is in the RequireAuth
                    comment above. Add new members-only routes HERE, not as
                    bare siblings. */}
                <Route element={<RequireAuth />}>
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/journal/new" element={<JournalEditor />} />
                  <Route path="/journal/edit/:id" element={<JournalEditor />} />
                  <Route path="/courses/new" element={<CourseEditor />} />
                  <Route path="/courses/edit/:id" element={<CourseEditor />} />
                  <Route path="/courses/:slug/lessons/:lessonId" element={<LessonView />} />
                  <Route path="/entry/:entryId" element={<EntryDetail />} />
                  <Route path="/photos" element={<MyPhotos />} />
                  <Route path="/notifications" element={<Notifications />} />
                </Route>
                <Route path="/profile/:userId" element={<PublicProfile />} />
                <Route path="/friends" element={<Friends />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/discover" element={<Discover />} />
                <Route path="/competitions" element={<Competitions />} />
                <Route path="/competitions/:id" element={<CompetitionDetail />} />
                <Route path="/competitions/:id/entry/:entryId/photo/:photoIndex" element={<CompetitionDetail />} />
                <Route path="/competitions/:id/submit" element={<CompetitionSubmit />} />
                <Route path="/admin/*" element={<AdminPanel />} />
                <Route path="/judge" element={<JudgePanel />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/journal/:slug" element={<JournalArticle />} />
                <Route path="/courses" element={<Courses />} />
                <Route path="/courses/:slug" element={<CourseDetail />} />
                <Route path="/certificates" element={<Certificates />} />
                <Route path="/verify" element={<VerifyCertificate />} />
                <Route path="/verify/:token" element={<CertificateVerifyByToken />} />
                <Route path="/certificate/:token" element={<CertificateVerifyByToken />} />
                <Route path="/winners" element={<Winners />} />
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/featured-artist/:slug" element={<FeaturedArtistPage />} />
                <Route path="/referrals" element={<Referrals />} />
                <Route path="/help-support" element={<HelpSupport />} />
                <Route path="/page/:slug" element={<ManagedPageView />} />
                <Route path="/dashboard/submission/:competitionId" element={<SubmissionDetail />} />
                <Route path="/dev/phase7-badges" element={<Phase7BadgesQA />} />
                <Route path="/dashboard/submission/:competitionId/entry/:entryId/photo/:photoIndex" element={<SubmissionDetail />} />
                <Route path="/hashtag/:tag" element={<HashtagFeed />} />
                <Route path="/post/:postId" element={<PostDetail />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
                <Route path="/cookie-policy" element={<CookiePolicy />} />
                <Route path="/settings/notifications" element={<NotificationSettings />} />
                <Route path="/qa/watermark-matrix" element={<WatermarkQAMatrix />} />
                <Route path="/scheduled-posts" element={<ScheduledPostsPage />} />
                {/* Staff ID verification (public). The QR-code URL shape
                    /IDverification=<ID> is a single segment, handled by the
                    vanity-route discriminator below. */}
                <Route path="/IDverification" element={<IDVerification />} />
                <Route path="/IDverification/:idNumber" element={<IDVerification />} />
                {/* Custom vanity URL - must be BEFORE catch-all but AFTER all known routes */}
                <Route path="/:customUrl" element={<CustomUrlOrIdVerification />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
          </AppErrorBoundary>
          </AdFullscreenProvider>
          </CookieConsentProvider>
          
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
  </HelmetProvider>
  </>
  );
};

export default App;
