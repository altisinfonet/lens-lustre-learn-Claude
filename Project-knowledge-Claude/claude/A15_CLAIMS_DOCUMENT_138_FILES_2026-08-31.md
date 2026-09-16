# A15 — the 138-file **claims document**

**For the independent auditor. Requested by them; built to be verified against source, not against
me.** Date 2026-08-30. Read-only. **Nothing here closes a §25 row (§25.4).**

Machine-readable companion: `A15_CLAIMS_138.tsv` / `.json` (138 rows). Generator shipped with its
output per rule F-30: `build_claims.py`.

---

## 0. What this document is, and the one thing it must not become

**Every row asserts something checkable against source, and names the check.** No row asserts a
conclusion, a severity judgement you should adopt, or that a file is fine. Where I write `HIGH`, that
is **a routing hint about where to spend your time**, not a finding — and its basis is stated so you
can disagree with it cheaply.

**The self-audit risk, restated so it stays visible:** if a row is closed by agreeing with me rather
than by reading the file, this document has audited itself. You have said you will verify against
source; the format is built to make that the path of least resistance — every claim is one command
away from being falsified.

**Endpoints, fixed and not to be inferred:**

| | |
|---|---|
| `BASE` | `b671e1fb0c5bcf145d442076c229eca888afd674` — `origin/main` |
| `RC` | `a42b209e4f70a6efed4f3dcdb654e0f994416594` — the frozen release candidate |
| `NEW` | `9384ba9aeef585f615148b208f13d68fdbe169f5` — replacement RC branch head, **NOT adopted**, **not pushed** |

---

## 1. Scope claims — check these first, they bound everything else

| # | Claim | Command that checks it |
|---|---|---|
| **S-1** | The review scope is **exactly 138 files**. | `git diff --name-only BASE RC \| wc -l` → `138` |
| **S-2** | **31 added, 107 modified, 0 deleted.** | `git diff --name-status BASE RC \| cut -f1 \| sort \| uniq -c` |
| **S-3** | Total line delta is **+9,060 / −1,293**. | `git diff --numstat BASE RC \| awk '{a+=$1;d+=$2}END{print a,d}'` |
| **S-4** | The replacement RC touches **3 of the 138** and adds/deletes **no paths**, so **this scope does not change if it is adopted**. | `git diff --name-status RC NEW` → 3 lines, all `M` |
| **S-5** | `cloudflare/seo-edge-injector/worker.js` is **NOT** in the 138 — its blob is identical at both endpoints. | `git rev-parse BASE:cloudflare/seo-edge-injector/worker.js RC:…` → same sha `160cd148…` |
| **S-6** | `docs/PROMOTION_LEDGER.md` **is** in the 138 and is **frozen under §28** — it is the largest single diff (+1,173) and the least interesting. | `git diff --numstat BASE RC -- docs/PROMOTION_LEDGER.md` |

**S-4 is the one that protects your time.** It is the C-25 correction: a replacement RC costs you a
three-file, 43-line delta, not a re-review.

---

## 2. Distribution — so you can plan, not so you can skip

| category | files | risk hint |
|---|---|---|
| edge function (`supabase/functions/`) | **44** | MED |
| test | **21** | LOW |
| web component | 19 | LOW |
| build/CI script | 10 | MED |
| web library | 9 | LOW |
| CI workflow | 8 | **2 HIGH**, 6 MED |
| root/config | 8 | LOW |
| Pages edge function (`functions/`) | **7** | **HIGH** |
| DB rollback | **5** | **HIGH** |
| DB migration | **2** | **HIGH** |
| web page | 2 | LOW |
| documentation | 2 | N/A |
| supabase config | 1 | MED |

**16 HIGH · 61 MED · 59 LOW · 2 N/A.**

---

## 3. The 16 HIGH files — specific claims, each measured, each falsifiable

### 3.1 CI workflows — 2 files

