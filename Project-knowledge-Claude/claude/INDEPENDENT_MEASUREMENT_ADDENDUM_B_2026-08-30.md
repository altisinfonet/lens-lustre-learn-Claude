# Addendum B — third endpoint, F-32 resolved, two new censuses

Companion to *Independent measurement — 71 production edge-function bundles* and *Addendum A*, same session. Read-only throughout: no production write, no branch, commit, push, merge, tag, deploy or migration; no existing file modified; `docs/PROMOTION_LEDGER.md` read, not edited; no secret, token or credential reproduced. No other session's report, pack, or totals document opened. No expected total reached me, and I did not ask for one.

Definitions unchanged from §1 of the main report. Two new instruments are added in B4 and B5, each with its construct stated before its result and each proved on planted defects. Self-test now **21 assertions, 21 pass**.

---

## B1 · Task 1 against `a42b209e` — and the tree-identity claim, checked rather than accepted

You told me the two RC hashes share a `supabase/functions` tree. That is an input, so I verified it before using it:

```
a42b209e  supabase/functions : c7876a89b31a4f92b822e127f7f651e13c71667c
25c0456   supabase/functions : c7876a89b31a4f92b822e127f7f651e13c71667c
main      supabase/functions : a5528524a5214c9afce1a9654eaff8594bda8aa2

$ git diff --name-only 25c0456 a42b209e -- supabase/functions
(0 files)
```

Confirmed. The two commits differ in **5 paths total**, none under `supabase/functions`: `.gitleaks.toml`, `docs/PROMOTION_LEDGER.md` (added), two `src/components/*Tooltip.tsx`, and one new test. `a42b209e` — *"fix(security): allowlist the STAGING anon key too — AF-19"*, 2026-08-29 13:45 +0530 — is an ancestor of `origin/staging` and appears on `refs/pull/104/head`. It is **not** an ancestor of `main`.

I then ran Task 1 against it for real rather than inferring the answer from the tree hash: checked `a42b209e` out to its own worktree (2,113 files) and ran the unmodified tool.

### The three endpoints, side by side

| | **E1 destination** | **E2 candidate (earlier hash)** | **E3 candidate (true RC)** |
|---|---|---|---|
| commit | `b671e1fb0c5bcf145d442076c229eca888afd674` | `25c0456011451f644def7ef5361904e4de25dd08` | `a42b209e4f70a6efed4f3dcdb654e0f994416594` |
| `supabase/functions` tree | `a5528524a521…` | `c7876a89b31a…` | `c7876a89b31a…` |
| role | destination of the proposed promotion (`main`) | RC as recorded in ledger §1 | true RC |
| **deployed bundles MATCH (strict bytes)** | **55 / 71** | **21 / 71** | **21 / 71** |
| **DRIFT** | 16 | 50 | 50 |
| MATCH with the stated deploy-rewrite allowance | 56 / 71 | 21 / 71 | 21 / 71 |

**All 71 per-function verdicts are identical between E2 and E3** — verified function by function, not asserted from the tree hash:

```
E3 a42b209e : {'MATCH': 21, 'DRIFT': 50}
functions whose E3 verdict differs from the E2 verdict: NONE — all 71 identical
```

Context from Addendum A, unchanged: no single committed state anywhere in the repository's history explains more than **57 of 71**, and 10 bundles are explained by no committed state at all. E1 explains 56, E3 explains 21.

**Status: VERIFIED.**

---

## B2 · F-32 — the clone question is resolved, not blocked

You asked for `git fetch --all --tags --prune`, a re-check, and a stale/not-stale answer; and for BLOCKED if the 403 still prevented confirming the clone matches origin. Ran it verbatim:

```
$ git fetch --all --tags --prune
exit=0
refs 226 -> 226 ; commits 1665 -> 1665 ; objects 10935 -> 10935
```

No change, because Addendum A had already fetched everything the previous night's clone was missing. For the record, the staleness answer in full:

| | as staged from the machine | after full fetch |
|---|---|---|
| refs | 122 | **226** |
| commits | 1,663 | 1,665 |
| named objects | 9,265 | **9,270** |

**The clone WAS stale — it was missing all 106 `refs/pull/*` refs.** It was never shallow (`is-shallow-repository` → `false`, no `.git/shallow`, no partial-clone filter, no alternates, `git fsck --connectivity-only` clean).

