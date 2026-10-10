# D2 finding — `d2-web-vitals.yml` never installs Chromium; the F-2 guard caught it

**Raised by D2, 2026-09-03T10:55Z · file: `.github/workflows/d2-web-vitals.yml` (D2's) · seen on PR #137, run `33746276312`**

## What happened
First run of the workflow against `staging`: **Failure**, 1m 01s. The failing step is the F-2 guard, `The harness measured something (a malfunction is not a value)`, which printed:

```
::error::the harness did not run: chromium would not launch: browserType.launch:
Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
```

**Measured samples: 0.** Precisely: the guard took its **first** branch — an `unmeasured` `run` record in the NDJSON — not the `measured === 0` branch. Every earlier step was green (checkout, setup-node, `npm ci`, staging build, baseline, instrument tests, vitals report-only, exit-code guard); the artifact `d2-baseline-33746276312` (23.7 KB, `sha256:71c072a7…b587fb`) was still uploaded.

## Cause, not symptom
`env: PLAYWRIGHT_BROWSERS_PATH: /opt/pw-browsers` points at a directory **that exists in the developer sandbox this workflow was written in, and does not exist on a GitHub runner** — and the job has **no `playwright install` step at all**. So Playwright looks in an empty directory, finds no browser, and the harness honestly records `status: "unmeasured"`.

The comment beside that env var — *"Where this runner keeps its browsers … nothing new is installed here"* — is the instructing comment, and it is false on the runner. Standing Rule 21: comment and code disagree, so this is a finding, not cosmetics. It is also exactly the class of fault the F-2 guard was added to catch, and the guard caught it on its first real run: without the guard this job would have gone **green with zero measurements**.

## The boring fix (this repository already solved it)
`ui-gate.yml` runs Playwright on the same runners and works: it caches `~/.cache/ms-playwright` with `actions/cache@v4`, then runs `npx playwright install chromium` with a three-attempt retry and a hard error if all three fail. `d2-web-vitals.yml` should copy that pattern and **drop the `PLAYWRIGHT_BROWSERS_PATH: /opt/pw-browsers` line**, so the default cache path is used. Extending the existing pattern, not inventing a second one. No dependency change: Playwright is already a devDependency; the window stays closed.

**Not fixed in this message.** D2 has no push authority, and the fix belongs in its own unit against `.github/workflows/d2-web-vitals.yml`, which is currently only on the #137 head — the Auditor decides whether it lands as a commit on #137 or as a follow-up after merge.

## Classification
**VERIFIED** (CI run `33746276312`, PR #137, head `3435636`, 10:53Z). The guard behaved as designed: it failed a job whose harness produced nothing. Its own correctness is now proved twice — by the planted `--chromium=/nonexistent/chrome` in the review, and by this genuine miss.
