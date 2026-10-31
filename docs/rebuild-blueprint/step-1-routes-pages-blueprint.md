# STEP 1 — ROUTES & PAGES BLUEPRINT

**Scope of inspection (strict):**
- `src/App.tsx`
- `src/components/Layout.tsx`
- `src/pages/AdminPanel.tsx`
- `src/pages/**` (file existence only)

**Methodology:** Only facts directly readable in the four files above are marked VERIFIED. Per-page deep details (sections, buttons, forms, hooks, query keys, tables, RPCs, edge functions, realtime, loading/empty/error, mobile-specific, role-specific behavior) require opening each individual page file and are explicitly marked **NOT VERIFIED — requires Step 2 per-page inspection**.

---

## A. Top-Level Route Map (VERIFIED — `src/App.tsx`)

All routes are children of a single `<Route element={<Layout />}>` wrapper. Routing library: `react-router-dom` `BrowserRouter`. All page components are lazy-loaded via `React.lazy` + `<Suspense fallback={<BrandLoader/>}>`.

| # | Route Path | Component | File Path | Access (verified from Layout/AdminPanel only) |
|---|---|---|---|---|
| 1 | `/` | `Index` | `src/pages/Index.tsx` | Public |
| 2 | `/login` | `Login` | `src/pages/Login.tsx` | Public (in `hideNavRoutes`, `hideSidebarRoutes`, `hideAdRoutes`) |
| 3 | `/signup` | `Signup` | `src/pages/Signup.tsx` | Public (same hide-lists as `/login`) |
| 4 | `/forgot-password` | `ForgotPassword` | `src/pages/ForgotPassword.tsx` | Public (same hide-lists) |
| 5 | `/reset-password` | `ResetPassword` | `src/pages/ResetPassword.tsx` | Public (same hide-lists) |
| 6 | `/dashboard` | `Dashboard` | `src/pages/Dashboard.tsx` | NOT VERIFIED (no route guard in `App.tsx`) |
| 7 | `/edit-profile` | `EditProfile` | `src/pages/EditProfile.tsx` | NOT VERIFIED |
| 8 | `/profile` | `Profile` | `src/pages/Profile.tsx` | NOT VERIFIED |
| 9 | `/profile/:userId` | `PublicProfile` | `src/pages/PublicProfile.tsx` | NOT VERIFIED |
| 10 | `/friends` | `Friends` | `src/pages/Friends.tsx` | NOT VERIFIED |
| 11 | `/feed` | `Feed` | `src/pages/Feed.tsx` | NOT VERIFIED |
| 12 | `/discover` | `Discover` | `src/pages/Discover.tsx` | NOT VERIFIED |
| 13 | `/competitions` | `Competitions` | `src/pages/Competitions.tsx` | NOT VERIFIED |
| 14 | `/competitions/:id` | `CompetitionDetail` | `src/pages/CompetitionDetail.tsx` | NOT VERIFIED |
| 15 | `/competitions/:id/entry/:entryId/photo/:photoIndex` | `CompetitionDetail` | `src/pages/CompetitionDetail.tsx` | NOT VERIFIED |
| 16 | `/competitions/:id/submit` | `CompetitionSubmit` | `src/pages/CompetitionSubmit.tsx` | NOT VERIFIED |
| 17 | `/admin/*` | `AdminPanel` | `src/pages/AdminPanel.tsx` | Admin (RBAC enforced inside component, see §B) |
| 18 | `/judge` | `JudgePanel` | `src/pages/JudgePanel.tsx` | NOT VERIFIED at routing layer (in `hideSidebarRoutes`) |
| 19 | `/journal` | `Journal` | `src/pages/Journal.tsx` | NOT VERIFIED (in `hideSidebarRoutes`) |
| 20 | `/journal/new` | `JournalEditor` | `src/pages/JournalEditor.tsx` | NOT VERIFIED |
| 21 | `/journal/edit/:id` | `JournalEditor` | `src/pages/JournalEditor.tsx` | NOT VERIFIED |
| 22 | `/journal/:slug` | `JournalArticle` | `src/pages/JournalArticle.tsx` | NOT VERIFIED |
| 23 | `/courses` | `Courses` | `src/pages/Courses.tsx` | NOT VERIFIED (in `hideSidebarRoutes`) |
| 24 | `/courses/new` | `CourseEditor` | `src/pages/CourseEditor.tsx` | NOT VERIFIED |
| 25 | `/courses/edit/:id` | `CourseEditor` | `src/pages/CourseEditor.tsx` | NOT VERIFIED |
| 26 | `/courses/:slug` | `CourseDetail` | `src/pages/CourseDetail.tsx` | NOT VERIFIED |
| 27 | `/courses/:slug/lessons/:lessonId` | `LessonView` | `src/pages/LessonView.tsx` | NOT VERIFIED |
| 28 | `/certificates` | `Certificates` | `src/pages/Certificates.tsx` | NOT VERIFIED |
| 29 | `/verify` | `VerifyCertificate` | `src/pages/VerifyCertificate.tsx` | NOT VERIFIED |
| 30 | `/verify/:token` | `CertificateVerifyByToken` | `src/pages/CertificateVerifyByToken.tsx` | NOT VERIFIED |
| 31 | `/certificate/:token` | `CertificateVerifyByToken` | `src/pages/CertificateVerifyByToken.tsx` | NOT VERIFIED |
| 32 | `/winners` | `Winners` | `src/pages/Winners.tsx` | NOT VERIFIED |
| 33 | `/wallet` | `Wallet` | `src/pages/Wallet.tsx` | NOT VERIFIED |
| 34 | `/featured-artist/:slug` | `FeaturedArtistPage` | `src/pages/FeaturedArtistPage.tsx` | NOT VERIFIED |
| 35 | `/referrals` | `Referrals` | `src/pages/Referrals.tsx` | NOT VERIFIED |
| 36 | `/help-support` | `HelpSupport` | `src/pages/HelpSupport.tsx` | NOT VERIFIED |
| 37 | `/page/:slug` | `ManagedPageView` | `src/pages/ManagedPageView.tsx` | NOT VERIFIED |
| 38 | `/dashboard/submission/:competitionId` | `SubmissionDetail` | `src/pages/SubmissionDetail.tsx` | NOT VERIFIED |
| 39 | `/dev/phase7-badges` | `Phase7BadgesQA` | `src/pages/dev/Phase7BadgesQA.tsx` | NOT VERIFIED (path prefix `/dev/`) |
| 40 | `/dashboard/submission/:competitionId/entry/:entryId/photo/:photoIndex` | `SubmissionDetail` | `src/pages/SubmissionDetail.tsx` | NOT VERIFIED |
| 41 | `/hashtag/:tag` | `HashtagFeed` | `src/pages/HashtagFeed.tsx` | NOT VERIFIED |
| 42 | `/post/:postId` | `PostDetail` | `src/pages/PostDetail.tsx` | NOT VERIFIED |
| 43 | `/entry/:entryId` | `EntryDetail` | `src/pages/EntryDetail.tsx` | NOT VERIFIED |
| 44 | `/photos` | `MyPhotos` | `src/pages/MyPhotos.tsx` | NOT VERIFIED |
| 45 | `/unsubscribe` | `Unsubscribe` | `src/pages/Unsubscribe.tsx` | NOT VERIFIED |
| 46 | `/cookie-policy` | `CookiePolicy` | `src/pages/CookiePolicy.tsx` | Public (no auth-related comment) |
| 47 | `/settings/notifications` | `NotificationSettings` | `src/pages/NotificationSettings.tsx` | NOT VERIFIED |
| 48 | `/qa/watermark-matrix` | `WatermarkQAMatrix` | `src/pages/qa/WatermarkQAMatrix.tsx` | NOT VERIFIED |
| 49 | `/:customUrl` | `CustomUrlProfile` | `src/pages/CustomUrlProfile.tsx` | NOT VERIFIED — vanity URL catch (see §D) |
| 50 | `*` | `NotFound` | `src/pages/NotFound.tsx` | Public 404 |

