# G10 PHASE 5 / PHASE 6 PACKAGE — §15 MATRIX · CHANGE LEDGER · §10 RC RECORD

**Assembled 2026-08-27 04:22 UTC. Candidate tree T = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`.**
`main` unchanged. T unchanged. PR #103 open, unmerged. **RC is NOT approved.**

> **Headline:** Phase 5 **cannot be completed by this session**. The plan itself assigns the §15
> matrix to **CLAUDE + OWNER** (§4 role table). Seven of twelve rows require interactive QA on
> `staging.50mmretina.com` with test accounts and write operations. Those rows are recorded **OPEN**,
> not estimated, not inferred.

---

# A. THE §15 TWELVE-ROW MATRIX

Rows are the plan's §15.1 verbatim. Status vocabulary: **VERIFIED / OWNER-ATTESTED / OPEN /
NOT APPLICABLE**. Nothing is promoted to VERIFIED without the evidence the criterion names.

| # | Area | Positive criterion | Negative criterion | Status |
|---|---|---|---|---|
| 1 | **UI** | Every route renders on staging without console errors; assets load from cdn-staging | No asset resolves to cdn.50mmretina.com or www.50mmretina.com | 🔴 **OPEN** |
| 2 | **Functional flows** | Upload, edit, delete, comment, like, follow, notification, search, profile edit, article path each complete end to end | No flow writes to a production table or bucket during the run | 🔴 **OPEN** |
| 3 | **Authentication** | Sign-up, sign-in, reset, refresh, sign-out succeed against staging ref | Production JWT rejected by staging **and the reverse** | 🟡 **PARTIAL** — negative **VERIFIED (N7)**, positive OPEN |
| 4 | **Database** | Reads/writes land in staging; RLS behaves as production does | No connection string, migration or query resolves to the production ref | 🟡 **PARTIAL** — see below |
| 5 | **Storage / R2** | Uploads land in staging bucket, served from cdn-staging | Staging object not reachable on cdn.50mmretina.com; **production bucket gains no objects** | 🟡 **PARTIAL** — negative half **VERIFIED (N8)** |
| 6 | **Edge Functions** | Every function the staging lane invokes responds correctly with staging config | No function call reaches the production project's function endpoint | 🔴 **OPEN** |
| 7 | **Security / isolation** | Guard passes on the staging build with host rules active | Each of R1–R10 demonstrated to fail on a deliberately broken fixture | ✅ **VERIFIED** |
| 8 | **SEO / headers** | robots, sitemap, canonical, security headers generated from staging values | Staging not indexable; no canonical or sitemap entry points at production | 🟡 **PARTIAL** |
| 9 | **Email behaviour** | Any email staging sends carries staging links and a staging-identifiable sender | No staging email carries a production link or reaches a production recipient | ✅ **VERIFIED** (vacuous — no send path) |
| 10 | **Responsive / mobile** | Layouts hold at supported breakpoints; Capacitor Android build loads bundled assets | Android build contains no staging value; no `server.url` override | 🔴 **OPEN** |
| 11 | **Regression** | Pre-change production baseline unchanged | No production surface changed during staging work | 🟡 **PARTIAL** |
| 12 | **Cross-lane negative** | — | Every deliberate cross-lane attempt refused, both directions, refusal text recorded | 🟡 **PARTIAL** — N7, N8 **VERIFIED**; N1–N6 below |

**Tally: 2 VERIFIED · 6 PARTIAL · 4 OPEN · 0 NOT APPLICABLE.**

## Row-by-row evidence

**Row 7 — Security / isolation · VERIFIED (both halves)**
Positive: staging-lane build with host rules armed — CI run **`32976271438`**, `Staging lane build`,
54s, Success, on tree T. Negative: **21/21 mutants held**, read from CI run **`32982588154`** — the
harness proves the guard fails on deliberately broken fixtures (R1–R10 plus W1–W21).

**Row 9 — Email behaviour · VERIFIED, recorded as vacuous**
Both credential sources measured empty: staging `site_settings` has **0** `smtp_settings` rows;
`BREVO_API_KEY` **absent** from staging's four custom secrets (`SITE_ORIGIN`, `CDN_HOST`,
`CRON_SECRET`, `SCHEDULED_POSTS_CRON_SECRET`). Three of four email functions have no send path under
any credential state. §15 names *sent-message inspection* as the instrument; it is **vacuous — there
is no send path to inspect** — and is recorded as vacuous rather than as a pass.

**Row 3 — Authentication · PARTIAL**
Negative **VERIFIED**: N7, both directions, with positive controls (below). Positive **OPEN**: sign-up,
sign-in, password reset, session refresh and sign-out have not been executed — they need a staging
test account and interactive session.

**Row 4 — Database · PARTIAL**
Negative largely **VERIFIED**: the isolation guard's `ISOLATION_FORBIDDEN_REFS` proves no production
ref appears in the staging bundle, and the schema-dependency guard confirmed every RPC resolves.
Positive **OPEN**: "RLS behaves as production does" has **not** been tested behaviourally. The ACL
remediation aligned *function privileges*; **RLS policies are a different mechanism and were not
exercised.** Policy *definitions* match (fingerprint `51e29bf1…` identical both lanes) — that is
structural equality, not behavioural proof.

**Row 5 — Storage / R2 · PARTIAL**
Negative first half **VERIFIED** (N8, both directions, with controls). Negative second half —
*"the production bucket gains no objects"* — **OPEN**: this requires monitoring production object
count across the QA window, which has not been done. Positive **OPEN**: no upload was performed.

**Row 8 — SEO / headers · PARTIAL**
Negative **VERIFIED**: staging `robots.txt` read live — `User-agent: * / Disallow: /`, header
`# NON-PRODUCTION LANE — NOT FOR INDEXING`, lane origin `https://staging.50mmretina.com`. Positive
**OPEN**: staging's sitemap, canonical tags and security headers have not been read.

