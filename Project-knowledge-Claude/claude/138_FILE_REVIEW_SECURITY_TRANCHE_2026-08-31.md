# §25.7.2 item 2 — the 138-file review. Security tranche, performed from source.

Issued 2026-08-31 by the compiler/audit session.
**Performed in this container against a working clone of `altisinfonet/lens-lustre-learn-Claude`**, not from any report, pack or summary. Every claim below carries the command that produced it.

Clone identity: `origin https://github.com/altisinfonet/lens-lustre-learn-Claude.git` · `git cat-file -t a42b209e` → `commit` · `git cat-file -t b671e1fb` → `commit`. Both endpoints present and readable.

**No commit, tag, push, merge, deployment, migration or provider write. Read-only throughout.**

---

## 1. Scope reconciled against the ledger — first independent confirmation

```
git diff --name-status b671e1fb a42b209e | wc -l        → 138
                                    ... | cut -f1        → 31 A, 107 M
git diff --shortstat b671e1fb a42b209e
     → 138 files changed, 9060 insertions(+), 1293 deletions(-)
```

Ledger §3.2(a) records **138 files — 31 added, 107 modified, 0 deleted** and **+9,060 / −1,293**.

**Exact match on every figure.** The ledger's own application-scope statement is now confirmed from the repository by a party that did not write it. Distribution by area:

| Area | Files | | Area | Files |
|---|---|---|---|---|
| `supabase/functions/` | **44** | | `src/lib/` | 9 |
| `src/components/` | **29** | | `.github/workflows/` | **8** |
| `src/__tests__/` | 11 | | `functions/` | 7 |
| `scripts/` | 10 | | `supabase/rollback/` | 5 |
| others (public, migrations, pages, docs, configs) | 15 | | | |

---

## 2. THE FINDING — verified end to end, from source, for the first time

Everything below was previously **INFERRED from other parties' reports**. It is now **VERIFIED** by direct reading.

### 2a. The credential is job-scoped, and the environment is chosen by the dispatcher

`.github/workflows/apply-migration.yml` at `a42b209e`:

```yaml
jobs:
  apply:
    environment: ${{ inputs.target }}          # line 91
    env:
      DB_URL: ${{ secrets.SUPABASE_DB_URL }}   # lines 92-93
```

`env:` is at **job level**. `DB_URL` is therefore present in the runner environment for **every step of the job**, including the first.

The file's own header, line 44: *"To enable, uncomment the `environment:` line in the job below."* — **on `main` that line is commented out; at the candidate it is live.** Confirmed by reading both.

### 2b. Which inputs can carry a payload — and which cannot

| Input | Type | Injectable |
|---|---|---|
| `target` | **`type: choice`**, options `staging` \| `production` | **NO** — cannot carry a payload |
| `migration` | **`type: string`**, free text | **YES** |
| `confirm` | **`type: string`**, free text | **YES** |

**This matters and narrows the finding correctly.** Every `'${{ inputs.target }}'` interpolation in this file — and there are six — is safe, because a `choice` input cannot be an arbitrary string. **The exposure is `migration` and `confirm` only.**

### 2c. The validation is downstream of the injection point, in the same step

The file contains the most careful-looking validation in the repository — an allowlist, a `..` refusal, an existence check, and a typed-twice confirmation:

```yaml
- name: Validate the requested file
  run: |
    set -euo pipefail
    FILE='${{ inputs.migration }}'        # line 174
    CONFIRM='${{ inputs.confirm }}'       # line 175
    if [ "$FILE" != "$CONFIRM" ]; then ... exit 1; fi
    case "$FILE" in
      supabase/migrations/*.sql|supabase/rollback/*.sql) : ;;
      *) ... exit 1 ;;
    esac
    case "$FILE" in *..*) ... exit 1 ;; esac
    if [ ! -f "$FILE" ]; then ... exit 1; fi
```

**GitHub Actions substitutes `${{ }}` into the script text before any shell runs.** A value containing a single quote closes the quote at **line 174** and the remainder executes as shell — **before line 176, and therefore before every check the step performs.**

**The validation does not fail to catch the payload. It never runs.** The allowlist, the traversal refusal, the existence test and the confirm-match all sit below the line that is already executing attacker text.

