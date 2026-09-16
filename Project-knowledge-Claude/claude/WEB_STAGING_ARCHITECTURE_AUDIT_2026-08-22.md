# WEB STAGING — READ-ONLY ARCHITECTURE AUDIT

Date: 2026-08-22
Scope: **WEB STAGING ONLY.** Phase 1–5 not touched. Judging Panel not touched.
Status: **READ-ONLY. NOTHING WAS MODIFIED.** No GitHub, Cloudflare, Supabase,
R2, production or staging change was made during this audit.

Prerequisite state: Gate 2 schema baseline is GREEN
(`claude/GATE2_STAGING_SCHEMA_BASELINE_APPLIED_2026-08-22.md`) — staging
`ztzutckwdhetphwghuzj` carries a definition-identical copy of the production
public schema with 0 rows.

---

## 0. Your diagram — confirmed, with three additions

Your two-lane picture is correct and is the architecture adopted below. Three
things it does not yet show, each of which is a real isolation boundary that
must be built or it will leak:

| Missing from the diagram | Why it matters |
|---|---|
| **Cloudflare Pages Functions** (`functions/`, 7 files) | `functions/_seo.ts` **hardcodes the production Supabase URL and anon key**. A staging Pages project would serve SEO from production. The current bundle guard cannot see this file. |
| **Supabase Edge Functions** (`supabase/functions/`, 74) | Deployed per project. `supabase/config.toml` pins `project_id = "jtdtehuqtinjxropkkcn"`, so a careless `supabase link` deploys staging code to production. |
| **The CDN read host** | `cdn.50mmretina.com` is hardcoded in **6 non-test source files**. Pointing staging at the staging R2 bucket does not change where the browser reads images from. Staging would display production photographs. |

And one correction to the mental model:

> **R2 is not selected by an environment variable.** It is configured *inside the
> database*, at `public.site_settings` where `key = 's3_storage_settings'`
> (`value jsonb`, fields: `provider, enabled, bucket_name, endpoint, region,
> access_key_id, secret_access_key, path_prefix, public_url`). Production holds
> `bucket_name = "50mm"`, `region = "auto"`, `enabled = true`.

That is good news: because staging's `site_settings` has **0 rows**, staging
currently **fails closed** on uploads (`"S3 storage not configured"`). R2
isolation is therefore achieved by what we put into the staging database, and by
never copying production's row.

---

## 1. Current branches

