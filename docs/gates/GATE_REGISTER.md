# GATE REGISTER — Addendum A, Workstream P

**Authority:** this file is the single source of truth for *"is unit P-n done?"*
**Author:** the Auditor, and no one else. Developers never commit to this file.
**Created:** 2026-09-02 · **Revision 2 — 2026-09-02**, after D1's Phase 0 pre-work return (see §5)
**Status of every unit at creation: NOT STARTED**
**Companion documents:** `docs/ADDENDUM_A_EXECUTION_MASTER.md` (who, when, which branch) · `docs/PROMOTION_LEDGER.md` (what was promoted, and every correction)

---

## 0 · How this register works

Every gate sentence below is **transcribed verbatim** from *FINAL Updated 50mm Master Plan — Addendum A, Workstream P* (Neil Basu, 1 September 2026). Where the addendum wrote a clause, that clause stands here unedited. **The Auditor does not paraphrase a gate, and does not soften one.** If a gate is wrong, it is changed by a recorded ruling, not by rewriting this cell.

A unit is **not** done when the code works. It is done when the gate's evidence exists at the stated path and the Auditor has recorded it as `VERIFIED`.

### Status vocabulary — no category is ever silently converted into another

| Status | Means |
|---|---|
| `NOT STARTED` | no branch, no PR, no evidence |
| `IN PROGRESS` | a PR exists on `staging` |
| `EVIDENCE FILED` | the developer has committed the artefact; the Auditor has not yet checked it |
| `VERIFIED` | the Auditor personally exercised the instrument and saw the result |
| `OWNER-ATTESTED` | the Owner performed an action the Auditor cannot perform, and states the outcome |
| `INFERRED` | follows from documented platform behaviour; **not** measured |
| `BLOCKED` | cannot proceed; the blocker is named in the Notes column |
| `DEFERRED` | deliberately postponed by a recorded ruling |
| `N/A` | does not apply; the reason is written down |

### The five rules that govern a row

1. **A row moves to `VERIFIED` only on the Auditor's own instrument run.** A developer's screenshot is `EVIDENCE FILED`, never `VERIFIED`.
2. **A green result whose test could not have failed is rejected.** Every new check is shown failing on the unfixed input before it is accepted as a control (C-34).
3. **`curl` is not a browser.** Any gate whose evidence is a page, a redirect or a header as served is verified in a real browser (F-53).
4. **A negative statement carries the UTC timestamp it was observed.** "Zero" is only true at a moment.
5. **A superseded conclusion is not edited.** The original stands and the correction is filed beside it in the ledger.

### Owner column

`D1` = Developer 1, Database & Runtime · `D2` = Developer 2, Client & Delivery · `SPLIT` = both, at a frozen interface named in the Notes column. A `SPLIT` unit cannot start until its interface file exists on `staging`.

---

## 1 · The register — 35 units

