# FINAL AUDIT OPINION — RC-20260829-05, promotion of `staging` to `main` (PR #104)

**Issued by:** the compiler/audit session (Claude), acting as internal auditor.
**Date:** 2026-08-30.
**Addressed to:** the independent human auditor, via the owner.
**Repository state at issue:** `main` `b671e1fb0c5bcf145d442076c229eca888afd674` · candidate `a42b209e4f70a6efed4f3dcdb654e0f994416594` · ledger `docs/PROMOTION_LEDGER.md` sha256 `f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943`, 182,502 bytes, REV-16 — re-verified in my container on the day of issue.
**No commit, tag, push, merge, deployment, migration or provider write has occurred at any point in this engagement.**

---

## 0. What this document is, and what it is not

This is my **opinion**, which is the deliverable an audit ends with. Until now I had issued twenty-odd incremental rulings and never a consolidated opinion; that was the gap.

**Three things I cannot do, structurally, and they are not oversights:**

1. **I cannot close a §25 row.** §25.4, the owner's own rule: *"No row below may be marked closed by the compiler. The compiler is not a second party."* Everything I measured myself is **OWNER-ATTESTED** by construction and stays there.
2. **I cannot sign §11.** That is the owner's signature.
3. **I cannot run the runbook §5.3 probe.** It is a production operation and every standing constraint forbids it.

Everything else within an internal auditor's remit is complete and is set out below.

---

## 1. OPINION

**The current release candidate must not be merged.**

Not on process grounds, and not because evidence is incomplete. On one specific, measured ground:

> `apply-migration.yml` is inside the 138-file promotion scope. At the candidate it binds `environment: ${{ inputs.target }}`, chosen by whoever dispatches it. The GitHub `production` environment holds the repository's **only** database credential, `SUPABASE_DB_URL`, and permits **only the `main` branch**. Its **required reviewers are off, its wait timer is off, and administrator bypass is on**. The workflow's `run:` block contains an unescaped shell construct.
>
> **Merging places that file on `main`, which is the sole precondition for it to execute against the production environment and read that credential. Nothing then stands between a dispatch and production SQL that a human must approve.**

This was originally inferred from workflow source. It is now **measured independently from provider configuration**, and the two agree.

**A replacement candidate exists** — branch `rc-replacement/option2-2026-08-30`, base `a42b209e`, three files, +36/−7, the construct quoted removed at both endpoints with a discriminating control, patch provenance recorded in its own commit message, unpushed, 0 remote refs. **It closes the construct. It does not close F-36** (below), which lives outside the repository entirely.

**My recommendation:** adopt the replacement candidate; obtain the independent auditor's rulings on §25; resolve the four items in §7 that no measurement can settle; then sign, tag and merge in the order §24 sets out.

---

## 2. Evidence register — what is actually established

### VERIFIED by two instruments that share no code

A second session measured the 71 deployed edge-function bundles **blind** — its own comparator, no sight of the first session's output, and it was never told any expected figure. Comparisons were made **by membership, not by count** (see §8, rule 5).

| Measurement | Instrument A | Instrument B (blind) |
|---|---|---|
| CORS classes across 71 bundles | 39 static-wildcard / 27 allowlist-gated / 5 neither | **identical** |
| `_shared/secureHeaders.ts` — distinct md5 values deployed | 1 — `58b9f45d5200a9b19f1b24011dfc3511` (1,507 B) | **identical** |
| Bundles carrying that file | 27 of 71 | **27 of 71**, membership identical, symmetric difference empty |
| Storage-lane assertion in deployed bundles | 0 of 71 | **0 of 71** |
| Functions MATCHing the candidate | 21 | **21**, membership identical |
| Functions differing only in `secureHeaders.ts` | 22 | **22**, membership identical |

I reconstructed the published per-function table in my own container: **3,623 bytes, 72 lines, sha256 `951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da`** — exact. Counting its columns myself:

- at the candidate, import-map-excluded: **21 MATCH / 22 header-only / 28 DRIFT / 0 UNKNOWN**
- at `702e5ce`, import-map-excluded: **21 / 21 / 29 / 0** — **the ledger's own B13 split (§23.5.3), rebuilt from primary per-function data.**

