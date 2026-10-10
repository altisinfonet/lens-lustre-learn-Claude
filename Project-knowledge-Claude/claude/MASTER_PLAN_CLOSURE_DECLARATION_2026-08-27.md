# MASTER EXECUTION PLAN v3.0 — CLOSURE DECLARATION

**Date:** 2026-08-27 · **Scope:** G1 → G10, the complete plan
**Candidate:** `T = e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` (staging commit `b8535fe7c9f2c7f604347ba849ac579bf4946d23`)
**`main`:** `b671e1fb` (tree `db8df567…`) · PR #103 unmerged · production unwritten · **RC NOT APPROVED**
**Reconciled against:** the Master Execution Plan v3.0 read at source, plus the external auditor's
P1–P6 package received 2026-08-27.

---

## 1 · THE DECLARATION

# ❌ THE MASTER PLAN DOES NOT CLOSE ALL GREEN.

It cannot, and no wording, re-labelling, or re-scoping in this session can make it so. The statement
below is the closure of the plan — it is a **conditional close**, not a green close.

> **Master Execution Plan v3.0 is CLOSED AS EXECUTED at 2026-08-27, in the state
> `RELEASE CANDIDATE — NOT APPROVED, NOT PROMOTED`.
> Five of eleven gate units are unqualified GREEN. Two are CLOSED WITH DOCUMENTED DEVIATION.
> Three are OPEN or BLOCKED. One (G10) is structurally DEFERRED because promotion has not occurred.
> §15 stands at 2 VERIFIED · 8 PARTIAL · 2 FAILING.
> No gate has been marked GREEN on inference, and no evidence class has been upgraded by wording.**

**Why an all-GREEN close was never reachable in this pass** — three independent structural reasons,
each written into the plan itself:

| # | Reason | Plan clause |
|---|---|---|
| 1 | **G10 is defined post-promotion.** Its exit condition is *"main tree equals the approved RC tree; production verified post-deploy."* No promotion has occurred, so G10 has no legitimate GREEN state today. | §6 G10 |
| 2 | **G3 and G5b have a ceiling below GREEN.** Environment creation and repository-secret deletion are OWNER-ATTESTED *by construction*, and §3.1 states such items *"May NOT be described as verified."* G5b's code half changes the tree and therefore destroys the candidate. | §3.1, §20 G5b |
| 3 | **G8's negative test cannot be executed by any session.** It needs the staging R2 object-write credential; handling that value would itself fire §14 **HS-10** and force a rotation. Closing a gate by triggering a hard stop is not closing it. | §8.6, §14 HS-10 |

---

## 2 · GATE-BY-GATE FINAL STATE

| Gate | Final state | Basis | What is missing |
|---|---|---|---|
| **G1** Production baseline | ✅ **GREEN** | §8.10 fingerprint set re-measured 2026-08-27 07:38:38Z — all seven "must never move" values identical. Drift (+1 user, +11 posts) investigated to two pre-existing organic authors, zero QA contamination | — |
| **G2** Staging project | ✅ **GREEN** | `ztzutckwdhetphwghuzj`, 513 synthetic `@staging.test` accounts | — |
| **G3** Migration lane isolation | 🔴 **OPEN** | Repository-scope `SUPABASE_DB_URL` **independently verified absent** (`repo=0 env=1`); T carries the 8-step gated workflow | §5.3 probe **never run** (workflow exists, zero runs); Environments OWNER-ATTESTED by construction; **AF-15** — `main`'s 6-step workflow satisfies none of §8.1's four clauses until promotion |
| **G4** Lane-aware config | ✅ **GREEN** | production `_headers` byte-identical | — |
| **G5a** Build-artifact guard | ✅ **GREEN** | 41/41 harness; **21/21 mutants on this exact tree** (run `32982588154`) | — |
| **G5b** Pages Functions defaults | 🔴 **OPEN** | — | Pages variables absent (owner-only); **and** the code half (`functions/_seo.ts` defaults, guard → `functions/`) which requires a **new candidate** |
| **G6** Header/redirect parity | 🟡 **CLOSED WITH DOCUMENTED DEVIATION** | staging direction evidenced under G5a | production direction lands with **CHG-003 at promotion** |
| **G7** Staging Pages + DNS | ✅ **GREEN** | serving; previews disabled (`Preview branch: None`) | — |
| **G8** R2 bucket isolation | 🔴 **BLOCKED** | §8.6 part 1 ✅ — upload lands in `50mm-staging`, served 240×140 from `cdn-staging` with 2×2 controls | §8.6 **parts 2 and 3**: the AccessDenied write-refusal negative test and the production object count. **Blocked on the credential, not the network** (egress corrected: R2 endpoint returns HTTP 400, exit 0) and not on tooling (`aws` is installable) |
| **G9** Edge function inventory | 🟡 **CLOSED WITH DOCUMENTED DEVIATION** | §14 EXCLUDED ruling on a 71-function basis | owner **countersignature** on the four residual risks |
| **G10** Promotion | ⏸ **DEFERRED** | — | branch protection (HS-12, never configured), §11 approval, the merge, §17-11 tree equality, §18 post-deploy |

