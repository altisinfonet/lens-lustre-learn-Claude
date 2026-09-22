# PHASE 1 — CLOSURE AUDIT · REVISION 5

**Type:** READ-ONLY. Nothing was modified.
**Date:** 2026-08-21, production state as at ~11:50 UTC · **Session:** claude-opus-5 (Cowork)
**Supersedes** Revisions 1–3. Rev 1's Finding A is **RESOLVED**; Rev 2 added Findings E and F;
Rev 3 added Finding G from Control Cycle 1; **Rev 4 closes the open questions in Findings B and C
by reading the function and view bodies directly from the database** — which Rev 2 and Rev 3
wrongly said required repository access. They did not. That was my error, corrected here.
**Governing source:** `MASTER_EXECUTION_PLAN_FINAL_2026-08-21.md`, Parts III and IX.
**Repo HEAD (owner-asserted, not independently verified):** `c737de9e9e57dd50b6a49a30f503006a6023a3ac`.

---

## 0. INSTRUMENTS

| Evidence class | Available | Note |
|---|---|---|
| Production database | **YES** | Supabase MCP, read-only. Project `jtdtehuqtinjxropkkcn` / `50mmretinaworld`, `ACTIVE_HEALTHY`, PG 17.6.1.141 |
| Prior project reports | **YES** | 17 documents supplied: Control Cycles C1–C6, DECISIONS, D003 spec + handover, BUILD 1106, B3d-IMG, CDN measurement, EXIF session, four-gates session, permanent exclusions |
| Repository source at HEAD | **NO** | Chrome connector not enabled in this session |
| Test suites / mutation harnesses | **NO** | Requires repository |
| CI run history | **NO** | Requires GitHub |
| Physical device | **NO** | OWNER |

✅ `PHASE1_C1_CONTROL_RECONCILIATION_20260817.md` has now been supplied and read. It bears on
rows 5, 7 and 11, and raises one item that has **no row in the Master Plan at all** — Finding G.

**Staleness rule:** evidence predating the PR #85 merge (`d7be172`) is marked `STALE — reverify`.

---

## 1. THE AUDIT TABLE