| # | Claim | Check |
|---|---|---|
| **H-1** | `.github/workflows/apply-migration.yml` (`M`, +75/−5, 236 lines at RC) contains **15** `${{ … }}` expressions, of which **five carry free-text `type: string` inputs into `run:` shell bodies**: `FILE='${{ inputs.migration }}'`, `CONFIRM='${{ inputs.confirm }}'`, `cat '${{ inputs.migration }}'`, `-f '${{ inputs.migration }}'`, `echo "✅ Applied: ${{ inputs.migration }}"`. | `git show RC:… \| grep -n 'inputs\.'` |
| **H-2** | In the same file at **`BASE`**, the job's `environment:` line is **commented out** (`# environment: production`), and at **`RC`** it is **live** (`environment: ${{ inputs.target }}`). | `git show BASE:… \| sed -n '70,95p'` vs `git show RC:… \| grep -n 'environment:'` |
| **H-3** | Its `on:` block is **`workflow_dispatch` only** — no `branches:` filter — and the job carries **zero** `if:` conditions and **zero** `github.ref`/`head_ref`/`base_ref` guards. | `git show RC:… \| grep -nc 'if:'` → 0; `grep -c 'github\.ref'` → 1 (in a comment/expression, not a job guard) |
| **H-4** | `.github/workflows/verify-schema-dependencies.yml` is **`A` (added)** — it **does not exist at `BASE`** — 108 lines, **9** `${{ … }}`, one of which puts free-text `inputs.source_dir` directly into a `run:` line. | `git cat-file -e BASE:…` → fails; `git show RC:… \| grep -n source_dir` |
| **H-5** | Because H-4 is an addition, **`workflow_dispatch` cannot offer it today** — the workflow must exist on the default branch to be dispatchable. **The merge creates this exposure; it does not merely carry it.** | check `origin/main`'s Actions list, or `git ls-tree origin/main .github/workflows/` |

### 3.2 Pages edge functions — 7 files, and the jsonLd path

| # | Claim | Check |
|---|---|---|
| **H-6** | `functions/_seo.ts` (`M`, +64/−7, 147 lines at RC) contains **exactly one** `JSON.stringify` and **zero** `u003c` escapes. Line 118: `` `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>` ``. | `git show RC:functions/_seo.ts \| grep -nc 'JSON.stringify'` → 1; `grep -c u003c` → **0** |
| **H-7** | **All five** route files — `competitions/[id].ts`, `courses/[slug].ts`, `featured-artist/[slug].ts`, `journal/[slug].ts`, `page/[slug].ts` — import from `../_seo`, so **H-6 reaches production through every one of them**. Each is a small diff (+3/−1 or +3/−2) and the change is a **`SITE` constant becoming a `site(context.env)` call**, not a jsonLd change. | `git show RC:'functions/journal/[slug].ts' \| head -5`; `git diff BASE RC -- 'functions/*/[*].ts'` |
| **H-8** | `functions/pages-runtime.d.ts` is **`A`**, 24 lines, **types only** — no executable statement. | `git show RC:functions/pages-runtime.d.ts` |
| **H-9** | **The contrast that makes H-6 a defect rather than a style:** `cloudflare/seo-edge-injector/worker.js` (**not** in the 138) does the same job and **does** escape — line 139, `JSON.stringify(obj).replace(/</g, "\\u003c")`, with the comment *"Safe JSON: HTMLRewriter inserts as raw, so escape `</script`"*. | `git show RC:cloudflare/seo-edge-injector/worker.js \| sed -n '135,142p'` |

### 3.3 SQL — 2 migrations, 5 rollbacks, and one claim covering all seven

| # | Claim | Check |
|---|---|---|
| **H-10** | **All seven SQL files are `A` (added) and contain ZERO `BEGIN;` and ZERO `COMMIT;`.** Line counts: migrations 95 and 109; rollbacks 53, 50, 87, 66, 136. **None is self-wrapping; each is atomic only if its runner wraps it.** | `for f in …; do git show RC:$f \| grep -ci '^begin;'; done` → all `0` |
| **H-11** | This is **not** unique to these seven: at `RC`, **625 of 670** `.sql` files under `supabase/migrations` + `supabase/rollback` lack a leading `BEGIN;`. The seven are typical of the tree, not an outlier introduced by this release. | `git ls-tree -r --name-only RC supabase/migrations supabase/rollback \| grep '\.sql$' \| wc -l` → 670 |
| **H-12** | **Three of the five rollbacks are named `UNAPPLIED_…`** — `20260825060000_certificate_types_and_admin_search`, `20260825120000_certificate_delete_removes_notifications`, `20260825170000_certificate_custom_heading`. **The filename asserts a deployment state.** I have **not** verified that assertion against the database, and this release does not run migrations. | `git ls-tree -r --name-only RC supabase/rollback` |