The same interpolation recurs in two later, separate steps — `cat '${{ inputs.migration }}'` (207) and `psql … -f '${{ inputs.migration }}'` (231) — each re-substituting the **raw** input rather than the validated `$FILE`. Each is an independent injection point.

### 2d. Why the merge is the enabling step — the chain, in order

| # | On `main` today | At the candidate |
|---|---|---|
| 1 | `environment:` commented out → no environment bound | `environment: ${{ inputs.target }}` live |
| 2 | `secrets.SUPABASE_DB_URL` is an **environment** secret → resolves **empty** | `target=production` binds the `production` environment → resolves |
| 3 | line 122 `if [ -z "$DB_URL" ]` → **exit 1** | passes |
| 4 | line 174 unreachable | lane gate passes when dispatched from `main` |
| 5 | — | **line 174 executes the payload, with `DB_URL` already in the environment** |

**On `main` the job dies at line 122, sixty lines before the injection point.** At the candidate it reaches it. **The merge is what moves the file to the only branch the `production` environment permits.**

And from my own console capture (2026-08-30T13:52:07Z): `production` has **required reviewers OFF, wait timer OFF, administrator bypass ON**. Nothing pauses it.

### 2e. Threat model — stated so it is not over-read

`workflow_dispatch` requires **write access to the repository**. This is **not** remotely exploitable by an anonymous party. The realistic actors are a collaborator, a compromised account, or a leaked token.

**That does not make it acceptable** — the whole purpose of the two-input confirmation and the allowlist is to make a *deliberate or mistaken* dispatch safe, and neither survives. But it must not be reported as internet-facing, and I am recording it as an authenticated-actor finding.

---

## 3. F-47 — a second instance of the construct, and it is NOT in the fix set. **Latent, not live.**

`.github/workflows/web-build.yml` (+157/−13, **inside the 138**) introduces a `lane-guard` job that does not exist on `main`:

```yaml
run: |
  BASE='${{ github.base_ref }}'
  REF='${{ github.ref_name }}'
  EVENT='${{ github.event_name }}'
```

Same construct. **And `web-build.yml` is not among the three files the Option 2 patch changes.**

**But it is not currently exploitable, and I checked before saying so:**

```yaml
on:
  push:         branches: [main, staging]
  pull_request: branches: [main, staging]
permissions:
  contents: read
```

- On **push**, the triggers admit only `main` and `staging` — so `github.ref_name` is one of those two literals.
- On **pull_request**, `github.base_ref` is the target branch (`main`/`staging`) and `github.ref_name` is `<PR-number>/merge` — a number.
- Neither value can carry a payload **under the triggers as configured**.
- The job binds no environment, references no secret, and the workflow token is `contents: read`.

**Classification: LATENT. One trigger widening — a `branches: ['**']`, a `workflow_dispatch`, or a `pull_request_target` — makes it live.** Recorded as a hardening item for the post-promotion list, **not** as a merge blocker, and **not** as a reason to expand the Option 2 patch set.

*(Scan basis: every `run:` block in all eight workflows at `a42b209e` was examined for `${{ }}` interpolation. `health.yml`, `security.yml`, `typecheck.yml` and `ui-gate.yml` contain none. `android-build.yml` interpolates `secrets.ANDROID_*` into `env:` — the correct pattern — and `github.run_number` inside `$(( ))`, which is GitHub-generated and numeric.)*

---

## 4. Claims register — security tranche (37 of 138)

Every row is a **claim to be verified against source**, not a finding. Status is my own reading.

