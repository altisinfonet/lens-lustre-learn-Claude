# G3 PRECHECK — LANE-AWARE CI (read-only audit + design)

Date: 2026-08-22 · Scope: WEB STAGING only · **Nothing was changed.**
Repo state audited: `main` = `staging` = `32930e75…`, tree `a0c3f34d…` (identical).

# G3 PRECHECK = **AMBER**

The audit is complete and the design is fixed. AMBER because **one mandatory
requirement cannot be met by editing workflow files at all** — it needs a GitHub
configuration change only the owner can make (§5.1). Everything else is a code
change we can prepare and apply.

---

## 1. Complete trigger matrix — which workflows run for which lane

| Workflow | PR → `staging` | push → `staging` | PR → `main` | push → `main` | other |
|---|---|---|---|---|---|
| `web-build.yml` | **YES** ⚠ | no | YES | YES | — |
| `typecheck.yml` | **YES** ⚠ | no | YES | YES | — |
| `ui-gate.yml` | **YES** ⚠ | no | YES | YES | — |
| `security.yml` | no | no | YES | YES | dispatch |
| `health.yml` | no | no | no | no | cron `0 */2 * * *`, dispatch |
| `apply-migration.yml` | no | no | no | no | **dispatch, any ref** ⚠ |
| `android-build.yml` | no | no | no | YES (paths-filtered) | — |

The three ⚠ rows use a bare `pull_request:` with **no branch filter**, so they
already fire for pull requests targeting `staging` — which exists as of G2.

## 2. Secret inventory — measured, not assumed

| Workflow | Secrets referenced |
|---|---|
| `apply-migration.yml` | `SUPABASE_DB_URL` — **the production database** |
| `android-build.yml` | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON` |
| `security.yml` | `GITHUB_TOKEN` |
| `web-build.yml`, `ui-gate.yml`, `typecheck.yml`, `health.yml` | **none** |

Also measured:

- `environment:` declarations across all workflows: **NONE** (one commented-out
  `# environment: production` in `apply-migration.yml`)
- `permissions:` blocks: **NONE**
- `pull_request_target`: **NONE** — good, no fork-PR secret exposure
- R2 / S3 / AWS / Cloudflare credentials in any workflow: **NONE**

## 3. Findings

### F1 — HIGH — Production secrets are readable from every branch

Every secret above is a **repository-level** secret. GitHub exposes repository
secrets to any workflow run on **any branch** in the same repository. Nothing
today scopes `SUPABASE_DB_URL` — a connection string for the production database
as role `postgres`, which bypasses every RLS policy — to `main`.

Your requirement is *"production secrets unavailable to staging jobs, not merely
ignored by scripts."* **That is currently false, and no edit to a workflow file
can make it true.** The only mechanism GitHub provides for per-branch secret
scoping is **Environments with a deployment-branch policy**. See §5.1.

### F2 — HIGH — `apply-migration.yml` can be pointed at production from `staging`

`workflow_dispatch` lets the dispatcher choose **which ref to run from**. The
workflow exists identically on `staging` (0 diff lines). It has:

- no target selector — the database is whatever `secrets.SUPABASE_DB_URL` holds
- no assertion that the connected database is the intended one
- a good path allow-list and a double-typed confirmation (both genuinely well
  built, and both about *which file*, not *which database*)

So "run the migration on staging" is one dropdown away from executing against
production, and nothing in the run would say otherwise.

### F3 — HIGH — Lane inversion on pull requests into `staging`

`web-build.yml` builds with hardcoded production values and then asserts, via the
isolation guard, that the **production** ref is present in `dist`. A PR into
`staging` runs that job. The result: staging code validated as production, and a
green check that means the opposite of what it appears to mean.

### F4 — MEDIUM — The production CI lane has no leak check

`web-build.yml:75` sets `ISOLATION_FORBIDDEN_REFS: ""`. The guard's own output for
that case is `ISOLATION-GUARD WARN: ISOLATION_FORBIDDEN_REFS is empty — leak check
limited to R2.` Rule R3 never runs. The Cloudflare Pages Production variable was
set during the browser session, so **the deployed lane is guarded and the CI
mirror is not** — they disagree.

### F5 — MEDIUM — The guard can be silently disarmed