| Unit | Gate — verbatim from the addendum | Owner | Phase | Evidence path | Status | Notes |
|---|---|---|---|---|---|---|
| **P1** | `profiles` receives no write from a client timer; presence is served from memory; `profiles` dead-row ratio measured below 10 % for seven consecutive days. | SPLIT | 2 | `docs/evidence/d1/P1/` · `docs/evidence/d2/P1/` | NOT STARTED | Interface `docs/gates/P1-interface.md` must exist first. **Seven-day window is real elapsed time** — the unit cannot close, and Phase 2 cannot promote, before day seven. **R2:** the addendum's 64.2 % `profiles` dead-row figure read **18.9 %** on 2026-09-02, 48 minutes after an autovacuum. Read 64.2 % as a point-in-time peak; a single reading of that ratio is noise, which is what the seven-day window is for. Pin the presence-write statement **by fingerprint**, not by count — 12,740 (09-01) against 39,823 (09-02) is probably two `pg_stat_statements` rows, not a 3× rise. |
| **P2** | no table in the realtime publication carries REPLICA IDENTITY FULL without a written justification; the realtime decode query's share of total database time is re-measured and recorded. | D1 | 2 | `docs/evidence/d1/P2/` | NOT STARTED | Baseline share at 2026-09-01: **50.9 %**. Re-measurement must name the instrument. |
| **P3** | the build fails when the application subscribes to a table that is not published, or a table is published that nothing subscribes to. The current mismatch is resolved in both directions first. | SPLIT | 3 | `docs/evidence/d1/P3/` · `docs/evidence/d2/P3/` | NOT STARTED | Parity JSON schema frozen by the Auditor before either producer is written. **Eleven never-working features need a written disposition each** — `admin_notifications` included. |
| **P4** | `site_settings` read count from the API falls by at least two orders of magnitude; no unfiltered full-table read of `site_settings` remains in any code path. | D2 | 3 | `docs/evidence/d2/P4/` | NOT STARTED | Baseline ≈580,000 reads over 41 days. |
| **P5** | no scheduled job runs more often than once a minute unless it is demonstrably saturated; queue workers are woken by an event; idle back-off is implemented and its effect measured. | D1 | 3 | `docs/evidence/d1/P5/` | NOT STARTED | "Demonstrably saturated" requires a measurement, not an assertion. |
| **P6** | `cron.job_run_details` retention set to 24–48 hours; purge runs in bounded batches; the table is no longer among the ten largest in the database. | D1 | 4 | `docs/evidence/d1/P6/` | NOT STARTED | Baseline 202,082 rows / 76 MB of a 135 MB database. |
| **P7** | no schema-cache reload is triggered outside a deployment; the introspection queries' share of database time is re-measured and recorded. | D1 | 3 | `docs/evidence/d1/P7/` | NOT STARTED | Baseline share **10.3 %**. |
| **P8** | each named table's dead-row ratio measured below 10 % across a full week under normal traffic. | D1 | 4 | `docs/evidence/d1/P8/` | NOT STARTED | Named tables: `profiles`, `user_devices`, `user_notifications`, `activity_logs`. **Full week is real elapsed time.** P8 is what proves P1 worked. **R2:** see P1 — the ratio moves sharply around an autovacuum, so a spot reading closes nothing. |
| **P9** | the outbound HTTP helper no longer performs an inline `vault.decrypted_secrets` lookup per call. | D1 | 3 | `docs/evidence/d1/P9/` | NOT STARTED | Baseline 422,342 calls. **R2 — routed finding:** a statement in the outbound-HTTP/vault group carries a **26.7-second mean execution time**, measured by D1 on 2026-09-02 and absent from the addendum. Raised for routing, not investigated. It belongs to this unit, with P5 adjacent. Not to be chased before Phase 3. |
| **P10** | no timer fires more often than once a second; every repeating timer is cleared on `visibilitychange`; battery and jank measured on a mid-range Android device before and after. | D2 | 2 | `docs/evidence/d2/P10/` | NOT STARTED | 21 `setInterval` timers at baseline. **Copy `useEngagementHeartbeat.ts`; do not invent a new pattern.** Real device, not an emulator. |
| **P11** | `OptimizedImage` used on feed, profile and gallery surfaces; a lint rule rejects a bare `<img>` in `src/components` and `src/pages`; feed bytes on a 3G profile measured before and after against M11's budget. | D2 | 5 | `docs/evidence/d2/P11/` | NOT STARTED | Baseline: component has **zero call sites**; 158 raw `<img>` tags. |
| **P12** | selecting a language downloads that language only; the entry bundle and per-language chunk sizes recorded. | D2 | 5 | `docs/evidence/d2/P12/` | NOT STARTED | `translations.rest.ts` = 527,720 bytes holding six dictionaries. |
| **P13** | a byte ceiling on the entry bundle and per-route chunks; a build that exceeds it **fails, it does not warn**, in the same style as M11. | D2 | 5 | `docs/evidence/d2/P13/` | NOT STARTED | The unit **is** the transition from Phase 0's report-only harness to a blocking gate. A warning is not a pass. |
| **P14** | `Cache-Control`, `ETag` and `stale-while-revalidate` policy stated per asset class and verified by fetch; the cache-hit target in M13 and V5 traced to the rules that produce it. | D2 | 5 | `docs/evidence/d2/P14/` | NOT STARTED | `fix-cache-headers` already runs in production and is currently ungoverned. |
| **P15** | Brotli or gzip confirmed active on every text response, measured, recorded once. | D2 | 5 | `docs/evidence/d2/P15/` | NOT STARTED | Closes forever once recorded, or reveals a very large cheap win. |
| **P16** | AVIF produced alongside WebP at each rung, served by content negotiation with WebP fallback; bytes-per-feed-screen re-measured against M11. | D2 | 5 | `docs/evidence/d2/P16/` | NOT STARTED | Depends on the M3/M4 derivative ladder existing. |
| **P17** | a written decision on server-side rendering or prerendering for public pages, with first-paint measured on a mid-range device; SEO given an owner and a gate. | D2 | 5 | `docs/evidence/d2/P17/` | NOT STARTED | **Closes on a written, dated decision.** Silence is not a closure. |
| **P18** | LCP, INP and CLS measured on real devices, reported per release beside the plan's own budgets. | D2 | 5 | `docs/evidence/d2/P18/` | NOT STARTED | Real devices. |
| **P19** | hot read paths identified and served from a memory cache with a stated invalidation rule; database read volume measured before and after. | D1 | 7 | `docs/evidence/d1/P19/` | NOT STARTED | The invalidation rule is part of the gate, not an implementation detail. |
| **P20** | the search technology chosen and its index built; C4's latency budget met at 1 million seeded posts, not at today's volume. | SPLIT | 7 | `docs/evidence/d1/P20/` · `docs/evidence/d2/P20/` | NOT STARTED | **Unprovable without the Phase 0 seeder.** D1 engine + index; D2 client integration. |
| **P21** | font strategy stated — subset, preload, `font-display` — and first-paint text measured with the network throttled. | D2 | 5 | `docs/evidence/d2/P21/` | NOT STARTED | |
| **P22** | either a service worker delivering the O-workstream's read cache on the web, or a written, dated decision that web offline is out of scope. | D2 | 5 | `docs/evidence/d2/P22/` | NOT STARTED | **Closes on a written, dated decision.** Either branch is a valid closure; silence is not. |
| **P23** | WCAG level chosen; automated checks in CI; keyboard and screen-reader walkthrough of the ten primary surfaces. | D2 | 5 | `docs/evidence/d2/P23/` | NOT STARTED | The ten surfaces are named in the evidence artefact, not left implicit. |
| **P24** | the supported-language list, the translation source of truth and the fallback rule written into the plan. | D2 | 5 | `docs/evidence/d2/P24/` | NOT STARTED | Gives P12's chunking a policy to serve. |
| **P25** | one immutable PDF per certificate in R2; the database holds a private reference only; delivery through the S2 worker; a member cannot fetch another member's certificate by address; L6's forgery-resistance requirement met against a fixed document. | SPLIT | 6 | `docs/evidence/d1/P25/` · `docs/evidence/d2/P25/` | NOT STARTED | Interface `docs/gates/P25-interface.md` first. **Clause 4 is a security test** — a cross-member fetch attempt is required evidence, not a feature check. Must land in the same change as P31 or the two contradict. |
| **P26** | audit triggers limited to money, permissions and deletions; the change stored rather than two full row copies; rows older than a stated window moved out of the live database. | D1 | 4 | `docs/evidence/d1/P26/` | NOT STARTED | `db_audit_logs` is 86.6 % oversized-value storage at baseline. **R2:** trigger count re-measured **157** on 2026-09-02 (the addendum said 149). Recorded, not resolved; it widens the scope slightly and changes no disposition. |
| **P27** | each named table dropped or given a written reason to exist, with a rollback recorded. | D1 | 4 | `docs/evidence/d1/P27/` | NOT STARTED | **Thirteen named tables.** Drops are CONTRACT — apply only in A-4c, after P-4 is live and stable seven days. |
| **P28** | no table ships with more index than heap without a written reason; the ratio checked at review. | D1 | 4 | `docs/evidence/d1/P28/` | NOT STARTED | This gate creates a standing review rule, not a one-off measurement. |
| **P29** | the ten heaviest screens traced for repeated per-row queries; a stated policy on where pre-computed views are used and how they refresh. | SPLIT | 7 | `docs/evidence/d1/P29/` · `docs/evidence/d2/P29/` | NOT STARTED | D1 traces; D2 supplies screen-level measurement. |
| **P30** | `email_exists` removed from the `anon` role; signup and password-reset responses are identical whether or not the address is registered. | D1 | 1 | `docs/evidence/d1/P30/` | NOT STARTED | **Blocked on D2's call-site inventory.** Clause 2 needs a test proving the two responses are byte-identical. |
| **P31** | name-based certificate search removed from `anon`; verification by token retained and tested; `verify_staff_id` placed behind a session or a rate limit. | D1 | 1 | `docs/evidence/d1/P31/` | NOT STARTED | Blocked on D2's inventory. **Verify-by-token stays public — that is correct and must be shown still working.** |
| **P32** | every anon-executable VOLATILE function either requires a session, or sits behind a rate-limited edge function, or has a written justification with a test. | D1 | 1 | `docs/evidence/d1/P32/` | NOT STARTED | **Eight functions**, each dispositioned individually. `record_test_agent_run` also carries the secret-as-SQL-argument finding. |
| **P33** | leaked-password protection on; the four definer views read, justified and each covered by a cross-member test; the two leftover RLS-enabled tables retired; `plpgsql_check` moved out of `public`; `get_primary_admin_user_id` either closed or its exposure written down. | D1 | 1 | `docs/evidence/d1/P33/` | NOT STARTED | **Five clauses; all five close or the unit does not.** Leaked-password toggle is `OWNER-ATTESTED` — the Auditor cannot set it. **The four views are not to be "fixed" by flipping `security_invoker`** — each is judged by its WHERE clause. **R2:** SECURITY DEFINER function count re-measured **332** on 2026-09-02 (the addendum said 329). Recorded, not resolved. |
| **P34** | `user_roles` sequential scans measured at approximately zero after the change; every role check in a policy or helper function demonstrably uses the `(user_id, role)` index; the measurement repeated on seeded data at 1 million rows. | D1 | 4 | `docs/evidence/d1/P34/` | NOT STARTED | **Cannot honestly close until X1 and X2 land** — see §2. Clause 3 needs the Phase 0 seeder. Effective access-control behaviour must be proven identical before and after. |
| **P35** | every table has a primary key or a written reason not to; the duplicate index pairs dropped; `post_hashtags.author_id` indexed. | D1 | 4 | `docs/evidence/d1/P35/` | NOT STARTED | Primary keys and the FK index are EXPAND (A-4a). **The duplicate-pair drops are CONTRACT (A-4c).** Unblocks X9 replica readiness. |

