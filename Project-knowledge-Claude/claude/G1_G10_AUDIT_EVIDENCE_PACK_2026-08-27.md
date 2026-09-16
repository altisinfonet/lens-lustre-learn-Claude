# G1 → G10 — AUDIT EVIDENCE PACK

**Compiled 2026-08-27T14:13:07Z. Read-only collection.**
**Executed to produce this pack: zero code changes · zero commits · zero pushes · zero workflow
dispatches · zero tags · zero merges · zero production writes.**
**No credential value, masked value, prefix, length, hash, token, connection string, or secret-derived
output appears anywhere in this document.**

---

## 0 · CANDIDATE IDENTITY — re-derived at compile time

| Field | Value | UTC |
|---|---|---|
| Candidate branch | `staging` | 2026-08-27T14:13:07Z |
| **Candidate commit** | **`b8535fe7c9f2c7f604347ba849ac579bf4946d23`** | 2026-08-27T14:13:07Z |
| **Candidate tree** | **`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`** | 2026-08-27T14:13:07Z |
| `main` commit | `b671e1fb0c5bcf145d442076c229eca888afd674` | 2026-08-27T14:13:07Z |
| `main` tree | `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` | 2026-08-27T14:13:07Z |
| Merge base | `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` | 2026-08-27T14:13:07Z |
| `rev-list --left-right --count main...staging` | **2 / 25** | 2026-08-27T14:13:07Z |
| Changed paths, three-dot | **123** | 2026-08-27T14:13:07Z |
| Changed paths, two-dot *(the §17-11 quantity)* | **107** | 2026-08-27T14:13:07Z |
| **Tags in repository** | **0** | 2026-08-27T14:13:07Z |
| `scratch/*` branches | **0** | 2026-08-27T14:13:07Z |

**Instrument:** `git fetch --prune --tags` then `git rev-parse` / `git merge-base` / `git rev-list` /
`git diff --name-only` / `git tag` against `origin`, local clone synchronised at the stated time.
**Control:** `git ls-remote origin refs/heads/staging` returned the identical commit SHA, excluding a
stale local ref.

---

## 1 · VOCABULARY

**Status** — one of five: `VERIFIED` · `OWNER-ATTESTED` · `BLOCKED` · `NOT YET VERIFIED` · `NOT APPLICABLE`.
**Outcome** — one of four: `SATISFIED` · `REQUIREMENT NOT MET` · `NOT ESTABLISHED` · `NOT APPLICABLE`.
Status and outcome never blend. `VERIFIED / REQUIREMENT NOT MET` means *the measurement was sound and it
showed a failure*.

**Evidence class (§3.1):** INDEPENDENTLY-VERIFIED · OWNER-ATTESTED (*"May NOT be described as verified"*)
· UNVERIFIABLE-BY-DESIGN.

**Repository code is never used to infer cloud state.** Every Cloudflare, Supabase, GitHub-settings and
DNS statement below is sourced from a direct dashboard or API read at a stated time, and is labelled as
such. Where only repository evidence exists for a cloud-side requirement, the row is `NOT YET VERIFIED`.

---

## 2 · AUTHORITATIVE GATE MAP — Master Execution Plan v3.0 §7, verbatim

| Gate | Objective | Exit condition (verbatim) | Primary actor |
|---|---|---|---|
| **G1** | Pages branch control | *Production Pages deploys only from main; no arbitrary branch or preview deploys automatically; existing exposure closed or explicitly gated* | OWNER (dashboard) |
| **G2** | Staging GitHub lane | *staging branch exists at the approved tree, with no directory/file ref conflict against it* | OWNER + CLAUDE |
| **G3** | Lane-aware CI + secret isolation | *Each lane builds with its own values; production secrets scoped to a GitHub Environment restricted to main; repository copies removed; the §5.3 negative test shows the production database reference resolving empty outside its lane* | OWNER + CLAUDE |
| **G4** | De-hardcode lane values | *No lane-specific literal in shipped source; per-lane generated _headers, robots and sitemap; both lanes byte-censused* | CLAUDE |
| **G5a** | Guard host rules R7–R10 | *Host rules added; mutation harness holds every mutant under both lanes' real CI variables; the staging-lane cross-lane negatives fail. The production-lane refusal is G6's exit condition* | CLAUDE |
| **G5b** | Pages Functions de-defaulted | *The production defaults are removed from functions/_seo.ts and the guard's scan extends to functions/. Depends on the owner action in §19* | OWNER then CLAUDE |
| **G6** | Forbidden-reference enforcement | *Pages production variable and CI literal agree; production build refuses a staging reference* | CLAUDE (verification) |
| **G7** | Staging Pages + DNS | *Staging Pages project, staging.50mmretina.com resolving and serving, previews disabled, variables set* | OWNER + CLAUDE |
| **G8** | Staging R2 isolation | *50mm-staging wired via cdn-staging; token scoped to that bucket only; staging proven unable to write the production bucket* | OWNER + CLAUDE |
| **G9** | Staging Edge Functions + synthetic data | *Functions deployed to the staging ref only; CORS allow-list and email origins lane-aware; synthetic accounts only* | CLAUDE |
| **QA** | Full staging QA | *The §15 testing matrix executed on staging.50mmretina.com with recorded evidence* | CLAUDE + OWNER |
| **RC** | Release Candidate freeze | *§10 record complete; Change Ledger closed; owner approval recorded* | OWNER |
| **G10** | Controlled promotion | *Branch protection active on main; main tree equals the approved RC tree; production verified post-deploy* | OWNER + CLAUDE |

---

## 3 · GATE-BY-GATE EVIDENCE

### G1 — Pages branch control

