# Step 2I — Hooks, Cache & Realtime Blueprint

> **Forensic, line-cited inventory of the React Query cache layer, custom hooks, pre-seed pipeline, and Supabase Realtime topology.** Every claim is traceable to source. Anything not directly verified is flagged `NOT VERIFIED`.

---

## 1. Cache Foundation

### 1.1 QueryClient — single global instance
**Source:** `src/App.tsx` L65–L84

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,   // 5 min
      gcTime:    10 * 60 * 1000,  // 10 min
      refetchOnWindowFocus: false,
    },
  },
});
```

The single `queryClient` is wired into four imperative (non-React) modules at module-load:

| Module                        | Setter                          | Purpose                                              |
|-------------------------------|---------------------------------|------------------------------------------------------|
| `useSiteLogo`                 | `setSiteLogoQueryClient`        | Lets non-component callers read/write site_logo cache |
| `lib/profileBatch`            | `setProfileBatchQueryClient`    | Imperative `fetchProfileBatch()` uses cache          |
| `lib/profileMapCache`         | `setProfileMapQueryClient`      | Imperative `fetchProfileMap()` + realtime invalidator |
| `lib/liveAdminSync`           | `setLiveAdminSyncQueryClient`   | Mounts global `live-admin-sync` channel              |

**Provider tree:** `QueryClientProvider` wraps the entire app (`App.tsx` L126 → L202). `DashboardProvider` is mounted inside Layout so `useDashboardInit` runs exactly once per session.

### 1.2 Centralised query-key registry
**Source:** `src/lib/queryKeys.ts` (144 lines)

Hard-locked rules (verbatim from file header):
1. **ALL** React Query keys defined in `queryKeys.ts`.
2. **NEVER** call `useQuery()` directly inside components/pages — must go through a shared hook in `/hooks`.
3. **NEVER** create variant keys for the same table (e.g. `["profiles", "admin"]` is forbidden — use `queryKeys.profileMap(ids)`).
4. If data overlaps an existing query, **REUSE** the hook.
5. Do not override global defaults per-hook unless explicitly needed.

Registry covers 12 logical groups: profiles, auth/roles, navigation, user entries, competitions/judges, feed, notifications, site settings, sidebar pre-seeded, moderation, search, social, dashboard, courses, journal, wallet (5 sub-keys), admin panel (4 sub-keys), judging participant surfaces, judging judge/consensus surfaces, judging round lifecycle, home page data.

**Stable key pattern:** every list-shaped key takes a *sorted* `string[]` so identical contents always produce the same cache slot. See `useProfileMap.ts` L8–L26 for the canonical ref-stable pattern (without it, `AutoBadge` was re-rendering 4000×/sec).

---

## 2. Dashboard Bootstrap (the master pre-seed)

### 2.1 Three-piece architecture

```text
┌─────────────────────────────┐
│ DashboardProvider (Layout)  │  ← mounted exactly once
└─────────────┬───────────────┘
              │ user.id
              ▼