Because an empty forbidden list only **warns**, any future edit that blanks the
variable disables the leak check without failing anything. Your requirement *"no
workflow change can weaken the production guard"* needs this to be structural,
not conventional.

### F6 — MEDIUM — No `permissions:` block anywhere

Every workflow runs with the repository's default `GITHUB_TOKEN` scope. Least
privilege should be declared per workflow, especially now that a second
long-lived branch exists.

### F7 — INFO — `android-build.yml`

Builds with production Supabase (`android-build.yml:531-533`) and holds the
signing and Play secrets. Correctly limited to `push: [main]` **and** a paths
filter, so `staging` cannot trigger it. Its secrets are still repo-level (F1).

### F8 — INFO — `health.yml`

Targets production by a hardcoded URL in `scripts/health-check.mjs:65`. Correct
for a production monitor. No staging equivalent exists — deliberately out of G3.

### F9 — SCOPING CORRECTION — CI never touches R2

No workflow references R2, S3, AWS or Cloudflare credentials. R2 selection lives
entirely in the database, at `site_settings` key `s3_storage_settings`. **The
requirement "staging uses staging R2 configuration" has no CI surface at all** and
belongs to G8. Stating this now so G3 is not credited with an isolation it does
not provide.

### F10 — LOW — Dead `.env` fallback

`scripts/health-check.mjs:90` still reads `../.env` if the key is absent. Inert
since `.env` was removed, but it is a re-introduction path worth deleting.

## 4. Design

### 4.1 The lane rule

Lane is decided by **`github.base_ref` for pull requests and `github.ref_name`
for pushes** — never by a default. Any run that cannot resolve to exactly one
lane must fail, not guess.

### 4.2 Values per lane

Both lanes' web values are **public** (they ship in every browser bundle), so
they stay as workflow literals — no secret is required for the build lanes.

| | `main` lane | `staging` lane |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://jtdtehuqtinjxropkkcn.supabase.co` | `https://ztzutckwdhetphwghuzj.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `jtdtehuqtinjxropkkcn` | `ztzutckwdhetphwghuzj` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | production anon (already in repo) | staging anon (public) |
| `ISOLATION_FORBIDDEN_REFS` | `ztzutckwdhetphwghuzj` | `jtdtehuqtinjxropkkcn` |

Host-level forbidding (`cdn.50mmretina.com` etc.) is **not** in G3 — it requires
the guard and `_headers` changes scheduled for G4/G5.

## 5. Exact changes required

### 5.1 OWNER-ONLY — GitHub Environments (the part we cannot do)

The GitHub REST API returns `403` from both non-browser sessions
(`repos/…/branches/main/protection` and `…/rulesets` both re-tested this turn), so
this must be done in the browser.

