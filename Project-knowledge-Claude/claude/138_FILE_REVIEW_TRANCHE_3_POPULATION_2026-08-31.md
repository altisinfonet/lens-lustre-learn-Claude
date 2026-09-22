# §25.7.2 item 2 — tranche 3: population checks across all 73 functions

Issued 2026-08-31 by the compiler/audit session. Measured in this container against the working clone at `a42b209e`. Read-only.

Per-file review of the 44 `supabase/functions/` belongs to Developer 1's half. **This tranche asks the questions a per-file pass cannot ask** — the ones about the population, not the file. Two of them produced results neither developer has published.

---

## 1. F-34 fully reconciled — and the decomposition is new

Three different numbers have been reported for the storage-lane guard in RC source: **Developer 1 said 10**, **Developer 2 said 12 of 73**, and I have been relaying both without measuring either.

**Measured here, and they all reconcile.**

### The guard reaches functions by two routes, and only one is visible to a text search

```
functions whose own files contain the literal `assertStorageLane`   6
  hard-delete-competition · migrate-storage · s3-delete
  s3-presign-upload · s3-signed-url · s3-upload

functions calling getS3Settings( — which runs the guard inside
_shared/s3.ts:290, so the literal never appears in their own code    7
  backfill-image-dims · backfill-media-objects · detect-orphan-files
  hard-delete-competition · media-register-upload · media-verify-upload
  purge-s3-orphans

overlap (hard-delete-competition, in both)                           1
                                                             ────────
UNION                                                        6 + 7 − 1 = 12
```

**12 — exactly Developer 2's blind figure**, reached here by a decomposition neither of them published.

### And Developer 1's 10 is the same fact over the deployed denominator

The two functions in the union that are **not among the 71 deployed** are **`backfill-media-objects`** and **`media-verify-upload`** — both appear in the `getS3Settings` list above and neither appears in Developer 2's frozen 71-row deployed list.

**12 − 2 = 10.**

| Population | Guarded | Source |
|---|---|---|
| 73 functions in RC source | **12** | measured here |
| 71 functions actually deployed, measured against RC source | **10** | Developer 1 |
| the deployed bundles themselves | **0** | both instruments |

**All three figures are the same measurement over three different denominators. There was never a disagreement — there was an unstated denominator, three times.** That is §3.5 rule 5's whole point, and it took a decomposition to see it.

**And the chain the ledger cares about is now complete and mine:** the RC guards twelve functions in source, ten of which are deployed, and **not one deployed bundle carries the guard** — because §23.5.1 condition 2 excludes edge-function deployment from this release. The fix exists in the candidate and does not reach production by merging.

---

## 2. Rule 6 applied to the population — and it explains the CORS census structurally

Standing rule 6: *counting copies of a shared module does not find reimplementations of it.* F-34a found one — `hard-delete-competition`'s inline `getS3Settings`. **Nobody had run that scan across the population.**

Scanning all 73 for local declarations of shared helper names, where the name is **not** imported from `_shared`:

| Helper | Functions declaring it locally |
|---|---|
| `getS3Settings` | **1** — `hard-delete-competition` (confirms F-34a; no second instance) |
| `getSecureHeaders` | **0** |
| `assertStorageLane` | **0** |
| `laneConfig` | **0** |
| **`corsHeaders`** | **45** |

**Forty-five functions define their own `corsHeaders` rather than importing shared headers.** That is not itself a defect — a local CORS constant is an ordinary pattern. **What it does is explain a number the whole engagement has been reporting without a mechanism.**

### The CORS split is structural, not arbitrary

Partitioned across all 73 source functions:

```
uses secureHeaders only          21
declares local corsHeaders only  38
both                              7
neither                           7
                                ───
                                 73
```

Functions touching `secureHeaders` in source: **21 + 7 = 28**. Deployed bundles carrying `_shared/secureHeaders.ts`: **27** — the difference being source functions that are not deployed.

**So F-35's "27 of 71 carry the file, 44 do not" was never a coverage gap. The 44 are the functions that define CORS locally instead of importing it.** And the CORS census's 39 static-wildcard / 27 gated split maps onto the same boundary: the gated set is the `secureHeaders` importers; the wildcard set is, in the main, the local-constant definers.

**Two independently produced censuses agreed on 27 and on membership. Neither said *why* it was 27. It is 27 because that is how many functions import the shared header module.**

### The seven that do both — a consistency observation, not a finding

Seven functions **import `secureHeaders` and also declare a local `corsHeaders`.** Both mechanisms present in one file is where a future reader gets the header set wrong, and where a future census gets the classification wrong. **No exposure measured. Recorded as a post-promotion tidiness item.**

---

## 3. What this tranche does not claim

- It does **not** replace Developer 1's per-file review of the 44. It answers different questions.
- It measures **RC source only**. The deployed-bundle figures are Developer 1's and Developer 2's, unchanged.
- It **closes nothing**. §25.4 stands: the compiler is not a second party.

---

## 4. Cumulative position

| | |
|---|---|
| Per-file claims by me | 55 of 138 |
| Population checks across all 73 functions | config coverage · `verify_jwt` × service-role · F-34 decomposition · rule-6 reimplementation scan · CORS structural partition |
| New results this tranche | the 6 + 7 − 1 = 12 decomposition; the 12 → 10 → 0 chain; the structural cause of the 27/44 split; one inline reimplementation confirmed and **no second instance** |
| Findings added | **none** — every scan resolved to a mechanism or an already-known item |

**Four population scans and not one new defect.** That is worth stating plainly: the two live findings in this release were both already identified, both sit inside the reviewed set, and nothing at population level adds to them.