| # | Criterion | Status (plan) | Evidence located | Production verification (this session) | Test / mutation | Blocker | Action required |
|---|---|---|---|---|---|---|---|
| 1 | Emergency resumed-draft posting blocker | COMPLETE | **BUILD_1106 doc — full root cause, the exact `usePostDrafts.ts:80` line, runtime + mutation results (3 of 4 fail on the old line, 4 of 4 pass on the fix)** | INDIRECT. `post_drafts` RLS on, 3 own-row policies, `trg_enforce_post_draft_rules` present | Recorded in BUILD_1106; not re-run here | Repo access | Confirm the test still exists and is green at HEAD |
| 2 | Hashtag security gate | COMPLETE | BUILD_1106 doc, migration `20260817102540` | **✅ CONFIRMED — full match to the doc's post-migration table.** `recount_hashtags`: anon **false**, authenticated **false**, postgres **true**. `suggest_hashtags`: anon **false**, authenticated **true**. FK `post_hashtags_author_id_fkey` **present, convalidated, ON DELETE CASCADE**. `anon` on `hashtags`/`post_hashtags` = `REFERENCES,SELECT,TRIGGER,TRUNCATE` — writes revoked | PENDING — no repo | — | **Production half is closed.** Only repo-side regression-test confirmation remains |
| 3 | Android build pipeline | COMPLETE | four-gates doc: gate 4 observed working — Build #107 red at gate, `build-aab` skipped 0s; #110 green | N/A | PENDING — no CI | GitHub | Confirm runs 110/111 artifacts |
| 4 | Duplicate migration versions | RESOLVED | **C3 + C4 + C5: both collisions identified, dependency-analysed, renamed under the verified transport (`88c3766`, `bfe7ad3`, `99a56da`), 0 duplicates on origin** | **✅ CONFIRMED** — server ledger holds **0 duplicate versions** | Recorded in C5 | — | **Closable.** Ledger and repo both show zero duplicates |
| 5 | Unsafe dependency-install fallback | COMPLETE (INFO) | **C1: this was ALREADY TRUE when the plan item was written — all three workflows run `npm ci --no-audit --no-fund`; no `npm install`, no `\|\| true`. C1 reported it as a plan-vs-repository conflict rather than ticking it.** Plus four-gates doc: `--with-deps` dropped after 1107/1109 hung on apt | N/A | PENDING — no repo | GitHub | **STALE — reverify** at HEAD. The item was never a defect; confirm it is still true |
| 6 | EXIF/GPS protection | PARTIAL | **2026-08-14 session: raw-caller inventory CLOSED, `FileUploadDropZone` was the last raw door, `guardOriginalUpload` fail-closed, 2 mutations caught** | Not verifiable from DB — stripping is a client-side canvas re-encode | Recorded 08-14; not re-run | Repo + OWNER device | **STALE — reverify** (7 days pre-HEAD). Re-audit at HEAD + device check under G10 |
| 7 | Historical ledger baseline | DEFERRED | **C1 states the choice: (a) baseline the ledger, or (b) leave it post-2026-08-13 and pin "never run db push" in CI. C2 §D1.7 records (b) as REJECTED under owner rule 7 — a safety control, not an architecture. C4/C5/C6 then fully specify (a): 599-row metadata-only INSERT, exact rollback, before/after schema snapshot, 38-file exception list characterised** | Ledger = **32 rows**, `20260813171159`→`20260820181949`. See Finding A | C5 proves metadata-only by statement form | **2 RED files (C6)** | **Unblocked but gated.** Option (a) is the standing direction. Do not baseline `20260429071225` or `20260504132638` — see rows 8 and 9 |
| 8 | Mirror-trigger `20260429071225` | OPEN — **Judging Panel scope: excluded from current Phase-1 execution with Row 9 (see §7 deferral note)** | **C6 file 7 — RED.** The migration drops `_ins` and `_del`; nothing recreates them; production still has both | **✅ STILL TRUE, and worse than recorded — see Finding B.** Both triggers present, and their event coverage overlaps the combined trigger | Not covered | Owner decision | Decide whether the two triggers are wanted. **Do not drop in an audit** |
| 9 | Anonymous judging grants `20260504132638` | **DEFERRED — SEPARATE JUDGING PANEL SECURITY/INTEGRITY WORKSTREAM (owner instruction, 2026-08-21)** | **C6 file 9 — RED, 27 write grants across 9 tables measured 2026-08-17** | **MIXED — grants unchanged, RLS hardened since, and a new ERROR-class finding. See Finding C** | Not covered | Repo + owner decision | Re-apply deliberately as a security cycle with both-sides tests |
| 10 | B3d-IMG-1 image delivery | OPEN | **PLAN_B3d-IMG + CDN measurement: scope split (B3d-IMG-1 = reqs 1,2,3,4,5,9,10,14), baselines measured, DONE definition fixed** | N/A | Regression alarm specified, not built | Repo + OWNER device | Now fully scoped. ⚠ Correction C: the resolver **must not be called privacy-preserving** until D-002 closes |
| 11 | Strict TypeScript cleanup | PARTIAL | **C1 corrects what "CI green" means: `typecheck.yml` does check source (`include: ["src"]`), but with `strict: false`, `noImplicitAny: false`, `noUnusedLocals: false` — it checks the source WEAKLY. C2 D3 then measures the gap: 49 errors / 29 files under strict, mostly null-vs-undefined; worst `WallPosts.tsx` (9)** | N/A | PENDING — no CI | GitHub | **STALE — reverify** at `c737de9`. Note the plan's "CI green" is true but weaker than it reads |
| 12 | Realtime / feed / pagination certification | OPEN | architecture audits (not supplied) | Baseline captured: `supabase_realtime` = **29 tables**; public schema 146 tables / 10 views / 1 matview | PENDING | **Plan-level circular dependency** | See §4 — owner ruling required |
| 13 | Physical-device Phase-1 journey | OPEN | — | N/A | N/A | OWNER | Device session under G10 |

**Closable now:** 4 (and 2, once the repo confirms its tests).
**Unblocked by the Control Cycle documents:** 1, 5, 6, 7, 10, 11 — all now need only repo/CI/device.
**Still needing an owner decision:** 8, 9, 12, 13.

---

## 2. FINDINGS

### FINDING A — RESOLVED. The 32-row ledger is correct and expected.

Rev 1 flagged this as unexplained. **C2 §D1.1 explains it completely:**

> The ledger records a migration **only when it is applied through Supabase's own tooling**…
> Everything before it was applied by the earlier **Lovable pipeline**, which executes SQL
> directly and does not write to that table. The migrations ran; nothing recorded that they ran.

