# ADDENDUM A — EXECUTION MASTER
## Workstream P · 35 units · two developers in parallel · one auditor · seven promotions

**Version 1.2 — 2026-09-02** (v1.0 proposed; v1.1 recorded the Owner's three rulings, §9.0; v1.2 adds §1.5, the standard of practice for all three roles)
**Source of work:** *FINAL Updated 50mm Master Plan — Addendum A, Workstream P* (Neil Basu, 1 September 2026), 35 units P1–P35, measured against the live platform 2026-09-01 10:44Z–11:22Z.
**Status of this document:** PROPOSED. Nothing here is approved and nothing here has been executed.

---

## 0 · How to read this document

This is not a restatement of the addendum. The addendum says *what* must change and *what evidence closes it*. This document says **who does it, in what order, on which branch, and at which moment it is allowed to reach production** — arranged so that two developers can work on the same repository at the same time without ever touching the same file.

Three words are used strictly and never interchangeably:

| Term | Meaning in this document |
|---|---|
| **SQL apply** | Running one reviewed `.sql` file against one database through `apply-migration.yml`. Nothing else is ever called a migration. |
| **Promotion** | Moving code from `staging` to `main`. Squash merge. Code only. |
| **Gate** | The evidence sentence written in the addendum for that unit. A unit is not done when the code works; it is done when the gate's evidence exists and the Auditor has recorded it. |

The repository already overloads the word "migration" — `apply-migration.yml` applies SQL, while the ledger calls a staging→main merge a "promotion". Mixing them is how a schema change ends up shipped without its code, or code shipped without its schema. **Both developers use these three words exactly as defined above.**

---

## 1 · Roles

### 1.1 The Auditor — one person, no code

The Auditor **never writes application code, never writes SQL, never merges his own work**. He does five things and nothing else:

1. **Freezes the interface** between the two developers before either starts a unit that straddles them.
2. **Reviews every PR against the ownership map** (§3). A PR that touches a path it does not own is closed unreviewed — not negotiated.
3. **Closes gates.** For each unit he records `Requirement → Instrument → Evidence → Result → Status`, classified `VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED`. No category is ever silently converted into another.
4. **Authorises each SQL apply and each promotion**, and no one else does.
5. **Writes the ledger.** `docs/PROMOTION_LEDGER.md` has exactly one author.

The Auditor also holds one duty that outranks the others: **when a previous conclusion turns out to be wrong, the original stands and the correction is filed beside it.** Findings are never edited to look better in hindsight.

### 1.2 Developer 1 — Database & Runtime  (**D1**)

Owns everything that runs inside or beside Postgres: schema, RLS, functions, publication, cron, vault, autovacuum, indexes, and the SQL half of anything that straddles.

### 1.3 Developer 2 — Client & Delivery  (**D2**)

Owns everything the member's browser or phone touches: React source, bundling, images, fonts, caching headers, edge configuration, accessibility, i18n, and the client half of anything that straddles.

### 1.4 The Owner

Approves phases, holds every secret, performs every action an assistant must never perform: entering credentials, resetting passwords, dispatching workflows that touch production when the panel refuses automation, and the final say on any irreversible step.

### 1.5 The standard of practice — binding on all three roles

All three roles are filled at senior level. That is written here as **checkable behaviour**, not as a job title, because a title cannot be reviewed and behaviour can.

#### D1 and D2 — Top Senior Developer

1. **Read the existing code before writing any.** Part D of the addendum lists eleven things this codebase already gets right — the engagement heartbeat, `siteSettingsCache`, the `srcSet`/`sizes` pairing, the translation split. A senior developer extends those patterns; a junior one invents a second way to do the same thing and doubles the maintenance surface.
2. **The failing test comes first.** A test that could not have failed is not evidence. If a test passes against the unfixed code, the test is the defect — this has already happened once in this project (C-34).
3. **Fix the cause, and say which it is.** Every PR states plainly whether it addresses cause or symptom. A symptom fix is legitimate when it is labelled as one.
4. **One unit per PR.** Scope is never widened mid-flight. A PR that grew is closed and re-cut.
5. **Never disable a check to make a build pass.** A check in the way is either wrong — fix the check, in its own PR, with its own reasoning — or it is right, and the code is wrong.
6. **The failure path is part of the work.** What happens when the network drops, the row is missing, the token expired, two tabs race.
7. **Measure before and after.** "Should be faster" is not a result. A number taken twice, with the instrument named, is.
8. **State uncertainty out loud and stop.** "I do not know" costs an hour. A guess that reaches `main` costs a day — this project has four recorded corrections proving exactly that.
9. **Leave the reason in the file.** This codebase already documents its reasoning in file headers. That convention continues, because the next reader inherits the thinking, not just the code.
10. **Assert from the system, never from a document** (§4 rule 8). Including this document.

#### The Auditor — Top Senior Code and Architecture Reviewer

1. **Review against the written gate, never against taste.** The gate sentence is the addendum's, verbatim. Personal preference is not a review finding.
2. **Verify from the running system.** C-38, C-42, C-44 and C-45 share one cause: a claim repeated from a document instead of checked against the thing itself. The Auditor opens the page, runs the query, reads the log.
3. **Reject a green result whose test could not have failed.** By definition the test will not catch this; only the reviewer can. Every new check must be shown failing on the unfixed input before it is accepted as a control.
4. **Judge the architecture, not only the diff.** The question is not "is this correct" but "does this make the next change easier or harder, and who pays for it".
5. **Keep `VERIFIED` and `INFERRED` strictly apart.** No category is ever silently converted into another, in either direction.
6. **Record his own errors in the same register, at the same severity.** Earlier conclusions are never edited to look better in hindsight; the original stands and the correction sits beside it.
7. **Hold the authority to stop a promotion — and use it.** A phase that is 95 % done is not promoted.
8. **Write no code. Never approve his own work.** Both are absolute.

#### Forbidden to all three, without exception

The Owner's standing list, restated here because it is the boundary of every role above:

> ❌ Guesswork ❌ Assumptions ❌ Implicit behaviour ❌ Hidden operations ❌ Recursive actions ❌ Fan-out execution ❌ Bulk modifications ❌ Auto-fix behaviour ❌ Background dependency changes ❌ "Probably safe" logic ❌ Casual shortcuts

Any one of these converts measured work back into opinion, which is the single thing this programme exists to prevent.

---

## 2 · The one rule that makes parallel work possible

> **A file has exactly one owner. Two developers never edit the same file. Where a change genuinely spans both lanes, it is split at a frozen interface, not shared.**

Everything in §3 is an application of that sentence. It is not bureaucracy — it is the only reason two people can move at once in a repository with ordered SQL files, a single `package.json`, and a shared CI directory.

---

## 3 · Ownership map — binding

### 3.1 Exclusive paths

| Path | Owner | Note |
|---|---|---|
| `supabase/migrations/**` | **D1 only, always** | Ordered files. A second author guarantees ordering conflicts and duplicate timestamps. |
| `supabase/rollback/**` | **D1 only** | Every apply file ships with its rollback in the same PR. |
| `supabase/functions/**` | **D1** | Edge functions that talk to the database. |
| `src/**` | **D2** | The entire React application. |
| `public/**`, `index.html` | **D2** | |
| `vite.config.ts`, `tsconfig*.json`, `eslint*` | **D2** | Build configuration. |
| `tools/uishot/**` | **D2** | UI gate and visual harness. |
| `functions/**` (Pages Functions) | **D2** | Edge runtime, SEO injection, config delivery. |
| `docs/PROMOTION_LEDGER.md` | **Auditor only** | Nobody else commits to it, ever. |
| `docs/evidence/d1/**` | **D1** | Where D1 files gate evidence. |
| `docs/evidence/d2/**` | **D2** | Where D2 files gate evidence. |
| `docs/gates/**` | **Auditor** | The Gate Register. |

### 3.2 The four collision files — special handling

These four are where parallel work normally dies. Each gets a rule.

**(a) `.github/workflows/**` — split by file, permanently**

| File | Owner |
|---|---|
| `apply-migration.yml`, `security.yml`, `verify-schema-dependencies.yml`, `schema-dump.yml` | **D1** |
| `web-build.yml`, `ui-gate.yml`, `typecheck.yml`, `android-build.yml` | **D2** |
| `health.yml` | **Auditor** |
| Any new workflow | Named `d1-*.yml` or `d2-*.yml`. No exceptions. |

**(b) `package.json` / `package-lock.json` — the dependency window**

Only one developer may touch these at a time. The Auditor opens a **dependency window** for one named developer, that developer lands their dependency PR, the Auditor closes the window. The other developer is *blocked from these two files* for the duration and must not rebase onto them mid-flight. One window per developer per phase, announced in the phase kickoff and recorded in the ledger.

**(c) `scripts/**` — split by filename prefix**

- `scripts/db-*.mjs` → D1
- `scripts/web-*.mjs` → D2
- `scripts/lane-config.mjs`, `scripts/lane-config.d.mts` → **FROZEN.** These files decide which database and which origin a build talks to. A change requires the Auditor's written approval in the ledger *and* both developers' sign-off on the PR. This file has already caused two failed builds (#113, #114); it is not touched casually.

**(d) Database objects — reservation, not just files**

Two SQL files can be in different files and still collide, because they change the same table. Before writing SQL, D1 posts an **object reservation** in the phase thread: the tables, functions, policies and publication entries the unit will alter. The Auditor records it. No two in-flight units may reserve the same object. This is the SQL equivalent of file ownership.

### 3.3 Migration filename reservation

To make ordering deterministic, each phase reserves a timestamp block. D1 names files inside the block only:

```
Phase 1 → 20260910_0001_*  …  20260910_0099_*
Phase 2 → 20260920_0001_*  …  20260920_0099_*
```

The `PROBE_` and `UNAPPLIED_` prefixes already in use are preserved for their existing meanings.

---

## 4 · Branch, PR and evidence discipline

1. **Both developers branch off `staging` only.** `d1/P02-replica-identity-20260910`, `d2/P11-optimized-image-20260910`.
2. **Every PR targets `staging`. Never `main`.** Promotion to `main` is the Auditor's action, at a checkpoint, never a developer's.
3. **One unit per PR.** A PR carrying two units is closed. This is not tidiness — it is so a single unit can be reverted without dragging a second one with it.
4. **Every PR body states:** the unit ID, the gate sentence verbatim, the paths touched, the objects reserved (D1), and the evidence artefact path.
5. **Every PR must be exercised by its own checks.** A change to a CI rule proves itself by running on its own PR. A change to a query proves itself with a before/after measurement committed under `docs/evidence/`.
6. **Repository constraint, already established:** this repository permits **squash merges only** — "Create a merge commit" and "Rebase and merge" are disabled. That is why `staging` and `main` diverge in commit count. **STANDING RULE 20 applies to every phase: after each promotion, `staging`'s tree is synced to `main`'s and `compare/main..staging` must read `0 changed files, 0 additions, 0 deletions` before new work starts.** A phase is not closed until that reads zero.
7. **Two Claude sessions cannot see each other.** D1 and D2 are separate sessions (ruling D-15, §9.0). Neither can see the other's uncommitted work, unsent reasoning, or intent. Therefore:
   - **Every handoff is a committed file.** An interface agreed in conversation does not exist. `docs/gates/P1-interface.md` exists or P1 has not started.
   - **Every phase opens with a written kickoff** committed by the Auditor to `docs/gates/phase-N-kickoff.md`: unit list, owner per unit, objects reserved, dependency window holder, interface files that must exist first.
   - **Every session begins by reading the Gate Register and `git log`, not by assuming.** A session that says "D1 has probably landed X" is asserting from memory. It opens the branch and looks.
   - **A session never edits a file it does not own, even to fix an obvious typo.** It reports it to the Auditor. One-line courtesy edits are exactly how two-author conflicts start.
8. **Assert from the system, never from a document.** Four corrections in this project (C-38, C-42, C-44, C-45) share one cause: a claim repeated from a document instead of checked against the running system. Before any developer states that a secret, a setting, a policy or a workflow behaves a certain way, they open it and look. **STANDING RULE 21:** an instructing comment is a control; when a comment and its code disagree, that is a finding, not cosmetics.

---

## 5 · The measurement baseline — Phase 0, and why nothing starts without it

Every unit in this addendum is quantified: 66.7 %, 50.9 %, 580,000 requests, 64.2 % dead rows. **Those numbers were taken on 2026-09-01 in a 38-minute window.** If work begins before the same numbers are re-taken and committed, then in three weeks nobody can prove any improvement, and every "after" figure is an argument instead of a measurement.

Phase 0 exists to make the rest provable. It changes no behaviour whatsoever.

---

## 6 · The phases

Seven phases. Seven promotions. The order is driven by **risk removed per day of work** (the addendum's own Part E), corrected for dependency.

---

### PHASE 0 — Baseline and instruments
**Changes no behaviour. Ships CI and measurement only.**

| | D1 · Database & Runtime | D2 · Client & Delivery |
|---|---|---|
| **Work** | `scripts/db-baseline.mjs`: a read-only snapshot of `pg_stat_statements`, table sizes, dead-row ratios, index usage, publication list, policy counts, definer-function classification. Output committed as JSON under `docs/evidence/d1/baseline/`. | `scripts/web-baseline.mjs`: entry-bundle and per-chunk byte sizes, per-language chunk sizes, an LCP/INP/CLS capture on a mid-range Android profile. Output under `docs/evidence/d2/baseline/`. |
| **Also** | Re-run the addendum's own queries and record whether each of its 2026-09-01 figures still holds. Disagreements are recorded, not resolved. **Plus: build the 1-million-row staging seeder** (ruling D-16, §9.0) — deterministic, re-runnable, staging only, with a hard guard that refuses to run against the production project ref. | Stand up the Web-Vitals harness in **report-only** mode. It must not fail a build yet. |
| **Objects reserved** | none (read-only) | none |
| **Gate** | A committed baseline for every unit that claims a number, with the timestamp of measurement on every line. | Same, for every front-end unit. |

**Phase 0 is now about a week, not two days.** The seeder is the reason, and it is worth it: P20 and P34 have gates that are unprovable at 106 rows, and every measurement taken in Phases 2–4 is more honest against seeded data than against a 106-member catalogue. Building it first means we never have to say "green at 106, unknown at scale".

**Auditor:** publishes the **Gate Register** — one row per unit P1–P35, its verbatim gate sentence, its owner, its phase, its evidence path, status `NOT STARTED`. This register is the single source of truth for "is it done".

**Hard hold recorded in Phase 0:** **C-2 — unused indexes.** Four methods produced four numbers (79 / 78 / 298-of-which-125 / 188). **No index is dropped by anyone until those reconcile.** The reconciliation is itself a Phase 4 task with its own gate. Any PR that drops an index before then is closed.

- **SQL apply:** none.
- **Promotion P-0:** CI and scripts only, so both lanes share identical gates from day one. Low risk, high value.

---

### PHASE 1 — Exposure closure
**The addendum's Part E items 1 and 2. Hours of work, and it removes the most common route to account takeover.**
**Units: P33, P30, P31, P32**

| | D1 | D2 |
|---|---|---|
| **Work** | P33 — leaked-password protection on; the four definer views read and justified, each with a cross-member test; two leftover RLS tables retired; `plpgsql_check` out of `public`. P30 — `email_exists` removed from `anon`; signup and reset responses made identical. P31 — name-based certificate search removed from `anon`; token verification retained and tested; `verify_staff_id` behind a session or rate limit. P32 — the eight unauthenticated volatile functions each closed, rate-limited, or justified with a test. | **Blocking pre-work:** a complete call-site inventory of `email_exists`, certificate name-search and `verify_staff_id` in `src/**`. Read-only. Delivered to the Auditor **before D1 revokes anything.** Then: any client change needed so the app never calls a revoked path. |
| **Interface** | The revocation list is frozen by the Auditor after D2's inventory and before D1's SQL is written. Neither developer changes it unilaterally. |
| **Objects reserved (D1)** | `email_exists`, `verify_staff_id`, the certificate search function, the eight volatile functions, the four definer views, two RLS tables, `plpgsql_check`. |

**Why this order:** revoking a grant the app still calls turns a security fix into an outage. The inventory is cheap and it removes that entire class of risk.

- **SQL apply A-1:** staging first, verify on `staging.50mmretina.com`, then production. Grant revocations only — small, reversible, each with a rollback file.
- **Promotion P-1:** after A-1 is green on both lanes and D2's client changes are live on staging.

---

### PHASE 2 — The write path
**The single highest-risk line of code in the platform, and the 50.9 %.**
**Units: P1, P2, P10**

| | D1 | D2 |
|---|---|---|
| **Work** | P1 server half — presence served from memory; the durable write replaced by a session-end or server-batched write. P2 — `REPLICA IDENTITY` corrected on `profiles`, `scheduled_posts`, `competition_round_publish`; every published table's row format justified in writing. | P1 client half — `src/hooks/core/useLastActive.ts`: the 5-minute `setInterval` UPDATE removed. P10 — no timer faster than 1 s; every repeating timer cleared on `visibilitychange`; battery and jank measured on a real mid-range Android before and after. |
| **Interface — frozen before either starts** | One RPC or endpoint signature for "record presence", agreed and written into `docs/gates/P1-interface.md` by the Auditor. D2 codes against the signature; D1 implements behind it. Neither may change it without the Auditor reopening it. |
| **Model to copy** | The engagement heartbeat already in the codebase — it refuses to earn minutes from a backgrounded tab, destroys its timer on hide, and resolves the two-tab problem in the database rather than with client-side leader election. **P10 copies that pattern; it does not invent a new one.** |
| **Objects reserved (D1)** | `profiles`, `scheduled_posts`, `competition_round_publish`, the realtime publication. |

**Gate evidence required:** `profiles` receives no write from a client timer; presence served from memory; **the `profiles` dead-row ratio measured below 10 % for seven consecutive days**. That seven-day window is a real elapsed-time dependency — Phase 3 may start, but **P1 cannot be marked closed, and Phase 2 cannot be promoted, until day seven.**

- **SQL apply A-2:** replica identity change (configuration, not code) — staging, verify, production.
- **Promotion P-2:** after the seven-day dead-row window closes green.

---

### PHASE 3 — Realtime correctness and configuration
**Eleven silently broken features, eight wasted publications, and 580,000 database requests for 35 rows.**
**Units: P3, P4, P5, P9, P7**

| | D1 | D2 |
|---|---|---|
| **Work** | P3 DB half — publication corrected in both directions. P5 — polling replaced by `LISTEN/NOTIFY` or a queue service; idle back-off where polling must remain (≈5 s active / 60 s idle). P9 — vault secret decrypted once per worker, not once per message. P7 — no schema-cache reload outside a deployment. | P3 app half — the 56 subscriptions across 26 files reconciled; permanently-open channels on configuration tables (`site_settings`, `role_display_config`, `badge_definitions`, `courses`, `support_tickets`) removed. P4 — configuration served from the CDN edge or baked into the bundle, versioned. |
| **Interface — the parity check** | `scripts/db-publication-export.mjs` (D1) emits the database's publication list as JSON. `scripts/web-subscription-scan.mjs` (D2) emits the app's subscription list as JSON. A third script compares them and **fails the build in both directions**. The JSON schema is frozen by the Auditor first; each developer owns their own producer; neither edits the other's. |
| **Objects reserved (D1)** | the realtime publication, the sixteen cron jobs, the outbound HTTP helper, vault access path. |

**Note on P3:** eleven of these are *features that have never worked*. Each one is a decision — make it work, or remove it honestly. **`admin_notifications` is on that list: an admin alerting feature that silently does not alert.** The Auditor requires a written disposition per table before the PR is reviewed.

- **SQL apply A-3:** publication changes, cron cadence, notify triggers. Staging → verify → production.
- **Promotion P-3:** after the parity check is green on `staging` and the `site_settings` read count from the API has fallen by at least two orders of magnitude.

---

### PHASE 4 — Data lifecycle and catalogue hygiene
**The largest table in the database is a cron log. 76 MB of 135 MB.**
**Units: P6, P8, P26, P27, P28, P35, P34, and the C-2 reconciliation**

| | D1 | D2 |
|---|---|---|
| **Work** | P6 — `cron.job_run_details` retention 24–48 h, purged in bounded batches. P8 — autovacuum tuned on the churning tables. P26 — audit triggers limited to money, permissions and deletions; store the change, not two full row copies. P27 — thirteen leftover tables dropped or justified, each with a rollback. P35 — six tables given primary keys (this unblocks X9 replica readiness); duplicate index pairs dropped; `post_hashtags.author_id` indexed. P34 — role checks made index-only, **with the effective access-control behaviour proven identical before and after.** P28 — index-to-table ratio as a review gate. **C-2 — reconcile the four index counts to one method, publish it, and only then propose drops.** | Continues Phase 5 front-end work in parallel — this phase is D1-heavy by design, so D2 runs ahead on P11, P12, P15, P16, P21. |
| **Objects reserved (D1)** | `cron.job_run_details`, the audit trigger set, thirteen named tables, six tables without primary keys, two duplicate index pairs, `post_hashtags`, `user_roles`. |

**This is the phase that must be split into three SQL applies, not one.** It is the largest and the least reversible.

- **SQL apply A-4a — EXPAND (additive only):** new primary keys, the missing FK index, autovacuum settings, retention settings. Nothing is dropped. Safe to apply ahead of code.
- **SQL apply A-4b — BEHAVIOUR:** audit-trigger scope change, purge job, role-check index path. Applied after A-4a is stable for 48 h.
- **SQL apply A-4c — CONTRACT (drops):** the thirteen leftover tables, the duplicate index pairs, and any index the reconciled C-2 method proves droppable. **Applied only after Promotion P-4 is live and stable for seven days.** Drops are the one thing that cannot be undone by a redeploy.

- **Promotion P-4:** after A-4a and A-4b, before A-4c.

> **This expand → behaviour → contract split is the answer to "migration at one go is not suggested". It is applied to every phase that drops or renames anything, not only this one.**

---

### PHASE 5 — Delivery and experience
**"The server answers in 19 ms; the delay is in the app." The plan names the symptom and never the cause.**
**Units: P11, P12, P13, P14, P15, P16, P17, P18, P21, P22, P23, P24**

| | D1 | D2 |
|---|---|---|
| **Work** | Supporting queries only where a screen needs one. Otherwise D1 runs ahead on Phase 7 groundwork (P19 hot-path identification, P20 engine evaluation, P29 N+1 tracing). | The whole phase. P11 `OptimizedImage` wired in + a lint rule rejecting bare `<img>`. P16 AVIF alongside WebP. P12 one translation chunk per language. P13 a **binding** byte ceiling — a build that exceeds it fails, it does not warn. P14 Cache-Control / ETag / SWR written down per asset class and verified by fetch. P15 Brotli confirmed. P21 font policy. P17 a written first-paint decision and a named SEO owner. P18 Core Web Vitals per release. P22 a service worker **or a written, dated decision that web offline is out of scope**. P23 WCAG level chosen, automated checks in CI, keyboard and screen-reader walkthrough of ten surfaces. P24 supported-language list, translation source of truth, fallback rule. |

**Two of these are decisions, not code** — P17 and P22 close with a written, dated decision. A decision recorded is a closed gate; silence is not.

**P13 turns the Phase 0 report-only harness into a blocking gate.** That transition is the unit. It copies a discipline the project already applies to images in M11.

- **SQL apply:** none.
- **Promotion P-5:** after the UI gate, the bundle budget and the Web-Vitals report are all green on `staging`, measured on a real mid-range device, not an emulator.

---

### PHASE 6 — Certificates
**The item the Owner asked for by name. It unblocks L6, which cannot be satisfied while the PDF is rebuilt in the browser and never saved.**
**Unit: P25**

| | D1 | D2 |
|---|---|---|
| **Work** | The `certificates` table holds a **private reference only** — no URL, no base64. Issue/reissue path. Delivery through the S2 worker with owner-only authorisation. | Certificate rendered **once**, at issue time, to an immutable PDF in R2. The browser stops rebuilding it at 12 network round trips per view. Owner-only link handling in the UI. |
| **Interface — frozen first** | The R2 object key scheme, the reference column shape, and the S2 worker's authorisation contract, written into `docs/gates/P25-interface.md` before either developer starts. |

**Gate — the hardest in the set:** one immutable PDF per certificate in R2; the database holds a private reference only; delivery through the S2 worker; **a member cannot fetch another member's certificate by address**; L6's forgery-resistance requirement met against a fixed document. That fourth clause is a security test, not a feature check — the Auditor requires a cross-member fetch attempt as evidence.

- **SQL apply A-6:** expand (add reference column) → backfill the single existing row → contract (drop `file_url`) only after P-6 is stable.
- **Promotion P-6.**

---

### PHASE 7 — Scale gates
**Everything above is measured at 106 members. This phase measures it where it matters.**
**Units: P19, P20, P29, and the re-measurement clauses of P34 and C4**

| | D1 | D2 |
|---|---|---|
| **Work** | P19 read-through cache tier with a stated invalidation rule. P20 a search engine **named** and its index built — C4's latency budget met **at 1 million seeded posts, not at today's volume**. P29 the ten heaviest screens traced for N+1, and a written materialized-view policy. P34's re-measurement on seeded data at 1 million rows. | The client half of the search integration; screen-level measurement for the N+1 trace. |
| **Prerequisite** | **A seeded staging dataset at 1 million rows.** Several gates in this addendum are unprovable without it. Building the seeder is the first task of this phase and probably belongs earlier — see §9, question 2. |

- **SQL apply A-7.**
- **Promotion P-7.**

---

## 7 · Promotion checklist — the same nine steps, every time

The Auditor runs this. No step is skipped because the change looks small.

1. Every unit in the phase has status **VERIFIED** in the Gate Register, with an evidence path.
2. `staging.50mmretina.com` verified **in a real browser**, not only by `curl` — a client-side redirect and a server 301 look identical to `curl`, and that distinction has already cost this project a day (F-53).
3. The Android UI gate and the bundle budget are green on `staging`.
4. For any phase with SQL: the **expand** applies are green on **both** lanes, and the contract applies are explicitly deferred.
5. `git diff main..staging` reviewed file by file. Any file neither developer's PR mentioned is a stop.
6. Squash-merge `staging` → `main`. One promotion PR, titled with the phase.
7. Production verified live in a real browser.
8. **`compare/main..staging` re-checked to `0 changed files, 0 additions, 0 deletions`** — Standing Rule 20. The phase is not closed until this reads zero.
9. Ledger entry written: what was promoted, the tree hash, what closed, what stayed open, and every correction against the Auditor's own earlier statements.

---

## 8 · What is deliberately NOT in scope

Stated so nobody quietly assumes it:

- **400 million members.** The addendum is honest about this and so is this plan. The platform is engineered for 1 million, with 10 million as added capacity. 400 million is a different kind of system — regional database splits, separate services for feed, media and identity, a cost model designed before it is built. **No unit in this plan reaches it, and no unit should be sold as reaching it.**
- **Dropping any index before C-2 reconciles.** Hard hold.
- **Any SQL apply against production before the same file is green on staging.** No exceptions, including "it's only a comment".

---

## 9 · What I need from the Owner, and what I recommend

### 9.0 · Owner rulings, 2026-09-02 — settled, and folded into the plan above

| Ruling | Question | Decision | What it changed |
|---|---|---|---|
| **D-15** | Who are the two developers? | **Two Claude sessions.** | §4 rule 7 added: every handoff is a committed file, every phase opens with a written kickoff, every session reads the register rather than assuming, and no session edits a file it does not own — not even a typo. |
| **D-16** | Can staging be seeded to 1 M rows? | **Yes — build the seeder in Phase 0.** | Phase 0 gains the seeder as a D1 task and grows to roughly a week. P20 and P34's scale clauses become provable instead of BLOCKED. |
| **D-17** | Phase order? | **The phase order in this document**, i.e. Part E ranking with the baseline first and P34 after X1/X2. | No change; the order in §6 stands as written. |

These three are settled. They are not reopened without a new ruling recorded here.

### Recommendations I would make whether or not you ask

- **Set a required reviewer on the `production` GitHub Environment.** It has none today, and "allow administrators to bypass" is ticked. With two developers now dispatching work, one human approval before anything touches the production database is cheap insurance.
- **Test the `staging` database credential before Phase 1 starts.** Its environment secret still dates from 31 August and has never been exercised. The probe file already merged — `supabase/migrations/PROBE_credential_connectivity_readonly.sql` — settles it in one dispatch and changes nothing. Discovering a broken staging credential *during* Phase 1 wastes a day.
- **Delete the duplicate repository-level `SUPABASE_DB_URL`.** It is shadowed by the environment secrets and can only mislead the next reader.
- **Give X1 and X2 their own slot before Phase 4.** The addendum calls RLS policy consolidation "the highest-value performance work in the database" (384 duplicate policies across 82 tables), and P34 explicitly extends it. They are existing plan items, not addendum units, so they sit outside this document's numbering — but P34's gate cannot honestly close until they land. **This is the one real dependency this plan has on work it does not itself contain.**
- **Do not let Phase 5 slip to the end.** It is the phase a member can actually feel. Everything before it is invisible to them — correct, necessary, and invisible.
- **One measurement discipline, borrowed from the addendum and worth keeping:** *seek the boring explanation first.* Three of its findings were reduced or withdrawn by that discipline, and it says so. A report that only grows is not a measurement.

---

## 10 · Summary table

| Phase | Units | D1 focus | D2 focus | SQL apply | Promotion |
|---|---|---|---|---|---|
| **0** | — | Baseline snapshot | Bundle + Vitals harness | none | **P-0** (CI only) |
| **1** | P30 P31 P32 P33 | Revocations, definer sweep | Call-site inventory | **A-1** | **P-1** |
| **2** | P1 P2 P10 | Presence server half, replica identity | Timer removal, timer discipline | **A-2** | **P-2** (after 7-day window) |
| **3** | P3 P4 P5 P7 P9 | Publication, LISTEN/NOTIFY, vault | Subscriptions, edge config | **A-3** | **P-3** |
| **4** | P6 P8 P26 P27 P28 P34 P35 + C-2 | Lifecycle & hygiene | (runs ahead on Phase 5) | **A-4a / A-4b / A-4c** | **P-4** (between 4b and 4c) |
| **5** | P11–P18 P21–P24 | (runs ahead on Phase 7) | The whole phase | none | **P-5** |
| **6** | P25 | Reference + worker auth | Render once, R2, UI | **A-6** | **P-6** |
| **7** | P19 P20 P29 | Cache tier, search, N+1 | Search UI, screen tracing | **A-7** | **P-7** |

---

**Prepared by the Auditor. This document proposes; it does not approve, and it closes nothing.**