┌─────────────────────────────┐
│ useDashboardInit(userId)    │  src/hooks/core/useDashboardInit.ts (95 LOC)
│   • queryKey: ["dashboard-  │
│     init", userId]          │
│   • staleTime: 5 min        │
│   • refetchOnMount: false   │
│   • refetchOnReconnect:false│
└──────┬──────────────┬───────┘
       │              │
       │ queryFn      │ exposes sidebarData via useMemo
       ▼              ▼
┌──────────────┐  ┌──────────┐
│ beginDashbd  │  │ Layout & │
│ Bootstrap()  │  │ sidebars │
│  (gate open) │  └──────────┘
└──────┬───────┘
       │
       ▼
┌─────────────────────────────┐
│ fetchDashboardInit(userId)  │  src/lib/dashboardInit.ts L8+
│  → invokes 'dashboard-init' │
│    edge function            │
└─────────────┬───────────────┘
              │ DashboardInitResponse
              ▼
┌─────────────────────────────┐
│ preSeedCaches(data, qc)     │  src/lib/dashboardInit.ts L33+
│  • site_logo → siteLogo()   │
│  • sidebar_sections         │
│  • navigation_menu          │
│  • managed_pages → footer   │
│  • feed_ad_positions        │
│  • ad_slots in-memory cache │
│  • adminBrand seedAdminIds  │
└─────────────┬───────────────┘
              │ finally
              ▼
┌─────────────────────────────┐
│ gate.resolve()              │  unblocks ALL leaf hooks
└─────────────────────────────┘
```

### 2.2 The bootstrap gate (U-04)
**Source:** `src/lib/dashboardInitGate.ts` (95 LOC)

A module-singleton Promise opened at module-load. Leaf hooks (`useSiteSetting`, `useSiteLogo`, `useIsAdmin`, `useUserRoles`, `useNavigationMenu`, `fetchAdSlots`, etc.) call `awaitDashboardBootstrap()` inside their `queryFn`. They block until either:
- the master `dashboard-init` finishes + `preSeedCaches` populates the cache, **or**
- a 3500 ms safety timeout fires (graceful degradation: leaf falls through to its own DB query).

**Why:** without the gate, 7 concurrent `site_settings?key=...` requests + duplicate `user_roles` / `profiles_public_data` fetches were observed per page load. Memory: `dashboard-init-bootstrap-gate` confirms this is locked in as Core convention.

`useAuth` calls `resetDashboardBootstrapGate()` on sign-out so the next session starts clean.

### 2.3 SidebarData fan-out
`useDashboardInit` exposes a memoised `sidebarData: SidebarData | null` (L67–L87) so 10 sidebar widgets read directly from the master query — never re-fetch independently. Shape:
```ts
{ sections, competitions, courses, journal, winners, trending,
  voting_entries, voting_thumbnails, milestones, birthdays, suggestions }
```

---

## 3. Hook Inventory (by domain)

### 3.1 Core — `src/hooks/core/`
| Hook                       | Purpose                                              | Notes |
|----------------------------|------------------------------------------------------|-------|
| `useAuth.tsx`              | Session, sign-in, sign-out, gate-reset on logout     | Mounts auth-state Realtime |
| `DashboardContext.tsx`     | Hard-locks single `useDashboardInit` call            | See §2 |
| `useDashboardInit.ts`      | Master pre-seed query                                | 95 LOC |
| `useIsAdmin.ts`            | `has_role(uid,'admin')` via cache                    | Awaits gate |
| `useIsBanned.ts`           | Banned-user check                                    | |
| `useNavigationMenu.ts`     | Reads navigation_menu seed → fallback DB             | Gate-aware |
| `useNotificationSound.ts`  | localStorage flag (no DB)                            | |
| `useSEO.ts`                | Document title/meta side-effect                      | |
| `useSiteLogo.ts`           | Pre-seeded by master query                           | Has imperative setter |
| `useSiteSetting.ts`        | Generic `site_settings.key` reader                   | Awaits gate |
| `useTheme.tsx`             | Light/dark theme provider                            | |
| `useTrustedDevice.ts`      | Device fingerprint registration                      | |
| `useActivityLog.ts`        | Append-only activity_log writer                      | |
| `useAuthPageSettings.ts`   | Auth page branding                                   | |
| `useCookieConsent.tsx`     | GDPR cookie banner state                             | localStorage |
| `useDownloadImage.ts`      | Generates JPEG via Canvas API                        | Memory: image-strategy |
| `useGlobalConversionTracker` | Ad-conversion event hook                           | |
| `useInfiniteScroll.ts`     | IntersectionObserver wrapper                         | |
| `useLastActive.ts`         | Updates `profiles_public_data.last_active_at`        | |
| `useProgressiveImage.ts`   | LQIP-style image loader                              | |
| `usePwaInstall.ts`         | beforeinstallprompt capture                          | |
| `use-mobile.tsx`           | Tailwind breakpoint (md) match                       | |
| `use-toast.ts`             | shadcn toast bridge                                  | |

### 3.2 Profile — `src/hooks/profile/`
| Hook                       | Purpose                                              |
|----------------------------|------------------------------------------------------|
| `useProfileMap.ts`         | Batch profile + badges + roles (single shared key)   |
| `useProfileData.ts`        | `useProfileCore` + `useProfileExtended`              |
| `useProfileMutations.ts`   | Upsert profile fields                                 |
| `useUserBadges.ts`         | Per-user badge fetch (delegates to profileMap)       |
| `useUserRoles.ts`          | Per-user role fetch                                  |
| `useUserDevices.ts`        | Trusted-device list                                  |
| `useBadgeDefinitions.ts`   | Badge catalog + Realtime invalidation                |
| `useRoleDefinitions.ts`    | Role catalog + Realtime invalidation                 |
| `useAlbums.ts`             | Photo Hub albums                                     |

### 3.3 Feed — `src/hooks/feed/`
| Hook                         | Purpose                                              |
|------------------------------|------------------------------------------------------|
| `useFeedQuery.ts`            | Paged feed, optimistic updates                       |
| `useUserPostsQuery.ts`       | Single user's wall                                   |
| `useRealtimeFeed.ts`         | Mounts `feed-live` channel (9 listeners)             |
| `useFeedCacheUpdaters.ts`    | Surgical cache patches (likes/comments)              |
| `useFeedEventTracker.ts`     | Engagement velocity logging                          |
| `useNewPostsBanner.ts`       | "X new posts" pill                                   |
| `usePostReactionMutations.ts`| Like/save/share with rate-limit gating               |
| `useAddComment.ts`           | Comment insert + cache patch                         |
| `useReportContent.ts`        | Report flow                                          |

### 3.4 Notifications — `src/hooks/notifications/`
| Hook                          | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| `useNotificationsQuery.ts`    | 60s re-fetch + Realtime on 4 tables (347 LOC)        |
| `useNotificationPreferences.ts` | 13 toggles, locked categories                      |
| `useReferral.ts`              | Referral attribution + reward                        |

### 3.5 Wallet — `src/hooks/wallet/`
| Hook                       | Purpose                                                 |
|----------------------------|---------------------------------------------------------|
| `useWallet.ts`             | Eager balance + ledger                                  |
| `useWalletPageData.ts`     | Lazy: only loads when on `/wallet`                      |
| `useWalletSummary.ts`      | Aggregates (lifetime in/out)                            |
| `useWalletTransactions.ts` | Paged ledger                                            |
| `useWalletDeposits.ts`     | Manual UPI/bank deposit lifecycle                       |
| `useWalletWithdrawals.ts`  | Insert-then-deduct with $1–$50k client validation       |
| `useWalletGifts.ts`        | Gift-credit history                                     |

### 3.6 Competition — `src/hooks/competition/`
| Hook                            | Purpose                                                |
|---------------------------------|--------------------------------------------------------|
| `useCompetitions.ts`            | List + filter                                          |
| `useCompetitionDetail.ts`       | Detail + Realtime entry sync                           |
| `useCompetitionVoteRealtime.ts` | Debounced (120 ms) invalidator on votes/adjustments    |
| `useCompetitionVoting.ts`       | Vote cast/unvote (calls `cast-photo-vote`)             |
| `useCompetitionEntryMutations.ts` | Submit/edit entry                                    |
| `useCompetitionJudges.ts`       | Judge assignment list + name map                       |
| `useCompetitionAdmin.ts`        | Admin-side competition CRUD                            |
| `useUserEntries.ts`             | Current user's submitted entries                       |
| `useCanBypassWatermark.ts`      | Photographer-of-own-entry check                        |
| `useAdminEntryOverride.ts`      | Admin force-state                                      |

### 3.7 Judging — `src/hooks/judging/` (24 hooks)
| Hook                           | Purpose                                                  |
|--------------------------------|----------------------------------------------------------|
| `useJudgePhotoData.ts`         | Master per-judge data (scores/tags/comments/decisions)   |
| `useJudgeRounds.ts`            | Round lifecycle + Realtime                               |
| `useJudgeSession.ts`           | Crash recovery via `judge_sessions`                      |
| `useJudgeActions.ts`           | Save score / cast tag / submit decision                  |
| `useJudgeIntegrityData.ts`     | Vote audit panel data                                    |
| `useJudgeAggregateStats.ts`    | Per-judge progress %                                     |
| `useJudgeClassicData.ts`       | Legacy classic-mode aggregator                           |
| `useJudgeCompetitions.ts`      | Comps the current judge can see                          |
| `useJudgeGuide.ts`             | First-run guide state                                    |
| `useJudgingLock.ts`            | Lock/declare round predicates                            |
| `useEntryPublicStatus.ts`      | Single-entry status reader                               |
| `useGatedEntryStatus.ts`       | **The ONLY legal status reader for user-facing UI** (memory: status-display-rule) — Realtime |
| `usePhotoDecisions.ts`         | Per-photo consensus via `get_per_photo_consensus`        |
| `usePhotoPlacements.ts`        | R4 placement reader                                      |
| `usePhotoR4Award.ts`           | Winner/runner-up/honorary picker                         |
| `usePhotoVoteCount.ts`         | Final vote totals + Realtime                             |
| `usePhotoExifAudit.ts`         | EXIF integrity check                                     |
| `useTagCounts.ts`              | Per-tag aggregate counts                                 |
| `useColumnCount.ts`            | Cinema-mode column adapter                               |
| `useDebouncedFeedbackSave.ts`  | 500 ms debounce for free-text feedback                   |
| `useMultiJudgeProgress.ts`     | Cross-judge progress (Realtime)                          |
| `useUnjudgedDriftMonitor.ts`   | Drift detection feed                                     |
| `useUnsavedChangesGuard.ts`    | beforeunload guard                                       |
| `decisionParityProbe.ts`       | Test/CI helper                                           |
| `tagLabelToDecision.ts`        | Label-alias map (mirrors DB) — memory: tag-label-alias-mirror |

### 3.8 Admin — `src/hooks/admin/`
- `useAdminEntries.ts` · `useAdminCompetitions.ts` · `useAdminComments.ts` · `useAdminRoleApplications.ts` · `useConfirmAction.ts`

### 3.9 Other
- `chat/useChatSession.ts` — Ask-Anything AI session
- `content/useCourses.ts`, `useCourseStats.ts`, `useJournal.ts` — Realtime on courses
- `dashboard/useDashboardData.ts`, `useDashboardMutations.ts`
- `search/useSearch.ts`
- `social/useFriendFollow.ts`, `useFriendshipMutations.ts`
- `useTopContributors.ts`

---

## 4. Realtime Topology

### 4.1 All Realtime channels (verified)
**Search:** `grep -rln "supabase.channel" src` returned **14 modules** in `src/hooks` + `src/lib`, **0** in `src/components`. Components never subscribe directly — strict separation.

| Channel topic                              | Module                                   | Tables / events                                                             | Filter                       |
|--------------------------------------------|------------------------------------------|-----------------------------------------------------------------------------|------------------------------|
| `live-admin-sync`                          | `lib/liveAdminSync.ts`                   | `site_settings`, `user_roles`                                               | none (admin scope)           |
| `profile-map-badges`                       | `lib/profileMapCache.ts`                 | `user_badges`, `user_roles`                                                 | none → invalidates per uid   |
| `auto-role-cache-sync`                     | `components/AutoRole.tsx` (lib-style)    | `user_roles`                                                                | none                         |
| `feed-live`                                | `hooks/feed/useRealtimeFeed.ts`          | 9 listeners (posts, likes, comments, reactions, …)                          | none — global feed           |
| `notif-live`                               | `hooks/notifications/useNotificationsQuery.ts` | `user_notifications`, `admin_notifications`, etc. (~6 listeners)      | `user_id=eq.{uid}`           |
| `competition-vote-sync:{compId}`           | `hooks/competition/useCompetitionVoteRealtime.ts` | `competition_votes`, `admin_vote_adjustments`, `competition_entries` | none → debounced invalidate  |
| `judge-live-{compId}-{userId}`             | `hooks/judging/useJudgePhotoData.ts`     | `judge_scores`, `judge_decisions`, `judge_tag_assignments`, `judge_comments` | **`judge_id=eq.{userId}`** when `judging_realtime_distributed_mode != false` |
| (others)                                   | `useJudgeRounds`, `useMultiJudgeProgress`, `usePhotoVoteCount`, `useGatedEntryStatus`, `useCompetitionDetail`, `useCourses`, `useBadgeDefinitions`, `useRoleDefinitions`, `useAuth` | various | various |

### 4.2 R5 — Per-judge server-side filter (privacy invariant)
**Source:** `useJudgePhotoData.ts` L141, L168–L213; memory: `judging/realtime-per-judge-filter-r5`

When `site_settings.judging_realtime_distributed_mode.enabled !== false` (default = ON):
- channel topic = `judge-live-{competitionId}-{userId}` (per-judge so broadcasts never collide)
- filter = `judge_id=eq.{userId}` (server-side)
- **Why:** privacy (judge A must not see judge B's live writes) + bandwidth.
- **Trade-off accepted (option A):** ConflictBadge / cross-judge consensus widgets update live ONLY for the current judge. Other judges' contributions appear on next mount / `invalidateQueries`.
- **DO NOT** revert to an unfiltered channel without explicitly flipping the setting OFF — privacy is the contract.

ESLint rule `eslint-rules/no-unfiltered-judge-realtime.js` blocks any new judge-table subscription that omits `filter:`.

### 4.3 Debouncing & invalidation patterns
- **Vote sync:** `useCompetitionVoteRealtime` batches all events into a single 120 ms `setTimeout` → one `invalidateQueries`. Prevents thrashing during high-vote moments.
- **Admin sync:** `liveAdminSync` distinguishes by changed key — surgically patches one cache slot OR invalidates `dashboard-init` if the key is unknown.
- **Profile map:** Realtime on `user_badges` / `user_roles` invalidates `queryKeys.profileMap([changedUserId])` only (not the whole prefix).

---

## 5. Imperative (non-React) cache callers

These modules need a `QueryClient` reference but live outside React tree:

| Module                     | Setter                          | Why imperative                                              |
|----------------------------|---------------------------------|-------------------------------------------------------------|
| `lib/profileMapCache.ts`   | `setProfileMapQueryClient`      | Called by edge-function fetchers and CLI helpers            |
| `lib/profileBatch.ts`      | `setProfileBatchQueryClient`    | One-shot batch fetcher                                      |
| `lib/liveAdminSync.ts`     | `setLiveAdminSyncQueryClient`   | Mounts global Realtime channel at module-load               |
| `hooks/core/useSiteLogo.ts`| `setSiteLogoQueryClient`        | Lets edge-function callers patch logo URL                   |
| `components/AutoRole.tsx`  | (own internal cache)            | Module-level role cache + Realtime sync, decoupled from QueryClient |

`AutoRole` deliberately runs its **own** in-memory cache (60 s TTL) + batched fetcher rather than React Query because it must be safely callable from any depth (badges next to usernames everywhere). It has its own Realtime listener (`auto-role-cache-sync`) on `user_roles`.

---

## 6. Cache invariants & guardrails

| Invariant                                                  | Where enforced                                              |
|------------------------------------------------------------|-------------------------------------------------------------|
| Single global `QueryClient`                                | `App.tsx` L65                                               |
| All keys defined in `queryKeys.ts`                         | Convention (header comment); no ESLint rule yet — `NOT VERIFIED` as auto-enforced |
| Sorted IDs in list keys                                    | `useProfileMap` L8–L26 (canonical pattern)                  |
| `useDashboardInit` called exactly once                     | `DashboardContext.tsx` (HARD LOCK comment)                  |
| Leaf hooks await bootstrap gate                            | Memory: `dashboard-init-bootstrap-gate`                     |
| 5-min `staleTime` / 10-min `gcTime` global default         | `App.tsx` L68–L69                                           |
| `refetchOnWindowFocus: false`                              | `App.tsx` L70 — no automatic re-fetch on tab focus          |
| `refetchOnMount: false` for `dashboard-init`               | Token-refresh re-renders do NOT re-trigger fetch            |
| Components must not call `supabase.channel`                | Verified by grep — 0 hits in `src/components`               |
| Per-judge Realtime filter mandatory                        | `eslint-rules/no-unfiltered-judge-realtime.js`              |
| `useGatedEntryStatus` is the only legal status reader      | `eslint-rules/no-raw-entry-status.js` + memory: status-display-rule |

---

## 7. Risks / Tech-debt observations

> Surfaced for Step 3 (Risk register), not fixes here.

1. **`as any` casts in fetchers** — `profileMapCache.ts` L65–L67, `useJudgePhotoData.ts` L104–L107, plus the AutoRole batch query — every Supabase call uses `as any` because generated types lag. If a column is renamed, runtime crash, no compile error.
2. **Bootstrap gate timeout = 3500 ms** — on slow connections leaves fall through to N+1 queries. There is no telemetry surfacing how often this fires.
3. **Global `feed-live` channel (no filter)** — every signed-in user receives every feed event. Fine for current scale; will not survive 10× growth.
4. **`live-admin-sync` is mounted for ALL users** (it's wired at module-load via `setLiveAdminSyncQueryClient`). Non-admins still receive `site_settings` / `user_roles` events; only the cache invalidations matter to them. Bandwidth cost = small but non-zero.
5. **`AutoRole` cache duplicates `useProfileMap` data** — two parallel role-fetch paths (React-Query map vs. module-singleton). Both are correct, but a refactor could unify them.
6. **Centralised `queryKeys` registry is convention-only** — no lint rule blocks ad-hoc `useQuery(["foo"], ...)` in new code. Drift risk if a contributor skips the registry.
7. **`refetchOnReconnect` not globally disabled** — only `dashboard-init` opts out (L62). Other queries will re-fire on network resume; usually desirable, occasionally expensive.
8. **Realtime channels never explicitly unsubscribed in `liveAdminSync` / `profileMapCache` / `AutoRole`** — they're singletons, which is intentional, but a HMR full-reload can leak subscriptions in dev. Not a prod issue.
9. **`useNotificationsQuery` 60s polling stacks with Realtime** — both paths can fire near-simultaneously. Cache patches deduplicate but do extra work.
10. **No global "query-error" boundary** — individual hooks toast on failure; aggregate failure modes (e.g. RLS lockout) not centrally observable.

---

## 8. Verification status

| Item                                       | Verified by                                    |
|--------------------------------------------|------------------------------------------------|
| `QueryClient` defaults                     | `src/App.tsx` L65–L70 (read)                   |
| Imperative QueryClient wiring (4 modules)  | `src/App.tsx` L77–L84 (read)                   |
| `queryKeys.ts` registry                    | Full file read                                 |
| Bootstrap gate mechanics                   | `dashboardInitGate.ts` full read               |
| `preSeedCaches` payload shape              | `dashboardInit.ts` L1–L80 read                 |
| Per-judge Realtime filter                  | `useJudgePhotoData.ts` L168–L213 read + memory |
| Component Realtime ban                     | `grep` returned 0 hits in `src/components`     |
| 14 Realtime modules                        | `grep -rln supabase.channel` listing           |
| Hook directories                           | `ls src/hooks/*` listing                       |
| `useProfileMap` ref-stability              | Full file read                                 |
| `liveAdminSync` channel + handlers         | Full file read                                 |
| `profileMapCache` channel + handlers       | Full file read                                 |
| `AutoRole` cache + Realtime                | Full file read                                 |

**NOT VERIFIED (deferred):**
- Behavioural correctness of every individual hook beyond the ones cited above.
- That every leaf hook actually calls `awaitDashboardBootstrap` (sampled — `useSiteSetting`, `useSiteLogo`, `useIsAdmin`, `useUserRoles`, `useNavigationMenu` confirmed by memory; full audit reserved for Step 3).
- Whether all 175 DB triggers (Step 2H) propagate to a Realtime listener on the client side (likely many do not — by design).

---

**Next:** Step 2J — UI / Design System Blueprint.