The arithmetic reconciles exactly:

| | C2 (08-17) | C5/C6 (08-17, corrected) | This session (08-21) |
|---|---|---|---|
| Git `.sql` files | 615→618 | **618**, 618 unique versions | not visible (no repo) |
| Ledger rows | 19 | 19 | **32** |
| Git-only (unrecorded) | 596/597 | **599** | — |
| Duplicate versions | 2 | 0 (after rename) | **0 ✅** |

19 → 32 is **13 migrations applied through the connector since 2026-08-17**, which is what the
August workstreams did. **No discrepancy. Nothing is missing.**

**On the "229": the Master Plan's wording is misleading and should be corrected.**
Standing rule 2 reads *"the frozen 229-migration fence"*. No document counts 229 SQL migrations
— they count 618 files / 599 unrecorded / 19→32 ledger rows. The D-003 specification uses 229
twice, and both times it means **media objects**: *"PUBLIC media (today's 229 objects)"* and
*"Nothing about the 229 live images changes"*. The fence is therefore almost certainly the
**229-object media-migration fence**, not a SQL-migration fence.
**Stated as a strong reading, not a fact** — confirming it needs the manifest files in the repo.
Recommend the plan's rule 2 be reworded once confirmed, because as written it invites exactly
the alarm Rev 1 raised.

**Verdict:** rows 4 and 7 are unblocked. Row 4 is **closable**. Row 7 is a well-specified,
unexecuted 599-row baseline whose preconditions C5 and C6 already state — and two of which
(the RED files) are rows 8 and 9 below.

### FINDING B — the mirror trigger double-fires. Origin identified; the defect is larger than recorded.

- **Claim:** Part III row 8 — finding recorded, unresolved.
- **Origin (C6 file 7):** `20260429071225` issues
  `DROP TRIGGER IF EXISTS trg_mirror_system_tag_to_decision_ins` and `…_del`.
  Only `20260425045036` creates them; nothing in Git recreates them. C6 could not separate
  "never ran" from "applied in commit order, so the DROP preceded the CREATE".
- **Result today (`pg_trigger`, `tgtype` decoded):** both are still present, four days on, and
  the picture is sharper than C6 recorded — **all three call the same function, with overlapping
  events and no `WHEN` clause**:

  | Trigger | Timing | Events |
  |---|---|---|
  | `trg_mirror_system_tag_to_decision` | AFTER | INSERT, DELETE, UPDATE |
  | `trg_mirror_system_tag_to_decision_ins` | AFTER | INSERT |
  | `trg_mirror_system_tag_to_decision_del` | AFTER | DELETE |

  → `mirror_system_tag_to_decision` runs **twice on INSERT, twice on DELETE**, once on UPDATE.
- **Also confirmed:** `20260504143316` (C6 file 10, GREEN) did take effect — the legacy
  `tr_mirror_system_tag_to_decision` is **absent**. Only `trg_`-prefixed triggers exist. ✅
- **Verdict:** C6's RED stands and is now stronger. C6's own recommendation — *"needs a decision
  first: are those two triggers wanted today?"* — is still the correct next step, and the
  double-fire is new information bearing on it.
- **RESOLVED IN REV 4 — the double-fire is state-idempotent but log-duplicating.**
  `pg_get_functiondef` shows the function is SECURITY DEFINER, `SET search_path TO 'public'`, and
  every write it performs is idempotent: `INSERT … ON CONFLICT DO UPDATE` into `judge_award_tags`
  and `judge_decisions`, and `DELETE … WHERE` on the same keys. A second invocation in the same
  statement reaches the identical end state. It also re-raises on error (`RAISE WARNING … ; RAISE`
  — BUG-052), so a failure aborts rather than half-applying.
  **What is NOT idempotent is the audit trail.** Measured over `v3_mirror_log`:

  | trigger_op | action | rows | distinct sources | rows per source |
  |---|---|---|---|---|
  | INSERT | `upsert` | 6 | 3 | **2.00** |
  | INSERT | `r4_award_upsert` | 6 | 3 | **2.00** |
  | DELETE | `delete` | 107 | 107 | 1.00 |

  The INSERT path logs **exactly twice per source assignment** — the double-fire, measured, not
  inferred. The DELETE path currently shows 1.00; the trigger definitions say it should also
  double, so those 107 rows most likely predate the current topology. `v3_mirror_log` has **no
  `created_at` column**, so I could not date them to confirm.