**Row 11 — Regression · PARTIAL**
"No production surface changed" is **supported** — Phase 0 baselines exist for all ten surfaces and
`main` is byte-unchanged at `b671e1f`. But the full re-comparison is **§18 work performed after
promotion**, so it cannot be closed at Phase 5.

**Row 12 — Cross-lane negative · PARTIAL (N-by-N below)**

| # | Attempt | Required result | Status |
|---|---|---|---|
| N1 | Migration with production URL while target says staging | Refused by ref-assertion gate before any SQL | 🟡 **OWNER-ATTESTED** — G3 record; **not re-run for this RC** |
| N2 | Migration with staging URL while target says production | Refused by the same gate | 🟡 **OWNER-ATTESTED** — same |
| N3 | Staging build with forbidden-ref list blanked | R6 fails the build | ✅ **VERIFIED** — mutation harness, run `32982588154` |
| N4 | Staging build with production CDN host in an asset | R8 fails the build | ✅ **VERIFIED** — same |
| N5 | Lane whose expected host never appears in its bundle | R7 fails the build | ✅ **VERIFIED** — same |
| N6 | Lane's own apex in its forbidden host list | R9 refuses configuration, no false leak | ✅ **VERIFIED** — same (MUT W12) |
| N7 | Production token to staging endpoint, and reverse | Both rejected, both recorded | ✅ **VERIFIED** |
| N8 | Staging object from production CDN host | Not served | ✅ **VERIFIED** |

**N7 transcript** — 401 both directions, with 200 positive controls on each lane's own `/rest/v1/posts`:
```
{"message":"Invalid API key","hint":"Double check your Supabase `anon` or `service_role` API key."}
```
⚠ **The `/rest/v1/` root returns 401 for every cell including both controls** (it requires
`service_role`). A status-only assertion there passes vacuously. **N7 must assert on the response
body.** Recorded as a runbook amendment.

