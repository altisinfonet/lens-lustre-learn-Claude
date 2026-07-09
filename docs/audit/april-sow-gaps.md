# April SOW — Compliance Gap Analysis (v4 — FINAL)

**Source:** `April_New_Judge_SOW_-_Complete-17.docx` (9 pages, parsed 2026-04-18, **word-by-word re-read**)
**Audit date:** 2026-04-18 (v4.1 — C-1 correction)
**Audit depth:** Code-grep + DB schema + RLS policies + edge-function inspection + SQL probe + performance hotspot scan
**Verdict scale:** ✅ **PASS** · ⚠️ **PARTIAL** · ❌ **FAIL**
**Severity:** 🔴 **Critical** · 🟠 **High** · 🟡 **Medium** · 🔵 **Low**

> **v4 → v4.1 delta (live DB probe 2026-04-18):**
> **C-1 reclassified ❌ FAIL → ✅ PASS.** Live `pg_policies` probe shows the policy `"Authenticated can view admin roles"` filters on `(role = 'admin'::text)` — NOT judge. Judge rows are protected by `"Public can view non-sensitive roles"` (excludes `judge`/`admin` from public) + `"Admins can view all roles"` + `"Users can view own roles"`. **No authenticated non-admin client can read `role='judge'` rows.** v4 audit incorrectly conflated admin and judge in this policy. Stakeholder elected to keep admin visibility unchanged. Net Critical drops 5 → 4; FAIL 12 → 11; PASS 37 → 38.
>
> **v3 → v4 delta (stakeholder correction received 2026-04-18):**
> **R4 awards rule corrected.** Winner is **MANDATORY** to declare R4 final. 1st RU and 2nd RU are **OPTIONAL** (no cap on count). Previous v3 reading ("all awards optional") was wrong. C-6 is rewritten and **demoted Critical → High (H-12)**.

---

## Summary scoreboard (v4.1)

| Phase | Rules | ✅ PASS | ⚠️ PARTIAL | ❌ FAIL |
|---|---:|---:|---:|---:|
| Stage 1 — Setup | 9 | 7 | 2 | 0 |
| Global rule | 1 | 0 | 0 | 1 |
| Submission Period | 8 | 5 | 2 | 1 |
| Round 1 | 11 | 6 | 3 | 2 |
| Round 2 | 12 | 5 | 4 | 3 |
| Round 3 | 11 | 4 | 5 | 2 |
| Final Round (R4) | 12 | 6 | 4 | 2 |
| Sidebar / Layout | 7 | 5 | 2 | 0 |
| **Totals** | **71** | **38 (54%)** | **22 (31%)** | **11 (15%)** |

**🔴 Critical: 4** · **🟠 High: 12** · **🟡 Medium: 5**

---

## 🔴 Critical findings (4)

### ~~C-1~~ — RECLASSIFIED ✅ PASS (2026-04-18 live DB probe)
**SOW (page 1, line 15):** *"Any user wont see in any way WHO is the Judge … Only Judge Role Only visible to Admin and Judge Only"*
**Live `pg_policies` evidence (probed 2026-04-18):**
- `"Authenticated can view admin roles"` → `qual = (role = 'admin'::text)` — **does NOT match `judge`**
- `"Public can view non-sensitive roles"` → `qual = (role <> ALL (ARRAY['judge','admin']))` — public cannot read judge
- `"Admins can view all roles"` → admin-only via `has_role()`
- `"Users can view own roles"` → self only
**Conclusion:** No authenticated non-admin client can read `role='judge'` rows. Judge identity is protected at the RLS layer. v4 audit was incorrect.
**Verdict:** ✅ PASS · — · No migration required.

### C-2 — Auto-tier scoring not implemented
**SOW R2 (line 100):** 0→Needs Review · 1-6→Qualified for R2 · 7-10→Qualified for R3
**SOW R3 (line ~135):** 0→Needs Review · 1-6→Qualified for R3 · 7-10→Shortlisted Final
**SOW R4 (line 176, clarified):** 0→Needs Review · 1-6→Qualified for Final · 7-10→Award-eligible
**Evidence:** `Round2DecisionPanel.tsx` exposes only manual buttons; no DB trigger or hook derives status from `judge_scores` average.
**Verdict:** ❌ FAIL · 🔴 Critical
**Fix:** DB trigger on `judge_scores` UPSERT → compute avg of 10 criteria → write `judge_decisions.decision` per the per-round table.

