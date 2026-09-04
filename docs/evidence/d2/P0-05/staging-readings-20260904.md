# 0.5 · PROVED ON STAGING — the three readings OWNER-RULING-2026-09-04-01 requires

**Taken 2026-09-04 by D2, after the Owner halted the promotion.** Green CI is not a proof: it shows
the workflow file parses and the job exits zero. These are the readings.

**No promotion was made. `main` is untouched at `493d4d4`.** PR #158 was opened and closed without
merging.

---

## READING 1 · RUNS — a completed run on `staging`, and its numbers

**Not a PR run.** `d2-web-vitals.yml` run **`33875235679`**, event `push`, branch `staging`,
head `a122cdfa2f12196674091fb27a6babe507b457ac` — the 0.5 merge commit itself. Conclusion `success`,
14 steps, all green.

What the harness produced, quoted from the run log:

```
/wall            status=measured LCP=3992ms CLS=0.7462 INP~=56ms
UNMEASURED (sample /feed): page.evaluate: Execution context was destroyed, most likely because of a navigation
UNMEASURED (sample /feed): page.evaluate: Execution context was destroyed, most likely because of a navigation
written .../docs/evidence/d2/baseline/web-vitals-2026-09-04T12-58-48-716Z-06e64642.ndjson

web-vitals-report.mjs exited with 0
7 measured sample(s) in web-vitals-2026-09-04T12-58-48-716Z-06e64642.ndjson — the harness ran.
baseline files: 1   vitals files: 1
304 records, every one stamped UTC
```

Artefact **`d2-baseline-33875235679`**, id `9937677104`, 25 246 bytes, 2 files, sha256 of the zip
`5912c67dffdb62fc25acbad0184cc87d3bca38afc15eee9cd6e3362099fee3f6`, retained 90 days.

**Stated as a limitation rather than glossed:** the per-route line for `/` sits one line above the
furthest point the log API would return to D2, so the `/` figures are **not quoted here from the
staging run**. `/wall`, the sample counts, the record count and the exit code are. Downloading the
artefact needs a credential D2 does not hold and must not handle.

## READING 2 · BLOCKS NOTHING — a bad reading does not fail the job

Run against the **real** content-guard step extracted from
`.github/workflows/d2-web-vitals.yml` on `staging`, not a retyped copy.

| fixture | reading | guard |
|---|---|---|
| catastrophic | LCP **60 000 ms**, CLS **1.0**, INP **30 000 ms** | **exit 0** |
| the staging run's own `/wall` | LCP 3992 ms, CLS **0.7462** | **exit 0** |
| harness measured nothing | one `unmeasured` sample | **exit 1** |

A regression by any sane threshold — LCP 15× Google's "poor" line, CLS 4× it — passes. A harness
that measured nothing does not.

**And the claim is complete, not two-guard-deep.** Every step in the workflow that can exit non-zero
was enumerated: lines **180** (exit code), **202** (no file written), **205** (`run.status` is
unmeasured), **209** (zero measured samples), **219/223/224** (evidence exists), **234** (a record
without a UTC stamp). **Every one is an envelope or instrument check. No step reads `lcpMs`, `cls`
or `inpMs` at all**, so no site reading can reach the job's exit code.

**The real staging run is itself the strongest instance:** CLS **0.7462** is roughly three times the
"poor" threshold, and the job was **green**.

## READING 3 · THE ONE LINE THAT CAN STOP A PR, SHOWN FIRING

Line 180 — the guard that deliberately *does* exit 1 when the harness gains a blocking path or
crashes. **It had never been demonstrated firing.** Run against the real extracted step:

```
VITALS_EXIT=0    web-vitals-report.mjs exited with 0                      exit=0
VITALS_EXIT=1    ::error::web-vitals-report.mjs exited 1. In Phase 0 …    exit=1
VITALS_EXIT=139  ::error::web-vitals-report.mjs exited 139. In Phase 0 …  exit=1
```

Report-only on the measurement, strict on the instrument — and now shown in both directions.

## LANE — confirmed, with a precision that matters for Phase 5

All three lane variables are set **explicitly** in the workflow's `env:` block, so the production
fallback its own comment warns about cannot fire:

```
VITE_SUPABASE_PROJECT_ID: ztzutckwdhetphwghuzj      (staging; production is jtdtehuqtinjxropkkcn)
VITE_CDN_HOST:            cdn-staging.50mmretina.com
VITE_SITE_ORIGIN:         https://staging.50mmretina.com
```

The run log carries the same three values on every step. **No production readings were taken.**

**But be precise about what was measured.** The step invokes the script with `--dist=dist` and **no
`--url`**, and the script serves that directory from `http://127.0.0.1:<port>` (`web-vitals-report.mjs:128-150`).
So the figures are **the staging-lane BUNDLE measured over localhost** — not the deployed
`staging.50mmretina.com` origin. No CDN, no TLS, no real network path.

That is the right thing for a build-comparison instrument and the wrong thing to mistake for a
field measurement. **Phase 5's before-figures must say which they are**, or P13 will set a ceiling
against numbers that never included the network.