**Tally: 5 GREEN · 2 CLOSED WITH DOCUMENTED DEVIATION · 3 OPEN/BLOCKED · 1 DEFERRED.**

---

## 3 · §15 QA MATRIX — FINAL STATE

**2 VERIFIED · 8 PARTIAL · 2 FAILING · 0 blank.**

| # | Row | State | Governing gap |
|---|---|---|---|
| 1 | UI | 🔴 FAILING | AF-03/D-5 — assets resolve to `cdn.50mmretina.com` on 29 routes; instrument also lacks a deployment ID (D-3) |
| 2 | Flows | 🟡 PARTIAL | 7/10 verified; negative criterion **now evidenced** by the §8.10 re-measurement; 2 blocked on B20, 1 structurally untestable |
| 3 | Auth | 🟡 PARTIAL | needs an anonymous browser context; password reset **N/A — no staging mail path** |
| 4 | Database | 🟡 PARTIAL | RLS 18 assertions + 4 controls ✅; instrument additionally demands **lane-gate refusal transcripts** (N1/N2) |
| 5 | Storage | 🟡 PARTIAL | upload chain ✅; write-refusal + object counts = the G8 blocker |
| 6 | Edge Functions | 🟡 PARTIAL | 5/74 invoked, all staging, **zero production function calls**; the 5 financial functions are **POLICY EXCLUDED and must be shown as such, not buried in a coverage ratio** |
| 7 | Security | ✅ **VERIFIED** | guard + 21/21 mutants |
| 8 | SEO | 🔴 FAILING | instrument **closed** (same-minute dual-host probe with known-present/known-absent controls); criterion still fails — `og:image` / `json_ld` point at production |
| 9 | Email | ✅ **VERIFIED (vacuous — recorded as vacuous)** | no send path; §8.8 Option 1 |
| 10 | Responsive | 🟡 PARTIAL | `server.url` ✅; **no working viewport instrument** — `resize_window` reported success 3× while `innerWidth` stayed 1536 |
| 11 | Regression | 🟡 PARTIAL | negative half evidenced; positive half is §18 — **structurally post-promotion** |
| 12 | Cross-lane | 🟡 PARTIAL | N3–N8 ✅; **N1/N2 open** |

**A §5.1 finding recorded during closure:** both lanes are **saturated** — absent paths return HTTP 200
with an SPA shell on staging *and* production. Status codes therefore carry **no existence information**
on either host. This is precisely the failure the mandated known-present/known-absent pairing exists to
detect, and it retroactively validates the decision to use load-success rather than status for the R2 and
image probes.

---

## 4 · INDEPENDENT AUDITOR RECONCILIATION

The external auditor's package **independently corroborated the identity chain** with no divergence:
`main b671e1fb` / tree `db8df567…`; staging `b8535fe7` / tree `e2e05fbb…`; merge-base `32930e75…`;
123 files; `rev-list --left-right = 2 25`; **zero approved tags**.

Their P1–P6 result at measurement timestamp `2026-08-27T10:48:06Z`:

| Step | Result |
|---|---|
| P1 candidate tree identity | ✅ **VERIFIED** — `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`, 40 hex |
| P2 approved tag | 🔴 **BLOCKED** — `approved_tag_count=0`, `all_tags_count=0` |
| P3 | 🔴 **BLOCKED** |
| P4 production lane gate | 🟠 **NOT YET VERIFIED** — production lane SKIPPED, gated on `base_ref=='main'` |
| P5 | 🔴 **BLOCKED** |
| P6 | 🔴 **BLOCKED** |

**Counts: VERIFIED 2 · OWNER-ATTESTED 0 · BLOCKED 4 · NOT APPLICABLE 0 · NOT YET VERIFIED 1.
Auditor verdict: NOT READY.** This session concurs and added **BLOCKED-04** to their matrix.

Their "Add files via upload" RISK marker was resolved by path-level review: four commits touching
**two files only** (`src/__tests__/certificatePalette.test.ts`, `src/lib/generateCertificatePdf.ts`),
additive-dominant — **not** the broad multi-file drop that previously left five files behind and caused a
real regression in this repository. Sharpened, however:
`generateCertificatePdf.ts` is also the recorded promotion merge conflict, so it must be resolved to the
candidate's version and the resulting tree asserted equal to `e2e05fbb…` before the merge commits.

**One structural note returned to the auditor:** their acceptance checklist can only emit REJECT
pre-promotion, which conflates *"the report is defective"* with *"the release has not happened yet."*
A distinct **NOT READY (pre-promotion)** state is required for the checklist to be usable on this RC.

---

## 5 · WHAT WAS ACTUALLY CLOSED IN THIS FINAL PASS

| Item | Was | Now |
|---|---|---|
| §8.10 production-unchanged check | not executed | ✅ executed clean, drift investigated to named organic authors |
| §15 row 2 negative criterion + instrument | missing | ✅ evidenced |
| §15 row 11 negative criterion | missing | ✅ evidenced |
| §15 row 8 instrument (same-minute dual-host, both controls) | not performed in the mandated form | ✅ closed |
| OA-1 repository-secret scope | assumed | ✅ **independently verified** (`repo=0`) |
| AF-15 severity | asserted as a live production vulnerability | ✅ de-escalated **on evidence** — `main`'s workflow is structurally incapable of obtaining a DB URL (run `32829440334` fails at exactly that step). Still a real §8.1 required-state gap |
| Container egress claim | stated as blocked — **wrong** | ✅ corrected; the 403 was a proxy block on `*.50mmretina.com` only |

---

## 6 · THE HONEST CEILING

Even with every remaining owner action executed perfectly:

- **G3** and **G5b** can reach at most **CLOSED WITH DOCUMENTED DEVIATION** — §3.2 expressly permits this
  in a Release Candidate. G3 because its attested items may never be called verified; G5b because its
  code half costs the candidate.
- **G8** is **the only gate that flips to GREEN on a single owner action** (OA-5).
- **G10** turns GREEN only after promotion, tree-equality assertion, and §18.

**Therefore the maximum legitimate end state of this RC is:
7 GREEN · 4 CLOSED WITH DOCUMENTED DEVIATION · 0 OPEN — never 11 GREEN.**
Anyone reporting eleven greens on this candidate is reporting something that does not exist.

---

## 7 · CLOSURE SIGNATURE BLOCK (unsigned)

```
MASTER EXECUTION PLAN v3.0 — CLOSURE
State declared ......... RELEASE CANDIDATE — NOT APPROVED, NOT PROMOTED
Candidate tree ......... e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
Gates GREEN ............ 5 of 11   (G1, G2, G4, G5a, G7)
Closed w/ deviation .... 2         (G6, G9)
Open / blocked ......... 3         (G3, G5b, G8)
Deferred ............... 1         (G10 — post-promotion by definition)
§15 .................... 2 VERIFIED · 8 PARTIAL · 2 FAILING
Independent auditor .... NOT READY (2 VERIFIED · 4 BLOCKED · 1 NOT YET VERIFIED)
All-GREEN close ........ NO
Successor plan ......... G10-CLOSEOUT / G11 (see NEXT_DEVELOPMENT_PLAN_2026-08-27)

Owner ............ ______________________   Date (UTC) ______________
```

*T unchanged · `main` unchanged · production read-only and verified unchanged by its own §8.10
instrument · nothing dispatched, signed, merged or written to produce this declaration.*