| # | Path | ± | Claim | Status |
|---|---|---|---|---|
| 1 | `.github/workflows/apply-migration.yml` | +75/−5 | Injectable via `inputs.migration`/`confirm`; validation downstream of injection; `environment:` live at candidate, commented on main; `DB_URL` job-scoped | **VERIFIED — §2** |
| 2 | `.github/workflows/verify-schema-dependencies.yml` | +108/−0 | New file; `run: node … '${{ inputs.source_dir }}'` — same construct, free-text input. Does not exist on `main`; the merge creates it | **VERIFIED** |
| 3 | `.github/workflows/web-build.yml` | +157/−13 | `lane-guard` job, same construct on `github.base_ref`/`ref_name`; **not reachable under configured triggers** | **VERIFIED — LATENT, F-47** |
| 4 | `.github/workflows/android-build.yml` | +10/−0 | Sole consumer of `secrets.ANDROID_*`; secrets via `env:`, not inline in `run:`; `github.run_number` in `$(( ))` is numeric | **VERIFIED — no injection** |
| 5–8 | `health.yml`, `security.yml`, `typecheck.yml`, `ui-gate.yml` | +5/−0, +7/−2, +5/−1, +6/−1 | No `${{ }}` interpolation inside any `run:` block | **VERIFIED — clean** |
| 9 | `functions/_seo.ts` | +64/−7 | Escaping fix; patched by Option 2 | RELAYED — patch verified by Developer 1, not re-read here |
| 10–15 | `functions/*/[slug].ts`, `[id].ts` | +3/−1 ×5, +3/−2 | Route handlers, small deltas | **NOT YET READ** |
| 16 | `functions/pages-runtime.d.ts` | +24/−0 | Type declarations only | **NOT YET READ** |
| 17 | `scripts/verify-schema-dependencies.mjs` | **+906/−0** | New; largest single file in the change set; consumes `source_dir` from the workflow above | **NOT YET READ — highest remaining priority** |
| 18 | `scripts/test-schema-dependencies.mjs` | +403/−0 | Its test | **NOT YET READ** |
| 19 | `scripts/test-isolation-guard.mjs` | +280/−3 | Isolation-guard tests | **NOT YET READ** |
| 20 | `scripts/test-seo-assets.mjs` | +274/−0 | SEO asset tests | **NOT YET READ** |
| 21 | `scripts/verify-bundle-isolation.mjs` | +193/−14 | Bundle isolation check | **NOT YET READ** |
| 22–26 | `scripts/generate-*.mjs`, `lane-config.mjs`, `health-check.mjs` | +125, +111, +73, +43/−10, +5/−10 | Build/lane helpers | **NOT YET READ** |
| 27 | `supabase/config.toml` | **+0/−6** | Six lines removed and nothing added — a deletion-only config change deserves an explicit statement of what was removed | **NOT YET READ — flagged** |
| 28–29 | `supabase/migrations/*.sql` | +95, +109 | `admin_user_lookup_by_email`; `ad_comment_ban_and_visibility_policies` (D-10, the AF-17 fix) | **NOT YET READ** |
| 30–34 | `supabase/rollback/*.sql` | +53, +50, +87, +66, +136 | Three carry the `UNAPPLIED_` prefix — deviation **D-1** | **NOT YET READ** |
| 35 | `.gitleaks.toml` | +38/−13 | The AF-19 fix — allowlist extended to both lanes | **NOT YET READ** |
| 36–37 | `vite.config.ts`, `vitest.config.ts` | +8/−0, +6/−0 | Build/test config | **NOT YET READ** |

**Remaining: 101 files** — 44 `supabase/functions/`, 29 `src/components/`, 11 `src/__tests__/`, 9 `src/lib/`, and 8 others.

---

## 5. What this review is, and what it is not

**It is:** the first pass of §25.7.2 item 2, performed against the repository rather than against anyone's report. It confirms the ledger's own scope figures exactly, and it converts the central merge finding from INFERRED to VERIFIED with the mechanism read line by line.

**It is not:** complete — 101 of 138 files are unread — and it is not closure. **§25.4 is the owner's own rule: *"No row below may be marked closed by the compiler. The compiler is not a second party."*** Nothing here closes anything. It is evidence for whoever rules.

**Two corrections to earlier statements of mine, arising from reading the source:**

- I have described `apply-migration.yml` as carrying "an unescaped shell construct." **More precisely: the construct is single-quoted, and single quotes are what make it exploitable by an embedded apostrophe.** "Unescaped" understates it — the quoting is present and is the vector.
- I have not previously distinguished `inputs.target` (a `choice`, safe) from `inputs.migration`/`confirm` (free text, injectable). **Six of the interpolations in that file are not exposures.** The finding is narrower and sharper than I had stated it.