### C-3 — Engagement (comments/likes/reactions) not blocked at data layer during voting/judging
**SOW (page 2, line 33):** *"No Comments, No Likes and other reaction tab will be visible in this period on each image."*
**Evidence:** UI hides badges via `EntryCard.tsx:60`, but `image_reactions` / `image_comments` accept INSERT during voting/judging phases.
**Verdict:** ❌ FAIL · 🔴 Critical
**Fix:** RLS WITH CHECK referencing `competitions.phase NOT IN ('voting','judging')`.

### C-4 — Public per-judge score view missing
**SOW (page 1, line 22):** *"any marks given by Judge will be visible to public. Only after final declaration on each round not instantly"*
**Stakeholder clarification:** **per-judge per-criterion** (all 10 sliders × every judge) once round is declared. Judge name still hidden (display as "Judge 1", "Judge 2" …).
**Evidence:** `judge_scores` RLS = judges + admin only; no public view exists.
**Verdict:** ❌ FAIL · 🔴 Critical
**Fix:** Create `public.public_round_scores` view exposing `entry_id, round_number, anonymized_judge_label, line, shape, … depth, average` WHERE the round's `judging_completed = true`.

### C-5 — Certificate flow auto-only; SOW requires "Request to Download"
**SOW (lines 58, 83, 120, 160):** *"Certificate can request for Download. PDF Copy Certificate will be Auto Generate and visible to his/her section"*
**Evidence:** `Certificates.tsx:62` auto-creates row on page open; no explicit "Request" CTA.
**Verdict:** ❌ FAIL · 🔴 Critical
**Fix:** Show eligibility automatically; gate PDF render + `file_url` write behind a "Request Certificate" button click.

---

## 🟠 High finding — H-12 (rewritten from former C-6) — ✅ DONE 2026-04-18

### H-12 — R4 award enforcement over-restricts (Winner mandatory only) — ✅ FIXED
**SOW R4 (line 180):** *"If no images found in Needs Review, then Judge Click the Button Final Round Judging Declared but if a single image found there marked, this option will not active"*
**Stakeholder correction (2026-04-18):** **Winner is MANDATORY** before R4 can be declared final. **1st RU and 2nd RU are OPTIONAL** (no cap on RU count).
**Original evidence:** `complete-round/index.ts:17` `REQUIRED_AWARDS = ['winner','1st runner up','2nd runner up']` returned 422 if any of the three was missing — over-blocked.
**Resolution applied:**
- `REQUIRED_AWARDS = ['winner']` only.
- `UNIQUE_AWARDS = ['winner']` only — RU slots uncapped (admin may assign multiple RU entries).
- Needs-Review-zero hard block remains (R1/R2/R3 paths block needs_review; R4 entry pool is pre-filtered finalists from R3).
- Winner-zero now returns **422** with message: *"Winner must be assigned before declaring Round 4 final. 1st/2nd Runner-Up are optional."*
**Verdict:** ✅ PASS


---

## Stage 1 — Setup

| # | SOW rule (verbatim, abridged) | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-001 | "Create Competition (From Date and End Date) – DONE" | `competitionService.ts` | ✅ | — |
| R-002 | "Submission End Date and Voting End Date separately" | `competitions.ends_at` + `voting_ends_at` | ✅ | — |
| R-003 | Two periods + Vote Count time shown separately | `CompetitionDetail.tsx` | ✅ | — |
| R-004 | Tags: Top 100, Top 50 etc. | `judging_tags` + `AdminJudgingTags.tsx` | ✅ | — |
| R-005 | Tag → which round visible | `judging_tags.visible_in_round int[]` | ✅ | — |
| R-006 | "Any Tag wont visible to **judge** in any round which is not applicable" | `useJudgeRounds.ts:30` filter; not asserted in R1 panel | ⚠️ PARTIAL | 🟡 |
| R-007 | "Each Competition will have **Fix 4 Round** … existing Feature of creating Round … is not required" | Default-4 in `competitionService.ts:68`; admin Add/Delete Round UI still present | ⚠️ PARTIAL | 🟠 |
| R-008 | Admin selects judge during competition creation | `competition_judges` + `CompetitionsModule.tsx` | ✅ | — |
| R-009 | Judge identity hidden from public | Live RLS probe — judge rows blocked from public + non-admin authenticated (see reclassified C-1) | ✅ | — |