---

## 2 · Standing holds — these bind every unit above

| # | Hold | Effect | Released by |
|---|---|---|---|
| **H-1** | **C-2 — unused indexes unreconciled.** Four methods, four numbers: 79 (plan) / 78 (linter) / 298-of-which-125-droppable (own query) / 188 (earlier own report). **R2 — candidate reconciliation filed by D1 on 2026-09-02 at 06:56Z, `EVIDENCE FILED`, not `VERIFIED`:** one population on two axes — schema scope × constraint indexes in or out. M1 public, all = **188** · M2 public, excluding PK/unique = **78** · M3 all non-system schemas, all = **298** · M4 all schemas, excluding PK/unique = **125** · M5 denominator, every index = **594**. Four of the five fall out exactly, including the "298 of which 125". **79 does not** — off by one against M2, and it is the plan's own published number. | **No index is dropped by anyone.** Any PR that drops an index is closed unreviewed. **The candidate does not release the hold.** | The Phase 4 reconciliation unit, with its own gate. It must adopt **one method, named together with its scope in the same sentence** — M2 (78, public only) and M4 (125, all non-system schemas) answer different questions — and it must account for the 79 rather than dropping it. |
| **H-2** | **X1 / X2 dependency.** 384 duplicate permissive policies across 82 tables; 29 policies re-evaluating `auth.uid()` per row. These are existing plan items, outside Addendum A's numbering. | **P34 cannot close.** This is the only dependency this programme has on work it does not itself contain. | X1 and X2 landing in their own slot before Phase 4. |
| **H-3** | **D-002 — public bucket privacy gap.** `post-images` is public; its storage SELECT policy carries no privacy condition. | **`PrivacyGapNotice` stays shipped and its test stays green.** Removing it is not a cleanup. | Authorized delivery going live. |
| **H-4** | **Staging credential untested.** The `staging` environment `SUPABASE_DB_URL` dates from 2026-08-31 and has never been exercised. | Phase 1's A-1 apply is at risk of failing on the credential rather than the SQL. | One Owner dispatch of `PROBE_credential_connectivity_readonly.sql` against `staging`. |
| **H-5** | **No production Environment reviewer.** The `production` GitHub Environment has no required reviewer and "allow administrators to bypass" is ticked. | With two developers dispatching work, nothing human stands between a dispatch and the production database. | Owner sets a required reviewer. |

