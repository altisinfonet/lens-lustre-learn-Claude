import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./App.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
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

/* Lazy-load all pages for faster initial load on non-home routes */
const Index = lazy(() => import("./pages/Index"));
const CropTest = lazy(() => import("./pages/CropTest"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const EditProfile = lazy(() => import("./pages/EditProfile"));
const Profile = lazy(() => import("./pages/Profile"));
const Competitions = lazy(() => import("./pages/Competitions"));
const CompetitionDetail = lazy(() => import("./pages/CompetitionDetail"));
const CompetitionSubmit = lazy(() => import("./pages/CompetitionSubmit"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const Journal = lazy(() => import("./pages/Journal"));
const JournalArticle = lazy(() => import("./pages/JournalArticle"));
const JournalEditor = lazy(() => import("./pages/JournalEditor"));
const Courses = lazy(() => import("./pages/Courses"));
const CourseDetail = lazy(() => import("./pages/CourseDetail"));
const CourseEditor = lazy(() => import("./pages/CourseEditor"));
const LessonView = lazy(() => import("./pages/LessonView"));
const Certificates = lazy(() => import("./pages/Certificates"));
const VerifyCertificate = lazy(() => import("./pages/VerifyCertificate"));
const CertificateVerifyByToken = lazy(() => import("./pages/CertificateVerifyByToken"));
const Winners = lazy(() => import("./pages/Winners"));
const JudgePanel = lazy(() => import(/* webpackChunkName: "judge-panel", vite: { chunkName: "judge-panel" } */ "./pages/JudgePanel"));
const Wallet = lazy(() => import("./pages/Wallet"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const Friends = lazy(() => import("./pages/Friends"));
const Feed = lazy(() => import("./pages/Feed"));
const Discover = lazy(() => import("./pages/Discover"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Phase7BadgesQA = lazy(() => import("./pages/dev/Phase7BadgesQA"));
const FeaturedArtistPage = lazy(() => import("./pages/FeaturedArtistPage"));
const Referrals = lazy(() => import("./pages/Referrals"));
const HelpSupport = lazy(() => import("./pages/HelpSupport"));
const ManagedPageView = lazy(() => import("./pages/ManagedPageView"));
const SubmissionDetail = lazy(() => import("./pages/SubmissionDetail"));
const HashtagFeed = lazy(() => import("./pages/HashtagFeed"));
const PostDetail = lazy(() => import("./pages/PostDetail"));
const EntryDetail = lazy(() => import("./pages/EntryDetail"));
const CustomUrlProfile = lazy(() => import("./pages/CustomUrlProfile"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const MyPhotos = lazy(() => import("./pages/MyPhotos"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const WatermarkQAMatrix = lazy(() => import("./pages/qa/WatermarkQAMatrix"));
const ScheduledPostsPage = lazy(() => import("./pages/ScheduledPosts"));
const IDVerification = lazy(() => import("./pages/IDVerification"));

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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      gcTime: 10 * 60 * 1000,   // 10 min
      refetchOnWindowFocus: false,
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

    if (!isHomepage) {
      // Non-homepage: dismiss on first paint
      requestAnimationFrame(() => {
        window.__dismissLoader?.();
        setAllowSuspenseFallback(true);
      });
    } else {
      // Homepage: Index.tsx will call __dismissLoader after hero image loads.
      // Just enable suspense fallback so React can render.
      setAllowSuspenseFallback(true);
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
    {!splashDone && <SplashScreen onComplete={() => setSplashDone(true)} />}
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <DynamicFavicon />
        <AuthProvider>
          <ThemeProvider>
          
          <CookieConsentProvider>
          <GoogleAnalytics />
          <RedirectHandler />
          <AdFullscreenProvider>
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
                <Route path="/profile" element={<Profile />} />
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
                <Route path="/journal/new" element={<JournalEditor />} />
                <Route path="/journal/edit/:id" element={<JournalEditor />} />
                <Route path="/journal/:slug" element={<JournalArticle />} />
                <Route path="/courses" element={<Courses />} />
                <Route path="/courses/new" element={<CourseEditor />} />
                <Route path="/courses/edit/:id" element={<CourseEditor />} />
                <Route path="/courses/:slug" element={<CourseDetail />} />
                <Route path="/courses/:slug/lessons/:lessonId" element={<LessonView />} />
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
                <Route path="/entry/:entryId" element={<EntryDetail />} />
                <Route path="/photos" element={<MyPhotos />} />
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
          </AdFullscreenProvider>
          </CookieConsentProvider>
          
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </HelmetProvider>
  </>
  );
};

export default App;