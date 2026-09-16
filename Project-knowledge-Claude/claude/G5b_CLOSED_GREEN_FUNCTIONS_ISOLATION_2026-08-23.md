# G5b — GREEN, COMPLETE · MERGED TO STAGING

**Closed 2026-08-23, ~04:20 UTC.** Rev 3.0 §8.3, Erratum E-1.
`origin/staging` **`d33c91efc10b7fb4e966df64c1bdd8597771fc0f`**, tree `100bb668feb7d52272cfafd092da032509785ff4`.
`origin/main` `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` — **unchanged throughout**.

---

## 1. WHAT G5b WAS

Cloudflare Pages Functions have **no build step**. Nothing about them reaches
`dist`, so rules R1–R10 were structurally incapable of seeing them.
`functions/_seo.ts` carried production literals that would have shipped into any
lane, and no gate could fail on it.

## 2. A GAP IN THE PLAN, FOUND BY EXECUTING IT

§8.3 specifies **two** Pages variables. The file carried **three** production
defaults. `PRODUCTION_ANON_KEY` is the one no rule can ever catch — the project
ref inside it is base64-encoded, not literal. Leaving `SITE_ORIGIN` defaulting
would have failed the staging lane on R8 the moment the scan turned on.
**Three variables, not two.**

## 3. MERGE VERIFIED BY TREE EQUALITY

```
origin/g5b^{tree}      100bb668feb7d52272cfafd092da032509785ff4
origin/staging^{tree}  100bb668feb7d52272cfafd092da032509785ff4   ← identical
diff 9aea8a3..staging  5 files, +236 / −28
```

The squash changed the commit, not the content — which is exactly why Rev 3.0
§12 defines promotion identity on the tree. **Consequence: the four green CI
runs on `bbeff1a` are valid evidence for the merged tree**, because they tested
that byte-identical content. No re-run is required to establish it.

## 4. EXIT CONDITIONS — EXECUTED AGAINST THE MERGED TREE

Every check below was run on `d33c91e` itself, not inherited from the PR.

| # | Condition | Result |
|---|---|---|
| 1 | Pages **Production** variables configured | `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, `SITE_ORIGIN` present — owner-added, owner-confirmed, 8 vars total, 5 pre-existing untouched. **OWNER-ATTESTED** |
| 2 | Pages **staging** environment values | **NOT APPLICABLE — no staging Pages project exists.** It is created at G7. Recorded, not waived |
| 3 | Both lanes build and pass the guard | Production **PASS**, staging **PASS**, each `271 assets across 2 root(s): dist, functions` |
| 4 | Functions/SSR receives the variables | **Proven with the exact values now on Pages**: `supabaseUrl → https://jtdtehuqtinjxropkkcn.supabase.co`, `site → https://www.50mmretina.com`, anon key returned verbatim. Omitting any one throws by name |
| 5 | Full negative/isolation suite incl. `functions/*.ts` | **44 cases, 0 failures, 16/16 mutants** |
| 6 | Old fallbacks completely gone | Whole-tree grep of `functions/`: **no project ref, no host, no JWT** |
| 7 | G4/G5a/G6 regression | See §5 |
| 8 | Fix-and-re-verify | Two defects found and fixed; §6 |
| 9 | Final CI evidence | Four green on `bbeff1a` = the merged tree (§3) |

## 5. REGRESSION — EARLIER GATES NOT WEAKENED

| Gate | Check | Result |
|---|---|---|
| **G4** | Production `_headers` sha256 | `40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0` — **byte-identical to the recorded production artifact** |
| **G5a** | Mutation harness | 16/16 held; the four host rules R7–R10 intact |
| **G6** | Production bundle + staging ref | `FAIL [R3]` |
| **G6** | Staging bundle + production ref | `FAIL [R3]` |
| **G6** | Empty forbidden list | `FAIL [R6]` |
| **control** | Either bundle + a ref of **neither** lane | **PASS** — so the refusals are caused by the foreign ref, not by the edit |
| — | `tsc --noEmit` | 0 errors |
| — | Full suite | **2292 passed, 1 skipped, 0 failed** |

