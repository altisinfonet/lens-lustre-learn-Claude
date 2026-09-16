# G6 VERIFICATION · G3 §5.3 CARD — 2026-08-22

**Governing plan:** Master Execution Plan **Rev 3.0** (47pp DOCX, 2026-08-22).
**Rev 3.1 does not exist** in this project or in anything this session produced.
Nothing below was executed against a Rev 3.1 clause; if a 3.1 exists elsewhere,
this record must be re-read against it before G6 is closed.

**Session capability re-tested at 17:14 UTC, not assumed:**
`git push --dry-run` → `403 … not in this session's authorized repository set`.
Fetch works, push does not. Consequence: **item 2 (§5.3) could not be executed
here.** The card in §3 is issued instead.

---

## 1. G6 — REMAINING VERIFICATION

**No change was made to the guard, the workflows, or any lane configuration.**
Working tree at `9aea8a30916fee06a741c52ef34914e4a2788f96`, clean.

### 1.1 Instrument

A **real production-lane build** produced in this session with the production
job's own public environment values, read verbatim from
`.github/workflows/web-build.yml` lines 72–93 of that commit. No secret is
involved in a build lane. No deployment. No production data touched.

```
dist/index.html present · 244 JS chunks · 263 assets scanned
dist digest (sorted set)  b496154f9f5b4b9fd34388b06bfa27b15c77ec8809dcc478906bef1577a6b7ed
dist/_headers sha256      40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0
```

The `_headers` hash is **byte-identical to the recorded production artifact**
(Appendix B of the plan). That is an independent corroboration of G4, obtained
from a build this session performed rather than from a prior report.

### 1.2 Results

| ID | Test | Expected | Observed | Verdict |
|---|---|---|---|---|
| P-1 | Production lane vs its own clean bundle | PASS | `PASS: expected=jtdtehuqtinjxropkkcn present; forbidden=[ztzutckwdhetphwghuzj] absent; host=cdn.50mmretina.com present; forbidden-hosts=[…] absent; 263 assets scanned` | ✅ known-present control |
| **N-PROD-1** | **Production bundle carrying a staging ref** | **FAIL R3** | `FAIL [R3]: forbidden backend ref(s) present in bundle: ztzutckwdhetphwghuzj in /tmp/g6/index.html` · exit 1 | ✅ **the missing G6 test** |
| N-PROD-2 | Production lane, forbidden list blanked | FAIL R6 | `FAIL [R6]: ISOLATION_FORBIDDEN_REFS is empty — a lane that forbids nothing is not isolated…` · exit 1 | ✅ |
| N-PROD-3 | Production bundle + a ref belonging to **neither** lane | PASS | `PASS … 263 assets scanned` · exit 0 | ✅ **known-absent control** |
| N-PROD-4 | Production bundle + a staging **host** only | FAIL R8 | `FAIL [R8]: forbidden host(s) present: cdn-staging.50mmretina.com in index.html; staging.50mmretina.com in index.html` · exit 1 | ✅ |
| N-STG-1 | Staging lane guard vs the real production bundle | FAIL R3 | `FAIL [R3]: jtdtehuqtinjxropkkcn in dist/_redirects, assets/AdminSEO-BXdN_0Lh.js, assets/JudgePanel-Duz2PlJV.js, assets/Unsubscribe-PSRGhf8c.js, assets/index-BzKbxo1m.js` | ✅ staging direction preserved |

**N-PROD-3 is why N-PROD-1 is evidence.** Both bundles were the same production
build with one appended HTML comment; only the ref inside the comment differed.
The refusal is therefore caused by the staging ref, not by the act of editing
`index.html` (§5.1, Rule 1).

**R6 evidence preserved.** The executed R6 proof remains in history as the
`ec1a3b9` / `44e3e92` pair on `staging` and is re-confirmed by N-PROD-2 and by
harness cases RED-7 / RED-8.

**Harness re-run at 17:15 UTC on this tree: 12/12 mutants held, 33 results, 0 failures.**

### 1.3 CI literal — read directly

