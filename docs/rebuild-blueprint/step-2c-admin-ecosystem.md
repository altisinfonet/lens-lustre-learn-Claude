# STEP 2C — ADMIN ECOSYSTEM BLUEPRINT

**Strict mode.** All facts below were directly read from the listed files. Items not present in the inspected files are explicitly marked **NOT VERIFIED**.

**Inspected source files:**
- `src/pages/AdminPanel.tsx` (306 LOC)
- `src/components/admin/AdminLayout.tsx` (244 LOC)
- `src/modules/admin/CompetitionsModule.tsx` (791 LOC — first 390 read in full)
- `src/modules/admin/EntriesModule.tsx` (66 LOC)
- `src/modules/admin/CommentsModule.tsx` (189 LOC)
- `src/modules/admin/UsersModule.tsx` (49 LOC)
- `src/modules/admin/JudgeMonitoringModule.tsx` (61 LOC)
- `src/modules/admin/VoteAuditModule.tsx` (55 LOC)
- `src/modules/admin/JudgeActivityModule.tsx` (29 LOC)
- `src/modules/admin/RoleApplicationsModule.tsx` (35 LOC)
- `src/modules/admin/DatabaseModule.tsx` (29 LOC)
- `src/hooks/admin/useAdminComments.ts` (90 LOC)
- `src/hooks/admin/useAdminCompetitions.ts` (44 LOC)
- `src/hooks/admin/useAdminEntries.ts` (84 LOC)
- `src/hooks/admin/useAdminRoleApplications.ts` (49 LOC)
- `src/hooks/admin/useConfirmAction.ts` (54 LOC)
- `src/services/admin/commentService.ts` (52 LOC)
- `src/services/admin/competitionService.ts` (109 LOC)
- `src/services/admin/userService.ts` (31 LOC)
- `src/lib/adminRoleAccess.ts` (97 LOC)
- `src/lib/adminLogger.ts` (94 LOC)
- `src/lib/safeAdminExecute.ts` (63 LOC)
- `src/lib/liveAdminSync.ts` (134 LOC)
- `src/lib/adminBrand.ts` (75 LOC)
- `src/lib/queryKeys.ts` (144 LOC)

---

## 1. AdminPanel.tsx — `/admin/*`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Thin controller / router for the admin panel. URL-based routing (`/admin/:tab`) instead of localStorage tabs. All business logic delegated to modules under `src/modules/admin/`. |
| 2. Layout structure | Wraps everything in `<AdminLayout>` with sidebar + header shell. |
| 3. Route resolution | Extracts tab from `location.pathname.split("/")[2]`. Validates against `VALID_ROUTES` Set (43 routes). |
| 4. RBAC gating | `resolveAdminSubRoles(userRoles)` → `canAccessTab(adminSubRoles, rawRoute)` → redirect to first accessible route if unauthorized. |
| 5. Fallback behavior | If no access: `navigate("/")`. While loading auth/roles: `<BrandLoader fullScreen />`. |
| 6. Lazy-loaded modules | `CompetitionsModule`, `EntriesModule`, `CommentsModule`, `UsersModule`, `JudgeMonitoringModule`, `VoteAuditModule`, `JudgeActivityModule`, `RoleApplicationsModule`, `DatabaseModule`. |
| 7. Lazy-loaded components | 32 additional `Admin*` components (banners, SEO, analytics, health, wallet, etc.) — see full inventory below. |
| 8. Tab groups | 11 groups: Overview, Content, Editorial, Competitions, Users & Community, Moderation, Finance, Marketing & SEO, Pages & Navigation, System, Help & Support. |
| 9. Hooks used | `useAuth`, `useUserRoles`, `useNavigate`, `useLocation`, `useMemo`. |

### Lazy-Loaded Component Inventory (VERIFIED)