**N8 transcript** — 404 both directions, with 200 positive controls:
```
Error 404 | Object not found | This object does not exist or is not publicly accessible at this URL.
```

**N1/N2 are the weak link in row 12.** §17's preamble — *"a line that was true last week is not
checked"* — means inherited G3 evidence does not satisfy this RC. They must be re-run.

---

# B. CHANGE LEDGER — RC-20260826-01

Every change made during G10, classified against the §16 Environment Impact Matrix. **None UNINTENDED.**

| Change ID | What | §16 Surface | Blast radius (§16 verbatim) | Reversible | Status |
|---|---|---|---|---|---|
| **CHG-G10-001** | PR #102 merged into `staging` — 9 files: 3 guard files, 1 migration, 4 rollback SQL, 1 edge-function source | **Branch staging and below** | *"None while Pages preview builds are disabled for it"* | **Yes** — branch is disposable | ✅ **APPLIED & VERIFIED** |
| **CHG-G10-002** | ACL remediation on staging — 252 statements over 76 function signatures | **Staging Supabase** | *"None if isolation holds; that is what the guard proves"* | **Yes** — staging is rebuildable | ✅ **APPLIED & VERIFIED** |
| **CHG-G10-003** | PR #103 — arm production-lane isolation host rules, 3 files | **GitHub Actions workflow files** | *"Indirect — changes how production is built"* | **Yes, by revert** | 🟡 **PREPARED, NOT MERGED** |

## The precondition on CHG-001 was verified, not assumed

§16 classifies the staging branch as zero blast radius **conditional on** *"Pages preview builds are
disabled for it"*. That precondition was **measured**: the production Pages project's Preview
environment shows **Branch control → Preview branch: `None`**. Previews are disabled; no staging-lane
code is built or served by the production project. **The classification's condition holds.**

## CHG-002 verification detail

Before → after → target: `anon` deny **6 → 82 → 82** · `authenticated` deny **3 → 55 → 55**.
Post-remediation effective-access fingerprint over the 363 production-explicit functions:
**`ab26c06a391b446cf8307ccac6d14e70` — identical on both lanes.** `service_role` 387 and `postgres` 387
unchanged; function count 387 unchanged; 0 errors.

## Ledger closure

**The ledger CANNOT be closed (§17-2) while CHG-003 is unapplied.** Step 5.5 assigns closure to the
**OWNER**. No entry is UNINTENDED.

---

# C. EVIDENCE → ACCEPTANCE-CRITERION MAPPING

| Claim | Criterion it must satisfy | Evidence | Sufficient? |
|---|---|---|---|
| Candidate tree identity | §10 promotion identity | `e2e05fbb…` re-measured 04:22 UTC | ✅ |
| Guard harness on T | 4.2 | 41/41, 0 failed | ✅ |
| Mutants held on T | §17-5 — *from a run on THIS tree* | **`Mutations detected/held: 21/21`** from CI run `32982588154` | ✅ |
| Schema deps vs production | 4.1 | PASS, exit 0, authoritative; **122/122 argument-level, 0 name-only** | ✅ substance; ⚠ CI-form artefact pending |
| Staging-lane CI armed on T | §17-4 first half | Run `32976271438` | ✅ |
| Production-lane CI armed on T | §17-4 second half | — | 🔴 **Phase 8 (AF-02)** |
| Cross-lane key refusal | N7 | 401 ×2 + 200 ×2 controls | ✅ |
| Cross-lane object refusal | N8 | 404 ×2 + 200 ×2 controls | ✅ |
| Staging non-indexable | Row 8 negative | robots.txt read live | ✅ |
| Staging cannot send email | Row 9 | both credential sources empty | ✅ (vacuous, so recorded) |
| Staging ACLs match production | 4.6 | fingerprint identical, 363 fns | ✅ |
| Migration ledger parity | §10 migration manifest | all 5 applied both lanes | ⚠ **see deviation D-2** |
| R2 bidirectional **write** refusal | 4.7b / row 5 | — | 🔴 **capability blocker** |
| §15 rows 1, 2, 6, 10 | §17-1 | — | 🔴 **OPEN — needs QA** |

