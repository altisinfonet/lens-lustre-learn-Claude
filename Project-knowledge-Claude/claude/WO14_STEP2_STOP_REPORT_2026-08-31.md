# WO-14 — §4 step 2 returned · **STOPPED AT STEP 3. NOT PUSHED.**

Date: 2026-08-31 · **No push, no PR, no force, no rebase, no merge, no tag, no deploy, no migration.**
**Nothing here closes a §25 row (§25.4).**

---

## 0. STATED FIRST, NOT BURIED — two things disagreed, and neither is one of the four

**§4 step 2's four pre-registered predictions ALL MATCH, exactly.**
**§4 step 3's fast-forward condition FAILS.** I have stopped and not pushed, as ordered.

| # | The disagreement | Consequence |
|---|---|---|
| **D-1** | **`git push origin rc-replacement/option2-2026-08-30:staging` cannot be fast-forward.** `origin/staging` = `9ac4524d703035e6d2debd9e97ab9a0e73de3bc9` is **NOT an ancestor** of `9384ba9a…`. The branch was cut from `a42b209e`, which is **10 commits behind `staging`** | The push would be **rejected as non-fast-forward**. §4 step 3: *"If the push is rejected as non-fast-forward, STOP and report. Do not add `--force`."* **Stopped.** |
| **D-2** | **§5 R3's prediction `+9,096 / −1,300` is wrong, and for two independent reasons.** Measured on a diagnostic object: **`+10,194 / −1,299`** | Recorded now, **before** the push, so it is a pre-registered correction rather than a surprise afterwards |

**And Step 1 is unresolved: this session still has no push authority.** Re-tested at this head:

```
$ git remote get-url --push origin
DISABLED_NO_PUSH_AUTHORITY
$ git push --dry-run origin rc-replacement/option2-2026-08-30:staging
fatal: 'DISABLED_NO_PUSH_AUTHORITY' does not appear to be a git repository
```

**Step 1 was NOT resolved. It was not skipped silently — it cannot be performed from here.** Per §8:
*who* pushed = **nobody**; *from which clone* = **n/a**; *with what credential class* = **none exists
in this session.**

---

## 1. §4 step 2 — the four commands, actual output, matched against the prediction

| # | Requirement | Instrument | Evidence (actual) | Predicted | Result | Status |
|---|---|---|---|---|---|---|
| 1 | branch head | `git rev-parse rc-replacement/option2-2026-08-30` | `9384ba9aeef585f615148b208f13d68fdbe169f5` | `9384ba9a…` | **MATCH** | **VERIFIED** |
| 2 | changed paths | `git diff --name-only a42b209e 9384ba9a` | `.github/workflows/apply-migration.yml`, `.github/workflows/verify-schema-dependencies.yml`, `functions/_seo.ts` | the 3 named in §1 | **MATCH — same 3, by name** | **VERIFIED** |
| 3 | line delta | `git diff --shortstat a42b209e 9384ba9a` | ` 3 files changed, 36 insertions(+), 7 deletions(-)` | `+36 / −7` | **MATCH** | **VERIFIED** |
| 4 | status mix | `git diff --name-status a42b209e 9384ba9a \| cut -f1 \| sort \| uniq -c` | `      3 M` | `3 M`, `0 A`, `0 D` | **MATCH** | **VERIFIED** |

**Four for four. The branch is the object that was measured.**

---

## 2. D-1 in full — why the fast-forward fails, and it was designed in on 2026-08-30

```
$ git fetch origin                                    (exit 0)
$ git rev-parse origin/staging
9ac4524d703035e6d2debd9e97ab9a0e73de3bc9
$ git log --oneline origin/staging..rc-replacement/option2-2026-08-30
9384ba9 fix(rc): Option 2 — …
$ git merge-base --is-ancestor origin/staging rc-replacement/option2-2026-08-30
  -> NO
$ git rev-list --count rc-replacement/option2-2026-08-30..origin/staging
10
```

**The branch has 1 commit `staging` lacks; `staging` has 10 the branch lacks.** They diverged.

**This is not a surprise and not a defect — it is the direct consequence of a decision made under the
A-3 authorisation and reported at the time.** I cut the branch from **`a42b209e`, not the staging
tip**, for two measured reasons:

1. **Rule 8.** The corrected patches were verified to apply against `a42b209e` **and nothing else**.
2. **§28.** The ten commits between are `docs/PROMOTION_LEDGER.md` **only** — committing them onto a
   code branch before promotion is what the documentation freeze forbids.

**Both reasons still hold. What did not follow at the time is that a branch based on `a42b209e` can
never fast-forward onto a `staging` that has moved past it.** That is D-1, and it is mine.

### The ten commits, measured — this is what makes the situation recoverable

```
9ac4524d  nondocs=0   docs/PROMOTION_LEDGER.md
de518c63  nondocs=0   docs/PROMOTION_LEDGER.md
daaf4c12  nondocs=0   docs/PROMOTION_LEDGER.md
393bc558  nondocs=0   docs/PROMOTION_LEDGER.md
fe63e944  nondocs=0   docs/PROMOTION_LEDGER.md
47f0f849  nondocs=0   docs/PROMOTION_LEDGER.md
a87538ad  nondocs=0   docs/PROMOTION_LEDGER.md
d93c2b89  nondocs=0   docs/PROMOTION_LEDGER.md
a39d135a  nondocs=0   docs/PROMOTION_LEDGER.md
d06b0379  nondocs=0   docs/PROMOTION_LEDGER.md
```