## Global Rule

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-GLB | Marks public ONLY after final declaration each round (per-judge per-criterion) | C-4 | ❌ | 🔴 |

## Stage 1 — All Users / Judge

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-010 | No submit before/after dates; read-only | `CompetitionSubmit.tsx:303` | ✅ | — |
| R-011 | Judge sees Upcoming Competition once Admin creates | `useJudgeCompetitions.ts:10` `JUDGE_VISIBLE_PHASES` includes `submission_open` | ✅ | — |

---

## Submission Period

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-012 | Admin sees entries + Vote Audit (admin-only) | `AdminVoteAuditPanel.tsx` | ✅ | — |
| R-013 | Vote Audit columns: Photographer / Date / Preview / Search | Verified | ✅ | — |
| R-014 | Click adjustment column → inline edit | Verified | ✅ | — |
| R-015 | All Users vote on all images | `useCompetitionVoting.ts` | ✅ | — |
| R-016 | Photo-Competitor cannot vote on OWN | `toggle-competition-vote/index.ts:60` | ✅ | — |
| R-017 | No Comments / Likes / reactions during this period | C-3 | ❌ | 🔴 |
| R-018 | "Each Photo Must Have EXIF Data Section" | `CompetitionSubmit.tsx:505` only when AI-override; SOW says always | ⚠️ PARTIAL | 🟠 |
| R-019 | Disclaimer "I am submitting from my original Profile and I own RAW…" | `CompetitionSubmit.tsx:652-694` | ✅ | — |
| R-020 | Judge sees Submissions only; Start Judging disabled | `CinemaJudgeView.tsx:678-680` | ✅ | — |
| R-021 | After Voting Count Date end → Start Judging enables | `StartJudgingPrompt.tsx` phase-gated | ✅ | — |
| R-022 | Judging always Full Screen; Grid/List view-only | `CinemaJudgeView.tsx:195` | ✅ | — |

---

## Round 1

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-023 | Banner "Judging Going On"; vote counts hidden; voting disabled | `CompetitionDetail.tsx:189` + `EntryCard.tsx:60` | ✅ | — |
| R-024 | Needs Review / Accept / Reject / Shortlisted for R2 | `Round1DecisionPanel.tsx:27` | ✅ | — |
| R-025 | "No Tags will be visible in this time" | `useJudgeRounds.ts` filter | ✅ | — |
| R-026 | Keyboard a / r / n / s | `Round1DecisionPanel.tsx:31-55` | ✅ | — |
| R-027 | "No Marks option will open in this time" | `useJudgeClassicData.ts:29` returns "decision" mode for R1 | ✅ | — |
| R-028 | "Judge can update marks anytime till declaring" (R1: clear decisions) | Bulk path not unit-tested | ⚠️ PARTIAL | 🟡 |
| R-029 | After R1 declared: Accepted/Rejected unchanged; only Needs Review editable | `complete-round/index.ts:215` lockRound | ✅ | — |
| R-030 | R1 Declared button disabled while Needs Review > 0 | `complete-round/index.ts:264-271` returns 409 | ✅ | — |
| R-031 | Competitor sees Needs Review / Accepted / Rejected / Move to R2 | `SubmissionDetail.tsx` | ✅ | — |
| R-032 | If Needs Review → check mail | No `needs_review_user_notice` template / trigger | ❌ | 🟠 |
| R-033 | If Accepted → certificate "**can request for Download**" | C-5 | ❌ | 🔴 |