| Route Key | Component | File |
|---|---|---|
| banners | AdminBanners | `src/components/admin/AdminBanners.tsx` |
| potd | AdminPhotoOfDay | `src/components/admin/AdminPhotoOfDay.tsx` |
| on_page_images | AdminOnPageImages | `src/components/admin/AdminOnPageImages.tsx` |
| portfolio | AdminGallery | `src/components/admin/AdminGallery.tsx` |
| featured_artist | AdminFeaturedArtist | `src/components/admin/AdminFeaturedArtist.tsx` |
| journal | AdminJournal | `src/components/admin/AdminJournal.tsx` |
| courses | AdminCourses | `src/components/admin/AdminCourses.tsx` |
| certificates | AdminCertificates | `src/components/admin/AdminCertificates.tsx` |
| excellence | AdminExcellence | `src/components/admin/AdminExcellence.tsx` |
| competitions | CompetitionsModule | `src/modules/admin/CompetitionsModule.tsx` |
| competition_health | AdminCompetitionHealth | `src/pages/admin/AdminCompetitionHealth.tsx` |
| entries | EntriesModule | `src/modules/admin/EntriesModule.tsx` |
| judging_tags | AdminJudgingTags | `src/components/admin/AdminJudgingTags.tsx` |
| tag_semantics | AdminTagSemanticsAudit | `src/pages/admin/AdminTagSemanticsAudit.tsx` |
| judge_monitoring | JudgeMonitoringModule | `src/modules/admin/JudgeMonitoringModule.tsx` |
| vote_audit | VoteAuditModule | `src/modules/admin/VoteAuditModule.tsx` |
| judge_activity | JudgeActivityModule | `src/modules/admin/JudgeActivityModule.tsx` |
| vote_rewards | AdminVoteRewards | `src/components/admin/AdminVoteRewards.tsx` |
| users | UsersModule | `src/modules/admin/UsersModule.tsx` |
| applications | RoleApplicationsModule | `src/modules/admin/RoleApplicationsModule.tsx` |
| referrals | AdminReferrals | `src/components/admin/AdminReferrals.tsx` |
| engagement | AdminEngagement | `src/components/admin/AdminEngagement.tsx` |
| comments | CommentsModule | `src/modules/admin/CommentsModule.tsx` |
| keyword_blocklist | AdminKeywordBlocklist | `src/components/admin/AdminKeywordBlocklist.tsx` |
| reports | AdminCommentReports | `src/components/admin/AdminCommentReports.tsx` |
| post_reports | AdminPostReports | `src/components/admin/AdminPostReports.tsx` |
| wallet | AdminWalletTab | `src/components/admin/AdminWalletTab.tsx` |
| gifts | AdminGiftCredit | `src/components/admin/AdminGiftCredit.tsx` |
| transactions | AdminTransactions | `src/components/admin/AdminTransactions.tsx` |
| orders | AdminOrders | `src/components/admin/AdminOrders.tsx` |
| seo | AdminSEO | `src/components/admin/AdminSEO.tsx` |
| advertisements | AdminAdvertisements | `src/components/admin/AdminAdvertisements.tsx` |
| performance | AdminPerformance | `src/components/admin/AdminPerformance.tsx` |
| announcements | AdminAnnouncements | `src/components/admin/AdminAnnouncements.tsx` |
| newsletter_faq | AdminNewsletterFaq | `src/components/admin/AdminNewsletterFaq.tsx` |
| analytics | AdminAnalytics | `src/components/admin/AdminAnalytics.tsx` |
| page_management | AdminPageManagement | `src/components/admin/AdminPageManagement.tsx` |
| menu_builder | AdminMenuBuilder | `src/components/admin/AdminMenuBuilder.tsx` |
| redirects | AdminRedirects | `src/components/admin/AdminRedirects.tsx` |
| settings | AdminSettings | `src/components/admin/AdminSettings.tsx` |
| auth_pages | AdminAuthPages | `src/components/admin/AdminAuthPages.tsx` |
| email_templates | AdminEmailTemplates | `src/components/admin/AdminEmailTemplates.tsx` |
| database | DatabaseModule | `src/modules/admin/DatabaseModule.tsx` |
| health | AdminHealth | `src/components/admin/AdminHealth.tsx` |
| notifications_health | AdminNotificationsHealth | `src/pages/admin/AdminNotificationsHealth.tsx` |
| test_agent | AdminTestAgent | `src/pages/admin/AdminTestAgent.tsx` |
| activity_logs | AdminActivityLogs | `src/components/admin/AdminActivityLogs.tsx` |
| admin_notifications | AdminNotifications | `src/components/admin/AdminNotifications.tsx` |
| support_tickets | AdminSupportTickets | `src/components/admin/AdminSupportTickets.tsx` |
| user_guide | AdminUserGuide | `src/components/admin/AdminUserGuide.tsx` |

