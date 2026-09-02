# GATE REGISTER — Addendum A, Workstream P

**Authority:** this file is the single source of truth for *"is unit P-n done?"*
**Author:** the Auditor, and no one else. Developers never commit to this file.
**Created:** 2026-09-02 · **Status of every unit at creation: NOT STARTED**
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
| **P1** | `profiles` receives no write from a client timer; presence is served from memory; `profiles` dead-row ratio measured below 10 % for seven consecutive days. | SPLIT | 2 | `docs/evidence/d1/P1/` · `docs/evidence/d2/P1/` | NOT STARTED | Interface `docs/gates/P1-interface.md` must exist first. **Seven-day window is real elapsed time** — the unit cannot close, and Phase 2 cannot promote, before day seven. |
| **P2** | no table in the realtime publication carries REPLICA IDENTITY FULL without a written justification; the realtime decode query's share of total database time is re-measured and recorded. | D1 | 2 | `docs/evidence/d1/P2/` | NOT STARTED | Baseline share at 2026-09-01: **50.9 %**. Re-measurement must name the instrument. |
| **P3** | the build fails when the application subscribes to a table that is not published, or a table is published that nothing subscribes to. The current mismatch is resolved in both directions first. | SPLIT | 3 | `docs/evidence/d1/P3/` · `docs/evidence/d2/P3/` | NOT STARTED | Parity JSON schema frozen by the Auditor before either producer is written. **Eleven never-working features need a written disposition each** — `admin_notifications` included. |
| **P4** | `site_settings` read count from the API falls by at least two orders of magnitude; no unfiltered full-table read of `site_settings` remains in any code path. | D2 | 3 | `docs/evidence/d2/P4/` | NOT STARTED | Baseline ≈580,000 reads over 41 days. |
| **P5** | no scheduled job runs more often than once a minute unless it is demonstrably saturated; queue workers are woken by an event; idle back-off is implemented and its effect measured. | D1 | 3 | `docs/evidence/d1/P5/` | NOT STARTED | "Demonstrably saturated" requires a measurement, not an assertion. |
| **P6** | `cron.job_run_details` retention set to 24–48 hours; purge runs in bounded batches; the table is no longer among the ten largest in the database. | D1 | 4 | `docs/evidence/d1/P6/` | NOT STARTED | Baseline 202,082 rows / 76 MB of a 135 MB database. |
| **P7** | no schema-cache reload is triggered outside a deployment; the introspection queries' share of database time is re-measured and recorded. | D1 | 3 | `docs/evidence/d1/P7/` | NOT STARTED | Baseline share **10.3 %**. |
| **P8** | each named table's dead-row ratio measured below 10 % across a full week under normal traffic. | D1 | 4 | `docs/evidence/d1/P8/` | NOT STARTED | Named tables: `profiles`, `user_devices`, `user_notifications`, `activity_logs`. **Full week is real elapsed time.** P8 is what proves P1 worked. |
| **P9** | the outbound HTTP helper no longer performs an inline `vault.decrypted_secrets` lookup per call. | D1 | 3 | `docs/evidence/d1/P9/` | NOT STARTED | Baseline 422,342 calls. |
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
| **P26** | audit triggers limited to money, permissions and deletions; the change stored rather than two full row copies; rows older than a stated window moved out of the live database. | D1 | 4 | `docs/evidence/d1/P26/` | NOT STARTED | `db_audit_logs` is 86.6 % oversized-value storage at baseline. |
| **P27** | each named table dropped or given a written reason to exist, with a rollback recorded. | D1 | 4 | `docs/evidence/d1/P27/` | NOT STARTED | **Thirteen named tables.** Drops are CONTRACT — apply only in A-4c, after P-4 is live and stable seven days. |
| **P28** | no table ships with more index than heap without a written reason; the ratio checked at review. | D1 | 4 | `docs/evidence/d1/P28/` | NOT STARTED | This gate creates a standing review rule, not a one-off measurement. |
| **P29** | the ten heaviest screens traced for repeated per-row queries; a stated policy on where pre-computed views are used and how they refresh. | SPLIT | 7 | `docs/evidence/d1/P29/` · `docs/evidence/d2/P29/` | NOT STARTED | D1 traces; D2 supplies screen-level measurement. |
| **P30** | `email_exists` removed from the `anon` role; signup and password-reset responses are identical whether or not the address is registered. | D1 | 1 | `docs/evidence/d1/P30/` | NOT STARTED | **Blocked on D2's call-site inventory.** Clause 2 needs a test proving the two responses are byte-identical. |
| **P31** | name-based certificate search removed from `anon`; verification by token retained and tested; `verify_staff_id` placed behind a session or a rate limit. | D1 | 1 | `docs/evidence/d1/P31/` | NOT STARTED | Blocked on D2's inventory. **Verify-by-token stays public — that is correct and must be shown still working.** |
| **P32** | every anon-executable VOLATILE function either requires a session, or sits behind a rate-limited edge function, or has a written justification with a test. | D1 | 1 | `docs/evidence/d1/P32/` | NOT STARTED | **Eight functions**, each dispositioned individually. `record_test_agent_run` also carries the secret-as-SQL-argument finding. |
| **P33** | leaked-password protection on; the four definer views read, justified and each covered by a cross-member test; the two leftover RLS-enabled tables retired; `plpgsql_check` moved out of `public`; `get_primary_admin_user_id` either closed or its exposure written down. | D1 | 1 | `docs/evidence/d1/P33/` | NOT STARTED | **Five clauses; all five close or the unit does not.** Leaked-password toggle is `OWNER-ATTESTED` — the Auditor cannot set it. **The four views are not to be "fixed" by flipping `security_invoker`** — each is judged by its WHERE clause. |
| **P34** | `user_roles` sequential scans measured at approximately zero after the change; every role check in a policy or helper function demonstrably uses the `(user_id, role)` index; the measurement repeated on seeded data at 1 million rows. | D1 | 4 | `docs/evidence/d1/P34/` | NOT STARTED | **Cannot honestly close until X1 and X2 land** — see §2. Clause 3 needs the Phase 0 seeder. Effective access-control behaviour must be proven identical before and after. |
| **P35** | every table has a primary key or a written reason not to; the duplicate index pairs dropped; `post_hashtags.author_id` indexed. | D1 | 4 | `docs/evidence/d1/P35/` | NOT STARTED | Primary keys and the FK index are EXPAND (A-4a). **The duplicate-pair drops are CONTRACT (A-4c).** Unblocks X9 replica readiness. |

