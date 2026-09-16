# G10 — FINAL OWNER EXECUTION PACK

**2026-08-27. Built from Master Execution Plan v3.0 read at source and the verified evidence on file.
Nothing was run, changed, dispatched or signed to produce this pack.**

**Frozen state · do not alter without reading §TREE IMPACT on each action:**
`T = e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` · `main = b671e1f` (tree `db8df567…`) ·
PR #103 unmerged · production unwritten · AF-03 unapplied · RC **NOT APPROVED**.

**Repository:** `altisinfonet/lens-lustre-learn-Claude`
**Cloudflare account:** `a7810011a99de537a210130f86306785` · production Pages project `lens-lustre-learn` ·
staging Pages project `lens-lustre-learn-claude-staging`

---

# 0 · TREE IMPACT SUMMARY — READ FIRST

| Action | Current tree | Resulting tree | Evidence invalidated | New QA run? |
|---|---|---|---|---|
| **OA-1 … OA-12** (all owner actions in this pack) | T `e2e05fbb…` | **T `e2e05fbb…` — UNCHANGED** | **NONE** | **NO** |
| OA-13 promotion merge | `main` `db8df567…` | `main` tree **must equal** `e2e05fbb…` (§17-11) | none — this *is* the promotion | no |
| ⚠ *Any code fix to AF-04…AF-12, AF-15 on `main`, or the G5b guard extension* | T `e2e05fbb…` | **NEW TREE** | **21/21 mutants · CI `32976271438` · schema guard 122/122 · tree-equality proof · all §15 evidence** | **YES — full re-run** |

**No action in this pack changes T.** The only tree-changing item is the promotion merge itself.

---

# 1 · G3 / AF-15 — MIGRATION LANE GATE

## 1.1 Exact requirement

**§8.1 "Required state":**
> *"apply-migration.yml takes a target input, declares `environment: ${{ inputs.target }}`, refuses
> unless `github.ref_name` matches the lane, and parses the project reference out of the connection
> string to refuse a mismatch **WITHOUT CONNECTING**."*

**§8.1 "Exit condition":** *"…The §5.3 negative test shows the production database reference resolving
empty outside its lane. Environments and deletion are recorded as OWNER-ATTESTED."*

## 1.2 Why it blocks GREEN

`main`'s copy (md5 `b7a9675bc7ac068f93e8214d37c2cdc4`, 6 steps) satisfies **none** of the four clauses:
no `target` input, `environment:` commented out, no branch check, no ref assertion, and it reads a
**repository-level** `secrets.SUPABASE_DB_URL`. T's copy (md5 `fce7d4f5143c035de6863e2e290f7b30`,
8 steps) satisfies all four.

## 1.3 THE CURRENT-STATE PROBLEM vs THE POST-PROMOTION STATE — they are different

| | Now (pre-promotion) | After promotion |
|---|---|---|
| `main` workflow | 6 steps, **no gate of any kind** | T's 8-step gated version (§17-11 asserts tree equality) |
| Exposure | Any dispatch from `main` runs repo SQL against whatever the **repository-level** secret points at | Gate present before any migration runs |
| Live control | **The repository-level `SUPABASE_DB_URL` is UNSET** — proven by run `32829440334` | Gate + Environment binding |

