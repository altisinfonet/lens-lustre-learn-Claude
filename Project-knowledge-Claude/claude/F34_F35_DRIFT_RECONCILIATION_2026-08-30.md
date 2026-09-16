# F-34 · F-35 · per-function drift reconciliation · 702e5ce (dispute WITHDRAWN, C-23) · rev9 coverage

Date: 2026-08-30 · Read-only. No branch, commit, push, merge, tag, deploy, migration, workflow
dispatch, §5.3 probe, provider write, ledger edit or secret read. **No secret value was read.**
**Nothing here closes a §25 row (§25.4).**

Instruments ship with their numbers (**F-30**): `f34_guard_census.py`, `F34_guard_census.json`,
`F35_secureHeaders_md5.json`, `DRIFT_PER_FUNCTION_BUCKETS.{json,tsv}`.

---

# F-34 — the storage-lane guard: RC source vs deployed, all 71

## 1. The constructs searched, quoted exactly — no concept matching

The order was *"name and quote the exact construct you search for."* Four constructs, each a literal:

| ID | Construct, verbatim | Why it is distinct |
|---|---|---|
| **G1** | the 17-character identifier **`assertStorageLane`**, anywhere in the text | catches definition, comment and call alike — the loosest possible test |
| **G2** | regex **`assertStorageLane\s*\(`**, with the definition line `export function assertStorageLane` removed first | a real **call site**, not a mention |
| **G3** | regex **`getS3Settings\s*\(`** | **transitive reach.** `_shared/s3.ts:290` executes `assertStorageLane(s3, denoEnv?.env?.get("SUPABASE_URL"))` **inside** `getS3Settings()`, so any caller inherits the guard — *if* the copy it bundles contains that call |
| **G3v** | G3 **and** the bundle/closure contains a copy of `s3.ts` that itself satisfies G2 | the honest form of G3. G3 alone proves nothing |

**The guard's definition, quoted from `rc_a42b209e/supabase/functions/_shared/s3.ts:81`:**

```ts
export function assertStorageLane(s3: StorageLaneSubject, supabaseUrl: unknown): void {
  const url = typeof supabaseUrl === "string" ? supabaseUrl : "";
  const ref = url.match(/^https:\/\/([a-z0-9]{15,25})\.supabase\.co/)?.[1];
  if (!ref) { throw new Error(`storage lane cannot be determined: …`); }
```

RC side = the dependency closure of `<slug>/index.ts` under the **A9-repaired** lexer.
Deployed side = every `files[].content` in the captured production bundle.

## 2. The answer, side by side

| Construct | **RC SOURCE** (of 71) | **DEPLOYED** (of 71) |
|---|---|---|
| **G1** identifier present | **10** | **0** |
| **G2** literal call site | **10** | **0** |
| **G3** calls `getS3Settings(` | **10** | **5** |
| **G3v** G3 + a bundled `s3.ts` that calls the guard | **10** | **0** |

Split by the ledger's own list:

| Group | G1 RC / dep | G2 RC / dep | G3 RC / dep | G3v RC / dep |
|---|---|---|---|---|
| **the ten named in §23.5.1 risk 3** | **10 / 0** | **10 / 0** | 10 / 5 | **10 / 0** |
| **the 61 not named** | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** |

### The direct answer to the question asked

> **Does the guard appear in the RC source of the 61 not named? — NO. Zero of 61, on every one of
> the four constructs.**

The ten functions carrying the guard in RC source are **exactly** the ten §23.5.1 risk 3 names, with
no additions and no omissions: `backfill-image-dims`, `detect-orphan-files`,
`hard-delete-competition`, `media-register-upload`, `migrate-storage`, `purge-s3-orphans`,
`s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`.

## 3. F-34 — the finding: risk 3's wording inverts its own evidence

**§23.5.1 risk 3, quoted verbatim from the frozen ledger:**

> *"3. **The storage-lane guard is absent in ten functions:** `s3-delete`, `s3-presign-upload`,
> `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`,
> `detect-orphan-files`, `backfill-image-dims`, `media-register-upload`."*