**The 403 does not block confirmation.** The GitHub *REST* API is still 403 for this token; the *git protocol* is not, which I had not tried in the first report. Per-ref comparison against origin, just now:

```
remote heads: 119   local origin/*: 119 (+1 symref row)
rows present remotely but not locally, or differing sha : NONE
rows present locally but not remotely, or differing sha : NONE
identical rows: 119
```

**Every one of origin's 119 branch heads matches this clone, sha for sha.** Ledger row 14 is **VERIFIED**, not BLOCKED.

### Re-check of the unsourced files

Against the complete object database: **183 deployed files, 167 corroborated, 16 not found — byte-for-byte the same 16 as before the fetch.** The 104 new refs contributed 5 named objects and explained nothing. **Staleness is excluded by measurement.**

Addendum A then removed two of the 16 for reasons that had nothing to do with staleness — `purge-s3-orphans/index.ts` (a deploy-time `../_shared/` → `./_shared/` rewrite) and `backfill-image-dims/index.ts` (two runs of 71 `═` where the repo has 75, a correlated-transcription risk I cannot exclude, carried as INFERRED). Transcription was separately re-tested with four fresh couriers: **45 files, three independent transcriptions, 45 unanimous, 0 disagreements.**

**F-32, final: 14 files across 9 functions carry deployed content that exists in no commit on any of the 226 refs of a clone now confirmed identical to origin.** `auth-email-hook` (1), `delete-my-account` (1), `delete-user` (1), `measure-post-media` (2), `media-register-upload` (3), `migrate-post-media` (3), `process-email-queue` (1), `purge-s3-orphans` (1), `send-reengagement-emails` (1). Quotable.

---

## B3 · F-31 — answered in Addendum A; restated with the number you asked for

**How many of the 71 bundles are hybrids assembled from more than one source version? Zero.**

The test: a bundle is atomic if *any single commit on any ref* has a `supabase/functions` tree containing every file of the deployed bundle exactly as deployed. 1,665 commits collapse to **103 distinct trees**; intersect per bundle.

| | n |
|---|---|
| ATOMIC — one committed state contains the whole bundle | **61 / 71** |
| NON-ATOMIC — no single committed state does | 10 / 71 |
| …of those, every file committed but never together (**provable hybrid**) | **0** |
| …of those, at least one file committed nowhere (**undecidable**) | 10 |

Re-running the intersection over only the *committed* files of those ten still yields a non-empty set for every one of them. There is no evidence of non-atomic assembly anywhere in the 71. My original F-31 — `send-gift-credit` as an RC/`main` hybrid — is **retracted**; it came from comparing against two reference points instead of all 103. Its true provenance is a single state: functions-tree `2040d89345a4`, carried by `03ba3cf` / `da0184a` on branch **`origin/gift-credit-user-lookup`**, 2026-08-24 — a feature branch promoted to neither lane.

---

## B4 · `_shared/secureHeaders.ts` — md5 per bundle, and the distinct count

| | result |
|---|---|
| deployed bundles carrying `_shared/secureHeaders.ts` | **27 of 71** |
| deployed bundles not carrying it | 44 |
| **distinct md5 values among the 27** | **1** |
| that value | `58b9f45d5200a9b19f1b24011dfc3511` (1,507 bytes) |