**§12.4 ordering settles the risk:** step **11** VERIFY IDENTITY (main's tree == approved tree) precedes
step **12** MIGRATE. **The gate is installed before any production migration executes.**

## 1.4 Correct handling — DO NOT edit `main`

**Editing `main`'s workflow now is the wrong fix.** It breaks the freeze, changes the branch the RC is
measured against, and is unnecessary because promotion installs the gate. Additionally, all five
migrations are **already applied to production** (D-2), so §12.4 step 12 is expected to be a no-op, and
§12.4 step 4 already forbids *"execute a production migration merely because its file exists on main."*

### OA-1 — Confirm the interim control (2 minutes)

**Action:** verify no **repository-level** `SUPABASE_DB_URL` exists.
**Click-path:** GitHub → `altisinfonet/lens-lustre-learn-Claude` → **Settings** → **Secrets and variables**
→ **Actions** → **Repository secrets** tab.
**Environment:** repository scope (not the `production`/`staging` Environment tabs).
**Safety:** read-only. **Do not add one.** Do not delete Environment-scoped secrets.
**Expected success:** `SUPABASE_DB_URL` **does not appear** under *Repository secrets*.
**Expected failure:** it appears → **STOP.** That is a live production-exposure path; delete it before
any further work and record a Change Ledger entry.
**Evidence to return:** one line — *"Repository secrets checked <UTC timestamp>: SUPABASE_DB_URL absent
at repository scope"* — plus, if you wish, a screenshot with values masked.
**Status change:** records the interim control; **AF-15 becomes a documented, time-bounded deviation.**
**Parallel:** ✅ yes.

### OA-2 — Record AF-15 in the §10 RC record

**Action:** add to the RC's *Known deviations*: *"Until promotion, `main` carries a 6-step
apply-migration.yml with no lane gate. Mitigation: repository-level SUPABASE_DB_URL unset (OA-1).
Resolved by promotion, which installs T's 8-step gated version before §12.4 step 12."*
**Status change:** **§8.1 required state → satisfied at promotion, documented before it.**
**Parallel:** ✅ yes.

---

# 2 · B6 — §15.2 N1 AND N2

## 2.1 Exact requirement

**§15.2:** N1 — *"Apply a migration with a production database URL while the target input says staging.
Refused by the ref-assertion gate **before any SQL executes**."* N2 — the mirror, *"refused by the same
gate."*
**§15.1 row 4 instrument** also requires *"migration lane-gate refusal transcripts."*

## 2.2 Why the previously-issued designs were unsafe — and the safe design

The withdrawn design placed a **real production connection string** in the staging Environment. If the
gate failed, live production data was reachable.

**§8.1 states the gate refuses "WITHOUT CONNECTING."** Therefore **the connection string does not need to
be real.** Use the correct *project ref* with a **deliberately invalid password**. Two independent layers:

| Layer | Effect |
|---|---|
| 1 · Ref assertion | parses the ref, sees the mismatch, **refuses before connecting** — this is the evidence |
| 2 · If layer 1 failed | psql attempts connection, **authentication fails**, **no SQL executes** |

**No real credential is ever placed anywhere. No database is reachable in either outcome.**

### OA-3 — N1 (executable NOW, on `staging`)

**Branch:** `staging` (carries T's gated workflow) · **Target input:** `staging`
**Step 1 — set the decoy.** GitHub → Settings → Environments → **`staging`** → `SUPABASE_DB_URL` →
Update, to a string of this **exact shape**, using the **production** ref and a **fake** password:
`postgresql://postgres.jtdtehuqtinjxropkkcn:NOT_A_REAL_PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres`
**Step 2 — dispatch.** Actions → *Apply a database migration* → **Run workflow** → Branch **`staging`** →
`target = staging` → `migration` and `confirm` both =
`supabase/migrations/g10-n1-probe-nonexistent.sql`
**Step 3 — RESTORE the staging `SUPABASE_DB_URL` to its real value immediately.**

**Expected refusal (the evidence):**
`::error::secret points at 'jtdtehuqtinjxropkkcn', target is 'staging' — refusing`
**Expected step outcome:** failure at *"The credential must point at the target database"*; steps
*"Show the SQL that is about to run"*, *"Install psql"*, *"Run it"* **never execute**.
**Safety:** decoy password ⇒ unreachable database; non-existent file ⇒ path gate as a third net; restore
the secret in the same sitting.
**Evidence to return:** run ID · the verbatim `::error::` line · a statement that *"Run it"* did not
execute · confirmation the staging secret was restored.
**Parallel:** ⚠ not with OA-4 (both touch Environment secrets — do them sequentially).

### OA-4 — N2 (**after promotion only**)

**Why after:** N2 needs `target = production`, and the branch gate requires production to be dispatched
from `main`. `main` has no gate until promotion. **Running it before promotion tests nothing (§14 HS-11).**
**Branch:** `main` (post-promotion) · **Target input:** `production`
**Step 1:** Settings → Environments → **`production`** → set `SUPABASE_DB_URL` to
`postgresql://postgres.ztzutckwdhetphwghuzj:NOT_A_REAL_PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres`
**Step 2:** dispatch from `main`, `target = production`, both path fields =
`supabase/migrations/g10-n2-probe-nonexistent.sql`
**Step 3:** **restore/clear the production Environment secret immediately.**
**Expected refusal:** `::error::secret points at 'ztzutckwdhetphwghuzj', target is 'production' — refusing`
**Evidence:** run ID · verbatim line · *"Run it"* did not execute · secret restored.
**Status change after OA-3 + OA-4:** **§15 row 12 → complete; §15 row 4's instrument satisfied.**
**Parallel:** ❌ Phase 8.

> **§14 HS-6 applies throughout:** *"A migration lane gate refuses, and the response is to re-run it
> against the other lane."* If a gate refuses, that is the control working. **Fix the target, never the gate.**

---

# 3 · G8 / B5 — R2 WRITE ISOLATION

## 3.1 Exact requirement — §8.6 "Exit condition", all three parts

1. *"An upload performed on staging lands in `50mm-staging` and is readable at the staging CDN host."*
   → ✅ **EVIDENCED** — Flow 1, object served **240×140** from `cdn-staging`, with positive and negative controls.
2. *"**NEGATIVE TEST:** the staging credentials are used to attempt a write to the PRODUCTION bucket, and
   the attempt is **REFUSED**. This is the proof that the token is scoped."* → 🔴 **NOT EVIDENCED**
3. *"Production bucket object count is unchanged before and after the whole gate."* → 🔴 **NOT MEASURED**

**§8.6 also fixes the class:** *"Token scope is not readable after creation, so this is OWNER-ATTESTED by
construction. The compensating control is the negative test below, which is INDEPENDENTLY-VERIFIED."*

## 3.2 Exact instrument — Appendix A.5, verbatim

```
aws s3api put-object --endpoint-url https://<account>.r2.cloudflarestorage.com \
  --bucket 50mm --key isolation-probe/<timestamp>.txt --body /dev/null
```
> *"The expected result is an AccessDenied error and no object created. A listing that returns nothing is
> not evidence… Two controls accompany it, because AccessDenied on its own is indistinguishable from any
> other failure of the call: the same put-object against `50mm-staging`, which must SUCCEED and whose
> object is deleted afterwards (known-present), and the same put-object against a bucket name that does
> not exist, which must return `NoSuchBucket` rather than `AccessDenied` (known-absent)."*

## 3.3 Precise capability required — and why no session can do it

| Requirement | Available to this session? |
|---|---|
| Object-level R2 write (`put-object`) | ❌ Cloudflare MCP exposes only `r2_bucket_get/create/delete/list` |
| Network egress to `*.r2.cloudflarestorage.com` | ❌ container egress returns `CONNECT tunnel failed, response 403` |
| The **staging R2 secret access key** (stored in the staging DB media-settings row per §8.6) | ❌ **I will not read or handle a secret value** |

**§3 preamble names this explicitly:** *"…and **R2 token scope** have all returned HTTP 403 or have no API
available in the executing environment."*

### OA-5 — Safest owner-side method

**Where:** the owner's **own machine**, in a terminal. Not in any Claude session, not in CI, not in a
browser console.
**Credential handling:** read the staging access key id and secret from the staging database media
settings row, export them as environment variables in that shell only, and **close the shell afterwards**.
Never paste them into chat, a file, a screenshot, a commit, or this pack.

```bash
export AWS_ACCESS_KEY_ID=…        # staging R2 key id      — never share
export AWS_SECRET_ACCESS_KEY=…    # staging R2 secret      — never share
EP=https://a7810011a99de537a210130f86306785.r2.cloudflarestorage.com
TS=$(date -u +%Y%m%dT%H%M%SZ)

# 1 — KNOWN-PRESENT CONTROL (must SUCCEED)
aws s3api put-object --endpoint-url $EP --bucket 50mm-staging \
  --key isolation-probe/$TS.txt --body /dev/null
# 2 — THE TEST (must be REFUSED)
aws s3api put-object --endpoint-url $EP --bucket 50mm \
  --key isolation-probe/$TS.txt --body /dev/null
# 3 — KNOWN-ABSENT CONTROL (must be NoSuchBucket, NOT AccessDenied)
aws s3api put-object --endpoint-url $EP --bucket 50mm-does-not-exist-$TS \
  --key isolation-probe/$TS.txt --body /dev/null
# 4 — clean up control 1
aws s3api delete-object --endpoint-url $EP --bucket 50mm-staging --key isolation-probe/$TS.txt
```

**Also required (part 3 of the exit condition):** production bucket object count **before and after**.
Cloudflare dashboard → **R2** → **`50mm`** → *Metrics/Objects*, or
`aws s3api list-objects-v2 --endpoint-url $EP --bucket 50mm --query 'KeyCount'` **using an account-scoped
read credential, never the staging one**.

**Expected outputs**
| # | Expected |
|---|---|
| 1 | JSON with `ETag` — success |
| 2 | `An error occurred (AccessDenied) when calling the PutObject operation` **and no object created** |
| 3 | `An error occurred (NoSuchBucket) when calling the PutObject operation` |
| 4 | success (control object removed) |

**If step 2 returns success → STOP. §14 HS-1 and HS-9 territory: the staging token is not scoped.**

**Evidence to return:** the four command outputs with **credentials redacted**, the two production object
counts, and the UTC timestamps.
**Status change:** **G8 exit condition parts 2 and 3 satisfied → G8 GREEN** (token scope remains
OWNER-ATTESTED per §8.6; the negative test is the INDEPENDENTLY-VERIFIED compensating control).
**Parallel:** ✅ yes.

---

# 4 · G5b — PAGES FUNCTIONS DEFAULTS

**§19 row:** *"Add SUPABASE_PROJECT_REF and SUPABASE_ANON_KEY to the production Pages environment — Pages
environment variables are owner-only — G5b — the production defaults in `functions/_seo.ts` cannot be
removed until these exist — **OPEN**."*
**§20 G5b:** *"…The guard also still scans `dist` only; **extending it to `functions/` belongs to this gate**."*

### OA-6 — Add the two Pages variables

**Click-path:** Cloudflare dashboard → **Workers & Pages** → **`lens-lustre-learn`** → **Settings** →
**Variables and Secrets** (Environment variables) → **Production** → *Add variable* ×2:
`SUPABASE_PROJECT_REF = jtdtehuqtinjxropkkcn` · `SUPABASE_ANON_KEY = <production anon key>`
**Safety:** §16 classifies *"Cloudflare Pages build config and variables"* as **HIGH blast radius, Owner
only**. This is a **production configuration change** and **requires its own Change Ledger entry**. The
anon key is a public value that ships in every bundle — it is not a secret, but do not paste it here.
**Expected:** both variables listed under Production. **Redeploy is required for Pages Functions to see them.**
**Evidence:** confirmation both exist + the Change Ledger entry ID.
**Parallel:** ✅ yes.

> ## ⚠ G5b CANNOT REACH GREEN WITHOUT A NEW CANDIDATE
> The second half — *removing the production defaults from `functions/_seo.ts`* and *extending the guard
> to scan `functions/`* — are **code changes**.
> **CURRENT TREE `e2e05fbb…` → ACTION: edit `functions/_seo.ts` + guard → RESULTING TREE: NEW →
> INVALIDATES: 21/21 mutants, CI `32976271438`, schema guard 122/122, tree-equality proof, all §15
> evidence → NEW QA RUN: REQUIRED.**
> **Recommendation: complete OA-6 now, and carry the code half to G11.** G5b then closes as
> **CLOSED WITH DOCUMENTED DEVIATION**, not GREEN. Forcing GREEN here costs the entire candidate.

---

# 5 · B7 — §5.3 SECRET ISOLATION

**§19 row:** *"Push the §5.3 secret-isolation probe branch and its throwaway workflow — and delete that
branch afterwards — or authorize a session that can do both — This session can neither push nor delete a
branch — **G3 exit condition, and G10 step 7, where it must be re-taken rather than inherited** — OPEN."*

**Observed:** workflows *"G10 secret isolation probe"* and *"Secret isolation probe"* exist in the
repository. The G10 one has **zero runs**. A workflow existing is not evidence.

### OA-7 — Execute at Phase 8, immediately before promotion

**Timing:** §5.3.6 requires it **immediately before promotion**. Running it now goes stale and must be
repeated — do not run it early to improve a count.
**Branch:** `scratch/g10-53-secret-isolation-20260826` (exists at `9478cf7`)
**Safety:** the workflow must echo **only empty / non-empty** — never the value, never a masked value.
§5.3 states masking is not proof of absence.
**Expected:** the run's log contains a literal line showing the production database reference resolving
**EMPTY** outside its lane.
**Evidence:** run ID · the verbatim log line · confirmation the branch was deleted afterwards.
**Status change:** **G3 exit condition satisfied** (subject to §1's AF-15 and the OWNER-ATTESTED items).
**Parallel:** ❌ Phase 8 only.

---

# 6 · HS-12 — BRANCH PROTECTION

**§14 HS-12:** *"Branch protection on `main` is absent at the moment promotion is attempted… STOP. This is
an owner action and gates G10 (§19)."*
**§17-7:** *"Re-attested by the owner at this moment. It is OWNER-ATTESTED under §3.1 and cannot be read by
any session, so it is never recorded as independently verified."*
**§19 row status:** *"OPEN — never configured."*

### OA-8 — Enable, then re-attest on promotion day

**Click-path:** GitHub → repo → **Settings** → **Rules** → **Rulesets** → *New ruleset* → target `main` →
enable *Require a pull request before merging* and *Block force pushes*.
**Evidence:** owner statement + timestamp. **This can never be more than OWNER-ATTESTED (§3.1).**
**Status change:** **HS-12 cleared → G10 unblocked.**
**Parallel:** ✅ yes — **do this early; it gates all of G10.**

---

# 7 · SIGNATURES — B8, B10, B11, B12, B13, B14

All five are **drafted in full** in `claude/G10_PHASE7_READINESS_CHECKLIST_2026-08-27.md` and
`claude/G10_OWNER_BLOCKER_PREPARATION_LEDGER_2026-08-27.md`. **Drafted ≠ complete.** Each needs a name and
a date.

| ID | Requirement | Action | Evidence to return | Status change |
|---|---|---|---|---|
| **OA-9 · B8** | §11 *Deviations accepted* | Sign acceptance naming **all 9 files** (4 migrations + 4 rollbacks + 1 orphan `classF_repoint_originals`) | Signed text + date | D-2 closed for this RC; rename → G11 |
| **OA-10 · B13** | §17-3 no §14 hard stop live | Countersign G9 EXCLUDED with its **four** residual risks | Signature + date | §17-3 satisfied |
| **OA-11 · B11** | §10 *Rollback target* — *"plus the database rollback or compensating-migration plan"* | Sign the five-file binding, reverse order 5→1, orphan excluded | Signature + date | §10 field complete |
| **OA-12 · D-3** | §10 — *"a field that genuinely does not apply is recorded as NOT APPLICABLE **with the reason**"* | Rule N/A: *"Preview branch = None, therefore no staging Pages deployment exists for T"* | One signed line | §10 field complete |
| **OA-13 · CHG-005** | §17-2 *"no entry is UNINTENDED"* vs §9.4 *"any difference **between main and the RC**"* | Rule: **reclassify TEST/HARNESS** (recommended — it is not a main↔RC difference), **or** purge, **or** waive | Signed ruling | Unblocks ledger closure |
| **OA-14 · B12** | §6 RC gate — *"Change Ledger closed"* | Close, with CHG-003 = **PREPARED — PENDING PROMOTION** (your Option B ruling) | Signature + date | **RC gate condition 2 met** |
| **OA-15 · B14** | §11 *Deviations accepted* | Enumerate **D-5 / AF-03 Option D** into the approval | Signed text | AF-03 formally accepted |
| **OA-16 · B10** | §10 Android field | Rule **N/A — web-only RC, no Android artifact produced**; log **AF-13** (four contradictory version records) for G11 | One signed line | §10 field complete |

**All parallel: ✅ yes.**

---

# 8 · §15 — REMAINING DISPOSITIONS, SEPARATED BY TYPE

**§15 preamble:** *"A row is complete only when **both** its positive and its negative column carry
recorded evidence."* **§17-1** passes when *"no row is blank and no row is marked 'expected'."*
Both conditions are live; they are not the same test.

## 8.1 FIX REQUIRED — cannot be ruled away

| Row | Gap | Resolved by |
|---|---|---|
| **5 Storage** | negative half — production write refusal + object counts | **OA-5** |
| **12 Cross-lane** | N1, N2 | **OA-3, OA-4** |
| **4 Database** | instrument requires *"migration lane-gate refusal transcripts"* | **OA-3, OA-4** |

## 8.2 OWNER ATTESTATION / RULING REQUIRED

| Row | Status | Exact ruling needed |
|---|---|---|
| **1 UI** | 🔴 **FAILING** | Accept **as a known-failing row** under **D-5**. Do not relabel. Also rule on the instrument gap: §15 requires *"Record the deployment ID actually loaded"* — **none exists** (D-3) |
| **8 SEO** | 🔴 **FAILING** | Accept under **D-5** (`og:image` + `json_ld` point at production). Also: instrument requires *"both hosts probed in the same minute, with a known-present and a known-absent path"* — **not performed in that form** |
| **2 Flows** | 🟡 PARTIAL | 7/10 verified. Rule on the missing instrument half: *"production row counts unchanged over the same window"* — **not captured** |
| **6 Edge Fns** | 🟡 PARTIAL | 5/74 invoked. Rule the scope. **The 5 financial functions must be recorded NOT TESTABLE — POLICY EXCLUSION, visibly, not hidden inside a coverage number** |

## 8.3 N/A WITH REASON

| Row | Reason |
|---|---|
| **3 Auth** (partial) | password reset — **no staging mail path exists** (§8.8 Option 1). `/login`+`/signup` need an anonymous context → **OA-17/OA-18** |
| **10 Responsive** | breakpoints — **no functioning viewport instrument**; `resize_window` reported success 3× across 2 rounds while `innerWidth` stayed 1536 → **OA-18** |

## 8.4 DEFERRED / POST-PROMOTION

| Row | Basis |
|---|---|
| **11 Regression** | §15 instrument is *"the §18 checks executed against production **before and after**"* — **structurally post-promotion**. §17-12. |

## 8.5 Already complete

Rows **7** (guard + 21/21 mutants) and **9** (email, vacuous, §8.8 policy recorded).

### OA-17 — Sign out of production in the QA browser profile (B20)
Verified still active 2026-08-27: production origin returned `role: "authenticated"`.
**Unblocks:** §15 row 2 remaining flows (delete **from Feed/WallPosts**, never PostDetail — AF-10),
profile edit. **Parallel:** ✅

### OA-18 — Provide a real breakpoint instrument + an anonymous profile (B17)
Un-maximise Chrome, or supply device emulation; and a **third** browser profile gives an anonymous
context, closing `/login`+`/signup`. **Parallel:** ✅

---

# 9 · G10 — CANDIDATE READY ≠ PROMOTED

**These are different states and must not be conflated.**

| State | Meaning | Requires |
|---|---|---|
| **RC ready for approval** | §6 RC gate: *"§10 record complete; Change Ledger closed; owner approval recorded"* | OA-1 … OA-16 |
| **§11 approval signed** | *"Approval is a separate, explicit act. Reviewing evidence is not approval; a green pipeline is not approval."* | OA-19 |
| **G10 GREEN** | §6: *"Branch protection active on main; main tree equals the approved RC tree; production verified post-deploy"* | the **merge** + §17-11 + §18 |

**G10 cannot be GREEN before promotion occurs. Any earlier GREEN would be false.**

### OA-19 — §11 Release Approval Record

All eight fields, per §11:
Approves RC ID **RC-20260826-01** · Approved staging commit `b8535fe7c9f2c7f604347ba849ac579bf4946d23`
/ **tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`** (both restated) · Statement: *"I approve promotion
of the tree named above to main and its deployment to production."* · **Deviations accepted** (D-1 G9 ·
D-2 migration naming · D-5 AF-03 · AF-15 · §15 rows 1 & 8 accepted while FAILING) · **Attested controls
accepted** · **Residual risks accepted** (unverifiable-by-design list) · Approver · Timestamp UTC ·
Validity: *"This approval covers exactly the named tree. Any further commit to staging voids it and
requires a new RC."*
**Parallel:** ❌ last, after everything.

### OA-20 — Promotion, §12.4 in order
Tag before merge → merge → **step 11 VERIFY IDENTITY: `main` tree must equal `e2e05fbb…`** → step 12
MIGRATE (from the approved manifest only; expected **no-op**, all five already applied) → step 13 DEPLOY,
guard must print its PASS line → step 14 capture deployment ID.
**Conflicts pre-agreed:** `src/lib/generateCertificatePdf.ts` and (once #103 merges)
`.github/workflows/web-build.yml` — **both resolve by taking the candidate's version**, verified to
produce a tree exactly equal to T. **Assert tree equality before committing the merge.**

---

# A · PARALLEL ACTION CHECKLIST — start all of these today

☐ **OA-1** repository secret check · ☐ **OA-5** R2 write-isolation test (**longest pole**) ·
☐ **OA-6** Pages variables · ☐ **OA-8** branch protection (**gates all of G10 — do first**) ·
☐ **OA-9** B8 signature · ☐ **OA-10** B13 · ☐ **OA-11** B11 · ☐ **OA-12** D-3 ·
☐ **OA-13** CHG-005 ruling · ☐ **OA-15** B14 · ☐ **OA-16** B10 · ☐ **OA-17** B20 · ☐ **OA-18** B17 ·
☐ §15 rulings 8.2

# B · DEPENDENCY ORDER

1. **OA-8** (HS-12) · **OA-1** · **OA-5** — independent, longest lead
2. **OA-3** (N1) — after OA-1; sequential with OA-4
3. **OA-17 / OA-18** → then the remaining §15 row 2/3/10 evidence
4. **OA-13** → **OA-14** (ledger closure depends on the CHG-005 ruling)
5. §15 dispositions (8.2) → feed §11 *Deviations accepted*
6. **OA-9…OA-12, OA-15, OA-16** — any time before 7
7. **OA-19** §11 approval — **only after 1–6**
8. **OA-20** promotion → **OA-4** (N2) · **OA-7** (§5.3) · §18 checks

# C · EVIDENCE RETURN CHECKLIST

☐ OA-1 statement + timestamp ☐ OA-3 run ID + verbatim `::error::` + "Run it did not execute" + secret
restored ☐ OA-4 same (Phase 8) ☐ OA-5 four command outputs **redacted** + production object counts
before/after ☐ OA-6 confirmation + Change Ledger ID ☐ OA-7 run ID + literal EMPTY line + branch deleted
☐ OA-8 attestation + timestamp ☐ OA-9…OA-16 signed text + dates ☐ OA-17/OA-18 "done" ☐ §15 rulings
☐ OA-19 all eight §11 fields ☐ OA-20 tag, merge SHA, **tree equality assertion**, deployment ID

# D · FINAL G1–G10 CLOSURE CHECKLIST — evidence required for legitimate GREEN

| Gate | Evidence required for GREEN | Now |
|---|---|---|
| **G1** | §8.10 production baseline captured | ✅ **CLOSED** |
| **G2** | staging project + synthetic accounts | ✅ **CLOSED** |
| **G3** | §8.1 four clauses (**via promotion**, OA-2) + **OA-7** §5.3 EMPTY line + Environments/secret-deletion OWNER-ATTESTED | 🔴 **OPEN** → GREEN after OA-7 + promotion |
| **G4** | lane-aware config; production `_headers` byte-identical | ✅ **CLOSED** |
| **G5a** | guard host rules; 21/21 mutants on this tree | ✅ **CLOSED** |
| **G5b** | **OA-6** + removal of production defaults from `functions/_seo.ts` + guard extended to `functions/` | 🔴 **OPEN** → **code half = G11**; realistic best = CLOSED WITH DEVIATION |
| **G6** | staging direction evidenced; production direction lands with **CHG-003 at promotion** | 🟡 → GREEN at promotion |
| **G7** | staging Pages + DNS; previews disabled | ✅ **CLOSED** |
| **G8** | upload lands ✅ + **OA-5 AccessDenied with both controls** + production object count unchanged | 🔴 **BLOCKED** → GREEN on OA-5 alone |
| **G9** | staging functions + synthetic data; **OA-10** countersignature | 🟡 → CLOSED WITH DEVIATION on OA-10 |
| **QA §15** | §15.1 rows complete; §15.2 N1–N8; rulings in 8.2 | 🔴 → after OA-3/4/5/17/18 + rulings |
| **RC** | §10 complete · ledger closed (**OA-14**) · **OA-19** approval | 🔴 **OPEN** |
| **G10** | HS-12 (**OA-8**) + **OA-20** merge + §17-11 tree equality + §18 post-deploy | ⏸ **DEFERRED — cannot be GREEN before promotion** |

---

**Honest ceiling:** even with every action above executed perfectly, **G3 and G5b cannot reach unqualified
GREEN** — G3 because Environment creation and repository-secret deletion are **OWNER-ATTESTED by
construction** (§3.1: *"May NOT be described as verified"*), and G5b because its code half requires a new
candidate. Their best legitimate state is **CLOSED WITH DOCUMENTED DEVIATION**, which §3.2 expressly
permits in a Release Candidate.

*T unchanged · `main` unchanged · nothing dispatched, signed or modified to produce this pack.*