### Standing notes — recorded, not holds

These do not stop work. They are written down so nobody has to rediscover them, and so no gate is closed in ignorance of them.

| # | Note | Why it is here |
|---|---|---|
| **N-1** | **The two lanes run different Postgres patch levels** — staging `17.6.1.155`, production `17.6.1.141`, both read 2026-09-02 06:38Z. | A gate proven on staging is proven on a different build than the one production runs. Not blocking, not alarming — but it belongs in the promotion checklist's field of view rather than being discovered during an incident. |
| **N-2** | **`pg_stat_statements_info.dealloc = 0` against a 5,000 capacity**, measured 2026-09-02. | Every percentage in the addendum divides by that denominator. It could have been silently false and it was not. Re-check it on every baseline run: a denominator that starts evicting turns every later percentage into an understatement, with no error appearing anywhere. |
| **N-3** | **The `apply-migration.yml` ref gate reads a string a human supplied.** D1's Phase 0 lane guard additionally reads the cluster's own `system_identifier` — production `7656985631720456337`, staging `7666007964130682852`. | The stronger check should be proposed for the migration gate in its own PR, with its own reasoning, in Phase 1 or later. **Phase 0 ships no workflow behaviour change; it is not to be folded in now.** |

---

## 3 · Interface files — a SPLIT unit cannot start before its file exists on `staging`