**Ten of ten are ledger-only. Zero non-`docs/` files. Zero of them touch any of the three patched
paths.** A textual conflict is therefore impossible, and I measured that rather than assumed it.

### Diagnostic probe — run in a throwaway worktree, discarded, authorised branch untouched

I did **not** choose a remedy. I measured what one would produce, so the decision is informed:

```
$ git worktree add --detach /tmp/ffprobe origin/staging
$ git cherry-pick 9384ba9aeef585f615148b208f13d68fdbe169f5
[detached HEAD 6c56e37] fix(rc): Option 2 — …
 3 files changed, 36 insertions(+), 7 deletions(-)
  exit=0        working tree clean
```

| measured on the probe object `6c56e37b8ae416f0f4dcf564bd1be0f471e2b7f9` | |
|---|---|
| applies cleanly | **YES**, no conflict, no manual resolution |
| vs `origin/staging` | **3 files changed, +36 / −7** — `M`, `M`, `M` |
| fast-forward from `origin/staging`? | **YES** |
| files vs `main` | **138** — unchanged |
| lines vs `main` | **+10,194 / −1,299** |
| `_seo.ts` line 124, read from the file (rule 12) | `` ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c")}</script>` `` |

**The probe worktree was removed. `rc-replacement/option2-2026-08-30` is still
`9384ba9aeef585f615148b208f13d68fdbe169f5`. `6c56e37b…` is a diagnostic object and must not be
treated as a candidate — it is not what anyone has authorised, measured or reviewed.**

**I am not proposing this.** §7 forbids rebasing and rewriting `staging`; whether a cherry-pick of a
topic commit onto a moved `staging` is inside or outside that prohibition is **the compiler's ruling,
not mine.** The measurement is here so the ruling can be made on evidence.

---

## 3. D-2 — §5 R3's predicted line total is wrong, for two separate reasons

R3 predicts `+9,096 / −1,300` at the new head. **Both halves are wrong, and the reasons do not
overlap:**

| # | Reason | Effect |
|---|---|---|
| **a** | **Rule 14 — a diff is not a vector.** `verify-schema-dependencies.yml` is `A` vs `main`, so the patch's one deletion cancels an addition instead of adding a deletion. Already measured at `9384ba9`: `+9,095 / −1,299`, not `+9,096 / −1,300` | **−1 / −1** |
| **b** | **The new head inherits `staging`'s ten ledger commits.** `docs/PROMOTION_LEDGER.md` is `A` vs `main`, so all of REV-7…REV-16 count as additions. This is not in R3's arithmetic at all | **≈ +1,099 additions** |

**Measured on the probe: `+10,194 / −1,299`, files `138`.** Recorded **before** the push so that when
the real head is measured, this is a pre-registered prediction rather than a discrepancy to explain.

**R2 (`138` files) is expected to hold and did hold on the probe.** Files vs `main` = **138**, because
the patch adds and deletes no paths and the ten ledger commits touch a file already inside the 138.

---

## 4. R1–R5 status — all DEFERRED, because there is no pushed head to measure

| # | Claim | Status | Why |
|---|---|---|---|
| R1 | construct-removal proof at the pushed head | **DEFERRED** | **Rule 15 — and this is the point.** It is verified at `9384ba9` in a local branch. There is no pushed object, so there is nothing to re-verify. It will be re-run on the real head, from the file, not retyped |
| R2 | scope vs `main` = 138 | **DEFERRED** (probe says 138) | measured on a diagnostic object only |
| R3 | line totals | **DEFERRED**, prediction **corrected** in §3 | |
| R4 | four `pull_request` CI runs = §24.1 step 6a | **BLOCKED** | no push has occurred, so no run has fired. **No second run will be dispatched** |
| R5 | `_seo.ts` line read character-for-character | **DEFERRED** (probe reads correct) | must be re-read at the pushed head |

---

## 5. What I did not do

- **No pull request.** None opened, none attempted. The four `pull_request` workflows have not fired.
- **No push, no force, no rebase, no merge into `staging`, no history rewrite.**
- **No tag, no deploy, no migration, no §5.3 probe, no production write, no ledger edit.**
- **`web-build.yml` / F-47 untouched.**
- **Step 1 not performed** — no credential exists here. Recorded as not performed, per §8.

`origin/main` `b671e1fb0c5bcf145d442076c229eca888afd674` and `origin/staging`
`9ac4524d703035e6d2debd9e97ab9a0e73de3bc9` are **unmoved**, confirmed after `git fetch`.

---

## 6. What is needed to proceed — two decisions, both the compiler's

1. **Push authority.** A clone that can write to `origin`. §8 requires the pusher, the clone and the
   credential class be recorded as provenance.
2. **A ruling on D-1.** The branch as it stands **cannot** be fast-forwarded onto `staging`. The
   options are a cherry-pick/rebase of the topic commit onto the current `staging` (producing a new
   SHA that must then be re-measured under §5), or moving `staging` some other way, or re-cutting the
   branch. **Each changes the object, and §5 R1–R5 then apply to whatever SHA results.** I have
   measured the first option and taken none of them.

**Also delivered this turn, as owed:** `A15_CLAIMS_138.tsv` is published at
`claude/A15_CLAIMS_138_2026-08-31.tsv`, sha256
`a2defa868f6561fa8f7dcca492009fd6b27f1fe2da079061d9d0f1cab47c4bc0`, 138 rows + header, for the
completeness check against baseline `d7caf4e5…f07`.