### Additional VERIFIED items

- The deployed `secureHeaders.ts` is **`main`'s version**. The candidate's version (`9e89d6fa…`) is deployed in **zero** bundles. This is the mechanical cause of 27 functions falling back to `Access-Control-Allow-Origin: *`.
- **Ten deployed functions reference the object store.** The candidate adds a lane assertion to twelve functions in source, ten of which are deployed — **exactly the ten §23.5.1 risk 3 names.**
- `hard-delete-competition` declares its **own inline** `getS3Settings(...)` — a fifth variant of the storage-settings loader, invisible to any census counting copies of `_shared/s3.ts`, and guardless. `purge-s3-orphans` bundles one of four distinct `s3.ts` variants, none containing the guard.
- **Fourteen deployed files, across nine functions, hash to no object on any of 226 refs.** Staleness was excluded by measurement, not asserted: the clone was refreshed, and a per-ref comparison shows all 119 remote heads matching sha for sha. The REST API is 403; the git protocol is not.
- No committed state anywhere in the history explains more than **57 of 71** deployed bundles.

### OWNER-ATTESTED — measured by me, therefore not closable by me

The four §25.3 infrastructure rows, in §5 below, with their as-of times and their limits.

### INFERRED, and marked so

- Any drift figure recomputed from the first session's output files **before 2026-08-30** — including the independent auditor's own corroboration, which used those files and therefore inherited their instrument.

### BLOCKED

- Nothing remains blocked for want of measurement. What remains is blocked for want of **rulings and signatures**.

---

## 3. The merge finding, fully specified

| Element | State | Class |
|---|---|---|
| `apply-migration.yml` on `main` today | `workflow_dispatch`, no branch filter, no `if:`, no `github.ref` guard | VERIFIED |
| `environment:` line on `main` today | commented out — `SUPABASE_DB_URL` resolves empty, job's first step exits 1 | VERIFIED |
| `environment:` line at the candidate | live — `environment: ${{ inputs.target }}`, chosen by the dispatcher | VERIFIED |
| `verify-schema-dependencies.yml` on `main` | **does not exist — the merge creates it** | VERIFIED |
| `SUPABASE_DB_URL` location | `production` environment only; **not** a repository secret | OWNER-ATTESTED, 2026-08-30T13:55:48Z |
| `production` permitted branches | **`main` only**, 1 branch, 0 tags | OWNER-ATTESTED, 2026-08-30T13:52:07Z |
| `production` required reviewers / wait timer | **OFF / OFF** | OWNER-ATTESTED, 2026-08-30T13:52:07Z |
| Administrator bypass, both environments | **ON** | OWNER-ATTESTED, 2026-08-30T13:52:07Z |
| Repository secrets | four `ANDROID_*` only | OWNER-ATTESTED, 2026-08-30T13:55:48Z |
| `staging` environment secrets | **none** | OWNER-ATTESTED, 2026-08-30T13:50:48Z |

**Two consequences the owner should not have to derive.**

**F-36 — the control is outside the reviewed scope.** What stands between a dispatch and production SQL, once the candidate's `environment:` line is live, is a **GitHub environment setting**: not in the 138 files, not under review, not version-controlled, and changeable in the UI without leaving a commit. The patches cannot reach it.

**F-42 — the staging path does not function.** §24.1 pre-promotion step 4 requires: *"Confirm a `staging` Environment exists with its own `SUPABASE_DB_URL` … or `apply-migration.yml target=staging` cannot run."* The environment exists and holds no secrets. **`target=staging` yields an empty credential and dies; `target=production` is the only target that works.** The safer alternative path is not merely unused — it does not exist.

**Also standing, with a measured reason: no pull request may be opened from the replacement branch.** Four workflows carry `pull_request: branches: [main, staging]`. A push fires none; a PR fires four.

---

## 4. A production condition that is not a release item

