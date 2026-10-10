# §25.3 console captures — rows 1.4, 1.5, 1.6b, 1.6c

Captured: 2026-08-30, by the compiler/audit session driving the owner's Chrome, read-only.
Account: **Altis Infonet Private …** · Cloudflare account `a7810011a99de537a210130f86306785` · repo `altisinfonet/lens-lustre-learn-Claude`

## Governance status of this document — read first

**I produced this evidence, therefore I do not audit it.** Under §25.4, compiler re-measurement is **OWNER-ATTESTED** and **cannot close a §25 row**. These four rows are closed only by the independent human auditor, working from the captures below and the saved screenshots.

**Safety record for the session:** no secret, token, key or credential *value* was viewed or captured — names, scopes and configuration states only. Nothing was created, edited, saved, rolled, deleted or purchased. No `Save protection rules` button was clicked. No plan was purchased. No repository, ledger or provider state changed.

---

## ROW 1.4 — Cloudflare R2 API token scopes · **CAPTURED**

Source: Cloudflare → R2 Object Storage → API tokens.

**Account API Tokens (1)**

| Token name | Applied to | Permission | Issued on | Status |
|---|---|---|---|---|
| `staging-upload` | `50mm-staging` | Object Read & Write | Aug 24, 2026 | Active |

**User API Tokens (2)**

| Token name | Applied to | Permission | Issued on | Status |
|---|---|---|---|---|
| `50mm` | **`50mm`** (production) | Object Read & Write | Mar 7, 2026 | Active |
| `AgentCRM` | `agentcrm` | Object Read & Write | Dec 11, 2025 | Active |

**Positive finding.** No token spans both `50mm` and `50mm-staging`. **Bucket-level lane separation holds at the token layer.** This is the first independently observed evidence that any part of the lane model is actually enforced in provider configuration.

**Finding 1.4-a — the token classes are inverted.** Cloudflare's own text on that page says Account API tokens "remain active even when you leave the organization, making them ideal for production systems (recommended)", and User API tokens "become inactive if you leave the organization, making them ideal for personal access or development work."

**Staging runs on an Account token. Production runs on a User token.** That is backwards from the vendor's own guidance: the production bucket's read/write credential is tied to one person's user account.

**Finding 1.4-b.** The production token carries **Object Read & Write**, not read-only.

**Finding 1.4-c — incidental, outside this row.** The profile-level token list holds **11** User API tokens (mostly `Argo Tunnel API Token for altisinfonet.in`, several never used), plus an active **Global API Key** — the highest-privilege, entirely unscoped Cloudflare credential. Not part of row 1.4; recorded so it is not lost.

---

## ROW 1.5 — GitHub `staging` environment and its secrets · **CAPTURED**

Source: GitHub → repo → Settings → Environments.

### `staging` — environment id `20410299078`

| Setting | State |
|---|---|
| Required reviewers | **OFF** (unchecked) |
| Wait timer | **OFF** (unchecked) |
| Custom rules via GitHub Apps | not configured |
| Allow administrators to bypass configured protection rules | **ON** (checked) |
| Deployment branches and tags | Selected — **1 branch, 0 tags**: `staging` |
| Environment secrets | **"This environment has no secrets."** |
| Environment variables | **"This environment has no variables."** |

### `production` — environment id `20410256671`

| Setting | State |
|---|---|
| Required reviewers | **OFF** (unchecked) |
| Wait timer | **OFF** (unchecked) |
| Allow administrators to bypass configured protection rules | **ON** (checked) |
| Deployment branches and tags | Selected — **1 branch, 0 tags**: **`main`** |
| Environment secrets | **`SUPABASE_DB_URL`** (name only — value never displayed or requested) |
| Environment variables | none |

### Finding 1.5-a — **the injection risk moves from INFERRED to VERIFIED**

Until now, "merging arms the shell injection" rested on reading the two workflow files. The environment configuration now proves the mechanism independently:

- the `production` environment's **only** permitted deployment branch is **`main`**;
- the `production` environment's **only** secret is **`SUPABASE_DB_URL`**;
- `apply-migration.yml` and `verify-schema-dependencies.yml` are inside the 138-file promotion scope.

Therefore **placing those files on `main` is exactly and only what makes them able to execute against the `production` environment and read `SUPABASE_DB_URL`.** The merge is the enabling step. This is now measured from provider configuration, not inferred from source.

### Finding 1.5-b — **no human gate on production**

Required reviewers **off** and wait timer **off** on `production`. Nothing pauses a production deployment for approval. Combined with 1.5-a, a successful injection reaches the production database URL with no human in the path.

### Finding 1.5-c — **administrator bypass is enabled on both environments**

Even the branch restriction — the one control that is configured — is bypassable by an administrator.

### Finding 1.5-d — **staging holds no environment secrets, so environment-level lane isolation is partial**

