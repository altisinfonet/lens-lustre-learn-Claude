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

---

# ADDENDUM · stamped re-runs, and ZERO DAMAGE evidenced from a reading

Proofs 2 and 3 above were taken in this session but were **not UTC-stamped**. Re-run stamped, so
nothing in this file is an unstamped claim. Instruments unchanged: the `run:` blocks extracted
verbatim from `.github/workflows/d2-web-vitals.yml` on `origin/staging` (`a122cdf`).

## PROOF 2 re-run — BLOCKS NOTHING

```
2026-09-04T13:24:31.220Z  catastrophic  exit=0   LCP 60000ms · CLS 1.0 · INP 30000ms
2026-09-04T13:24:31.640Z  real_staging  exit=0   the staging run's own /wall, CLS 0.7462
2026-09-04T13:24:31.700Z  nothing       exit=1   ::error::no route produced a measurement
```

## PROOF 3 re-run — the one line that can stop a PR

```
2026-09-04T13:24:31.773Z  VITALS_EXIT=0     exit=0
2026-09-04T13:24:31.783Z  VITALS_EXIT=1     exit=1   ::error::web-vitals-report.mjs exited 1 …
2026-09-04T13:24:31.793Z  VITALS_EXIT=139   exit=1   ::error::web-vitals-report.mjs exited 139 …
```

## ZERO DAMAGE — measured, not argued from design intent

Phase 0 changes no behaviour, so this *should* be trivially true. Said from a measurement anyway.

**1 · The pending promotion touches no shipped code.**

```
git diff --stat origin/main origin/staging -- src supabase package.json package-lock.json \
                                              bun.lock bun.lockb index.html vite.config.ts
-> EMPTY
```

No `src/`, no `supabase/`, no dependency file, no build config differs between the lanes. The three
files the promotion carries are a workflow, a Node script and an evidence document.

**2 · The staging run wrote nothing to the repository.**

```
staging HEAD now       a122cdf
the 0.5 merge commit   a122cdf
commits authored by the workflow since the merge:  0
```

The workflow holds `permissions: contents: read` (line 81) and the catalogue agrees with it: the
run produced an artefact and a step summary, and left `staging` exactly where the merge left it.

**3 · The suite is unchanged.**

```
2026-09-04T13:24:31.802Z  start
  Test Files  182 passed | 1 skipped (183)
       Tests  2510 passed | 1 skipped (2511)      ZERO failures
2026-09-04T13:25:42.510Z  end
```

Identical to the reading taken before the 0.5 merge — correct, because 0.5 adds no `src`.

**4 · What zero-damage does NOT cover, stated.** D2 cannot reach `staging.50mmretina.com`,
`www.50mmretina.com` or `cdn-staging.50mmretina.com` from this container — all three answer
`CONNECT tunnel failed, 403` under this session's network policy. **So "no damage to the deployed
staging site" is asserted from the diff and the permissions, not from loading the site.** That is a
named limitation, not a claim.

## Register criterion re-measured, and it clears the Auditor

The Auditor's criterion 4 — *"35 rows, 35 paths, zero missing"* — was re-measured independently:

```
rows WITH an evidence path, by prefix:  {'P': 35}
rows WITHOUT,             by prefix:  {'H': 6, 'N': 8}
```

**All 35 `P` gate rows carry an evidence path.** The 14 without are `H-*` holds and `N-*` notes,
which are not gates. A first pass here counted 47 rows and looked like a finding; it was an
over-broad pattern on D2's side, and the measurement cleared the claim rather than confirming a
defect. Recorded because a finding withdrawn by measurement is worth the same as one confirmed.