`assertStorageLane` appears in **zero of 71** deployed bundles — measured by two instruments, one of them the independent auditor's own substring search. Ten deployed functions touch the object store; none carries a lane assertion. This includes `purge-s3-orphans` (destructive) and `detect-orphan-files` (read-only, and a safety-critical input to it).

**This is true today, was true before this release was contemplated, and the merge does not change it** — §23.5.1 condition 2 excludes all edge-function deployment from this promotion. **It should be tracked on its own line and must not be used either to delay the release or to justify it.**

**A wording correction the ledger needs.** §23.5.1 risk 3 reads *"The storage-lane guard is absent in ten functions."* The sentence is true and points the wrong way: it implies the other 61 have the guard; none of the 71 does, and the ten named are **the ten the release fixes, not the ten it leaves behind.** §28.3 tidy-list item or a correction at promotion — **not** a re-taking of B13, whose substance is sound.

---

## 5. §25.3 rows 1.4, 1.5, 1.6b, 1.6c — captured, with as-of times and stated limits

Captured by me in the owner's browser, read-only. **No secret, token, key or credential value was viewed or requested** — names, scopes and configuration states only. Nothing was created, edited, saved, rolled, deleted or purchased.

**A negative measurement carries its as-of time.** Positives are durable; negatives decay. These were originally sent undated; corrected here.

| Row | Result | As-of (UTC) |
|---|---|---|
| 1.4 | No R2 token spans both `50mm` and `50mm-staging` — bucket-level lane separation holds at the token layer | **13:46:13Z** |
| 1.4 | `staging-upload` (Account token) → `50mm-staging`; `50mm` (**User** token) → `50mm`, production; `AgentCRM` → `agentcrm`. All Object Read & Write | **13:46:13Z** |
| 1.6b | `isolation-probe/` — 0 objects, `50mm` | **13:46:54Z** |
| 1.6b | `isolation-probe/` — 0 objects, `50mm-staging` | **13:47:52Z** |
| 1.6c | 0 reusable Access policies; 1 legacy policy; no Access application covers `staging.50mmretina.com` | **13:49:22Z – 13:49:55Z** |
| 1.5 | `staging` environment — no secrets, no variables | **13:50:48Z** |
| 1.5 | `production` — no required reviewers, no wait timer; branches: `main` only; secret: `SUPABASE_DB_URL` | **13:52:07Z** |
| 1.5 | `SUPABASE_DB_URL` **not** among repository secrets; 0 repository variables | **13:55:48Z – 13:56:30Z** |

### Limits I must state, having read §25.4 verbatim

- **Row 4 is partially covered, not covered.** §25.4 asks whether token `staging-upload` (`73a7920647481fd93553f9c1f68bf5a3`) has **exactly one** policy and **no policy naming `50mm`**. I captured the dashboard **list** view, which is consistent with that claim but is not that claim. I did not open the token to count its policies, and did not verify the token id.
- **Row 6b is after-only.** §25.4 records that **no before-baseline exists for run `33079091310` and none can be created retroactively**, and that the missing baseline *"must be recorded, not glossed."* My result shows nothing is under that prefix **now**; it cannot show nothing was ever written there.
- **Row 6c is a first measurement and is not a pass.** §25.4 requires first measurement **by a second party**. I am not one.
- **A trap in row 1.6c.** The Access **Applications** page shows a plan paywall that reads as "nothing is configured." The **Legacy policies** tab shows one live application, created 2026-08-22, MFA off, covering `*.lens-lustre-learn-claude.pages.dev`. **Anyone repeating this check must open the Legacy tab.** I nearly recorded the confident wrong answer.

### Observations outside these rows, recorded so they are not lost

Both R2 buckets report **Public Access: Enabled**; production holds a `national-ids/` prefix. The Cloudflare profile carries 11 user API tokens and an active, entirely unscoped **Global API Key**. **Production-hygiene items, not release items.**

---

## 6. Instrument defects found in our own tooling — disclosed in full

An auditor should assume the tools that produced the evidence are themselves suspect. Ours were, in five ways, all found and all corrected:

- **A lexer treated apostrophes as string delimiters.** Odd counts crashed loudly (four functions); **even counts mis-parsed silently.** Repaired, proven against a planted defect, re-run across all 71.
- **The harness recorded an internal problem flag and never surfaced it**, so four records carried definite verdicts derived from a step that had failed.
- **F-40** — the drift closure could not see a file that is *shipped but never imported*. A 2-byte `deno.json`, byte-identical on both sides, was counted as a difference by path-set membership. **Two verdicts of 71 were wrong.**
- **F-41 — and this is the one an auditor should weigh most.** For **18 of 71 records the published DRIFT verdict rested on no content comparison at all**; the classifier compared path sets and returned before hashing. It was right for 16 of them **by accident of ordering — the evidence confirming them did not exist until it was measured**. All 18 are now content-confirmed.
- **The Option 2 patches did not apply.** Every tool, every invocation: the diff method wrote a scratch path onto the `+++` line. Caught by testing them before use; had they not been tested, the first evidence would have arrived during the only write operation in the plan.

**Bearing on your own work:** the drift totals you corroborated at rev6 were recomputed from our output files and therefore inherited our instrument. At that time they were partly unevidenced. **They are evidenced now**, and the corrected reading is in §2.

---

## 7. What remains, mapped to §24 — the ledger's own sequence, not my summary

I previously reported progress against nine gates **of my own construction**. §24 is authoritative and has sixteen numbered steps. **Every percentage I have given was a summary of a summary.** Against §24.1 — everything before the merge button:

| §24.1 step | State |
|---|---|
| 1 · D-9 / AF-15 — UI gate | ✅ RULED and EXECUTED (`bfcb68da` + `c8aec5d5`, CI-green) |
| 2 · D-8 / AF-11 — ACAO | ✅ RULED |
| 3 · G8 | ✅ waived, D-12 |
| **4 · `staging` Environment with its own `SUPABASE_DB_URL`** | **✗ FAILS — F-42, measured 13:56:30Z** |
| 5 · B8, B11, B12, B13, D-5 | ✅ ALL RULED |
| 6 · runbook §5.3 secret-isolation probe | ✗ un-run. §5.3.6 requires it **immediately before** promotion; run early it goes stale and must be repeated |
| 6a · re-confirm CI on the head existing at the freeze point | ✗ unowned. A re-read, not a re-test. **If a replacement candidate is adopted, it must be re-read on that head** |
| 7 · §11 signed → freeze → `git rev-parse staging` → tag, **before** the merge | ✗ unsigned, 0 tags |

Plus **§25**, which gates §11.

### Two internal inconsistencies in the ledger, for your ruling — I report, I do not resolve

**(a) D-6 — landed or not landed?** §22's decision row reads *"RULED · RESOLUTION PREPARED AND VERIFIED · **COMMIT NOT LANDED**"*; the REV-6 changelog reads *"**D-6 EXECUTED.** Merge `9faf5a17` … landed"*; and §24.2 step 8 still lists it as a promotion-time action that *"creates a commit; the merged tree will differ from T."* §20 asserts tree equality **against the tag**, so this is not cosmetic. **Resolve before §11 is signed.**

**(b) §11's stated precondition appears superseded.** The block carries *"Cannot be signed while G8 and AF-15 are unresolved."* Both are now resolved. Per the §11 header the live preconditions are the **§5.3 probe** and **§25**.

---

## 8. The exit condition — and the question nobody has asked you

§25.7.3, verbatim:

> "§25 moves from **PARTIAL** to **CLOSED** when every §25.3 row is either **verified** or **recorded as a named residual risk the owner has accepted in writing** — the D-12 / B13 pattern. **Blocker 9 does not close on effort; it closes on those eight rows.**"

**There are two routes, and the second is the owner's, in writing, per row.** It is not a bypass — it is the exit condition the owner wrote, and the pattern already used twice in this ledger.

**But §25.4 says, of the two items that are not infrastructure rows:**

> "no party has independently reviewed the **138 changed files** or re-run the test suite … **§26 blocker 9 cannot honestly close while that is true.**"

**Those two sentences point in different directions and I will not reconcile them by choosing the convenient reading.**