## 6. THE DECIDING PROOF, AND TWO DEFECTS FOUND EN ROUTE

**The delta is real, not cosmetic.** Same bundle, same regression, two guards:

```
production defaults restored → staging lane, NEW guard:  FAIL [R3]  functions/_seo.ts
production defaults restored → staging lane, OLD guard:  PASS       263 assets, blind
```

**6.1 The harness caught a bug in its own new test.** RED-17 expected R4, got
R11 — correctly. Rule order was right; the expectation was wrong. It refused to
run mutations over a red baseline, exactly as designed.

**6.2 Two assertions shipped vacuous, caused by the chat medium.** A markdown
renderer autolinked a bare hostname in transit, so `"www.50mmretina.com"`
arrived as a bracketed string that can never occur. The code session applied it
verbatim and **flagged rather than silently repairing** — the correct call.
Repaired in `bbeff1a`, verified at the remote: bare hostname on both lines, zero
autolink artifacts in the file.

**Recorded limitation, not smoothed over:** the non-vacuity proof made **line 58**
fail. **Line 47 did not fire** — it checks returned *values*, which a
module-level literal never reaches. Line 58 is proven live; **line 47's liveness
is unproven**, and under the required-value design it cannot fail from a
module-level literal at all. It remains a narrow regression guard.

## 7. DESIGN DECISION THAT AVOIDED BREAKING PRODUCTION

The `functions/` scan is **default-on, not opt-in**. As first built, R11 would
have **failed the production Pages deploy** unless a fourth variable were added.
The owner's dashboard reading supplied the deciding fact — the Pages build
command is `npm run build && node scripts/verify-bundle-isolation.mjs`, run from
the repository root. An opt-in scan would have to be requested identically by CI
*and* by that build command, and the day one forgot, the failure would be silence.

## 8. VERDICT

## **G5b = GREEN — COMPLETE**

**One deferred condition, named:** the production-lane guard line from **CI**.
`build-production` fires only when the lane resolves to `main`, so no PR or push
on `staging` can produce it. It exists as local evidence on the merged tree and
closes at G10, where §12.4's promotion checks produce it. Not accepted as a
substitute.

**Not blocking, cleanup only:** four scratch branches —
`scratch/lane-check-g3`, `scratch/secret-isolation-20260822`,
`scratch/secret-isolation-retest`, and `g5b` if the merge did not remove it.
Keep the two probe branches until §12.4 step 7 re-runs at G10.

## 9. CHANGE LEDGER

| Field | **CHG-20260823-003** |
|---|---|
| Change ID | CHG-20260823-003 |
| Branch | `staging` — G5b merged via squash from `g5b` (PR #89) |
| Before | `origin/staging` `9aea8a30…` / tree `aa877b50…` |
| After | `origin/staging` `d33c91ef…` / tree `100bb668…`, equal to `origin/g5b^{tree}` |
| Files | 5 (`functions/_seo.ts`, `functions/pages-runtime.d.ts`, both guard scripts, one new test) |
| Reason | Rev 3.0 §8.3 |
| Environment impact | §16: repository, CI, and the production Pages **variable set** (owner-added; takes effect on next deployment only). **No production deployment, no DNS, no Cloudflare routing change, no database, no R2** |
| Verification | §4, §5, §6 — executed against `d33c91e` |
| Rollback | Revert the squash commit on `staging`. `main` carries none of it, so production is unaffected either way |
| Classification | **VERIFIED**, except: Pages variables **OWNER-ATTESTED**; production-lane CI line **DEFERRED to G10**; test line 47 liveness **UNPROVEN** |

## 10. GATE STATUS

| Gate | State |
|---|---|
| G0, G1, G2, G3, G4, G5a, **G5b**, G6 | **GREEN — COMPLETE** |
| G7, G8, G9, §15, RC | **BLOCKED** — HS-1 on `www` (Path B) |
| G10 | **BLOCKED** — HS-12, no branch protection on `main`; §12.4 step 7 re-test due at release; carries G5b's deferred production-lane line |

**Eight of eleven GREEN.** Every remaining blocker is an owner decision, and the
largest is a single ruling on Path B.