| Field | Entry |
|---|---|
| **Pass condition** | Production Pages deploys only from `main`; no arbitrary branch or preview deploys automatically; existing exposure closed or explicitly gated |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **VERIFIED** |
| **Outcome** | **SATISFIED** |
| **Evidence** | Cloudflare dashboard, Pages project **`lens-lustre-learn-claude`** → Settings → Build → Branch control: **Production branch: `main`** · Automatic deployments: Enabled. Read directly in the dashboard, not inferred from repository code |
| **UTC** | 2026-08-27T11:40Z (dashboard read) |
| **Control** | The staging project `lens-lustre-learn-claude-staging` read in the same session shows **Production branch: `staging`**, so the field is lane-specific and not a constant |
| **Unblock** | — |

**Related §8.10 evidence:** production database fingerprints re-measured 2026-08-27T12:02Z — base tables (public) **146** · vault secrets **4** · cron jobs **16** · storage buckets **11** · RLS policies (public) **686** · `site_settings` rows **35** · migration ledger max `20260825115208`. All identical to the recorded baseline. Drift counters `auth.users` **103** and `posts` **288**, unchanged from the 07:38:38Z reading — **zero drift across the session**.

> **⚠ INSTRUMENT DEFECT RECORDED — §8.10 fingerprint definitions are ambiguous.** A first query returned tables **156** and RLS policies **730**, apparently violating "must never move". A discriminating query at 2026-08-27T12:02Z established the difference was the instrument, not the state: `information_schema.tables` for `public` counts **156** (146 base tables **+ 10 views**), and `pg_policies` unfiltered counts **730** (686 in `public` **+ 44** in other schemas). **§8.10 does not specify the query.** Any auditor using the wider reading will observe an apparent hard stop against a healthy database. **§8.10 must pin the exact SQL per fingerprint.**

---

### G2 — Staging GitHub lane

| Field | Entry |
|---|---|
| **Pass condition** | `staging` branch exists at the approved tree, with no directory/file ref conflict against it |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **VERIFIED** |
| **Outcome** | **SATISFIED** |
| **Evidence** | `git ls-remote origin refs/heads/staging` → `b8535fe7c9f2c7f604347ba849ac579bf4946d23`; `git rev-parse origin/staging^{tree}` → `e2e05fbb…`. `git fetch --prune` completed without ref-conflict error, which is the condition's negative half |
| **UTC** | 2026-08-27T14:13:07Z |
| **Control** | Remote read compared against local ref; identical, excluding a stale local copy |
| **Unblock** | — |

Staging Supabase project `ztzutckwdhetphwghuzj` (`50mmretinaworld-staging`) confirmed ACTIVE_HEALTHY via API 2026-08-27T12:00Z. Synthetic account population (513 `@staging.test`) recorded in prior QA evidence; **UTC NOT RECORDED**.

---

### G3 — Lane-aware CI + secret isolation

| Field | Entry |
|---|---|
| **Pass condition** | Each lane builds with its own values; production secrets scoped to a GitHub Environment restricted to `main`; repository copies removed; **the §5.3 negative test shows the production database reference resolving empty outside its lane** |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **NOT YET VERIFIED** |
| **Outcome** | **NOT ESTABLISHED** |
| **UTC** | see per-clause rows |
| **Unblock** | **Push a fresh `scratch/g10-53-secret-isolation-*` branch immediately before promotion; confirm the run log prints the literal `EMPTY`; delete the branch afterwards.** §5.3.6 requires the measurement immediately before promotion; §19 states it *"must be re-taken rather than inherited"* at G10 step 7 |

**Clause-by-clause:**

| Clause | Status | Outcome | Evidence | UTC | Control |
|---|---|---|---|---|---|
| Production secret scoped to a GitHub Environment restricted to `main` | **VERIFIED** | SATISFIED | GitHub → Settings → Secrets and variables → Actions, read directly: Environment secrets list shows **one** entry, bound to environment **`production`**. Repository secrets list contains **only four `ANDROID_*` entries** | 2026-08-27T13:5xZ | The same page renders both scopes, so absence at repository scope is a positive read of that list, not a failure to look |
| Repository-level copies removed | **VERIFIED** | SATISFIED | as above — the production database secret name does not appear in the Repository secrets list | 2026-08-27T13:5xZ | four unrelated entries render in the same list, excluding an empty-render artefact |
| Environment exists and is branch-restricted | **VERIFIED** | SATISFIED | GitHub → Settings → Environments → `staging`: **Deployment branches = Selected**, *"1 branch and 0 tags allowed"*, the allowed entry being `staging`. `production` and `staging` both exist | 2026-08-27T12:2xZ | read directly in the settings UI |
| Environment **creation** and secret **deletion** as historical acts | **OWNER-ATTESTED** | SATISFIED | §3.1 — *"May NOT be described as verified"* | NOT RECORDED | — |
| §8.1 four required clauses present on the branch being protected | **VERIFIED** | **REQUIREMENT NOT MET** on `main` | `git show <ref>:.github/workflows/apply-migration.yml`, md5 `main` = `b7a9675bc7ac068f93e8214d37c2cdc4` (**6 steps**, `target` input absent, `environment:` commented out, no branch check, no ref assertion) vs candidate = `fce7d4f5143c035de6863e2e290f7b30` (**8 steps**, all four clauses present). **AF-15.** Resolved by promotion | 2026-08-27T14:13:07Z | the candidate ref answers YES on all four clauses, excluding a uniform-NO grep artefact |
| **§5.3 negative test** | **NOT YET VERIFIED** | **NOT ESTABLISHED** | Run `32950030302` — owner-supplied `head_sha` `9478cf768c47ba91cece3cddae02548e5f3ce8c2`, `run_started_at` 2026-08-26T08:52:46Z, conclusion `success`. Workflow definition read at that tip: single step, no `if:`, no `continue-on-error`, non-empty branch `exit 1`, emits one literal word, no `environment:` key, trigger restricted to the scratch pattern — therefore `success` is reachable only via the `EMPTY` path | design read 2026-08-27T11:09Z; corroboration 11:33Z | Independent git corroboration: branch-tip commit dated 2026-08-26T08:52:42Z, **+4 s** before the supplied `run_started_at`, consistent with a push-triggered run on that commit and no other |
| §5.3 timing | **NOT YET VERIFIED** | **NOT ESTABLISHED** | §5.3.6 requires the run **immediately before promotion**. The 2026-08-26 run predates any promotion | NOT RECORDED | — |
| §5.3 branch deletion | **VERIFIED** | **SATISFIED** | `git ls-remote origin 'refs/heads/scratch/*'` → **0 refs** | 2026-08-27T14:13:07Z | the same pattern returned 7 refs earlier the same day, so a zero result is a real change, not a broken query |

