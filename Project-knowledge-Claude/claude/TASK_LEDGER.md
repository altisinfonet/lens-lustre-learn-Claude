# TASK LEDGER — complete, as at 2026-08-21 10:05 UTC

Every task tracked across this engagement, verbatim from the live task list. Nothing is
summarised away. Where a task's status is older than the work that superseded it, that
is stated as an observation — **no stale status was silently changed.**

**Totals: 127 tasks · 116 completed · 9 pending · 2 in_progress.**

---

## A. OPEN ITEMS (11) — the only ones that are not completed

⚠ These are the exact carry-forward list. Six are UI/app bugs from the 2026-08-16/17
build cycles; two are stale-open (superseded by later workstreams but never formally
closed); three are product work.

| # | Task | State | Observation (evidence-based, not assumed) |
|---|---|---|---|
| 34 | Instagram-style upload composer | pending | Product work. Never started in these sessions. |
| 35 | Trigger the Android build once the showroom batch is complete | pending | **Effectively overtaken**: builds 1102–1111 have since been cut, most recently BUILD 1111 / v1.2.16 on 2026-08-21. Left open because the original "showroom batch" scope was never itemised, so I cannot prove it is the same work. |
| 44 | Bug 7 — crop dialog completely dead to touch on 1.2.8 | pending | Related fix shipped for 1.2.10 (`ImageCropModal` sibling-of-Radix-dialog inert bug, recorded in ANDROID_BUILD_TRIGGER history). **Not re-tested on a current build in these sessions** — status left as-is. |
| 45 | Bug 8 — theme toggle overlaps a long name in the account sheet | pending | Not touched in these sessions. |
| 46 | Bug 9 — pinch-zoom dead on app, no wheel zoom on web | pending | Not touched in these sessions. |
| 47 | Bug 10 — Create Post only works from the Feed page | pending | Not touched in these sessions. |
| 52 | Build HashtagTypeahead into the four caption surfaces | **in_progress** | Hashtag security/grants work completed separately (migration 20260817102540). The four-surface typeahead itself was **not verified complete** in these sessions. |
| 54 | Correction 1 — raise inline-edit Cancel/Save to the 44px thumb floor | pending | Not touched in these sessions. |
| 55 | Correction 2 — make @mentions work in the app caption box | pending | Not touched in these sessions. |
| 87 | P2 — Classes B+C: audit and safely widen the candidate pattern | **in_progress** | **Stale-open.** The widening shipped as migration `20260820090000_candidate_pattern_widened.sql`, is documented in `docs/CANDIDATE_PATTERN_AUDIT.md`, and is mutation-locked (19/19). Left in_progress rather than closed by assumption; recommend an explicit close in the next session after a 2-minute confirmation. |
| 91 | Final — reconciliation, Item A re-evaluation, CLOSURE UPDATE report | pending | **Stale-open.** Superseded by the WS1–WS4 closure series and the FINAL DECISION PACKAGE. Item A (`measure-post-media`) was re-evaluated and the decision is KEEP. Left pending for the same reason as #87. |

## B. COMPLETED (116)

### This session's work — Phase 2 write path, WS1–WS5, Phase 3 audit, master plan (#104–#127)

| # | Task |
|---|---|
| 104 | P1 — Fix RED-1 detached supabase.rpc |
| 105 | P2 — Fix RED-2 scheduled duplicate |
| 106 | P3 — Stop the legacy fallback masking media failures |
| 107 | P4 — Verify the complete write path |
| 108 | P5 — Deploy and prove in production |
| 109 | P6 — Recheck the delta and report |
| 110 | 3A — Audit the 29 legacy slides (read-only) |
| 111 | 3B — Determine the safe migration strategy |
| 112 | 3C — New fence and manifest |
| 113 | 3D — Mutation coverage before migration |
| 114 | 3E/3F — Dry run then real migration |
| 115 | 3G/3H/3I — Verify, Class-F, Item A |
| 116 | Final reconciliation — read-only verification (5 items) |
| 117 | Produce PHASE 2 — FINAL DECISION PACKAGE |
| 118 | D1/D2 — Record 27+2 permanent legacy exclusions |
| 119 | D3 — Gate, execute and verify the Class-F repoint |
| 120 | Post-execution — recalc, tests, mutations, CI, closure update |
| 121 | Diagnose how the Android app serves its bundle |
| 122 | Fix + build/release the Android write path |
| 123 | **Verify one real Android post + delta_growing** — CLOSED 2026-08-21 on production evidence (posts `7eaf0ef8…`, `aa98cf72…`) |
| 124 | Phase 3 offline-resilience audit (read-only) |
| 125 | Android acceptance verification (read-only) |
| 126 | Stand up the Phase-5 monitoring slice |
| 127 | Write the authoritative Master Execution Plan |