| File | Freezes | Needed before |
|---|---|---|
| `docs/gates/P1-interface.md` | one signature for "record presence" | P1 (Phase 2) |
| `docs/gates/P3-parity-schema.md` | the JSON shape both parity producers emit | P3 (Phase 3) |
| `docs/gates/P25-interface.md` | R2 object key scheme, reference column shape, S2 worker authorisation contract | P25 (Phase 6) |
| `docs/gates/phase-N-kickoff.md` | unit list, owner per unit, objects reserved, dependency-window holder | every phase |

**An interface agreed in conversation does not exist.** D1 and D2 are separate sessions and cannot see each other.

---

## 4 · Phase and promotion map

| Phase | Units | SQL apply | Promotion | Closing condition beyond the gates |
|---|---|---|---|---|
| **0** | baseline, seeder, harnesses | none | **P-0** | every unit that claims a number has a committed baseline with a measurement timestamp on every line |
| **1** | P30 P31 P32 P33 | **A-1** | **P-1** | D2's call-site inventory delivered and the revocation list frozen **before** any revocation |
| **2** | P1 P2 P10 | **A-2** | **P-2** | the seven-day `profiles` dead-row window closes green |
| **3** | P3 P4 P5 P7 P9 | **A-3** | **P-3** | parity check green on `staging`; `site_settings` API reads down ≥2 orders of magnitude |
| **4** | P6 P8 P26 P27 P28 P34 P35 + C-2 | **A-4a** / **A-4b** / **A-4c** | **P-4** (between 4b and 4c) | A-4c applies only after P-4 is live and stable seven days |
| **5** | P11–P18, P21–P24 | none | **P-5** | UI gate, bundle budget and Web-Vitals report all green on `staging`, on a real mid-range device |
| **6** | P25 | **A-6** | **P-6** | cross-member fetch attempt recorded as evidence |
| **7** | P19 P20 P29 | **A-7** | **P-7** | measured at 1 M seeded rows, not at today's volume |

**Every promotion runs the nine-step checklist in `docs/ADDENDUM_A_EXECUTION_MASTER.md` §7.** Step 8 — `compare/main..staging` reading `0 changed files, 0 additions, 0 deletions` — closes the phase. Nothing else does.

---

## 5 · Phase 0 progress ledger

Status of the six Phase 0 deliverables from `docs/gates/phase-0-kickoff.md`. This table is the Auditor's: developers report, the Auditor records.

