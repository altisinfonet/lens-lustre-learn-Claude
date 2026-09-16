# NEXT PLAN — POST-AUDIT DEVELOPMENT & CLOSEOUT PROGRAMME

> ## ⚠ CORRECTION APPLIED 2026-08-27T11:19Z — RECONCILIATION-02
> Two statements in the original version of this plan were **measured and found incorrect** for tree
> `e2e05fbb…` (see `claude/G10_STRICT_EVIDENCE_UPDATE_V3_2026-08-27.md` §B-6):
> **(a)** the G5b **code half is already present in the candidate** — `functions/_seo.ts` carries zero
> production literals and `laneValue()` throws instead of defaulting, and the guard already scans
> `functions/` with rule **R11**. It does **not** require a new candidate and is **not** G11 work.
> **(b)** the production Pages environment requires **three** variables, not two — `SUPABASE_PROJECT_REF`,
> `SUPABASE_ANON_KEY` and **`SITE_ORIGIN`**. Setting only two still throws.
> **Consequence:** OA-6 is reclassified from a parallel Track A item to a **blocking prerequisite of
> §12.4 step 13 DEPLOY**, because deploying without all three makes five SSR SEO routes throw at request
> time. The affected rows below are amended in place and marked **[CORRECTED]**.

**Successor to Master Execution Plan v3.0, which closed 2026-08-27 as
`RELEASE CANDIDATE — NOT APPROVED, NOT PROMOTED` (5 GREEN / 2 deviation / 3 open / 1 deferred).**

**Built from:** the plan read at source · the external auditor's P1–P6 report (verdict **NOT READY**,
BLOCKED-01/02/03) · this session's **BLOCKED-04** · the twenty owner actions in
`G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27` · the AF-03…AF-15 finding register.

**Governing constraint that shapes the entire plan:**
> **`T = e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` is frozen.**
> Any code change to T produces a **new tree** and destroys 21/21 mutants, CI `32976271438`,
> schema guard 122/122, the tree-equality proof, and **every §15 evidence row**.
> **This is the single line that separates Track A from Track B.** It is not a preference; it is the
> reason the programme has two tracks at all.

---

# 0 · PROGRAMME SHAPE

| Track | Name | Tree impact | Purpose | Gate outcome |
|---|---|---|---|---|
| **A** | **G10-CLOSEOUT** | **ZERO** — T unchanged | Everything that can close on the *existing* candidate: attestations, owner-only console actions, the one executable negative test, §15 rulings, approval, promotion | RC approved → promoted → G3/G6/G8/G10 resolve |
| **B** | **G11 — REMEDIATION RELEASE** | **NEW CANDIDATE** | Every code fix. Opens only *after* Track A promotes | AF-03…AF-13, G5b code half, HS-5 blind spot |
| **C** | **G12 — CONTROL HARDENING** | new candidate + infra | Structural fixes the audit exposed in the *governance* rather than the product | closes the classes, not the instances |

**Sequencing rule (non-negotiable):** Track B does not begin until Track A reaches
`§12.4 step 14 — deployment ID captured`. Starting B early forfeits A's entire evidence base.
This is the same failure mode as AF-01: assuming a file is identical across branches.

---

# TRACK A · G10-CLOSEOUT

## A0 · Entry state

RC gate (§6) requires three things, **all currently unmet**:
*"§10 record complete; Change Ledger closed; owner approval recorded."*

## A1 · Wave 1 — start in parallel, today

