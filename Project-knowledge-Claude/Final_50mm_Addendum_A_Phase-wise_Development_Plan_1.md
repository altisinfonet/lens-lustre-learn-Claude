Reference Phase wise development plan 2026 09 02 Document · MD

50MM RETINA WORLD

Addendum A — Phase-wise Development Plan

Task breakdown per phase for Developer 1, Developer 2 and the Auditor — each a separate Claude session — with the skills every session must load

| PREPARED FOR | DATE | BASIS | STATUS |
| --- | --- | --- | --- |
| Neil Basu 50mm Retina World | 2 September 2026 | Addendum A, Workstream P (35 units, 1 Sep 2026) · Addendum A Execution Plan (7 phases) · Addendum A Execution Master v1.2 · the four 50mm role skills | PROPOSED Nothing approved. Nothing executed. |

| What this document adds to the two plans you already have The Addendum says what must change and what evidence closes it. The Execution Plan says in which phase and which lane. This document goes one level lower: for every phase it lists the individual tasks for Developer 1, Developer 2 and the Auditor, in the order they must happen, with the evidence each task must produce and the skills and tools the Claude session must load before it starts. Every gate sentence in this document is quoted verbatim from Addendum A. No unit has been re-worded, merged, split or dropped: all 35 units (P1–P35) appear exactly once, in the phase the Execution Master assigns them, plus the C-2 index reconciliation. An index at the end proves it. Three roles, three separate Claude sessions. They cannot see each other. Every handoff in this plan is therefore a committed file with a named path — never a conversation. |
| --- |

# Contents

Right-click the table and choose “Update field” in Word if page numbers do not show.

# 1 · How to use this document

Each phase has the same shape, so a session can open the document, go to its phase, and start.

| Section in every phase | What it is for |
| --- | --- |
| Purpose and units | The units in the phase, with their gate sentences verbatim. The gate is the definition of finished. Nothing else is. |
| Entry conditions | What must already be true — committed, not assumed — before any session starts work in the phase. |
| Developer 1 tasks | Database & Runtime. Tasks in execution order, with an ID, the evidence that closes each, and the skills to load. |
| Developer 2 tasks | Client & Delivery. Same shape. |
| Auditor tasks | Kickoff, interface freezes, reviews, SQL-apply authorisation, gate closure, promotion, ledger. |
| Order of operations | The sequence across the three sessions. Where a task cannot start until another session has committed a file, the file is named. |
| SQL apply and promotion | Which apply files (A-n) and which promotion (P-n) close the phase, and what must be green first. |
| Exit criteria | The phase is closed only when every line here is true. |

## 1.1 · Task ID scheme

<phase>-<role>-<nn> — for example 2-D1-03 is the third Developer 1 task in Phase 2. Roles: D1 Developer 1, D2 Developer 2, AU Auditor, OW Owner (you). IDs are for this plan; unit IDs (P1–P35) come from the Addendum and are never renumbered.

## 1.2 · Three words, used strictly

| Word | Meaning — from the Execution Master, unchanged |
| --- | --- |
| SQL apply | Running one reviewed .sql file against one database through apply-migration.yml. Nothing else is ever called a migration. |
| Promotion | Moving code from staging to main. Squash merge. Code only. The Auditor's action, never a developer's. |
| Gate | The evidence sentence written in the Addendum for that unit. A unit is done when the gate's evidence exists and the Auditor has recorded it — not when the code works. |

# 2 · The three sessions and the skills they must load

All three roles are Claude sessions in separate chats (Owner ruling D-15). A session has no memory of the other two and no memory of its own previous chats beyond what is committed to the repository. The skill is what gives the session its role, its boundaries and its standard of practice. A session that has not loaded its role skill has not started.

## 2.1 · Role skills — mandatory, first action of every session