---

## 2. AdminLayout.tsx — Admin Shell

| Field | VERIFIED |
|---|---|
| 1. Purpose | Provides sidebar + header shell for all admin routes. Responsive: mobile nav + desktop sidebar. |
| 2. Layout | `min-h-screen bg-background text-foreground flex flex-col md:flex-row`. Left sidebar (desktop) + main content area. |
| 3. Desktop sidebar | `w-56 shrink-0 border-r border-border bg-card/50 flex-col h-screen sticky top-0`. Logo, search, collapsible nav groups, "Back to Site" link. |
| 4. Mobile nav | `<MobileAdminNav>` with hamburger menu, stats, tab list. |
| 5. RBAC filtering | `filteredTabGroups = filterTabGroups(tabGroups, adminSubRoles)` — memoized (V6-005 fix). Super_admin sees everything; other roles get filtered groups. |
| 6. Sidebar search | Text input filters groups + items by label/group name. Collapsible groups auto-open when searching. |
| 7. Live indicators | `unresolvedTicketCount` (badge on support_tickets), `unreadAdminNotificationCount` (badge on admin_notifications). |
| 8. Realtime channels | `admin-support-ticket-count` (listens on `support_tickets`), `admin-notification-count` (listens on `admin_notifications`). |
| 9. Stats | `totalUserCount`, `totalEntryCount`, `totalCompetitionCount` — fetched once on mount via `userService.getTotalUserCount()` + `supabase.from` count queries. |
| 10. Scroll behavior | On route change: scrolls to top via `window.scrollTo`, `documentElement.scrollTop`, `mainContentRef.current?.scrollTo`, `tabTopRef.current?.scrollIntoView`. |
| 11. Route access guard | If `!canAccessTab(adminSubRoles, currentRoute)`: renders Shield icon + "You don't have permission" block instead of children. |
| 12. Back navigation | `handleBackNavigation()` — `navigate(-1)` if history exists, else `navigate("/")`. |
| 13. Child components | `MobileAdminNav`, `Collapsible`/`CollapsibleContent`/`CollapsibleTrigger` (shadcn/ui), `Link`, `useSiteLogo`. |
| 14. Hooks used | `useState`, `useEffect`, `useRef`, `useMemo`, `useNavigate`, `useAuth`, `useSiteLogo`. |
| 15. Services used | `userService.getIndicatorCounts()`, `userService.getTotalUserCount()`. |

---

## 3. RBAC System — `src/lib/adminRoleAccess.ts`

| Field | VERIFIED |
|---|---|
| 1. Sub-roles | `super_admin`, `moderator`, `finance`, `content_editor`, `judge`. |
| 2. Role resolution | `resolveAdminSubRoles(roles: string[])` maps: `"admin"` → `super_admin`, `"content_editor"` → `content_editor`, `"judge"` → `judge`, `"moderator"` → `moderator`, `"finance"` → `finance`. |
| 3. Tab access matrix | `ROLE_TAB_ACCESS` defines per-role tab arrays. `super_admin` = `"all"`. |
| 4. Moderator tabs | comments, keyword_blocklist, reports, post_reports, users, applications, engagement, support_tickets, admin_notifications, activity_logs. |
| 5. Finance tabs | wallet, gifts, transactions, orders, referrals, analytics, admin_notifications. |
| 6. Content editor tabs | banners, potd, portfolio, on_page_images, featured_artist, journal, courses, certificates, excellence, seo, advertisements, announcements, newsletter_faq, page_management, menu_builder, redirects, admin_notifications. |
| 7. Judge tabs | competitions, competition_health, entries, judging_tags, tag_semantics, judge_monitoring, vote_audit, judge_activity, vote_rewards, admin_notifications. |
| 8. `canAccessTab()` | Returns `true` if any sub-role has `"all"` or the tab is in that role's array. |
| 9. `filterTabGroups()` | Filters tab groups to only show accessible tabs; removes empty groups. Short-circuits for super_admin. |
| 10. AdminTab type | 43 possible tab string literals (union type). |

---

## 4. Admin Infrastructure Utilities

### 4A. `src/lib/adminLogger.ts`

