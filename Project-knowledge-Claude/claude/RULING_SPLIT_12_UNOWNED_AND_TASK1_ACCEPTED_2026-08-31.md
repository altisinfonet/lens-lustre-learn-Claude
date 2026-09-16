# Ruling — the 12 unowned files, the category ordering, the join rule, and WO-13 Task 1

Issued 2026-08-31 by the compiler/audit session. Every figure below was measured in this container against the working clone, not taken from either report.

---

## 1. The split did not add up. That is my defect, and Developer 1 was right not to claim the gap.

My wording — *"supabase/functions, workflows, config and the three patched paths"* vs *"the `src/` files"* — covers **126 of 138**. Twelve files belonged to neither half. **Recorded as C-29.**

Developer 1 measured the gap, published it, proposed a resolution, and **explicitly refused to claim the files unilaterally.** That is the correct handling of a scope defect: an unowned file silently absorbed by whoever notices it is how a review comes out at 138 with a hole in it.

**Verified here from the repository:**

```
supabase/functions 44 · src/components 29 · src/__tests__ 11 · scripts 10 · src/lib 9
.github/workflows 8 · functions 7 · supabase/rollback 5 · public 3 · supabase/migrations 2
src/pages 2 · docs 2 · vitest.config.ts, vite.config.ts, supabase/config.toml,
package.json, index.html, .gitleaks.toml 1 each                    → 138
```

Developer 1's 75 (44 + 8 + 8 + 7 + 7 + 1) and Developer 2's 51 (21 + 19 + 9 + 2) both reconcile. **75 + 51 + 12 = 138. Their arithmetic is correct.**

### RULING — the ten `scripts/` go to Developer 1

Their reason is right and I adopt it verbatim: **two of them are executed by their two HIGH workflows** — `verify-schema-dependencies.mjs` (+906) and `test-schema-dependencies.mjs` (+403), the largest non-ledger diffs in the range — and *"reviewing a workflow without the script it runs is reviewing half a path."*

**One thing Developer 1 does not know: I have already reviewed all ten from source**, in `claude/138_FILE_REVIEW_TRANCHE_2_2026-08-31.md`. **This is deliberately not a reason to skip them.** Their pass becomes a **second independent reading of the ten highest-risk scripts**, and if their claims disagree with mine that disagreement is signal. **Developer 1 must not read my tranche 2 until their own ten rows are written and hashed** — same discipline as the frozen-list protocol that has worked twice already.

### RULING — the two `docs/` go to Developer 1 as N/A, but the basis must be stated correctly

```
M   docs/DECISIONS.md
A   docs/PROMOTION_LEDGER.md
```

**`docs/PROMOTION_LEDGER.md` is status `A` — ADDED. It does not exist on `main`; this promotion creates it there.** No party has stated that, and it should be in the record.

**N/A is the right disposition, but not because "it is a doc."** The basis is §25.7.2, verbatim:

> **"Do not audit this document's prose."**

So the claim rows must read: *N/A — excluded from round-5 scope by §25.7.2; frozen under §28; `PROMOTION_LEDGER.md` is added to `main` by this promotion.*

**Consequence worth stating plainly: the reviewable population is 137, not 138.** One of the 138 is excluded from audit by the ledger's own instruction. A review reporting "138 of 138 reviewed" would be overstating by one.

**Final allocation: Developer 1 = 87 · Developer 2 = 51 · unassigned = 0 · total 138.**

---

## 2. The ordering trap — CONFIRMED by arithmetic, adopted

Developer 1: *"`test` must match before `web component`, or a file under `src/components/__tests__/` categorises differently in the two halves. That alone would desynchronise 19 rows."*

**Confirmed here.** My path-prefix count gives `src/components` = **29**; their category count gives component = **19**. The difference is **10 files under `src/components/__tests__/`**, which their ordering routes to `test`: 11 `src/__tests__` + 10 = **21 test**, 29 − 10 = **19 component**. Both halves total 40 either way, and only the ordering decides which bucket each lands in.

**RULING: `test` matches before `component`. Canonical. Both halves use Developer 1's generator unchanged.**

---

## 3. The join rule — adopted verbatim, and I will run it myself

> *"The joined file must contain exactly **138 distinct path values**, symmetric difference against `git diff --name-only BASE RC` **empty** — not '138 rows', because a duplicated path plus a missing one still counts to 138."*

**Correct, and it is rule 5 applied to their own work without being asked.** Adopted.

**Addition:** when both halves are published, **I will run that check in this container** against `git diff --name-only b671e1fb a42b209e` and report the symmetric difference in both directions. Neither half's self-report is the check.

**`blob_sha_at_RC` in the schema is the right instinct** — *"a row whose blob sha disagrees with mine is a defect in one half, not a difference of opinion."* That is exactly what makes the two halves joinable rather than merely concatenable.

---

## 4. WO-13 Task 1 — ACCEPTED. And the last paragraph is worth more than the result.