**Per-route fields 4–20 (purpose, visible sections, buttons, forms, child components, hooks, query keys, Supabase tables, RPCs, edge functions, realtime, loading/empty/error states, mobile-specific, role-specific behavior, navigation dependencies):**
**NOT VERIFIED — requires Step 2 per-page inspection. Strict-mode rules forbid inferring these from filenames.**

---

## B. Admin Sub-Route Map (VERIFIED — `src/pages/AdminPanel.tsx`)

`/admin/*` is a single-component sub-router. The current segment is parsed via `location.pathname.split("/")[2]` and matched against `VALID_ROUTES` (line 81–93). Bare `/admin` or unknown segment → `navigate("/admin/${defaultRoute}", { replace: true })`. `defaultRoute = accessibleRoutes[0] ?? "banners"` (`DEFAULT_ROUTE`). If `!hasAdminPanelAccess` → `navigate("/")`. Loading state: `<BrandLoader fullScreen />`.

RBAC: `useUserRoles()` → `resolveAdminSubRoles()` → `canAccessTab()` (`src/lib/adminRoleAccess.ts`). Each tab is conditionally rendered inside `<AdminLayout>` and wrapped in `<LazyTab>` (Suspense + spinner).

| Sub-route segment | Label (in tabGroups) | Group | Component rendered | Component file |
|---|---|---|---|---|
| `health` | Site Health | Overview | `AdminHealth` | `src/components/admin/AdminHealth.tsx` |
| `notifications_health` | Notification Drift | Overview | `AdminNotificationsHealth` | `src/pages/admin/AdminNotificationsHealth.tsx` |
| `test_agent` | Test Agent | Overview | `AdminTestAgent` | `src/pages/admin/AdminTestAgent.tsx` |
| `analytics` | Analytics | Overview | `AdminAnalytics` | `src/components/admin/AdminAnalytics.tsx` |
| `admin_notifications` | Notifications | Overview | `AdminNotifications` | `src/components/admin/AdminNotifications.tsx` |
| `activity_logs` | Activity Logs | Overview | `AdminActivityLogs` | `src/components/admin/AdminActivityLogs.tsx` |
| `banners` | Hero Banners | Content | `AdminBanners` | `src/components/admin/AdminBanners.tsx` |
| `potd` | Photo of Day | Content | `AdminPhotoOfDay` | `src/components/admin/AdminPhotoOfDay.tsx` |
| `portfolio` | Gallery | Content | `AdminGallery` | `src/components/admin/AdminGallery.tsx` |
| `on_page_images` | On-Page Images | Content | `AdminOnPageImages` | `src/components/admin/AdminOnPageImages.tsx` |
| `featured_artist` | Featured Artist | Content | `AdminFeaturedArtist` | `src/components/admin/AdminFeaturedArtist.tsx` |
| `journal` | Journal | Editorial | `AdminJournal` | `src/components/admin/AdminJournal.tsx` |
| `courses` | Courses | Editorial | `AdminCourses` | `src/components/admin/AdminCourses.tsx` |
| `certificates` | Certificates | Editorial | `AdminCertificates` | `src/components/admin/AdminCertificates.tsx` |
| `excellence` | Excellence | Editorial | `AdminExcellence` | `src/components/admin/AdminExcellence.tsx` |
| `competitions` | Competitions | Competitions | `CompetitionsModule` | `src/modules/admin/CompetitionsModule.tsx` |
| `competition_health` | Competition Health | Competitions | `AdminCompetitionHealth` | `src/pages/admin/AdminCompetitionHealth.tsx` |
| `entries` | Entries | Competitions | `EntriesModule` | `src/modules/admin/EntriesModule.tsx` |
| `judging_tags` | Judging Tags | Competitions | `AdminJudgingTags` | `src/components/admin/AdminJudgingTags.tsx` |
| `tag_semantics` | Tag Semantics (Audit) | Competitions | `AdminTagSemanticsAudit` | `src/pages/admin/AdminTagSemanticsAudit.tsx` |
| `judge_monitoring` | Judge Monitor | Competitions | `JudgeMonitoringModule` | `src/modules/admin/JudgeMonitoringModule.tsx` |
| `vote_audit` | Vote Audit | Competitions | `VoteAuditModule` | `src/modules/admin/VoteAuditModule.tsx` |
| `judge_activity` | Judge Activity | Competitions | `JudgeActivityModule` | `src/modules/admin/JudgeActivityModule.tsx` |
| `vote_rewards` | Vote Rewards | Competitions | `AdminVoteRewards` | `src/components/admin/AdminVoteRewards.tsx` |
| `users` | Users | Users & Community | `UsersModule` | `src/modules/admin/UsersModule.tsx` |
| `applications` | Role Applications | Users & Community | `RoleApplicationsModule` | `src/modules/admin/RoleApplicationsModule.tsx` |
| `referrals` | Referrals | Users & Community | `AdminReferrals` | `src/components/admin/AdminReferrals.tsx` |
| `engagement` | Engagement | Users & Community | `AdminEngagement` | `src/components/admin/AdminEngagement.tsx` |
| `comments` | Comments | Moderation | `CommentsModule` | `src/modules/admin/CommentsModule.tsx` |
| `keyword_blocklist` | Keyword Blocklist | Moderation | `AdminKeywordBlocklist` | `src/components/admin/AdminKeywordBlocklist.tsx` |
| `reports` | Comment Reports | Moderation | `AdminCommentReports` | `src/components/admin/AdminCommentReports.tsx` |
| `post_reports` | Post Reports | Moderation | `AdminPostReports` | `src/components/admin/AdminPostReports.tsx` |
| `wallet` | Wallet | Finance | `AdminWalletTab` | `src/components/admin/AdminWalletTab.tsx` |
| `gifts` | Gift Credits | Finance | `AdminGiftCredit` | `src/components/AdminGiftCredit.tsx` |
| `transactions` | Transactions | Finance | `AdminTransactions` | `src/components/admin/AdminTransactions.tsx` |
| `orders` | Orders | Finance | `AdminOrders` | `src/components/admin/AdminOrders.tsx` |
| `seo` | SEO Settings | Marketing & SEO | `AdminSEO` | `src/components/admin/AdminSEO.tsx` |
| `advertisements` | Advertisements | Marketing & SEO | `AdminAdvertisements` | `src/components/admin/AdminAdvertisements.tsx` |
| `performance` | Performance | Marketing & SEO | `AdminPerformance` | `src/components/admin/AdminPerformance.tsx` |
| `announcements` | Announcements | Marketing & SEO | `AdminAnnouncements` | `src/components/admin/AdminAnnouncements.tsx` |
| `newsletter_faq` | Newsletter & FAQ | Marketing & SEO | `AdminNewsletterFaq` | `src/components/admin/AdminNewsletterFaq.tsx` |
| `page_management` | Page Management | Pages & Navigation | `AdminPageManagement` | `src/components/admin/AdminPageManagement.tsx` |
| `menu_builder` | Menu Builder | Pages & Navigation | `AdminMenuBuilder` | `src/components/admin/AdminMenuBuilder.tsx` |
| `redirects` | URL Redirects | Pages & Navigation | `AdminRedirects` | `src/components/admin/AdminRedirects.tsx` |
| `settings` | Integrations | System | `AdminSettings` | `src/components/admin/AdminSettings.tsx` |
| `auth_pages` | Login / Signup | System | `AdminAuthPages` | `src/components/admin/AdminAuthPages.tsx` |
| `email_templates` | Email Templates | System | `AdminEmailTemplates` | `src/components/admin/AdminEmailTemplates.tsx` |
| `database` | Database | System | `DatabaseModule` | `src/modules/admin/DatabaseModule.tsx` |
| `support_tickets` | Support Tickets | Help & Support | `AdminSupportTickets` | `src/components/admin/AdminSupportTickets.tsx` |
| `user_guide` | User Guide | Help & Support | `AdminUserGuide` | `src/components/admin/AdminUserGuide.tsx` |

