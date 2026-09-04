# F-73 — the dependency gate could not tell "clean" from "could not look"

**Finding:** F-73 · handed to D1 by the Auditor · landed directly on `staging`
**Files:** `scripts/security-audit-dependencies.mjs` · `scripts/security-audit-dependencies.test.mjs` · `.github/workflows/security.yml` · `docs/evidence/d1/F-73/`

---

## 1 · The defect, as measured by the Auditor

`npm audit --omit=dev --audit-level=critical` exits non-zero for two unrelated reasons and gives the
job no way to tell them apart:

- **(a)** the audit ran and found a critical
- **(b)** the audit could not run at all

Both print `Process completed with exit code 1`. Same commit `38eff26`, two runs, opposite verdicts:

| run | trigger | result |
|---|---|---|
| 841 | push | exit 0, 2m37s — completed, 0 criticals |
| 842 | pull_request | exit 1, 9m37s — `npm warn audit network timeout at …/advisories/bulk`, then `npm error audit endpoint returned an error` |

**Run 842 found nothing. It reached nothing.** It was red on PR #146 and blocking the promotion.

**The conflation is the bug, not the flakiness.** A gate that is sometimes red for nothing teaches
everyone to re-run it until it goes green, and a gate you re-run until it goes green is not a gate —
the next real critical gets the same reflex. Fixing the network would not fix that.

**Relation to F-72.** Same failure class, different costume: F-72 was a **retired** endpoint
(permanent), F-73 is a **slow** one (intermittent). The npm@11 fix was correct and **stays** — it is
why the error text moved from `/audits/quick` to `/advisories/bulk`. What it did not fix is the
conflation.

---

## 2 · The fix — three outcomes, three exit codes

| exit | meaning | |
|---|---|---|
| **0** | audit completed, findings at/above threshold = 0 | PASS |
| **1** | audit completed, findings at/above threshold > 0 | FAIL — a vulnerability. **This is the gate working.** |
| **2** | audit did not complete after N attempts | FAIL — **the gate is blind** |

**Exit 2 is still a failure.** Standing Rule 19: never weaken a check to get it green, and *"we could
not look" must never be reported as "we looked and it was clean"*. The gain is **diagnosis, not
leniency**. No `continue-on-error` anywhere, nothing allowlisted, `--omit=dev` unchanged, threshold
unchanged.

**The verdict comes from the count, never from npm's exit code.** Measured 2026-09-04, npm 11.19.1,
this repository's lockfile: a **completed** audit with `critical: 0` **still exits 1**, because npm
exits non-zero merely because findings of some severity exist. npm's exit code answers a different
question from the one the gate asks.

**The signal for "could not run" is the absence of `metadata.vulnerabilities`** — not the presence of
an error field. ⚠ **npm still prints a well-formed JSON object when the audit fails**, and that is the
trap; "did it parse?" is the wrong question. Keying on absence keeps working the next time npm
changes its error shape or its endpoint, which it has now done twice in two days.

**Retry is bounded and applies only to outcome (b).** ⚠ **A completed audit is never retried**, pass or
fail — retrying one would make a real critical retryable away, which is the exact reflex this change
exists to prevent. Worst case is stated rather than left to accumulate: `3 × 120s + 5s + 15s =
6m20s`, against run 842's `9m37s` for a single wrong answer. A healthy audit takes ~30s.

---

## 3 · C-34 — shown failing before it was shown passing

`F-73-fixture-transcript.txt`. The fixtures are **real captured bytes**, and the test reads the **same
committed files** rather than a copy, so evidence and test cannot drift apart.

| fixture | provenance |
|---|---|
| `endpoint-error.json` | stdout of `npm audit --omit=dev --json`, **npm 11.19.1**, against a registry answering 500 on `/-/npm/v1/security/advisories/bulk` — the exact endpoint from run 842. npm's own exit code was **1**. |
| `completed-critical-0.json` | stdout of a genuinely **completed** audit against `registry.npmjs.org` on this lockfile, npm 11.19.1. npm's own exit code was **also 1**, with `critical: 0`. |
| `completed-critical-1.json` | the file above with `critical` set to 1 and `total` incremented. **DERIVED, and labelled as derived** — there is no real critical in this repository today, and manufacturing one is not something a test may do. |

**Part 1 of the test reproduces the defect before Part 2 shows the fix:**

```
PART 1 — the OLD one-line gate
  endpoint-error.json         old gate exit 1   audit could NOT run
  completed-critical-1.json   old gate exit 1   audit completed, critical = 1
  completed-critical-0.json   old gate exit 0   audit completed, critical = 0

  ⚠ CONFLATED: "could not look" and "found a critical" BOTH exit 1.

PART 2 — the NEW gate, same three inputs
  PASS  endpoint-error.json         exit 2 (expected 2)
  PASS  completed-critical-1.json   exit 1 (expected 1)
  PASS  completed-critical-0.json   exit 0 (expected 0)

PART 3 — codes: [2, 1, 0]  distinct: YES
```