| Field | VERIFIED |
|---|---|
| Purpose | Centralized admin action & error logger. All admin ops should use this instead of raw supabase inserts. |
| `logAdminAction()` | Inserts into `db_audit_logs` with structured metadata. Fire-and-forget (never blocks UI). |
| `logClientError()` | Inserts into `activity_logs` (cast `as any`) with stack trace, context, URL, user agent. |
| `withAdminAudit()` | Wraps async operation: auto-logs `"info"` on success, `"error"` on failure with error message. Re-throws after logging. |

### 4B. `src/lib/safeAdminExecute.ts`

| Field | VERIFIED |
|---|---|
| Purpose | Safe execution wrapper for admin actions. Prevents silent failures. |
| `safeAdminExecute()` | Wraps `fn()`. Shows success toast (unless `silent: true`). On error: logs to console, shows destructive toast with error message, calls `onError` callback. Returns `T \| null`. |
| `assertSupabaseResult()` | Assertion helper: throws if `result.error` exists, prepending optional context string. |

### 4C. `src/lib/liveAdminSync.ts`

| Field | VERIFIED |
|---|---|
| Purpose | Realtime sync for admin settings and role changes. |
| `setLiveAdminSyncQueryClient()` | Registers singleton QueryClient for cache invalidation. |
| Channel `live-admin-sync` | Listens on `site_settings` table: updates cache keys `site-setting`, `feed-ad-positions`, `navigation_menu`, `footer-pages`, `site_logo`, `ad_slots`, `adsense_config`. Also invalidates `dashboard-init`. |
| Channel `live-admin-sync` (user_roles) | Listens on `user_roles` table: invalidates role cache, `is-admin`, `user-roles`, `profile-map`, `dashboard-init`. |
| Events dispatched | `ad-slots-updated` CustomEvent on window. |

### 4D. `src/lib/adminBrand.ts`

| Field | VERIFIED |
|---|---|
| `BRAND_NAME` | `"50mm Retina World"` |
| `getAdminIds()` | Fetches from `user_roles` where `role = "admin"`. Cached in-memory singleton promise. |
| `seedAdminIds()` | Pre-seeds cache from dashboard-init roles object. |
| `resolveName()` | Returns `BRAND_NAME` if user is admin, else original name or `"Photographer"`. |
| `resolveBadges()` | Injects `"verified"` badge for admin users if missing. |
| `isAdminUser()` | Checks cached admin set. |

---

## 5. Modules (Detailed)

### 5A. CompetitionsModule.tsx — `/admin/competitions`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Competition CRUD, form validation, cover image upload, judges/rounds display, phase drift detection. |
| 2. Child components (imports) | `ImageCropModal`, `CoverImageUploader`, lazy: `AdminCompetitionJudges`, `AdminCompetitionRounds`, `JudgingDriftAudit`, `AwardsIntegrityAudit`, `RoundPublishPanel`. |
| 3. Hooks used | `useState`, `useMemo`, `useEffect`, `useNavigate`, `useQueryClient`, `useAdminCompetitions`, `useAllCompetitionJudgeNames`. |
| 4. Services used | `competitionService` (fetchFull, fetchPayment, create, update, archive), `safeAdminExecute`, `assertSupabaseResult`. |
| 5. Image pipeline | `compressImageToFiles` → `scanFileWithToast` → `generateImagePath` → `uploadImage` (bucket: `competition-photos`). |
| 6. Form fields | title, description, category, cover_image_url, entry_fee, prize_info, max_entries_per_user, max_photos_per_entry, starts_at, ends_at, voting_ends_at, paypal_email, bank_details, upi_id, ai_images_allowed. |
| 7. Validation (form) | title ≤ 200 chars, entry_fee $0–$10,000, max_entries 1–50, max_photos 1–20, starts_at < ends_at, voting_ends_at > ends_at. |
| 8. Phase options | upcoming, submission_open, voting, judging, result, archived. |
| 9. DriftBadge component | Compares stored phase vs `resolveCompetitionPhase()`. Flags voting overdue, submission overdue. Shows days overdue. |
| 10. RemainingTime component | Live countdown (1s interval) for submission/voting phases. UTC-anchored. |
| 11. Sorting | Sort by title, category, phase, starts_at. Toggle asc/desc. |
| 12. Archive action | `competitionService.archiveCompetition()` + `db_audit_logs` insert. |
| 13. Hard delete | Calls `hard-delete-competition` edge function (body: `{ competition_id }`). |
| 14. Edge functions used | `hard-delete-competition` |
| 15. Tables written | `competitions`, `competition_payment_details` (as any cast), `judging_rounds` (default rounds on create), `db_audit_logs` |
| 16. NOT VERIFIED | Full body of form JSX, judge assignment UI, round publish UI, drift audit internals beyond top-level imports. |

