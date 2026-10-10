# 🔴 HS-1 (second, independent) — PRODUCTION DB CREDENTIAL REACHABLE FROM ANY BRANCH

**Declared 2026-08-22, ~19:10 UTC.** Rev 3.0 §14 HS-1.
**G3 EXIT CONDITION FAILED — G3 is BLOCKED, and was never GREEN.**
No remediation performed. Nothing changed. `origin/main`
`32930e75b1d87d361f44e4b4f90dabf9deeda3e1` and `origin/staging`
`9aea8a30916fee06a741c52ef34914e4a2788f96` both unchanged after the run.

---

## 1. THE FINDING

`secrets.SUPABASE_DB_URL` — the **production database connection string** —
resolved to a non-empty value in a GitHub Actions job on
`scratch/secret-isolation-20260822`, a branch outside both lanes, in a job that
declares **no `environment:` key**.

The requirement in Rev 3.0 §8.1 is *"production secrets unavailable to staging
jobs, not merely unused by them."* **It is not met.** A repository-level (or
organization-level) secret is handed to every workflow job on every branch, with
no deployment-branch policy in the path.

---

## 2. EVIDENCE

### 2.1 Executed by the code session

| # | Item | Value |
|---|---|---|
| 1 | Branch | `scratch/secret-isolation-20260822` |
| 2 | Probe commit | `3b58a8ab588ae49d9665a54fd32845798d423c7f` |
| 3 | Run | ID `32592710546` |
| 4 | UTC | queued `19:06:03Z`, started `19:06:06Z`, completed `19:06:09Z` |
| 5 | Literal result | `##[error]RESULT: SUPABASE_DB_URL RESOLVED ON A NON-LANE BRANCH - FAIL` |
| 6 | Conclusion | `failure` — job `probe`, exit code 1 |
| 7 | Branch deletion | **REFUSED**, `HTTP 403` at the proxy. Branch still on the remote |
| 8 | Lane SHAs after | both unchanged |

Corroboration independent of the script's own echo: the runner printed
`Secret source: Actions` and rendered the step env as `DB_URL: ***`. GitHub emits
its mask token only for a secret that resolved to a **non-empty** value — an
unresolved secret renders empty, not masked. So the value was genuinely
delivered to the job. **Nothing derived from it was printed:** no value, no
length, no hash, no prefix, no suffix.

### 2.2 Verified independently by this session

The failure was **not** accepted on report. The probe itself was audited, because
a badly-built probe can fail for the wrong reason just as easily as it can pass.

**The workflow file was read from the remote, not from the report:**

```
git show origin/scratch/secret-isolation-20260822:.github/workflows/secret-probe.yml
```

- **No `environment:` key anywhere in the job.** Confirmed by reading the file. This
  is the whole test — an `environment:` key would hand the job the grant it is
  meant to prove is withheld.
- Trigger is `branches: ['scratch/secret-isolation-*']` only — not a lane branch.
- `permissions: contents: read`.
- No `continue-on-error`.
- `git diff --name-only origin/staging origin/scratch/…` returns **exactly one
  file**: the probe workflow. Nothing else was smuggled in.

**The run was confirmed on the public Actions page**, independently of the
report: workflow *"Secret isolation probe"*, branch
`scratch/secret-isolation-20260822`, commit `3b58a8a`, conclusion **Failure**,
job `probe` exit code 1.

**Classification: VERIFIED.** Both the probe's construction and its result.

---

## 3. WHY THIS MATTERS MORE THAN A FAILED CHECK

Rev 3.0 §8.1 records the repository-secret deletion as **OWNER-ATTESTED**, with
the note that *"Creating the environments without deleting the repository copies
changes nothing — repository secrets remain readable from every branch."*

**That attestation is now falsified by measurement.** The deletion either did not
happen, or the secret also exists at organization level, where the same
branch-wide reachability applies and deleting a repository copy would not help.

This is precisely the case the evidence-class system exists for. An
owner-attested control was carried for weeks as though it held. One executed
negative test disproved it in three seconds. **Every OWNER-ATTESTED item in this
plan should now be read as unproven rather than merely unverified.**

---

## 4. PROPORTIONATE ASSESSMENT — what this is, and what it is not

**It is a control failure. It is not evidence of compromise.**