### Earlier Phase-2 workstreams (#79–#103)

79 Item A decision · 80/81 Item E audit + implement · 82–86 P1a–P1e write path
(trace, assess, implement, 19 cases + 9 mutations, deploy+verify) · 88 Classes D+E
impact matrix · 89 Class F evidence · 90 D-002/D-003 specification · 92 Merge PR #77 ·
93 Deploy migrate-post-media v2 · 94 Class B/C migration cycle · 95 Close the
stale-client hole · 96 Bump cache_buster · 97 PHASE 2 CLOSURE UPDATE · 98 WS0 baseline
· 99 WS1 write path · 100 WS2/3 legacy evidence matrix · 101 WS4 D-002/D-003 ·
102 WS5/6/7 Item A + reconciliation + gates · 103 FINAL CLOSURE UPDATE

### Orphan-media programme (#69–#78)

D1 current-state audit · D2 12-state orphan model · D3 media-aware reference set ·
D4 behavioural tests (12 states) · D5 mutation suite · D6 performance/scale ·
D7 regression · D8 hash-bound deployment · D9 independent production verification ·
D10 commit + Item D report

### Gates, fixes and audits (#56–#68)

56 Crop & Upload composer bug · 57–59 CDN measurement + verdict · 60 universal
reachability gate · 61 baseline diff per scene · 62 docs/DECISIONS.md registry ·
63 sweep wired into CI unbypassably · 64 DOB dropdown · 65 privacy chooser (Option A,
honest disclosure) · 66 full verification pass · 67 seven harness fixtures ·
68 category strip overlap

### Build cycle 1.2.6–1.2.13 (#36–#53, the completed subset)

36 confirm build under test · 37 account sheet dead space/Logout · 38 Create Post
failure · 39 crop options dead after upload · 40 crop dialog (scroll, handles,
pinch, preview) · 41 Wall About section · 42 Profile page redesign · 43 wrong email
under another member's name · 48 PDF downloads on mobile · 49 pre-flight measurement ·
50 hashtag migration applied · 51 backfill verified · 53 typecheck/tests/build/screens

### Architecture, atomicity and platform (#14–#33)

14 stack versions + pin determinism · 15 feed rendering/memory/caching/leaks ·
16 media lifecycle + upload reliability + main thread · 17 realtime/errors/observability
· 18 data contract, SQL, pagination, privacy, RLS, indexes · 19 production bundle
measurement · 20 audit report with per-finding verdicts · 21 media-engine DDL from
production · 22–25 B4 atomicity harness, matrix proof, gap closure, artifact ·
26 gesture-back · 27 3-column profile grid · 28 back button · 29 plan docx update ·
30 transport 8 files · 31 session-loss recorder · 32 activity_logs flood ·
33 token-refresh abort exemption

### Session start and image-delivery measurement (#1–#13)

1 read 5 canonical handover docs · 2 Supabase connector + newest migration ·
3 Chrome connector + tabs · 4 origin/main HEAD + tree · 5 status/pickup/risks ·
6–10 PostMedia/cdnImage read, slot widths mapped, measured in browser, host transform
check, derivative-size proposal · 11 posts schema/feed RPC/RLS pre-flight ·
12 upload pipeline read · 13 Phase 1 plan + migration and rollback SQL

---

## C. WHAT THE OPEN ITEMS MEAN FOR PHASE PLANNING

- **None of the 11 open items blocks Phase 2 closure.** Phase 2's only remaining
  blocker is D-002/D-003 (external).
- **#44–#47, #54, #55 belong to Phase 3A/3B** (product engine + real device) — they are
  device-observable UI bugs and should be folded into the Phase 3 device matrix rather
  than fixed ad hoc.
- **#34 (composer) and #52 (typeahead)** are product features, not gates.
- **#87 and #91 should be formally closed** in the next session after a short
  confirmation — the work exists and is mutation-locked; only the bookkeeping is open.