### 5B. EntriesModule.tsx — `/admin/entries`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Per-photo reject/restore. "One Image, One Reject" policy — rejecting single photo no longer deletes whole entry. |
| 2. Child components | `AdminEntriesSection` |
| 3. Hooks used | `useState`, `useAdminEntries`, `useQueryClient` |
| 4. RPC used | `admin_set_photo_rejected` — params: `_entry_id`, `_photo_index`, `_rejected`, `_reason` |
| 5. Behavior | Calls RPC → invalidates `queryKeys.adminEntries()`. Shows toast with `all_rejected` / `new_status` from RPC result. |
| 6. Loading state | `pendingKey` = `"${entryId}::${photoIndex}"` to show per-photo spinner. |
| 7. Error state | Renders `<p className="text-destructive">Failed to load entries: {error.message}</p>` |
| 8. Tables queried (via hook) | `competition_entries` (with `photo_meta`, `photo_thumbnails`) |

### 5C. CommentsModule.tsx — `/admin/comments`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Admin comment moderation: view latest 50 comments, select all, bulk delete, per-comment delete. |
| 2. Tables queried | `comments` (legacy), `post_comments` |
| 3. Hooks used | `useState`, `useCallback`, `useAdminComments`, `useQueryClient`, `useConfirmAction` |
| 4. Service used | `commentService.deleteComment()` |
| 5. Selection | Checkbox per row + "Select All" toggle. Bulk delete bar appears when `selected.size > 0`. |
| 6. Delete flow | `confirm()` → `commentService.deleteComment(id, user.id)` → invalidate `adminComments` key → remove from selection. |
| 7. Audit logging | `commentService` writes to `db_audit_logs` on every delete. |
| 8. Error state | Renders `<p className="text-destructive">Failed to load comments: {error.message}</p>` |
| 9. Empty state | `<MessageSquare>` icon + "No comments yet." |
| 10. NOT VERIFIED | Internal JSX layout details beyond what was read. |

### 5D. UsersModule.tsx — `/admin/users`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Sub-tab wrapper: Manage Users vs Badge & Role Types. |
| 2. Sub-tabs | `"manage"` (AdminUsers), `"definitions"` (AdminBadgeRoleDefinitions) |
| 3. Child components (lazy) | `AdminUsers`, `AdminBadgeRoleDefinitions` |
| 4. State | `usersSubTab` string state, local sub-tab buttons with active indicator line. |
| 5. NOT VERIFIED | Contents of `AdminUsers` or `AdminBadgeRoleDefinitions` components. |

### 5E. JudgeMonitoringModule.tsx — `/admin/judge_monitoring`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Track judge progress and identify inactive judges per competition. |
| 2. Child components (lazy) | `AdminJudgeMonitoringPanel`, `AdminCompetitionFunnel` |
| 3. Hook used | `useAdminCompetitions` |
| 4. Filtering | Shows only competitions where `phase === "judging"`. |
| 5. Empty states | "No competitions exist yet" / "None in judging phase" (with explanatory text). |
| 6. NOT VERIFIED | Internal monitoring panel logic, funnel internals. |

### 5F. VoteAuditModule.tsx — `/admin/vote_audit`

| Field | VERIFIED |
|---|---|
| 1. Purpose | View real votes, admin adjustments, revert adjustments with full audit trail. |
| 2. Child component (lazy) | `AdminVoteAuditPanel` |
| 3. Hook used | `useAdminCompetitions` |
| 4. Extra link | Link to `/admin/seo?tab=verify` labeled "SEO Crawler Verify" with `ShieldCheck` icon. |
| 5. NOT VERIFIED | `AdminVoteAuditPanel` internals. |