| Session | Skill to load | What the skill enforces |
| --- | --- | --- |
| Developer 1 Database & Runtime | 50mm-developer-1-db-runtime | Owns supabase/**, scripts/db-*.mjs, docs/evidence/d1/**, D1 workflows. Object reservation before any SQL. Expand → behaviour → contract. Rollback file in the same PR. Branch off staging only. Never touches src/**. Never handles a secret. |
| Developer 2 Client & Delivery | 50mm-developer-2-client-delivery | Owns src/**, public/**, build config, functions/** (Pages), tools/uishot/**, scripts/web-*.mjs, docs/evidence/d2/**, D2 workflows. Never touches supabase/**. Measures on a real mid-range Android, not an emulator. Timers ≥ 1 s and cleared on visibilitychange. |
| Auditor | 50mm-code-auditor | Writes no code and no SQL. Owns docs/PROMOTION_LEDGER.md and docs/gates/**. Reviews against the verbatim gate. Verifies from the running system. Evidence as Requirement → Instrument → Evidence → Result → Status. Alone authorises every SQL apply and every promotion. Runs the nine-step checklist every time. |

## 2.2 · Supporting skill — loaded in addition, for the tasks that name it

| Skill | Loaded by | When and why |
| --- | --- | --- |
| 50mm-security-reviewer | D1 and Auditor | Every task touching grants, SECURITY DEFINER, RLS policies, anon-executable functions, secrets or lane separation: Phase 1 (all four units), Phase 4 (P34 policy consolidation), Phase 6 (P25 owner-only delivery, and its P31 pairing). It carries the triage ladder, the false-alarm register and the nine reject rules the Auditor applies to a security PR. |
| design:accessibility-review | D2 | Phase 5, P23 — WCAG level selection, automated checks and the keyboard / screen-reader walkthrough of the ten primary surfaces. |
| marketing:seo-audit | D2 | Phase 5, P17 — the written first-paint / prerender decision and the SEO gate that the named owner will be held to. |

## 2.3 · Tools and connectors each session needs

| Tool / connector | Sessions | Permitted use — and the line that is never crossed |
| --- | --- | --- |
| Supabase MCP | D1, Auditor | Read-only. execute_sql with SELECT only, get_advisors, list_tables, list_extensions, query_logs, get_project. Used for every measurement in this plan. Never apply_migration, execute_sql with DDL/DML, deploy_edge_function or create_branch through the connector — every SQL apply goes through apply-migration.yml on the reserved lane, with a rollback file, after the Auditor's authorisation. Staging ref ztzutckwdhetphwghuzj; production ref jtdtehuqtinjxropkkcn. |
| GitHub (`gh` / git) | All three | Branches off staging, PRs to staging, workflow runs and their printed step output, compare/main..staging. Developers never merge to main. The Auditor squash-merges promotions. |
| Claude in Chrome | Auditor (D2 for its own checks) | “Verified in a real browser” means exactly this: staging.50mmretina.com and www.50mmretina.com opened in Chrome, the Supabase dashboard settings page read, the GitHub Environment page read. curl is not a browser (F-53). |
| Cloudflare MCP | D2, Auditor | Read and verify: Pages project lens-lustre-learn-claude, R2 buckets (Phase 6 certificates), Workers (S2 worker), documentation search for cache and image-resizing behaviour. Creating or deleting a bucket is an Owner action, never a session's. |
| Real mid-range Android device | Owner, on D2's runbook | Sessions cannot hold a phone. D2 writes a step-by-step runbook; the Owner executes it and returns screenshots and readings; the Auditor records them as OWNER-ATTESTED. Readings captured by the automated Web-Vitals harness on an Android profile are VERIFIED. The two are never mixed. |

## 2.4 · Skills recommended to be added — not required to start Phase 0

Two procedures in this plan will be repeated many times by sessions that cannot remember the previous run. Turning each into a skill after its first successful use is cheap and removes a whole class of “done differently this time” errors. The Auditor proposes each at the kickoff named, the Owner saves it.

| Proposed skill | Propose at | What it would carry |
| --- | --- | --- |
| 50mm-real-device-runbook | Phase 2 kickoff | The exact steps the Owner follows on the physical Android device for battery, jank, LCP/INP/CLS and feed-bytes readings; the screenshot set required; the file naming under docs/evidence/d2/. Used by P10, P11, P16, P17, P18, P21 and P-5. |
| 50mm-staging-seeder-runbook | End of Phase 0 | How to re-run the 1-million-row seeder safely: the guard, the expected row counts per table, the reset procedure, and the reading that proves seeded state. Used by P20, P34 and Phase 7. |

## 2.5 · Session startup protocol — every session, every time

Load the role skill (§2.1) and any supporting skill the phase names (§2.2).

Read docs/ADDENDUM_A_EXECUTION_MASTER.md, docs/gates/GATE_REGISTER.md, and the current phase kickoff docs/gates/phase-N-kickoff.md.

Run git log --oneline -20 origin/staging and open the branch. What has landed is what is committed — not what the session remembers or expects the other developer to have done.

Read the interface file the phase names (docs/gates/P1-interface.md, P3-parity-schema.md, P25-interface.md). If it does not exist, the straddling unit has not started; stop and report.

Confirm the dependency-window state in the kickoff before touching package.json.

Do the task. One unit per branch, one unit per PR, PR body in the required shape (§3.3).

Commit evidence under the owned evidence path with a UTC timestamp on every measured line. End the session by stating, in the PR, exactly what is VERIFIED and what is not.

## 2.6 · Opening message for each session — copy as written

| Developer 1 Load skill 50mm-developer-1-db-runtime. You are D1 on 50mm Retina World, Addendum A, Phase N. Read docs/ADDENDUM_A_EXECUTION_MASTER.md, docs/gates/GATE_REGISTER.md, docs/gates/phase-N-kickoff.md and git log --oneline -20 origin/staging before anything else. Your tasks for this phase are the D1 rows of Phase N in the Phase-wise Development Plan. Supabase MCP is read-only for you; every SQL apply goes through apply-migration.yml after the Auditor authorises it. Post your object reservation before writing SQL. Do not touch any path you do not own. |
| --- |
| Developer 2 Load skill 50mm-developer-2-client-delivery. You are D2 on 50mm Retina World, Addendum A, Phase N. Read docs/ADDENDUM_A_EXECUTION_MASTER.md, docs/gates/GATE_REGISTER.md, docs/gates/phase-N-kickoff.md and git log --oneline -20 origin/staging before anything else. Your tasks for this phase are the D2 rows of Phase N in the Phase-wise Development Plan. You never touch supabase/**. Measurements are taken on a real mid-range Android via the runbook, never an emulator. Do not touch any path you do not own. |
| Auditor Load skill 50mm-code-auditor (and 50mm-security-reviewer for any security unit). You are the sole Auditor on 50mm Retina World, Addendum A, Phase N. You write no code and no SQL. Read the Gate Register, the ledger and git log on staging and main before anything else. Your tasks for this phase are the AU rows of Phase N in the Phase-wise Development Plan: kickoff, interface freezes, PR review against the verbatim gate, SQL-apply authorisation, gate closure with classified evidence, the nine-step promotion checklist, and the ledger entry. |

# 3 · Rules that apply to every phase

## 3.1 · Ownership map — binding

| Path | Owner | Note |
| --- | --- | --- |
| supabase/migrations/**, supabase/rollback/**, supabase/functions/** | D1 only | Ordered files; every apply file ships with its rollback in the same PR. |
| src/**, public/**, index.html, vite.config.ts, tsconfig*.json, eslint*, tools/uishot/**, functions/** | D2 only | The whole React app, build config, and Pages Functions (edge runtime, SEO injection, config delivery). |
| docs/PROMOTION_LEDGER.md, docs/gates/** | Auditor only | One author, ever. |
| docs/evidence/d1/** · docs/evidence/d2/** | D1 · D2 | Where each developer files gate evidence. |
| scripts/db-*.mjs · scripts/web-*.mjs | D1 · D2 | Split by filename prefix. |
| scripts/lane-config.mjs, scripts/lane-config.d.mts | FROZEN | Auditor's written approval in the ledger and both developers' sign-off. Already cost builds #113 and #114. |
| .github/workflows/: apply-migration.yml, security.yml, verify-schema-dependencies.yml, schema-dump.yml | D1 | New D1 workflows are named d1-*.yml. |
| .github/workflows/: web-build.yml, ui-gate.yml, typecheck.yml, android-build.yml | D2 | New D2 workflows are named d2-*.yml. |
| .github/workflows/health.yml | Auditor |  |
| package.json, package-lock.json | Dependency window | One developer at a time, window opened and closed by the Auditor, one window per developer per phase, recorded in the kickoff and the ledger. |

Not even a typo. A session never edits a file it does not own; it reports it to the Auditor.

## 3.2 · Database changes — expand → behaviour → contract

Expand — additive only (columns, primary keys, indexes, settings). Safe ahead of code. Nothing dropped.

Behaviour — the change in what the system does. Applied after expand is stable (48 h in Phase 4).

Contract — drops and renames. Applied only after the promotion that depends on them is live and stable (seven days in Phase 4). Never on the same day.

Staging first, always. No SQL apply against production before the identical file is green on staging — including “it's only a comment”.

Migration filenames come from the phase's reserved block only: Phase 1 → 20260910_0001_* … 0099; Phase 2 → 20260920_0001_* … 0099. Blocks for Phases 3–7 are assigned by the Auditor in each phase kickoff — they are not invented by a developer.

## 3.3 · Branch, PR and evidence discipline

Branch off staging only, named d1/P02-replica-identity-20260910 or d2/P11-optimized-image-20260910. Every PR targets staging. Never main.

One unit per PR. A PR carrying two units is closed and re-cut.

PR body, required shape: unit ID · the gate sentence verbatim · paths touched · objects reserved (D1) · evidence artefact path · cause or symptom, stated.

Every new check is shown failing on the unfixed input before it is accepted as a control (C-34). A CI-rule change proves itself by running on its own PR.

Every measured claim: a number taken before and after, with the instrument named and a UTC timestamp on every line.

Squash merge only. After every promotion compare/main..staging must read 0 changed files, 0 additions, 0 deletions (Standing Rule 20) before new work starts.

## 3.4 · The evidence line the Auditor accepts

| Requirement → Instrument → Evidence → Result → Status Status is exactly one of: VERIFIED · OWNER-ATTESTED · INFERRED · BLOCKED · N/A · DEFERRED. VERIFIED requires a named instrument and a quoted reading — a run ID, a log line, a query result, a screenshot of the live site in a real browser. A green CI tick alone is not evidence. No category is ever silently converted into another. |
| --- |

## 3.5 · The nine-step promotion checklist — the Auditor runs it every time

Every unit in the phase reads VERIFIED in the Gate Register, with an evidence path.

staging.50mmretina.com verified in a real browser.

The Android UI gate and the bundle budget are green on staging.

For phases with SQL: expand applies green on both lanes; contract applies explicitly deferred.

git diff main..staging reviewed file by file. A file no PR mentioned is a stop.

Squash-merge staging → main. One promotion PR, titled with the phase.

Production verified live in a real browser.

compare/main..staging re-checked to zero — Standing Rule 20.

Ledger entry: what was promoted, the tree hash, what closed, what stayed open, every correction against the Auditor's own earlier statements.

## 3.6 · Standing holds in force

| Hold | What | Effect on this plan |
| --- | --- | --- |
| H-1 | C-2 — four unreconciled unused-index counts (79 / 78 / 298-of-which-125 / 188). | No index is dropped by anyone until one method is published (Phase 4, task 4-D1-02). Any PR dropping an index earlier is closed. |
| H-2 | X1 / X2 (RLS policy consolidation, existing Master Plan items) not yet scheduled. | P34's gate cannot close until they land. Owner schedules them before Phase 4 (task 4-OW-01). |
| H-3 | D-002 public-bucket privacy gap. | PrivacyGapNotice stays shipped and its test stays green in every phase. Removing it is not a cleanup. |
| H-4 | Staging database credential untested since 2026-08-31. | Owner dispatches the read-only probe before Phase 1 (task 0-OW-01). |
| H-5 | No required reviewer on the production GitHub Environment. | Owner sets one before Phase 1 (task 0-OW-02). |

## 3.7 · Forbidden to all three sessions, without exception

| Guesswork · Assumptions · Implicit behaviour · Hidden operations · Recursive actions · Fan-out execution · Bulk modifications · Auto-fix behaviour · Background dependency changes · “Probably safe” logic · Casual shortcuts. Also: handling a connection string, secret, token or keystore · weakening a check to make a build pass · modifying a frozen release candidate to manufacture a passing result · approving or promoting one's own work · dropping any index under H-1. |
| --- |

# Phase 0 · Baseline and instruments

Changes no behaviour. About a week. Nothing a member can see changes.

## 0.1 · Purpose and units

Every number in Addendum A — 66.7 %, 50.9 %, 580,000 requests, 64.2 % dead rows — was taken in a single 38-minute window on 2026-09-01. Phase 0 re-takes the same numbers with the project's own instruments and commits them, so that every “after” figure in Phases 1–7 is a measurement and not an argument.

It also builds the 1-million-row staging seeder (Owner ruling D-16), because P20 and P34 carry gates that are unprovable at 106 rows.

No Addendum units are closed in this phase. It ships measurement and CI only, so that every later unit can be proven.

## 0.2 · Entry conditions — all must be true, committed, before the phase starts

The Auditor has published docs/gates/GATE_REGISTER.md (35 rows, verbatim gates, owner, phase, evidence path, status NOT STARTED) and docs/gates/phase-0-kickoff.md on staging. Both are recorded in the project as issued on 2026-09-02; each session confirms they are committed rather than assuming it.

Both developers have loaded their role skill and completed the startup protocol (§2.5).

Dependency window: closed for the whole phase. Baseline scripts use Node built-ins or what is already installed.

## 0.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 0-D1-01 | Branch d1/P0-db-baseline-20260902 off staging. Write scripts/db-baseline.mjs: a read-only snapshot of pg_stat_statements, table and index sizes, dead-row ratios, index usage, the realtime publication list, RLS policy counts per table, and the definer-function classification (trigger / guarded / unguarded). Output JSON under docs/evidence/d1/baseline/. | JSON committed with a UTC measurement timestamp on every line; the script runs in CI on its own PR and commits its output. SELECT only — the PR diff contains no DDL or DML. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 0-D1-02 | Addendum re-measurement. Re-run the Addendum's own queries behind every number a P-unit claims (P1, P2, P3, P4, P5, P6, P7, P8, P9, P19, P26, P27, P28, P32, P33, P34, P35) and record for each whether the 2026-09-01 figure still holds. Disagreements are recorded, not resolved. | docs/evidence/d1/baseline/addendum-recheck.md: one row per figure — Addendum value, today's value, timestamp, holds / moved. A figure that moved is a finding, not an error to tidy. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 0-D1-03 | The 1-million-row staging seeder scripts/db-seed-staging.mjs: deterministic, re-runnable, staging only, with a hard guard that refuses to run against the production project ref jtdtehuqtinjxropkkcn. Seeds members, posts, roles, votes and the other tables Phase 7 will measure. Reason for every design choice left in the file header. | The guard is demonstrated failing against the production ref in a CI step whose printed output is quoted in the PR. Row counts per table after a run are committed under docs/evidence/d1/baseline/seeder-run.json. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 0-D1-04 | One PR per deliverable (three PRs, not one), each body in the §3.3 shape, each targeting staging. | Auditor review passes the ownership check; no PR touches src/**, package.json or docs/gates/**. | 50mm-developer-1-db-runtime · GitHub / git |

## 0.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 0-D2-01 | Branch d2/P0-web-baseline-20260902 off staging. Write scripts/web-baseline.mjs: entry-bundle and per-chunk byte sizes, per-language chunk sizes (today: translations.rest.ts ≈ 515 KB in one chunk), and an LCP / INP / CLS capture on a mid-range Android profile. Output under docs/evidence/d2/baseline/. | JSON committed with a UTC timestamp on every line; the script runs in CI on its own PR and commits its output. | 50mm-developer-2-client-delivery · GitHub / git |
| 0-D2-02 | Stand up the Web-Vitals harness in report-only mode under tools/uishot/** with a d2-*.yml workflow. It runs on every PR and must not fail a build. Making it blocking is P13 in Phase 5 — not now. | The workflow run on the PR shows the report step executed and the job concluded green regardless of the values reported. | 50mm-developer-2-client-delivery · GitHub / git |
| 0-D2-03 | Record the count and location of every raw <img> (Addendum: 158), every setInterval (21) and every refetchInterval (4) in src/** as a committed baseline so P10 and P11 have a before figure. | docs/evidence/d2/baseline/client-inventory.md with file paths and timestamp. | 50mm-developer-2-client-delivery · GitHub / git |
| 0-D2-04 | Two PRs (harness, baseline script) plus one for the inventory, each body in the §3.3 shape. If a deliverable cannot be written without a new package, stop and request the window — do not add it and mention it in the PR. | Auditor ownership check passes; package.json untouched. | 50mm-developer-2-client-delivery · GitHub / git |

## 0.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 0-AU-01 | Confirm the Gate Register and Phase 0 kickoff are committed on staging under docs/gates/. If not, commit them before either developer opens a branch. | git log on staging shows both files; the register carries 35 rows with the verbatim gate sentences. | 50mm-code-auditor · GitHub / git |
| 0-AU-02 | Record the five standing holds (H-1 to H-5, §3.6) in the Gate Register and the ledger. | Ledger entry dated, holds listed. | 50mm-code-auditor |
| 0-AU-03 | Review every Phase 0 PR: ownership map, one deliverable per PR, body shape, no behaviour change. A PR that changes what a member sees is closed as out of scope. | Review comment names the check applied and the result. | 50mm-code-auditor · GitHub / git |
| 0-AU-04 | Verify the seeder guard from the CI run: open the run, name the step, quote the printed refusal against the production ref. | Evidence line VERIFIED with run ID and quoted output. | 50mm-code-auditor · GitHub / git |
| 0-AU-05 | Verify the Web-Vitals harness ran on a PR and blocked nothing; verify both baseline JSON files carry timestamps on every line. | Evidence lines VERIFIED with run IDs and file paths. | 50mm-code-auditor · GitHub / git |
| 0-AU-06 | Update the Gate Register: a baseline evidence path against every one of the 35 rows. | Register committed; no row without a baseline path. | 50mm-code-auditor · GitHub / git |
| 0-AU-07 | Promotion P-0 — CI and scripts only. Run the nine-step checklist (§3.5) in full; squash-merge; verify production in a real browser; re-check compare/main..staging to zero; write the ledger entry. | Ledger entry with tree hash; compare/main..staging reads 0 / 0 / 0. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |

## 0.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 0-OW-01 | Dispatch apply-migration.yml with supabase/migrations/PROBE_credential_connectivity_readonly.sql against staging to test the staging credential (H-4). It changes nothing. | Run green; Auditor quotes the four server answers. | Owner |
| 0-OW-02 | Set a required reviewer on the production GitHub Environment and untick “allow administrators to bypass” (H-5). | Auditor reads the Environment page in a real browser and records VERIFIED. | Owner |
| 0-OW-03 | Delete the duplicate repository-level SUPABASE_DB_URL secret (shadowed by the environment secrets; can only mislead). | Auditor confirms from the repository Secrets page. | Owner |

## 0.7 · Order of operations

Auditor: 0-AU-01, 0-AU-02.

D1 and D2 in parallel: 0-D1-01 / 0-D2-01 first (the baselines), then 0-D1-02, 0-D2-03, 0-D2-02, and 0-D1-03 (the seeder is the longest item).

Owner, at any point before Phase 1: 0-OW-01, 0-OW-02, 0-OW-03.

Auditor: 0-AU-03 on each PR as it opens; 0-AU-04 and 0-AU-05 on the run outputs; 0-AU-06; then 0-AU-07.

## 0.8 · SQL apply and promotion

SQL apply: none. Phase 0 is read-only against both databases.

Promotion P-0: CI and scripts only, so both lanes share identical gates from day one.

## 0.9 · Exit criteria

Every unit that claims a number has a committed baseline with a timestamp on every line.

The seeder's production-ref guard has been demonstrated failing, and a seeded run's row counts are committed.

The Web-Vitals harness runs on every PR and blocks nothing.

The Gate Register carries a baseline evidence path for all 35 rows.

P-0 promoted; compare/main..staging reads zero; ledger entry written.

H-4 and H-5 settled by the Owner (they are Phase 1 entry conditions).

| Notes the sessions must not miss The seeder is why Phase 0 is a week and not two days. It is worth it: without it P20 and P34 would close as BLOCKED, and every Phase 2–4 measurement would carry “green at 106, unknown at scale”. |
| --- |

# Phase 1 · Close the front door

Units P30, P31, P32, P33. Hours of work. The single biggest safety return in the plan.

## 1.1 · Purpose and units

With nothing but the public API key a stranger can today ask whether an email address belongs to a member, search certificates by a person's name, trigger eight write-or-compute functions without signing in, and set a password already circulating in a breach dump. This phase closes all four.

The order inside the phase is the whole point: the app is checked for every call to those paths before any of them is closed. Revoking a grant the app still calls turns a security fix into an outage.

| Unit | Title | Gate — verbatim from Addendum A. The unit is closed only when this evidence exists. |
| --- | --- | --- |
| P33 | Compromised-password protection enabled, and the remaining catalogue tidied | Leaked-password protection on; the four definer views read, justified and each covered by a cross-member test; the two leftover RLS-enabled tables retired; plpgsql_check moved out of public; get_primary_admin_user_id either closed or its exposure written down. |
| P30 | Account enumeration closed | email_exists removed from the anon role; signup and password-reset responses identical whether or not the address is registered. |
| P31 | Certificate and staff-ID search surface narrowed | Name-based certificate search removed from anon; verification by token retained and tested; verify_staff_id placed behind a session or a rate limit. |
| P32 | Unauthenticated write and compute endpoints closed | Every anon-executable VOLATILE function either requires a session, or sits behind a rate-limited edge function, or has a written justification with a test. |

## 1.2 · Entry conditions — all must be true, committed, before the phase starts

Phase 0 closed (P-0 promoted, compare/main..staging zero).

H-4 settled: the staging credential probe ran green. H-5 settled: a required reviewer exists on the production Environment.

Auditor has committed docs/gates/phase-1-kickoff.md naming the migration block 20260910_0001_*–0099 and the dependency-window state.

Both developers and the Auditor have loaded 50mm-security-reviewer in addition to their role skill.

## 1.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 1-D1-01 | Wait for the frozen revocation list (docs/gates/P1-revocation-list.md, task 1-AU-02). Do not write SQL before it exists. Meanwhile, read — do not call — the bodies of: email_exists, search_certificates, verify_certificate, verify_certificate_by_token, verify_staff_id, the eight VOLATILE anon functions, the four SECURITY DEFINER views, get_primary_admin_user_id, get_public_role_user_ids. Record what each guards and what it returns. | docs/evidence/d1/phase1/function-readings.md — one row per object, quoted source excerpt, timestamp. Read-only. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) |
| 1-D1-02 | Post the object reservation in the phase thread: email_exists, search_certificates, verify_staff_id, the eight volatile functions, the four definer views, categories_migration_dropped, posts_dead_host_backup_20260812, plpgsql_check, get_primary_admin_user_id. | Auditor records the reservation in the kickoff. | 50mm-developer-1-db-runtime |
| 1-D1-03 | P30 SQL. Revoke EXECUTE on email_exists from anon (and from authenticated unless the frozen list says otherwise). If the app genuinely needs an existence check, it goes behind an authenticated or rate-limited server/edge function — never an anon RPC. Apply file plus rollback file in the same PR, filename in the reserved block. | A test that fails before the revoke (anon can call it) and passes after. Catalogue query showing the grant absent, timestamped. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 1-D1-04 | P31 SQL. Revoke search_certificates(_name, _course_title, _issued_date) from anon. Keep verify_certificate(_cert_id) and verify_certificate_by_token(_token) public — verification by unguessable ID or token is correct. Place verify_staff_id(_id_number) behind a session or a rate limit as the frozen list decides. Apply and rollback files. | Tests: anon cannot call name search (fails before, passes after); anon can still verify by token; verify_staff_id refuses an unauthenticated probe. Catalogue grants quoted. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 1-D1-05 | P32. One written disposition per function, then the SQL: recompute_entry_from_tag_assignments(uuid), recompute_entry_public_status(uuid), increment_managed_page_view(text), _gen_competition_order_no(), set_write_path(text), get_broadcast_feed(...) (both forms — if they truly read only, mark them STABLE; if they write, they need a session), record_test_agent_run(p_token, ...) — move the shared secret from an SQL argument to a header. Each is: requires a session · behind a rate-limited edge function (owner of that function is fixed by 1-AU-02) · or a written justification with a test. | docs/evidence/d1/phase1/p32-dispositions.md — eight rows, disposition, reason, test path. Catalogue query showing no anon-executable VOLATILE function remains without a justification row. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 1-D1-06 | P33, definer views. Read entry_public_status, judge_decisions_owner_safe, judge_tag_assignments_owner_safe, judge_comments_owner_safe. Write the justification for each WHERE clause (the security-reviewer false-alarm register says the _owner_safe filters are intended; that is the starting point, not the conclusion). Write the cross-member test for each: as member A and as member B, prove A cannot read B's rows and B cannot read A's; test unauthenticated access separately. | Four justification files and four tests under docs/evidence/d1/phase1/; each test shown failing against a deliberately loosened copy of the view on staging (so it could have failed), then passing against the real one. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 1-D1-07 | P33, catalogue. Move plpgsql_check out of public. For get_primary_admin_user_id(): either revoke from anon, or write the decision that admin and judge ids are public by design (get_public_role_user_ids already does this deliberately) where the next developer will find it. For the two leftover RLS-enabled tables (categories_migration_dropped, posts_dead_host_backup_20260812): behaviour step now — revoke all grants so no role can read or write them; the physical DROP is a contract step and belongs to P27 in A-4c. Record this split as the Auditor rules it (1-AU-03). | Catalogue queries, timestamped: extension schema; grants on the function; zero grants on the two tables. Decision file committed if the function stays open. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 1-D1-08 | P33, leaked-password protection. This is a Supabase Auth dashboard setting, not SQL. Write the one-line request to the Owner (which page, which toggle) and the verification step the Auditor will perform. | Request committed in docs/evidence/d1/phase1/p33-owner-actions.md. | 50mm-developer-1-db-runtime |
| 1-D1-09 | Assemble SQL apply A-1 (staging first). One PR per unit (P30, P31, P32, P33) — four PRs, each with apply + rollback. | Auditor authorises; apply-migration.yml green on staging, then on production, run IDs quoted. | 50mm-developer-1-db-runtime · GitHub / git |

## 1.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 1-D2-01 | Blocking pre-work — before anything is revoked. Branch d2/P1-callsite-inventory-20260910. A complete, read-only inventory in src/** (and functions/**) of every call to email_exists, search_certificates, verify_certificate, verify_certificate_by_token, verify_staff_id, and the eight P32 functions. File, line, what the screen does with the answer. | docs/evidence/d2/phase1/callsite-inventory.md committed and its PR merged to staging before 1-AU-02. Zero call sites for a function is itself a recorded finding with a timestamp. | 50mm-developer-2-client-delivery · GitHub / git |
| 1-D2-02 | P30 client half. Signup and password-reset screens give the same message whether or not the address is registered. Remove every client call to email_exists. Handle the failure path (network error must not leak a different message). | Screenshots of both flows with a registered and an unregistered address, identical wording; a test proving the two responses render identically. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 1-D2-03 | P31 client half. Certificate verification UI keeps the verify-by-ID / by-token path; any name-search UI path is removed. Staff-ID verification UI adapted to the decision in the frozen list. | Verification by token works on staging.50mmretina.com in a real browser; no client code references search_certificates. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 1-D2-04 | P32 client half. Where the frozen list moves a function behind a rate-limited edge function that lives in functions/** (Pages), D2 builds it (e.g. the page-view counter belongs at the edge, never as a database call from an anonymous browser). Where it lives in supabase/functions/**, D1 builds it and D2 only changes the call. | The app never calls a revoked path: a typecheck/lint pass plus a real-browser walk of the affected screens on staging, recorded. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) · Cloudflare MCP |
| 1-D2-05 | One PR per unit-half; bodies in the §3.3 shape. | Auditor ownership check passes. | 50mm-developer-2-client-delivery · GitHub / git |

## 1.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 1-AU-01 | Commit docs/gates/phase-1-kickoff.md: units, owner per unit, migration block 20260910_*, dependency window (recommend closed), the interface rule that the revocation list is frozen after D2's inventory and before D1's SQL. | Kickoff on staging before either developer branches. | 50mm-code-auditor · GitHub / git |
| 1-AU-02 | On receipt of 1-D2-01: freeze the revocation list in docs/gates/P1-revocation-list.md — for each function, the grant change, and for P32 where any replacement lives (functions/** = D2; supabase/functions/** = D1). Neither developer changes it unilaterally. | File committed; both developers read it (their PR bodies cite it). | 50mm-code-auditor · 50mm-security-reviewer · GitHub / git |
| 1-AU-03 | Rule in writing on P33's clause “the two leftover RLS-enabled tables retired”: this plan recommends *retired = all grants revoked in Phase 1 (behaviour), physical DROP deferred to P27 / A-4c (contract)*, because a drop is a contract step and the same tables are named by P27. Record the ruling so P33 can close VERIFIED at P-1 with the drop clause carried to Phase 4. | Ruling in the kickoff and the Gate Register row for P33. | 50mm-code-auditor |
| 1-AU-04 | Review each D1 PR with the security-reviewer reject rules: definer view without an owner-isolation test → reject; EXECUTE to anon on anything VOLATILE or person-answering → reject; secret as SQL argument → reject; any test not shown failing on the unfixed input → reject. | Review comment cites the rule number applied. | 50mm-code-auditor · 50mm-security-reviewer · GitHub / git |
| 1-AU-05 | Verify the leaked-password toggle from the Supabase Auth settings page in a real browser after the Owner sets it (1-OW-01). | Evidence line VERIFIED with a screenshot; if only the Owner's word exists, OWNER-ATTESTED — never upgraded silently. | 50mm-code-auditor · Claude in Chrome (real browser) |
| 1-AU-06 | Authorise A-1 on staging. Then verify on staging.50mmretina.com in a real browser: signup and reset messages identical; verify-by-token works; the affected screens still work. Read the catalogue grants via SELECT (Supabase MCP, staging) — never by calling the function to prove it leaks. | Evidence lines per unit, VERIFIED, timestamped. | 50mm-code-auditor · 50mm-security-reviewer · Supabase MCP (read-only) · Claude in Chrome (real browser) |
| 1-AU-07 | Authorise A-1 on production (identical files). Repeat the verification on www.50mmretina.com. Close P30, P31, P32, P33 in the Gate Register with the Requirement → Instrument → Evidence → Result → Status line each. | Register updated; every clause of every gate has its own evidence line. | 50mm-code-auditor · 50mm-security-reviewer · Supabase MCP (read-only) · Claude in Chrome (real browser) |
| 1-AU-08 | Promotion P-1 after A-1 is green on both lanes and D2's client changes are live on staging. Nine-step checklist; ledger; compare zero. | Ledger entry with tree hash; compare/main..staging 0 / 0 / 0. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |

## 1.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 1-OW-01 | Switch on leaked-password (compromised-password) protection in the Supabase Auth settings for both projects, per 1-D1-08. | Auditor verifies (1-AU-05). | Owner |
| 1-OW-02 | Approve the production Environment run for A-1 when the required-reviewer prompt appears. | Run proceeds. | Owner |

## 1.7 · Order of operations

Auditor: 1-AU-01 (kickoff).

D2: 1-D2-01 (inventory) — merged to staging. D1 in parallel: 1-D1-01 (read-only readings), 1-D1-02 (reservation).

Auditor: 1-AU-02 (freeze the revocation list), 1-AU-03 (P33/P27 ruling).

D1: 1-D1-03 … 1-D1-08 (SQL, tests, dispositions). D2 in parallel: 1-D2-02 … 1-D2-04 against the frozen list. Owner: 1-OW-01.

Auditor: 1-AU-04 on each PR; 1-AU-05.

D1: 1-D1-09 → Auditor 1-AU-06 (staging) → Owner 1-OW-02 → Auditor 1-AU-07 (production).

Auditor: 1-AU-08 (P-1).

## 1.8 · SQL apply and promotion

A-1: grant revocations, view justifications, extension move — small, reversible, each with its rollback file. Staging → verify in a real browser → production.

Promotion P-1: after A-1 is green on both lanes and D2's client changes are live on staging.

## 1.9 · Exit criteria

P30, P31, P32, P33 read VERIFIED in the Gate Register (P33's drop clause recorded as carried to A-4c per 1-AU-03).

No client code path calls a revoked function (inventory re-run after the change reads zero).

A-1 green on both lanes with run IDs; P-1 promoted; compare zero; ledger written.

| Notes the sessions must not miss record_test_agent_run is defensible — it authenticates by token, a real decision. The finding is only that a secret in an SQL argument lands in pg_stat_statements; move it to a header. The security-reviewer skill's false-alarm register lists things that must not be “fixed”: the _owner_safe views' security_invoker, the committed .env, the admin_* grants that guard themselves. Re-raising them without new evidence is a wasted review. P31 is paired with P25 (Phase 6): when certificates move to R2, the object key becomes the verification token. The Auditor re-checks at Phase 6 that nothing done here contradicts that. |
| --- |

# Phase 2 · Stop the machine talking to itself

Units P1, P2, P10. Days of work plus a real seven-day measurement window. The largest single saving in the plan.

## 2.1 · Purpose and units

Every open browser tab writes to profiles every five minutes to keep a green dot lit — per tab, not per member — and each write drags a full-row photocopy through the realtime change log because three published tables carry REPLICA IDENTITY FULL. The realtime decode query alone was 50.9 % of all database time; profiles was 64.2 % dead rows.

P1 and P2 remove the cause. P10 applies the same discipline to the other twenty client timers, copying the pattern that already exists in useEngagementHeartbeat.ts.

| Unit | Title | Gate — verbatim from Addendum A. The unit is closed only when this evidence exists. |
| --- | --- | --- |
| P1 | Presence removed from the durable write path | profiles receives no write from a client timer; presence is served from memory; the profiles dead-row ratio measured below 10 % for seven consecutive days. |
| P2 | Replica identity corrected on published tables | No table in the realtime publication carries REPLICA IDENTITY FULL without a written justification; the realtime decode query's share of total database time is re-measured and recorded. |
| P10 | Client timer discipline | No timer fires more often than once a second; every repeating timer is cleared on visibilitychange; battery and jank measured on a mid-range Android device before and after. |

## 2.2 · Entry conditions — all must be true, committed, before the phase starts

Phase 1 closed. Migration block 20260920_0001_*–0099 named in docs/gates/phase-2-kickoff.md.

`docs/gates/P1-interface.md` exists — the frozen signature for “record presence” and “record session end”. D2 codes against it; D1 implements behind it. If the file does not exist, P1 has not started.

The real-device runbook (§2.4) exists, or D2 writes it as 2-D2-01 before measuring.

## 2.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 2-D1-01 | Object reservation: profiles, scheduled_posts, competition_round_publish, the realtime publication, plus whatever presence store the interface names. | Recorded in the kickoff. | 50mm-developer-1-db-runtime |
| 2-D1-02 | P1 server half. Implement the presence endpoint behind the frozen signature: presence served from memory (the mechanism chosen is recorded with its reason); last_active_at / last_platform written once per session end, or batched server-side — never from a client timer. Copy the engagement heartbeat's two-tab resolution (in the database, not client leader election). Failure path: a session that ends without the signal (crash, kill) still gets a bounded last-seen. | A test that fails while the old 5-minute UPDATE path exists and passes when removed; pg_stat_statements shows the two UPDATE variants (baseline 12,740 calls / 843,574 ms) at zero new calls after cut-over, timestamped. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 2-D1-03 | P2. REPLICA IDENTITY on profiles, scheduled_posts, competition_round_publish set to DEFAULT (or an index) with the reason in the migration header. For every table in the publication, a one-line written justification of its row format in docs/evidence/d1/phase2/replica-identity.md. Apply + rollback. | Catalogue query: no published table with relreplident = 'f' without a justification row. The realtime decode query's share of total database time re-measured against the 50.9 % baseline and recorded with instrument and timestamp. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 2-D1-04 | The seven-day window. After A-2 and the client cut-over are live on staging: read the profiles dead-row ratio once a day for seven consecutive days (baseline 64.2 %). Record each reading. The window is real elapsed time; it is not shortened. | docs/evidence/d1/phase2/profiles-deadrows-7day.md — seven dated readings, all below 10 %. If any day reads ≥ 10 %, the window restarts and the reason is recorded. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 2-D1-05 | Assemble SQL apply A-2 (the replica-identity change — configuration, not code). One PR for P2; P1's server half in its own PR. | Auditor authorises; staging then production green, run IDs quoted. | 50mm-developer-1-db-runtime · GitHub / git |

## 2.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 2-D2-01 | Write the real-device runbook docs/evidence/d2/runbook-android.md: device model, how to read battery drain over a fixed 10-minute feed session, how to capture jank (frame drops) and Web Vitals, screenshots required, file naming. The Owner will execute it; it must be followable without the session. | Runbook committed and reviewed by the Auditor before the first measurement. | 50mm-developer-2-client-delivery · GitHub / git |
| 2-D2-02 | Before measurement (P10). Owner executes the runbook on the unfixed app; D2 files the results. | docs/evidence/d2/phase2/p10-before.md with readings and screenshots, marked OWNER-ATTESTED. | 50mm-developer-2-client-delivery · Real-device runbook (Owner executes) |
| 2-D2-03 | P1 client half. src/hooks/core/useLastActive.ts: remove the 5-minute setInterval UPDATE and the immediate-on-mount write. Call the frozen presence signature; send the session-end signal on pagehide / visibilitychange-hidden following useEngagementHeartbeat.ts — copy that pattern, do not invent a new one. Failure path: the signal must be best-effort and never block unload. | A grep of src/** shows no client write to profiles.last_active_at; a test that fails on the old hook and passes on the new; the presence dot still renders on staging in a real browser. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 2-D2-04 | P10. Work through the baseline inventory (0-D2-03): AdZone.tsx 200 ms timer removed, or ≥ 1 s, or event-driven; the six 1-second countdowns / session timers / phase banners derive the displayed time from a timestamp at render or use requestAnimationFrame where a continuous visual is genuinely needed; useFeedEventTracker.ts 5-second flush and the four refetchInterval polls (30 s, 30 s, 60 s, 90 s) reviewed and justified or slowed; every repeating timer cleared on `visibilitychange`. Reason left in each file. | Committed inventory after: no timer under 1 s; every repeating timer names its visibilitychange cleanup; a lint or test that fails on a bare setInterval without cleanup (shown failing first). | 50mm-developer-2-client-delivery · GitHub / git |
| 2-D2-05 | After measurement (P10). Owner re-executes the runbook on the fixed build on staging; D2 files the results beside the before figures. | docs/evidence/d2/phase2/p10-after.md, same instrument, same device, same procedure, OWNER-ATTESTED; harness Web-Vitals readings VERIFIED. | 50mm-developer-2-client-delivery · Real-device runbook (Owner executes) |
| 2-D2-06 | One PR per unit-half (P1 client, P10). Bodies in §3.3 shape, citing P1-interface.md. | Auditor ownership and interface check passes. | 50mm-developer-2-client-delivery · GitHub / git |

## 2.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 2-AU-01 | Commit docs/gates/phase-2-kickoff.md (block 20260920_*, window state, the seven-day rule stated as a promotion condition). | On staging before branching. | 50mm-code-auditor · GitHub / git |
| 2-AU-02 | Freeze the P1 interface in docs/gates/P1-interface.md: the RPC/endpoint name, arguments, return, error behaviour, and the session-end signal. Neither developer may change it without the Auditor reopening it in writing. | File committed before either P1 PR is opened. | 50mm-code-auditor · GitHub / git |
| 2-AU-03 | Review the runbook (2-D2-01) for the property that it could produce a worse reading — a procedure that cannot show regression is not an instrument. | Review comment recorded. | 50mm-code-auditor |
| 2-AU-04 | Review PRs: P2 justification per published table present; P10 test shown failing first; P1 client half contains no direct profiles write; both halves cite the same interface file. | Review comments cite the check. | 50mm-code-auditor · GitHub / git |
| 2-AU-05 | Authorise A-2 on staging; verify the replica identity change by catalogue SELECT; verify presence still works on staging.50mmretina.com in a real browser with two tabs open. | Evidence lines VERIFIED. | 50mm-code-auditor · Supabase MCP (read-only) · Claude in Chrome (real browser) |
| 2-AU-06 | Authorise A-2 on production after staging is green and the client cut-over is on staging. Verify on www.50mmretina.com. | Evidence lines VERIFIED. | 50mm-code-auditor · Supabase MCP (read-only) · Claude in Chrome (real browser) |
| 2-AU-07 | Verify each of the seven daily dead-row readings by running the same SELECT (read-only) — do not accept the file alone. Classify P10 device readings OWNER-ATTESTED and harness readings VERIFIED, separately. | Seven evidence lines with the Auditor's own reading beside D1's. | 50mm-code-auditor · Supabase MCP (read-only) |
| 2-AU-08 | Close P1, P2, P10. Promotion P-2 only after day seven reads green. Nine-step checklist; ledger; compare zero. Phase 3 work may begin during the window, but P-2 does not. | Ledger entry; compare 0 / 0 / 0. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |

## 2.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 2-OW-01 | Execute the Android runbook twice (before, after) and return readings and screenshots to D2. | Files under docs/evidence/d2/phase2/. | Owner |
| 2-OW-02 | Approve the production run for A-2. | Run proceeds. | Owner |

## 2.7 · Order of operations

Auditor: 2-AU-01, 2-AU-02 (interface freeze).

D2: 2-D2-01 (runbook) → Auditor 2-AU-03 → Owner 2-OW-01 (before) → D2 2-D2-02.

D1 and D2 in parallel: 2-D1-01, 2-D1-02, 2-D1-03 / 2-D2-03, 2-D2-04.

Auditor: 2-AU-04; D1 2-D1-05 → Auditor 2-AU-05 (staging) → Owner 2-OW-02 → Auditor 2-AU-06 (production).

Owner 2-OW-01 (after) → D2 2-D2-05. D1 2-D1-04 (seven daily readings) with Auditor 2-AU-07 alongside.

Auditor: 2-AU-08 on day seven.

## 2.8 · SQL apply and promotion

A-2: replica identity — configuration, not code. Staging → verify → production.

Promotion P-2: after the seven-day dead-row window closes green. Not before.

## 2.9 · Exit criteria

P1, P2, P10 VERIFIED; the seven readings are in the register with the Auditor's own confirmation.

Realtime decode share re-measured and recorded against 50.9 %.

P-2 promoted; compare zero; ledger written.

| Notes the sessions must not miss P8 (Phase 4) is what proves P1 worked over a full week under normal traffic. The Phase 2 seven-day readings are the first half of that evidence; keep the same query and the same instrument so the two are comparable. |
| --- |

# Phase 3 · Make the live features actually live

Units P3, P4, P5, P7, P9. Eleven features that look like they work and never have; 580,000 database requests for 35 rows; robots asking every ten seconds.

## 3.1 · Purpose and units

The app opens 56 realtime subscriptions across 26 files on 32 tables; the database publishes 29. Eleven tables the app listens to are not published (including admin_notifications); eight are published to nobody. Configuration identical for every member is read from the database ≈ 14,100 times a day. Three hot cron jobs poll every 5 s, 10 s and 60 s. Three introspection queries cost 10.3 % of database time, and the outbound HTTP helper decrypts a vault secret on every one of 422,342 calls.

The lasting output is a machine check that fails the build in both directions whenever the app's subscriptions and the database's publication disagree.

| Unit | Title | Gate — verbatim from Addendum A. The unit is closed only when this evidence exists. |
| --- | --- | --- |
| P3 | Subscription-to-publication parity, enforced at build time | The build fails when the application subscribes to a table that is not published, or a table is published that nothing subscribes to. The current mismatch is resolved in both directions first. |
| P4 | Configuration served from the edge, not the database | site_settings read count from the API falls by at least two orders of magnitude; no unfiltered full-table read of site_settings remains in any code path. |
| P5 | Polling replaced by events | No scheduled job runs more often than once a minute unless it is demonstrably saturated; queue workers are woken by an event; idle back-off is implemented and its effect measured. |
| P7 | Schema-cache reload discipline | No schema-cache reload is triggered outside a deployment; the introspection queries' share of database time is re-measured and recorded. |
| P9 | Vault secret decrypted once per worker, not once per message | The outbound HTTP helper no longer performs an inline vault.decrypted_secrets lookup per call. |

## 3.2 · Entry conditions — all must be true, committed, before the phase starts

Phase 2's A-2 is live on both lanes (P-2 may still be waiting on its seven-day window — that is allowed).

docs/gates/phase-3-kickoff.md committed, naming the migration block and the owner of the comparator script.

`docs/gates/P3-parity-schema.md` exists — the frozen JSON schema both producers emit.

docs/gates/P3-dispositions.md exists with a written disposition for each of the 11 unpublished and 8 unconsumed tables before any P3 PR is reviewed.

## 3.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 3-D1-01 | Object reservation: the realtime publication, the sixteen cron jobs, the outbound HTTP helper (net.http_post wrapper), the vault access path, the queue tables. | Recorded in the kickoff. | 50mm-developer-1-db-runtime |
| 3-D1-02 | Propose dispositions for the eight published-but-unconsumed tables (certificates, competitions, featured_artists, image_comments, image_reactions, journal_articles, photo_of_the_day, post_shares): remove from the publication unless a documented reason to retain exists. | Rows in docs/gates/P3-dispositions.md (Auditor's file — D1 submits, Auditor commits). | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 3-D1-03 | P3 DB half. scripts/db-publication-export.mjs emits the publication list as JSON in the frozen schema. Publication corrected in both directions per the dispositions: add the tables whose features are to work, remove the eight. Apply + rollback. | Export committed under docs/evidence/d1/phase3/publication.json; catalogue query of pg_publication_tables matches it, timestamped. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 3-D1-04 | P5. Replace clock-driven polling with event-driven wake-up: LISTEN/NOTIFY from the enqueueing transaction (cheaper first step) or a queue service — either satisfies the unit; record the choice and reason. Where polling must remain, back off ≈ 5 s active / 60 s idle. Cron cadence: process_post_jobs(100) every 5 s, the process-email-queue HTTP call every 10 s, publish-scheduled-posts every minute — none faster than once a minute unless demonstrably saturated (show the saturation reading if claimed). | Cron table SELECT showing schedules; pg_stat_statements before/after for the queue read (baseline 702,154 calls) and email_send_state reads (baseline 351,031 on an empty table); a test that fails while the 5-second job exists. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 3-D1-05 | P9. The outbound HTTP helper loads and decrypts the vault secret once during worker initialisation, reuses it per message, re-reads on worker restart or rotation, and never persists the plaintext to the database. Best done inside the P5 worker change. | Function source shows no inline vault.decrypted_secrets lookup per call; pg_stat_statements shows the per-call decrypt gone (baseline 422,342), timestamped. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 3-D1-06 | P7. Find what triggers schema-cache reloads outside deployments (NOTIFY pgrst, DDL in functions or jobs, the 28,624 publication-list checks, the 2,744 × 798 ms pg_timezone_names reads). Remove or move each to deployment time. Reason recorded. | Re-measured share of the three introspection queries against the 10.3 % / 58-minute baseline, timestamped; a log window showing no reload outside a deployment. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 3-D1-07 | Assemble SQL apply A-3: publication changes, cron cadence, notify triggers, helper change. One PR per unit. | Auditor authorises; staging then production green. | 50mm-developer-1-db-runtime · GitHub / git |

## 3.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 3-D2-01 | Propose dispositions for the eleven subscribed-but-unpublished tables (ad_creative_reactions, admin_notifications, admin_vote_adjustments, badge_definitions, comments, judge_comments, judge_sessions, judge_tag_assignments, judging_preflight_log, role_display_config, site_settings): make it work (publish) or remove the subscription honestly. `admin_notifications` — an admin alerting feature that does not alert — must be decided explicitly. | Rows submitted to docs/gates/P3-dispositions.md. | 50mm-developer-2-client-delivery · GitHub / git |
| 3-D2-02 | P3 app half. scripts/web-subscription-scan.mjs emits the app's subscription list as JSON in the frozen schema. Reconcile the 56 subscriptions across 26 files per the dispositions. Remove the permanently-open channels on configuration tables (site_settings, role_display_config, badge_definitions, courses, support_tickets). | Scan committed under docs/evidence/d2/phase3/subscriptions.json; the removed channels no longer appear; the features kept receive events on staging in a real browser (evidence: the screen updates without reload). | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 3-D2-03 | The comparator (if assigned to D2 in the kickoff): scripts/web-parity-check.mjs reads both JSON files and fails the build in both directions, wired into web-build.yml. Shown failing on the current mismatch first. | CI run on the PR showing the check fail on the pre-fix lists, then pass after both sides are corrected; run IDs quoted. | 50mm-developer-2-client-delivery · GitHub / git |
| 3-D2-04 | P4. Configuration out of the database request path. Option A: versioned, immutable JSON at the CDN edge (functions/**) with a version stamp; Option B: genuinely static settings baked into the bundle and redeployed on change. Record the decision. Keep siteSettingsCache.ts as the pattern for whatever remains dynamic. Remove every unfiltered full-table read of site_settings (baseline 6,437 calls at 4.2 ms). | API read count of site_settings re-measured over a comparable window against the ≈ 580,000 / 41-day baseline: down by at least two orders of magnitude; a grep shows no unfiltered site_settings read in any code path. | 50mm-developer-2-client-delivery · GitHub / git · Cloudflare MCP |
| 3-D2-05 | One PR per unit-half (P3 app, comparator, P4). Bodies in §3.3 shape citing P3-parity-schema.md and P3-dispositions.md. | Auditor check passes. | 50mm-developer-2-client-delivery · GitHub / git |

## 3.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 3-AU-01 | Commit docs/gates/phase-3-kickoff.md: migration block, window state, who owns the comparator script (this plan recommends D2 as scripts/web-parity-check.mjs, because the build it fails is web-build.yml; the recommendation is not a decision until recorded). | On staging before branching. | 50mm-code-auditor · GitHub / git |
| 3-AU-02 | Freeze the parity JSON schema in docs/gates/P3-parity-schema.md. Each developer owns their producer; neither edits the other's. | File committed before either producer PR opens. | 50mm-code-auditor · GitHub / git |
| 3-AU-03 | Collect and commit docs/gates/P3-dispositions.md: nineteen rows (11 + 8), each with make-work / remove / retain-with-reason. No P3 PR is reviewed before this file exists. | File committed; every row has a decision and a reason. | 50mm-code-auditor · GitHub / git |
| 3-AU-04 | Review PRs: the comparator shown failing first; P4 decision recorded; P5 event-driven not merely re-tuned polling; P9 plaintext never persisted; P7 measured not asserted. | Review comments cite the check. | 50mm-code-auditor · 50mm-security-reviewer · GitHub / git |
| 3-AU-05 | Authorise A-3 on staging. Verify: parity check green on staging; pg_publication_tables by SELECT; cron schedules by SELECT; a kept realtime feature updating live in a real browser; the site_settings read count re-measured by the Auditor's own query. | Evidence lines VERIFIED per gate clause. | 50mm-code-auditor · Supabase MCP (read-only) · Claude in Chrome (real browser) |
| 3-AU-06 | Authorise A-3 on production; repeat verification on www.50mmretina.com. Close P3, P4, P5, P7, P9. | Register updated. | 50mm-code-auditor · Supabase MCP (read-only) · Claude in Chrome (real browser) |
| 3-AU-07 | Promotion P-3 after the parity check is green on staging and the site_settings read count has fallen by at least two orders of magnitude. Nine-step checklist; ledger; compare zero. | Ledger entry; compare 0 / 0 / 0. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |

## 3.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 3-OW-01 | Approve the production run for A-3. | Run proceeds. | Owner |

## 3.7 · Order of operations

Auditor: 3-AU-01, 3-AU-02 (schema freeze).

D1 3-D1-02 and D2 3-D2-01 (dispositions) → Auditor 3-AU-03 commits the disposition file.

D1: 3-D1-01, 3-D1-03 … 3-D1-06. D2 in parallel: 3-D2-02, 3-D2-03, 3-D2-04.

Auditor 3-AU-04; D1 3-D1-07 → Auditor 3-AU-05 (staging) → Owner 3-OW-01 → Auditor 3-AU-06 (production).

Auditor: 3-AU-07 (P-3).

## 3.8 · SQL apply and promotion

A-3: publication changes, cron cadence, notify triggers, helper change. Staging → verify → production.

Promotion P-3: after the parity check is green on staging and the site_settings read count has fallen ≥ 100×.

## 3.9 · Exit criteria

P3, P4, P5, P7, P9 VERIFIED.

The parity check runs on every build and has been seen failing on a deliberate mismatch.

Nineteen dispositions recorded; admin_notifications either alerts on staging in a real browser or is honestly removed.

P-3 promoted; compare zero; ledger written.

# Phase 4 · Clear out the filing room

Units P6, P8, P26, P27, P28, P34, P35 and the C-2 reconciliation. Engine-room phase; three separate SQL applies; the least reversible work in the plan.

## 4.1 · Purpose and units

The database is 135 MB and cron.job_run_details is 76 MB of it. Thirteen leftover tables and a copy of posts from 12 August are still in production. Six tables have no primary key, which blocks X9 replica readiness. The audit log stores two full row copies per change. Role checks scan user_roles 234,546 times from inside policies — a cost the profiler cannot see and that becomes impossible at scale.

Because this phase drops things, it is split into expand (A-4a) → behaviour (A-4b) → contract (A-4c), and nothing is dropped until a week after the promotion that depends on it.

| Unit | Title | Gate — verbatim from Addendum A. The unit is closed only when this evidence exists. |
| --- | --- | --- |
| P6 | Cron run-log retention and batched purge | cron.job_run_details retention set to 24–48 hours; purge runs in bounded batches; the table is no longer among the ten largest in the database. |
| P8 | Autovacuum tuned on the churning tables | Each named table's dead-row ratio measured below 10 % across a full week under normal traffic. |
| P26 | Audit-log scope and retention | Audit triggers limited to money, permissions and deletions; the change stored rather than two full row copies; rows older than a stated window moved out of the live database. |
| P27 | Leftover tables and backups retired | Each named table dropped or given a written reason to exist, with a rollback recorded. |
| P28 | Index-to-table ratio as a review gate | No table ships with more index than heap without a written reason; the ratio checked at review. |
| P34 | Role checks made index-only, and the invisible cost made visible | user_roles sequential scans measured at approximately zero after the change; every role check in a policy or helper function demonstrably uses the (user_id, role) index; the measurement repeated on seeded data at 1 million rows; and the effective access-control behaviour before and after any policy consolidation proven identical. |
| P35 | Primary keys and remaining catalogue hygiene | Every table has a primary key or a written reason not to; the duplicate index pairs dropped; post_hashtags.author_id indexed. |

## 4.2 · Entry conditions — all must be true, committed, before the phase starts

Phase 3 closed.

X1 and X2 (RLS policy consolidation) have landed — H-2. P34's gate cannot honestly close without them. If they have not landed, P34 is marked BLOCKED in the kickoff and the rest of the phase proceeds.

docs/gates/phase-4-kickoff.md committed with the migration block, the three-apply schedule (48 h between 4a and 4b; 7 days between P-4 and 4c), and the rule for D2's run-ahead PRs (4-AU-02).

The seeder (0-D1-03) works — P34's 1-million-row clause needs it.

## 4.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 4-D1-01 | Object reservation: cron.job_run_details, the audit trigger set (17 of 149 triggers), the thirteen leftover tables, the six tables without primary keys, the two duplicate index pairs, post_hashtags, user_roles, the RLS policies and helper functions that read user_roles, autovacuum settings on profiles, user_devices, user_notifications, activity_logs. | Recorded in the kickoff. | 50mm-developer-1-db-runtime |
| 4-D1-02 | C-2 reconciliation (H-1). Reconcile the four unused-index counts (79 / 78 / 298-of-which-125 / 188) to one published method: the filter, the window, the exclusions (primary-key and unique-constraint indexes must stay). Publish the method and the resulting list. Only then propose drops — as a separate list, for A-4c. | docs/evidence/d1/phase4/unused-index-method.md with the query, the count, the timestamp, and the droppable list. The Auditor lifts H-1 in writing or does not. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 4-D1-03 | A-4a EXPAND (additive only). P35: primary keys on the six tables (or a written reason not to); index on post_hashtags.author_id. P8: per-table autovacuum settings on the four churning tables (user_devices has never been vacuumed after 6,781 writes). P6: retention setting for cron.job_run_details at 24–48 h. Nothing dropped. Apply + rollback per unit. | Catalogue SELECTs: every table has a PK or a reason row; the FK index exists; reloptions show the autovacuum settings. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 4-D1-04 | A-4b BEHAVIOUR. P6: the purge of cron.job_run_details runs in bounded batches (baseline: single deletes averaging 6,436 ms). P26: audit triggers limited to money, permissions and deletions; the audit row stores the change (diff), not old_data + new_data; rows older than a stated window moved out of the live database. P34: every role check in a policy or helper function uses the (user_id, role) index; auth.uid() wrapped as (select auth.uid()) wherever it is evaluated per row; multiple permissive policies for the same table/action/role consolidated into one only where behaviour is provably equivalent. | P6: purge run durations after change; cron.job_run_details no longer in the ten largest tables. P26: trigger list and a sample audit row. P34: the equivalence proof — a test matrix per affected table × action × role (anon, authenticated member A, member B, admin, judge) run before and after with identical results, committed; user_roles seq_scan counter ≈ 0 over a window after the change (baseline 234,546). | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 4-D1-05 | P34 at scale. Run the seeder on staging to 1 million rows; repeat the user_roles scan measurement and the equivalence matrix on seeded data. | docs/evidence/d1/phase4/p34-1m.md with row counts, the seq-scan reading and the matrix result, timestamped. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 4-D1-06 | P8 measurement week. Dead-row ratio for profiles, user_devices, user_notifications, activity_logs read daily for seven days under normal traffic after A-4a. | Seven dated readings per table, all below 10 %. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 4-D1-07 | P28. scripts/db-index-ratio.mjs: reports index-size / heap-size per table; a written rule in docs/evidence/d1/phase4/index-ratio-rule.md that no table ships with more index than heap without a reason row; the check wired into the D1 review path (verify-schema-dependencies.yml or a d1-*.yml). | The check shown flagging competition_entries (48 kB heap / 712 kB index) on the current catalogue; the rule file committed. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 4-D1-08 | A-4c CONTRACT (drops) — prepared now, applied only after P-4 has been live seven days. P27: the thirteen tables (wallet_ledger_v2_diff_log, v3_mirror_log, round_snapshots, wallet_ledger_v2_rows, wallet_ledger_v2_shadow_log, judging_preflight_log, posts_dead_host_backup_20260812, _v3_preflight_snapshot_competition_entries, _v3_preflight_snapshot_judging_tags, _v3_preflight_snapshot_judge_decisions, _v3_preflight_snapshot_judge_tag_assignments, _v3_quarantine_tag_assignments, _v3_quarantine_decisions) plus categories_migration_dropped carried from P33 — each dropped or given a written reason to exist, with a rollback recorded (a dump of each table taken before the drop, location named). P35: the duplicate index pairs (idx_feed_events_post / idx_feed_events_post_id; judge_decisions_entry_judge_round_photo_unique / judge_decisions_unique_per_judge_round_photo) dropped, one of each pair. Any index the C-2 method proves droppable. Note wallet_ledger_v2_diff_log is the W4 shadow the Master Plan says should be closed out — its closure is recorded as such. | Per table: the disposition row, the rollback artefact path, the catalogue SELECT after the drop. Applied to staging first, then production, each only after the Auditor's dated authorisation. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |

## 4.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 4-D2-01 | Run ahead on Phase 5. Branch and build P11, P12, P15, P16 and P21 (see Phase 5 for the task detail). Their gates close in Phase 5 and ride Promotion P-5 unless the Auditor rules otherwise (4-AU-02). | Branches off staging; PRs opened in the §3.3 shape; each PR states that its gate is closed in Phase 5. | 50mm-developer-2-client-delivery · GitHub / git |
| 4-D2-02 | Provide any client-side reading the P34 equivalence matrix needs (which screens exercise which policies), read-only, as a committed note. | docs/evidence/d2/phase4/policy-screens.md. | 50mm-developer-2-client-delivery · GitHub / git |

## 4.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 4-AU-01 | Commit docs/gates/phase-4-kickoff.md: units, block, the three-apply schedule with its two elapsed-time waits, P34's status against H-2, the run-ahead rule. | On staging before branching. | 50mm-code-auditor · GitHub / git |
| 4-AU-02 | Rule on run-ahead PRs in writing. This plan recommends: D2's Phase 5 PRs may merge to staging during Phase 4 only if their gate is VERIFIED before P-4 is cut; otherwise they stay open (rebased) until Phase 5. Reason: checklist step 5 stops any file no closed unit explains. | Rule in the kickoff. | 50mm-code-auditor |
| 4-AU-03 | Review the C-2 method (4-D1-02). Lift H-1 in a dated ledger entry, or keep it and say why. No drop PR is opened while H-1 stands. | Ledger entry. | 50mm-code-auditor · Supabase MCP (read-only) |
| 4-AU-04 | Authorise A-4a on staging, then production. Verify by catalogue SELECT. | Evidence lines VERIFIED. | 50mm-code-auditor · Supabase MCP (read-only) |
| 4-AU-05 | Wait 48 h with A-4a stable (health workflow and error logs quiet). Then review A-4b PRs with the security-reviewer rules — the P34 equivalence matrix must have been shown failing on a deliberately altered policy (so it could have failed). Authorise A-4b staging → production. | Dated 48-h reading; evidence lines VERIFIED. | 50mm-code-auditor · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 4-AU-06 | Verify P34 at 1 M rows by re-running the seq-scan query on seeded staging (own reading). Verify the seven P8 readings by own SELECT. | Evidence lines with the Auditor's reading beside D1's. | 50mm-code-auditor · Supabase MCP (read-only) |
| 4-AU-07 | Close P6, P8, P26, P28, P34, P35 (drop clauses of P35 and all of P27 marked DEFERRED to A-4c, explicitly). Promotion P-4 — after A-4a and A-4b, before A-4c. Nine-step checklist; ledger; compare zero. | Ledger entry; compare 0 / 0 / 0. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |
| 4-AU-08 | Wait seven days with P-4 live and stable. Then authorise A-4c on staging, verify, then production. Close P27 and the drop clauses of P35 and P33. | Dated seven-day reading; evidence lines per dropped object with rollback path. | 50mm-code-auditor · Supabase MCP (read-only) · Claude in Chrome (real browser) |

## 4.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 4-OW-01 | Schedule X1 / X2 (RLS policy consolidation — “the highest-value performance work in the database”) before this phase so P34 can close (H-2). They are existing Master Plan items, owned by D1 when scheduled. | Ledger records the ruling and the date. | Owner |
| 4-OW-02 | Approve the three production runs (A-4a, A-4b, A-4c) as each is authorised. | Runs proceed. | Owner |

## 4.7 · Order of operations

Owner 4-OW-01 → Auditor 4-AU-01, 4-AU-02.

D1: 4-D1-01, 4-D1-02 → Auditor 4-AU-03 (H-1 ruling). D2 in parallel: 4-D2-01 (run ahead), 4-D2-02.

D1: 4-D1-03 → Auditor 4-AU-04 (A-4a) → 48 h → D1 4-D1-04 → Auditor 4-AU-05 (A-4b).

D1: 4-D1-05, 4-D1-06, 4-D1-07 → Auditor 4-AU-06 → 4-AU-07 (P-4).

Seven days → D1 4-D1-08 → Auditor 4-AU-08 (A-4c).

## 4.8 · SQL apply and promotion

A-4a EXPAND: primary keys, FK index, autovacuum, retention settings. Nothing dropped.

A-4b BEHAVIOUR: batched purge, audit-trigger scope, role-check index path and policy consolidation. After 48 h of A-4a stability.

Promotion P-4: after A-4a and A-4b, before A-4c.

A-4c CONTRACT: the thirteen tables, the duplicate index pairs, C-2-proven indexes. Only after P-4 has been live and stable for seven days.

## 4.9 · Exit criteria

P6, P8, P26, P28, P34, P35 VERIFIED (P34 including the 1-M-row reading and the equivalence proof); P27 VERIFIED after A-4c.

H-1 lifted or explicitly kept; no index dropped on an unreconciled number.

A-4c applied with a rollback artefact per object; cron.job_run_details out of the ten largest tables.

P-4 promoted; compare zero; ledger written.

| Notes the sessions must not miss Do not blindly merge policies. P34's gate is not met by a faster query; it is met by proving the effective access-control behaviour before and after is identical. The matrix is the evidence, and the Auditor must see it fail on a deliberately broken policy first. |
| --- |

# Phase 5 · The part members feel

Units P11, P12, P13, P14, P15, P16, P17, P18, P21, P22, P23, P24. No database change. Shop-floor phase; D1 runs ahead on Phase 7 groundwork.

## 5.1 · Purpose and units

“The server answers in 19 ms; the delay is in the app.” The Master Plan measures that delay and never names a cause. This phase names and fixes them: an unused fast-image component and 158 raw <img> tags; six language dictionaries in one 515 KB chunk; no byte budget on JavaScript; caching, compression and fonts ungoverned; no accessibility standard; no SEO owner; web offline never decided.

Two units close with a written, dated decision rather than code (P17, P22). A decision recorded is a closed gate; silence is not.

| Unit | Title | Gate — verbatim from Addendum A. The unit is closed only when this evidence exists. |
| --- | --- | --- |
| P11 | The fast image component wired in, and bare <img> forbidden | OptimizedImage used on feed, profile and gallery surfaces; a lint rule rejects a bare <img> in src/components and src/pages; feed bytes on a 3G profile measured before and after against M11's budget. |
| P16 | AVIF added to the derivative ladder | AVIF produced alongside WebP at each rung, served by content negotiation with WebP fallback; bytes-per-feed-screen re-measured against M11. |
| P12 | One translation chunk per language | Selecting a language downloads that language only; the entry bundle and per-language chunk sizes recorded. |
| P13 | Bundle-size budget, binding, with code splitting as a written rule | A byte ceiling on the entry bundle and on per-route chunks; a build that exceeds it fails, it does not warn — the same discipline M11 already applies to images. |
| P14 | Caching rules written down and enforced | Cache-Control, ETag and stale-while-revalidate policy stated per asset class and verified by fetch; the cache-hit target in M13 and V5 traced to the rules that produce it. |
| P15 | Transfer compression verified | Brotli or gzip confirmed active on every text response, measured, recorded once. |
| P21 | Font loading policy | Font strategy stated — subset, preload, font-display — and first-paint text measured with the network throttled. |
| P17 | First-paint strategy decided, and an SEO owner named | A written decision on server-side rendering or prerendering for public pages, with first paint measured on a mid-range device; SEO given an owner and a gate. |
| P18 | Core Web Vitals adopted as the external yardstick | LCP, INP and CLS measured on real devices and reported per release, beside the plan's own budgets. |
| P22 | Web offline — a decision, not a silence | Either a service worker delivering the O-workstream's read cache on the web, or a written, dated decision that web offline is out of scope. |
| P23 | Accessibility, as a workstream | WCAG level chosen; automated checks in CI; a keyboard and screen-reader walkthrough of the ten primary surfaces. |
| P24 | Language and localisation, governed | The supported-language list, the translation source of truth and the fallback rule written into the plan. |

## 5.2 · Entry conditions — all must be true, committed, before the phase starts

Phase 4's P-4 promoted (A-4c may still be waiting on its seven days — allowed).

docs/gates/phase-5-kickoff.md committed; dependency window for D2 opened if the phase needs a package (lint plugin, accessibility checker, image tooling) — one window, listed in the kickoff.

The real-device runbook exists and has been used once (Phase 2).

Phase 0 baselines for bundle, chunk and Web-Vitals figures exist under docs/evidence/d2/baseline/.

## 5.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 5-D1-01 | Supporting queries only where a Phase 5 screen needs one — as a committed function or view under supabase/** with its own PR, never an edit to src/**. | PR in §3.3 shape if any. | 50mm-developer-1-db-runtime · GitHub / git |
| 5-D1-02 | Phase 7 groundwork, read-only. P19: identify the hot read paths (Addendum: stories 86 % full scans, competitions 97 %, competition_votes 99.5 %, image_comments 96 %, gift_announcements 100 %; plus site_settings and user_roles after Phases 3–4). P20: evaluate search technologies against C4's latency budget on paper. P29: list the ten heaviest screens by query volume. | docs/evidence/d1/phase7/groundwork.md — three sections, timestamped readings, no changes. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |

## 5.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 5-D2-01 | P11. Wire src/components/OptimizedImage.tsx (WebP <picture> + JPEG fallback, IntersectionObserver at 200 px, 256 px placeholder) into feed, profile and gallery surfaces. Add an ESLint rule rejecting a bare <img> in src/components and src/pages, running in CI (web-build.yml or d2-*.yml), with exactly one escape hatch: an explicitly documented, approved exception recorded beside the usage. Keep the existing srcSet + sizes pairing. | Rule shown failing on the current 158 tags first; call-site count of OptimizedImage > 0 on the three surfaces; feed bytes on a 3G profile before/after against M11's budget, harness-captured. | 50mm-developer-2-client-delivery · GitHub / git |
| 5-D2-02 | P16. AVIF produced alongside WebP at each rung of the derivative ladder (600 / 1080 / 1440 / original — M3/M4) and served by content negotiation with WebP fallback. If the ladder is served through Cloudflare image resizing (/cdn-cgi/image/ in PostMedia.tsx), record how AVIF is negotiated there. If the ladder is produced elsewhere (D1 or the media pipeline), stop and raise the interface with the Auditor. | Response headers on staging showing image/avif to an AVIF-capable client and image/webp otherwise; bytes-per-feed-screen re-measured against M11. | 50mm-developer-2-client-delivery · GitHub / git · Cloudflare MCP · Claude in Chrome (real browser) |
| 5-D2-03 | P12. Split src/i18n/translations.rest.ts (527,720 bytes, six dictionaries) into one loadable chunk per language, keeping the existing dynamic import() pattern in I18nContext.tsx. Reason left in the header, extending the note already there. | Build output listing per-language chunk sizes (target ≈ 85 KB each against the 515 KB baseline); a network capture on staging showing one language chunk downloaded on selection. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 5-D2-04 | P13. Turn the Phase 0 report-only harness into a binding byte ceiling on the entry bundle and per-route chunks: a build that exceeds it fails. Write the code-splitting rule (await import() for heavy paths, as AdminCertificates.tsx already does) into docs/evidence/d2/phase5/bundle-budget.md. Note WallPosts.tsx at 121,661 bytes as the first candidate. | A PR that deliberately exceeds the ceiling is shown failing in CI (run ID); the budget numbers and the rule committed. | 50mm-developer-2-client-delivery · GitHub / git |
| 5-D2-05 | P14. Cache-Control, ETag and stale-while-revalidate policy written per asset class (hashed bundles, images/derivatives, HTML shell, API JSON, fonts) and enforced in functions/** / public/_headers — reconciling with the fix-cache-headers function already in production. Trace M13's and V5's cache-hit target to these rules. | Header captures per asset class from staging (fetch is acceptable for headers); the policy table committed; the cache-hit reading from the CDN. | 50mm-developer-2-client-delivery · GitHub / git · Cloudflare MCP |
| 5-D2-06 | P15. Confirm Brotli or gzip on every text response class (HTML, JS, CSS, JSON, SVG). | One committed table of content-encoding per response class from staging and production, timestamped. Closed forever after one honest measurement. | 50mm-developer-2-client-delivery · Cloudflare MCP |
| 5-D2-07 | P21. Font strategy stated — subset, preload, font-display — and applied. | First-paint text timing with the network throttled, before/after, harness-captured; the policy committed. | 50mm-developer-2-client-delivery · GitHub / git |
| 5-D2-08 | P17. Written, dated decision on server-side rendering or prerendering for public pages (the platform already runs SEO functions in production — read them first). SEO given a named owner and a gate. First paint measured on a mid-range device. | docs/evidence/d2/phase5/p17-first-paint-and-seo.md with the decision, the owner's name, the gate sentence, and the device reading (OWNER-ATTESTED) or harness reading (VERIFIED). | 50mm-developer-2-client-delivery · marketing:seo-audit · Real-device runbook (Owner executes) · GitHub / git |
| 5-D2-09 | P18. LCP, INP and CLS reported per release beside the plan's own budgets — the harness output becomes a per-release artefact. | Two consecutive releases on staging each with a committed vitals report; the device reading for one of them. | 50mm-developer-2-client-delivery · Real-device runbook (Owner executes) · GitHub / git |
| 5-D2-10 | P22. Either a service worker delivering the O-workstream's read cache on the web, or a written, dated decision that web offline is out of scope. (Recommend the decision this phase; a service worker is its own unit of risk.) | Decision file committed or the service worker with a real-browser offline test on staging. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 5-D2-11 | P23. WCAG level chosen (record why); automated checks in CI (shown failing on a seeded violation first); a keyboard and screen-reader walkthrough of the ten primary surfaces with findings and fixes. | Level decision, CI run ID, and the ten-surface walkthrough report committed under docs/evidence/d2/phase5/a11y/. | 50mm-developer-2-client-delivery · design:accessibility-review · GitHub / git · Claude in Chrome (real browser) |
| 5-D2-12 | P24. The supported-language list, the translation source of truth (the dictionaries vs the translate-text function in production) and the fallback rule, written as a policy document for the Master Plan. | docs/evidence/d2/phase5/p24-language-policy.md committed and referenced from the Gate Register. | 50mm-developer-2-client-delivery · GitHub / git |
| 5-D2-13 | One PR per unit — twelve PRs. Bodies in §3.3 shape. | Auditor check passes. | 50mm-developer-2-client-delivery · GitHub / git |

## 5.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 5-AU-01 | Commit docs/gates/phase-5-kickoff.md; open the D2 dependency window if requested, listing the packages; close it in the ledger when the dependency PR lands. | Kickoff and ledger entries. | 50mm-code-auditor · GitHub / git |
| 5-AU-02 | Review each PR: every new check shown failing first (lint rule, bundle ceiling, a11y check); every measurement before/after with the instrument; decisions (P17, P22, P24) dated and owned. | Review comments cite the check. | 50mm-code-auditor · GitHub / git |
| 5-AU-03 | Verify on staging.50mmretina.com in a real browser: images served as <picture> with WebP/AVIF; one language chunk on selection; headers per asset class; fonts render without a blank second under throttling; keyboard navigation on the ten surfaces. | Evidence lines VERIFIED with screenshots. | 50mm-code-auditor · Claude in Chrome (real browser) · Cloudflare MCP |
| 5-AU-04 | Classify device readings OWNER-ATTESTED and harness readings VERIFIED, separately, for P11, P16, P17, P18, P21. | Register rows. | 50mm-code-auditor |
| 5-AU-05 | Close the twelve units. Promotion P-5 after the UI gate, the binding bundle budget and the Web-Vitals report are all green on staging, measured on a real mid-range device. Nine-step checklist; ledger; compare zero. | Ledger entry; compare 0 / 0 / 0. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |

## 5.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 5-OW-01 | Execute the Android runbook for the Phase 5 readings (feed bytes, first paint, vitals) and return the captures. | Files under docs/evidence/d2/phase5/. | Owner |
| 5-OW-02 | Name the SEO owner (P17) and confirm the WCAG level (P23) when D2 proposes them. | Recorded in the decision files. | Owner |

## 5.7 · Order of operations

Auditor 5-AU-01 (kickoff, window).

D2: 5-D2-01 … 5-D2-07 (the code units, in that order — P11 and P12 are the largest byte wins), with Owner 5-OW-01 when readings are needed. D1 in parallel: 5-D1-02.

D2: 5-D2-08 … 5-D2-12 (decisions and policies), Owner 5-OW-02.

Auditor 5-AU-02 per PR; 5-AU-03, 5-AU-04; 5-AU-05 (P-5).

## 5.8 · SQL apply and promotion

SQL apply: none.

Promotion P-5: after the UI gate, bundle budget and Web-Vitals report are green on staging on a real device.

## 5.9 · Exit criteria

All twelve units VERIFIED; the three decision units carry a dated file and a named owner.

The bundle ceiling and the <img> lint rule have each been seen failing in CI.

P-5 promoted; compare zero; ledger written.

| Notes the sessions must not miss Phase 5 is the phase a member can actually feel. Everything before it is correct, necessary and invisible. Do not let it slip to the end — D2's run-ahead in Phase 4 exists so that it does not. |
| --- |

# Phase 6 · Certificates, made properly

Unit P25. The item you asked for by name. Three-step database change.

## 6.1 · Purpose and units

A certificate is not stored anywhere today: certificates holds one row, file_url is NULL, and the PDF is rebuilt in the member's browser by src/lib/generateCertificatePdf.ts (jsPDF) on every view at a self-documented 12 network round trips. There is no fixed document, so L6's forgery resistance cannot be demonstrated.

Render once at issue, store an immutable PDF in R2, keep only a private reference in the database, and serve it through the S2 worker so only the owner can open it. The R2 object key is itself the unguessable verification token, which is what makes P31's public verification and P25's owner-only link compatible.

| Unit | Title | Gate — verbatim from Addendum A. The unit is closed only when this evidence exists. |
| --- | --- | --- |
| P25 | Certificates rendered once, stored in R2, served by owner-only link | One immutable PDF per certificate in R2; the database holds a private reference only; delivery through the S2 worker; a member cannot fetch another member's certificate by address; L6's forgery-resistance requirement met against a fixed document. |

## 6.2 · Entry conditions — all must be true, committed, before the phase starts

Phase 5 closed. Phase 1's P31 closed (its decisions are re-read here).

docs/gates/phase-6-kickoff.md committed with the migration block.

`docs/gates/P25-interface.md` exists — the R2 object-key scheme, the reference column shape, the S2 worker's authorisation contract, and which lane builds which piece.

An R2 bucket (or a prefix in the existing one) for certificates exists on both lanes — Owner action.

## 6.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 6-D1-01 | Object reservation: certificates, its issue/reissue functions, verify_certificate, verify_certificate_by_token, the S2 worker's authorisation lookup. | Recorded in the kickoff. | 50mm-developer-1-db-runtime |
| 6-D1-02 | A-6 expand. Add the private reference column to certificates in the shape the interface fixes (object key / token — never a public URL, never base64). Apply + rollback. | Catalogue SELECT showing the column; no URL-shaped or base64 column anywhere. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 6-D1-03 | Issue / reissue path. The database-side function that records the reference at issue time and revokes/replaces it on reissue; verify_certificate_by_token reads by the token, never by name. Owner-only authorisation lookup for the S2 worker (who may fetch which key). | Cross-member test: member A cannot resolve member B's key through any RPC; anon can verify by token and nothing else. Shown failing on a loosened copy first. | 50mm-developer-1-db-runtime · 50mm-security-reviewer · Supabase MCP (read-only) · GitHub / git |
| 6-D1-04 | Backfill the single existing row: its PDF rendered once (by D2's pipeline) and its reference recorded. | Row shows the reference; the object exists in R2 (Auditor confirms via Cloudflare MCP). | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 6-D1-05 | A-6 contract — drop the unused file_url column only after P-6 has been live and stable, on the Auditor's dated authorisation. | Catalogue SELECT after the drop; rollback file present. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |

## 6.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 6-D2-01 | Render once, at issue. Move PDF generation out of the browser: the certificate is rendered once at issue time (in functions/** or the issue flow the interface names, reusing generateCertificatePdf.ts's layout), written to R2 under the interface's key scheme, immutable thereafter. The browser stops rebuilding it. | Zero calls to jsPDF on the view path (grep + a network capture showing one fetch, not 12); the object in R2 with its hash recorded. | 50mm-developer-2-client-delivery · GitHub / git · Cloudflare MCP |
| 6-D2-02 | Owner-only link handling in the UI. The member's certificate opens through the S2 worker with the member's session; no public URL is ever rendered into the page. Public verification page uses the token path only. | Real-browser walk on staging: owner opens; a second member with the same address gets a denial; anon gets a denial. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 6-D2-03 | Forgery resistance (L6). The stored PDF's hash is recorded at issue and shown on the verification page; verification compares the fixed document, not a re-render. | Hash recorded per certificate; verification page shows match on the genuine file. | 50mm-developer-2-client-delivery · GitHub / git |

## 6.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 6-AU-01 | Commit docs/gates/phase-6-kickoff.md. | On staging. | 50mm-code-auditor · GitHub / git |
| 6-AU-02 | Freeze `docs/gates/P25-interface.md`: key scheme (unguessable token), reference column, S2 worker authorisation contract, and which lane builds the render step (this plan follows the Execution Master: D2 renders and stores; D1 records the reference and guards delivery). | File committed before either developer branches. | 50mm-code-auditor · 50mm-security-reviewer · GitHub / git |
| 6-AU-03 | Re-read Phase 1's P31 evidence against this interface: name search must remain closed; verify-by-token must use the R2 key/token. Record consistency or a finding. | Register note. | 50mm-code-auditor · 50mm-security-reviewer |
| 6-AU-04 | Authorise A-6 expand on staging then production; then, once D2's pipeline is on staging, authorise the backfill. | Evidence lines VERIFIED. | 50mm-code-auditor · Supabase MCP (read-only) |
| 6-AU-05 | The cross-member fetch attempt — the gate's fourth clause is a security test. In a real browser on staging: as member A, attempt member B's certificate address; as anon, attempt both. Record the denials. Confirm the R2 object via Cloudflare MCP and that the database holds no URL. | Evidence lines VERIFIED with screenshots and the R2 listing. | 50mm-code-auditor · 50mm-security-reviewer · Claude in Chrome (real browser) · Cloudflare MCP · Supabase MCP (read-only) |
| 6-AU-06 | Close P25. Promotion P-6. Nine-step checklist; ledger; compare zero. Then, after P-6 is stable, authorise the contract step (6-D1-05). | Ledger entry; compare 0 / 0 / 0. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |

## 6.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 6-OW-01 | Create the certificates R2 bucket / prefix on both lanes and scope the tokens per lane (R2 tokens must not span buckets). | Auditor reads the scope from the Access Key ID via Cloudflare MCP. | Owner |
| 6-OW-02 | Approve the production runs for A-6 expand and, later, contract. | Runs proceed. | Owner |

## 6.7 · Order of operations

Owner 6-OW-01 → Auditor 6-AU-01, 6-AU-02, 6-AU-03.

D1 6-D1-01, 6-D1-02 → Auditor 6-AU-04 (expand). D2 in parallel: 6-D2-01, 6-D2-02, 6-D2-03. D1: 6-D1-03.

D1 6-D1-04 (backfill) → Auditor 6-AU-05 (cross-member test) → 6-AU-06 (P-6).

After stability: D1 6-D1-05 → Auditor authorises contract.

## 6.8 · SQL apply and promotion

A-6: expand (add reference column) → backfill the single existing row → contract (drop file_url) only after P-6 is stable.

Promotion P-6.

## 6.9 · Exit criteria

P25 VERIFIED on all five clauses, the fourth by the Auditor's own cross-member attempt.

One fetch per certificate view instead of 12; no URL and no base64 in the database.

P-6 promoted; compare zero; ledger written.

# Phase 7 · Prove it at real size

Units P19, P20, P29, plus the re-measurement clauses of P34 and C4. Everything before this was measured at 106 members.

## 7.1 · Purpose and units

Search has a latency budget (C4) and no engine. The heaviest screens have never been traced for N+1. Before the 10-million milestone every read goes to the database, and the Addendum has measured exactly what a memory cache would absorb. This phase builds the cache tier, names the search engine, traces the screens — and proves each against one million seeded rows on staging.

| Unit | Title | Gate — verbatim from Addendum A. The unit is closed only when this evidence exists. |
| --- | --- | --- |
| P19 | A read-through cache tier before the 10-million milestone | Hot read paths identified and served from a memory cache with a stated invalidation rule; database read volume measured before and after. |
| P20 | A search engine named | The search technology chosen and its index built; C4's latency budget met at 1 million seeded posts, not at today's volume. |
| P29 | N+1 audit and a materialized-view policy | The ten heaviest screens traced for repeated per-row queries; a stated policy on where pre-computed views are used and how they refresh. |

## 7.2 · Entry conditions — all must be true, committed, before the phase starts

Phase 6 closed.

docs/gates/phase-7-kickoff.md committed; dependency windows (D1 for a cache/search client if needed; D2 for the search UI) listed.

Staging seeded to 1 million rows (0-D1-03 / the seeder runbook) and the row counts committed.

Phase 5 groundwork (5-D1-02) committed.

## 7.3 · Developer 1 — Database & Runtime

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 7-D1-01 | Object reservation: the hot-path tables from the groundwork, the search index objects, any materialized views. | Recorded in the kickoff. | 50mm-developer-1-db-runtime |
| 7-D1-02 | P19. A read-through memory cache in front of the identified hot read paths, with a stated invalidation rule per path (event on write, or TTL with reason). The choice of cache (Postgres-side, edge KV, or a service) recorded with its reason. | Database read volume for each hot path before/after on seeded staging, timestamped; the invalidation rules committed. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · Cloudflare MCP · GitHub / git |
| 7-D1-03 | P20. Name the search technology (Postgres full-text with proper indexes, or an external engine) and build its index. Measure against C4's latency budget at 1 million seeded posts, not today's 288. | Latency distribution (p50/p95) at 1 M posts against C4's budget, timestamped; the decision and the index definition committed. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 7-D1-04 | P29. Trace the ten heaviest screens for repeated per-row queries (using D2's screen list, 7-D2-02); fix each N+1 in the query or with a pre-computed view; write the materialized-view policy (where used, how refreshed — the database has exactly one today). | Per-screen query count before/after; the policy committed under docs/evidence/d1/phase7/. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) · GitHub / git |
| 7-D1-05 | P34 re-measurement clause (if not already done in 4-D1-05) and C4's budget confirmed at 1 M rows. | Readings committed. | 50mm-developer-1-db-runtime · Supabase MCP (read-only) |
| 7-D1-06 | Assemble SQL apply A-7 (index, views, cache support objects). Expand → behaviour → contract as applicable. | Auditor authorises; both lanes green. | 50mm-developer-1-db-runtime · GitHub / git |

## 7.4 · Developer 2 — Client & Delivery

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 7-D2-01 | Search UI. The client half of the search integration against the engine D1 names (interface file if the query contract changes). | Search works on seeded staging in a real browser within the budget the harness measures. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |
| 7-D2-02 | Screen-level measurement for the N+1 trace. For each of the ten heaviest screens, the request waterfall on seeded staging before and after D1's fixes. | Ten before/after captures under docs/evidence/d2/phase7/. | 50mm-developer-2-client-delivery · GitHub / git · Claude in Chrome (real browser) |

## 7.5 · Auditor

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 7-AU-01 | Commit docs/gates/phase-7-kickoff.md; confirm the seeded state by own SELECT of row counts. | Kickoff; seeded-state evidence line. | 50mm-code-auditor · Supabase MCP (read-only) · GitHub / git |
| 7-AU-02 | Review PRs: invalidation rules stated per path; search latency measured at 1 M not 288; N+1 fixes with per-screen counts. | Review comments cite the check. | 50mm-code-auditor · GitHub / git |
| 7-AU-03 | Authorise A-7 staging → production. Verify search and the heavy screens on staging in a real browser at seeded volume; re-run the read-volume query as own reading. | Evidence lines VERIFIED. | 50mm-code-auditor · Supabase MCP (read-only) · Claude in Chrome (real browser) |
| 7-AU-04 | Close P19, P20, P29 and the re-measurement clauses of P34 and C4. Promotion P-7. Nine-step checklist; ledger; compare zero. Write the closing ledger entry for Addendum A: every unit's final status, every correction recorded during the programme, every hold's disposition. | Ledger entry; compare 0 / 0 / 0; Gate Register with 35 rows closed or explicitly DEFERRED with reason. | 50mm-code-auditor · GitHub / git · Claude in Chrome (real browser) |

## 7.6 · Owner actions

| ID | Task — what the session does | Done when — evidence the Auditor accepts | Skills & tools to load |
| --- | --- | --- | --- |
| 7-OW-01 | Approve the production run for A-7. Approve the final promotion. | Runs proceed. | Owner |

## 7.7 · Order of operations

Auditor 7-AU-01.

D1: 7-D1-01 … 7-D1-05. D2 in parallel: 7-D2-02 (before captures), 7-D2-01, then 7-D2-02 (after captures).

Auditor 7-AU-02; D1 7-D1-06 → Auditor 7-AU-03 → Owner 7-OW-01 → Auditor 7-AU-04.

## 7.8 · SQL apply and promotion

A-7.

Promotion P-7.

## 7.9 · Exit criteria

P19, P20, P29 VERIFIED at 1 million seeded rows.

C4's latency budget met at 1 M posts; P34's scan reading ≈ 0 at 1 M rows.

P-7 promoted; compare zero; closing ledger entry written.

# Appendix A · Unit-to-phase index — all 35 units, each exactly once

Read this against the Gate Register. If a unit ever appears in two phases, or in none, that is a finding against this document.

| Unit | Title | Phase | Owner(s) |
| --- | --- | --- | --- |
| P1 | Presence removed from the durable write path | 2 | D1 server half · D2 client half |
| P2 | Replica identity corrected on published tables | 2 | D1 |
| P3 | Subscription-to-publication parity, enforced at build time | 3 | D1 DB half · D2 app half |
| P4 | Configuration served from the edge, not the database | 3 | D2 |
| P5 | Polling replaced by events | 3 | D1 |
| P6 | Cron run-log retention and batched purge | 4 | D1 |
| P7 | Schema-cache reload discipline | 3 | D1 |
| P8 | Autovacuum tuned on the churning tables | 4 | D1 |
| P9 | Vault secret decrypted once per worker, not once per message | 3 | D1 |
| P10 | Client timer discipline | 2 | D2 |
| P11 | The fast image component wired in, and bare <img> forbidden | 5 | D2 (run-ahead in 4) |
| P12 | One translation chunk per language | 5 | D2 (run-ahead in 4) |
| P13 | Bundle-size budget, binding, with code splitting as a written rule | 5 | D2 |
| P14 | Caching rules written down and enforced | 5 | D2 |
| P15 | Transfer compression verified | 5 | D2 (run-ahead in 4) |
| P16 | AVIF added to the derivative ladder | 5 | D2 (run-ahead in 4) |
| P17 | First-paint strategy decided, and an SEO owner named | 5 | D2 — decision |
| P18 | Core Web Vitals adopted as the external yardstick | 5 | D2 |
| P19 | A read-through cache tier before the 10-million milestone | 7 | D1 |
| P20 | A search engine named | 7 | D1 · D2 UI |
| P21 | Font loading policy | 5 | D2 (run-ahead in 4) |
| P22 | Web offline — a decision, not a silence | 5 | D2 — decision |
| P23 | Accessibility, as a workstream | 5 | D2 |
| P24 | Language and localisation, governed | 5 | D2 — policy |
| P25 | Certificates rendered once, stored in R2, served by owner-only link | 6 | D1 reference + worker auth · D2 render + UI |
| P26 | Audit-log scope and retention | 4 | D1 |
| P27 | Leftover tables and backups retired | 4 | D1 (A-4c) |
| P28 | Index-to-table ratio as a review gate | 4 | D1 |
| P29 | N+1 audit and a materialized-view policy | 7 | D1 · D2 captures |
| P30 | Account enumeration closed | 1 | D1 SQL · D2 client |
| P31 | Certificate and staff-ID search surface narrowed | 1 | D1 SQL · D2 client |
| P32 | Unauthenticated write and compute endpoints closed | 1 | D1 · D2 for Pages-side replacements |
| P33 | Compromised-password protection enabled, and the remaining catalogue tidied | 1 | D1 (drop clause carried to A-4c) · Owner toggle |
| P34 | Role checks made index-only, and the invisible cost made visible | 4 | D1 (needs X1/X2) |
| P35 | Primary keys and remaining catalogue hygiene | 4 | D1 (drops in A-4c) |

Count by phase: Phase 1 — 4 · Phase 2 — 3 · Phase 3 — 5 · Phase 4 — 7 (+ C-2) · Phase 5 — 12 · Phase 6 — 1 · Phase 7 — 3. Total 35.

# Appendix B · What this plan does not promise

400 million members. The platform is engineered for 1 million, with 10 million as added capacity. No unit here reaches 400 million, and none should be sold as reaching it.

Dropping any index on a number that disagrees with itself. Four methods gave four answers. Nothing is dropped until one method is published (4-D1-02) and H-1 is lifted in writing.

Any SQL apply against production before the identical file is green on staging. No exceptions, including “only a comment”.

Calendar dates. Only the two reserved migration blocks (20260910_*, 20260920_*) are dated by the source plans. Phase durations here are the Execution Plan's estimates (Phase 0 about a week; Phase 1 hours; Phase 2 days plus a seven-day window; Phase 4 with a 48-hour and a seven-day wait). A calendar is the Auditor's to publish per kickoff, not this document's to invent.

# Appendix C · Decisions this plan asks the Auditor to record at kickoff

Each of these is flagged where it arises. They are collected here so none is missed. In every case this document gives a recommendation; the recommendation is not a decision until the Auditor writes it into the kickoff or the ledger.

| Where | Decision | This plan recommends |
| --- | --- | --- |
| Phase 1 · 1-AU-02 | Where each P32 replacement lives when a function moves behind a rate-limited edge function. | functions/** (Pages) → D2 builds it; supabase/functions/** → D1 builds it. Named per function in the frozen list. |
| Phase 1 · 1-AU-03 | P33's clause “two leftover RLS-enabled tables retired” versus P27's drop in A-4c. | Retired = all grants revoked in Phase 1 (behaviour); physical DROP under P27 in A-4c (contract). P33 closes VERIFIED at P-1 with the drop clause explicitly carried. |
| Phase 3 · 3-AU-01 | Who owns the parity comparator script. | D2, as scripts/web-parity-check.mjs in web-build.yml, because that is the build it fails. |
| Phase 4 · 4-AU-02 | Whether D2's run-ahead Phase 5 PRs merge to staging during Phase 4. | Merge only if the unit's gate is VERIFIED before P-4 is cut; otherwise keep open and rebased until Phase 5. |
| Phases 3–7 | Migration timestamp blocks. | Assigned in each kickoff; developers never invent one. |
| Phase 5 · 5-D2-10 | Web offline (P22). | Record the out-of-scope decision this phase; a service worker is its own unit of risk and can be a later unit. |

# Appendix D · New finding outside the original 35 units — the 2026-09-11 bootstrap silently reopened ~85 previously-closed functions on staging

Discovered on 2026-09-12/13 during the F-105 staging→main promotion push, not part of the Addendum A Workstream P this plan was built from. Not unit P30–P35 renumbered; does not change Appendix A's count of 35. This entry replaces an earlier, narrower version of the same note — the first pass named only enqueue_email; a deeper, measured read-only investigation the same night found that function was a symptom, not the finding.

## What was actually found

The suspicion tonight was that the database function enqueue_email held broader access than it needed. Investigation (read-only, measured live against the staging database, nothing changed) confirmed enqueue_email's excess access was real, but traced it to a single cause: the 21,442-line schema bootstrap file applied to staging on 2026-09-11 (run #54) recreated all 373 functions with default database permissions and contains zero REVOKE statements. Applying it silently undid month-old, deliberate security closures across the schema — enqueue_email was simply the first thread pulled.

## Scale, measured against the pre-bootstrap baseline (2026-09-04)

| Measure | Before bootstrap (2026-09-04) | Live on staging today |
| --- | --- | --- |
| SECURITY DEFINER functions | 333 | 339 |
| ...with anon EXECUTE | 247 | 332 |
| ...VOLATILE and anon-executable | 148 | 210 |
| ...with PUBLIC EXECUTE | not tracked at baseline | 332 |

Roughly 85 functions moved from properly closed to open. This F-105 push's own fix (PR #243, excluding the bootstrap file from future re-dispatch) re-closed 7 of the 332 as a side effect; the other ~78 are still open on staging right now.

## enqueue_email specifically — confirmed safe to fix in isolation, whenever it's picked up

| Question | Answer — measured, not assumed |
| --- | --- |
| Root cause | Confirmed: the bootstrap, not a design gap. The baseline recorded anon_execute: false for enqueue_email; live staging today reads true. The correct fix already exists and is already committed — migration 20260814042609_email_queue_authority.sql, lines 171–175, revokes PUBLIC/anon/authenticated and grants service_role only. No new grant design is needed. |
| Call sites | Three, all edge functions, all authenticated with SUPABASE_SERVICE_ROLE_KEY: supabase/functions/auth-email-hook/index.ts, send-transactional-email/index.ts, process-email-queue/index.ts. No client (src/) call site — only generated type entries. Freshly grepped tonight, not inherited from an existing inventory. |
| Risk if re-applied | None found. Every real caller already holds service_role, which keeps EXECUTE either way. Re-running the existing revoke for this one function is measured safe. |
| Size if done alone | About 30 minutes — two REVOKEs already written, a probe, a rollback, staging only. |

## Why this is not treated as a 30-minute job tonight

Fixing enqueue_email alone and calling the finding closed would be the wrong lesson from tonight: it is one function out of roughly 85 that need the identical treatment, and Phase 1's own rule applies to every one of them — “revoking a grant the app still calls turns a security fix into an outage.” Each of the ~85 needs its own call-site check before anything is revoked; that is a phase-sized piece of work, not an evening add-on, and it has not been scoped or started.

## Recommended sequence

(1) Let the test-infrastructure fix already in flight (teaching the failing test's resolver to skip non-sequence files, unrelated to any grant) land on its own — it turns the failing gate green for the correct reason, independent of anything below. (2) Decide, as Owner/Auditor, how staging's ACL posture gets restored after the bootstrap — three shapes proposed: re-run the August-era revokes as a set; add the missing REVOKEs into the bootstrap file itself; or a one-time sweep migration derived from the 2026-09-04 baseline's 247/333 classification. (3) Only after that decision would a standalone enqueue_email unit make sense — by then it is one line inside the larger fix, not its own unit.

## Production

Believed unaffected — production was never bootstrapped, so it should still carry the August revokes — but that is an inference from the same class of migration-file source that runs #69 and #70 both disproved for other functions, not a direct measurement. Nobody has read production's live grants tonight. It needs its own verification pass before anyone relies on the assumption.

## Status as of this note

Read-only investigation complete; nothing executed; no grant touched on staging or production; no migration written. The unrelated test-resolver fix is in progress separately. This entry replaces the earlier, narrower version of this note in the same document.

Owner note: nothing here authorises Developer 1 or Developer 2 to touch any grant, for enqueue_email or the other ~85 functions, without the Owner deciding the sequence above first.

*Prepared from the Addendum A Workstream P (1 September 2026), the Addendum A Execution Plan and the Execution Master v1.2 (2 September 2026), and the four 50mm role skills. This document proposes; it approves nothing and closes nothing.*
