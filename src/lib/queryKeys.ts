/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CENTRALIZED QUERY KEY REGISTRY                             ║
 * ║                                                             ║
 * ║  RULES (enforced project-wide):                             ║
 * ║  1. ALL React Query keys MUST be defined here               ║
 * ║  2. NEVER create useQuery() calls inside components/pages   ║
 * ║  3. ALL data fetching goes through shared hooks in /hooks   ║
 * ║  4. NEVER create variant keys for the same table            ║
 * ║     ✗ ["profiles", "admin"]  ✗ ["profiles", userId]        ║
 * ║     ✓ queryKeys.profileMap(ids)                             ║
 * ║  5. If data overlaps with an existing query, REUSE the hook ║
 * ║  6. Global defaults (from QueryClient in App.tsx):          ║
 * ║     staleTime: 5 min, gcTime: 10 min,                      ║
 * ║     refetchOnWindowFocus: false                             ║
 * ║     Do NOT override these per-hook unless explicitly needed  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * HOOK MAPPING:
 *   queryKeys.profileCore       → useProfileCore()          (useProfileData.ts)
 *   queryKeys.profileExtended   → useProfileExtended()      (useProfileData.ts)
 *   queryKeys.profileMap        → useProfileMap()            (useProfileMap.ts)
 *   queryKeys.profileNameMap    → useProfileNameMap()        (useCompetitionJudges.ts)
 *   queryKeys.isAdmin           → useIsAdmin()               (useIsAdmin.ts)
 *   queryKeys.juryUsers         → useJuryUsers()             (useCompetitionJudges.ts)
 *   queryKeys.navigationMenu    → useNavigationMenu()        (useNavigationMenu.ts)
 *   queryKeys.competitionJudges → useCompetitionJudgeAssignments() (useCompetitionJudges.ts)
 *   queryKeys.allCompetitionJudges → useAllCompetitionJudgeNames() (useCompetitionJudges.ts)
 *   queryKeys.feed              → useFeedQuery()               (useFeedQuery.ts)
 */
export const queryKeys = {
  /* ── Profiles ── */
  profileCore: (userId: string) => ["profile-core", userId] as const,
  profileExtended: (userId: string, currentUserId: string) =>
    ["profile-extended", userId, currentUserId] as const,
  profileMapPrefix: () => ["profile-map"] as const,
  profileMap: (sortedIds: string[]) => ["profile-map", sortedIds] as const,
  profileNameMapPrefix: () => ["profile-name-map"] as const,
  profileNameMap: (sortedIds: string[]) => ["profile-name-map", sortedIds] as const,
  profileDetailMapPrefix: () => ["profile-detail-map"] as const,
  profileDetailMap: (sortedIds: string[]) => ["profile-detail-map", sortedIds] as const,

  /* ── Auth / Roles ── */
  isAdmin: (userId: string) => ["is-admin", userId] as const,
  juryUsers: () => ["jury-users"] as const,

  /* ── Navigation ── */
  navigationMenu: () => ["navigation-menu"] as const,

  /* ── User Entries ── */
  userEntries: (userId: string) => ["user-entries", userId] as const,

  /* ── Competitions & Judges ── */
  competitionJudges: (competitionId: string) =>
    ["competition-judges", competitionId] as const,
  allCompetitionJudgesPrefix: () => ["all-competition-judges"] as const,
  allCompetitionJudges: (sortedIds: string[]) =>
    ["all-competition-judges", sortedIds] as const,

  /* ── Feed ── */
  feed: () => ["feed"] as const,
  userWallPosts: (userId: string) => ["user-wall-posts", userId] as const,

  /* ── Notifications ── */
  notifications: (userId: string) => ["notifications", userId] as const,

  /* ── Site Settings ── */
  siteLogo: () => ["site-logo"] as const,
  sidebarSections: () => ["sidebar-sections"] as const,

  /* ── Sidebar Pre-seeded ── */
  sidebarCompetitions: () => ["sidebar-competitions"] as const,
  sidebarCourses: () => ["sidebar-courses"] as const,
  sidebarJournal: () => ["sidebar-journal"] as const,
  sidebarWinners: () => ["sidebar-winners"] as const,

  /* ── Moderation ── */
  isBanned: (userId: string) => ["is-banned", userId] as const,
  reports: () => ["reports"] as const,

  /* ── Search ── */
  search: (query: string) => ["search", query] as const,

  /* ── Social ── */
  friendships: () => ["friendships"] as const,
  follows: () => ["follows"] as const,

  /* ── Dashboard ── */
  dashboard: (userId: string) => ["dashboard", userId] as const,

  /* ── Competitions ── */
  competitions: (filter: string) => ["competitions", filter] as const,
  competitionDetail: (slugOrId: string) => ["competition-detail", slugOrId] as const,

  /* ── Courses ── */
  courses: () => ["courses"] as const,
  courseDetail: (slug: string) => ["course-detail", slug] as const,

  /* ── Journal ── */
  journal: () => ["journal"] as const,

  /* ── Wallet Page ── */
  walletPageData: (userId: string) => ["wallet-page-data", userId] as const,
  walletSummary: (userId: string) => ["wallet-summary", userId] as const,
  walletTransactions: (userId: string) => ["wallet-transactions", userId] as const,
  walletGifts: (userId: string) => ["wallet-gifts", userId] as const,

  /* ── Admin Panel ── */
  adminCompetitions: () => ["admin-competitions"] as const,
  adminEntries: () => ["admin-entries"] as const,
  adminRoleApplications: () => ["admin-role-applications"] as const,
  adminComments: () => ["admin-comments"] as const,

  /* ── Judging — Participant/Status surfaces ── */
  entryPublicStatus: (entryId: string) => ["entry-public-status", entryId] as const,
  entryPublicStatusAll: () => ["entry-public-status"] as const,
  gatedEntryStatus: (sortedIds: string[]) => ["gated-entry-status", sortedIds] as const,
  gatedEntryStatusAll: () => ["gated-entry-status"] as const,
  submissionDetail: (entryId: string) => ["submission-detail", entryId] as const,
  submissionDetailAll: () => ["submission-detail"] as const,

  /* ── Judging — Judge/Consensus surfaces ── */
  judgePhotoData: (
    competitionId: string,
    roundId: string | null,
    judgeId: string | null,
  ) => ["judge-photo-data", competitionId, roundId, judgeId] as const,
  judgePhotoDataAll: () => ["judge-photo-data"] as const,
  perPhotoConsensus: (sortedIds: string[]) =>
    ["per-photo-consensus", sortedIds] as const,
  perPhotoConsensusAll: () => ["per-photo-consensus"] as const,

  /* ── Judging — Round lifecycle ── */
  judgingRounds: (competitionId: string) =>
    ["judging-rounds", competitionId] as const,
  judgingRoundsAll: () => ["judging-rounds"] as const,

  /* ── Home Page Data ── */
  homeBanners: () => ["home-banners"] as const,
  homeGallery: () => ["home-gallery"] as const,
  photoOfTheDay: () => ["photo-of-the-day"] as const,
  featuredArtistActive: () => ["featured-artist-active"] as const,
  footerPages: () => ["footer-pages"] as const,
} as const;