Naming ten as the ones that lack a guard carries an unavoidable implication: **that the other 61
have it.** Measured, that implication is false in both directions.

- **Deployed: 0 of 71 carry it — the ten named included.** The ten are not the deficient subset of a
  guarded population; **the entire deployed population is unguarded.** (C-14-L, now confirmed on a
  second construct set and a second instrument.)
- **RC source: 10 of 71 carry it — and they are precisely the ten named.** The ten are **the only
  functions the RC guards at all.** They are the ten the release *fixes*, not the ten it leaves
  behind.
- **The 61 unnamed have no guard in source and none deployed.** For most this is correct by design —
  they never touch storage — but *risk 3's phrasing does not say that*, and a reader taking the
  ledger at face value would conclude 61 functions are protected. **None is.**

**Both readings of risk 3 are literally defensible** — "absent in ten" is true of production for
those ten. **The sentence is not wrong; its implicature is**, and a risk acceptance is read for its
implicature. **Recorded as F-34.** This is the same family as C-18: a clause compressed until the
scope fell off it.

## 4. Two further measurements the census forced out

### 4a. The five deployed bundles that call `getS3Settings(` and have no guard behind it

G3 = 5 deployed, G3v = 0. The gap is C-1's shared-module drift, now tied to the guard:

| Slug | bundled `s3.ts` md5 (first 8) | guard in that copy? |
|---|---|---|
| `backfill-image-dims` | `387888af` | **NO** |
| `detect-orphan-files` | `20d1c34f` | **NO** |
| `media-register-upload` | `edc0a48a` | **NO** |
| `purge-s3-orphans` | `75657bd8` | **NO** |
| `hard-delete-competition` | **none bundled** | **NO — see 4b** |

Four distinct deployed variants of `s3.ts`, **not one of which contains the guard**, running under
functions whose RC source calls it. `purge-s3-orphans` is the destructive path.

### 4b. `hard-delete-competition` carries its own private copy of `getS3Settings` — a fifth variant

Its deployed bundle is **one file**, `index.ts`, 25,699 B, and contains:

```ts
async function getS3Settings(adminClient: AdminClient): Promise<S3Settings | null> {
```

**Not an import — a local re-declaration.** It is a fifth variant of the storage-settings loader,
invisible to any census that counts copies of `_shared/s3.ts`, and it contains no guard. **Recorded
as F-34a.** This is exactly the shape of defect the D+ rule exists for: a search for the shared
module's *filename* would have reported this function as "not affected".

---

# F-35 — md5 of the deployed `_shared/secureHeaders.ts` across all 71

## The result

| | |
|---|---|
| bundles carrying a `_shared/secureHeaders.ts` | **27 of 71** |
| bundles carrying **none** | **44 of 71** |
| **DISTINCT md5 values** | **1** |
| the value | **`58b9f45d5200a9b19f1b24011dfc3511`** (1,507 bytes, identical size in all 27) |

**The ledger's `58b9f45d…` matches in full, not merely on the prefix.** The abbreviation was
faithful. *(Fourth engagement rule — an abbreviated hash is not a hash — honoured: I did not accept
the prefix as the measurement; I measured the whole value and then compared.)*

**The 27 bundles:** `admin-export-db`, `admin-process-withdrawal`, `admin-secure-settings`,
`apply-scheduled-boosts`, `autoscale-ad-traffic`, `backup-reminder`, `cast-photo-vote`,
`complete-round`, `create-payment-session`, `dashboard-init`, `entry-final-votes`,
`evaluate-round2`, `expire-gift-credits`, `get-payment-gateways-public`, `get-wallet-summary`,
`get-wallet-transactions`, `manage-notifications`, `moderate-comment`, `paypal-capture-order`,
`rank-feed`, `razorpay-verify-payment`, `s3-delete`, `s3-presign-upload`, `s3-signed-url`,
`s3-upload`, `send-gift-credit`, `submit-deposit`. The other 44 are named in
`F35_secureHeaders_md5.json`.