1. **Settings → Environments → New environment: `production`**
   - Deployment branches: **Selected branches → `main`** only
   - Add secrets: `SUPABASE_DB_URL` (current production value),
     `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
     `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`
2. **Settings → Environments → New environment: `staging`**
   - Deployment branches: **Selected branches → `staging`** only
   - Secrets: none yet (`SUPABASE_DB_URL` for staging is added at G8/G9)
3. **Settings → Secrets and variables → Actions → delete the repository-level
   copies** of all six secrets above.

**Step 3 is the one that matters.** Until the repository-level copies are
deleted, they remain readable from every branch and F1 is unresolved. Adding
environments without removing the repo copies changes nothing.

### 5.2 Workflow and script changes

| # | File | Change |
|---|---|---|
| 1 | `.github/workflows/web-build.yml` | `on:` → `push: [main, staging]`, `pull_request: branches: [main, staging]`. Split into two jobs, `build-production` and `build-staging`, each guarded by an explicit `if:` on `base_ref`/`ref_name`, each with its own env block and its own `ISOLATION_FORBIDDEN_REFS`. Set the production lane's value to `ztzutckwdhetphwghuzj` (fixes F4). Add `permissions: contents: read`. |
| 2 | `.github/workflows/ui-gate.yml` | Add `branches: [main, staging]` to both triggers. Synthetic env is lane-agnostic; no credential change. Add `permissions`. |
| 3 | `.github/workflows/typecheck.yml` | Add `branches: [main, staging]` to both triggers. Add `permissions: contents: read`. |
| 4 | `.github/workflows/security.yml` | Add `staging` to both branch lists so staging code is scanned. Add explicit `permissions`. |
| 5 | `.github/workflows/apply-migration.yml` | Add required `target` input (`staging`\|`production`); add `environment: ${{ inputs.target }}`; add a **ref-assertion gate** that parses the project ref out of `DB_URL` and refuses unless it matches the target's expected ref; refuse if `github.ref_name` is not the matching lane branch. (fixes F2) |
| 6 | `.github/workflows/android-build.yml` | Add `environment: production` to the job so signing secrets resolve from the environment. Triggers unchanged. |
| 7 | `.github/workflows/health.yml` | Add `permissions: contents: read`. No target change — it is a production monitor by design. |
| 8 | `scripts/verify-bundle-isolation.mjs` | **New rule R6**: an empty `ISOLATION_FORBIDDEN_REFS` becomes a hard failure instead of a warning, unless `ISOLATION_ALLOW_NO_FORBIDDEN=1` is explicitly set. (fixes F5) |
| 9 | `scripts/test-isolation-guard.mjs` | Extend the mutation harness to cover R6 — a mutant that reverts R6 to a warning must be killed. Existing equivalent mutants are **retargeted, never deleted** (standing rule). |
| 10 | `scripts/health-check.mjs` | Delete the dead `.env` fallback. (fixes F10) |

### 5.3 The ref-assertion gate for migrations (the core of F2's fix)

A Supabase pooler connection string carries the project ref in its username
(`postgres.<ref>`). So the workflow can prove which database it is about to
write to, without printing the secret:

```
REF=$(printf '%s' "$DB_URL" | sed -E 's|^postgres(ql)?://([^:]+):.*|\2|' | cut -d. -f2)
case "${{ inputs.target }}" in
  production) EXPECT=jtdtehuqtinjxropkkcn ;;
  staging)    EXPECT=ztzutckwdhetphwghuzj ;;
esac
[ "$REF" = "$EXPECT" ] || { echo "::error::secret points at '$REF', target is '${{ inputs.target }}' — refusing"; exit 1; }
```

Two independent controls then have to fail together for a mistake to reach
production: the environment's branch policy, and this assertion.

## 6. What G3 explicitly does NOT deliver

- **R2 isolation** — no CI surface (F9). G8.
- **Host-level forbidden refs** (`cdn.50mmretina.com`) — needs the guard and
  per-lane `_headers` generation. G4/G5.
- **A staging health monitor** — G7 or later.
- **Deleting `tool/g2-ref-cleanup`** if it was created — housekeeping.

## 7. Verification plan for G3 (after authorization)

1. A PR into `staging` runs **only** `build-staging`, and its guard line reads
   `expected=ztzutckwdhetphwghuzj … forbidden=[jtdtehuqtinjxropkkcn] absent`.
2. A PR into `main` runs **only** `build-production`, guard line reads
   `expected=jtdtehuqtinjxropkkcn … forbidden=[ztzutckwdhetphwghuzj] absent`.
3. A deliberate mutation blanking `ISOLATION_FORBIDDEN_REFS` **fails** the build
   (R6), proving F5 is structurally closed.
4. `apply-migration.yml` dispatched with `target=staging` from ref `main` is
   **refused**, and vice versa.
5. After the repo-level secrets are deleted, a temporary throwaway workflow on a
   feature branch referencing `secrets.SUPABASE_DB_URL` resolves to **empty** —
   the direct proof that F1 is closed. (Run once, then delete the branch.)
6. `main` unchanged; production Supabase fingerprint unchanged; no deployment.

## 8. Precheck verdict

**AMBER.** The audit is complete and every change is specified. It is not GREEN
because F1 — the requirement you singled out — is unreachable from the
repository's files and depends on §5.1, which only you can perform. Items 1–10 of
§5.2 can be prepared and applied by the code session on `staging` first, and must
not be merged to `main` until the environments exist, or `android-build.yml` and
`apply-migration.yml` would reference environments that are not there.

**Recommended order:** §5.1 (owner) → §5.2 on `staging` → verification §7 →
only then promote to `main` under G10's tree-equality rule.

**STOPPED. No changes made. Awaiting authorization.**