**Per-sub-route fields 4–20:** **NOT VERIFIED — requires Step 2 module-level inspection.**

**Admin RBAC verified (`src/lib/adminRoleAccess.ts`):**
- Sub-roles: `super_admin | moderator | finance | content_editor | judge`.
- `admin` user-role → `super_admin` → `"all"` access.
- Other sub-roles map to explicit allow-lists declared in `ROLE_TAB_ACCESS`.

---

## C. Layout Visibility Rules (VERIFIED — `src/components/Layout.tsx`)

Constants:
- `hideNavRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin"]`
- `hideSidebarRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/admin", "/courses", "/journal", "/judge"]` (matched as `pathname === route || pathname.startsWith(route + "/")`)
- `hideAdRoutes = ["/login", "/signup", "/forgot-password", "/reset-password"]`; ads ALSO hidden when `pathname.startsWith("/admin")`.
- Home (`/`) is always sidebar-hidden (`isSidebarEligibleRoute = !isHome && !isSidebarHiddenRoute`).
- Home gets a transparent overlay `<Navbar transparent />` inside an absolute container with `<AnnouncementBar />`.
- Non-home, non-hidden routes get a normal `<AnnouncementBar /> <Navbar />`.
- `<SiteFooter />` rendered when `!hideNav`.
- `<MobileBottomNav />`, `<AnchorAd />`, `<CookieConsentBanner />` always rendered.
- `<AskAnything />` rendered when `!hideNav`.
- Header `<AdPlacement placement="header" />` rendered only when `showAds && !isHome`.
- In-content `<AdPlacement placement="in-content" />` rendered when `showAds`, inside the eligible-sidebar branch and the non-sidebar branch.
- Sidebars (eligible routes only):
  - Left `<FeedLeftSidebar />` — `hidden xl:block w-64` (≥1280px).
  - Right `<FeedRightSidebar />` — `hidden lg:block w-72` (≥1024px).
  - When `pathname === "/profile"` (`isProfilePage`), `<ProfileLeftSidebar />` is appended below the left sidebar.
