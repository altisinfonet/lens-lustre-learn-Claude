# G10 STEP 4.3 — AUDIT FINDING · SIX-CHECK VERIFICATION · THE EXACT DIFF

**2026-08-26. `main` has NOT been changed. Nothing pushed, opened or merged.**
Candidate tree T = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`.

---

# AUDIT FINDING AF-01 — recorded in full, not rewritten

## The defect

**The runbook described step 4.3 as a one-file change.** Its text reads: *"Arm the production-lane host
rules. `main`'s `web-build.yml` currently sets `ISOLATION_FORBIDDEN_REFS: ""` and no host variables."*

Following it literally would set two environment variables that **`main`'s guard script cannot read**.
`main` runs a 67-line `verify-bundle-isolation.mjs` with **zero** references to
`ISOLATION_EXPECTED_HOST` or `ISOLATION_FORBIDDEN_HOSTS`. The job would pass, the workflow would look
armed, and **§17-4 would be recorded as satisfied on a check that never executed.**

## The audit failure — mine

**The earlier audit in this session accepted the runbook's one-file description without verifying the
implementation on `main`.** Specifically:

- The Phase 0 report identified the disarmed variables on `main` and correctly flagged them as
  "armed on Cloudflare, disarmed in CI".
- It then asserted the remedy was to *"copy exactly the three values above into the workflow"* —
  **without ever checking whether the script consuming them supported host rules at all.**
- That assertion was repeated in the Rev 2.2 decision sheet, in the Phase 1 closure record, and in the
  Phase 4 status map. Four documents carried it forward unverified.

The Phase 0 report *measured the workflow* and *inferred the fix*. It never opened
`scripts/verify-bundle-isolation.mjs` on `main`. **That is the same class of error this programme
exists to catch: a conclusion drawn from an adjacent measurement rather than from the thing itself.**

It was caught only because a pre-flight test was run before touching `main`, rather than trusting the
prepared plan.

## Corrections

1. **Step 4.3 is a three-file change**, and the three must land atomically.
2. **Its pass criterion changes.** *"The workflow declares the host variables"* is not evidence. The
   criterion is **the guard's own PASS line containing `host=` and `forbidden-hosts=`**, read from the
   production-lane job log.
3. The four documents above are **not** silently amended. This finding supersedes them and is recorded
   alongside.

---

# THE SIX CHECKS

## ✅ 1 · What changed, and why each file is required

| File | `main` → T | Why required |
|---|---|---|
| `.github/workflows/web-build.yml` | `35d5deb` → patched | Supplies the three isolation values. **§17-4** |
| `scripts/verify-bundle-isolation.mjs` | `8ef75fc` (67 ln) → `f53f79f` (246 ln) | **Without it the host variables are inert.** Adds `ISOLATION_EXPECTED_HOST` (5 refs), `ISOLATION_FORBIDDEN_HOSTS` (6 refs), `ISOLATION_ALLOW_NO_FORBIDDEN` (7 refs), rule **R6**, and 3-root scanning. **§17-4** |
| `scripts/test-isolation-guard.mjs` | `0c15db0` (92 ln) → `cbae234` (369 ln) | Supplies the 21-mutant harness whose held-count **§17-5** requires |

**The single most consequential line:** `main`'s guard carries
`if (forbidden.length === 0) console.warn("… leak check limited to R2.")` — a **warning**. T's guard
makes the same condition a **hard failure (R6)**. `main`'s PASS string has no `host=` field at all.

## ✅ 2 · The candidate set is present and tested on T

All three exist on T at the blobs above. On T: harness **41/41** (schema guard) and **21/21**
(isolation mutants), both re-run this session on the frozen tree.

## ⚠ 3 · Unrelated changes — one honest qualification

- `verify-bundle-isolation.mjs`: **13 of `main`'s 59 unique lines are not in T's.** Each was inspected.
  All are superseded implementation (the `walk()` recursion, `TEXT_EXT`, the single-root `DIST` scan,
  the old PASS string, the warn-not-fail branch). **No capability is lost.**
- `test-isolation-guard.mjs`: 3 of 83 lines absent, all superseded env-construction.
- `web-build.yml`: **the change is a 1-line edit plus 2 added lines. Nothing else.**

**A rejected alternative, recorded because it was measured:** taking T's `web-build.yml` wholesale would
avoid a later merge conflict, but T's version defines three jobs and invokes `scripts/test-seo-assets.mjs`,
which is **absent on `main`** — and T's `package.json` build script calls `generate-redirects.mjs`,
`generate-headers.mjs` and `generate-seo-assets.mjs`, **all three also absent on `main`**. That path
would drag `package.json` plus four scripts, pre-shipping a large slice of the release to `main`
outside the promotion gate. **Rejected as materially worse.**

## ✅ 4 · Harness run against the candidate

`node scripts/test-isolation-guard.mjs` on T → **Mutations detected/held: 21/21**.
Re-run against `main`'s tree with the two scripts swapped in → **21/21** there too.

## ✅ 5 · The production-lane job executes the new guard with host variables populated

Verified two ways.

**On the candidate**, `build-production` carries a job-level `env:` block with all three values
(`ISOLATION_FORBIDDEN_REFS`, `ISOLATION_EXPECTED_HOST`, `ISOLATION_FORBIDDEN_HOSTS`) and the step
`run: node scripts/verify-bundle-isolation.mjs`, which inherits them. Its gate is
`if: github.base_ref == 'main' || (… && github.ref_name == 'main')` — **which is exactly why it was
skipped on the staging push in run `32976271438`.**

**On `main`'s own bundle** — the decisive test, since `main`'s source differs from T's:

```
npm ci → OK          npm run build → OK, 246 JS chunks
harness              → 21/21
armed guard          → exit 0
```

## ✅ 6 · The output explicitly contains `host=` and `forbidden-hosts=`

Literal output, armed guard against **`main`'s** bundle:

```
ISOLATION-GUARD PASS: expected=jtdtehuqtinjxropkkcn present;
forbidden=[ztzutckwdhetphwghuzj] absent;
host=cdn.50mmretina.com present;
forbidden-hosts=[cdn-staging.50mmretina.com,staging.50mmretina.com] absent;
385 assets scanned across 3 root(s): dist, functions, supabase/functions;
0 line(s) exempted by isolation-allow:.
```

Against **T's** bundle: same fields, 387 assets, 6 `isolation-allow:` exemptions.
`main`'s current guard emits **0** occurrences of those fields; T's emits them.

---

# CONSEQUENCE FOR PHASE 8 — measured, not predicted

Applying this change to `main` adds **one more promotion conflict**. Simulated locally end to end:

| | Conflicts at promotion | Resolution | Resulting tree |
|---|---|---|---|
| Without 4.3 | `generateCertificatePdf.ts` | take candidate's | **= T** |
| **With 4.3 (this change)** | `generateCertificatePdf.ts` **+ `web-build.yml`** | take candidate's for both | **= T** ✅ |

```
tree after promotion : e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
candidate tree T     : e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
EQUAL — C2 link 4 still holds
```

**Both conflicts resolve the same way — take the candidate's version — which is what promotion means.
This must be written into the RC record so Phase 8 follows a pre-agreed resolution.**

---

# THE EXACT DIFF — three files

### 1 · `.github/workflows/web-build.yml`

```diff
@@ -72,5 +72,7 @@ jobs:
       - name: Bundle isolation guard (production lane)
         env:
           VITE_SUPABASE_URL: https://jtdtehuqtinjxropkkcn.supabase.co