- **Consequence, stated at its true size:** no data corruption. The cost is a doubled mirror audit
  log, which inflates any count-based reasoning over `v3_mirror_log` by 2× on the INSERT path.
  ⚠ It also means the **CG-2 replica harness may not reproduce production's trigger topology** — if
  the replica carries only the canonical trigger, its "mirror-only award writes" probe is testing a
  different system from the live one.
- **Abort condition:** resolution is still a gated migration with a captured rollback — never an
  ad-hoc `DROP TRIGGER`. But the urgency is **low**, and that is now evidence-backed.

### FINDING C — anon judging grants unchanged since 08-17; RLS hardened since; one new ERROR class.

- **Origin (C6 file 9):** `20260504132638` was to revoke anon write on 9 judging tables. Measured
  2026-08-17: **27 write grants remained**.
- **Result today — three parts:**
  1. **Grants: UNCHANGED.** All nine tables still carry `anon` `INSERT/UPDATE/DELETE`
     (`judge_decisions`, `judge_scores`, `judge_sessions`, `judge_tag_assignments`,
     `judging_config`, `judging_rounds`, `judging_tags`, `v3_mirror_log`, `v3_stage_catalog`).
     C6's measurement is reproduced exactly. The revoke's effect is still absent.
  2. **RLS: HARDENED SINCE C6 — by something this audit has not identified.** Policy counts have
     risen across the board, and a set of `"Deleted accounts cannot insert/delete/update"`
     policies now exists, all scoped to `authenticated`:

     | table | policies 08-17 (C6) | policies today |
     |---|---|---|
     | `judge_decisions` | 6 | **7** |
     | `judge_scores` | 7 | **8** |
     | `judge_tag_assignments` | 5 | **6** |
     | `judging_rounds` | 4 | **5** |
     | `judging_tags` | 4 | **7** |
     | `v3_mirror_log` | **0** | **≥1** |

     `v3_mirror_log` moving off zero matters: C6 relied on "RLS-on with no policy denies all
     writes" as that table's defence. It now has policy, so the deny-all reasoning no longer
     applies and its policy needs reading. **Which migration did this is unverified.**
     Across all 8 judging tables, **every** write policy today is scoped to `authenticated`;
     the only `anon` policy is one read (`judging_tags` / "Public can read R4 award tag
     definitions"), which is intentional.
  3. **NEW — in no supplied document: 4 ERROR-level `security_definer_view` advisories.**
     `public.entry_public_status`, `public.judge_decisions_owner_safe`,
     `public.judge_tag_assignments_owner_safe`, `public.judge_comments_owner_safe`.
     SECURITY DEFINER views **bypass RLS**, and `anon` holds privileges on all four. Three are
     judging views. Also `WARN materialized_view_in_api`: `public.entry_vote_counts` is
     anon/authenticated-selectable.
- **Verdict:** row 9 remains OPEN. C6's recommendation (re-apply the revoke deliberately, with
  authorized-and-unauthorized both-sides tests) stands, and part 3 adds a second sub-item that
  the 2026-08-17 cycle did not see.
- **RESOLVED IN REV 4 — the definer property is doing deliberate work, and the naming is honest.**
  `pg_get_viewdef` on all four:
  - `judge_decisions_owner_safe`, `judge_tag_assignments_owner_safe`, `judge_comments_owner_safe`
    each project a **narrow column set** and filter on
    `ce.user_id = auth.uid() AND crp.published_at IS NOT NULL` — i.e. *your own entry, in a round
    that has been published*. With no JWT, `auth.uid()` is NULL, the `EXISTS` is false, and the
    view returns nothing. They are competition-entrant read surfaces, and SECURITY DEFINER is
    required because RLS on the judging tables would otherwise block the read.
  - `entry_public_status` is a different animal by design: it filters
    `status = ANY(<public statuses>) OR has_role(auth.uid(),'admin')`, and every projected column
    is round-gated (`latest_published_round >= 4` for placements and R4 tags). It is an
    intentional public projection, not an accident.
  - All four are owned by `postgres`; three carry an explicit `security_invoker=false/off`
    reloption, `judge_decisions_owner_safe` relies on the default.
