# Step 20 — Pre-Implementation Audit (Zero-Damage / Zero-Risk)

**Goal:** Mount `<PhaseWatermark />` on every photo-rendering surface so the diagonal "Judging in Progress" overlay appears on EVERY photo while `competition.phase === "judging"`.

**Mandate:** No assumption, no guesswork, no part-checking, no casual approach. Phase MUST be sourced from `useCompetitionDetail` / `useCompetitions` (or an equivalent JOIN-extended query) — never derived locally inside the component.

---

## 1. Current state of `<PhaseWatermark />`

- **Location:** `src/components/competition/PhaseWatermark.tsx`
- **Contract:** `({ phase: string; currentRound: string | null; surface?: "card"|"lightbox"|"cinema" })`
- **Behavior:** Returns `null` unless `phase === "judging"`. Otherwise renders an absolutely-positioned, `pointer-events-none` diagonal overlay. **Requires the parent to provide a `relative`/positioned ancestor** — confirmed in `EntryCard.tsx` line 121 (already mounted).

## 2. Phase source-of-truth (canonical)

| Hook | Returns phase? | Returns current_round? | Notes |
|---|---|---|---|
| `useCompetitionDetail` | ✅ resolved via `resolvePhase()` | ✅ `current_round` | Single comp. Authoritative for detail pages. |
| `useCompetitions` | ✅ resolved | ❌ (not selected) | Multi-comp list. Needs `current_round` added. |
| `useJudgeCompetitions` | ✅ resolved | ❌ | Judge-only multi-comp. Needs `current_round`. |
| `useUserEntries` / `useDashboardData` | ⚠️ raw `competition_status` only | ❌ | **Needs JOIN extension.** |
| `useAdminEntries` | ⚠️ depends | ❌ | **Needs JOIN extension.** |
| Public profile entries query (in `PublicProfile.tsx`) | ⚠️ `competitions(title)` only | ❌ | **Needs JOIN extension.** |
| Trending photos / hero photos in `FeedLeftSidebar` | ❌ | ❌ | Photos aren't bound to a competition row. **Decision needed.** |

`resolvePhase()` from `src/lib/competitionPhase.ts` is the universal resolver — already used everywhere phase is derived. Reusing it keeps a single source of truth.

## 3. Surface-by-surface audit (14 surfaces)

