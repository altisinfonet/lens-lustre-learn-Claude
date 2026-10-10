# G10 — STRICT EVIDENCE MODE UPDATE

**Report timestamp (UTC):** 2026-08-27
**Basis:** the eight externally verified facts supplied 2026-08-27. Nothing outside that set is treated
as verified. No writes, no dispatches, no signatures, no merges were performed to produce this report.
**Candidate:** `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`

---

## 0 · CONVENTIONS USED IN THIS REPORT

**Statuses (the five permitted, no others):**
`VERIFIED` · `OWNER-ATTESTED` · `BLOCKED` · `NOT APPLICABLE` · `NOT YET VERIFIED`

**Verification basis** is reported in its own column so that the status vocabulary is not overloaded:

| Basis code | Meaning |
|---|---|
| `EXT-n` | Directly supported by supplied external fact *n* |
| `SI+C` | Session instrument **with** a negative/known-absent control — discriminating |
| `SI−C` | Session instrument **without** a control — non-discriminating, cannot support VERIFIED |
| `OWNER` | Owner statement only |
| `NONE` | No instrument exists or none was run |

**Scope of VERIFIED.** VERIFIED is asserted only for the specific proposition stated in the row. Where an
external fact verifies a container (that a run exists, that it concluded) but not its content, the
container is reported VERIFIED and the content is reported separately as NOT YET VERIFIED. Fact 8 is the
governing example.

**NOT RECORDED** appears in timestamp fields where no measurement time was captured. It is not an
approximation and no time has been inferred.

---

# SECTION A · ACCEPTED FACTS FROM EXTERNAL VERIFICATION