### 5G. JudgeActivityModule.tsx — `/admin/judge_activity`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Complete log of all judge scoring, decisions, and overrides. |
| 2. Child component (lazy) | `AdminJudgeActivityLog` |
| 3. NOT VERIFIED | `AdminJudgeActivityLog` internals. |

### 5H. RoleApplicationsModule.tsx — `/admin/applications`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Review and manage user role applications. |
| 2. Child component (lazy) | `AdminRoleApplications` |
| 3. Hook used | `useAdminRoleApplications`, `useQueryClient` |
| 4. Refresh | `onRefresh` callback invalidates `queryKeys.adminRoleApplications()`. |
| 5. NOT VERIFIED | `AdminRoleApplications` internals. |

### 5I. DatabaseModule.tsx — `/admin/database`

| Field | VERIFIED |
|---|---|
| 1. Purpose | Database backup export and management. |
| 2. Child component (lazy) | `DatabaseBackupComponent` |
| 3. NOT VERIFIED | `DatabaseBackup` internals. |

---

## 6. Admin Hooks

### 6A. `useAdminComments.ts`

| Field | VERIFIED |
|---|---|
| Query key | `queryKeys.adminComments()` → `["admin-comments"]` |
| Tables queried | `comments` (legacy, limit 50), `post_comments` (limit 50) |
| Merged sort | Combines both tables, sorts by `created_at` desc, no limit after merge (so up to 100). |
| Profile enrichment | `cachedFetchProfilesByIds(userIds)` for profile names. |
| Context enrichment | Fetches `journal_articles.title` for article comments, `competition_entries.title` for entry comments. |
| Returns | `AdminComment[]` with `profile_name`, `context_title`. |

### 6B. `useAdminCompetitions.ts`

| Field | VERIFIED |
|---|---|
| Query key | `queryKeys.adminCompetitions()` → `["admin-competitions"]` |
| Table queried | `competitions` (50 most recent, ordered `created_at` desc) |
| Phase resolution | Maps each row through `resolveCompetitionPhase(c)` for canonical phase. |
| Returns | `AdminCompetition[]` with `id, title, category, status, phase, entry_fee, starts_at, ends_at, voting_ends_at, judging_completed, created_at`. |

### 6C. `useAdminEntries.ts`

| Field | VERIFIED |
|---|---|
| Query key | `queryKeys.adminEntries()` → `["admin-entries"]` |
| Table queried | `competition_entries` (50 most recent, ordered `created_at` desc) |
| Select fields | `id, title, status, photos, photo_thumbnails, photo_meta, created_at, user_id, competition_id` |
| Enrichment | `cachedFetchProfilesByIds(userIds)`, `fetchCompetitionsByIds(compIds)`, `competitions.current_round` |
| Returns | `AdminEntryRow[]` with `profiles`, `competition_title`, `competition_phase` (from `resolvePhase`), `competition_current_round`. |

### 6D. `useAdminRoleApplications.ts`

| Field | VERIFIED |
|---|---|
| Query key | `queryKeys.adminRoleApplications()` → `["admin-role-applications"]` |
| Table queried | `role_applications` (all, ordered `created_at` desc) |
| Select fields | `id, user_id, requested_role, status, reason, portfolio_url, experience, admin_message, created_at` |
| Enrichment | `cachedFetchProfilesByIds(userIds)` for profile names. |
| Returns | `AdminRoleApp[]` with `profiles`. |

### 6E. `useConfirmAction.ts`

| Field | VERIFIED |
|---|---|
| Purpose | Reusable confirm dialog state for destructive actions. |
| State | `open`, `loading`, `config` (title, description, confirmLabel, variant, onConfirm). |
| `confirm()` | Opens dialog with given config. |
| `handleConfirm()` | Sets loading, awaits `onConfirm()`, finally closes + unloads. |
| Returns | `{ confirm, dialogProps }` where `dialogProps` is ready to spread into `<ConfirmDialog>`. |

---

## 7. Admin Services

### 7A. `commentService.ts`

| Field | VERIFIED |
|---|---|
| `deleteComment(commentId, adminId)` | Tries `post_comments` first (exact count), falls back to `comments`. Writes `db_audit_logs` on success. Returns `{ success, table }`. |
| Tables written | `post_comments` (delete), `comments` (delete), `db_audit_logs` (insert) |