## F-35 — the finding: risk 1's inner clause is TRUE and its scope is FALSE

**§23.5.1 risk 1, verbatim:**

> *"1. **Pre-G9 CORS in all 71 production edge functions.** The deployed `_shared/secureHeaders.ts`
> is byte-identical across production (md5 `58b9f45d…`) and uses prefix matching with a
> `.lovable.app` wildcard."*

- **"byte-identical … md5 `58b9f45d…`" — TRUE.** One distinct value across every bundle that carries
  the file. **Confirmed, not merely repeated.**
- **"all 71 production edge functions" — FALSE.** The file exists in **27**. The sentence describes a
  shared CORS policy across a population where **62 %** of the population does not carry it.

**This is C-3, and F-35 hardens it from a mechanism split into a hash.** The claim's own supporting
evidence — the md5 — is what bounds it to 27.

### Independent cross-check, and it is exact

The 27 bundles carrying `secureHeaders.ts` (F-35, an md5 census over bundle files) are **the same
27** the CORS census classifies as `secureHeaders.ts (shared)` (A11b, a regex classifier over entry
text). **Symmetric difference: EMPTY.** Two instruments, different methods, different inputs,
identical set. **Standing rule 5 satisfied properly — this is a per-item comparison, not matching
totals.**

---

# Per-function drift reconciliation — the four splits, by name

## The bucket labels, and they reconstruct exactly

Full per-function table: `DRIFT_PER_FUNCTION_BUCKETS.tsv` (71 rows × 4 readings).

| Reading | MATCH | HEADER-ONLY | DRIFT | UNKNOWN | published |
|---|---|---|---|---|---|
| `702e5ce`, strict | 19 | 21 | 31 | 0 | **19/21/31 ✓** |
| `a42b209e`, strict | 19 | 22 | 30 | 0 | **19/22/30 ✓** |
| `702e5ce`, import-map-excluded | 21 | 21 | 29 | 0 | **21/21/29 ✓** |
| `a42b209e`, import-map-excluded | 21 | 22 | 28 | 0 | **21/22/28 ✓** |

**All four published splits reproduce from the per-function data. Every difference is named:**

- **The two readings differ by exactly two functions** — `handle-email-suppression` and
  `handle-email-unsubscribe`, DRIFT under strict, MATCH under import-map-excluded. Both deploy
  `index.ts` + `deno.json`; the RC closure emits only `index.ts`. **Nothing else moves.**
- **The two lanes differ by exactly one function** — `send-gift-credit`, DRIFT at `702e5ce`,
  HEADER-ONLY at `a42b209e`. **Nothing else moves.**

### The two 21s — the false agreement you asked me to look for, MEASURED

Inside `21/21/29` the two 21s are **MATCH = 21** and **HEADER-ONLY = 21**, and I measured the
overlap rather than reasoning about it:

| Pair | n | overlap | verdict |
|---|---|---|---|
| MATCH(`702e5ce`, imap-excl) vs HEADER-ONLY(`702e5ce`, imap-excl) | 21 vs 21 | **0 — DISJOINT** | **Two completely different sets of functions that happen to total the same number.** Reading them as "the same 21" would be the exact error standing rule 5 forbids |
| MATCH(`702e5ce`, imap-excl) vs MATCH(`a42b209e`, imap-excl) | 21 vs 21 | **21 — IDENTICAL** | Same 21 functions. A **measured** identity, not an inferred one |
| HEADER-ONLY(`702e5ce`, imap-excl) vs HEADER-ONLY(`a42b209e`, imap-excl) | 21 vs 22 | symmetric difference = **`send-gift-credit`** | The one function that moves between lanes |
| HEADER-ONLY(`702e5ce`, strict) vs HEADER-ONLY(`702e5ce`, imap-excl) | 21 vs 21 | **identical** | The import-map reading moves nothing out of HEADER-ONLY |