- Main column constraint: `flex-1 min-w-0 w-full max-w-[590px] mx-auto`.
- Page transition: `<AnimatePresence mode="wait"> <PageTransition key={pathname}> <Outlet /> ...`
- `useEffect(() => { resetAdCounter(); }, [pathname])` — ad density counter reset on route change.

**Onboarding modal (VERIFIED):**
- Rendered only when `user && showOnboarding`.
- Skipped when `isAdmin` true or when `sessionStorage[onboarding_done_${user.id}] === "true"`.
- Reads `profiles` row by `id = user.id`; checks `onboarding_completed`, `user_type`, `onboarding_skipped_at` (24-hour cooldown via `SKIP_COOLDOWN_MS`).
- Updates `profiles.onboarding_skipped_at = null` when cooldown elapsed.
- Hooks used at layout level: `useAuth`, `useIsAdmin`, `useLastActive`, `useGlobalConversionTracker`, `useDashboardContext` (provided by `<DashboardProvider>` wrapper).
- `<GiftCelebrationModal />` mounted unless onboarding modal is showing.

---

## D. Route Collision Risks (VERIFIED — `src/App.tsx`)

| Risk | Verified observation |
|---|---|
| `/:customUrl` vanity catch-all | Declared **before** `*` and **after** all known top-level routes. Any new top-level route added below `/:customUrl` would be unreachable; any new top-level route added above is safe. Comment in code explicitly warns: *"Custom vanity URL - must be BEFORE catch-all but AFTER all known routes"*. |
| `/dashboard` vs `/dashboard/submission/:competitionId[...]` | Two separate explicit routes, no collision. |
| `/competitions/:id` vs `/competitions/:id/submit` vs `/competitions/:id/entry/:entryId/photo/:photoIndex` | Three explicit routes, react-router resolves by specificity — no collision. |
| `/verify` vs `/verify/:token` vs `/certificate/:token` | Three explicit routes, no collision. `/verify/:token` and `/certificate/:token` both render `CertificateVerifyByToken` (alias). |
| `/journal/new` vs `/journal/edit/:id` vs `/journal/:slug` | `/journal/new` and `/journal/edit/...` are explicit; `/journal/:slug` is dynamic. **Collision risk:** any future article slug equal to literal `"new"` would be shadowed by `/journal/new`. NOT VERIFIED whether `JournalEditor` enforces this. |
| `/courses/new` vs `/courses/edit/:id` vs `/courses/:slug` | Same pattern as journal — slug `"new"` would be shadowed. |
| `/:customUrl` vs every other top-level path | React Router matches the explicit literal routes first (e.g. `/login`, `/feed`). Any vanity URL identical to a reserved literal is shadowed by that literal. NOT VERIFIED whether `CustomUrlProfile` or signup form blocks reserved usernames. |