-          ISOLATION_FORBIDDEN_REFS: ""
+          ISOLATION_FORBIDDEN_REFS: ztzutckwdhetphwghuzj
+          ISOLATION_EXPECTED_HOST: cdn.50mmretina.com
+          ISOLATION_FORBIDDEN_HOSTS: cdn-staging.50mmretina.com,staging.50mmretina.com
         run: node scripts/verify-bundle-isolation.mjs
```

One line changed, two added. The three values are cross-checked against three agreeing sources: the
Phase 0 production Pages variables, T's `build-production` job, and the runbook.

### 2 · `scripts/verify-bundle-isolation.mjs` — whole-file replacement
`8ef75fc2c887ca34d211c3be2ff1b97201814d3c` → `f53f79f833230c2b55aad68c416e2403d30c2b2e`

### 3 · `scripts/test-isolation-guard.mjs` — whole-file replacement
`0c15db005cd3151a43b1ee968cc5819b1443b879` → `cbae234b62c2b6997abdd514fa68e93104b096eb`

Both become **byte-identical to the candidate tree**, so the promotion takes them trivially.

---

# EVIDENCE LEDGER — carry to Phase 9, not assembled

| Item | Value |
|---|---|
| Candidate commit / tree | `b8535fe7c9f2c7f604347ba849ac579bf4946d23` / `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` |
| `main` head (unchanged) | `b671e1fb0c5bcf145d442076c229eca888afd674` |
| Web build run on T | **`32976271438`** — Success; **production lane SKIPPED**, staging lane 54s |
| Other runs on T | Security #683, Typecheck #1195, UI gate #115 — all Success |
| Harness on T | schema-deps **41/41** · isolation **21/21** |
| Harness on `main` + new scripts | isolation **21/21** |
| Guard on T (armed) | exit 0 — 387 assets, 3 roots, 6 exemptions |
| Guard on `main` (armed) | exit 0 — 385 assets, 3 roots, 0 exemptions |
| Guard on `main` (disarmed, T's script) | exit 1 — FAIL [R6] |
| Promotion, without 4.3 | 1 conflict → tree = T |
| Promotion, with 4.3 | 2 conflicts → tree = T |

**Held for Phase 9. Not assembled into the release bundle.**

---

*`main` untouched. All builds, guard runs and merges were local. No secret value displayed or recorded;
the publishable key was read programmatically from the workflow and never printed.*