| # | Surface | File | Phase already in scope? | Action required | Risk |
|---|---|---|---|---|---|
| 1 | EntryCard | `src/components/EntryCard.tsx` | ✅ `competitionPhase` prop | **Already mounted (line 121)**. No-op. | None |
| 2 | CompetitionLightbox | `src/components/CompetitionLightbox.tsx` | ✅ `competitionPhase` prop (line 28) | Wrap `<img>` (line 137-145) with relative wrapper + watermark. | Low — image already inside `relative` div. |
| 3 | JuryImageViewer | `src/components/JuryImageViewer.tsx` | ❌ no phase prop. Used by Admin/Judge inside an admin context. | Add optional `competitionPhase` + `currentRound` props (default `"judging"` for the judge use-case is **not** safe — must be passed). Mount on the main `<img>` (line 264) and thumbnails (line 308). | **Medium** — need to pass phase from each consumer. |
| 4 | CinemaFullView | `src/components/judge/CinemaFullView.tsx` | ⚠️ `selectedEntry` carries `competition_id` but not `phase`. **In Cinema Mode, the user is by definition judging — phase is "judging".** Still, must source from competition row, not assume. | Add `competitionPhase` + `currentRound` props passed from parent `CinemaJudgeView`, which already loads competitions via `useJudgeCompetitions`. Mount on main `<img>` (line 791) and filmstrip thumbnails (line 1445). | **Medium** — prop drilling through CinemaJudgeView. |
| 5 | CinemaListView | `src/components/judge/CinemaListView.tsx` | ❌ no phase prop. List-mode is judge-only too. | Add `competitionPhase` + `currentRound` props from parent, mount on the 16×12 thumb (line 95-101). Tiny thumb — watermark will be barely readable but mandate is "every surface." | Low |
| 6 | MobileJudgeView | `src/components/judge/MobileJudgeView.tsx` | ⚠️ has `currentRound` (round info), no `competitionPhase`. Selected competition is in `competitions` array (carries phase). | Derive `competitionPhase` from `competitions.find(c => c.id === selectedCompId)?.phase`. Mount on grid thumbs (line 436) and full preview (line 514-515). | Low — phase already in `competitions` payload. |
| 7 | VirtualizedPhotoGrid | `src/components/judge/VirtualizedPhotoGrid.tsx` | ❌ no phase prop. Always rendered inside Cinema (judge context). | Add `competitionPhase` + `currentRound` props from parent `CinemaVirtualizedGrid` wrapper. Mount on each thumb (line 87-89). | Low |
| 8 | EntryDetail | `src/pages/EntryDetail.tsx` | ✅ `entry.competitionPhase` already resolved (line 90, 148) | Mount on the photo render (need to view the JSX block) wrapped in relative div. | Low |
| 9 | SubmissionDetail | `src/pages/SubmissionDetail.tsx` | ✅ `comp.phase` resolved (line 354) | Mount on the entry photo grid (line 447 area). | Low |
| 10 | CompetitionDetail | `src/pages/CompetitionDetail.tsx` | ✅ `competition.phase` (line 141, etc.) | Already passes `competitionPhase` to `<EntryCard>` (line 338) and `<CompetitionLightbox>` (line 440). EntryCard already shows watermark. Cover image (line 167) — admin/owner cover, **not a competition photo** → out of scope. **No change needed beyond #1 and #2.** | None |
| 11 | PublicProfile | `src/pages/PublicProfile.tsx` | ⚠️ entries have `competition: { title: string }` but no phase. | **Extend the query** in `PublicProfile.tsx` to include `competitions(phase, current_round, status, starts_at, ends_at, voting_ends_at, judging_completed)`, then resolve via `resolvePhase()` per row. Mount on competition entry thumbnails (lines ~936, 1007, 1059). **Personal photos / albums are NOT competition photos → out of scope.** | **Medium-High** — query change + per-entry resolution + 3+ render sites. |
| 12 | Dashboard | `src/pages/Dashboard.tsx` | ⚠️ `competition_status` only, no phase. | **Extend the dashboard entries query** to include phase fields, resolve per row. Mount on entry thumbnail (line 717-720) + grouped competition thumbnails. | **Medium-High** |
| 13 | FeedLeftSidebar | `src/components/FeedLeftSidebar.tsx` | ✅ for entry list (`competitionPhase="voting"` hardcoded — see line 310, this is the lightbox prop) ⚠️ trending photos block (line 145-147) — these are NOT competition photos, they're `featured_photos` / posts. | The "Recent Entries" lightbox is hardcoded as `voting` — should source real phase per entry. Trending photos block: **out of scope** unless these are competition photos (need to check the source). | **Medium** — verify trending photos source. |
| 14 | AdminEntriesSection | `src/components/admin/AdminEntriesSection.tsx` | ❌ no phase. Admin context — entries belong to specific competitions, but this section shows entries from MANY competitions. | **Extend `useAdminEntries`** to include phase. Mount on row thumbnails (lines 91, 136) and preview lightbox (line 175). | **Medium** |

## 4. Out-of-scope confirmations

These were considered but are NOT competition photo surfaces and should NOT receive the watermark:

- Cover images, avatars, journal article covers, hero banners, featured artists.
- Personal feed posts, user wall posts, photo albums (unless they originate from a competition entry — which they don't in current schema).
- Trending photos in `FeedLeftSidebar` (sourced from `featured_photos` table, not `competition_entries`).
- Lesson/course imagery.

## 5. Risk register & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Query JOIN cost on Dashboard / PublicProfile | Low | `competitions(...)` is a 1:1 reverse join; PostgREST handles it. No N+1. |
| Watermark interferes with click handlers | Low | Component uses `pointer-events-none`. Already verified in EntryCard. |
| Watermark overlaps tag stamps / vote button on small thumbs | Low | Watermark is at `z-[5]`; existing badges are `z-10+`. Confirmed in EntryCard rendering. |
| `JuryImageViewer` consumers must pass phase or watermark won't render | Medium | Required prop with explicit type — TypeScript will surface every consumer at compile. |
| Cinema views always show watermark even after admin completes round | Low | `phase` flips to `"result"` automatically once judging completes — watermark vanishes the moment `useJudgeCompetitions` refetches. |
| Multi-comp pages render heterogeneous phases | Low | Per-row phase resolution handles this naturally. |
| Type changes in payload (extending query SELECT) | Low | Additive only — no field removed. Existing consumers unaffected. |

## 6. Files that will change (planned diff scope)

**Components (mount sites — 13 edits, EntryCard already done):**
1. `src/components/CompetitionLightbox.tsx` — wrap main image
2. `src/components/JuryImageViewer.tsx` — add props + 2 mounts
3. `src/components/judge/CinemaFullView.tsx` — add props + 2 mounts (main + filmstrip)
4. `src/components/judge/CinemaJudgeView.tsx` — pass props down to children
5. `src/components/judge/CinemaListView.tsx` — add props + 1 mount
6. `src/components/judge/MobileJudgeView.tsx` — derive phase from `competitions`, 2 mounts
7. `src/components/judge/VirtualizedPhotoGrid.tsx` — add props + 1 mount
8. `src/pages/EntryDetail.tsx` — 1 mount on main photo
9. `src/pages/SubmissionDetail.tsx` — mount on entry thumbs
10. `src/pages/PublicProfile.tsx` — query JOIN + 3 mounts
11. `src/pages/Dashboard.tsx` — query JOIN + entry thumb mount
12. `src/components/FeedLeftSidebar.tsx` — switch hardcoded `"voting"` → real phase per entry
13. `src/components/admin/AdminEntriesSection.tsx` — query extension + 3 mounts

**Hooks (query extensions — 3-4 edits):**
- `src/hooks/competition/useUserEntries.ts` — add `competitions(phase, current_round, ...)` + resolve
- `src/hooks/dashboard/useDashboardData.ts` — same
- `src/hooks/admin/useAdminEntries.ts` — same
- `src/hooks/competition/useCompetitions.ts` — add `current_round` to SELECT (already returns phase)

**Type changes (additive only):**
- `FlatPhoto` (judging types) — extend to optionally carry `competitionPhase` + `currentRound` derived from the `entry.competition_id` lookup. Or pass at the rendering wrapper level.

## 7. Rollout safety

- **Reversibility:** Every change is additive. To revert, remove the `<PhaseWatermark .../>` line and the optional prop.
- **No DB writes.** No migrations. No edge function changes. No RLS changes.
- **Build verification:** Will run `npm run build` (or `tsc --noEmit`) after edits to catch any prop-drilling miss.
- **Visual verification:** Watermark is conditional on `phase === "judging"`. During submission_open / voting / result, surfaces look identical to today.

## 8. Open question for user before "go"

**The mandate says "Source `phase` from useCompetitionDetail or useCompetitions — never derive locally."** For surfaces that show photos from many competitions at once (Dashboard, PublicProfile, AdminEntriesSection, FeedLeftSidebar entry list), there is no single competition in scope. Two compliant options:

- **(A) Extend the underlying query** (chosen by user in prior turn) — JOIN `competitions(phase, current_round, ...)`, run `resolvePhase()` per row at the hook level. Phase comes from the **same** canonical resolver used by `useCompetitions`/`useCompetitionDetail`. This is what this audit assumes.
- **(B) Batch-fetch via `useCompetitions(ids)`** — cross-reference. More indirection, more re-renders.

Audit assumes **(A)**. If reconfirmed, I proceed.

---

**End of audit. Awaiting "go" to execute.**