**Evidence class note:** the run-to-workflow binding rests on owner-supplied API fields. This session did not read the Actions API (it returns HTTP 403 for this session — see §7). Under §3.1 the weakest link governs: **OWNER-ATTESTED, not independently verified.**

---

### G4 — De-hardcode lane values

| Field | Entry |
|---|---|
| **Pass condition** | No lane-specific literal in shipped source; per-lane generated `_headers`, robots and sitemap; both lanes byte-censused |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **VERIFIED** |
| **Outcome** | **SATISFIED** |
| **Evidence** | Production `_headers` verified byte-identical to the pre-change artifact (prior gate evidence). Live corroboration from the candidate's own deployment build log, deployment `3a6f3df9-639b-444f-846a-b17be22cde73`, line 425: `generate-headers OK: 12 rules, 25 headers; cdn=cdn-staging.50mmretina.com serving-origin=https://staging.50mmretina.com acao=https://staging.50mmretina.com` — lane-correct values generated at build time, not hardcoded |
| **UTC** | build 2026-08-26T13:48:09Z; log read 2026-08-27T12:0xZ |
| **Control** | Line 426 of the same log: `generate-seo-assets OK: non-production lane https://staging.50mmretina.com — robots.txt blocks all crawling, sitemap.xml empty` — the generator produced *different* output for the non-production lane, so the values are lane-resolved rather than constant |
| **Unblock** | — |

---

### G5a — Guard host rules R7–R10

| Field | Entry |
|---|---|
| **Pass condition** | Host rules added; mutation harness holds every mutant under both lanes' real CI variables; staging-lane cross-lane negatives fail |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **VERIFIED** |
| **Outcome** | **SATISFIED** |
| **Evidence** | 41/41 harness; **21/21 mutants held on this tree**, run `32982588154`. Live corroboration from the candidate's deployment build, line 427: `ISOLATION-GUARD PASS: expected=ztzutckwdhetphwghuzj present; forbidden=[jtdtehuqtinjxropkkcn] absent; host=cdn-staging.50mmretina.com present; forbidden-hosts=[cdn.50mmretina.com,www.50mmretina.com,https://50mmretina.com] absent; 388 assets scanned` |
| **UTC** | mutants NOT RECORDED; guard line 2026-08-26T13:48:09Z |
| **Control** | Mutation testing is self-controlling — a surviving mutant is the negative case. The guard line itself carries **two known-present and two known-absent assertions**, satisfying §5.1 Rule 1 within a single output |
| **Unblock** | — |

---

### G5b — Pages Functions de-defaulted

| Field | Entry |
|---|---|
| **Pass condition** | Production defaults removed from `functions/_seo.ts` **and** the guard's scan extends to `functions/`. Depends on the owner action in §19 |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **VERIFIED** |
| **Outcome** | **SATISFIED** |
| **Evidence** | (a) Scan of **every** file under `functions/` on the candidate tree for the production project reference and the production apex host: **zero hits**. `laneValue()` throws on an absent or empty variable rather than defaulting. (b) `scripts/verify-bundle-isolation.mjs` line 152: `const SOURCE_ROOTS = ["functions", "supabase/functions"];` scanned **alongside `dist` and on by default**, with rule **R11** failing the run if a `functions` directory exists but is not among the scanned roots. (c) **Cloud side, read directly in the Cloudflare dashboard, not inferred from code:** production Pages project `lens-lustre-learn-claude` → Production environment variables contain `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY` and `SITE_ORIGIN`, the last with value `https://www.50mmretina.com` |
| **UTC** | (a),(b) 2026-08-27T14:13:07Z · (c) 2026-08-27T11:45Z |
| **Control** | The same scan pattern returns hits elsewhere in the tree, so the zero result under `functions/` is not a pattern artefact |
| **Unblock** | — |

> **⚠ PROMOTION PREREQUISITE.** Because `laneValue()` **throws** rather than defaulting, deploying this candidate to a Pages project lacking any of the three variables makes five SSR routes throw at request time: `/competitions/[id]`, `/courses/[slug]`, `/featured-artist/[slug]`, `/journal/[slug]`, `/page/[slug]` (measured by import scan across `functions/`, 2026-08-27T11:15Z). All three are present as of the dashboard read above. **Re-confirm immediately before deploy; two of three is a failure, not partial progress.**
>
> **⚠ PRIOR-RECORD CORRECTION.** §19/§20 and this session's earlier packs recorded the G5b code half as outstanding and requiring a new candidate. **Measurement contradicts that.** Both halves are already in tree `e2e05fbb…`.

---

### G6 — Forbidden-reference enforcement