The 27: `admin-export-db`, `admin-process-withdrawal`, `admin-secure-settings`, `apply-scheduled-boosts`, `autoscale-ad-traffic`, `backup-reminder`, `cast-photo-vote`, `complete-round`, `create-payment-session`, `dashboard-init`, `entry-final-votes`, `evaluate-round2`, `expire-gift-credits`, `get-payment-gateways-public`, `get-wallet-summary`, `get-wallet-transactions`, `manage-notifications`, `moderate-comment`, `paypal-capture-order`, `rank-feed`, `razorpay-verify-payment`, `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `send-gift-credit`, `submit-deposit`. Full per-bundle table in `out/secureheaders_md5.txt`.

Placed against the repository:

| state | md5 of `supabase/functions/_shared/secureHeaders.ts` |
|---|---|
| **`main` `b671e1fb`** | **`58b9f45d5200a9b19f1b24011dfc3511`** ← what all 27 deployed copies carry |
| RC `a42b209e` | `9e89d6fa8d9219c7ebda4657e8c5b6e1` |
| RC `25c0456` | `9e89d6fa8d9219c7ebda4657e8c5b6e1` |
| distinct versions of that path across all 226 refs | 4 (`58b9f45d…`, `9e89d6fa…`, `8e4425ba…`, `aa97faa0…`) |

**All 27 deployed copies are `main`'s version. The RC's version is deployed in zero bundles.** The RC rewrites this file substantially — `startsWith` prefix matching replaced by equality, `endsWith(".lovable.app")` replaced by an anchored https-only pattern, and a third response case in which a disallowed origin receives **no** `Access-Control-Allow-Origin` at all instead of `*`. None of that is in production. This is the mechanical explanation for §6.1 of the main report: 27 bundles category **G** with fallback `*`, and CORS class identical between deployed and `main` for all 71.

Uniformity here is the good news in this addendum: whatever else varies across the 71, this file does not. Contrast `_shared/imageDims.ts` (4 distinct versions live), `_shared/s3.ts` (4), `transactional-email-templates/registry.ts` (2).

**Status: VERIFIED.** Self-test D13 plants a one-byte change and requires the census to split 1 → 2 and name the bundle.

---

## B5 · Storage-lane assertion — the exact construct, then the count

### The construct I searched for

Stated before the result so it can be disputed. Implemented in `tool/lanecheck.py`, running over the same lexer code view as every other instrument, so **occurrences inside comments, string literals, template literals and JSX text do not count**. That distinction is not pedantic here: the file that defines the guard also names it in prose three times.

**D1 — named guard.** The identifier `assertStorageLane` appearing in code, as a definition (`function assertStorageLane`) or a call (`assertStorageLane(`).

**D2 — unnamed equivalent**, so the answer does not depend on the guard keeping its name: any of the lane constants `PRODUCTION_BUCKET`, `PRODUCTION_CDN_HOST`, `PRODUCTION_PROJECT_REF` appearing in code; **or** a `throw` within 400 characters of a code reference to `bucket_name`, `public_url` or `endpoint`.

A bundle counts as carrying an assertion if D1 or the D2 constants fire. I found the construct by discovery, not by being told: `assertLane`, `assertStorage`, `STORAGE_LANE`, `EXPECTED_BUCKET`, `S3_BUCKET`, `R2_BUCKET`, `LANE_`, `50mm-staging`, `cdn-staging`, `staging`, `isProd` all return zero across the deployed corpus; `assertStorage` returns 7 files at the RC and 0 at `main`, which located it.

### The result

| detector | deployed bundles firing |
|---|---|
| D1 — `assertStorageLane` in code | **0 of 71** |
| D2 — lane constants in code | **0 of 71** |
| D2b — `throw` near `bucket_name` / `public_url` / `endpoint` | **0 of 71** |
| **carrying a storage-lane assertion (D1 or D2)** | **0 of 71** |

### The detector is not simply broken — positive control on real inputs

Same detector, same code path, run over the repository bundles:

| repository state | bundles where D1 fires |
|---|---|
| `main` `b671e1fb` | **0 of 73** |
| RC `a42b209e` | **12 of 73** — `backfill-image-dims`, `backfill-media-objects`, `detect-orphan-files`, `hard-delete-competition`, `media-register-upload`, `media-verify-upload`, `migrate-storage`, `purge-s3-orphans`, `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload` |

D2 and D2b fire on the same 12. The zero in production is a real zero: the guard exists only on the candidate, and the candidate is not deployed.

### The exposure it maps to

Ten deployed bundles reference an S3/R2 storage symbol in code — `getS3Settings`, `listAllS3Objects`, `deleteS3Objects`, `putS3Object`, `copyS3Object`, `readS3ObjectHead`, `bucket_name`, `s3_storage_settings`, `presign`:

`backfill-image-dims`, `detect-orphan-files`, `hard-delete-competition`, `media-register-upload`, `migrate-storage`, `purge-s3-orphans`, `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`.

Those ten are **exactly** the deployed subset of the twelve that would carry the guard under the RC (the other two, `backfill-media-objects` and `media-verify-upload`, exist in the repository but are not deployed at all). **Ten production bundles touch the object store; zero of them carry a lane assertion.** Four of the ten carry a copy of `_shared/s3.ts`, in two distinct versions, neither of which contains the guard.

I report this and stop. What it implies for the promotion is the owner's and the auditor's call, not mine, and I have deliberately not read anything that would tell me what the number was expected to be.

**Status: VERIFIED** — instrument written and run by me; deployed inputs RELAYED with three-way independent transcription agreement, per Addendum A.

---

## B6 · Instrument proof, updated

`tool/selftest.py` — **21 assertions, 21 pass, 0 fail.** New since Addendum A:

| id | defect planted into a copy | required behaviour |
|---|---|---|
| D11a | none (baseline) | lane detector silent on the unmodified `s3-upload` bundle |
| D11b | `assertStorageLane(s3, Deno.env.get('SUPABASE_URL'));` appended to the deployed copy | D1 fires and names the file |
| D12 | the identical text placed in a `//` comment, a `/* */` comment, a template literal, and a string literal — plus `'PRODUCTION_BUCKET'` as a string | **nothing fires** |
| D13a | none (baseline) | md5 census: 27 bundles carry the file, 1 distinct value |
| D13b | `X-Frame-Options` → `X-Frame-Optionz` in one bundle's copy | census splits 1 → 2 and names `rank-feed` |
| D14 | none (positive control on real inputs) | detector silent at `main`, fires on 12 at the RC |

D12 is the one that matters most for B5: a zero is only worth reading if the detector can tell code from prose, and this codebase's prose is full of the exact string.

---

## B7 · Ledger rows

| # | Requirement | Instrument | Result | Status |
|---|---|---|---|---|
| 8d | Verify the claim that `25c0456` and `a42b209e` share a `supabase/functions` tree | `git rev-parse`, `git diff --name-only` | identical tree `c7876a89b31a…`; 0 files differ under `supabase/functions`; 5 paths differ elsewhere | **VERIFIED** |
| 8e | Task 1 vs **E3 `a42b209e`** (true RC) | `tool/run.py` on a fresh worktree | **21 / 71 MATCH, 50 DRIFT**; all 71 per-function verdicts identical to E2 | **VERIFIED** |
| 8f | Three endpoints side by side | as above | E1 55/71 · E2 21/71 · E3 21/71 (E1 56/71 with the stated deploy-rewrite allowance) | **VERIFIED** |
| 14 | Confirm the clone matches origin | `git fetch --all --tags --prune`, then per-ref `git ls-remote` comparison | all 119 remote heads match locally, sha for sha; REST still 403, git protocol is not | **VERIFIED** (was BLOCKED) |
| 18 | Was the clone stale, and does that explain F-32? | full fetch, then re-run the blob check | **Stale — 106 PR refs missing.** Explains nothing: 167/183 before and after, same 16 files | **VERIFIED** |
| 19 | F-32 final | blob search over 226 refs + Addendum A exclusions | **14 files / 9 functions** with no committed origin | **VERIFIED**; transport **RELAYED**, three-way unanimous |
| 22 | F-31 — bundles assembled from more than one source version | `tool/atomicity.py`, whole-history intersection | **0 provable hybrids**; 61 atomic, 10 undecidable through uncommitted content | **VERIFIED** |
| 25 | md5 of `_shared/secureHeaders.ts` per bundle, distinct count | `tool/` census + `md5sum` | 27 of 71 carry it; **1 distinct md5**, `58b9f45d5200a9b19f1b24011dfc3511`, = `main`'s version; the RC's `9e89d6fa…` is deployed nowhere | **VERIFIED** |
| 26 | Storage-lane assertion per bundle, construct named | `tool/lanecheck.py` (D1 `assertStorageLane` in code; D2 lane constants / `throw` near storage field) | **0 of 71 carry one.** Positive control: 0/73 at `main`, 12/73 at the RC | **VERIFIED** |
| 27 | Exposure the zero maps to | code-symbol scan over the lexer code view | **10 deployed bundles reference the object store; 0 carry a lane assertion.** Those ten are exactly the deployed subset of the RC's twelve | **VERIFIED** |
| 28 | Instrument proof after adding two instruments | `tool/selftest.py` | **21 pass, 0 fail** (was 15) | **VERIFIED** |

Unchanged: Task 2 (39 W · 27 G · 5 N; CORS class identical deployed vs `main` for all 71), Task 4 (JSX text child, comment, template literal all inert; 393/393 files lex clean).
