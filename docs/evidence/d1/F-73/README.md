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

## 7b · ⚠ THE COST OF EXIT 2, AND WHY `--attempts` MUST NOT BE LOWERED TO 1

Recorded at the Auditor's instruction, so that nobody later "fixes" the slowness by making the gate
cheaper to blind.

`--timeout-ms=120000` with `--attempts=3` means **a genuinely dead registry costs the job up to about
six minutes before it reports blind** (3 × 120 s plus 5 s + 15 s backoff = 6 m 20 s). That is
deliberate, and it is the right trade:

**Exit 2 is a real failure and it must not be reachable cheaply.** The whole finding is that a gate
which goes red for nothing teaches people to re-run it until it goes green. A gate that reports blind
after a single 120-second attempt would hit that state constantly on a merely slow endpoint — and
then exit 2 becomes the new noise, re-run reflexively, and F-73 returns wearing a fourth costume. The
three attempts are what make "blind" mean *the registry is actually unreachable*, rather than *the
registry was briefly busy*.

Measured on the very first production run (§9): **attempt 1 went blind, attempt 2 completed.** With
`--attempts=1` that run would have reported exit 2 and blocked PR #146 for nothing.

**So: if this job is ever judged too slow, the thing to change is `--timeout-ms`, or the registry, or
the informational step above it — NOT `--attempts`.** Lowering attempts to 1 does not make the gate
faster in the common case (a healthy audit completes on attempt 1 in ~30 s); it only makes false
blindness cheaper, which is the opposite of the point.

---

## 8 · F-73b — the informational step delays the gate. And a correction to D1's own first account of it.

### 8.1 ⚠ CORRECTION FIRST, because the first version of this section was wrong

The first version of §8 said the `Report (all dependencies)` step was **"still running 25 minutes
later"** and that the gate steps **"never started"**. **Both statements were false**, and they were
committed to `security.yml`, to this file and to a commit message before being checked.

They came from **assuming elapsed time from backgrounded `sleep` commands instead of reading a
clock**. The sleeps had been launched but not waited on, so almost no wall-clock had passed; the
elapsed figure was inferred, not measured.

**That is the C-49 / C-53 error — a figure written down without its instrument** — committed by the
same developer who spent the morning citing that rule against a frozen list. Recorded here rather
than quietly edited, because the project's rule is that a correction is a record, not a tidy-up.

### 8.2 What the instrument actually says

Actions API step timestamps, run `33861425081`, job `100986510380`, head `5e69ef4` (the F-73 fix
*before* any bound was added):

| step | | duration |
|---|---|---|
| 5 · `npm ci` | 10:04:21 → 10:04:32 | 11 s |
| 6 · `Report (all dependencies)` | 10:04:32 → **10:09:32** | **300 s**, conclusion `success` |
| 7 · the C-34 fixture test | 10:09:32 → 10:09:32 | instant, **pass** |
| 8 · the gate itself | started 10:09:32 | — |

**300 s is exactly npm's `fetch-timeout` default (300000 ms).** So step 6 was **one timed-out
attempt**, not an indefinite hang, and it reported `success` only because `|| true` swallowed npm's
error — **it produced no useful report at all**. Five minutes spent to print nothing, ahead of the
step that actually decides the gate.

Steps 7 and 8 then ran normally. **The gate was delayed, not prevented** — and the C-34 fixture test
passed in CI, which is its first real run.

### 8.3 The change, with its justification corrected to match the measurement

`run: timeout -k 30 180 npm audit || true`

The remaining risk is **real but smaller than first claimed**: npm's defaults are
`fetch-timeout=300000` with `fetch-retries=2`, so a worse episode can cost multiples of the 300 s
observed here. Capping a step that measurably burned five minutes to print nothing is worth doing —
but on that evidence, not on the inflated account.

`-k 30` was added so a SIGTERM-ignoring npm is still killed.

**This weakens nothing.** Step 6 is not a gate and never could fail the job; the real gate at step 8
is untouched and still authoritative. In the observed failure the report was **empty anyway**, so
cutting it earlier loses nothing; when the registry is healthy it finishes in ~30 s and is
unaffected. **Losing a listing is not losing a check.**

### 8.4 The general lesson, which survives the correction

*Bounding a check is worth little if an unbounded step runs before it* — the F-73 fix bounded the
gate and left the informational step above it unbounded, so the first thing it did in production was
sit behind exactly the class of slowness it was written to diagnose. That much was right. The number
attached to it was not, and the difference between "delayed five minutes" and "blocked for
twenty-five" is the difference between a measurement and a story.

---

## 9 · The gate in production — its first real run, and it did the thing it was built to do

Run `33861425081`, job `100986510380`, step 8, head `5e69ef4`. Log timestamps, verbatim:

```
10:09:32  Dependency gate — threshold: critical (production dependencies only, --omit=dev)
          Tightening the threshold to "high" is a known open task; this run does not do it.

10:11:33  attempt 1/3: THE AUDIT DID NOT COMPLETE — npm produced no output at all
                       (killed after 120000 ms)
              retrying in 5s — retrying ONLY because the audit did not complete

10:12:15  counts: info 0 · low 3 · moderate 7 · high 17 · critical 0
          ══════════════════════════════════════════════════════════════════
            PASS — exit 0. The audit COMPLETED and found 0 findings at or above "critical".
          ══════════════════════════════════════════════════════════════════
```

**This is the whole finding, resolved, on a live run:**

- Attempt 1 **went blind** — the endpoint did not answer within the 120 s per-attempt bound. **The old
  one-line gate would have exited 1 here and gone red on PR #146, for a non-vulnerability.** That is
  F-73 exactly, and it happened on the first run after the fix landed.
- The script retried **only because the audit did not complete**, and said so in its own words.
- Attempt 2 **completed**. The verdict came from `metadata.vulnerabilities`, not from npm's exit code,
  and it was final — a completed audit is never retried.
- Result: **exit 0, correctly**, with the counts printed for the record.

`low 3 · moderate 7 · high 17 · critical 0` — the same figures measured locally on 2026-09-04 and the
same figures recorded independently in the F-72 comment. **Three instruments, one answer.**

Step 7, the C-34 fixture test, also ran in CI here for the first time and passed, including its
PART 5 measurement of the open task:

```
PART 5 — the threshold is `critical` today. Tightening to `high` is OPEN, not done here.
  same completed audit at threshold "high": 17 finding(s) at/above -> exit 1
```

**What this run does not prove:** that the registry is fixed. It is not, and this change never
claimed to fix it — attempt 1 failing is the proof it is still broken. What changed is that the job
now *says which defect it hit* and still reaches the right verdict when it can.
