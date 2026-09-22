# Pass-2 material accepted — and the auditor's prediction, registered before the join runs

Date: 2026-08-30
Role: auditor. Written **before** the join is performed, deliberately, so it cannot be adjusted afterwards.

---

## 1. Developer 2's Pass-2 emission — ACCEPTED

`SESSION2_PERFILE_PARTITION_DERIVED_AFTER_CONTACT.tsv` · 11,441 B · 71 rows · `sha256 b47be0ae31949c674f3dfefbe5658fc01d563aacf2ffd9065ffe2baabaf203f5` · parent `6588bca5…56e3` frozen 16:22:20Z (BLIND), re-verified unchanged · project path `claude/SESSION2_PERFILE_PARTITION_DERIVED_AFTER_CONTACT_2026-08-30.tsv`.

**The provenance split is the reason this is usable, and it was not asked for.** Developer 2 separated the two halves rather than presenting them as one artefact:

- **E1 per-file columns** — lifted verbatim from `census.json`, written ~14:05Z, **blind**.
- **E3 per-file columns** — a **re-run**, because `census.json` stored per-file detail for E1 only, and Pass 2 needs it at E3.

**The control that makes the re-run acceptable:** it reproduces the frozen `bucket_vs_E3` column for all 71 functions exactly. It therefore **adds detail, not verdicts.** Same unmodified comparator, same frozen inputs, no definition changed, no threshold tuned.

**And the strongest evidence of non-tuning is the answer itself.** Developer 2 had two numbers in view — **21**, which reached them through the contamination, and **27**, their own blind secureHeaders count. They produced **22**. Neither. A session steering toward agreement lands on a number it has seen.

**I checked their arithmetic rather than accepting it.** At E3: 21 MATCH / 50 DRIFT. Of the 50 — **22** header-only + **5** carrying `secureHeaders.ts` but differing in more + **23** carrying no `secureHeaders.ts` at all = **50** ✓. And 22 + 5 = **27**, their blind count of bundles carrying the file ✓. Both identities close exactly. Independently consistent with F-35.

---

## 2. Their pre-registered discrepancy — correct method, and its premise does not arise

Developer 2 predicted: *if* Developer 1's HEADER-ONLY set has 27 members, the gap is `create-payment-session`, `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, and it would be a **vocabulary boundary — Pass 2, not Pass 1.**

**Registering the expected discrepancy and its exact location before the comparison is the correct method**, and I want it recorded as such regardless of outcome. It makes the join falsifiable: if a gap appears somewhere else, something other than vocabulary is wrong.

**The premise does not arise.** From Developer 1's published `claude/F34_F35_DRIFT_RECONCILIATION_2026-08-30.md`, which I read directly rather than relaying: their `HEADER-ONLY` at `702e5ce` is 21, at **`a42b209e` it is 22**, and the symmetric difference between those two is exactly `send-gift-credit`. **At the true RC, Developer 1's HEADER-ONLY is 22, not 27.**

So Developer 1's classifier is **finer than the naive "carries `secureHeaders.ts` ⇒ header-only"** rule that would have produced 27 — which is precisely the distinction Developer 2's five-function table describes. The two accounts are consistent in structure. That is not agreement; it is a reason the join is worth running.

**Their four s3-\* explanation cross-checks F-34 independently:** those four differ in more than `secureHeaders.ts` because the RC's `_shared/s3.ts` arrives carrying the storage-lane guard. The four s3-* functions are among the ten the RC guards. Two findings from different rounds, consistent without being made to be.

---

## 3. THE PREDICTION — registered now, before the join, by the auditor

Both sessions now report, at endpoint `a42b209e`, independently:

| | Developer 1 | Developer 2 |
|---|---|---|
| MATCH | **21** | **21** |
| header-only | **22** | **22** |

**This is the closest the two instruments have come, and it is therefore the moment of maximum temptation.** Rule 5 exists for exactly this: *matching totals are never evidence of agreement.* We have already seen, inside a single instrument, **two sets of 21 with overlap zero.**

**My prediction, so that it cannot be adjusted after the result:**

1. **MATCH(Dev 1, `a42b209e`) and MATCH(Dev 2, E3) are the same 21 functions — symmetric difference EMPTY.**
2. **HEADER-ONLY(Dev 1, `a42b209e`) and Dev 2's `e3_only_differing_file_is_secureHeaders = yes` set are the same 22 functions — symmetric difference EMPTY.**
3. **UNKNOWN is empty on Developer 1's side and has no counterpart on Developer 2's; it is reported separately and never folded.**

**If prediction 1 fails, that is a genuine measurement disagreement and it outranks every other open item in the evidence track — including the merge question.** Two instruments that agree on a total and disagree on membership would mean neither drift figure in this engagement can be trusted.

**If prediction 2 fails while 1 holds, that is a vocabulary boundary — Pass 2 — and it is resolved by naming which files each side counts, not by re-measuring.**

**Report both directions, by function name. Do not report a count.**

---

## 4. Two things that must reach the sessions before the join

### 4a. The correction did not reach the project copy

Developer 1 applied C-23 and recorded it "beside the original in both `12_ENDPOINT_REGISTER/` and `15_F34_F35_DRIFT_RECON/`" — **inside the pack.** The project document `claude/F34_F35_DRIFT_RECONCILIATION_2026-08-30.md` still reads:

> "**DISPUTED:** the **class**… `702e5ce` is on a **divergent** line."

**The pack has the correction; the project does not.** The project is what the independent auditor and every future session read. **F-39: a correction applied in one artefact store and not the other is not applied.** Developer 1 must append the C-23 note to the project copy, original preserved.

### 4b. Developer 2 was contaminated with a claim that has since been retracted

The contamination included *"the commit `702e5ceb…` with claims about its ancestry."* Those claims are the **withdrawn** ones — "parallel to `main`", "divergent line". That framing was mine, I withdrew it in C-23, and the ruling is: `702e5ce` is a commit on `origin/staging`; the label `staging @ 702e5ce` is accurate; §23.5.3 stands.

**Developer 2 must be told explicitly, so a retracted claim is not carried forward as background knowledge.**

---

## 5. The one action that unblocks everything

`DRIFT_PER_FUNCTION_BUCKETS.tsv` is **still not in the project.** I searched it myself: the hits are Developer 1's `.md` documents, not the TSV. Developer 2 cannot reach it, and per rule 9 must not go looking.

**Developer 1: publish it with `project_write` at exactly `claude/DRIFT_PER_FUNCTION_BUCKETS_2026-08-30.tsv`.** Developer 2 reads **that path and only that path**, verifies `sha256 951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da` / 3,623 B / 72 lines on read, and says so if it does not match.

Developer 2 already holds the expected hash and has stated it will verify before joining. That is the correct handling and needs no instruction.

---

## 6. Completion

Unchanged: **2.65 / 9 ≈ 29%.** The Pass-2 material is real progress on G5, but **G5's remaining 0.1 is the join, and the join has not run.** No credit for materials.

Classification: OWNER-ATTESTED estimate, basis in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md` as corrected by C-25.
