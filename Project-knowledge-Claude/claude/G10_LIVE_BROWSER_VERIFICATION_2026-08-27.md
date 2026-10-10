# G10 — LIVE BROWSER VERIFICATION (owner-present session)

**Measured 2026-08-27, ~11:45–11:55Z, by direct observation in the owner's authenticated browser.**
Read-only: nothing was clicked that changes state. No secret value was read, copied or recorded.

## Three items previously recorded as PENDING are already DONE

### 1 · Cloudflare production Pages variables — **PRESENT AND CORRECT**

Project **`lens-lustre-learn-claude`** → Settings → Environment: **Production** → Variables and secrets.
**10 variables exist.** The three the candidate requires:

| Variable | Value observed | Verdict |
|---|---|---|
| `SITE_ORIGIN` | `https://www.50mmretina.com` | ✅ byte-exact match to `PRODUCTION_SITE_ORIGIN` in `scripts/lane-config.mjs` — **including the `www.`** |
| `SUPABASE_PROJECT_REF` | `jtdtehuqtinjxropkkcn` | ✅ production ref |
| `SUPABASE_ANON_KEY` | present (JWT; **value not recorded here**) | ✅ present, non-empty |

Also already wired: `ISOLATION_EXPECTED_HOST=cdn.50mmretina.com`,
`ISOLATION_FORBIDDEN_HOSTS=cdn-staging.50mmretina.com,staging.50mmretina.com`,
`ISOLATION_FORBIDDEN_REFS=ztzutckwdhetphwghuzj`, `NODE_VERSION=20`, plus the three `VITE_*` build values.

**Status: VERIFIED · Outcome: SATISFIED.** This closes **B-6.3 / OA-6**, and with B-6.1 and B-6.2 already
measured, **G5b has no remaining obstacle.**

**Also observed:** Build command is `npm run build && node scripts/verify-bundle-isolation.mjs` —
the isolation guard runs on **every production deploy**. Production branch: `main`. Git repo:
`altisinfonet/lens-lustre-learn-Claude`.

> ### CORRECTION — the project name in the execution pack is wrong
> The pack's OA-6 click-path names Pages project **`lens-lustre-learn`**. The real production project is
> **`lens-lustre-learn-claude`**. The old path returns **"Not found"**. Following the pack as written
> would have led the owner to a dead page.

### 2 · Branch protection on `main` (§14 HS-12) — **CONFIGURED AND ACTIVE**

Ruleset **`protect-main`** · Enforcement **Active** · Applies to **1 target: `main`** · **Bypass list empty.**
Three branch rules ticked, confirmed visually:

| Rule | State |
|---|---|
| **Require a pull request before merging** | ✅ enabled |
| **Block force pushes** | ✅ enabled |
| **Restrict deletions** | ✅ enabled |

HS-12 names the first two; the third is additional protection.

> **Classification question for the owner.** §17-7 classifies branch protection as OWNER-ATTESTED on the
> stated premise that it *"cannot be read by any session."* **In a browser-enabled session that premise
> does not hold — the configuration was read directly.** This report does not unilaterally override the
> governance document: the row is left OWNER-ATTESTED and the discrepancy is raised for the owner to rule on.

### 3 · GitHub Environments — **BOTH EXIST**

`staging` — 1 protection rule, **no secret shown** · `production` — 1 protection rule, **1 secret**.

**Consequence for N1:** the staging Environment appears to hold **no** `SUPABASE_DB_URL`. If confirmed,
the N1 procedure simplifies — the owner **adds** a decoy, runs the test, then **deletes** it. There is no
real value to restore, which removes the riskiest step of the original design.

## Instrument failure caught and discarded

The accessibility-tree tool (`find`) reported *"none of them are currently checked/enabled"* for all
13 ruleset checkboxes. **A screenshot showed three plainly ticked.** The tree reads the `checked`
attribute, which React-controlled inputs do not set. **The tool's answer was recorded as wrong and the
visual reading was used.** Had the tree been trusted, this report would have said branch protection was
unconfigured — a false negative that would have sent the owner to re-do completed work.

## Pattern across this session — stated plainly

Three separate items (**G5b code half**, **Pages variables**, **branch protection**) were carried as
outstanding on the strength of §19/§20 rows and prior session documents. **All three were already
complete.** Every one was corrected only by measuring. The governance document's OPEN rows record the
state *when they were written*, not current state, and this session's own earlier packs inherited that
staleness rather than testing it.

## What remains genuinely pending

| # | Item | Who | Why it cannot close here |
|---|---|---|---|
| 1 | **G8 R2 write-isolation test** — 4 commands + object counts | Owner, own machine | needs the staging R2 secret; handling it in any session fires §14 HS-10 |
| 2 | **§5.3 probe re-run immediately before promotion**, branch deleted after | Owner | §5.3.6 timing clause; probe branch `scratch/g10-53-secret-isolation-20260826` is still on the remote |
| 3 | **N1 lane-gate refusal transcript** | Owner | Environment secret administration |
| 4 | **§11 approval signed + tag created + tag resolving to `e2e05fbb…`** | Owner | tag count is 0; approval is a deliberate act |

**Promotion verdict: NOT READY — unchanged.** Three obstacles were removed by measurement rather than by
work, but none of the four gating proofs is satisfied.