> **The question for the independent auditor, and it sets the entire remaining timeline:**
> **Does blocker 9 close on the eight §25.3 rows alone — with un-verified rows accepted in writing by the owner as named residual risks — or must the 138-file review and the independent test-suite run complete first?**

**It has never been asked. Nothing else in this engagement now depends on measurement; this depends on a ruling.**

---

## 9. The rules this engagement produced

Offered because they generalise beyond this release.

1. A suite never shown to detect a planted defect is not evidence about that class.
2. A check sharing its exclusion rule with the thing it checks is not a check.
3. An abbreviated hash is not a hash. Where it is recorded rather than read, it goes in full.
4. **Parent rule — compression is where scope falls off.** Every error in this engagement was in a shortened restatement, never in a measured full form.
5. Matching totals are never evidence of agreement. Only a per-item comparison is. *(Its first save: two sets of 21 inside one instrument proved **disjoint**.)*
6. Counting copies of a shared module does not find reimplementations of it.
7. A measured figure belongs in a table with its basis. A figure that exists only inside a sentence is INFERRED until found in a table.
8. A patch never shown to apply is not a patch.
9. A blind session is given an exact path **and the expected sha256 and byte count**. Identity is settled by the digest; the path is only an address.
10. The pack is the single source of truth; a correction sweep republishes every affected copy in the same action.
11. When a premise is withdrawn, **every conclusion drawn from it is withdrawn with it** until independently re-measured. Retention is a new claim.
12. Quoted code, hashes and clause text are verified character-for-character against the source they claim to quote. A quotation is a measurement.
13. **A negative measurement carries its as-of time.** "Not present", "zero of N" without a timestamp is not a measurement.
14. A diff is not a vector. Line counts compose additively only when every patched file exists at both endpoints of the outer range.

---

## 10. My own corrections — disclosed because you are weighing how much of this to trust

Ten corrections recorded against myself, all one shape: **a plausible completion written in place of a measurement.**

C-18 (mis-cited §23.5.1 as "B13 condition 2" throughout, which made a proposed fast-close rest on a clause that expressly forbids that use — **the fast-close option was withdrawn as invalid, not declined**) · C-19 (inferred where staging's credentials come from without opening the page) · C-22 (jumped from a secret being *available* to a branch to it being *reachable* by injected code) · C-23 (called `702e5ce` "parallel to main" — it is on staging's first-parent line and an ancestor of the candidate) · C-24 (read an implicature — "ten named implies 61 covered" — as a ledger statement) · C-25 (claimed a replacement candidate would reset the 138-file review; measurement shows it costs a three-file, 43-line delta) · C-26 (withdrew a premise and then **blessed** the survival of a conclusion drawn from it, without asking for the one command that settles it) · C-27 (ordered a bound by **count** when the property is a **set** — my question would have missed `auth-email-hook`, which has equal counts and unequal sets).

**Three of these you caught before I did. I have not caught you once.**

**The practical guidance that follows: verify the negatives and the quotations first. That is where every defect in this engagement has been.**

---

## 11. Recommendation

1. **Do not merge the current candidate.**
2. **Answer the §8 question.** It sets the timeline and nothing else does.
3. **Rule on the §25.3 rows one at a time** — verified by you, or accepted in writing by the owner as a named residual risk. Rows describing live production behaviour (database policy states, deployed function state) are poor candidates for the second route; the four configuration rows in §5 are reasonable ones.
4. **Resolve F-42** — either provision `SUPABASE_DB_URL` on the `staging` environment, or record in writing that the staging migration path is inoperative for this release. Leaving step 4 silently unmet is the only option not available.
5. **Resolve the D-6 inconsistency** before §11 is signed.
6. **Adopt the replacement candidate**, then re-read CI on that head, then §5.3 probe, then §11, then freeze, then tag, then merge — in that order, per §24.
7. **Open C-14-L, F-36 and the production-hygiene items on their own track**, and do not let them delay or justify the promotion.

---

*Issued as an internal audit opinion. It closes no §25 row, signs no record, and authorises nothing.*