---

## E. Access-Control Observations (VERIFIED)

- **No `<ProtectedRoute>` wrapper exists in `src/App.tsx`.** Every non-admin route is rendered unconditionally; auth gating, if any, must occur inside the page component itself — **NOT VERIFIED at routing layer.**
- **`/admin/*` is the only route with verified RBAC.** Enforced inside `AdminPanel`:
  - Loading guard: `if (authLoading || rolesLoading) return <BrandLoader fullScreen />;`
  - Empty access guard: `if (!hasAdminPanelAccess) return null;` + `useEffect(navigate("/"))` when no access.
  - Per-tab RBAC: `canAccessTab(adminSubRoles, currentRoute)`; invalid/forbidden segments redirect to first accessible route.
- **Layout-level admin check:** `useIsAdmin()` is called in `Layout.tsx` only for the onboarding-modal suppression — **not** for route gating.

---

## F. Reserved Route Behavior (VERIFIED)

| Reserved literal | Effect |
|---|---|
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Hide nav, hide sidebar, hide ads. |
| `/admin` (and anything `/admin/*`) | Hide nav, hide sidebar, hide ads. |
| `/courses`, `/journal`, `/judge` (and prefixes) | Hide sidebar (nav still shown). |
| `/` | Sidebar always hidden; transparent overlay navbar; ads suppressed in header (only). |
| `*` | `NotFound` page (`src/pages/NotFound.tsx`) — logs `console.error("404 Error: ...")` and renders 404 markup. |