### 7B. `competitionService.ts`

| Field | VERIFIED |
|---|---|
| `fetchFullCompetition(compId)` | Selects from `competitions` (full field set). |
| `fetchPaymentDetails(compId)` | Selects from `competition_payment_details` (cast `as any`). |
| `createCompetition(payload)` | Inserts into `competitions` with `updated_at`. Returns `id`. |
| `updateCompetition(compId, payload)` | Updates `competitions` with `updated_at`. |
| `createDefaultRounds(compId)` | Inserts 4 fixed rounds into `judging_rounds`: R1 "Initial Screening", R2 "Round 2", R3 "Round 3", R4 "Final Round". |
| `upsertPaymentDetails(compId, details)` | Upserts into `competition_payment_details` on `competition_id` conflict (cast `as any`). |
| `archiveCompetition(compId, adminId)` | Updates `competitions.status = "archived"`, writes `db_audit_logs` with `SOFT_DELETE` operation. |
| Tables | `competitions`, `competition_payment_details`, `judging_rounds`, `db_audit_logs` |

### 7C. `userService.ts`

| Field | VERIFIED |
|---|---|
| `getTotalUserCount()` | `profiles` count exact (head=true). |
| `getIndicatorCounts()` | Parallel: `support_tickets` (status in open/replied) + `admin_notifications` (is_read=false). Returns `{ tickets, notifications }`. |
| Tables | `profiles`, `support_tickets`, `admin_notifications` |

---

## 8. Query Keys — Admin-Related (from `src/lib/queryKeys.ts`)

| Key | Value | Hook/Consumer |
|---|---|---|
| `adminCompetitions` | `["admin-competitions"]` | `useAdminCompetitions` |
| `adminEntries` | `["admin-entries"]` | `useAdminEntries` |
| `adminRoleApplications` | `["admin-role-applications"]` | `useAdminRoleApplications` |
| `adminComments` | `["admin-comments"]` | `useAdminComments` |

---

## 9. Maps

### A. Hook → UI Map (Admin)

| Hook | Used By |
|---|---|
| `useAdminCompetitions` | `CompetitionsModule`, `JudgeMonitoringModule`, `VoteAuditModule` |
| `useAdminEntries` | `EntriesModule` |
| `useAdminComments` | `CommentsModule` |
| `useAdminRoleApplications` | `RoleApplicationsModule` |
| `useConfirmAction` | `CommentsModule` |
| `useAuth` | `AdminPanel`, `AdminLayout` |
| `useUserRoles` | `AdminPanel` |
| `useSiteLogo` | `AdminLayout` |
| `useAllCompetitionJudgeNames` | `CompetitionsModule` |

### B. Component Hierarchy Map (Admin)

```
App.tsx (/admin/*)
└── AdminPanel (router)
    └── AdminLayout (shell)
        ├── MobileAdminNav
        └── Main Content
            ├── Route Guard (canAccessTab)
            └── LazyTab → Module/Component
                ├── CompetitionsModule
                │   ├── AdminCompetitionJudges (lazy)
                │   ├── AdminCompetitionRounds (lazy)
                │   ├── JudgingDriftAudit (lazy)
                │   ├── AwardsIntegrityAudit (lazy)
                │   └── RoundPublishPanel (lazy)
                ├── EntriesModule → AdminEntriesSection
                ├── CommentsModule → ConfirmDialog
                ├── UsersModule
                │   ├── AdminUsers (lazy)
                │   └── AdminBadgeRoleDefinitions (lazy)
                ├── JudgeMonitoringModule
                │   ├── AdminJudgeMonitoringPanel (lazy)
                │   └── AdminCompetitionFunnel (lazy)
                ├── VoteAuditModule → AdminVoteAuditPanel (lazy)
                ├── JudgeActivityModule → AdminJudgeActivityLog (lazy)
                ├── RoleApplicationsModule → AdminRoleApplications (lazy)
                └── DatabaseModule → DatabaseBackupComponent (lazy)
```

### C. Table Dependency Map (Admin)