**So both answers exist inside the same figure.** Two of the 21s are the same functions; two are
completely disjoint. **`21/21/29` cannot be reconciled with any other 21 by arithmetic** — only the
per-function table settles which 21 is meant, and that is why it is published.

> ⚠ **Correction recorded against my own first draft of this section.** I initially wrote that the
> two 21s *"share four members and differ on thirty-four."* **That number was never measured — I
> wrote it from reasoning.** Measured, the overlap is **0**. The sentence has been replaced by the
> table above. Recorded rather than quietly fixed: writing an unmeasured number into a paragraph
> whose whole subject is not trusting unmeasured numbers is precisely the failure this engagement
> keeps finding, and it is worse for being mine.

## Comparison with Developer 2 — **BLOCKED, and it must not be faked**

I have Developer 2's *aggregate* CORS figure (39/27/5) and **no per-function list from them for
drift**. Per standing rule 5, aggregates are not evidence of agreement.

**What I need from Developer 2, and it is one file:** their per-function verdict for all 71 —
`slug → MATCH | HEADER-ONLY | DRIFT | UNKNOWN` — plus **which endpoint hash** and **which reading**
(strict or import-map-excluded) produced it. `DRIFT_PER_FUNCTION_BUCKETS.tsv` is published in that
exact shape so the diff is a one-line `join`.

**Status: BLOCKED pending Developer 2's per-function list.** Reported and skipped, not used to stop
the order. **I will not report agreement from matching totals.**

---

# `702e5ce` — dispute WITHDRAWN. §23.5.3 stands.

> ⚠ **WITHDRAWN 2026-08-30 on compiler ruling (C-23). Original text preserved below the line.**
>
> **The re-class is declined and I accept the ruling.** The label **`staging @ 702e5ce` is
> accurate**: `702e5ce` **is** a commit on `origin/staging` — `git branch -a --contains` lists
> `origin/staging` among its containing refs, which I measured myself and then argued past. The
> §23.5.3 classification of `21/21/29/0` as **VERIFIED-as-of-date** **stands unchanged.**
>
> **What was wrong was my framing, not the arithmetic.** I took a true ancestry measurement and
> attached to it an inference — *"therefore the label misdescribes the endpoint"* — that the
> measurement does not support. A commit can be both on `staging` and not a descendant of `main`;
> the label names the branch, not the ancestry. **Withdrawing the framing, keeping the measurement.**
>
> **The measurement itself is unaffected and is retained below**, because it is still the reason
> `main..702e5ce` = 98 files is **not** a subset of the RC's 138 and must never be described as one.

**RETAINED MEASUREMENT (unchanged, still true, still load-bearing for the file-count trap):**

- `b671e1fb` (`main`) is not an ancestor of `702e5ce`; `702e5ce` is not an ancestor of `b671e1fb`.
- Their merge-base is **`32930e75`** (2026-08-22); they were joined by **`9faf5a17 Merge branch
  'main' into staging`**.
- Two commits on `main` are absent from `702e5ce`.
- `702e5ce` **is** contained in `origin/staging` (and in `altisinfonet-patch-35` and a `claude/…`
  branch).
- Under `supabase/functions/`, `702e5ce` differs from the RC by **one** file —
  `send-gift-credit/index.ts` — the one function whose verdict moves between the lanes.