- ⚠ **The row-count check I ran is VACUOUS and I am not counting it as proof.** All four views
  returned 0 rows — but `competition_entries` also returns **0 rows**. The judging subsystem holds
  no live data at all, so "the filter returned nothing" and "there was nothing to return" are
  indistinguishable. A non-vacuous proof needs seeded data or the CG-2 replica.
- **Revised verdict on part 3:** the four ERROR advisories are **advisory-correct but, on the
  definitions, not exploitable**. The right response is **not** to flip them to `security_invoker`
  — that would break them. It is to record the design decision so the ERROR is not re-litigated at
  every audit.
- **Revised verdict on parts 1 and 2, with the same honesty:** the anon write grants are a real
  missing defence-in-depth layer over a subsystem that currently contains **zero rows**. That does
  not make the fix optional — it makes it cheap and low-risk to do now, before competitions run.

### FINDING D — advisor baseline (543 lints)

ERROR `security_definer_view` **4** (Finding C) · WARN `authenticated_security_definer_function_executable`
272 and `anon_security_definer_function_executable` 248 (**architectural — the SECURITY DEFINER RPC
design; not to be "fixed"**) · WARN `function_search_path_mutable` 9 · `extension_in_public` 1
(`plpgsql_check`) · `materialized_view_in_api` 1 · `auth_leaked_password_protection` 1 (OWNER
setting) · INFO `rls_enabled_no_policy` 7.

**Every base table in `public` has RLS enabled.** Seven have RLS with zero policies — deny-all,
therefore safe: `categories_migration_dropped`, `client_errors`, `contributor_engagement_daily`,
**`media_repair_audit`**, `member_activity_minutes`, `posts_dead_host_backup_20260812`,
`push_delivery_log`. ✅ The known trap's fix (`20260820181949`) is confirmed present and effective.

### FINDING E — ⚠ NEW. Live exposure is no longer zero. Three documents now state something false.

- **Claim under test:** D-003 spec §0 — *"0 posts with `privacy <> 'public'`, so live exposure
  remains zero"*; DECISIONS D-003 — *"All 254 production posts are `privacy = 'public'`, so live
  exposure is zero"*; D003 handover, same.
- **Result today:** `select privacy, count(*) from posts` → **public 260, private 1.**
  The private post is **`7eaf0ef8-ab5f-45ad-881d-1cc3f60d54a9`**, owner
  `cc691988-699f-4da5-9b2e-f2346c7303be`, created 2026-08-21 09:51:37 UTC — **the Android
  acceptance post recorded in Master Plan §4.1.** It carries 1 `post_media` row, an idempotency
  key, and 1 `image_urls` entry.
- **Verdict:** the practical risk is **low** — it is the owner's own test photograph, not a
  member's. But the documents' factual claim is now **false**, and D-002's disclosed gap has gone
  from hypothetical to instantiated: that photograph is fetchable by anyone holding its URL.
- **Action:** correct the sentence in D-003 (register + spec + handover) to name the one post,
  rather than leaving three documents asserting zero. Master Plan §4.1 already records the post
  as private, so the plan is not wrong — only the D-003 set is.
- **Note:** the owner-action list already includes deleting a WS2 test post; **this is a
  different post and is the Android acceptance evidence — it must NOT be deleted**, or the
  Phase-2 acceptance row loses its correlated production row (G1).

### FINDING F — ⚠ NEW. A fourth legacy-only post, created after the plan was frozen, with no instrumentation.

- **Claim under test:** Master Plan §4.1 (G4) — *"the tail of old builds produced 3 legacy-only
  posts in the current 24h window (18:16, 06:18, 06:43)"*.
- **Result:** there are now **four**. New: **`5602621c-93d4-402b-a5f4-05be1d96074f`**,
  2026-08-21 **10:30:29 UTC**, user `ba812284-794b-49e3-a689-9bf26ba1159f`, **0 `post_media`
  rows, no idempotency key** — created **28 minutes after the Master Plan was written**
  (10:02:39Z) and 38 minutes after the Android acceptance.
  The same member produced the 18:16 and 06:43 legacy-only posts.
- **The decisive instrument returned nothing.** D-005 specifies that the legacy fallback emits
  `MEDIA-4006` + `MEDIA-4001` (resumed draft, by design) or **`MEDIA-4010` at ERROR** +
  `MEDIA-4001` (a defect). Querying `client_errors` over 48 hours:
  - **zero `MEDIA-4009` or `MEDIA-4010` rows of any kind**;
  - **zero rows at all** for either of the two members who produced legacy-only posts;
  - the table is otherwise live (`MEDIA-4007` web `2026-08-20-2` at 04:27; `SYS-9008` app ×3).