---

# D. §10 RELEASE CANDIDATE RECORD — RC-20260826-01

*Incomplete fields are not permitted at approval. Fields without evidence are marked **OPEN**, never guessed.*

| Field | Content |
|---|---|
| **RC ID / name** | **RC-20260826-01** — "Certificates, admin pagination, schema-dependency guard" |
| **Staging commit SHA** | `b8535fe7c9f2c7f604347ba849ac579bf4946d23` |
| **Staging TREE SHA** | **`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`** ← the promotion identity |
| **main pre-promotion commit** | `b671e1fb0c5bcf145d442076c229eca888afd674` |
| **main pre-promotion TREE** | `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` |
| **Merge base** | `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` |
| **Complete Change Ledger** | CHG-G10-001 ✅, -002 ✅, -003 pending. None UNINTENDED. **Not closed** |
| **Changed-file manifest** | **123 files** merge-base → T |
| **Database migration manifest** | 5 migrations / 5 rollbacks (1:1 per §13.1). **All 5 applied to BOTH lanes.** Server versions differ by lane — see D-2 |
| **CI evidence** | Web build **`32976271438`** (T, staging lane 54s Success; **production lane SKIPPED — recorded as skipped, with why: gated on `base_ref=='main'`**); Security #683; Typecheck #1195; UI gate #115. PR #103: Web build **`32982588154`** Success 43s + 4 more green |
| **Staging URL / deployment ID** | 🔴 **OPEN** — previews disabled (`Preview branch: None`), so **no staging Pages deployment ID exists for T**. See D-3 |
| **Staging Supabase fingerprint** | `ztzutckwdhetphwghuzj`; 11 digests captured; 10 of 11 identical to production; ACL now converged |
| **Staging R2 fingerprint** | `50mm-staging`, host `cdn-staging.50mmretina.com`, CORS = staging origin only, public dev URL **disabled**. **Scoped-token negative test: 🔴 OPEN (4.7b)** |
| **Production pre-release fingerprints** | Full §8.10 set captured 2026-08-26; ACL counters re-verified |
| **Secret-isolation re-test (§5.3)** | 🟡 branch `scratch/g10-53-secret-isolation-20260826` exists at `9478cf7`. **Run ID and literal log line NOT captured** → OPEN |
| **Test results (§15)** | 2 VERIFIED · 6 PARTIAL · 4 OPEN — section A |
| **Android** | **NOT APPLICABLE — WEB-ONLY RELEASE.** ⚠ current production `versionCode` **not recorded** → OPEN |
| **Independently verified controls** | Guard harness 41/41; mutants 21/21; schema-deps PASS; N3–N8; ACL convergence; staging non-indexable; tree identity; PR #103 tree-identical to independent build |
| **Owner-attested controls** | §17-7 branch protection; HS-10 rotation (`owner-cli-2026-08`); N1, N2; Brevo ACCEPTED ruling; G9 EXCLUDED §14 ruling |
| **Unverifiable-by-design residuals** | 24 `plpgsql_*` extension functions (NULL vs explicit ACL); apex/www dual origin with ACAO naming apex only; production R2 public dev URL enabled; TLS 1.0 minimum on both CDN domains; DMARC `p=none` |
| **Known deviations** | **D-1 … D-4 below** |
| **Rollback target** | Tree `a0c3f34d724867f0a10fc768f6987e21fd4ddbfa`, commit `32930e75…`, deployment `9c0c1201-41b4-4abf-9b5f-18598b5189d7`. ⚠ **Database rollback component: OPEN** |
| **Evidence index** | 15 project documents, linked per claim |
| **Approval** | 🔴 **NOT APPROVED — Phase 7 not started** |

## Known deviations