| Field | Entry |
|---|---|
| **Pass condition** | Pages production variable and CI literal agree; **production build refuses a staging reference** |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **NOT YET VERIFIED** |
| **Outcome** | **NOT ESTABLISHED** |
| **Evidence** | Staging direction evidenced under G5a (guard PASS line above). **Cloud side, dashboard read:** production Pages variables include `ISOLATION_EXPECTED_HOST = cdn.50mmretina.com`, `ISOLATION_FORBIDDEN_HOSTS = cdn-staging.50mmretina.com,staging.50mmretina.com`, `ISOLATION_FORBIDDEN_REFS = ztzutckwdhetphwghuzj`; build command `npm run build && node scripts/verify-bundle-isolation.mjs`, so the guard runs on every production deploy |
| **UTC** | 2026-08-27T11:45Z (dashboard) |
| **Control** | Staging project variables read in the same session carry the mirrored values, so these are lane-specific |
| **Unblock** | **The production-direction refusal is demonstrated by CHG-G10-003 landing at promotion.** No pre-promotion action closes this; it is a Phase 8 observation. Disposition available now: **CLOSED WITH DOCUMENTED DEVIATION** pending owner signature |

---

### G7 — Staging Pages + DNS

| Field | Entry |
|---|---|
| **Pass condition** | Staging Pages project, `staging.50mmretina.com` resolving and serving, **previews disabled**, variables set |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **VERIFIED** (serving) · **NOT YET VERIFIED** (previews-disabled clause) |
| **Outcome** | **SATISFIED** (serving) · **NOT ESTABLISHED** (previews) |
| **Evidence** | Cloudflare dashboard: project `lens-lustre-learn-claude-staging`, deployment **`3a6f3df9-639b-444f-846a-b17be22cde73`**, source `staging b8535fe`, status **success**, 2026-08-26 19:18, **Aliases: `staging.50mmretina.com`**. Staging `robots.txt` fetched directly and read: `# NON-PRODUCTION LANE — NOT FOR INDEXING.` / `User-agent: *` / `Disallow: /` |
| **UTC** | deployment read 2026-08-27T12:0xZ; robots read 2026-08-26 (NOT RECORDED to the minute) |
| **Control** | §15 row 8 dual-host probe, staging 2026-08-27T07:26:03Z and production 07:26:43Z — **same minute**, with a known-present and a known-absent path on each host |
| **Unblock** | **Previews:** the deployments list shows Preview entries for `g10/4.3-arm-pr…` and `scratch/g10-53…` with *"No deployment available"*. That is **not** the same as previews being disabled, and the two readings were not distinguished. Read the project's Preview branch setting directly and record it |

> **⚠ CONTRADICTION RECORDED, NOT RESOLVED.** The Pages settings pane states preview deployments are restricted by a Cloudflare Access policy, while `/one/access-controls/apps` returns *"You need an active plan to continue"*. Both cannot be straightforwardly true. Recorded as **NEED EVIDENCE**; not resolved by inference in either direction. Separately measured: `staging.50mmretina.com` served `robots.txt` **without any Access sign-in**, so that custom domain is publicly reachable.

---

### G8 — Staging R2 isolation

| Field | Entry |
|---|---|
| **Pass condition** | `50mm-staging` wired via `cdn-staging`; **token scoped to that bucket only**; **staging proven unable to write the production bucket** |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **VERIFIED** |
| **Outcome** | **SATISFIED**, subject to the owner ruling below |
| **Evidence** | **Behavioural — GitHub Actions run `33078…`→`33079091310`, job `98541056457`, commit `ca95f50`, 2026-08-27T13:52Z:**<br>• `CONTROL 1 OK: object created and confirmed present in 50mm-staging.` — `head-object` returned `ContentLength: 0` and the empty-object ETag, so the write is real, not merely reported<br>• **`TEST OK: write to 50mm refused with AccessDenied.`**<br>• `control object deleted from 50mm-staging`<br>**Configuration — Cloudflare dashboard read, 2026-08-27T13:2xZ:** Account API token **`staging-upload`** · permission **Object Read & Write** (*not* Admin) · **bucket scope exactly one entry: `50mm-staging`** · `50mm` not in scope. Separate tokens `50mm`→`50mm` and `AgentCRM`→`agentcrm`, no overlap |
| **UTC** | 2026-08-27T13:52Z (run) · 2026-08-27T13:2xZ (dashboard) |
| **Control** | **The same credential, in the same run, seconds apart, succeeded against `50mm-staging` and was refused against `50mm`.** A uniform-denial artefact is therefore impossible |
| **Unblock** | Owner ruling on the control substitution below |

> **⚠ TWO RUNBOOK DEFECTS — Appendix A.5 is not executable as written.**
> **(1)** A.5 specifies `--body /dev/null`. AWS CLI v2 rejects it: *"Error parsing parameter '--body': Blob values must be a path to a file."* The command aborts before any request is sent. A zero-byte **regular file** is required.
> **(2)** A.5's known-absent control requires a non-existent bucket to answer `NoSuchBucket`, distinct from `AccessDenied`. **Cloudflare R2 answers `AccessDenied` for any bucket a token is not scoped to, including non-existent ones** — deliberate, to prevent enumeration. Measured in the same run: `CONTROL 3 returned AccessDenied`. **The control can never pass on R2.**
> **Together: the §8.6 negative test has never been runnable as specified. Any prior record claiming it passed as written would be false.**
>
> **§8.6 also states token scope "is not readable after creation, so this is OWNER-ATTESTED by construction."** The scope **is** readable and was read (above). That premise is false.
>
> **Owner ruling required:** replace A.5's known-absent control with the known-present control (Control 1), on the basis that Control 1 excludes the uniform-denial failure mode more directly. **Disposition: CLOSED WITH DOCUMENTED DEVIATION. Not GREEN without the signature.**

