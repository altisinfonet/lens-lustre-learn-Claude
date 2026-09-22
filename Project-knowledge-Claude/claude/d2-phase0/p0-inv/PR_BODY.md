# 0-D2-03 — client inventory: `<img>`, `setInterval`, `refetchInterval` — landed as evidence

**Unit:** 0-D2-03 · **Branch:** `d2/P0-client-inventory-20260903` off `staging` @ `69a7f87` · **Target:** `staging` · **Commit:** `35f23cb`

**Gate (verbatim, register rev 4 row 0-D2-03):** `<img>` **223**, `setInterval` **21**, `refetchInterval` **4** at `ef5d4a37`, with file paths and timestamp. **20 of 21 timers fail P10's gate today**; the fastest is 30 ms (`src/pages/Index.tsx:191`), which P10's text does not mention.

**Cause, not symptom:** this unit lands a measurement, not a fix. The one thing that *was* a cause — the 223-vs-158 disagreement — is a **difference of counting method, not of code**: `git diff ef5d4a3 69a7f87 -- src/` is empty, so both readings were taken against byte-identical source. Both are recorded; neither is "corrected" (C-49).

## Paths touched
- `docs/evidence/d2/baseline/client-inventory.md` — new, 210 lines, generated at `69a7f87`, 2026-09-03T07:5xZ

Nothing else. No source, no workflow, nothing under `supabase/**`, `package*.json`, `scripts/lane-config.*`, `docs/gates/**`, ledger.

## Re-measured at current staging (`69a7f87`) — both readings stated
| Measure | Register (at `ef5d4a37`) | This file (at `69a7f87`) | Note |
|---|---|---|---|
| `<img\b` every occurrence under `src/` | 223 | **290** | grep, every file type |
| `<img ` JSX tags in `.tsx`, excluding tests/uiharness | 158 (Addendum) | **158** | Addendum's method reproduces exactly |
| register's 223 | — | **not reproduced** from any of nine method variants (163 / 250 / 159 / 266 / 161 / 249 / 266 / 290 / 250 — all listed in §1) | recorded, not resolved |
| `setInterval(` | 21 | **21** | matches |
| `refetchInterval` | 4 | **4** | matches |

Carried forward, all with file:line in the file: **20 of 21 timers fail P10** (only `useEngagementHeartbeat.ts:149`, TICK_MS = 15000, passes); fastest is **30 ms at `src/pages/Index.tsx:191`** (`duration=1800; steps=60; interval=duration/steps`, self-terminating after 1.8 s); next `AdZone.tsx:258` at 200 ms. **HTML-template-string `<img`** (invisible to P11's JSX lint): register says 9, this file finds **7** sites (`EmailRichTextToolbar.tsx:310`, `generateArticlePdf.ts:181`, `JournalEditor.tsx:298/570/574`, `FeaturedArtistPage.tsx:498`, `JournalArticle.tsx:48`) — one earlier candidate at `FeaturedArtistPage.tsx:470` is a JSX comment and was excluded; both numbers stand. §2c lists 21 `new Image()` / `createElement('img')` sites.

## Evidence
`docs/evidence/d2/baseline/client-inventory.md` — VERIFIED (emulated/static; no device reading in this unit). Generator was a throwaway script outside the repo; every count is a plain grep the Auditor can re-run from the commands quoted in the file.

## Push authority
None on this side (proxy refuses; re-tested 2026-09-03). Delivered as a `git am`-able patch through the transfer channel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017fdB5mybV9pixsM7n9b9Tf
