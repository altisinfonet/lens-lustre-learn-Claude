# G3 — GREEN, COMPLETE · HS-1 (secret scope) RESOLVED

**2026-08-23, ~02:55 UTC.** Rev 3.0 §8.1 + §5.3, Erratum E-1.
`origin/main` `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` — unchanged.
`origin/staging` `9aea8a30916fee06a741c52ef34914e4a2788f96` — unchanged.

---

## 1. WHAT CHANGED (owner-executed)

| Action | Result |
|---|---|
| Created GitHub Environment `production` | Deployment branches: **Selected → `main`** only |
| Created GitHub Environment `staging` | Deployment branches: **Selected → `staging`** only |
| Added `SUPABASE_DB_URL` as an **environment secret** on `production` | Present, owner-read |
| **Deleted** repository-level `SUPABASE_DB_URL` | Repository secrets reduced to four `ANDROID_*` entries |
| `ANDROID_*` secrets | **Deliberately untouched** — see §5 |

The credential never entered any AI session in any form. Both assisting agents
declined to handle it or to perform the deletion; the owner did both steps.

---

## 2. THE CONTROLLED EXPERIMENT

Two runs of the **same probe, at the same commit**, with exactly one variable
between them: the scope of the secret.

| | Run #1 | Run #2 |
|---|---|---|
| Run ID | `32592710546` | `32613930242` |
| Branch | `scratch/secret-isolation-20260822` | `scratch/secret-isolation-retest` |
| Commit | `3b58a8ab588ae49d9665a54fd32845798d423c7f` | **same commit** |
| Secret scope at run time | repository-level | environment-scoped, `main`-only |
| Runner env echo | `DB_URL: ***` (mask ⇒ non-empty) | `DB_URL:` (no mask ⇒ empty) |
| RESULT line | `RESOLVED ON A NON-LANE BRANCH - FAIL` | `resolved EMPTY on scratch/secret-isolation-retest - PASS` |
| Conclusion | **failure** | **success** |

**Run #1 is the negative control**, and it is what makes run #2 worth anything.
A test that can only pass proves nothing.

### Independent verification performed by this session

Not accepted on report. Each item re-derived:

- **Both branches resolve to the identical commit** `3b58a8ab…` — confirmed by
  `git ls-remote`.
- **The workflow file is byte-identical on both branches** — sha256
  `bfae3e5bc604c3f40bfd9d2197713b3439e2a0adf35a50070c84f54e838c05be` on each.
  The workflow was not edited between runs.
- **No `environment:` key and no `continue-on-error`** on the retest branch —
  confirmed by grep against the file read from the remote. The absence of that
  key IS the test; its presence would have produced a false pass.
- **Run `32613930242` confirmed on the public Actions page**: workflow
  *"Secret isolation probe"*, branch `scratch/secret-isolation-retest`, commit
  `3b58a8a`, conclusion **Success**, job `probe` Success.
- **Lane SHAs re-read after the run** — both unchanged.

**The runner's mask token is the corroboration that matters.** GitHub emits
`***` before the user script runs, so it cannot be produced by the `-z` test.
Run #1 masked; run #2 did not. Both halves of the evidence — the runner's own
behaviour and the script's branch selection — agree.

Nothing derived from the secret was printed in either direction: no value, no
length, no hash, no prefix, no suffix.

**Classification: VERIFIED.**

---

## 3. G3 EXIT CONDITION — MET

Rev 3.0 §8.1's stated exit condition, item by item:

| Condition | Status |
|---|---|
| A push to `staging` runs the staging job only; a PR into `main` runs the production job only | **VERIFIED** at G5a — CI run `32584986264`, production job skipped on a staging push |
| The §5.3 negative test shows the production database reference resolving empty outside its lane | **VERIFIED** — run `32613930242`, with run `32592710546` as the negative control |
| Environments and deletion recorded as OWNER-ATTESTED | **Now stronger than attested.** The environments' existence and branch policy are *demonstrated functionally* by the probe's behaviour flip |

## **G3 = GREEN — COMPLETE.**

---

## 4. HS-1 (secret reachable from any branch) — RESOLVED

Declared 2026-08-22 ~19:10 UTC. Closed 2026-08-23 ~02:55 UTC.

The production database connection string is now reachable only through the
`production` environment, whose deployment-branch policy admits `main` alone. A
job on any other branch receives nothing — proven, not configured-and-assumed.