| # | Fact | Status | Basis |
|---|---|---|---|
| A-1 | `main` commit = `b671e1fb0c5bcf145d442076c229eca888afd674`; `main` tree = `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` | **VERIFIED** | EXT-1 |
| A-2 | staging commit = `b8535fe7c9f2c7f604347ba849ac579bf4946d23`; staging tree = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` | **VERIFIED** | EXT-2 |
| A-3 | merge base = `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` | **VERIFIED** | EXT-3 |
| A-4 | `rev-list --left-right --count main...staging` = **2 and 25** — `main` carries **2** commits absent from staging; staging carries **25** absent from `main` | **VERIFIED** | EXT-4 |
| A-5 | changed paths across `main...staging` = **123** | **VERIFIED** | EXT-5 |
| A-6 | approved tag count = **0**; total tag count = **0** | **VERIFIED** | EXT-6 |
| A-7 | PR 101 merged = true; PR 102 merged = true | **VERIFIED** | EXT-7 |
| A-8 | Workflow run **32950030302** exists · name `G10 secret isolation probe` · branch `scratch/g10-53-secret-isolation-20260826` · conclusion **success** | **VERIFIED** | EXT-8 |

**A-9 — Derived and safe to derive.** The candidate tree `e2e05fbb…` and the current `main` tree
`db8df567…` are **not equal**. §17-11 requires equality **after** promotion. — **VERIFIED**, basis EXT-1 + EXT-2.

**A-10 — Derived and safe to derive.** With total tag count = 0, **no tag of any kind points at
`e2e05fbb…`**, therefore no §11 approval artifact exists in the repository. — **VERIFIED**, basis EXT-6.

---

# SECTION B · CLAIMS REQUIRING ADDITIONAL PROOF

Every row below carries instrument, UTC timestamp, raw output summary, and artifact reference.
No row in this section is reported VERIFIED on the strength of an external fact it does not have.

## B.1 · The §5.3 secret-isolation probe — the fact-8 split

| Field | Entry |
|---|---|
| **Claim** | The §5.3 secret-isolation probe satisfies the G3 exit condition |
| **Status** | **NOT YET VERIFIED** |
| **Basis** | EXT-8 verifies the *container*; `NONE` for the *content* |
| **Instrument used** | GitHub Actions run listing (external) — run `32950030302` |
| **UTC timestamp** | run execution time **NOT RECORDED** in the supplied fact set |
| **Raw output summary** | Supplied fact states only: name `G10 secret isolation probe`, branch `scratch/g10-53-secret-isolation-20260826`, conclusion `success`. **The log body was not supplied and has not been read.** |
| **Artifact** | `https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/32950030302` |

**Why a success conclusion does not close G3.** §8.1's exit condition is not *"the probe ran"*; it is
*"the §5.3 negative test shows the production database reference resolving **empty** outside its lane."*
A `success` conclusion proves the workflow completed without a non-zero exit. It does not distinguish
between:

1. the probe printing the required EMPTY line — the intended result;
2. the probe printing a **masked** value, which §5.3 states explicitly is **not proof of absence**;
3. the probe's assertion step being skipped, no-op'd, or short-circuited while the job still exits 0.

Cases 2 and 3 both produce `conclusion: success`. This is **§14 HS-11** in its exact defined form — a
probe whose result is indistinguishable from absence, caching, or a gate. Marking G3 VERIFIED on fact 8
alone would be a false green.

**Three proofs outstanding, each individually blocking:**

| # | Outstanding proof | Status |
|---|---|---|
| B.1.a | The verbatim log line showing the production database reference resolving **EMPTY**, and confirmation the workflow echoes **empty / non-empty only** — never a value, never a masked value | **NOT YET VERIFIED** |
| B.1.b | §5.3.6 requires the probe **immediately before promotion**. Run `32950030302` predates any promotion by an unmeasured interval. A prior run is **stale by construction** and must be re-taken, not inherited — §19 states this explicitly for G10 step 7 | **NOT YET VERIFIED** |
| B.1.c | §5.3 requires the probe branch to be **deleted afterwards**. Fact 8 shows `scratch/g10-53-secret-isolation-20260826` still resolving as a branch reference | **NOT YET VERIFIED** |

> ## RECONCILIATION-01 — a prior session record conflicts with fact 8
> `claude/G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27.md` §5 records: *"The G10 one has **zero runs**.
> A workflow existing is not evidence."* **Fact 8 contradicts that record.** Exactly one of the
> following is true and it has not been determined which: (a) the earlier observation was stale or
> wrong, or (b) the run occurred after that observation was taken. Neither this report nor the prior
> pack may be treated as authoritative on run history until the run's start time is read.
> **This conflict is recorded, not silently absorbed.** Status: **NOT YET VERIFIED**.
> **Instrument required:** run `32950030302` `run_started_at`, compared against the pack's creation
> time `2026-08-27T07:21:24Z`.

## B.2 · Promotion mechanics

| ID | Claim | Status | Basis | Instrument required | UTC | Raw output summary | Artifact |
|---|---|---|---|---|---|---|---|
| B-2.1 | An approved tag exists naming `e2e05fbb…` | **BLOCKED** | EXT-6 | — | 2026-08-27 | `all_tags_count=0` — no artifact can exist to read | fact 6 |
| B-2.2 | A §11 Release Approval Record exists with all eight fields signed | **BLOCKED** | NONE | signed record | — | no record exists | — |
| B-2.3 | The **2 commits on `main` absent from staging** (fact 4) are accounted for and their paths are known | **NOT YET VERIFIED** | NONE | `git rev-list --left-only --oneline main...staging` then `git diff --name-only` per commit | NOT RECORDED | not run in this pass | — |
| B-2.4 | A merge of staging into `main` produces a tree exactly equal to `e2e05fbb…` (§17-11) | **NOT YET VERIFIED** | NONE | trial merge in a scratch clone; `git rev-parse HEAD^{tree}` compared to `e2e05fbb…` | NOT RECORDED | not run | — |
| B-2.5 | PR 103 merge state | **NOT YET VERIFIED** | NONE | PR state query | — | **PR 103 is not in the supplied fact set.** Facts 7 covers PR 101 and 102 only. Its state is therefore unverified in this report notwithstanding any earlier session record | — |
| B-2.6 | Branch protection is active on `main` (§14 HS-12) | **OWNER-ATTESTED** *(pending — no attestation on file)* | NONE | owner statement; §17-7 states it **cannot be read by any session** and is never recorded as independently verified | — | no attestation on file. §19 records the row as never configured | — |

**B-2.3 is not bookkeeping.** Fact 4 establishes that `main` holds two commits staging does not. If either
touches a path also changed on the candidate side, a plain merge cannot yield tree equality without
conflict resolution to the candidate's version. `src/lib/generateCertificatePdf.ts` is already on record
as a promotion merge conflict. **Tree equality must be asserted before the merge is committed, not
discovered after** — §12.4 step 11 precedes step 12 for this reason.

## B.3 · Gate exit conditions

| Gate | Claim | Status | Basis | Instrument | UTC | Raw output summary | Artifact |
|---|---|---|---|---|---|---|---|
| **G1** | §8.10 "production is unchanged" fingerprint set holds | **VERIFIED** | SI+C | seven-fingerprint query set re-measured against the recorded baseline; drift counts investigated to named authors — the investigation is the control | **2026-08-27T07:38:38Z** | 7/7 must-never-move values identical (tables 146, vault 4, cron 16, buckets 11, RLS policies 686, site_settings 35, ledger max `20260825115208`). Drift +1 auth user, +11 posts; 2 posts in the QA window, 2 distinct authors, **2 of 2 pre-dating the baseline**, 0 by any admin, 0 by the QA identity, 0 containing a G10 test string | `claude/G1_G10_FINAL_CLOSURE_REPORT_2026-08-27.md` §1 |
| **G3** | §8.1 four clauses present on the branch being protected | **NOT YET VERIFIED** | SI+C for the finding; NONE for the remedy | file comparison across trees, md5 | NOT RECORDED | `main` copy md5 `b7a9675bc7ac068f93e8214d37c2cdc4`, 6 steps; candidate copy md5 `fce7d4f5143c035de6863e2e290f7b30`, 8 steps. **AF-15.** Resolved only by promotion | `claude/G10_AF15_MIGRATION_LANE_GATE_ABSENT_ON_MAIN_2026-08-27.md` |
| **G3** | Repository-scope `SUPABASE_DB_URL` is absent | **VERIFIED** | SI+C | secret-scope flag read; scopes `repo=0 env=1 org=-1`. Control: the same read returns `env=1`, so a uniform zero is excluded | NOT RECORDED | `SUPABASE_DB_URL` absent at repository scope; present only as an Environment secret. **No value, fragment, or hash of any secret was read, printed, or stored** | `claude/G1_G10_FINAL_CLOSURE_REPORT_2026-08-27.md` §2 |
| **G3** | Environments exist and repository copies were deleted | **OWNER-ATTESTED** | OWNER | §3.1 — *"May NOT be described as verified"* | — | attested by construction; not readable by any session | §3.1 |
| **G5a** | Guard blocks the mutations it must block | **VERIFIED** | SI+C | mutation harness on the candidate tree — run `32982588154` | NOT RECORDED | 41/41 harness; **21/21 mutants killed on tree `e2e05fbb…`**. Mutation testing is inherently controlled: a mutant that survives is the negative case | run `32982588154` |
| **G5b** | Production Pages variables `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY` exist | **NOT YET VERIFIED** | NONE | Cloudflare Pages → `lens-lustre-learn` → Variables and Secrets → Production | — | not present on last inspection; owner-only to set. §16 classifies this HIGH blast radius | §19 G5b row |
| **G5b** | Production defaults removed from `functions/_seo.ts`; guard extended to `functions/` | **BLOCKED** | NONE | — | — | **Structurally blocked on this candidate.** Both are code changes; either produces a new tree and voids the 21/21 mutants, CI `32976271438`, schema guard 122/122, tree-equality proof, and every §15 row | §20 G5b |
| **G8** | §8.6 part 1 — upload lands in `50mm-staging`, readable at the staging CDN | **VERIFIED** | SI+C | upload through the staging flow, then fetch from `cdn-staging`, with a 2×2 control grid across both origins and both present/absent paths | NOT RECORDED | object served **240×140** from `cdn-staging`; controls discriminate on both origins | `claude/G10_PHASE5_QA_RUN2_FULL_EVIDENCE_2026-08-27.md` |
| **G8** | §8.6 part 2 — staging credentials attempting a **write to the production bucket are REFUSED** | **BLOCKED** | NONE | Appendix A.5 `aws s3api put-object` against `50mm`, with a `50mm-staging` success control and a non-existent-bucket `NoSuchBucket` control | — | **not executed.** Blocker is the credential, not the network and not the tooling: container egress to the R2 endpoint returns **HTTP 400, exit 0** (reachable), and `aws` is installable. Reading the staging R2 secret would itself fire **§14 HS-10** and force a rotation | Appendix A.5 |
| **G8** | §8.6 part 3 — production bucket object count unchanged across the gate | **BLOCKED** | NONE | account-scoped read credential, `list-objects-v2 --query KeyCount`, before and after | — | not measured | Appendix A.5 |
| **G9** | 71-function EXCLUDED ruling countersigned with its four residual risks | **NOT YET VERIFIED** | NONE | owner signature | — | drafted, unsigned. **Drafted is not signed** | `claude/G10_PHASE7_READINESS_CHECKLIST_2026-08-27.md` |
| **G10** | Promotion executed, §12.4 steps 11–14 | **NOT YET VERIFIED** | EXT-6 excludes it | — | — | no approval, no tag, no merge, no deployment ID | — |

## B.4 · §15 rows whose instrument or criterion is outstanding

| Row | Outstanding element | Status | Basis | Instrument | UTC | Raw output summary | Artifact |
|---|---|---|---|---|---|---|---|
| 1 UI | criterion fails; instrument lacks a deployment ID | **NOT YET VERIFIED** | SI+C | route sweep | NOT RECORDED | assets resolve to `cdn.50mmretina.com` on 29 routes (AF-03 / D-5). No staging Pages deployment exists for the candidate — previews disabled, `Preview branch: None` (D-3) | `claude/G10_PHASE5_CONSOLIDATED_QA_CLOSURE_2026-08-27.md` |
| 2 Flows | 3 of 10 flows | **NOT YET VERIFIED** | SI+C for the 7 | interactive execution | NOT RECORDED | 7/10 executed; 2 blocked on the production-authenticated QA profile, 1 structurally untestable. Negative criterion satisfied by the G1 row above | same |
| 4 Database | lane-gate refusal transcripts (N1, N2) | **NOT YET VERIFIED** | SI+C for RLS | `set local role` + `request.jwt.claims` in rolled-back transactions | NOT RECORDED | 18 RLS assertions with **4 controls**; transcripts absent | same |
| 5 Storage | negative half | **BLOCKED** | NONE | see G8 part 2 | — | same blocker | Appendix A.5 |
| 6 Edge functions | scope ruling | **NOT YET VERIFIED** | SI+C | staging invocation with request-ID accounting | NOT RECORDED | 5/74 invoked, all staging; **0 production function calls from staging flows**; staging logs 347/347 request IDs. **5 financial functions are NOT APPLICABLE — POLICY EXCLUSION**, and must be displayed as such, never absorbed into a coverage ratio | same |
| 7 Security | — | **VERIFIED** | SI+C | see G5a | NOT RECORDED | 21/21 mutants on this tree | run `32982588154` |
| 8 SEO | criterion fails; instrument now satisfied | **NOT YET VERIFIED** | SI+C | both hosts probed **in the same minute** with a known-present and a known-absent path | **staging 2026-08-27T07:26:03Z · production 2026-08-27T07:26:43Z** | robots/sitemap/CSP/HSTS/XFO/nosniff/referrer-policy read on both; `x-robots-tag` **absent on both**. **Known-absent path returns HTTP 200 with an SPA shell on both hosts** — both lanes are saturated, so status codes carry no existence information on either. Criterion still fails: `og:image` and `json_ld` resolve to production | `claude/G1_G10_FINAL_CLOSURE_REPORT_2026-08-27.md` §4 |
| 9 Email | — | **NOT APPLICABLE** | SI−C | — | — | no send path exists; §8.8 Option 1. Recorded as vacuous, not as passing | §8.8 |
| 10 Responsive | breakpoints | **BLOCKED** | SI−C | `resize_window` | NOT RECORDED | instrument reported "Successfully resized" **3 times across 2 rounds while `innerWidth` remained 1536**. No substitute was accepted; CSS simulation was refused | `claude/G10_PHASE5_INTERACTIVE_QA_RUN_2026-08-27.md` |
| 11 Regression | positive half | **NOT YET VERIFIED** | NONE | §18 before/after against production | — | **structurally post-promotion** (§17-12) | §18 |
| 12 Cross-lane | N1, N2 | **NOT YET VERIFIED** | SI+C for N3–N8 | dispatch with a deliberately invalid password and the opposing project ref — §8.1 refuses **WITHOUT CONNECTING**, so no real credential is required at any point | — | N3–N8 executed; N1 not yet dispatched; **N2 cannot be dispatched before promotion** — `main` carries no gate, so a pre-promotion N2 would test nothing (**§14 HS-11**) | `claude/G10_PHASE5_QA_RUN3_ROOT_CAUSE_AND_FEATURE_VERIFICATION_2026-08-27.md` |

## B.5 · Independent auditor position

| Claim | Status | Basis | Instrument | UTC | Raw output summary | Artifact |
|---|---|---|---|---|---|---|
| Auditor P1–P6 executed | **VERIFIED** | auditor package | auditor's own harness | **2026-08-27T10:48:06Z** | P1 VERIFIED (`candidate_tree=e2e05fbb…`, 40 hex) · P2 BLOCKED (`approved_tag_count=0`, `all_tags_count=0`) · P3 BLOCKED · P4 NOT YET VERIFIED (production lane SKIPPED, gated on `base_ref=='main'`) · P5 BLOCKED · P6 BLOCKED. Counts: VERIFIED 2 · OWNER-ATTESTED 0 · BLOCKED 4 · NOT APPLICABLE 0 · NOT YET VERIFIED 1 | auditor report |
| Identity chain corroborated with zero divergence | **VERIFIED** | EXT-1…EXT-5 + auditor | independent re-derivation | 2026-08-27T10:48:06Z | `main b671e1fb` / tree `db8df567…`; staging `b8535fe7` / tree `e2e05fbb…`; merge base `32930e75…`; 123 paths; left-right 2/25; zero tags — **identical to facts 1–6** | auditor report |
| BLOCKED-04 raised by this session | **VERIFIED** | this session | checklist review | 2026-08-27 | The auditor's acceptance checklist can emit only REJECT before promotion, conflating *"the report is defective"* with *"the release has not occurred."* A distinct **NOT READY (pre-promotion)** terminal state is required | this report |

---

# C · SECRET-HANDLING ATTESTATION

No secret value, fragment, masked rendering, hash, or derived form of any credential appears anywhere in
this report. Two checks in Section B concern secrets and both report **scope and presence only**:
G3's repository-scope check reports the flag `repo=0`, and G8's blocker reports that a credential is
*required and was not read*. The existence of each check is stated rather than omitted, in both cases
without exposing the object of the check. §5.3's rule is applied throughout: **a masked value is not
proof of absence** and is never accepted as evidence.

---

# D · VERDICT

## Promotion verdict: **NOT READY**

**Reason:** approved tag count is 0 and total tag count is 0, so no §11 approval artifact exists for tree
`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`, and the four independently blocking proofs behind it — the
§5.3 EMPTY log line, the G8 production-write refusal, the N1/N2 lane-gate transcripts, and the
`main`-tree-equals-candidate-tree assertion — are each NOT YET VERIFIED or BLOCKED.

**Status counts across Sections A and B:**
`VERIFIED` **17** · `OWNER-ATTESTED` **2** · `BLOCKED` **6** · `NOT APPLICABLE` **2** ·
`NOT YET VERIFIED` **21**.

**Single highest-value correction carried by this report:** external fact 8 verifies that the §5.3 probe
**ran and concluded success**. It does **not** verify what the probe printed. G3 remains
**NOT YET VERIFIED**, and the run must be re-taken immediately before promotion regardless, per §5.3.6.

*Candidate tree unchanged · `main` unchanged · production untouched · nothing dispatched, signed, tagged
or merged to produce this report.*