`.github/workflows/web-build.yml` @ `9aea8a3`, job `build-production`:

```
ISOLATION_FORBIDDEN_REFS: ztzutckwdhetphwghuzj
ISOLATION_EXPECTED_HOST:  cdn.50mmretina.com
ISOLATION_FORBIDDEN_HOSTS: cdn-staging.50mmretina.com,staging.50mmretina.com
```

### 1.4 COULD-NOT-VERIFY — the Pages half

The production Cloudflare Pages variable `ISOLATION_FORBIDDEN_REFS` **cannot be
read by this session.** The Cloudflare tooling available here covers D1, KV, R2,
Workers, Hyperdrive and documentation search — **there is no Pages project or
Pages environment-variable tool.** Pages build logs are equally unreadable.

No indirect probe discriminates: the production site being up is consistent with
the variable holding the staging ref, holding something else, or the guard never
having run at that value. Under §5.1 that is signal saturation, so **no claim is
made either way.**

This half stays **OWNER-ATTESTED** and is the sole reason G6 is not GREEN.

### 1.5 Discrepancy recorded, not resolved by assumption

The G5a report gives the staging-vs-production cross as firing R3 in **three**
files. The same cross, run here on a build with **identical asset hashes**
(`AdminSEO-BXdN_0Lh.js`, `JudgePanel-Duz2PlJV.js`), names **five** —
additionally `Unsubscribe-PSRGhf8c.js` and `index-BzKbxo1m.js`. Same tree, same
output; the difference is in the reporting, not in the artifact. Recorded so a
later reader does not treat "three" as the guard's actual output.

### 1.6 G6 verdict

**AMBER.** Every mechanically verifiable exit condition is now met by executed
negative tests in both directions. The Pages variable is owner-attested and
unreadable here, so GREEN would be a casual PASS.

**To reach GREEN, one observation is needed and only the owner can take it:**
the next production Pages deploy log line must read
`forbidden=[ztzutckwdhetphwghuzj]`, captured and recorded.

---

## 2. CHANGE LEDGER

| Field | CHG-20260822-001 |
|---|---|
| Date / time | 2026-08-22 17:10–17:15 UTC |
| Gate | G6 |
| Actor | CLAUDE (Cowork session) |
| Objects touched | **None in the repository.** Ephemeral build output and three throwaway `/tmp` copies, all local |
| Classification | VERIFICATION-ONLY |
| Originating finding | Plan §8.4 — production-lane cross-reference negative test outstanding |
| Evidence | §1.2 of this record, six executed tests with raw output and exit codes |
| Environment impact | §16 row "GitHub Actions workflow files" — **read only**. No production surface |
| Superseded by | — |

| Field | CHG-20260822-002 |
|---|---|
| Date / time | 2026-08-22 17:14 UTC |
| Gate | G3 |
| Actor | CLAUDE (Cowork session) |
| Objects touched | None |
| Classification | CAPABILITY-BOUNDARY |
| Originating finding | §5.3 requires a push; this session is refused at the git proxy (403) |
| Evidence | `git push --dry-run` transcript, §0 above |
| Environment impact | None |
| Superseded by | Closes when the card in §3 is executed |

---

## 3. CARD — G3 §5.3 SECRET-ISOLATION NEGATIVE TEST

**For a session that holds push rights. Not executable from Cowork.**

### 3.1 `scratch/lane-check-g3` is NOT a valid mechanism — verified, not assumed

Read at `b72819aff7e291129e96512ca7f5795cff1c8f0f`:

- Its **only** difference from `staging` is a trailing HTML comment appended to
  `.github/workflows/typecheck.yml`.
- No workflow on it references `secrets.SUPABASE_DB_URL` as a probe.
- Every workflow on it is branch-filtered to `[main, staging]`, so **a push to a
  `scratch/*` branch triggers nothing at all.**

It was a lane-resolution check. It cannot serve as the secret-isolation probe.
A new throwaway branch is required.

### 3.2 Procedure