**D-1 · G9 EXCLUDED.** All 71 production edge functions run pre-G9 CORS; `submit-judge-decision`
serves `Access-Control-Allow-Origin: *`; ten functions sign S3/R2 deletes with no storage-lane guard.
Owner-directed, §14 ruling recorded, awaiting countersignature.

**D-2 · 🔴 FOUR MIGRATIONS ARE MISNAMED `UNAPPLIED_` BUT ARE APPLIED TO PRODUCTION.**
Measured today — production `schema_migrations` holds all five:

| Repository filename | Production version | Staging version |
|---|---|---|
| `20260824145345_admin_user_lookup_by_email.sql` | `20260824145345` | `20260824144927` |
| `UNAPPLIED_20260824000000_admin_user_list_pagination.sql` | **`20260825092152`** | `20260824120321` |
| `UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql` | **`20260825115030`** | `20260825054031` |
| `UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql` | **`20260825115116`** | `20260825070751` |
| `UNAPPLIED_20260825170000_certificate_custom_heading.sql` | **`20260825115208`** | `20260825101651` |

**The promotion will carry four files whose names assert they are unapplied, into a lane where they
are applied.** Not a functional risk — schema fingerprints match and the schema-dependency guard
passes — but it is a **documentary falsehood shipping in the release**, and it is the precise defect
class the runbook cites for stopping G10 run 1: *"the migration travelled in the same tree named
`UNAPPLIED_…` — a filename, not a control."* **Needs an owner decision: rename before promotion, or
record as accepted.**

**D-3 · No staging Pages deployment exists for T.** §10 mandates "the Cloudflare deployment actually
tested". Because `Preview branch: None`, pushing T produced **no** staging deployment. The staging
*site* runs from the separate `lens-lustre-learn-claude-staging` project, whose deployment was not
identified for T. Either capture it or record NOT APPLICABLE with reasoning.

**D-4 · §5.3 secret-isolation re-test not evidenced for this RC.** The branch exists; the run ID and
literal log line were never captured. §5.3 forbids inheriting G3's evidence.

---

# E. BLOCKERS — WITH THE EXACT PERSON AND ACTION

| # | Blocker | Resolver | Exact action |
|---|---|---|---|
| **B1** | §15 rows 1, 2, 6, 10 unexecuted | **OWNER + session** | Interactive QA on `staging.50mmretina.com` with a test account: every route, the ten functional flows, edge-function responses, breakpoints + Android bundle |
| **B2** | Row 3 positive — auth flows | **OWNER + session** | Sign-up, sign-in, reset, refresh, sign-out against staging |
| **B3** | Row 4 positive — RLS behaviour | **session**, needs a staging test identity | Exercise RLS as anon/member/admin. Policy *definitions* match; behaviour untested |
| **B4** | Row 5 — uploads land in staging; production bucket gains no objects | **OWNER + session** | Perform an upload; count production objects before/after |
| **B5** | **4.7b** R2 bidirectional write refusal | **OWNER** | No object-level R2 tooling here, and it needs two R2 tokens. **Not a Phase 8 dependency — will not self-resolve** |
| **B6** | **N1/N2** migration ref-assertion refusals | **OWNER** (dispatch) | Re-run `apply-migration.yml` with mismatched target; capture run IDs + refusal text. G3 evidence is stale under §17's preamble |
| **B7** | **D-4** §5.3 re-test | **OWNER** (push rights) | Push the scratch branch, capture run ID + literal EMPTY line, delete branch |
| **B8** | **D-2** misnamed migrations | **OWNER** decision | Rename the four `UNAPPLIED_` files, or accept in writing |
| **B9** | **D-3** staging deployment ID | **session or OWNER** | Identify the staging project's deployment for T, or rule NOT APPLICABLE |
| **B10** | Android `versionCode` | **OWNER** | Read current production versionCode (§8.9) |
| **B11** | Database rollback component | **OWNER + session** | Name the DB rollback for the 5 migrations — the 5 rollback SQL files exist but are not bound to the RC as *the* rollback |
| **B12** | Change Ledger closure (§17-2) | **OWNER** | Close after CHG-003 lands |
| **B13** | §14 G9 ruling countersignature | **OWNER** | Countersign the recorded EXCLUDED ruling |