---

## Round 2

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-034 | Banner / vote-count hide / voting disabled | Same gating as R1 | ✅ | — |
| R-035 | "Round 1 Judging but can not change anything as Declared" | `JudgeRoundSidebar.tsx:283` `isViewOnly` | ✅ | — |
| R-036 | "Only Shortlisted for Round 2 images will shown" | `useJudgeClassicData.ts:194-198` | ✅ | — |
| R-037 | Needs Review / Qualified for R2 / Shortlisted for R3 + tags | `Round2DecisionPanel.tsx:7` | ✅ | — |
| R-038 | "Tags can assign by Judge this time" (100% manual) | `CinemaFullView.tsx:298` | ✅ | — |
| R-039 | 10 criteria sliders Line…Depth | `judge_scores` columns — all 10 present | ✅ | — |
| R-040 | "Slidebar along with small box to give marks manually" | `CinemaFullView.tsx:958-983` | ✅ | — |
| R-041 | 0→Needs Review · 1-6→Qualified for R2 · 7-10→Qualified for R3 | C-2 | ❌ | 🔴 |
| R-042 | Tag updates auto-publish to Photographer status | Placement labels verified; tag-derived labels unverified | ⚠️ PARTIAL | 🟡 |
| R-043 | Clear marks until declared | criterion-level clear unverified | ⚠️ PARTIAL | 🟡 |
| R-044 | After R2 declared: Qualified/Shortlisted unchanged; only Needs Review editable | `complete-round/index.ts:357-363` | ✅ | — |
| R-045 | R2 Declared blocked while Needs Review > 0 | Same 409 block | ✅ | — |
| R-CERT2 | "Qualified for R2 + Top 100 → Certificate can request for Download" | C-5 | ❌ | 🔴 |
| R-MAIL2 | Needs Review → check mail | Missing | ❌ | 🟠 |

---

## Round 3

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-046 | Banner / vote / count gating | Same | ✅ | — |
| R-047 | "Round 1 and 2 Judging but can not change anything" | `isViewOnly` | ✅ | — |
| R-048 | "Only Shortlisted for Round 3 images will shown" | `useJudgeClassicData.ts:194-210` | ✅ | — |
| R-049 | Needs Review / Qualified for R3 / Shortlisted for Final + Top 50 | `Round3DecisionPanel.tsx` | ✅ | — |
| R-050 | 10 criteria sliders | Same `judge_scores` | ✅ | — |
| R-051 | 0→Needs Review · 1-6→Qualified for R3 · 7-10→Shortlisted Final | C-2 | ❌ | 🔴 |
| R-052 | Top 50 manual tag | Tag system supports | ✅ | — |
| R-053 | Clear marks until declared | Same as R2 | ⚠️ PARTIAL | 🟡 |
| R-054 | After R3 declared: only Needs Review editable | `complete-round` lockRound | ✅ | — |
| R-055 | R3 Declared blocked while Needs Review remains | Same 409 | ✅ | — |
| R-056 | Competitor sees Qualified for R3 / Top 50 / Move to Final | `SubmissionDetail.tsx` — label inconsistent | ⚠️ PARTIAL | 🟡 |
| R-CERT3 | Certificate "request for Download" for Qualified R3 + Top 50 | C-5 | ❌ | 🔴 |
| R-MAIL3 | Needs Review → check mail | Missing | ❌ | 🟠 |

---