1. Branch from `staging`, outside both lanes: `scratch/secret-isolation-<date>`.
2. Add **one** workflow, `.github/workflows/secret-probe.yml`, triggered on push
   to that exact branch — not on `[main, staging]`, or it will not fire:

```yaml
name: Secret isolation probe
on:
  push:
    branches: ['scratch/secret-isolation-*']
permissions:
  contents: read
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - name: The production DB reference must resolve to nothing here
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          set -euo pipefail
          if [ -z "${DB_URL:-}" ]; then
            echo "RESULT: SUPABASE_DB_URL resolved EMPTY on ${GITHUB_REF_NAME} — PASS"
          else
            echo "::error::RESULT: SUPABASE_DB_URL RESOLVED ON A NON-LANE BRANCH — FAIL"
            exit 1
          fi
```

**The job declares no `environment:`.** That is the point: the secret must be
reachable only through an environment whose deployment-branch policy excludes
this branch. Adding `environment:` would defeat the test.

3. Push. Observe the run.
4. Record: **run ID · UTC timestamp · the literal log line · the job conclusion.**
5. Delete the branch. If branch deletion 403s from that session, hand it to the
   owner and record it as an open cleanup item — do not leave it undocumented.

### 3.3 Prohibited in this test

- Never print `DB_URL`, its length, a hash of it, a prefix, or any
  secret-derived value. The only permitted outputs are the two literal strings
  above and the exit code.
- Never add `continue-on-error`. A non-empty result must fail the job.
- Do not run this on `main` or `staging`. On a lane branch the secret is
  *supposed* to resolve, and a PASS there would mean the opposite of what it looks like.

### 3.4 Interpretation

- **EMPTY** → G3's last exit condition is met. G3 moves AMBER → GREEN, with
  environment creation and repository-secret deletion still classed
  OWNER-ATTESTED.
- **NON-EMPTY** → a repository-level copy still exists or an environment policy
  is wrong. That is **HS-1 class**: stop, do not work around it.

**This evidence is not inheritable.** §12.4 step 7 requires it re-taken for the
Release Candidate regardless of today's outcome.

---

## 4. OWNER ACTIONS STILL REQUIRED

| # | Action | Blocks | Observed status |
|---|---|---|---|
| 1 | DNS for `staging.50mmretina.com` and `cdn-staging.50mmretina.com` | **G7, G8, G9 and the entire §15 testing matrix** | Both NXDOMAIN at 2026-08-22 16:50 UTC. Critical path |
| 2 | Production Pages `SUPABASE_PROJECT_REF` + `SUPABASE_ANON_KEY` | G5b — `functions/_seo.ts` defaults cannot be removed before this | Not present. Current Pages production variables per the G5a report: `ISOLATION_FORBIDDEN_REFS`, `NODE_VERSION`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` — owner-attested |
| 3 | Branch protection on `main` | **G10 — hard stop HS-12** | Never configured. No tool for it in any session |
| 4 | Capture the next production Pages deploy log line `forbidden=[…]` | **G6 GREEN** | Not readable here (§1.4) |
| 5 | Authorize a push-capable session for §3, and delete the probe branch after | G3 AMBER → GREEN | 403 confirmed 17:14 UTC |
| 6 | Delete `scratch/lane-check-g3`, close PR #88 | Nothing | Still present |

---

## 5. RESULTING GATE STATUS

| Gate | Before | After | Basis |
|---|---|---|---|
| G3 | AMBER | **AMBER — unchanged** | §5.3 not executable here; card issued |
| G5a | GREEN | GREEN | Re-confirmed: 12/12 mutants, 263 assets, `_headers` byte-identical |
| **G6** | PARTIAL | **AMBER** | Both cross-lane directions now proven by executed refusals with a discriminating control. Pages variable owner-attested and unreadable — the only thing between AMBER and GREEN |
| G5b, G7, G8, G9, G10 | OPEN | **OPEN — not attempted** | Prerequisites unsatisfied |

`origin/main` unchanged at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`.
No production deployment. No production data mutation. Nothing pushed.