---

## G. Dynamic Param Route Behavior (VERIFIED — declared params only)

| Pattern | Params declared | Component | Notes |
|---|---|---|---|
| `/profile/:userId` | `userId` | `PublicProfile` | Param consumption NOT VERIFIED |
| `/competitions/:id` | `id` | `CompetitionDetail` | Param consumption NOT VERIFIED |
| `/competitions/:id/entry/:entryId/photo/:photoIndex` | `id`, `entryId`, `photoIndex` | `CompetitionDetail` | Same component as `/competitions/:id` — internal branching NOT VERIFIED |
| `/competitions/:id/submit` | `id` | `CompetitionSubmit` | NOT VERIFIED |
| `/journal/:slug` | `slug` | `JournalArticle` | NOT VERIFIED |
| `/journal/edit/:id` | `id` | `JournalEditor` | NOT VERIFIED |
| `/courses/:slug` | `slug` | `CourseDetail` | NOT VERIFIED |
| `/courses/:slug/lessons/:lessonId` | `slug`, `lessonId` | `LessonView` | NOT VERIFIED |
| `/courses/edit/:id` | `id` | `CourseEditor` | NOT VERIFIED |
| `/verify/:token`, `/certificate/:token` | `token` | `CertificateVerifyByToken` | Two routes, one component |
| `/featured-artist/:slug` | `slug` | `FeaturedArtistPage` | NOT VERIFIED |
| `/page/:slug` | `slug` | `ManagedPageView` | NOT VERIFIED |
| `/dashboard/submission/:competitionId` | `competitionId` | `SubmissionDetail` | NOT VERIFIED |
| `/dashboard/submission/:competitionId/entry/:entryId/photo/:photoIndex` | `competitionId`, `entryId`, `photoIndex` | `SubmissionDetail` | NOT VERIFIED |
| `/hashtag/:tag` | `tag` | `HashtagFeed` | NOT VERIFIED |
| `/post/:postId` | `postId` | `PostDetail` | NOT VERIFIED |
| `/entry/:entryId` | `entryId` | `EntryDetail` | NOT VERIFIED |
| `/admin/*` | wildcard suffix | `AdminPanel` | Internally parsed via `location.pathname.split("/")[2]` |
| `/:customUrl` | `customUrl` | `CustomUrlProfile` | Vanity catch — see §D collision risk |

---

## H. Cross-Cutting Globals (VERIFIED — `src/App.tsx`)

- Providers (outer→inner): `HelmetProvider` → `QueryClientProvider` → `TooltipProvider` → `BrowserRouter` → `AuthProvider` → `ThemeProvider` → `CookieConsentProvider` → `Suspense` → `Routes`.
- React Query client: `staleTime: 5min`, `gcTime: 10min`, `refetchOnWindowFocus: false`, `retry: 1`.
- Imperative QueryClient wiring: `setSiteLogoQueryClient`, `setProfileBatchQueryClient`, `setProfileMapQueryClient`, `setLiveAdminSyncQueryClient`.
- Ambient mounts: `<DynamicFavicon />`, `<RedirectHandler />`, `<SplashScreen />` (until `splashDone`), global `<Toaster />`, `<Sonner />`.
- Loader dismissal logic: route-aware. Non-`/` routes call `window.__dismissLoader?.()` on first paint via `requestAnimationFrame`. `/` defers to `Index.tsx`. Safety timeout: 5000ms.

---

## I. Items Marked NOT VERIFIED (must be filled in Step 2)

For every page in §A and every admin sub-route in §B:
1. Page purpose
2. Visible sections
3. Buttons / actions
4. Forms / modals
5. Child components
6. Hooks used
7. React Query keys
8. Supabase tables queried
9. RPCs used
10. Edge functions used
11. Realtime subscriptions
12. Loading states
13. Empty states
14. Error states
15. Mobile-specific behavior
16. Role-specific behavior
17. Navigation dependencies (in-page links / redirects)
18. Per-route auth gating beyond what `Layout` enforces

These cannot be derived from `App.tsx` / `Layout.tsx` / `AdminPanel.tsx` and were not opened in this step per strict-mode scoping.