`staging` has zero environment secrets and zero variables. Whatever credentials staging workflows use therefore come from **repository-level** secrets, which are not environment-scoped. Environment isolation protects `SUPABASE_DB_URL` and nothing else.

**Open, not captured:** the repository-level secret list (Settings → Secrets and variables → Actions). I did not open it. It should be captured — **names only** — to complete this row.

---

## ROW 1.6b — R2 `isolation-probe/` prefix · **CAPTURED — 0 and 0**

Source: Cloudflare → R2 → bucket → Objects → "Search objects by prefix" = `isolation-probe/`.

| Bucket | Result | Object count |
|---|---|---|
| `50mm` (production) | "No objects matched your search." | **0** |
| `50mm-staging` | "No objects matched your search." | **0** |

**Row 1.6b answers as expected: zero probe objects in either bucket.**

**Incidental, outside this row but material.** Both buckets report **Public Access: Enabled**. Production `50mm` = 1.15 GB, 1.06k Class A / 40.47k Class B operations; staging `50mm-staging` = 178.37 MB, 190 Class A / 1.11k Class B. Production root prefixes seen: `avatars/`, `competition-photos/`, `course-images/`, `journal-images/`, `national-ids/`, … (listing not exhausted). A bucket named `national-ids/` under public access warrants its own look, separately from this release.

---

## ROW 1.6c — Cloudflare Zero Trust / Access policies for `staging.50mmretina.com` · **CAPTURED**

Source: Cloudflare One → Access controls → Applications / Policies.

- **Applications page:** shows "Finish your account setup — You need an active plan to continue." No Zero Trust plan is active. *(No plan was purchased. The "Choose a plan" button was not clicked.)*
- **Reusable policies:** **0** — empty-state onboarding card only.
- **Legacy policies:** **exactly 1.**

### The single Access policy

| Field | Value |
|---|---|
| Policy name | `Allow Members - Cloudflare Pages` (Legacy) |
| Policy ID | `6f38b454-64f3-4cd9-9518-9f0142c3babd` |
| Action | **Allow** |
| Total rules | 1 — Include → Emails → `mail@altisinfonet.com` |
| Used by applications | 1 |
| Session duration | same as application session timeout |
| Created / last updated | August 22, 2026 · 02:51 PM |
| Multi-factor authentication | **Off** |
| Isolate application / Purpose justification / Temporary authentication | Off / Off / Off |

### The single application it protects

| Application name | Application URL | Type |
|---|---|---|
| `lens-lustre-learn-claude - Cloudflare Pages` | **`*.lens-lustre-learn-claude.pages.dev`** | Self-hosted |

### Finding 1.6c-a — **the row's answer: no Access policy covers `staging.50mmretina.com`**

The one Access application covers the Cloudflare Pages wildcard `*.lens-lustre-learn-claude.pages.dev`. **The staging hostname itself is not behind Cloudflare Access.** Whatever protects `staging.50mmretina.com`, it is not Access.

### Finding 1.6c-b — **two Cloudflare screens contradict each other, and the wrong one is the default**

The **Applications** page shows a plan paywall, which reads as "nothing is configured." The **Legacy policies** tab shows a live application in use. Both are true: the account has no current Zero Trust plan, yet a legacy Access application from August 22, 2026 remains configured and in use.

**Anyone repeating this check must open the Legacy policies tab.** Stopping at the paywalled Applications page yields the confident, wrong answer "there are no Access applications." I nearly recorded that and caught it only by checking the legacy tab.

---

## What these four rows change

| Row | Before | After |
|---|---|---|
| 1.4 | BLOCKED, no access | **Captured** — lane separation holds; token classes inverted |
| 1.5 | BLOCKED, no access | **Captured** — and it turns the injection finding from INFERRED to VERIFIED |
| 1.6b | BLOCKED, no access | **Captured** — 0 and 0 |
| 1.6c | BLOCKED, no access | **Captured** — no Access policy covers staging |

**None of these four is closed.** §25.4 stands: only the independent human auditor closes a §25 row. They are now *capturable* rather than *blocked*, which is what four weeks of compiler passes could not achieve, because the gap was access, not effort.

## Immediate next steps

1. Send this document plus the saved screenshots to the independent auditor for closure of 1.4, 1.5, 1.6b, 1.6c.
2. Capture the **repository-level secret names** (Settings → Secrets and variables → Actions) to complete row 1.5. Names only.
3. Finding 1.5-a is now the strongest single piece of evidence against merging the current RC, and it should be cited in the §11 packet in place of the earlier inference from workflow source.
4. Findings 1.4-a, 1.4-c, 1.5-b, 1.5-c, 1.6c-a and the public-access observation on `national-ids/` are **production-hygiene items, not release items.** They belong on the C-14-L track and must not be used to delay or to justify the promotion.