| # | Deliverable | Owner | Status | Basis |
|---|---|---|---|---|
| 0.1 | `scripts/db-baseline.mjs` | D1 | **IN PROGRESS** | Written and unit-tested, 37 tests passing. **The gate artefact does not exist** — the script has never run end to end, for want of `SUPABASE_DB_URL`. The 21 probes were validated query by query; the seed statement by `EXPLAIN`, which plans without executing. `BLOCKED` on H-4. |
| 0.2 | Addendum re-measurement | D1 | **EVIDENCE FILED** | Filed 2026-09-02 06:38Z–06:57Z, read-only against production. Holds exactly: the counter window, realtime decode 50.81 % against 50.9 %, `pg_timezone_names` 2,798 calls at 798.5 ms, the cron purge at 42 runs averaging 6,426 ms, 29 published tables, the same three on REPLICA IDENTITY FULL, 135 MB total, `cron.job_run_details` at 77 MB / 56.7 %, and five of six index sizes byte-identical a day later. Recorded and **not resolved**: presence writes, definer functions 329→332, triggers 149→157, `profiles` dead rows 64.2 %→18.9 %. |
| 0.3 | 1 M-row staging seeder | D1 | **IN PROGRESS** | Three guards built, the third — the cluster's own `system_identifier` — stronger than the kickoff asked for. **All nine `posts` triggers left armed by design**: `rate_limit_posts()` neutralised by backdating, `fan_out_new_post()` throttled by the privacy mix, `detect_duplicate_post()` by distinct deterministic content; `session_replication_role` refused twice over, one of those measured rather than assumed. **Gate not yet met:** the production-ref guard has not been demonstrated failing in a run. |
| 0.4 | `scripts/web-baseline.mjs` | D2 | **NOT STARTED** | Absent from `origin/staging`, and no `d2/` branch exists on origin. Checked 2026-09-02. |
| 0.5 | Web-Vitals harness, report-only | D2 | **NOT STARTED** | As above. |
| 0.6 | Gate Register and kickoff | Auditor | **DONE** | On `main` at `21421237d05426d91d15cbea0a4f4ee6a55401d9`, 2026-09-02 06:59:58Z; synced to `staging`; `compare/main..staging` = 0 changed files, 0 additions, 0 deletions. |

**Transit risk, recorded because it is real:** D1's Phase 0 branch `d1/P00-baseline-and-seeder-20260902` (commit `883ff8c0`, tree `5c3e5ad0`, 7 files, +2,323 lines) exists on one machine only. That clone's git push URL is the literal string `DISABLED_NO_PUSH_AUTHORITY`. The Owner has elected to restore push authority rather than have the Auditor act as courier — correctly, since a courier arrangement would make the Auditor the committer of code the Auditor must then review. **Until it lands on origin, none of 0.1–0.3 can be reviewed, and a week of work is one machine failure from gone.**

### Reservation amendment — D1, Phase 0

D1's reservation — no tables, functions, policies, publication entries or settings altered; objects reserved **none**; no SQL apply — is **ACCEPTED**, with one amendment D1 proposed and the Auditor confirms:

> **The seeder's target table names are to be posted as a reservation before its first run.** Staging-only does not make a table un-collidable. P20 and P34 measure *against seeded data*; two units writing the same staging tables would corrupt each other's baselines, and the corruption would read as a measurement. Table names before first run, not before first line.

### Corrections filed in this revision

| # | Correction | Against |
|---|---|---|
| **C-46** | The Auditor issued both developer kickoff commands instructing each session to *"read `docs/gates/` and the Gate Register as your first action"* **while that directory existed on no ref**. D1's session ran 06:38Z–06:57Z; the register reached `main` at 06:59:58Z. D1's absence report was correct as measured, scanned every ref rather than two branches, and is **superseded, not withdrawn**. The original instruction stands in the record and this correction sits beside it. | **the Auditor** |

### Documentation finding, accepted

`docs/ADDENDUM_A_EXECUTION_MASTER.md` §5 cites **66.7 %** and **64.2 %** and defines neither in that document; their subjects live only in the source measurement report. Raised by D1, whose lane does not include `docs/` under the master. **Accepted — the Auditor's file, the Auditor's fix**, folded into the next revision of the execution master.

---

## 6 · Register change log

| Date | Change | By |
|---|---|---|
| 2026-09-02 | Register created. 35 units transcribed verbatim from the addendum, all `NOT STARTED`. Five standing holds recorded. | Auditor |
| 2026-09-02 | **Revision 2** — rulings on D1's Phase 0 pre-work folded in: P1/P8 dead-row volatility, P9's routed 26.7-second statement, P26 and P33 re-measured counts, H-1's candidate reconciliation, three standing notes, the Phase 0 progress ledger, and correction **C-46 against the Auditor**. | Auditor |

*This register records. It does not approve, and it closes nothing on its own.*
