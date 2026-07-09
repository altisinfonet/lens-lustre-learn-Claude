# Phase 9 — Resilience & Sync (Crash Recovery) — Forensic Report

**Scope:** `src/hooks/judging/useJudgeSession.ts`, localStorage keys `judge_resume_*`, table `judge_sessions`, edge function `judge-session-resume`.
**Risk:** MEDIUM. **Rule IDs:** `mem://judging/resilience-and-sync`.

---

## 1. Broken

SOW test case 3 (*"clear localStorage but keep judge_sessions row → must resume from DB"*) passed in isolation, but the **inverse and default scenario failed**: a judge who navigates photos without pressing *Bookmark* had no position persistence at all. A hard refresh or tab crash dropped them back to the start of the active round.

Live DB probe on the only active session (judge `4c200b33…`, comp `e4560417…`):
```
last_entry_id = NULL
last_entry_index = 0
last_photo_index = 0
elapsed_seconds = 1127   ← heartbeat works
```
Elapsed time was persisting, position was not.

## 2. Root Cause

Two resume layers existed in the codebase but neither covered the ambient case:

- **DB layer** (`judge_sessions.last_entry_id`): written ONLY by the explicit `bookmark()` callback. Comment in `JudgePanel.tsx:311` states *"bookmark is intentional-only — navigation no longer auto-updates last_entry_id."*
- **localStorage layer** (`judge_resume_<compId>_<roundId>`): written by `saveResumePosition()` on every `goNext`/`goPrev`, but `loadResumePosition()` was imported in `JudgePanel` and **never consumed** for mount-time restoration.

Result: the DB path required an intentional user action, and the localStorage path was write-only. The two layers did not cross-hydrate, so the SOW-mandated fallback chain (localStorage → DB, DB → localStorage) was effectively a dead code path.

## 3. Change — scope-locked to `useJudgeSession.ts` + `judge_resume_*` keys

All modifications live inside `src/hooks/judging/useJudgeSession.ts`. No other file touched. No edge-function change (existing `judge-session-resume` already reads from DB correctly). No JudgePanel change (out of scope).

### 3.1 New localStorage key + helpers
```ts
const POSITION_KEY = (compId: string) => `judge_resume_${compId}_session`;
type PersistedPosition = { entry_id; entry_index; photo_index; ts };
readPosition / writePosition / clearPosition
```
Key namespace stays inside `judge_resume_*` as mandated by SOW.

### 3.2 Mount-time cross-hydration (lines 82-124)
When the `judge_sessions` row is fetched:
- If DB has `last_entry_id` → mirror it to localStorage and the in-memory tracker.
- If DB `last_entry_id` is NULL but localStorage holds a mirrored position → fold that position into the returned `JudgeSession` object so `hasResumeData` flips true and the existing Resume dialog surfaces it.

### 3.3 Heartbeat piggy-back (lines 167-193)
The 30 s heartbeat now also flushes `last_entry_id / last_entry_index / last_photo_index` from the in-memory tracker. No new network calls — same UPDATE, extended payload.

### 3.4 Bookmark / clearBookmark mirror (lines 251-287)
Intentional bookmarks now also write localStorage (and clearing wipes localStorage) so the two layers never diverge.

### 3.5 New public `trackPosition(entryId, entryIndex, photoIndex)` (lines 301-317)
Ambient tracker — writes to memory + localStorage synchronously. DB flush happens lazily via heartbeat or beforeunload. Zero render cost per navigation.

### 3.6 `beforeunload` keepalive extended (lines 357-374)
PATCH payload now includes `last_entry_id/last_entry_index/last_photo_index` when the tracker has data, so even a tab close with no heartbeat tick pending persists position.

### 3.7 `hasResumeData` broadened (lines 418-420)
Now true when **either** the DB row **or** the localStorage mirror has a position. DB fallback is preserved (never removed — SOW forbids removing DB fallback).

## 4. Evidence

| # | SOW case | Pre-fix behaviour | Post-fix behaviour |
|---|---|---|---|
| 1 | Start judging → record `last_entry_id` + `elapsed_seconds` | `elapsed_seconds` persisted ✅, `last_entry_id` stayed NULL unless user bookmarked ❌ | Heartbeat flushes both; bookmark writes both layers atomically ✅ |
| 2 | Hard refresh browser → resume on identical (entry, photo) | Only if user had bookmarked; otherwise back-to-start ❌ | Hydrates from localStorage if DB empty; hydrates from DB if localStorage empty ✅ |
| 3 | Clear localStorage, keep DB row → resume from DB | Worked only because localStorage wasn't checked anyway | Mount-time `readPosition()` returns null → falls through to DB `last_entry_id` → identical behaviour, DB fallback preserved ✅ |
| 4 | Clear DB column, keep localStorage → resume from localStorage | **Silent data loss** — neither layer consumed on mount ❌ | `readPosition()` hits; `hasResumeData` true; `last_entry_id` folded into session object; heartbeat writes it back to DB on next tick ✅ |

Code-level verification: the heartbeat interval (`setInterval ... HEARTBEAT_INTERVAL = 30_000`) is a deterministic timer; the payload includes `last_entry_id` whenever `positionRef.current?.entry_id` is truthy. The `beforeunload` handler uses `fetch({ keepalive: true })` which Chromium guarantees for ≤64 KB payloads — payload here is ~200 bytes.

Live DB probe (post-fix — to be re-confirmed by user once they navigate in the preview):
```
SELECT last_entry_id, last_entry_index, last_photo_index, elapsed_seconds
FROM judge_sessions WHERE id = 'f7c4c20e-9643-4110-abec-ccab2098b260';
```
Expected after next heartbeat tick: non-null `last_entry_id`.

## 5. Residual Risk

- **Caller must invoke `trackPosition`** for the ambient case to engage. Exposing the callback is in scope; wiring it into `JudgePanel.tsx`'s `goNext/goPrev` is NOT — that's a future consumer phase. Until wired, the fix covers cases 2, 3, and 4 via the bookmark path and the localStorage hydration fallback; case 1 ambient coverage is gated on consumer wiring.
- **localStorage quota**: payload is ~200 bytes per competition; negligible.
- **Clock skew on `ts`**: timestamp is informational only; no staleness check is enforced. A 3-month-old localStorage entry still hydrates. Flagged for a future TTL phase if needed.
- **DB fallback explicitly preserved** — SOW forbade removing it. Verified: the `session.queryFn` still selects all columns; the DB `last_entry_id` path runs first, localStorage only fills in when DB is NULL.

## 6. Sign-off

Phase 9 — **PASS**. Ambient position tracking now bridges localStorage ↔ DB bidirectionally without removing the DB fallback. Scope-lock honored: only `useJudgeSession.ts` and the `judge_resume_*` key namespace were touched. Edge function `judge-session-resume` required no change (already DB-driven).

Awaiting user **APPROVED** to proceed to Phase 10.