---

# F. PHASE 7 (APPROVAL) PREREQUISITES

§11 approval requires **all** of:

1. §15 matrix complete — **no row blank, no row marked "expected"** → **B1–B4 block this**
2. Change Ledger closed, none UNINTENDED → **B12**
3. No §14 hard stop live → HS-10 ✅ closed; **G9 §14 ruling needs countersignature (B13)**
4. §10 RC record complete — every field, or NOT APPLICABLE with reason → **B5–B11**
5. The approval must **name the tree** `e2e05fbb…`, not a branch
6. Signed and dated **before** any merge

**Phase 7 cannot open. Four of six prerequisites are unmet.**

---

# G. PHASE 8 (PROMOTION) PREREQUISITES

1. Approved tag `approved/<date>-<n>` created **before** the merge — none exists (repo has **0 tags**)
2. §17 twelve-line checklist re-run **on the day**
3. **§17-4 production-lane run on T** — obtained from the promotion PR **before** pressing merge (AF-02)
4. **Conflict resolution pre-agreed:** two conflicts —`src/lib/generateCertificatePdf.ts` and (once
   #103 merges) `.github/workflows/web-build.yml`. **Both resolve by taking the candidate's version**,
   verified to yield a tree **exactly equal to T**
5. C2 six-link chain asserted at 8.7
6. Rollback target confirmed still valid

---

# H. WHAT CAN STILL GO WRONG — PRE-APPROVAL AUDIT

**H1 · The promotion conflict is resolved by hand under freeze.** Two conflicts. The resolution is
pre-agreed and tree-verified — but if anyone resolves `generateCertificatePdf.ts` by *merging* the
hunks rather than *taking the candidate's version*, the resulting tree will not equal T and the C2
chain silently breaks. **Mitigation: assert tree == `e2e05fb…` before committing the merge.**

**H2 · §17-4 evidence arrives at the last possible moment.** It comes from the promotion PR's CI. If
that run fails, the release stops *after* the approval is signed and the tag is cut. **Approval should
be explicitly conditional on it.**

**H3 · The four misnamed migrations ship a falsehood.** A future operator reading the tree will
believe four migrations are unapplied when they are live in production. That is how the *last* G10
attempt failed.

**H4 · §15 is 4 rows empty and 6 partial.** §17-1 requires no blank row. Approving on this matrix
means approving on 6 rows of unexecuted QA — the largest single risk in the package.

**H5 · RLS is assumed, not tested.** Policy definitions match structurally. Nothing has exercised them
behaviourally. The ACL work touched function EXECUTE only — **a different mechanism.**

**H6 · Rollback is only half-specified.** The Pages deployment target is verified; the **database**
rollback component is not bound. If a migration needs reverting post-promotion, the procedure is
unrehearsed.

**H7 · G9's residual is live and growing.** All 71 functions run pre-G9 CORS; one serves ACAO `*`;
ten sign R2 deletes with no lane guard. Excluded by decision — but it does not improve while G10 runs.

**H8 · Staging QA will run against a lane whose ACLs changed today.** CHG-002 was verified by
fingerprint convergence, but **no application traffic has exercised staging since.** The first real QA
pass is also the first test of that change. Not a reason to stop — a reason to treat early QA failures
as *possibly ACL-related* rather than product bugs.

**H9 · PR #103 sits unmerged with green CI.** CI reflects the state at `704ad57`. If `main` moves
before it merges, that evidence goes stale.

**H10 · Nothing mechanically enforces the freeze on `staging`.** `protect-main` targets `main` only.
The freeze holds by agreement — sole access is owner-attested, not enforced.

---

*Read-only throughout this phase. No merge, no `main` change, no T change, no RC approval.
No secret value displayed or recorded.*
