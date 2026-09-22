# G10 STEP 4.3 — SCOPE CORRECTION: ARMING THE WORKFLOW ALONE WOULD BE A FALSE GREEN

**2026-08-26. Pre-flight testing on candidate tree T = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`.
No change has been made to `main`. Nothing pushed.**

---

# THE FINDING

Runbook step 4.3 says: *"Arm the production-lane host rules. `main`'s `web-build.yml` currently sets
`ISOLATION_FORBIDDEN_REFS: ""` and no host variables, so the production lane's guard runs with host
rules DISARMED."*

**Following that literally — editing only `web-build.yml` — would record §17-4 as satisfied while no
host rule was ever evaluated.**

## Why: `main`'s guard script cannot read the host variables

Measured, per variable, by occurrence count in `scripts/verify-bundle-isolation.mjs`:

| Variable | `main`'s guard | T's guard |
|---|---|---|
| `ISOLATION_FORBIDDEN_REFS` | 4 | 5 |
| **`ISOLATION_EXPECTED_HOST`** | **0** | 5 |
| **`ISOLATION_FORBIDDEN_HOSTS`** | **0** | 6 |
| `ISOLATION_ALLOW_NO_FORBIDDEN` | **0** | 7 |
| **Script size** | **67 lines** | **246 lines** |

`main` runs a **67-line guard that has no concept of host rules at all**. Declaring
`ISOLATION_EXPECTED_HOST` and `ISOLATION_FORBIDDEN_HOSTS` in `main`'s workflow would set two
environment variables that the script **silently ignores**. The job would go green, the workflow would
*look* armed, and §17-4 — *"isolation guard passes on both lanes with host rules active"* — would be
recorded on evidence that never existed.

**This is the exact failure class the programme keeps catching: a control that reports success without
performing the check.**

---

# PRE-FLIGHT TEST ON T — both configurations, measured

A full production build was performed on T (`npm ci` + `npm run build`, 246 JS chunks emitted), then
the guard was run twice against that bundle:

### A · `main`'s current settings (disarmed)
```
exit = 1
ISOLATION-GUARD FAIL [R6]: ISOLATION_FORBIDDEN_REFS is empty — a lane that
forbids nothing is not isolated.
```

### B · the proposed armed settings
```
exit = 0
ISOLATION-GUARD PASS: expected=jtdtehuqtinjxropkkcn present;
forbidden=[ztzutckwdhetphwghuzj] absent; host=cdn.50mmretina.com present;
forbidden-hosts=[cdn-staging.50mmretina.com,staging.50mmretina.com] absent;
387 assets scanned across 3 root(s): dist, functions, supabase/functions;
6 line(s) exempted by isolation-allow:.
```

**The armed configuration passes on the candidate.** The values were cross-checked against three
independent sources that agree exactly: the Phase 0 production Pages variables, staging's armed
production-lane job, and the runbook.

> ⚠ Note that run A used **T's** guard. `main`'s 67-line guard has no R6 rule, which is why `main`'s CI
> passes today with an empty forbidden list — it is not checking, rather than checking and passing.

---

# CORRECTED SCOPE: STEP 4.3 CARRIES THREE FILES, ATOMICALLY

| File | `main` | T | Why it must travel |
|---|---|---|---|
| `.github/workflows/web-build.yml` | `35d5deb` | `75da28c` | Arms the host rules |
| `scripts/verify-bundle-isolation.mjs` | `8ef75fc` (67 lines) | `f53f79f` (246 lines) | **Without it the host variables are ignored** |
| `scripts/test-isolation-guard.mjs` | `0c15db0` (92 lines) | `cbae234` (369 lines) | §17-5 reads the mutants-held count from this harness; `main`'s is a different, much smaller file |

## They must land in ONE pull request

The three are coupled in both directions:

- **Script without workflow:** T's guard enforces R6 and **rejects an empty `ISOLATION_FORBIDDEN_REFS`**.
  Landing the script while `main` still sets `""` would **break `main`'s CI immediately**.
- **Workflow without script:** the false green described above.

**Split across two PRs, either order breaks something.** One atomic change is the only safe shape.

## No future conflict is created

`main`'s copies of all three files are unchanged since the merge base `32930e75`, so bringing T's
versions forward makes `main` match T for these paths. The Phase 8 promotion then takes them
trivially. Arming early does not diverge the lanes — it brings forward a change the promotion would
make anyway.

---

# RUNBOOK CORRECTION

**Step 4.3 as written names one file. It must name three.** Recorded here rather than silently
widened, consistent with how the decision-1.4 and step-2.2 corrections were handled.

The step's pass criterion should also change. *"The workflow declares the host variables"* is not
sufficient evidence — a run can declare them and not evaluate them. The criterion must be **the guard's
own PASS line naming `host=` and `forbidden-hosts=`**, as produced in run B above, read from the
production-lane job log.

---

# EVIDENCE RECORDED THIS STEP — carry forward to Phase 9

| Item | Value |
|---|---|
| Candidate tree T | `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` |
| Candidate commit | `b8535fe7c9f2c7f604347ba849ac579bf4946d23` |
| Production build on T | OK — `dist/index.html`, `dist/assets`, **246 JS chunks** |
| Guard, disarmed settings | **exit 1**, FAIL [R6] |
| Guard, armed settings | **exit 0**, PASS — 387 assets across 3 roots, 6 `isolation-allow:` exemptions |
| `main` guard blob / size | `8ef75fc2c887ca34d211c3be2ff1b97201814d3c` / 67 lines |
| T guard blob / size | `f53f79f833230c2b55aad68c416e2403d30c2b2e` / 246 lines |
| `main` harness blob / size | `0c15db005cd3151a43b1ee968cc5819b1443b879` / 92 lines |
| T harness blob / size | `cbae234b62c2b6997abdd514fa68e93104b096eb` / 369 lines |
| `main` web-build.yml blob | `35d5deb1d3342cb4a09c3d85c53f3b6926ce2f3e` |
| T web-build.yml blob | `75da28c730c2aed3506b0d3c067ef32266d45bef` |

**Not assembled into the release bundle — held for Phase 9 per instruction.**

---

*Read-only against `main`. The build and both guard runs were local, on tree T. No secret value was
displayed or recorded; the publishable key needed for the build was read from the workflow file
programmatically and never printed.*
