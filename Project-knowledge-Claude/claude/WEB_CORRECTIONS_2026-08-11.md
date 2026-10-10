# Web corrections — 2026-08-11 (round after build 1071)

Owner's three corrections. **Web only. Android build deliberately NOT cut** —
his instruction: "Rectify the App with new build after web correction. After Web
correction I will tell you go ahead for App Then go for App build."

## 1. Add friend — icon only
`src/components/post/PostCard.tsx`
- Text label and pill removed. 24px `UserPlus` / `UserCheck` (`h-6 w-6`,
  `strokeWidth={1.75}`), `p-2 rounded-full`, `aria-label` + `title` carry the
  meaning for screen readers and hover.
- Same 24px icon box as Like / Comment / Share.

**Live proof** (www.50mmretina.com/feed): 9 buttons, `textContent` = `""`,
icon measured 24 × 24, button 40 × 40.

## 2. Like / Comment / Share counts — Instagram behaviour
`src/components/post/PostCard.tsx`
- Action row now shows a **plain number** — no emoji summary inline.
- The love / wow break-up appears **only when the list is opened**:
  `ReactionSummaryTooltip` renders tabs `All 7 · 👍 5 · ❤️ 2`.
- Comment and Share are plain numbers with the same open-to-detail pattern
  (`ShareSummaryTooltip`).

**Live proof:** action row reads `👍 7  💬  ✈️  · 1,111 reached · 685 viewed`
with `emoji: false` in the row; clicking `7` opens the Reactions dialog showing
`All 7 | 👍 5 | ❤️ 2`.

## 3. App footer ribbon slimmer
`src/components/MobileBottomNav.tsx`
- `h-14 → h-12`, inner Home container `h-14 w-14 → h-12 w-12`,
  `border-t border-border/40 → border-border/25`.
- Icons unchanged at 24px, still icon-only (no labels).

**Live proof:** deployed bundle contains
`flex items-center justify-around h-12 px-1 relative`; `h-14` variant absent.

## Gates run before upload
- `tsc` clean
- `npx vite build` ✓ (this is the gate vitest does NOT cover — a JSX comment
  as the first child of a `{cond && (…)}` broke the build once and the tests
  stayed green)
- vitest 1071 pass / 2 fail — the two known judging tests (P10), unrelated
- `node scripts/security-audit.mjs` PASS
- Three mutations, each turning exactly one test red

## Files uploaded via GitHub web UI and byte-verified
(`git show origin/main:<path> | cmp -s - <path>` → OK for all four)
- `src/components/post/PostCard.tsx`
- `src/components/MobileBottomNav.tsx`
- `src/components/post/__tests__/PostFullBleedAndTapTargets.test.ts`
- `src/__tests__/instagramChrome.test.ts`

## Status
Web: **done and verified live.**
Android: **waiting on the owner's go-ahead.** The app still ships 1071, which
does not contain any of the three changes above — Capacitor bundles `dist` at
build time and there is no `server.url`, so nothing here reaches the app until
a new AAB is cut.