**This evidence is not inheritable.** Rev 3.0 §12.4 step 7 requires the §5.3
probe re-run immediately before G10, because a repository secret can be
re-added at any moment in between. Today's PASS closes G3; it does not
pre-approve the release.

---

## 5. CARRY-OVERS — named, not folded into the pass

### C1 — Four Android signing secrets remain repository-level

`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD` are still readable from every branch.

§8.1's *required state* lists them as belonging in the `production` environment.
They were left in place **deliberately and correctly**: `main`'s
`android-build.yml` declares **no `environment:` key**, so moving them would
break the signing build on the next push to `main`, and their values cannot be
recovered from GitHub.

- **Severity:** materially lower than the database credential. Exposure is
  bounded to actors who can already push to this repository — GitHub does not
  expose secrets to fork pull requests. Play App Signing is ON, so worst case is
  an upload-key reset, not a lost listing.
- **Unblock condition:** `environment: production` must exist on `main`'s
  `android-build.yml`. It exists on `staging` (line 397) and reaches `main` at
  G10. Only then can the four be moved and the repository copies deleted — and
  only with the original `.jks` and passwords in hand.

### C2 — `apply-migration.yml` on `main` cannot see the environment secret

`main` line 77 carries `# environment: production`, **commented out**. `staging`
line 91 carries `environment: ${{ inputs.target }}`.

Consequence: a **production** migration dispatched from `main` now resolves the
secret as empty and stops with the workflow's own clear error. It is
`workflow_dispatch` only — nothing automatic, nothing scheduled, no migration
pending. Fails safe.

**Fix:** uncomment that line on `main`. Arrives with G10, or via a one-line PR
if a migration is needed sooner.

### C3 — Documentation bug in `apply-migration.yml`

The header comment (line 30) instructs the reader to use the **direct**
connection form `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/…`,
which the workflow's own ref-assertion gate (line 155) then **refuses**,
demanding the pooler form `postgres://postgres.<ref>:…`. The file's instructions
contradict its own gate. Cosmetic, but it will cost someone an hour.

### C4 — Three scratch branches await deletion

`scratch/secret-isolation-20260822`, `scratch/secret-isolation-retest` (both at
`3b58a8a`, both carrying `secret-probe.yml`, which re-fires on any future
`scratch/secret-isolation-*` push), and `scratch/lane-check-g3` (`b72819a`,
with PR #88 attached — close the PR first).

Neither assisting session can delete refs: the code session is refused with
HTTP 403 at its git proxy; the browser agent declines hard deletes as a standing
limit. **Owner action.** Keep the probe branches until after G10's §12.4 step 7
re-test — they are the instrument.

---

## 6. CHANGE LEDGER

| Field | **CHG-20260823-001** |
|---|---|
| Change ID | CHG-20260823-001 |
| Paths affected | GitHub repository settings only. **No production surface, no DNS, no Cloudflare, no Supabase data, no R2** |
| Before | Repository secrets: 5, including `SUPABASE_DB_URL`. Environments: none |
| After | Repository secrets: 4 (`ANDROID_*` only). Environments: `production` (`main`-only, holds `SUPABASE_DB_URL`), `staging` (`staging`-only, no secrets) |
| Lane SHAs | `origin/main` and `origin/staging` **unchanged**, verified after the run |
| New refs | `scratch/secret-isolation-retest` @ `3b58a8a` — same commit as the existing probe branch |
| Reason | Rev 3.0 §8.1 required state; §5.3 exit condition; close HS-1 |
| Verification | §2 — same-commit controlled experiment, workflow digest equality, runner mask corroboration, public Actions page confirmation, lane SHA re-read |
| Rollback | Re-adding a repository-level `SUPABASE_DB_URL` would restore the prior state. **Not desirable** — that state is the defect |
| Classification | **VERIFIED** |

---

## 7. GATE STATUS

| Gate | State |
|---|---|
| G0, G1, G2, **G3**, G4, G5a, G6 | **GREEN — COMPLETE** |
| G5b | **BLOCKED** — needs `SUPABASE_PROJECT_REF` + `SUPABASE_ANON_KEY` on the Pages Production environment |
| G7, G8, G9, §15, RC | **BLOCKED** — HS-1 on `www` (Path B) still ACTIVE |
| G10 | **BLOCKED** — no branch protection on `main` (HS-12); plus §12.4 step 7 re-test required at release time |

**Seven of eleven gates now GREEN.** The remaining blockers are three owner
decisions: the Path B ruling, two Pages variables, and branch protection.