**§8.6 part 3 — production bucket unchanged:** no object was created on `50mm`. Production bucket state read from dashboard 2026-08-27T13:0xZ: size **1.09 GB**, Public Access Enabled, top-level prefixes include `avatars/`, `competition-photos/`. **Instrument caution:** bucket size is displayed rounded and **cannot detect a 0-byte probe object**; the discriminating check is an object-browser prefix search for `isolation-probe/`, which must return zero.

---

### G9 — Staging Edge Functions + synthetic data

| Field | Entry |
|---|---|
| **Pass condition** | Functions deployed to the staging ref only; CORS allow-list and email origins lane-aware; synthetic accounts only |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **NOT YET VERIFIED** |
| **Outcome** | **NOT ESTABLISHED** |
| **Evidence** | §14 ruling **G9 EXCLUDED from G10** recorded 2026-08-26, on a measured basis: all 71 production edge functions compared byte-for-byte against the candidate — **21 MATCH · 21 differing only in `_shared/secureHeaders.ts` · 29 DRIFT · 0 UNKNOWN** |
| **UTC** | 2026-08-26 (comparison); minute NOT RECORDED |
| **Control** | Four distinct outcome classes with zero UNKNOWN, so the comparison discriminated rather than defaulting |
| **Unblock** | **Owner countersignature accepting the four residual risks and the attached conditions** |

**Four residual risks the countersignature accepts, stated in full:**

| Risk | Scope |
|---|---|
| Pre-G9 CORS remains in production | **All 71** functions. Deployed `_shared/secureHeaders.ts` byte-identical across every function that bundles it; prefix matching with a `.lovable.app` wildcard |
| **Wildcard CORS** | `submit-judge-decision` v23 answers `Access-Control-Allow-Origin: *` from a local `corsHeaders` object. **Not fixed by shipping `secureHeaders.ts`** |
| Storage-lane guard absent | **Ten** functions sign S3/R2 list and batch-delete calls with no `assertStorageLane`: `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`, `detect-orphan-files`, `backfill-image-dims`, `media-register-upload` |
| Lane-config drift | Eight functions hardcode production origins, including all three email functions |

**Why exclusion is the safer option, not the lazy one:** production is **ahead** of the repository in three functions. `send-gift-credit` v23 runs an indexed RPC lookup while both branches still contain the paginated `auth.admin.listUsers()` — **redeploying would reintroduce a known defect into production.** There is no function-level rollback: 29 of 71 differ from the repository, no CI workflow deploys them, and §17-9's rollback target is a Cloudflare Pages deployment ID, which does not restore edge functions.

**Conditions attached:** no production edge function is redeployed during G10 · Phase 10 does not run · step 4.11 is **NOT APPLICABLE** · G9 must open with a captured snapshot of all 71 deployed bundles, the only artefact that could serve as a rollback.

---

### G10 — Controlled promotion

| Field | Entry |
|---|---|
| **Pass condition** | Branch protection active on `main`; **`main` tree equals the approved RC tree**; production verified post-deploy |
| **Candidate** | commit `b8535fe7…` / tree `e2e05fbb…` |
| **Status** | **NOT YET VERIFIED** |
| **Outcome** | **NOT ESTABLISHED** |
| **UTC** | 2026-08-27T14:13:07Z |
| **Unblock** | Signed §11 approval → tag → merge → §12.4 steps 9–11 → migrate → deploy → capture deployment ID → §18 |

| Clause | Status | Outcome | Evidence | UTC | Control |
|---|---|---|---|---|---|
| Branch protection active on `main` | **OWNER-ATTESTED** | SATISFIED | Ruleset **`protect-main`** · Enforcement **Active** · Applies to **1 target: `main`** · **Bypass list empty** · three rules enabled: *Require a pull request before merging*, *Block force pushes*, *Restrict deletions*. Read directly in GitHub → Settings → Rules → Rulesets | 2026-08-27T11:5xZ | **Live enforcement observed independently:** the file-creation dialog returned *"You can't commit to `main` because it is a protected branch"*, so the rule is not merely configured but actively blocking writes |
| `main` tree equals approved RC tree | **VERIFIED** | **REQUIREMENT NOT MET** (pre-promotion, as expected) | `db8df567…` ≠ `e2e05fbb…` | 2026-08-27T14:13:07Z | — |
| Production verified post-deploy (§18) | **NOT YET VERIFIED** | NOT ESTABLISHED | structurally post-promotion | NOT RECORDED | — |

> **§17-7 states branch protection *"cannot be read by any session, so it is never recorded as independently verified."* It was read directly in this session.** The row is nonetheless left **OWNER-ATTESTED** — this pack does not unilaterally override the governance document. **The discrepancy is raised for the owner to rule on.**

> **⚠ TRIAL-MERGE RESULT — pre-proof only, not authorisation.** In an isolated detached worktree, `git merge --no-ff --no-commit origin/staging` onto `origin/main` produced **exactly one conflict**, `src/lib/generateCertificatePdf.ts`. Resolving it to the candidate's version yielded tree **`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`** — equal to the candidate. **The merge was aborted and the worktree removed; nothing was committed, tagged or pushed.** Control: `git write-tree` **refused** while the conflict was unresolved, so the tool discriminates. Measured 2026-08-27T11:07Z. **This must still be re-asserted live on the real merge — a merge against a different `main` tip is a different measurement.**