| Table | Read By | Written By (verified) |
|---|---|---|
| `competitions` | `useAdminCompetitions`, `useAdminEntries` (via `fetchCompetitionsByIds`), `AdminLayout` (count) | `competitionService.createCompetition`, `.updateCompetition`, `.archiveCompetition` |
| `competition_payment_details` | `competitionService.fetchPaymentDetails` | `competitionService.upsertPaymentDetails` |
| `judging_rounds` | — | `competitionService.createDefaultRounds` |
| `competition_entries` | `useAdminEntries` | — (module reads only) |
| `comments` | `useAdminComments` | `commentService.deleteComment` |
| `post_comments` | `useAdminComments` | `commentService.deleteComment` |
| `role_applications` | `useAdminRoleApplications` | NOT VERIFIED in inspected files |
| `profiles` | `userService.getTotalUserCount`, `cachedFetchProfilesByIds` (all admin hooks) | — |
| `user_roles` | `adminBrand.getAdminIds`, `liveAdminSync` listener | — |
| `support_tickets` | `userService.getIndicatorCounts`, `AdminLayout` realtime | NOT VERIFIED |
| `admin_notifications` | `userService.getIndicatorCounts`, `AdminLayout` realtime | NOT VERIFIED |
| `db_audit_logs` | — | `adminLogger.logAdminAction`, `withAdminAudit`, `competitionService.archiveCompetition`, `commentService.deleteComment` |
| `activity_logs` | — | `adminLogger.logClientError` |
| `journal_articles` | `useAdminComments` (context enrichment) | — |
| `site_settings` | `liveAdminSync` realtime listener | NOT VERIFIED |

### D. Admin Action Flow Map

```
Admin User
  → navigates to /admin/:tab
    → AdminPanel validates route + RBAC
      → redirects to first accessible route if invalid
    → AdminLayout renders sidebar (filtered by role)
      → live indicators fetched (tickets, notifications)
      → realtime channels subscribed
    → LazyTab → Module

CompetitionsModule:
  → useAdminCompetitions → read competitions
  → create/edit form → competitionService.create/update
  → archive → competitionService.archiveCompetition + db_audit_logs
  → hard delete → invoke "hard-delete-competition" edge fn

EntriesModule:
  → useAdminEntries → read competition_entries
  → reject photo → RPC "admin_set_photo_rejected"
  → invalidate adminEntries key

CommentsModule:
  → useAdminComments → read comments + post_comments
  → delete → commentService.deleteComment
    → tries post_comments, falls back to comments
    → writes db_audit_logs
  → bulk delete → same flow iterated
```

---

## 10. Known Risks / Issues (VERIFIED)

| Source | Observation |
|---|---|
| `competitionService.ts` | Multiple `as any` casts on `competition_payment_details` table (not strongly typed). |
| `competitionService.ts` | `createCompetition` uses `updated_at` on insert (redundant but harmless). |
| `adminLogger.ts` | `logClientError` inserts into `activity_logs` with `as any` cast — table name may not exist in types. |
| `liveAdminSync.ts` | Uses `any` for payload types. |
| `CompetitionsModule.tsx` | `process_referral_reward` is cast `as any` (line 325 per Step 2B, not re-verified in this pass). |
| `AdminPanel.tsx` | 43 routes in `VALID_ROUTES` Set — risk of drift if new component added without updating Set. |
| `AdminLayout.tsx` | `supabase.removeChannel` in cleanup — correct pattern. |
| `useAdminComments.ts` | Merges 50 legacy + 50 post_comments = up to 100 rows with no final limit. Could be large. |
| `useAdminEntries.ts` | Only 50 rows but enriches with profiles + competitions per batch — N+1 avoided via batching. |

---

## 11. Items NOT VERIFIED in this Step

- Internal JSX of all lazy-loaded admin components (the 32 `Admin*` components under `src/components/admin/` and 4 under `src/pages/admin/`).
- Full body of `CompetitionsModule.tsx` beyond first 390 lines (form UI, judge assignment, round publish panel).
- Any RPC definitions called by admin components (`admin_set_photo_rejected`, `hard-delete-competition` edge fn internals).
- Admin health check internals, analytics internals, SEO internals.
- Database backup export format and mechanism.
- Role application approval/rejection flow.
- Judge monitoring panel data queries and metrics.
- Vote audit panel data queries and revert logic.
- `AdminEntriesSection` component internals.
- `ConfirmDialog` component internals (assumed shadcn/ui pattern).