> **H-12 is a claim about a filename, not about the database.** Treat it as a question for the owner,
> not as evidence of anything. **I did not read the production database** — no §5.3 probe, no
> provider write, no migration was run at any point in this engagement.

---

## 4. The 61 MED files — claims by class, not one row each

Each class-level claim is checkable across the whole class with one command.

| # | Claim | Check |
|---|---|---|
| **M-1** | Of the **44** `supabase/functions/` files in scope, **§23.5.1 condition 2 excludes every one of them from this release** — no edge function is deployed by this promotion. **They change what is merged, not what is served.** | ledger §23.5.1; and the release plan |
| **M-2** | **`submit-judge-decision/index.ts` is the only function whose CORS mechanism changes in this range**: local `corsHeaders` with `"Access-Control-Allow-Origin": "*"` at `BASE` → `getSecureHeaders(req)` via `corsFor(req)` at `RC`. | `git diff BASE RC -- supabase/functions/submit-judge-decision/index.ts` |
| **M-3** | **`assertStorageLane` appears in exactly 10 of the 71 function trees at `RC`** — the ten named in §23.5.1 risk 3 — and in **zero of the 61 not named**. It appears in **zero** of the 71 deployed bundles as captured `2026-08-30T03:15:11Z`. | `grep -rl assertStorageLane supabase/functions/` at `RC` → 7 files across 10 slugs |
| **M-4** | The other 6 CI workflows — `android-build`, `health`, `security`, `typecheck`, `ui-gate`, `web-build` — are MED because they change branch scope, not because of an injection construct: four move from `branches: [main]` to `branches: [main, staging]` on both `push` and `pull_request`. | `git diff BASE RC -- .github/workflows/{security,typecheck,ui-gate,web-build}.yml` |
| **M-5** | The 10 `scripts/*.mjs` files are MED because three of them are **executed by the two HIGH workflows** — `verify-schema-dependencies.mjs` (+906) and `test-schema-dependencies.mjs` (+403) are the largest non-ledger diffs in the range. | `git diff --numstat BASE RC -- scripts/` |

---

## 5. The 59 LOW files, and the one claim in that group worth your time

| # | Claim | Check |
|---|---|---|
| **L-1** | **21 test files are in scope.** Two reference a provider client: `src/__tests__/laneIsolation.test.ts` and `src/__tests__/storageLane.test.ts` (1 reference each). | `grep -l 'SERVICE_ROLE\|createClient\|SUPABASE_URL' $(git diff --name-only BASE RC \| grep test)` |
| **L-2** | **`src/test/judging-invariants.test.ts` self-skips into a green summary** when no service-role client is available, reporting as `1 skipped` inside `Tests 2475 passed \| 1 skipped`. **Wherever 2,475 passing tests is cited, one judging invariant is unverified.** *(This file is not in the 138 — it is a standing property of the suite, recorded here because the suite result is one of your deliverables.)* | see `23_TESTSUITE_RERUN/` |
| **L-3** | The 19 web components and 9 web libraries are LOW **on the stated basis that none of them is on an auth, privacy or serialisation boundary** — that basis is exactly what a reviewer should test, and `src/components/comments/CommentThread.tsx` (+588) and `src/components/post/PrivacyGapNotice.tsx` are where I would look first if the basis is wrong. | `git diff BASE RC -- src/components/comments/ src/components/post/` |

---

## 6. What I am NOT claiming

1. **I am not claiming any file is safe.** No row says "reviewed and clean". Every row is a
   measurement plus a question.
2. **I have not read the production database.** H-12's `UNAPPLIED_` claim is about filenames.
3. **The risk column is a routing hint with a stated basis**, and L-3 names the basis most likely to
   be wrong.
4. **The 44 edge-function files are excluded from this release by §23.5.1 condition 2** — reviewing
   them is about what merges, not what serves. If you deprioritise them, that is defensible; if you
   review them, M-3 is where the interest is.
5. **Two figures in this document rest on a capture, not on live state**: M-3's "zero of 71 deployed"
   is as-of `2026-08-30T03:15:11Z`. See `21_NEGATIVES_REGISTER/`.

## 7. If a row is wrong

Every claim names its command. **A single counter-example falsifies the row and should be reported
as a defect in this document, not as a difference of opinion.** I would rather you find one than
not — a claims document that survives review without a single correction has probably not been
checked against source.