- **Verdict: UNRESOLVED, and it is a G4 question.** Two readings, which I cannot separate from
  the database:
  **(a)** those clients run a bundle predating the classified reporting — the expected decaying
  tail, no defect; or
  **(b)** the reporting path is not reaching the server for them, in which case D-005's
  classification is silent exactly where it was designed to speak.
  Reading (a) is more likely — `client_errors.app_build` shows other clients on `2026-08-10-3`,
  an old bundle — but "more likely" is not the standard this project uses.
- **Timing:** the daily monitor runs 03:30 UTC and will not see this until tomorrow.
- **Action:** attribute the build for user `ba812284` (owner can confirm, or the repo can show
  when MEDIA-4009/4010 reporting first shipped). Until then G4 is **not** demonstrated for the
  current 24h window.

### FINDING G — ⚠ NEW. An AMBER item was raised for an owner ruling in Cycle 1 and never entered the plan.

- **Origin (C1, "CONTINUE-ON-ERROR INVENTORY — AMBER"):** three `continue-on-error` occurrences,
  all in `android-build.yml`, all on the **debug side-load APK** steps (build, prove, upload
  artifact), each documented as deliberate so a debug variant cannot block the release AAB.
  **The release AAB path carries none.** C1's words: *"Not a violation; flagged for the owner's
  ruling."*
- **Result:** that ruling does not appear in the Master Plan, in DECISIONS, or in the task ledger.
  Part III has **no row** for it. It is neither closed nor carried — it fell out of the record
  between 2026-08-17 and the plan's 2026-08-21 revision.
- **Verdict: not a defect, and not urgent.** On C1's own reading the release path is unaffected.
  But Phase 1's exit gate is *"no unresolved RED item; controls verified"*, and an AMBER control
  item that was explicitly escalated and never answered should not be closed by silence.
- **Could not verify:** whether the three occurrences still exist at HEAD — needs the repo.
- **Action:** either rule on it (accept as deliberate and record the decision) or add it as a
  Part III row. One line either way.

### Also resolved by C1 + C2 — two of C1's three REDs are already closed.

C1 raised three RED items. Their current state, traced through the later cycles:

| C1 RED | Resolution |
|---|---|
| Migration ledger 615 vs 19 | **Explained** (C2 §D1.1) and specified (C4/C5). Row 7 |
| Version-string drift `20260816T1900` vs `20260817051750` | **CLOSED** — C2 D2 renamed it; hashes verified `cbb3efae…`, `f377fbef…` |
| Rollback script misplaced in `supabase/migrations/` | **CLOSED** — C2 D2 moved it to `supabase/rollback/`; *"ROLLBACK files remaining in `supabase/migrations/`: 0"* |

C1's "NOT VERIFIED" section also states plainly that `ComposerCaptionBoxes.test.ts` is a **source
pin, not an execution test**, and that there is **no execution proof for the app mention list**.
That is task ledger #55, and the plan correctly folds it into the Phase 3A/3B device matrix.

### Positive: the write path's "vacuous zero" is no longer vacuous.

WS3 recorded that the only post-fix proof row had been deleted, leaving `0 of 0`. Today:
**261 posts, 5 carrying an idempotency key** — three real member posts by `41e124e2` at
04:22 / 04:32 / 04:34 UTC, each with a `post_media` row, plus the two Android acceptance posts.
The measurement is now non-vacuous. (Phase 2 evidence; recorded here because it was observed.)

---

## 3. PART III vs PART IX

- Part IX collapses Part III rows 1–5 into one "Emergency blockers COMPLETE" row, hiding that
  row 5 is **INFO** while 1–4 are **HARD**. Not reconciled here.
- Part III row 12 is `OPEN`; Part IX calls it `NOT STARTED`. Two states, same item. Recorded.

---

## 4. THE SEQUENCING QUESTION (unchanged from Rev 1)

Part III row 12 is a Phase-1 **HARD** gate whose stated dependency is *"instruments (Phase-4
overlap)"*. Phase 4 is gated behind Phase 3, which is gated behind Phase 2. **As written, Phase 1
cannot certify until Phase 4 runs.** Owner ruling required; no safe default:

- **(a)** re-scope row 12 to a Phase-1-sized certification (ordering correctness, pagination
  boundaries, realtime delivery over the 29 published tables), moving load/latency to Phase 4;
- **(b)** keep it as specified, and accept that Phase 1 closes after Phase 4;
- **(c)** grant it a documented deferral like row 7, with a named exit condition.

---

## 5. VERDICT

**PHASE 1 = OPEN.** No criterion was moved by this audit. Nothing was modified.

- **1 row is closable now** (row 4 — duplicate versions, zero on both sides).
- **1 row has its production half fully confirmed** (row 2 — hashtag gate).
- **6 rows are unblocked by the Control Cycle documents** and now need only repo/CI/device.
- **2 rows (8, 9) are confirmed-open with reproduced production evidence** and need owner decisions.
- **1 row (12) is blocked on a plan-level circular dependency.**
- **2 new findings (E, F)** are not about Phase 1 at all — they are current-state corrections that
  arrived while the audit ran.

## 6. ACTIONS REQUIRED, IN ORDER

1. **OWNER — enable Chrome.** Rows 1, 2, 3, 5, 6, 10, 11 all reduce to repo/CI reads.
2. **OWNER — resolve Finding F.** Which build is `ba812284` on? Until answered, G4 is not
   demonstrated for today's window.
3. **OWNER/CLAUDE — correct Finding E** in the D-003 register, spec and handover. One sentence,
   three files. Do **not** delete post `7eaf0ef8` — it is the Phase-2 acceptance evidence.
4. **OWNER — rule on §4** (row 12 sequencing).
5. **OWNER — decide row 8** (are the two mirror triggers wanted?), per C6's own recommendation.
6. ~~CLAUDE, once Chrome is enabled — read the function and view bodies~~ **DONE in Rev 4,
   without Chrome.** All read from the database. `v3_mirror_log`'s new policy is a single
   admin-only read: `v3_mirror_log_read_admin`, SELECT, `authenticated`,
   `has_role(auth.uid(),'admin')` — no write policy, so writes remain deny-all and C6's
   reasoning for that table still holds by a different route.
7. **OWNER — enable leaked-password protection** in Supabase Auth (one setting).
8. **OWNER — rule on Finding G** (the three debug-side-load `continue-on-error` occurrences), or
   add it to Part III as a row. It has been waiting since 2026-08-17.

**No workstream has been started. Awaiting your instruction.**


---

## 7. ROW 9 DEFERRAL NOTE — appended 2026-08-21 (owner instruction), append-only

**Row 9 state: DEFERRED — SEPARATE JUDGING PANEL SECURITY/INTEGRITY WORKSTREAM.**
Not a PASS. Not a FAIL. Not executed. The Row-9 migration was never applied; no judging
table, grant, policy, function, trigger, view or datum was modified at any point.

**Dependency note:** Row 9 is intentionally excluded from the current Phase-1 execution
because the owner will handle the Judging Panel as a separately controlled task. Phase 1's
exit gate therefore CANNOT read "all rows closed" — it must read "all rows closed except
Row 9 (and Row 8, same subsystem), deferred by owner decision to the Judging Panel
workstream". This mirrors the row-7 DEFERRED precedent: a named deferral with its exit
living in another workstream, not a silent hole.

**Row 8 rider:** the mirror-trigger item is the same subsystem (`judge_tag_assignments`
triggers). Under the standing "nothing related to the Judging Panel" scope it is treated as
excluded alongside Row 9. Recorded as my classification, not an owner ruling — flag if wrong.

**Row 7 rider:** the ledger baseline (row 7) already excludes both judging migrations
(`20260429071225`, `20260504132638`) from the 597-row set for its own reasons; the deferral
changes nothing in that design and row 7 remains executable without touching the Judging Panel.

**Evidence preserved, none discarded:**
- `PHASE1_ROW9_ANON_JUDGING_REVOKE_DESIGN_2026-08-21.md` — design, gated migration, rollback,
  verification plan. Held for the Judging Panel workstream.
- `JUDGING_PANEL_SAFETY_GATE_2026-08-21.md` — full write-path trace, five-way classification,
  GREEN verdict with conditions, sub-findings V1 (definer-view write channel) and the
  `judging_write_decision_atomic` guard question, and the §7 behavioural test plan.
  All carried into the future workstream unchanged.