## Final Round (R4)

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-057 | Banner / vote / count gating | Same | ✅ | — |
| R-058 | Judge sees R1+R2+R3 read-only | Same | ✅ | — |
| R-059 | Only Shortlisted-for-Final shown | Same | ✅ | — |
| R-060 | Statuses: Needs Review / Qualified Final / Special Jury / Winner / 1st RU / 2nd RU / Honorary Mention | `complete-round/index.ts:7-14` | ✅ | — |
| R-061 | **R4 declare blocker = Needs Review = 0 AND Winner assigned. RU1/RU2 optional.** | H-12 — code currently demands all 3 awards | ❌ | 🟠 |
| R-062 | Unique-award constraint relaxed: exactly one Winner; RU count uncapped | `complete-round/index.ts:20` UNIQUE_AWARDS over-restricts RUs | ⚠️ PARTIAL | 🟡 |
| R-063 | 10 criteria sliders | Same | ✅ | — |
| R-064 | **0→Needs Review · 1-6→Qualified for Final · 7-10→Award-eligible** *(stakeholder-clarified)* | C-2 | ❌ | 🔴 |
| R-065 | After R4 declared: only Needs Review editable | `complete-round/index.ts:437-443` | ✅ | — |
| R-066 | R4 Declared blocked while Needs Review remains | Same 409 | ✅ | — |
| R-067 | Certificate "request for Download" for all R4 award statuses | C-5 + missing trigger row | ❌ | 🔴 |
| R-068 | Needs Review → check mail | Missing | ❌ | 🟠 |

---

## Sidebar / Layout (Pages 7–8)

| # | Rule | Evidence | Verdict | Sev |
|---|---|---|---|---|
| R-069 | R1 sidebar: Accepted, Shortlisted R2, Needs Review (auto-empty), Rejected (auto-empty) | `JudgeRoundSidebar.tsx:49-55` | ✅ | — |
| R-070 | R2 sidebar: Qualified (1-6), Shortlisted R3 (7-10), Needs Review, Eliminated | Labels updated to `Qualified for R2 (1-6)` / `Qualified for R3 (7-10)` / `Needs Review (0)` in `JudgeRoundSidebar.tsx` + score-tier fallback in `JudgePanel.roundFilterCounts`/`filteredPhotos` | ✅ DONE | — |
| R-071 | R3 sidebar: Qualified (1-6), Shortlisted Final (7-10), Needs Review, Eliminated; same score-tier filter applied across R2/R3/R4 | Labels + score-tier classifier (`tierFromScore`) live in `JudgePanel.tsx`; counts mirror filter | ✅ DONE | — |
| R-072 | R4 sidebar: Winner / 1st RU / 2nd RU / Honourable Mention / Special Jury / Needs Review (auto-empty) | `JudgeRoundSidebar.tsx:81-84` buckets present | ✅ | — |
| R-073 | Auto-empty Needs Review / Rejected after round completes | `hideWhenZero: true` + `complete-round` zeroes count | ✅ | — |
| R-074 | Result Summary Bar: Total / Accepted / Rejected / Needs Review | `JudgeProgressPanel.tsx` | ✅ | — |
| R-075 | Locked rounds shown with 🔒 | `JudgeRoundSidebar.tsx:283` | ✅ | — |

---

## ⚡ Performance hotspot appendix (new in v4)

Goal: every panel loads in **one DB round-trip**. Aggregations live in **triggers**, not the client.

| # | Hotspot | Current cost | Target fix |
|---|---|---|---|
| P-1 | `CompleteRoundDialog.tsx:49-90` | **4 sequential `count` queries + 1 entries fetch + 1 score-cache fetch = 6 round-trips** | Single RPC `get_round_summary(competition_id, round_number)` returning `{total, qualified, rejected, needs_review, pending, top10[]}` |
| P-2 | `AdminCompetitionRounds.tsx:73-86` | Fetches every entry's status into client to count | RPC `get_competition_round_stats(competition_id)` returning aggregated row |
| P-3 | `entry_score_cache` updates | Currently maintained by edge function on score write | Move to AFTER INSERT/UPDATE trigger on `judge_scores` (zero edge-fn cold-start) |
| P-4 | Round status derivation (C-2) | Not implemented — would otherwise be client-side | DB trigger writes `judge_decisions` + `competition_entries.status` automatically |
| P-5 | Public score view (C-4) | N/A — feature missing | View is pre-computed; client does single SELECT |
| P-6 | Sidebar bucket counts | Multiple count queries per render | Same `get_competition_round_stats` RPC; bucket shape returned in one JSON object |
| P-7 | `useUserRoles.ts` | One query per session (already cached 5 min) | OK — already optimal |

