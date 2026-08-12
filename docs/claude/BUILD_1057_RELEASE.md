# Build 1057 — the speed build (cut 2026-08-07)

Android Build **run #57** → versionCode **1057**, versionName 1.2.2.
Trigger commit `a163a40`. Fired and verified in progress on the Actions page.

## What shipped in 1057 (all measured, all with regression-pin tests)

This build carries every performance fix made since 1056. Nothing about how the
app looks or works changed — the same screens and buttons, just faster.

| Fix | Commit | Effect |
|---|---|---|
| Feed shows the existing 600px thumbnail, not the full original | `d636408` (earlier) | ~87 KB → ~20 KB per feed image |
| Read requests time out at 25s (uploads exempt) | `dd1fd12` (earlier) | no more skeletons that never resolve |
| Profile relationship query is one parallel cached call, not 10 sequential | `88bf64f` (earlier) | profile opens fast, not "after 5 minutes" |
| Ask Anything + footer menu home-only (app); Ask Anything home-only (web) | `c4e2144` (earlier) | lighter non-home pages — the owner's special note |
| Nav icons from a curated map, not the whole lucide library | `3794dd5` (earlier) | entry chunk ~2.0 MB → ~1.5 MB |
| **Fonts load non-blocking** (media=print swap in index.html; 3 render-blocking `@import` removed from index.css; Lora dropped) | `354ad58` + `0a18226` | first paint no longer waits on a Google round-trip |
| **Non-English translations lazy-loaded** (6 Indic dicts moved to `translations.rest.ts`, dynamic import) | `ed442aa` | **entry/boot chunk 1472 KB → 996 KB** |

Measured entry chunk after all of the above: **996 KB** (was ~2.0 MB before the
lucide + i18n work). `translations.rest` is its own 476 KB chunk that only a
non-English user ever downloads.

## Font change detail
- `src/index.css` no longer opens with three `@import url(fonts.googleapis…)`.
  Those were render-blocking. The `--font-*` fallback stacks are unchanged.
- `index.html` loads Inter + Space Mono in ONE `<link media="print"
  onload="this.media='all'">` request + a `<noscript>` fallback. CSP already
  allows `'unsafe-inline'` (so onload fires) and trusts fonts.googleapis.com.
- **Lora removed entirely** — it was imported every page load and used in zero
  components (measured 2026-08-03). `--font-serif` falls back to Georgia.
- Pin: `src/__tests__/fontLoadingNonBlocking.test.ts`.

## i18n lazy-load detail
- `translations.ts` now exports `translations: Partial<Record<Lang,Dict>> = { en }`
  and keeps LANGS / navKeyForLabel / ADMIN_GROUP_KEYS (all small, ASCII) — the
  only files that import those are untouched.
- `translations.rest.ts` (NEW) holds hi/bn/mr/gu/ta/te and exports `rest`.
- `I18nContext.tsx` holds `dicts` state (starts `{ en }`) and `import()`s
  `./translations.rest` in an effect whenever a non-English language is active.
  Until the chunk arrives, `t()` returns the English fallback — the exact
  behaviour already used for any missing key, so text is never blank.
- Encoding tripwire `src/__tests__/sourceEncoding.test.ts` PASSED after the
  split (the 6 Indic-script dicts moved cleanly, zero mojibake).
- Pin: `src/i18n/__tests__/lazyTranslations.test.ts`.

## Verification before the cut
- `tsc --noEmit -p tsconfig.app.json` → exit 0.
- Full suite: **903 passing, 25 failing, 1 skipped**. The 25 are the documented
  pre-existing set (PhaseWatermark, ProfilePhotoPrompt, JudgeGuideModal,
  complete-round-progression) — none in a file this session touched. Zero new.
- Every one of the 9 pushed files byte-diffed identical to origin/main after
  upload.

## Push note / lesson reinforced
No dependencies were added, so no lockfile ordering was needed. One process
slip: the first index.html commit did not land because I navigated away before
it finished — this briefly left main with the `@import` removed but no async
link (fonts falling back to system). Caught it on byte-diff and re-pushed
(`0a18226`). **Always wait for the commit to land and byte-verify before moving
to the next file.**

## Deferred to the NEXT build (owner chose "cut 1057 now, cache next")
**React Query cache persistence** (instant load on reopen — the Instagram feel).
Do it as its own careful, security-reviewed change:
- adds `@tanstack/react-query-persist-client` + a sync-storage persister →
  regenerate BOTH `bun.lock` and `package-lock.json`, verify `bun install
  --frozen-lockfile` locally (this exact check broke the web deploy once), dep
  commit FIRST;
- bump `gcTime` 10 min → 24h in `src/App.tsx` so cache survives restarts;
- **do NOT persist wallet/admin/PII queries to localStorage** — use a
  `shouldDehydrateQuery` allowlist (feed/profiles/public content only);
- **clear on signOut + a version-buster key** to prevent one account seeing a
  previous account's cached data on a shared device;
- cannot be fully proven until it is on a real phone.
