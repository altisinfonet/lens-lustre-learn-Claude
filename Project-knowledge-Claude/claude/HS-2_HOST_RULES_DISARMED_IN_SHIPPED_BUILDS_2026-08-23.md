# HS-2 — THE HOST RULES WERE DISARMED IN EVERY SHIPPED BUILD

**Severity:** the guard reported PASS on a bundle it had not checked.
**Found:** 2026-08-23, during G7, by the code session reasoning about where the
Pages build reads its variables from. Confirmed here by execution.
**Status:** fix written and verified locally (R12); **not yet merged**.

---

## 1. The defect

`scripts/verify-bundle-isolation.mjs` made host rules R7–R10 **opt-in**:

```js
const hostRulesActive = expectedHost !== "";
```

If `ISOLATION_EXPECTED_HOST` was unset, R7–R10 did not run and the guard still
printed `ISOLATION-GUARD PASS`, with ` host rules inactive (no
ISOLATION_EXPECTED_HOST);` buried mid-line. Exit 0. A build that checked nothing
was byte-for-byte indistinguishable, to any caller, from one that checked
everything.

## 2. Executed proof, with a control isolating one variable

Real staging bundle from the merged tree at `06b9162`.
`ISOLATION_FORBIDDEN_HOSTS=staging.50mmretina.com` — a host genuinely present in
four files. Nothing differs between A and B except `ISOLATION_EXPECTED_HOST`.

```
A  EXPECTED_HOST=cdn-staging.50mmretina.com
   -> ISOLATION-GUARD FAIL [R8]: forbidden host(s) present in bundle:
        staging.50mmretina.com in dist/_headers
        staging.50mmretina.com in dist/assets/index-NdgXMv3j.js
        staging.50mmretina.com in dist/index.html
        staging.50mmretina.com in dist/robots.txt
      exit 1

B  EXPECTED_HOST unset
   -> ISOLATION-GUARD PASS: ... host rules inactive (no ISOLATION_EXPECTED_HOST);
        271 assets scanned across 2 root(s): dist, functions.
      exit 0
```

## 3. Why it mattered in production, not just in theory

CI reads the host variables from `web-build.yml`, where both lanes have carried
them since G5a — so **every CI run exercised R7–R10 and looked correct**.

The Cloudflare Pages build reads them from each Pages project's own variable
set, and **neither project had them until 2026-08-23**. The Pages build command
is `npm run build && node scripts/verify-bundle-isolation.mjs`.

So since G5a the shipped production build enforced **R1–R6 only**, while CI
reported a fully-armed guard. A production bundle naming
`cdn-staging.50mmretina.com` or `staging.50mmretina.com` would have deployed.
No leak is claimed — whole-tree greps have been clean in both directions — but
the control that would have caught one was not running.

This is the same failure class as R6 (empty `ISOLATION_FORBIDDEN_REFS` disarming
the only leak check), one level up. R6 exists because that exact shape had
already happened once.

## 4. The fix — R12

Refuse when `ISOLATION_EXPECTED_HOST` is unset, unless
`ISOLATION_ALLOW_NO_HOST_RULES=1` states refs-only deliberately. A separate
hatch from `ISOLATION_ALLOW_NO_FORBIDDEN` because it asserts something
different. The summary line for the allowed case now reads
`host rules DELIBERATELY DISABLED … R7-R10 did not run` — a reader cannot
mistake it for a checked run.

**Verified after the change:** case B above now exits 1 with `FAIL [R12]`.
Both configured lanes build and pass unchanged. Harness **18/18** mutants
(new: R12 removed; R12's hatch inverted). `tsc` 0 errors. SEO harness 15/15.

### GREEN-7 retargeted, not deleted (Standing Rule 9)

`GREEN-7` read *"host rules inactive when no expected host is named -> PASS"*.
It asserted the defect and therefore pinned it in place — a passing test whose
subject was the bug. Restated to the invariant it was really protecting: the
opt-out narrows a run to refs only and must never weaken the ref rules
themselves. `W7`'s inline environment also needed the hatch, or it tripped R12
before reaching R6 and survived for the wrong reason.

## 5. Consequence to expect

R12 converts a silent under-check into a **visible deploy failure** wherever the
host variables do not reach the build. That is a feature: the Pages build log is
unreadable from any session here, so a green build that skipped R7–R10 was
undetectable. After R12 it cannot be green.

## 6. What this does not claim

- No cross-lane leak is asserted. Every executed cross-contamination test has
  passed with discriminating controls, both directions, both bundles clean.
- Whether the Pages projects' newly-added host variables actually reach their
  builds is **still unverified** — it needs one deployment log.