| ID | Action | Why first | Exit evidence |
|---|---|---|---|
| **OA-8** | Enable branch protection on `main` (Settings → Rules → Rulesets: require PR, block force pushes) | **§14 HS-12 — gates all of G10.** Recorded status: *never configured*. Longest political lead time | owner attestation + UTC. Can never exceed OWNER-ATTESTED (§3.1) |
| **OA-5** | R2 write-isolation test, on the owner's own machine — 4 commands: success control on `50mm-staging`, the AccessDenied test on `50mm`, the `NoSuchBucket` absent control, then cleanup; plus production object count before/after | **The only action that turns a gate GREEN by itself.** Longest technical pole | 4 outputs with credentials redacted + 2 object counts + UTC. If the `50mm` write **succeeds** → STOP, §14 HS-1/HS-9 |
| **OA-6** **[CORRECTED]** | Add **all three** — `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, **`SITE_ORIGIN`** — to the production Pages environment | **Blocking prerequisite of §12.4 step 13 DEPLOY.** `laneValue()` throws on an absent *or* empty variable, so deploying without all three makes `/competitions/[id]`, `/courses/[slug]`, `/featured-artist/[slug]`, `/journal/[slug]` and `/page/[slug]` throw at request time. Owner-only; needs a redeploy | **all three** names listed + a **Change Ledger entry ID** (§16: HIGH blast radius). Two of three is a failure, not partial progress |
| **OA-17** | Sign out of production in the QA browser profile | Unblocks two §15 row-2 flows. Verified still authenticated 2026-08-27 | one line |
| **OA-18** | Provide a real breakpoint instrument + an anonymous third profile | The only path to §15 rows 3 and 10 | one line |

## A2 · Wave 2 — the executable negative test

| ID | Action | Design note |
|---|---|---|
| **OA-3** | **N1** — dispatch *Apply a database migration* from **`staging`**, `target=staging`, with the staging Environment secret temporarily set to the **production project ref and a deliberately invalid password**; restore immediately | §8.1 states the gate refuses **WITHOUT CONNECTING**, so the string need not be real. Two independent layers: (1) ref assertion refuses — this *is* the evidence; (2) if it somehow didn't, authentication fails and no SQL executes. **No real credential is placed anywhere.** A non-existent migration path is a third net |

**Expected refusal line (verbatim):**
`::error::secret points at 'jtdtehuqtinjxropkkcn', target is 'staging' — refusing`
**Evidence:** run ID · the verbatim line · a statement that *"Run it"* never executed · secret restored.
**§14 HS-6 applies:** if a gate refuses, that is the control working. **Fix the target, never the gate.**

## A3 · Wave 3 — rulings and signatures (all parallel)

| ID | Ruling required | Recommendation |
|---|---|---|
| **OA-13** | CHG-005 (the accidental staging Story created by the upload test) vs §17-2 *"no entry is UNINTENDED"* | **Reclassify TEST/HARNESS** — §9.4 defines UNINTENDED as *"any difference between `main` and the RC"*, and this is not one. This is a definitional correction, not a waiver |
| **OA-14** | Close the Change Ledger, CHG-003 = **PREPARED — PENDING PROMOTION** | depends on OA-13. **Satisfies RC gate condition 2** |
| **OA-9** | §11 deviations — sign D-2 naming **all nine** `UNAPPLIED_` files (4 migrations + 4 rollbacks + 1 orphan) | accept for this RC, rename → G11 |
| **OA-10** | Countersign G9 EXCLUDED with its four residual risks | §17-3 |
| **OA-11** | Sign the §10 rollback binding — five files, reverse order 5→1, orphan excluded | §10 field |
| **OA-12** | Rule D-3 **N/A with reason**: *"Preview branch = None, therefore no staging Pages deployment exists for T"* | §10 requires the reason, not just the N/A |
| **OA-15** | Enumerate **D-5 / AF-03 Option D** into the approval | formal acceptance |
| **OA-16** | Rule the Android field **N/A — web-only RC**; log **AF-13** (four contradictory version records) → G11 | §10 field |

**§15 dispositions to sign alongside:** rows **1** and **8** accepted **as known-failing** under D-5 —
**do not relabel them**; row **2** instrument ruling; row **6** must show the five financial functions as
**NOT TESTABLE — POLICY EXCLUSION, visibly, never folded into a coverage ratio**.

## A4 · Wave 4 — approval, then promotion

**OA-19 — §11 Release Approval Record**, all eight fields, after waves 1–3 only.
§11: *"Approval is a separate, explicit act. Reviewing evidence is not approval; a green pipeline is not
approval."* Validity clause is mandatory: *"This approval covers exactly the named tree. Any further
commit to staging voids it and requires a new RC."*
**This single act clears auditor BLOCKED-01/02/03 — all three trace to `approved_tag_count=0`.**

**OA-20 — Promotion, §12.4 in order, no reordering:**

```
 4  RECONCILE   (never migrate merely because a file exists on main)
 8  APPROVE     (OA-19)
    TAG         (before merge — this is what P2 reads)
    MERGE       (conflicts: src/lib/generateCertificatePdf.ts, and .github/workflows/web-build.yml
                 once #103 merges — BOTH resolve to the candidate's version)
11  VERIFY IDENTITY  → assert main tree == e2e05fbb…  BEFORE committing the merge
12  MIGRATE     (approved manifest only; expected NO-OP — all five already applied)
13  DEPLOY      (guard must print its PASS line)
14  CAPTURE DEPLOYMENT ID
```

## A5 · Wave 5 — post-promotion, immediately

| ID | Action | Closes |
|---|---|---|
| **OA-7** | §5.3 secret-isolation probe from `scratch/g10-53-secret-isolation-20260826`; **delete the branch afterwards** | **G3 exit condition.** §5.3.6 requires it *immediately before promotion* — do not run it early to improve a count; it goes stale. The workflow must echo **empty / non-empty only**, never a masked value (§5.3: masking is not proof of absence) |
| **OA-4** | **N2** — dispatch from `main` (now gated), `target=production`, decoy staging ref + invalid password; restore immediately | **§15 row 12 complete; row 4 instrument satisfied.** Cannot run before promotion — `main` has no gate, so a pre-promotion run tests nothing (**§14 HS-11**) |
| **§18** | Post-production checks, before-and-after | **§15 row 11 positive half** — structurally impossible earlier (§17-12) |
| **P4 re-run** | Re-execute the auditor's P4 with `base_ref=='main'` now satisfied | clears **NOT YET VERIFIED** |

## A6 · Track A exit criteria

☐ G8 GREEN (OA-5) ☐ G3 closed-with-deviation (OA-7 + promotion) ☐ G6 GREEN (CHG-003 lands)
☐ ledger closed ☐ §10 complete ☐ §11 approval signed ☐ tree equality asserted at merge
☐ deployment ID captured ☐ §18 clean ☐ auditor re-runs P1–P6 and returns **ACCEPT**

**Track A ceiling: 7 GREEN · 4 CLOSED WITH DOCUMENTED DEVIATION · 0 OPEN.**

---

# TRACK B · G11 — REMEDIATION RELEASE

**Opens only after A5. Produces a new candidate and therefore a full §15 re-run — budget for that
up front rather than discovering it late.**

## B1 · Priority 1 — the two failing §15 rows

| ID | Work | Detail |
|---|---|---|
| **AF-03** | Repoint 46 `cdn.50mmretina.com` references in `site_settings` | **37 live / 9 in `ad_slots_backup_20260723`.** Distribution: `ad_slots` 9 · backup 9 · `ad_zones_v2` 3 · `managed_pages.json_ld` 11 · `managed_pages.og_image` 6 · `seo_pages.og_image` 7 · `seo_global.default_og_image` 1. Enumerated by the recursive-CTE reconciler that lands on exactly 46 — **reuse it as the acceptance test**, do not re-derive by eye. **Proven not a leak**: objects exist in production R2, are absent from staging R2, and production CDN refuses the staging origin. Requires an explicit owner-approved database write — it was correctly withheld under Option D |
| ~~**G5b code half**~~ **[CORRECTED — NOT G11 WORK]** | ~~Remove production defaults from `functions/_seo.ts`; extend the guard from `dist` to `functions/`~~ | **Already present in the candidate**, measured 2026-08-27T11:13Z. Zero production literals under `functions/`; guard `SOURCE_ROOTS = ["functions", "supabase/functions"]` with rule R11. **G5b's only remaining obstacle is OA-6, owner configuration.** No new candidate required |

## B2 · Priority 2 — the real product defect

| ID | Defect | Root cause | Fix |
|---|---|---|---|
| **AF-10** | "Move to trash" is a **silent no-op on `/post/:id`** | `PostCard.tsx` calls `onDelete?.(post.id)` — optional chaining. `Feed.tsx` and `WallPosts.tsx` pass the prop; **`PostDetail.tsx` does not** | pass the handler from `PostDetail`, **and** make the absent-prop case loud rather than silent — the optional chaining is what converted a missing wire into a user-invisible failure |

## B3 · Priority 3 — hygiene backlog (pre-existing; T introduces none)

**AF-04, AF-05, AF-07, AF-08, AF-09, AF-11, AF-12** — each byte-proven pre-existing by direct
T-vs-`main` comparison or production read-only comparison. Triage into fix / accept / close-as-designed
with a written reason each; do not carry them forward as an undifferentiated list.
**AF-13** — four contradictory Android version records: reconcile to one source of truth.
**D-2** — rename the nine `UNAPPLIED_` files.

## B4 · Track B exit criteria

☐ new candidate tagged ☐ **full §15 re-run — all twelve rows, both columns** ☐ mutants re-run on the new
tree ☐ schema guard re-run ☐ AF-03 reconciler returns **0** ☐ rows 1 and 8 move off FAILING

---

# TRACK C · G12 — CONTROL HARDENING

These are the findings the audit exposed in the **governance**, not the product. Each closes a *class*
of defect; fixing only the instances leaves the class open.

| ID | Finding | Fix |
|---|---|---|
| **C-1** | **HS-5 is scoped to build artifacts only.** The governance document therefore shares the guard's blind spot: a cross-lane reference living in **data** (exactly AF-03) trips nothing | Build a **data-side isolation scanner** and give it a hard-stop row of its own. Without this, AF-03 can silently recur after being fixed |
| **C-2** | **Both lanes are saturated** — absent paths return 200 with an SPA shell on staging *and* production, so status codes carry no existence information anywhere in the estate | Add an explicit 404 path, or codify load-success-not-status as the standing probe method. Until then **every** status-based probe in future gates is a potential §14 HS-11 |
| **C-3** | **AF-15 class:** a gate that exists on the candidate but not on the branch it protects | Add a §17-style pre-promotion assertion that the *protecting* branch carries the *protection*, not just the candidate |
| **C-4** | **BLOCKED-04 / auditor checklist gap:** the acceptance checklist can only emit REJECT before promotion, conflating *"report defective"* with *"release hasn't happened"* | Add a **NOT READY (pre-promotion)** terminal state, agreed with the auditor before the next cycle |
| **C-5** | **Four instrument failures were caught only by deliberate negative controls** — console capture reporting "no errors" before tracking armed; async canonical/title read at 2.5s; `resize_window` reporting success 3× while `innerWidth` never moved; a false egress claim | Promote **"arm and prove the instrument before trusting a null result"** from practice to a written §5 clause. Three of the four would have produced a false GREEN |
| **C-6** | **G8 is structurally unclosable by any automated session** — the negative test requires a credential whose handling fires HS-10 | Provision an **object-write-scoped, ephemeral audit credential**, or define an owner-executed evidence format as a first-class evidence class. Otherwise G8 blocks every future release the same way |

---

# D · CRITICAL PATH

```
OA-8 branch protection ─┐
OA-5 R2 test ───────────┤
OA-6 Pages vars ────────┼─► OA-3 (N1) ─► OA-13 ─► OA-14 ledger ─┐
OA-17 / OA-18 ──────────┘                                        ├─► OA-19 §11 APPROVAL ─► OA-20 PROMOTION
OA-9/10/11/12/15/16 + §15 rulings ───────────────────────────────┘            │
                                                                              ▼
                                            OA-7 §5.3 · OA-4 N2 · §18 · auditor P1–P6 re-run
                                                                              │
                                                                              ▼
                                                          ══ TRACK B (G11) OPENS ══
```

**Longest poles:** OA-5 (credential handling on the owner's machine) and OA-8 (organisational).
**Everything in wave 1 and wave 3 is parallel.** Nothing in Track A changes T.

---

# E · STANDING CONSTRAINTS CARRIED FORWARD VERBATIM

- No secret value, token, API key, PAT, service-role key or credential is ever displayed, pasted, logged,
  screenshotted, or committed. **§14 HS-10 treats a tool result as a log.**
- Never introduce a real production credential merely to create a refusal test.
- The five financial edge functions (`create-payment-session`, `submit-deposit`,
  `admin-process-withdrawal`, `paypal-capture-order`, `razorpay-verify-payment`) remain **POLICY
  EXCLUDED** and must be shown as such, never absorbed into a coverage number.
- Do not touch production, `main`, or the frozen tree outside the sequence above.
- Treat any unsupported claim as **OPEN**. Never mark GREEN on inference. Never manufacture convergence.
- If a lane gate refuses, that is the control working — **fix the target, never the gate** (§14 HS-6).

---

*Track A closes the release. Track B fixes the product. Track C fixes the process that let the product
defects reach a release gate undetected. All three are needed; only Track A is urgent.*