**Supporting measurement — the two `main`-only commits.** `git rev-list --left-only` returns `b671e1fb` (PR #101, 15 paths) and `6ebe6c3d` (PR #97, 2 paths) — 17 paths total. Per-path two-dot comparison: **16 of 17 byte-identical to the candidate**; the sole difference is `src/lib/generateCertificatePdf.ts`, which is the conflict above. **`main` carries no orphaned production work the candidate would silently revert.** Measured 2026-08-27T11:06Z; control — the same command on a known-differing path returns `M`.

---

## 4 · §15 TESTING MATRIX

**Standing:** 2 VERIFIED · 8 PARTIAL · 2 FAILING · 0 blank. **§17-1 passes when no row is blank and no row is marked "expected"** — both conditions are separate from row completeness.

| # | Row | Status | Outcome | Evidence / control | UTC | Unblock |
|---|---|---|---|---|---|---|
| 1 | UI | **NOT YET VERIFIED** | **REQUIREMENT NOT MET** | AF-03 / D-5 — assets resolve to `cdn.50mmretina.com` on 29 routes. **Instrument gap now closed:** deployment ID `3a6f3df9-639b-444f-846a-b17be22cde73` exists | NOT RECORDED | Owner disposition: approve **over a known-failing row**, not as a pass |
| 2 | Flows | **NOT YET VERIFIED** | NOT ESTABLISHED | 7/10 executed. Negative half evidenced by §8.10 (production row counts unchanged over the window) | 2026-08-27T07:38:38Z (negative half) | 2 blocked on the production-authenticated QA profile; 1 structurally untestable (0 journal articles) |
| 3 | Auth | **NOT YET VERIFIED** | NOT ESTABLISHED | N7 verified | NOT RECORDED | **N/A with reason** — no staging mail path (§8.8 Option 1); `/login`+`/signup` need an anonymous context |
| 4 | Database | **NOT YET VERIFIED** | NOT ESTABLISHED | 18 RLS assertions with **4 controls**, executed in rolled-back transactions | NOT RECORDED | Instrument also requires the lane-gate refusal transcripts — **N1 now supplied**, N2 is Phase 8 |
| 5 | Storage | **VERIFIED** | **SATISFIED** | Upload chain with 2×2 controls; write-refusal run `33079091310` | 2026-08-27T13:52Z | — |
| 6 | Edge functions | **NOT YET VERIFIED** | NOT ESTABLISHED | 5/74 invoked, all staging; **0 production function calls from staging flows**; staging logs 347/347 request IDs | NOT RECORDED | Scope to functions reachable by the ten flows. **The 5 financial functions recorded NOT TESTABLE — POLICY EXCLUSION, displayed, never folded into a coverage ratio** |
| 7 | Security | **VERIFIED** | **SATISFIED** | Guard + 21/21 mutants, run `32982588154` | NOT RECORDED | — |
| 8 | SEO | **VERIFIED** | **REQUIREMENT NOT MET** | Instrument closed — both hosts probed in the **same minute** with known-present and known-absent paths. Criterion still fails: `og:image` and `json_ld` resolve to production | staging 07:26:03Z · production 07:26:43Z | Approve over a known-failing row under D-5 |
| 9 | Email | **NOT APPLICABLE** | **NOT APPLICABLE** | No send path exists; §8.8 Option 1. **Recorded as vacuous, not as passing** | NOT RECORDED | — |
| 10 | Responsive | **BLOCKED** | NOT ESTABLISHED | `server.url` verified. **Instrument failure:** `resize_window` reported success 3× across 2 rounds while `innerWidth` remained 1536 | NOT RECORDED | **N/A with reason**, or supply a working viewport instrument. **No CSS simulation was accepted as a substitute** |
| 11 | Regression | **NOT YET VERIFIED** | NOT ESTABLISHED | Negative half evidenced 2026-08-27T07:38:38Z | 2026-08-27T07:38:38Z | Positive half is §18 — **structurally post-promotion (§17-12)** |
| 12 | Cross-lane | **NOT YET VERIFIED** | NOT ESTABLISHED | N3–N8 verified. **N1 supplied — run `33072738875`** | 2026-08-27T (N1) | **N2 cannot run before promotion**: `main` carries no gate, so a pre-promotion N2 tests nothing (**§14 HS-11**) |

**§15.2 N1 — full transcript reference.** Run `33072738875`, job `98518897198`, commit `b8535fe`, branch `staging`, 7 s.
Step results: *The branch must match the target* ✅ passed · *Refuse to start without the database credential* ✅ passed · **The credential must point at the target database ❌ REFUSED** · *Validate the requested file* ⊘ skipped · *Show the SQL that is about to run* ⊘ skipped · *Install psql* ⊘ skipped · **Run it ⊘ SKIPPED — no SQL executed** · *Confirm* ⊘ skipped.
Verbatim: `Error: secret points at 'jtdtehuqtinjxropkkcn', target is 'staging' — refusing`.
**Discriminating because the two preceding gates passed**, so the refusal is attributable to the lane check alone and not to a wrong branch or a missing credential. Job duration 7 s corroborates that the run stopped before the psql path.
**Test design:** the decoy connection string used a deliberately invalid password and a reserved non-resolvable host. **No real credential existed in the staging Environment before, during, or after; the decoy was deleted and the environment verified to read "This environment has no secrets."**

---

## 5 · §17 — FINAL G10 CHECKLIST

*"Every line is checked immediately before promotion, in this order, on the day of promotion. A line that was true last week is not checked."*

| # | Check | Passes when | Status | Outcome |
|---|---|---|---|---|
| 1 | §15 matrix complete, including every §15.2 refusal | No row blank, none marked "expected" | **NOT YET VERIFIED** | NOT ESTABLISHED |
| 2 | Change Ledger closed | Every entry has an outcome; **no entry UNINTENDED** | **VERIFIED** | **SATISFIED** — nine entries, zero UNINTENDED, on the owner's 2026-08-27 ruling reclassifying CHG-G10-005 TEST/HARNESS (pending signature) |
| 3 | No §14 hard stop live | Each explicitly checked, not assumed absent | **NOT YET VERIFIED** | NOT ESTABLISHED — requires the G9 countersignature |
| 4 | Isolation guard passes on both lanes with host rules active | **Both CI runs named by run ID**, with job-level results | **NOT YET VERIFIED** | NOT ESTABLISHED — staging side evidenced; **production-lane run does not exist until promotion** |
| 5 | Mutation harness holds every mutant | Mutants held equals mutants defined, **from a run on this tree** | **VERIFIED** | **SATISFIED** — 21/21, run `32982588154` |
| 6 | §10 RC record complete | **It names a tree, not only a branch** | **NOT YET VERIFIED** | NOT ESTABLISHED |
| 7 | Branch protection on `main` active | Re-attested by the owner **at this moment** | **OWNER-ATTESTED** | SATISFIED (configuration read; re-attestation still required on the day) |
| 8 | Production build job env values unchanged from baseline | Compared field by field against the pre-change fingerprint | **NOT YET VERIFIED** | NOT ESTABLISHED |
| 9 | **Production rollback target identified and itself verified** | Named by tree, verification evidence on file | **NOT YET VERIFIED** | NOT ESTABLISHED |
| 10 | Owner approval (§11) recorded, names the approved tree | **Signed and dated before the merge, not after** | **VERIFIED** | **REQUIREMENT NOT MET** — tag count 0, no approval exists |
| 11 | Promotion merge performed per §12 | **Tree equality asserted AFTER the merge, against the tag created BEFORE it — §12.4 steps 9 to 11, in that order** | **NOT YET VERIFIED** | NOT ESTABLISHED |
| 12 | §18 post-production checks pass | Compared against the pre-release production baseline | **NOT YET VERIFIED** | NOT ESTABLISHED |

> **⚠ CORRECTION TO THIS SESSION'S EARLIER GUIDANCE.** Earlier packs from this session instructed *"assert `main` tree == `e2e05fbb…` **before committing** the merge."* **§17-11 states the assertion is made AFTER the merge, against the tag created BEFORE it.** The tag must therefore exist before the merge, and the equality check follows the merge. The earlier wording was imprecise and is corrected here.

> **§17 item 9, quoted for the owner:** *"If the honest answer is that no recent production state has been verified to the standard of this document, then the rollback plan is 'roll forward under pressure', and the owner should decide that knowingly rather than discover it during an incident."* **This pack records item 9 as NOT ESTABLISHED.**

---

## 6 · §18 — POST-PRODUCTION VERIFICATION CHECKLIST

*"Run immediately after promotion and again after the first full traffic hour. Every item is compared against a baseline captured before the release, not judged in isolation — 'the site loads' is not a result."*

| Area | Check | Compared against | Status |
|---|---|---|---|
| Origin | `www.50mmretina.com` serves the new build; apex redirects to www | Recorded pre-release redirect behaviour **including status code** | NOT YET VERIFIED |
| Bundle | Deployed production bundle contains the production ref and host, **no staging value** | The isolation guard's own output for the production job of this run | NOT YET VERIFIED |
| Headers | Security headers and cache directives **byte-match** the recorded production `_headers` artifact | Pre-release sha256 in Appendix B | NOT YET VERIFIED |
| SEO | `robots.txt`, `sitemap.xml`, canonicals are the production forms | Pre-release fetched bodies | NOT YET VERIFIED |
| Auth | Sign-in, session refresh, sign-out succeed for a real production account | Pre-release timings and success | NOT YET VERIFIED |
| Database | Production schema fingerprint unchanged unless deliberately migrated | Recorded production schema fingerprint | NOT YET VERIFIED |
| Edge functions | Every function invoked by the release path responds; error rate at baseline | Pre-release error rate over an equal window | NOT YET VERIFIED |
| Storage | Images serve from `cdn.50mmretina.com`; no new 404 class | Pre-release sampling of the same keys | NOT YET VERIFIED |
| Email | First outbound message of each type carries production links | Pre-release template output | NOT YET VERIFIED |
| Mobile | Android build unaffected, or its own release record exists | §8.9's statement of the web/Android relationship | NOT YET VERIFIED |
| Errors | Client and server error volumes over the first hour | **The same hour on the previous day** | NOT YET VERIFIED |
| Rollback readiness | Rollback target still valid after the release | §17 item 9 | NOT YET VERIFIED |

**All twelve are structurally post-promotion. None can be closed at Phase 7.**

---

## 7 · APPROVAL AND TAG REQUIREMENTS

| Requirement | Status | Outcome | Evidence | UTC |
|---|---|---|---|---|
| §11 approval record exists, all eight fields, **naming the tree** | **BLOCKED** | NOT ESTABLISHED | Owner document; absence not provable by this session | NOT RECORDED |
| A tag exists | **VERIFIED** | **REQUIREMENT NOT MET** | `git tag \| wc -l` = **0** after `fetch --tags` | 2026-08-27T14:13:07Z |
| That tag resolves to `e2e05fbb…` | **VERIFIED** | **REQUIREMENT NOT MET** | Vacuously fails — no tag exists | 2026-08-27T14:13:07Z |
| Tag created **before** the merge (§17-11) | **NOT YET VERIFIED** | NOT ESTABLISHED | Procedural | NOT RECORDED |
| Approval signed and dated **before** the merge (§17-10) | **NOT YET VERIFIED** | NOT ESTABLISHED | Procedural | NOT RECORDED |

**§11:** *"Approval is a separate, explicit act. Reviewing evidence is not approval; a green pipeline is not approval."*
**Readiness requires all three: signed record AND tag created AND tag resolving to the candidate tree. None holds.**

---

## 8 · INSTRUMENT LIMITATIONS OF THIS SESSION — scoped

**GitHub REST API unavailable to this session.** `GET /repos/altisinfonet/lens-lustre-learn-Claude` → **HTTP 403**, *"GitHub access to this repository is not enabled for this session."* Measured 2026-08-27T11:07Z.
**Scope, established by two measurements:** git-protocol access to the same repository **succeeds** (`ls-remote`, `fetch`, `rev-list`, `ls-tree`, `show`); unauthenticated `https://api.github.com/` returns **HTTP 200** from this container, so the host is reachable. **This is a session authorisation scope, not a property of the repository.** `git push` is likewise refused by the proxy.
**Consequence:** workflow-run metadata and PR review metadata could not be read by this session. Where owner-supplied, such fields are recorded **OWNER-ATTESTED**. **An owner or auditor with normal repository access is not subject to this limitation.**

**Accessibility-tree tool unreliable for control state.** It reported all 13 ruleset checkboxes unchecked; a screenshot showed three plainly ticked. **The visual reading was used and the tool's answer recorded as wrong.** Had the tree been trusted, this pack would have reported branch protection unconfigured — a false negative.

---

## 9 · EVIDENCE ARTIFACT INDEX

| Artifact | Contents |
|---|---|
| `claude/G10_LIVE_BROWSER_VERIFICATION_2026-08-27.md` | Pages variables, branch protection, Environments — direct dashboard reads |
| `claude/G10_LIVE_REAUDIT_ROUND2_2026-08-27.md` | §8.10 re-measurement and the instrument false alarm; migrations; D-3 withdrawal; guard PASS line; AF-16 |
| `claude/G10_N1_EVIDENCE_2026-08-27.md` | §15.2 N1 transcript, step-by-step, with clean-up verification |
| `claude/G10_G8_R2_ISOLATION_RESULT_2026-08-27.md` | R2 three-control run, Appendix A.5 defects, disposition |
| `claude/G10_R2_TOKEN_SCOPE_EVIDENCE_2026-08-27.md` | Token scope read directly; §8.6 premise defect |
| `claude/G10_CHANGE_LEDGER_CLOSED_2026-08-27.md` | Nine entries, CHG-G10-005 ruling, zero UNINTENDED |
| `claude/G10_OWNER_SIGNING_PACK_2026-08-27.md` | All outstanding signatures pre-filled |
| `claude/G10_STRICT_EVIDENCE_UPDATE_V31_2026-08-27.md` | 55-row status ledger, protocol v3.1 |
| `claude/G10_S14_G9_EXCLUSION_RULING_AND_EXECUTION_2026-08-26.md` | G9 EXCLUDED ruling, four residual risks, conditions |
| `claude/G10_AF15_MIGRATION_LANE_GATE_ABSENT_ON_MAIN_2026-08-27.md` | AF-15 clause comparison |
| `claude/MASTER_PLAN_CLOSURE_DECLARATION_2026-08-27.md` | Closure declaration |
| `claude/NEXT_DEVELOPMENT_PLAN_2026-08-27.md` | Successor programme, three tracks |
| Run `32982588154` | 21/21 mutants on this tree |
| Run `32950030302` | §5.3 probe (owner-supplied metadata) |
| Run `33072738875` / job `98518897198` | §15.2 N1 refusal |
| Run `33079091310` / job `98541056457` | G8 R2 three-control probe |
| Deployment `3a6f3df9-639b-444f-846a-b17be22cde73` | Candidate build, guard PASS line, Functions upload |

---

## 10 · SUMMARY

| Gate | Status | Outcome |
|---|---|---|
| **G1** | VERIFIED | **SATISFIED** |
| **G2** | VERIFIED | **SATISFIED** |
| **G3** | NOT YET VERIFIED | NOT ESTABLISHED |
| **G4** | VERIFIED | **SATISFIED** |
| **G5a** | VERIFIED | **SATISFIED** |
| **G5b** | VERIFIED | **SATISFIED** |
| **G6** | NOT YET VERIFIED | NOT ESTABLISHED |
| **G7** | VERIFIED / NOT YET VERIFIED (previews) | SATISFIED / NOT ESTABLISHED |
| **G8** | VERIFIED | **SATISFIED** subject to owner ruling |
| **G9** | NOT YET VERIFIED | NOT ESTABLISHED |
| **G10** | NOT YET VERIFIED | NOT ESTABLISHED |

**Five gates SATISFIED on independent evidence. One SATISFIED pending a ruling. G7 split. Four NOT ESTABLISHED, of which G6, G9 and G10 cannot close before promotion or signature.**

# PROMOTION VERDICT: **NOT READY**

**Reason:** tag count is **0**, so no signed §11 approval, no tag, and no tag resolving to
`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` exist; and §5.3's pre-promotion re-run, the G9
countersignature, and the G8 control ruling are each outstanding.

**Honest ceiling: 7 GREEN + 4 CLOSED WITH DOCUMENTED DEVIATION.** Not 11 GREEN. G3's Environment
creation and secret deletion, and HS-12 branch protection, are OWNER-ATTESTED by construction and under
§3.1 **may never be described as independently verified**; G10 cannot be GREEN before promotion occurs.

*No credential value, masked value, prefix, length, hash, token, connection string, or secret-derived
output appears in this document. File-content md5 digests cited for `apply-migration.yml` are digests of
public repository files, not of secret material.*