**Consequence that survives:** `main..702e5ce` = 98 files is a symmetric difference against a
divergent tip, **not** "the first 98 of the eventual 138". That sentence remains forbidden. Nothing
else from the withdrawn section is carried forward.
> ⛔ **C-23 EXTENDED — 2026-08-30, AND THIS ONE IS ENTIRELY MINE.**
>
> When I withdrew the `702e5ce` framing I **kept** a "consequence that survives":
> ~~"`main..702e5ce` = 98 files is a symmetric difference against a divergent tip, not 'the first 98
> of the eventual 138'. Any statement of the form 'the baseline covered 98 of the 138 files' is false
> and must not be written."~~ **That retained claim is FALSE and is withdrawn.**
>
> **I never ran the subset test. I inferred it from the merge-base.** Measured now:
>
> ```
> comm -23 <(git diff --name-only main 702e5ce | sort) <(git diff --name-only main a42b209e | sort) | wc -l
> -> 0
> ```
>
> **All 98 paths ARE members of the 138. The 98 are a strict subset.** "The baseline covered 98 of
> the 138 files" is **true**, and I forbade writing a true sentence.
>
> **And the compiler's C-23 went further than I credited:** `702e5ce` **is an ancestor of the RC** —
> `git merge-base --is-ancestor 702e5ce a42b209e` returns true, through staging's own first-parent
> line via `fe4505aa`, and it appears in the ledger's §5.4 commit manifest. It is not a divergent
> tip at all with respect to the release; it is an earlier point on staging's line.
>
> **What is left of the original measurement, and it is only this:** `702e5ce` is **not a descendant
> of `main`** (their merge-base is `32930e75`; `main` was merged into `staging` later at `9faf5a17`),
> so `main..702e5ce` is not a fast-forward range and its **line** counts do not compose with the
> RC's. **The path set does compose — it is a subset — and I said the opposite.**
>
> **The failure, named:** I withdrew a framing and retained the consequence I had drawn from it,
> without measuring the consequence. That is the same error as the "share four members" number
> earlier today — a claim written from reasoning inside a document about not doing that.

> ~~ORIGINAL, WITHDRAWN: "§23.5.3's VERIFIED-as-of-date class is DISPUTED … Proposed re-class …
> `21/21/29/0` is VERIFIED against the tree at `702e5ce…`, a commit **parallel to `main`** … It is
> not a measurement against an ancestor of the RC and must not be read as one. Recorded as DISPUTED
> until ruled."~~

# Pack rev9 — the uncovered file, measured not assumed

Per your instruction after the earlier generator defect, `132 − 131` was **enumerated**, not
inferred:

```
total files on disk (find . -type f)      : 132
files listed in MANIFEST.sha256           : 131
difference                                 : 1
THE UNCOVERED FILE(S), ENUMERATED         : ['MANIFEST.sha256']
is it exactly and only the pack-root manifest? : True
files in manifest but NOT on disk          : NONE
```

Nested manifests, which the earlier defect had silently excluded:

| Path | in manifest |
|---|---|
| `01_WO1/MANIFEST.sha256` | **True** |
| `05_INSTRUMENTS/MANIFEST.sha256` | **True** |
| `MANIFEST.sha256` (pack root) | False — **the one intended exclusion** |

**Confirmed: the single uncovered file is the pack-root manifest itself and nothing else.** The set
difference was computed both ways; the reverse direction is empty.

---

# Rulings and rules recorded

| Ref | Recorded |
|---|---|
| **Standing rule 5** | *Matching totals are never evidence of agreement — only a per-item comparison is.* **ADOPTED.** Applied above: F-35 ↔ CORS census cross-checked by set, not count; Developer 2 drift comparison held BLOCKED rather than inferred from aggregates |
| **C-21** | *"B13 15a/15b"* re-rendered as **runbook steps 15a/15b (§12)**; 15b implements §23.5.1 condition 5. **11 occurrences across 6 files**, originals preserved. `B13 condition 4` left untouched as ruled. The 15a rendering is **derived**, not ruled, and flagged as such in every C-21 block |
| **C-22** | The compiler's over-escalation of F-29. **Recorded as the compiler's own, at their instruction.** F-29 downgraded |
| **F-36** | *The promotion's safety rests on a GitHub environment setting outside the 138 files, changeable in the UI without a commit.* **Recorded.** It is not reviewed by this release and cannot be |
| **F-30** | *An instrument that produces a published number ships with the number.* Applied to every instrument in this return |
| **Residual adopted** | **Scope the `ANDROID_*` secrets** — move them out of repository scope into an environment. Trigger analysis cannot close that; only scope can |

**Next: Lanes A, B and C.**