Real **process** exit codes, captured without a pipe: `2 / 1 / 0`.

Also asserted: empty output (killed by timeout) → blind; unparseable output → blind; and a
**non-numeric count → blind, never coerced to 0** — coercing it would be the exact "could not look
reported as clean" failure this whole change exists to stop.

**The test runs in CI on every security run**, before the gate itself. It needs no network, so it
still runs when the registry is the thing that is broken.

---

## 4 · Live reproduction against the real registry

Not a fixture. During this work `registry.npmjs.org` returned **503 Service Unavailable** on the bulk
endpoint from this container, and a subsequent live gate run did not complete within two attempts:

```
attempt 1/2: THE AUDIT DID NOT COMPLETE — npm produced no output at all (killed after 50000 ms)
    retrying in 5s — retrying ONLY because the audit did not complete
attempt 2/2: THE AUDIT DID NOT COMPLETE — npm produced no output at all (killed after 50000 ms)

  THE GATE IS BLIND — exit 2.
>>> PROCESS EXIT CODE = 2
```

The old gate would have printed `Process completed with exit code 1` here, indistinguishable from a
critical vulnerability. **F-73 is live, not historical.**

---

## 5 · ⚠ The threshold is `critical`, and tightening to `high` is still OPEN

This change does **not** touch the threshold. It is `critical`, exactly as before, and it is now
passed in **explicitly from `security.yml`** so it is visible in the workflow rather than hidden in a
script default.

Part 5 of the fixture test measures what tightening would cost **today**: the same completed audit at
threshold `high` yields **17 findings at/above → exit 1**. All 17 pre-date the gate. A gate that is
red from the day it is installed gets ignored within a week.

**Tightening to `high` remains a real, open task.** F-73 did not silently take it and did not silently
drop it.

---

## 6 · What this evidence does NOT prove

- It does not prove GitHub Actions behaves identically to this container. The fixture cases are
  container-independent (committed bytes, no network); the live run in §4 depends on the registry at
  that moment and **will differ run to run** — that is the nature of the defect.
- It does not fix the registry problem, and does not attempt to. It makes the gate **say** which
  problem it hit.
- It does not change the threshold, `--omit=dev`, or allowlist anything.

---

## 7 · Ownership note, raised rather than assumed

Addendum §3.2(c) splits `scripts/**` by prefix — `db-*` to D1, `web-*` to D2 — and **neither prefix
covers a security script**. The precedent is the existing `scripts/security-audit.mjs`, which is
invoked only by `security.yml` (a D1-owned workflow), so the two new files follow it as
`security-audit-dependencies*.mjs`. **The Auditor may want to record that pairing explicitly** so the
next `scripts/` file does not have to guess. D1 did not edit `docs/gates/**` to record it.

---

## 8 · F-73b — the fix bounded the wrong half first. Measured, and corrected.

**Found by watching the very first run of the F-73 fix, on PR #146 head `5e69ef4`.** Workflow run
`33861425081`, job `100986510380`, step states read from the API at ~10:29Z:

```
step 5  npm ci                     completed  10:04:32
step 6  Report (all dependencies)  in_progress from 10:04:32 — still running 25 minutes later
step 7  the C-34 fixture test      PENDING — never started
step 8  the gate itself            PENDING — never started
```

**The bounded gate never ran.** The job was held by step 6 — the pre-existing informational
`npm audit || true`, which F-73 did not touch.

`|| true` stops that step **failing** the job. It does not stop it **hanging** the job, and that is a
different defect. From npm's own defaults, read rather than guessed:

```
fetch-timeout=300000   (5 minutes PER ATTEMPT)
fetch-retries=2
-> 3 x 300s = 15 minutes for ONE request before npm gives up, and `npm audit` issues more than one
```

Which also explains run 842's 9m37s.

**The correction:** `run: timeout 180 npm audit || true`.

**This weakens nothing, and the distinction matters.** Step 6 is not a gate — it never could fail the
job — and the real gate at step 8 is untouched and still authoritative. If the report times out, the
lost thing is an informational listing, and the gate below prints the severity counts itself. **Losing
a listing is not losing a check.** Verified locally that `timeout` kills on schedule (exit 124) and
that `|| true` still absorbs it (exit 0), so the step remains incapable of failing the job.

**Recorded rather than quietly patched.** The original F-73 fix bounded the gate and left the
unbounded step above it, so the first thing it did in production was get stuck behind exactly the
class of failure it was written to diagnose. That is worth writing down: *bounding a check is
worthless if an unbounded step runs before it.*