**Mandate going forward:** No new feature ships if it adds >1 query to a panel load. RPCs only.

---

## Cross-cutting findings

- Snapshot recovery present (`round_snapshots`).
- No DB CHECK preventing >4 rounds per competition (R-007).
- `competitions.judging_completed` is the source of truth for `result` phase.
- Vote count hidden during judging (`EntryCard.tsx:60`).
- `toggle-competition-vote/index.ts` rejects when phase ≠ `voting`.
- No public-facing per-judge score view post-declaration (R-GLB / C-4).
- Certificate generation lacks "Request" CTA (C-5).
- R4 award enforcement over-restricts: demands 3 awards instead of 1 (H-12).

---

## Remediation priority queue (v4) — atomic micro-steps

Per stakeholder mandate: **1 file/concern per step · audit between · DB-first performance · zero cross-impact.**

| Step | Item | Touches | Maps to |
|---|---|---|---|
| ~~1~~ | ~~C-1 — Lock down `user_roles` SELECT RLS~~ | **DROPPED** — live probe shows judge already protected | — |
| ✅ **1** | C-4 part 1 — `get_public_round_scores(competition_id, round_number)` RPC (SECURITY DEFINER, gated on `judging_rounds.status='completed'`, anonymized "Judge N" labels, all 10 criteria + average) | 1 migration ✅ DONE 2026-04-18 | New B3.5 |
| ✅ **2** | C-4 part 2 — Render reveal in `EntryDetail` (public per-judge per-criterion table per completed round, RPC self-gates) | 1 new component + 1 mount line ✅ DONE 2026-04-18 | New B3.5 |
| **3** | C-3 — RLS WITH CHECK on `image_reactions`/`image_comments` during voting+judging | 1 migration | B2 / Step 7 |
| ✅ **4** | C-2 — Auto-tier trigger on `judge_scores` (R2 → qualified/shortlist; R3 → qualified/shortlist; R4 → qualified/finalist; 0 avg → needs_review) ✅ DONE 2026-04-18 | 1 migration ✅ DONE | New B2.7a |
| ✅ **5** | C-5 — Eligibility shown automatically; row insert + PDF gated behind "Request Certificate" CTA (no auto-insert on page load) ✅ DONE 2026-04-18 | 1 component ✅ DONE | New B4.2 |
| ~~6~~ | ~~C-5 part 2~~ — Merged into Step 5 (single-file fix; no schema change required: `file_url` is null today and PDF is generated client-side on click) | — | — |
| **7** | **H-12** — Fix R4 enforcement: `REQUIRED_AWARDS = ['winner']` only; relax RU cap | 1 edge function | New B3.6 |
| **8** | P-1 — `get_round_summary` RPC + wire into `CompleteRoundDialog` (kills 6 round-trips → 1) | 1 migration + 1 component | Perf |
| **9** | P-3 — Score-cache AFTER trigger on `judge_scores` | 1 migration | Perf |
| **10** | R-070 / R-071 — Sidebar bucket labels + score-tier filter | 1 component | B6 / Step 28 |
| **11** | Tag-name alignment ("Round 3 Qualified" → "Finalist") | 1 component | ✅ DONE — R3 7-10 bucket label now "Finalist (7-10)" matching `Round3Decision`, `entry.status === "finalist"`, certificate type, and badge terminology across the codebase |

### Per-step audit checklist (applied to every step)
1. ✅ TypeScript build passes
2. ✅ `supabase--linter` shows no new warnings
3. ✅ RLS regression: re-run security scan, no new findings
4. ✅ Runtime probe: hit affected page in preview, check console + network
5. ✅ Memory updated if business rule changed
6. ✅ Rollback SQL noted in step summary

---

*v4.1 final · 71 rules · 38 PASS · 22 PARTIAL · 11 FAIL · 4 critical · 12 high.*
*v4 → v4.1 delta: C-1 reclassified ❌ FAIL → ✅ PASS via live `pg_policies` probe. Judge identity protected at RLS layer; v4 misread admin policy as judge. Remediation queue Step 1 dropped; Steps 2-12 renumbered to 1-11.*