**Identity, as ordered and before any output:** `HEAD = a42b209e4f70a6efed4f3dcdb654e0f994416594`, `git status --porcelain` empty, tree `10d4dfac…`, lockfile `2c19224a…`, node v22.22.2 matching `.node-version`, npm 10.9.7, vitest 3.2.4. Detached worktree, no branch. **The recorded prior defect — a run reported at `a42b209e` that happened at `9ac4524d`** — is closed by proof rather than assertion.

`npm ci` clean, lockfile unchanged by install, `npx vitest run` exit 0, **2,475 passed · 1 skipped · 179 files · 2,967 lines of per-test output.**

### The skip analysis is the best single piece of test reasoning in this engagement

`src/test/judging-invariants.test.ts`, `describe.skipIf(!canRun)` where `canRun = Boolean(URL && SERVICE_KEY)`.

**A file-level `skipIf` reports as one skipped entry no matter how many tests are inside it.** They did not accept the summary line — **they counted the `it(` blocks.** Exactly one, so the count is honest.

And then the part that matters: *"It would stop being honest the moment that file gains a second case, and nothing in the summary line would change."* **That is a latent reporting defect in the suite's own accounting, found by not trusting a number that happened to be right.**

The cost is stated concretely, not waved at: the file's header claims a green result *"guarantees a green production check"* because the nightly cron calls the same `judging_invariants_check()`. **That guarantee was not obtained.** BLOCKED as-of **2026-08-31T06:05:48Z**, and they declined to request a service-role credential rather than reach for one. Correct on both counts.

### The planted-defect proof satisfies rule 1

Three defects, three areas, full-suite run each, **exit 1 each**: lane defaulting (`lane-config.mjs`) → 2 failures; icon-bundle pin (`Navbar.tsx`) → 1; pure logic (`translate.ts`, threshold 6→60) → 2. Restored, sha256 back to baseline, `diff -rq` byte-identical, clean re-run exit 0, worktree `git status --porcelain` 0 lines at **05:52:47Z** and again at **06:05:48Z**.

**A green suite is now evidence, because it has been shown to go red.**

### F-48 — I verified their limitation claim myself, and it recalibrates §25.7.2 item 3

Their claim: *135 of 179 test files assert against source text via `readFileSync`; only 23 render anything.*

**Measured in this container at `a42b209e`, independently:**

```
test files in tree                                  180
  ... using readFileSync / readFile / fs.read       135
  ... that render (render( / renderHook()            23
```

**135 and 23 match exactly.** (My file count is 180 against their 179 — a one-file collection-boundary difference, not a discrepancy in the finding.)

**So three quarters of this suite is a source-text linter.** "2,475 tests pass" means, for the most part, *the source still contains the strings we pinned.* Their own D2 defect demonstrates the limit precisely: the pin catches the literal `import * as X from "lucide-react"` and **would not catch `const X = await import("lucide-react")`, same bundle cost, different spelling.** All three planted defects were caught by pins written for those exact regressions.

**Their conclusion, which I adopt as the finding: strong evidence against recurrence of known defects; weak evidence about anything new.**

**And the second half matters as much:** the suite is **blind to deployment by construction**. Green at `a42b209e` is fully compatible with their own frozen measurement that **50 of 71 production bundles differ from that same commit.**

**RULING: §25.7.2 item 3 is satisfied as an activity, and its result must be recorded with F-48 attached.** Recording "the test suite was re-run and passed" without F-48 would overstate what was obtained by a wide margin — which is the failure mode this whole engagement exists to prevent.

---

## 5. Standing, restated once and not re-argued

The owner has said there is no separate auditor. That does not make the compiler one. **§25.4 is the owner's own rule** — *"No row below may be marked closed by the compiler. The compiler is not a second party."*

**Nothing in this document closes a row.** With route (a) unavailable, §25 closes only by §25.7.3's second route: **the owner accepting each remaining row in writing as a named residual risk**, per row, with its basis. That is the owner's ruling to make and I will not make it for him.

**What I can and will do: finish the review, run the join check, and put a complete, honest record in front of whoever signs.**

---

## 6. Orders

**Developer 1** — you own **87**: your 75, plus the 10 `scripts/`, plus the 2 `docs/` as N/A with the §25.7.2 basis stated and `PROMOTION_LEDGER.md` recorded as status `A`, added to `main` by this promotion. **Do not read `claude/138_FILE_REVIEW_TRANCHE_2_2026-08-31.md` until your ten script rows are written and hashed** — I have already reviewed those ten from source and your pass is the independent second reading.

**Developer 2** — you own **51**. The schema is published at `claude/A15_CLAIMS_SCHEMA_FOR_DEVELOPER_2_2026-08-31.md` with the generator at `claude/A15_build_claims_2026-08-31.py`. **Test matches before component — ruled.** Proceed with Task 2 first (rows 1, 2, 3), then Task 3.

**Both** — publish your half frozen and hashed. I run the join.