- The value was never printed, logged or transmitted anywhere in this test.
- GitHub does **not** expose secrets to pull requests from forks, so the exposure
  is bounded to actors who can push a branch to this repository.
- A second, independent control still holds: `apply-migration.yml` carries the
  ref-assertion gate that parses the project ref out of the connection string and
  **refuses a lane mismatch without connecting** — proven in both directions.
  So even with the credential reachable, a cross-lane migration is still refused.

That is defence-in-depth working as designed. It does not excuse the missing
control; it bounds the blast radius while the control is restored.

**Rotation is an owner decision, not mine to make.** The credential has been
reachable from every branch for the repository's lifetime. Nothing indicates it
was read. Prudence favours rotation; necessity is not established. What *would*
make rotation clearly necessary: evidence of a workflow run, on any branch, that
echoed, uploaded, or transmitted the value.

---

## 5. REMEDIATION — OWNER-ONLY, NOT AUTHORIZED, NOT EXECUTED

1. **Find where `SUPABASE_DB_URL` actually lives.**
   Repository: Settings → Secrets and variables → Actions → **Repository secrets**.
   Organization: the same page's **Organization secrets** section.
   *If it is an org secret, deleting a repository copy fixes nothing.*
2. **Delete it from that scope.**
3. **Keep it only inside the `production` Environment**, whose deployment-branch
   policy is restricted to `main`. Add the staging equivalent to the `staging`
   Environment, restricted to `staging`.
4. **Re-run the probe.** Push any branch named `scratch/secret-isolation-*`; the
   workflow already exists on the probe branch. It must report
   `RESULT: SUPABASE_DB_URL resolved EMPTY … - PASS` and the job must succeed.
5. **Only then** is G3's exit condition met.

### Stranded artifacts needing delete rights

Neither this session nor the code session can delete a remote ref — both are
refused with `403`.

- `scratch/secret-isolation-20260822` @ `3b58a8a` — carries `secret-probe.yml`,
  which re-fires on any future `scratch/secret-isolation-*` push. Harmless in
  itself: it prints only the two literal result lines. **Keep it until step 4 is
  done — it is the re-test.** Delete after.
- `scratch/lane-check-g3` @ `b72819a` — spent since G3 §5.2. Delete any time.

---

## 6. GATE IMPACT

| Gate | State | Reason |
|---|---|---|
| G0, G1, G2, G4, G5a, **G6** | **GREEN — COMPLETE** | Unaffected |
| **G3** | **BLOCKED — EXIT CONDITION FAILED** | Not "AMBER", not "mostly done". §8.1's stated exit condition was executed and it failed |
| G5b | **BLOCKED** | Needs `SUPABASE_PROJECT_REF` + `SUPABASE_ANON_KEY` on Pages Production |
| G7, G8, G9, §15, RC | **BLOCKED** | HS-1 on `www` still active |
| **G10** | **BLOCKED — DOUBLY** | HS-12 (no branch protection on `main`) **and** §12.4 step 7, which requires this same probe to pass immediately before promotion. It currently fails |

---

## 7. CHANGE LEDGER

| Field | **CHG-20260822-016** |
|---|---|
| Change ID | CHG-20260822-016 |
| Branch | `scratch/secret-isolation-20260822` created by the code session; **no lane branch touched** |
| Before SHA / tree | `origin/main` `32930e75…`, `origin/staging` `9aea8a30…` |
| After SHA / tree | **Both identical.** One new scratch ref at `3b58a8ab588ae49d9665a54fd32845798d423c7f` |
| Files changed | One file added, on a scratch branch only: `.github/workflows/secret-probe.yml`. Verified by `git diff --name-only` against `origin/staging` |
| Reason | Rev 3.0 §5.3 — G3's final exit condition |
| Environment impact | §16: GitHub Actions only. No production surface, no deployment, no database, no Cloudflare, no R2 |
| Verification | §2.2 — workflow file read from the remote; run confirmed on the public Actions page; lane SHAs re-read |
| Rollback | Delete the scratch branch once step 4 of §5 is complete. No lane state to revert |
| Classification | **VERIFIED** |
| Outcome | **FAIL → HS-1 declared.** No remediation attempted, per E-1 clause 8 |