| Fact | Value |
|---|---|
| Default branch | `main` |
| Remote branches | **100** |
| Auto-generated `altisinfonet-patch-*` | 34 |
| A branch named `develop`, `dev` or `staging` | **NONE — does not exist today** |
| Recent long-lived work branches | `staging/web-isolation-guard` (`a7004b2`, merged as PR #87), `staging/schema-dump-tool` (`98228232`), `chore/migration-version-reconciliation`, `docs/handover-*` |

Note the prefix `staging/` is already in use as a *namespace for throwaway tool
branches*. A long-lived branch literally named `staging` does not collide with
`staging/x` in git, but it is a readability trap. **Recommendation: name the
lane branch `staging` and rename the tool-branch convention to `tool/*` going
forward.** Existing `staging/*` branches should be deleted once spent
(`staging/schema-dump-tool` is already due for deletion).

`develop` was *not* adopted. It was previously suggested but nothing in the repo
uses it, no workflow references it, and adding a third long-lived branch adds a
promotion hop without adding a gate. Two lanes, as you specified, is correct.

## 2. Current GitHub Actions workflows

| Workflow | Trigger | Environment it builds with | Deploys? |
|---|---|---|---|
| `web-build.yml` | `push: [main]` **+ `pull_request:` (no branch filter)** | **hardcoded production** Supabase URL/key/ref | No — mirror only |
| `typecheck.yml` | `push: [main]` + `pull_request:` | none | No |
| `ui-gate.yml` | `push: [main]` + `pull_request:` | synthetic `testprojectref0000x` | No |
| `security.yml` | `push: [main]` + `pull_request: [main]` | `GITHUB_TOKEN` | No |
| `health.yml` | `schedule: 0 */2 * * *` + dispatch | **production** URL + anon key | No |
| `apply-migration.yml` | `workflow_dispatch` | `secrets.SUPABASE_DB_URL` = **production** | Writes to production DB |
| `android-build.yml` | `push: [main]` | production + signing secrets | Publishes to Play |

**Finding W-1 (must fix).** `web-build.yml` and `ui-gate.yml` use a bare
`pull_request:` with no branch filter. The moment a `staging` branch exists,
**every PR targeting `staging` will be built by the production-lane job with
production Supabase credentials**, and its isolation guard will assert the
*production* ref is present. That is a lane inversion built into CI on day one.

**Finding W-2 (must fix).** `apply-migration.yml` is `workflow_dispatch` with a
single hardcoded `SUPABASE_DB_URL` secret pointing at production. There is no
target selector and no refusal gate. A staging migration run would silently hit
production.

**Finding W-3 (acceptable as-is).** `android-build.yml` is `push: [main]` only,
so the staging lane cannot trigger a Play release. This must be asserted, not
assumed, whenever that file changes.

## 3. Current Cloudflare Pages Git integration

**The website is built by Cloudflare Pages on Cloudflare's infrastructure, from
the Git integration — not by GitHub Actions.** `web-build.yml`'s own header
documents why it exists: on 2026-08-15 `npm ci` had been failing since the React
19 upgrade, Pages silently stopped deploying, and www served a stale bundle for
hours while every GitHub check stayed green. That workflow is a *mirror* of the
Pages build so failures are visible in the Actions tab. **It does not deploy.**

Consequences for this design:

- The real production gate is the **Pages build command**, not GitHub Actions.
  If the isolation guard is not in the Pages build command, it does not guard
  the thing that actually ships.
- `.node-version` (`22.22.2`) is read by Pages and by `web-build.yml`
  deliberately, so the two cannot drift.
- `dist/` is **not committed** (`.gitignore:11`); every deployment is a build.

**This session cannot read the Pages configuration.** The Cloudflare MCP exposes
R2, KV, D1, Hyperdrive, Workers and docs — **there is no Pages tool**, there is
no browser in this session, and the proxy blocks `www.50mmretina.com`,
`cdn.50mmretina.com` and `staging.50mmretina.com` (all returned `HTTP:000`),
and blocks `dig`. So the following are **UNKNOWN and must be read from the
dashboard before Gate 6**:

| Unknown | Where to read it |
|---|---|
| Production Pages project name | Workers & Pages → Overview |
| Its production branch | project → Settings → Build → Branch control |
| **Whether preview deployments are enabled for all branches** | same screen |
| Its build command and output directory | project → Settings → Build |
| Its existing environment variables (Production **and** Preview) | project → Settings → Variables |
| Custom domains attached | project → Custom domains |
| Whether `staging.50mmretina.com` already resolves | DNS → 50mmretina.com |
| The `seo-edge-injector` Worker's **route pattern** | Workers → seo-edge-injector → Settings → Domains & Routes |

**Finding C-1 (highest risk in this audit).** If the production Pages project
has *automatic preview deployments for all branches*, then creating a `staging`
branch immediately produces a preview build **inside the production Pages
project**, using that project's Preview variables. If those are unset, the build
inherits nothing and the guard's R1/R2 rules fail the build — acceptable. If
they are set to production values, staging code runs against production
backends on a `*.pages.dev` URL. **This must be read and constrained before the
`staging` branch is created.** It is the single ordering constraint in this plan.

**Finding C-2.** The `seo-edge-injector` Worker (last modified 2026-07-11)
rewrites `50mmretina.com` → `www.50mmretina.com` and injects SEO fetched from
`https://${env.SUPABASE_PROJECT_REF}.functions.supabase.co`. The project ref is
env-driven (good), but **if its route is a zone-wide pattern such as
`*50mmretina.com/*`, it will also intercept `staging.50mmretina.com`** and inject
production metadata into staging. Route pattern must be read and, if zone-wide,
narrowed to the production hostnames.

## 4. How staging should be triggered

```
feature/*  ──PR──►  staging  ──►  Cloudflare Pages (staging project)  ──►  staging.50mmretina.com
```

- **Cloudflare**: staging Pages project with production branch = `staging`,
  automatic deployments limited to that branch only, preview deployments for all
  other branches **disabled**.
- **GitHub Actions**: the existing checks gain a staging lane —
  `push: [staging]` and `pull_request: branches: [staging]` — running with
  **staging** environment values and the staging-direction isolation guard.
- Merging `feature/*` → `staging` requires green checks; it does **not** require
  owner approval. Staging is meant to be broken freely.

## 5. How production should be triggered

```
staging (approved commit, tagged)  ──PR, --ff-only──►  main  ──►  Cloudflare Pages (production project)  ──►  www.50mmretina.com
```

- **Cloudflare**: production Pages project keeps production branch = `main`,
  automatic deployments limited to `main` only, preview deployments **disabled**
  (this is what closes Finding C-1).
- **GitHub**: `main` is protected — no direct pushes, PR required, linear
  history, and the promotion gate of §11–12 must pass.
- Only a merge into `main` can deploy production. Nothing on `staging` can.

## 6. Required STAGING environment variables

Set on the **staging Pages project** (its Production environment, branch `staging`),
and mirrored into the staging GitHub Actions jobs:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://ztzutckwdhetphwghuzj.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `ztzutckwdhetphwghuzj` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | staging **public anon** key (`…InJlZiI6Inp0enV0Y2t3ZGhldHBod2dodXpqIiwicm9sZSI6ImFub24i…`) — public by design, shipped in every browser bundle |
| `ISOLATION_FORBIDDEN_REFS` | `jtdtehuqtinjxropkkcn` |
| `ISOLATION_FORBIDDEN_HOSTS` *(new)* | `cdn.50mmretina.com,www.50mmretina.com` |
| `VITE_CDN_HOST` *(new)* | `cdn-staging.50mmretina.com` |
| `VITE_SITE_ORIGIN` *(new)* | `https://staging.50mmretina.com` |
| `SUPABASE_PROJECT_REF` (Pages Functions) *(new)* | `ztzutckwdhetphwghuzj` |
| `SUPABASE_ANON_KEY` (Pages Functions) *(new)* | staging public anon key |

Build command must be `npm run build && npm run verify:isolation`.

## 7. Required PRODUCTION environment variables

Set on the **production Pages project** (Production environment, branch `main`):

| Variable | Value | Status |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://jtdtehuqtinjxropkkcn.supabase.co` | assumed present — verify |
| `VITE_SUPABASE_PROJECT_ID` | `jtdtehuqtinjxropkkcn` | verify |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | production public anon key | verify |
| `ISOLATION_FORBIDDEN_REFS` | `ztzutckwdhetphwghuzj` | **MISSING — this is the open AMBER item from Gate 2 Step 1.** `web-build.yml` currently sets it to `""`, which disables the leak check entirely (guard prints `WARN: … leak check limited to R2`) |
| `ISOLATION_FORBIDDEN_HOSTS` *(new)* | `cdn-staging.50mmretina.com,staging.50mmretina.com` | new |
| `VITE_CDN_HOST` *(new)* | `cdn.50mmretina.com` | new |
| `VITE_SITE_ORIGIN` *(new)* | `https://www.50mmretina.com` | new |
| `SUPABASE_PROJECT_REF` / `SUPABASE_ANON_KEY` (Pages Functions) *(new)* | production values | new |

## 8. Supabase staging / production references

| | Production | Staging |
|---|---|---|
| Project ref | `jtdtehuqtinjxropkkcn` | `ztzutckwdhetphwghuzj` |
| Region | ap-northeast-2 | ap-northeast-2 ✅ same |
| Postgres | 17.6 | 17.6 ✅ same |
| Public schema | 146 tables … | **digest-identical** (13 dimensions) ✅ |
| Rows | live | **0** ✅ |
| `auth.users` | 101 | 0 ✅ |
| Edge functions deployed | 74 in repo | **0 deployed — Gate 8** |
| `supabase/config.toml` | pins `project_id = "jtdtehuqtinjxropkkcn"` | ⚠ staging deploys must pass `--project-ref` explicitly and must never `supabase link` against this file |

Hardcoded production ref locations that matter (excluding tests, which are
hermetic and never reach `dist`):

- `.github/workflows/web-build.yml` — production lane, intentional
- `.github/workflows/health.yml` — production monitoring, intentional
- `functions/_seo.ts` — **not intentional, must become env-driven**
- `supabase/config.toml` — CLI default, must be overridden per lane
- `scripts/health-check.mjs` — production health target, intentional

## 9. R2 staging / production buckets

| | Production | Staging |
|---|---|---|
| Bucket | `50mm` (created 2026-03-07) | `50mm-staging` (created 2026-08-21) |
| Location | **APAC** | **ENAM** ⚠ mismatch |
| Public host | `cdn.50mmretina.com` | **none yet** — needs `cdn-staging.50mmretina.com` |
| Credentials | in production DB `site_settings.s3_storage_settings` | **absent — staging fails closed today** ✅ |

A third bucket, `agentcrm`, exists and is unrelated to this project.

**Finding R-1.** `50mm-staging` was created in **ENAM** while production is
**APAC**. R2 bucket location is fixed at creation. The bucket is empty, so
recreating it in APAC costs nothing and removes a fidelity difference in
latency and multipart behaviour. Recommended, not mandatory.

**Finding R-2.** The staging R2 API token must be **scoped to `50mm-staging`
only**. A broad account token in the staging database would let staging code
write into the production bucket, defeating the whole separation. This is the
single most important credential decision in the staging build.

## 10. Isolation guards required in both directions

The existing guard `scripts/verify-bundle-isolation.mjs` is good but **narrow**:
it scans `dist/` for one expected Supabase ref and a forbidden-ref list
(rules R1–R5, pinned by a 14-case mutation harness). It does **not** cover:

1. **`functions/`** — Pages Functions never enter `dist`. `_seo.ts`'s hardcoded
   production URL and anon key are invisible to it.
2. **R2 / CDN hosts** — there is no host check at all, so "staging build fails
   if production R2 references are detected" is **not currently possible**.
3. **`public/_headers`** — copied verbatim into `dist`. It hardcodes
   `Access-Control-Allow-Origin: https://50mmretina.com` and a CSP naming
   `cdn.50mmretina.com`. Once host-forbidding is switched on, **a staging build
   will correctly fail on its own `_headers` file** until that file is
   generated per lane, exactly as `_redirects` already is by
   `scripts/generate-redirects.mjs`.

Required guard set, both directions:

| Guard | Staging lane | Production lane |
|---|---|---|
| Expected Supabase ref present in `dist` | `ztzutckwdhetphwghuzj` | `jtdtehuqtinjxropkkcn` |
| Forbidden Supabase ref absent from `dist` | `jtdtehuqtinjxropkkcn` | `ztzutckwdhetphwghuzj` |
| Expected CDN host present | `cdn-staging.50mmretina.com` | `cdn.50mmretina.com` |
| Forbidden CDN/site hosts absent | `cdn.50mmretina.com`, `www.50mmretina.com` | `cdn-staging.50mmretina.com`, `staging.50mmretina.com` |
| **`functions/` scanned** for the forbidden ref and hosts | yes | yes |
| Fail-closed on unset/invalid env | R1 retained | R1 retained |
| Mutation harness extended to cover every new rule | required | required |
| Supabase-side: staging edge functions hold only staging secrets | required | n/a |
| Supabase-side: no production row ever copied into staging `site_settings` | required | n/a |

## 11. How an approved staging build is promoted to production

1. Owner tests `staging.50mmretina.com` against staging backends and approves a
   specific commit.
2. That commit is tagged `approved/<YYYY-MM-DD>-<n>` on `staging`. **Creating the
   tag is the approval act** — it is a record, it does not alter the tree.
3. A PR `staging → main` is opened and merged **fast-forward only**.
4. A CI gate on `main` asserts
   `git rev-parse main^{tree}` **==** `git rev-parse <approved-tag>^{tree}`.
   If `staging` moved after approval, the trees differ and the gate fails.
5. Merging `main` triggers the production Pages build, which must print
   `ISOLATION-GUARD PASS` with the production expected ref and the staging refs
   forbidden, before publish.
6. The resulting Cloudflare deployment ID is recorded in the project docs, as
   deploy `19064989-ebd8-43e9-85d5-51464c31d126` was for PR #87.

## 12. Can the exact approved commit be promoted without an uncontrolled rebuild?

**The exact approved *artifact* cannot be promoted — and must not be.**

Vite bakes `VITE_SUPABASE_URL` into the JavaScript at build time. The staging
bundle physically contains `ztzutckwdhetphwghuzj`. Promoting that artifact to
production would put a bundle that talks to the staging database on
`www.50mmretina.com`. The production isolation guard is designed to make exactly
that impossible. Staging and production are also **two separate Pages projects**,
and Pages cannot move a deployment between projects.

So artifact promotion is off the table, on purpose. What *is* promotable, and
what makes the rebuild controlled rather than uncontrolled, is the **source
tree**:

| Property | Guaranteed? | Mechanism |
|---|---|---|
| Same source tree builds production | **Yes** | `--ff-only` merge + tree-hash equality gate (§11.4) |
| Same environment values | **Yes** | Pages project variables, asserted by the guard at build time |
| Same Node version | **Yes** | `.node-version` = `22.22.2`, read by Pages and CI |
| Same dependency set | **Yes** | `npm ci` against the committed lockfile |
| **Byte-identical `dist`** | **No — and this is measured, not assumed** | On 2026-08-21 a local build produced 263 assets against the Pages deploy's 264; the sandbox lacked optional `svgo` and ran Node 22 vs Pages' Node 20 at that time. Cross-machine byte equality is not achievable here. |

**Therefore the honest guarantee is: identical source tree + identical declared
environment + a guard that fails the build if the wrong backend is baked in.**
Anyone claiming byte-identical promotion in this repository would be wrong, and
this project has already measured why.

The tree-hash gate has precedent here: PR #87 was verified by exactly this
method (branch tree `a0c3f34d` identical to `main` after merge).

---

## PROPOSED ARCHITECTURE

```
                              GITHUB  (altisinfonet/lens-lustre-learn-Claude)
                                             │
                 ┌───────────────────────────┴───────────────────────────┐
                 │                                                       │
          feature/*  ──PR──►  staging                          approved tag
                                 │                                       │
                                 │                              PR --ff-only
                                 │                                       ▼
                                 │                                     main
                                 ▼                                       ▼
                  Cloudflare Pages  [STAGING project]     Cloudflare Pages  [PRODUCTION project]
                  prod branch = staging                   prod branch = main
                  previews DISABLED                       previews DISABLED
                  staging.50mmretina.com                  www.50mmretina.com
                                 │                                       │
                                 ▼                                       ▼
                  Supabase  ztzutckwdhetphwghuzj          Supabase  jtdtehuqtinjxropkkcn
                  (schema-identical, 0 rows,              (live)
                   synthetic accounts only)                        │
                                 │                                       │
                                 ▼                                       ▼
                  R2  50mm-staging                        R2  50mm
                  cdn-staging.50mmretina.com              cdn.50mmretina.com
```

Enforcement, in both directions, at build time — not by convention.

---

## GATES

Each gate has an entry condition, a change set, and an exit condition that must
be evidenced. **Nothing proceeds to the next gate until the previous one is
evidenced green.**

| Gate | What it does | Exit condition |
|---|---|---|
| **G1 — Pages branch control (must be FIRST)** | Read the production Pages project's branch-control and variable screens; restrict automatic deployments to `main` only and disable preview builds | Screenshot/readback proving previews are off **before** any `staging` branch exists. Closes Finding C-1 |
| **G2 — Branch model** | Create `staging` from `main`; protect `main` (no direct push, PR required, linear history); protect `staging` | `staging` exists at the same tree as `main`; protections readable |
| **G3 — Lane-aware CI** | Give `web-build.yml`/`ui-gate.yml`/`typecheck.yml` explicit branch filters and per-lane env; add staging jobs; add a target selector + refusal gate to `apply-migration.yml` | A PR into `staging` is built with staging env; a PR into `main` with production env; proven by two runs. Closes W-1, W-2 |
| **G4 — De-hardcode the lane-specific values** | `VITE_CDN_HOST` and `VITE_SITE_ORIGIN` replace the 6 hardcoded `cdn.50mmretina.com` sites and the `index.html` origin; `functions/_seo.ts` reads `context.env`; generate `_headers` per lane like `_redirects` | `npm test` green; no non-test source file contains a lane-specific host |
| **G5 — Extend the isolation guard** | Add host rules and `functions/` scanning to `verify-bundle-isolation.mjs`; extend the mutation harness to cover every new rule | Mutation harness kills every new mutant; guard self-test green |
| **G6 — Close the production AMBER** | Set `ISOLATION_FORBIDDEN_REFS` + `ISOLATION_FORBIDDEN_HOSTS` on the production Pages project and in `web-build.yml` | A production build prints `ISOLATION-GUARD PASS … forbidden=[ztzutckwdhetphwghuzj,…] absent` with a non-empty list |
| **G7 — Staging Pages project** | Create it, branch `staging`, previews off, variables of §6, build command with the guard, custom domain `staging.50mmretina.com`; narrow the `seo-edge-injector` route if zone-wide | `staging.50mmretina.com` serves a build whose guard printed the staging ref expected and production forbidden. Closes C-2 |
| **G8 — Staging R2** | (optionally recreate `50mm-staging` in APAC); create an R2 API token **scoped to that bucket only**; attach `cdn-staging.50mmretina.com`; write `s3_storage_settings` into the **staging** DB only | An upload on staging lands in `50mm-staging` and is readable at `cdn-staging.…`; production bucket object count unchanged |
| **G9 — Staging Supabase functions + synthetic data** | Deploy the 74 edge functions to staging with `--project-ref ztzutckwdhetphwghuzj`; set staging-only secrets; seed synthetic accounts/data | Staging login works with a synthetic account; no production row present; production `auth.users` still 101 |
| **G10 — Promotion mechanism** | Approval tag convention + tree-hash equality gate + deployment-ID record | A dry-run promotion of a no-op commit passes the tree gate and deploys production |

---

## OPEN UNKNOWNS — must be read from a dashboard before G1 can close

This session has no browser and the Cloudflare MCP has no Pages tool. These
cannot be answered from here and must not be guessed:

1. Production Pages project **name**, production branch, **preview deployment
   setting**, build command, output directory.
2. Existing Pages environment variables in **both** Production and Preview.
3. Whether `staging.50mmretina.com` already exists in DNS.
4. The `seo-edge-injector` Worker's **route pattern**.
5. Whether `50mm-staging` has any public access or custom domain today.

## REQUIRED FINAL BEHAVIOUR — how each requirement is met

| Requirement | Met by |
|---|---|
| Staging can be broken freely without affecting production | Separate Pages project, separate Supabase project, separate R2 bucket; `main` unreachable from `staging` without an `--ff-only` PR |
| Staging auth uses staging Supabase only | §6 variables + guard R2/R3 on the Supabase ref |
| Staging media uses staging R2 only | staging DB `site_settings` holds `50mm-staging` credentials; `VITE_CDN_HOST` points at `cdn-staging`; guard forbids the production CDN host |
| Staging Edge Functions use staging Supabase/secrets only | G9 deploys with `--project-ref`; staging secrets set independently |
| Staging build fails on production references | guard forbidden refs **and hosts**, extended to `functions/` |
| Production build fails on staging references | G6 — the currently-empty `ISOLATION_FORBIDDEN_REFS` is populated |
| No production data copied into staging | Gate 2 was schema-only and verified 0 rows; G8/G9 seed synthetic data only |
| Synthetic accounts used for testing | G9 |
| Production untouched until explicit promotion approval | G10 approval tag + tree-hash gate + protected `main` |

## RESUME CONTEXT FOR A FUTURE SESSION

- Repo is public. `git clone`/`git fetch` work from a Cowork session; **`git push`
  and the GitHub REST API do not** (`not in this session's authorized repository
  set`). Pushes must go through a Claude Code session started from
  `claude.ai/code` with the repository selected.
- Cloudflare MCP has **no Pages tool**; Pages work needs the dashboard or a
  browser-enabled session.
- Supabase MCP has full SQL on both projects and can deploy edge functions.
- Staging DB password was never set and is not needed: schema work is done
  through the Supabase MCP, and bulk SQL can be moved machine-to-machine by
  publishing a file to the public repo and fetching it from inside the database
  with `pg_net` (the method used in Gate 2; see that report).
- Prior related documents: `WEB_STAGING_PRODUCTION_ISOLATION_AUDIT_2026-08-21`,
  `WEB_STAGING_GATE1_EXECUTION_REPORT_2026-08-21`,
  `GATE2_STAGING_SCHEMA_BASELINE_APPLIED_2026-08-22`,
  `GATE2_A4_TRIGGER_MISMATCH_RESOLVED_2026-08-22`,
  `SESSION_CAPABILITY_AUDIT_2026-08-22`.

**STOPPED HERE AS INSTRUCTED. Awaiting architecture approval before G1.**
