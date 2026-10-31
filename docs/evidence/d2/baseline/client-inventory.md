# 0-D2-03 — Client inventory (Phase 0 baseline)

**Measured by D2 at `origin/staging` @ `69a7f87f06f2` on 2026-09-03T07:56:01Z.** Every count below is reproducible from the command shown beside it. `src/` is byte-identical between `ef5d4a37` (the register's reading) and `69a7f87` — `git diff --stat ef5d4a3 69a7f87 -- src` is empty — so any difference between the two readings is **method**, not code.

**Gate:** `docs/evidence/d2/baseline/client-inventory.md` with file paths and timestamp.

## 1 · The three headline counts, and the readings they disagree with

| Measure | Command (run at this commit) | This reading | Register (0-D2-03, `ef5d4a37`) | Addendum (2026-09-01) |
|---|---|---|---|---|
| `<img` — every occurrence in `src/` | `grep -rnE '<img\b' src/ \| wc -l` | **290** | 223 | — |
| `<img ` JSX tags in `.tsx`, excluding tests/uiharness — the Addendum's method | `grep -rn '<img ' src/ --include=*.tsx \| grep -vE '__tests__\|\.test\.\|uiharness' \| wc -l` | **158** | — | 158 |
| `setInterval(` | `grep -rn 'setInterval(' src/ \| wc -l` | **21** | 21 | 21 |
| `refetchInterval` | `grep -rn 'refetchInterval' src/ \| wc -l` | **4** | 4 | 4 |

**Disagreement recorded, not resolved.** The register's `<img>` figure of **223** does not reproduce from any of the nine grep variants tried at this commit (§5). Its method is not written in the register row. The Addendum's **158** reproduces exactly. Three figures, two reproducible, one not — **none is corrected here.** P11 should pin its before-figure to a named command, not to a number.

## 2 · `<img` — where they are

### 2a · JSX `<img ` tags, `.tsx`, excluding tests/uiharness — 158 tags across 80 files

| File | Tags |
|---|---|
| `src/pages/JournalEditor.tsx` | 7 |
| `src/components/admin/AdminEngagement.tsx` | 6 |
| `src/pages/Dashboard.tsx` | 6 |
| `src/pages/Index.tsx` | 6 |
| `src/pages/PublicProfile.tsx` | 6 |
| `src/components/FeedRightSidebar.tsx` | 5 |
| `src/components/FeedLeftSidebar.tsx` | 4 |
| `src/components/admin/AdminCertificates.tsx` | 4 |
| `src/components/admin/AdminFeaturedArtist.tsx` | 4 |
| `src/components/AskAnything.tsx` | 3 |
| `src/components/WallPosts.tsx` | 3 |
| `src/components/admin/AdminEntriesSection.tsx` | 3 |
| `src/components/ads/AdZone.tsx` | 3 |
| `src/components/feed/FeedStoriesBar.tsx` | 3 |
| `src/components/profile/ProfileStories.tsx` | 3 |
| `src/components/AdminGiftCredit.tsx` | 2 |
| `src/components/FeaturedArtist.tsx` | 2 |
| `src/components/GlobalSearch.tsx` | 2 |
| `src/components/NotificationBell.tsx` | 2 |
| `src/components/admin/AdminAuthPages.tsx` | 2 |
| `src/components/admin/AdminBanners.tsx` | 2 |
| `src/components/admin/AdminEmployee.tsx` | 2 |
| `src/components/admin/AdminGallery.tsx` | 2 |
| `src/components/admin/AdminJudgingTags.tsx` | 2 |
| `src/components/admin/AdminPhotoOfDay.tsx` | 2 |
| `src/components/admin/AdminPushBroadcast.tsx` | 2 |
| `src/components/admin/AdminSEO.tsx` | 2 |
| `src/components/admin/AdminVoteAuditPanel.tsx` | 2 |
| `src/components/admin/CoverImageUploader.tsx` | 2 |
| `src/components/admin/EmailRichTextToolbar.tsx` | 2 |
| `src/components/admin/ProfileTypeaheadPicker.tsx` | 2 |
| `src/components/admin/ads/AdCreativeLibrary.tsx` | 2 |
| `src/components/discover/DiscoverCard.tsx` | 2 |
| `src/components/judge/CinemaFullView.tsx` | 2 |
| `src/components/judge/MobileJudgeView.tsx` | 2 |
| `src/pages/CourseEditor.tsx` | 2 |
| `src/pages/EditProfile.tsx` | 2 |
| `src/pages/EntryDetail.tsx` | 2 |
| `src/pages/Friends.tsx` | 2 |
| `src/pages/Login.tsx` | 2 |
| `src/pages/MyPhotos.tsx` | 2 |
| `src/pages/Signup.tsx` | 2 |
| `src/components/AvatarCompletionRing.tsx` | 1 |
| `src/components/CommentsSection.tsx` | 1 |
| `src/components/FacebookPhotoGrid.tsx` | 1 |
| `src/components/FileUploadDropZone.tsx` | 1 |
| `src/components/ImageEngagement.tsx` | 1 |
| `src/components/JudgingStampBadge.tsx` | 1 |
| `src/components/JuryImageViewer.tsx` | 1 |
| `src/components/MobileBottomNav.tsx` | 1 |
| `src/components/MutualFriends.tsx` | 1 |
| `src/components/ReactionSummaryTooltip.tsx` | 1 |
| `src/components/ShareSummaryTooltip.tsx` | 1 |
| `src/components/admin/AdminExcellence.tsx` | 1 |
| `src/components/admin/AdminLayout.tsx` | 1 |
| `src/components/admin/AdminOnPageImages.tsx` | 1 |
| `src/components/admin/AdminUsers.tsx` | 1 |
| `src/components/admin/ads/AdminAdsV2.tsx` | 1 |
| `src/components/ads/FullscreenAdShell.tsx` | 1 |
| `src/components/comments/CommentThread.tsx` | 1 |
| `src/components/competition/EditEntryDialog.tsx` | 1 |
| `src/components/judge/CinemaDashboard.tsx` | 1 |
| `src/components/judge/CinemaJudgeView.tsx` | 1 |
| `src/components/judge/CinemaListView.tsx` | 1 |
| `src/components/judge/CompleteRoundDialog.tsx` | 1 |
| `src/components/judge/JudgeProgressPanel.tsx` | 1 |
| `src/components/judge/VirtualizedPhotoGrid.tsx` | 1 |
| `src/components/post/DraftsList.tsx` | 1 |
| `src/components/post/PostCard.tsx` | 1 |
| `src/components/profile/PhotoAlbums.tsx` | 1 |
| `src/components/profile/QRCodeCard.tsx` | 1 |
| `src/components/sidebar/SidebarTopContributors.tsx` | 1 |
| `src/pages/CompetitionDetail.tsx` | 1 |
| `src/pages/Courses.tsx` | 1 |
| `src/pages/CropTest.tsx` | 1 |
| `src/pages/FeaturedArtistPage.tsx` | 1 |
| `src/pages/JournalArticle.tsx` | 1 |
| `src/pages/LessonView.tsx` | 1 |
| `src/pages/SubmissionDetail.tsx` | 1 |
| `src/pages/Winners.tsx` | 1 |

### 2b · `<img` inside HTML template strings — **7** sites, invisible to P11's JSX lint rule

A JSX lint rule sees elements, not strings. These emit `<img>` markup at runtime from template literals (email bodies, journal/article HTML, PDF HTML). The register row says **nine**; by the method here — a template literal that emits an `<img` tag, comments excluded — it is **7**. Recorded, not resolved; the list is what matters.

| File:line | Snippet |
|---|---|
| `src/components/admin/EmailRichTextToolbar.tsx:310` | `const imgTag = `<img src="${url}" alt="Email image" style="max-width:${widthPct}%;width:${` |
| `src/lib/generateArticlePdf.ts:181` | `(_m, url) => `<figure><img src="${escapeHtml(String(url).trim())}" alt="Article image" /><` |
| `src/pages/JournalEditor.tsx:298` | `if (imgMatch) return `<img loading="lazy" decoding="async" src="${imgMatch[1]}" alt="Artic` |
| `src/pages/JournalEditor.tsx:570` | `const imgHtml = `<div class="my-4"><img src="${url}" alt="Inline image" style="width:100%;` |
| `src/pages/JournalEditor.tsx:574` | `setBody((prev) => prev + `\n<div class="my-4"><img src="${url}" alt="Inline image" style="` |
| `src/pages/FeaturedArtistPage.tsx:498` | `(_m, url) => `<img src="${url.trim()}" alt="" />`` |
| `src/pages/JournalArticle.tsx:48` | `return `<div class="my-8"><img src="${imgMatch[1]}" alt="Article image" loading="lazy" /><` |

### 2c · `new Image()` / `createElement('img')` — 21 sites, also invisible to a JSX lint

Programmatic images (preloads, hashing, compression, PDF assets). Not display tags; listed so P11's rule is scoped honestly.

| File:line |
|---|
| `src/components/post/PostMedia.tsx:591` |
| `src/components/admin/ImageCropModal.tsx:125` |
| `src/components/OnboardingModal.tsx:88` |
| `src/components/WallPosts.tsx:645` |
| `src/components/profile/QRCodeCard.tsx:57` |
| `src/components/judge/CinemaFullView.tsx:580` |
| `src/components/judge/CinemaFullView.tsx:585` |
| `src/components/LogoLighting.tsx:16` |
| `src/hooks/core/useProgressiveImage.ts:38` |
| `src/lib/pdfLogo.ts:16` |
| `src/lib/generateArticlePdf.ts:82` |
| `src/lib/generateArticlePdf.ts:114` |
| `src/lib/generateArticlePdf.ts:819` |
| `src/lib/media/storedObject.ts:65` |
| `src/lib/fileSecurityScanner.ts:216` |
| `src/lib/imageCompression.ts:65` |
| `src/lib/imageCompression.ts:152` |
| `src/lib/imageHash.ts:29` |
| `src/lib/certificateCanvas.ts:89` |
| `src/lib/generateCertificatePdf.ts:39` |
| `src/pages/Index.tsx:323` |

## 3 · `setInterval(` — all 21, against P10's two clauses

P10's gate: *no timer fires more often than once a second; every repeating timer is cleared on `visibilitychange`.* A timer passes only if both hold.

| File:line | Interval | ≥ 1 s | `visibilitychange` in file | P10 today |
|---|---|---|---|---|
| `src/modules/admin/CompetitionsModule.tsx:132` | `1000` = 1000 ms | yes | **no** | fail |
| `src/components/admin/AdminCompetitionFunnel.tsx:60` | `30_000` = 30000 ms | yes | **no** | fail |
| `src/components/admin/AdminJudgeMonitoringPanel.tsx:160` | `15_000` = 15000 ms | yes | **no** | fail |
| `src/components/PhotoOfTheDay.tsx:39` | `CYCLE_MS` = 5000 ms | yes | **no** | fail |
| `src/components/judge/JudgeSessionTimer.tsx:31` | `1000` = 1000 ms | yes | **no** | fail |
| `src/components/judge/JudgeSessionTimer.tsx:44` | `1000` = 1000 ms | yes | **no** | fail |
| `src/components/PhaseBanner.tsx:55` | `1000` = 1000 ms | yes | **no** | fail |
| `src/components/ads/RewardedAd.tsx:73` | `1000` = 1000 ms | yes | **no** | fail |
| `src/components/ads/FullscreenAdShell.tsx:54` | `1000` = 1000 ms | yes | **no** | fail |
| `src/components/ads/AdZone.tsx:258` | `200` = 200 ms | **no** | yes | fail |
| `src/hooks/judging/useJudgeSession.ts:173` | `?` | **no** | **no** | fail |
| `src/hooks/judging/useJudgeSession.ts:203` | `1000` = 1000 ms | yes | **no** | fail |
| `src/hooks/judging/useJudgingLock.ts:106` | `HEARTBEAT_INTERVAL_MS` = 120000 ms | yes | **no** | fail |
| `src/hooks/feed/useFeedEventTracker.ts:42` | `FLUSH_INTERVAL` = 5000 ms | yes | **no** | fail |
| `src/hooks/core/useLastActive.ts:42` | `5 * 60 * 1000` = 300000 ms | yes | **no** | fail |
| `src/hooks/core/useEngagementHeartbeat.ts:149` | `TICK_MS` = 15000 ms | yes | yes | **PASS** |
| `src/pages/Login.tsx:95` | `1000` = 1000 ms | yes | **no** | fail |
| `src/pages/SubmissionDetail.tsx:326` | `60_000` = 60000 ms | yes | **no** | fail |
| `src/pages/Index.tsx:191` | `1` | **no** | **no** | fail |
| `src/pages/Index.tsx:356` | `HERO_SLIDE_MS` = 8000 ms | yes | **no** | fail |
| `src/pages/PublicProfile.tsx:65` | `1800` = 1800 ms | yes | **no** | fail |

**20 of 21 fail P10's gate today.** The one pass is `useEngagementHeartbeat.ts` — the pattern P10 copies.

**The fastest timer is 30 ms**, `src/pages/Index.tsx:191`: `duration = 1800; steps = 60; interval = duration / steps` → 30 ms, driving a counter animation. It is **self-terminating** — `clearInterval` after 60 steps, 1.8 s — a nuance P10's text does not address; a bounded burst is still 33 wake-ups a second while it runs, and `requestAnimationFrame` is the right tool. Second fastest: `AdZone.tsx:258` at 200 ms, which *does* reference `visibilitychange` but fails the ≥ 1 s clause.

## 4 · `refetchInterval` — 4 sites

| File:line | Value |
|---|---|
| `src/hooks/competition/useCompetitionDetail.ts:272` | `isVoting ? 90 * 1000 : false` |
| `src/hooks/judging/useMultiJudgeProgress.ts:114` | `30_000` |
| `src/hooks/notifications/useNotificationsQuery.ts:392` | `60_000` |
| `src/hooks/dashboard/useDashboardData.ts:348` | `30000` |

## 5 · The nine `<img` variants tried, so the 223 can be reconciled by whoever knows its method

| Command | Count |
|---|---|
| `grep -rn '<img ' src/` | 163 |
| `grep -rn '<img' src/ --include=*.tsx` | 250 |
| `grep -rn '<img ' src/ --include=*.tsx` | 159 |
| `grep -rn '<img' src/ excl tests/uiharness` | 266 |
| `grep -rn '<img ' src/ excl tests/uiharness` | 161 |
| `grep -rn '<img' src/ --include=*.tsx excl tests` | 249 |
| `grep -rnE '<img\b' src/ --include=*.tsx --include=*.ts excl tests` | 266 |
| `git grep -n '<img' -- src/` | 290 |
| `git grep -n '<img' -- 'src/*.tsx' excl tests` | 250 |

All taken at `69a7f87f06f2`, 2026-09-03T07:56:01Z.

## 6 · Findings carried forward from the `ef5d4a37` reading, re-verified here

1. **20 of 21 timers fail P10's gate today** — re-verified, §3.
2. **The fastest timer is 30 ms at `src/pages/Index.tsx:191`**, not named in P10's text — re-verified, with the self-terminating nuance added.
3. **`<img` tags exist in HTML strings where P11's lint cannot see them** — re-verified; 7 by this method against the register's 9, both listed, neither corrected.

*D2. This file records; it approves nothing and closes nothing.*