---

## 2 · Standing holds — these bind every unit above

| # | Hold | Effect | Released by |
|---|---|---|---|
| **H-1** | **C-2 — unused indexes unreconciled.** Four methods, four numbers: 79 (plan) / 78 (linter) / 298-of-which-125-droppable (own query) / 188 (earlier own report). | **No index is dropped by anyone.** Any PR that drops an index is closed unreviewed. | A Phase 4 reconciliation unit with its own gate: one named method, published, then drops proposed against it. |
| **H-2** | **X1 / X2 dependency.** 384 duplicate permissive policies across 82 tables; 29 policies re-evaluating `auth.uid()` per row. These are existing plan items, outside Addendum A's numbering. | **P34 cannot close.** This is the only dependency this programme has on work it does not itself contain. | X1 and X2 landing in their own slot before Phase 4. |
| **H-3** | **D-002 — public bucket privacy gap.** `post-images` is public; its storage SELECT policy carries no privacy condition. | **`PrivacyGapNotice` stays shipped and its test stays green.** Removing it is not a cleanup. | Authorized delivery going live. |
| **H-4** | **Staging credential untested.** The `staging` environment `SUPABASE_DB_URL` dates from 2026-08-31 and has never been exercised. | Phase 1's A-1 apply is at risk of failing on the credential rather than the SQL. | One Owner dispatch of `PROBE_credential_connectivity_readonly.sql` against `staging`. |
| **H-5** | **No production Environment reviewer.** The `production` GitHub Environment has no required reviewer and "allow administrators to bypass" is ticked. | With two developers dispatching work, nothing human stands between a dispatch and the production database. | Owner sets a required reviewer. |

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

## 5 · Register change log

| Date | Change | By |
|---|---|---|
| 2026-09-02 | Register created. 35 units transcribed verbatim from the addendum, all `NOT STARTED`. Five standing holds recorded. | Auditor |

*This register records. It does not approve, and it closes nothing on its own.*
