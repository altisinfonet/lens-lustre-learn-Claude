# RULING on Developer 1's verification of `5ca0d256` · step 6 completed · **F-49, a new blocker-class finding**

Issued 2026-08-31 by the compiler/audit session.

---

## 1. RULING: Developer 1's verification is **ACCEPTED IN FULL**

**I re-measured every figure they quoted, from `origin`, before writing this. Not one required correction.**

| Their claim | My independent measurement | |
|---|---|---|
| P1 = 0, P2 = 0 inside every `run:` body | **0 and 0** | ✔ |
| Their second instrument found 10 and 8 anywhere in the files; each survivor is a key position or comment | Confirmed — `concurrency.group`, job `name`, `environment`, the `env:` maps, two comments. **None is script text** | ✔ |
| Sink at line 150 carries **no** `/</g`; the escape is factored into `escapeJsonLd()` at line 100 | Confirmed by my own `od -c` on the pushed blob | ✔ |
| Lines 102–104 carry **two literal backslashes** — `" \ \ u 0 0 3 c "` | **Confirmed by my own `od -c`.** `\\u003c` in TS source emits `<`; a single-backslash `"<"` would be the character `<` and the replace a silent no-op | ✔ |
| `esc()` not applied — zero on the sink, zero in the helper | **0 and 0** | ✔ |
| P4: 4 paths, all `M`, 0 `A`, 0 `D`, **+1,340 / −172** vs `a42b209e` | **Exactly** — `+1,340 / −172`, 4 M | ✔ |
| P5: seven controls at 127/130, 148, 169, 201/203, 211, 216, 219 | Confirmed, in order, each reading a shell variable | ✔ |
| P8: both parse; steps 9→9 and 6→6; every step name identical | Confirmed | ✔ |
| P7: `web-build.yml` blob **`75da28c730c2aed3506b0d3c067ef32266d45bef`** at both refs | **Confirmed character for character.** And I add a fact they did not have: at `main` that blob is **`35d5deb1d3342cb4a09c3d85c53f3b6926ce2f3e`** — *different*. F-47's `lane-guard` job is genuinely new on this branch and lands with the merge. It remains LATENT, and it remains out of scope | ✔ **+1** |
| F-47 at `web-build.yml` lines 53–54 | Confirmed — `BASE='${{ github.base_ref }}'` and `REF='${{ github.ref_name }}'` | ✔ |
| Scope: 138 files, 31 A, 107 M; **symmetric difference EMPTY, per item**; `+10,234 / −1,299` measured not derived; commits 51 · 49 | **All confirmed** | ✔ |

**Two parties, independent instruments, zero disagreements.** After a day in which the two developers and I disagreed three separate times on the storage-lane count alone, that is worth stating plainly.

### On the three things they did especially right

**They executed the helper rather than arguing about it.** Planted payload in, neutralised and lossless out. A regex read is an opinion; a run is a measurement.

**They nearly produced a false FAIL and said so.** Grepping the sink line for `/</g` returns nothing, because the escape is factored into a helper. A verifier who stopped there would have reported the fix missing. **They found the real location instead of reporting the convenient answer**, and then recorded the trap so the next reader does not fall into it.

**They refused to inherit `+36 / −7`.** That figure belongs to `9384ba9a`, an object that never reached `origin`. Quoting it would have been rule 15's exact failure. They measured `+1,340 / −172` instead and said why.

### Their self-reported defect — ruled

They report that the first write of their own document **lost the escape a third time**: a heredoc ate the backslashes. They caught it themselves by grepping the written file against `git show 5ca0d256:functions/_seo.ts` rather than against their intention, repaired it by constructing the strings programmatically, and recorded it in their §9.

**Ruling: the verdict stands, and the disclosure strengthens it rather than weakening it.** The verdict rests on `od -c` output and an executed function, not on prose. The prose was wrong; the measurements never were. **Rule 12 is what caught it — comparing against source, not against intention — and it worked.**

### NEW STANDING RULE 16, and this one was earned three times in one day

> **16. A character a quoting layer can eat must be verified in the artefact, never in a report of it.** An escape sequence quoted in a document is not evidence that the escape exists in the file. Byte inspection of the artefact — `od -c`, `xxd`, a hash — is the only instrument that settles it.

**The record for this single line today: Developer 1's original patch document ate it. My earlier relay of that document carried the error. Developer 1's verification report ate it again.** Three transcriptions, three failures, one line. The fix in the repository has been correct throughout — every failure was in a *description* of it. Developer 1's own closing instruction is the right one and I repeat it as the rule: **do not trust the escapes printed in any report, including this one. Run `od -c` yourself.**

---

## 2. Step 6 — the block is CLEARED. CI conclusions, read at the provider.

Developer 1 was blocked: no `gh` CLI, no GitHub MCP tool. **I have that access and have used it. Read live from PR #104 at `2026-08-31T09:05:37Z`, at head `5ca0d256`:**

> **All checks have passed · 15 successful · 2 skipped · 0 failing · No conflicts with base branch · Ready to merge · 51 commits · 138 files · +10,234 / −1,299**

**And the two skipped checks now have names** — the item that has been open since this morning:

| | on: push | on: pull_request |
|---|---|---|
| Typecheck | SUCCESS | SUCCESS |
| UI gate — *"Every control reachable, nothing regressed"* | SUCCESS | SUCCESS |
| Web build — *"The lane resolves to exactly one of main or staging"* | SUCCESS | SUCCESS |
| Web build — **Production lane build** | **SKIPPED** | SUCCESS |
| Web build — **Staging lane build** | SUCCESS | **SKIPPED** |
| Security — *"This project's own security rules"* | SUCCESS | SUCCESS |
| Security — **Secret scan (full history)** | SUCCESS | SUCCESS |
| Security — *"Dependency vulnerabilities (production only)"* | SUCCESS | SUCCESS |
| Cloudflare Pages staging deploy | **SUCCESS** at `5ca0d25` | — |

**The two skips are the opposite lane in each event.** The `push` event runs on `staging`, so the production lane build is skipped; the `pull_request` event targets `main`, so the staging lane build is skipped. **Between the two events both lanes build. Correct lane-aware behaviour, not a coverage gap.**

**§24.1 step 6a: SATISFIED at the freeze head.**

**Class, stated honestly and not upgraded:** I read these conclusions, and I also wrote the patch they are passing judgement on. A provider page read is a mechanical fact rather than an assessment, so this is not the same conflict as auditing my own code — **but it is not a second party either, and it must not be recorded as one.** Class: **VERIFIED (provider read) by the patch's author.** If the owner wants this leg held by a separate party, it takes one person with repository access two minutes.

---

## 3. 🔴 F-49 — **the runbook §5.3 secret-isolation probe does not exist**

**This is a new finding, it is blocker-class, and it was found by trying to execute §24.1 step 6 as the owner instructed.**

### What the ledger says

The probe is cited **seven times** and is one of exactly **two** remaining prerequisites to promotion:

| Where | What it says |
|---|---|
| §11, G3 sub-row | *"runbook §5.3 secret-isolation probe · throwaway branch + echo-only workflow · **Never run.** runbook §5.3.6 requires it immediately before promotion"* — 🔴 **BLOCKED** |
| §24.1 step 6 | *"runbook §5.3.6 requires it **immediately before** promotion. Running it early goes stale and must be repeated."* |
| §26 blocker 4 | *"never run, and must run immediately pre-merge"* |
| §5.3 warning | *"That probe is **§5.3 of the migration/execution runbook, a different document**."* |

The ledger is explicit that it is **not** this ledger's own §5.3, and it flags the collision deliberately (correction C-9).

### What I measured

Whole-tree search at `5ca0d256`, and again at `b671e1fb`, **excluding the ledger itself**:

| Pattern | Files matching outside `PROMOTION_LEDGER.md` |
|---|---|
| `secret-isolation` | **0** |
| `secret isolation` | **0** |
| `isolation probe` | **0** |
| `5.3.6` | **0** |
| `throwaway branch` | **0** |
| `echo-only` | **0** |

The three runbooks in the tree — `NEXT_RELEASE_RUNBOOK.md`, `docs/claude/NEXT_RELEASE_RUNBOOK.md`, `ANDROID_RELEASE_RUNBOOK.md` — return **zero** hits for any of these.

**There is no §5.3.6. There is no migration/execution runbook in this repository. The only description of the probe that exists anywhere is nine words inside the ledger's own §11 table: *"throwaway branch + echo-only workflow."***

### Why this matters, stated precisely

**§24.1 step 6 cannot be executed as written, because the instrument it names has no definition.** A merge blocker that points at a document section which does not exist is not a control — it is a reference that reads like one. **That is the exact defect class this engagement has spent four rounds finding**, and it has been sitting inside the blocker list the whole time, cited by §11, §24 and §26 without anyone opening the document it names.

**I am not ruling it.** It is the owner's, and there are three honest dispositions:

| | Disposition | What it requires |
|---|---|---|
| **A** | **The runbook exists outside the repository** — in the owner's own files, another repo, or a prior session's output | Produce it. Then §5.3.6 is executable as written and this finding closes as a search failure on my part |
| **B** | **Specify the probe now, run it, and record that it was specified today** | Executable — the specification is in §5 below. **It must be recorded as authored on 2026-08-31, not as a pre-existing runbook step.** Converting a newly-written test into "the runbook probe" would be exactly the silent class-conversion the evidence standard forbids |
| **C** | **Rule it N/A, with the reason written down** | Defensible only if the reason is stated. See the honest note below |

### The honest note that belongs with disposition C

The probe's purpose is to prove that a secret bound to one lane cannot be reached from the other. **Substantial evidence on that question already exists and is verified** — the ref assertion in both workflows (*the credential must point at the target project*, parsed from the connection string, refusing rather than guessing); the lane gate (branch must match target); the `production` environment admitting `main` only and `staging` admitting `staging`; guard host rules R7–R10; and the secret scan passing on **full history** at this head.

**That is not the same as having run the probe, and I will not write it up as though it were.** Never silently convert one evidence class into another. It is, however, the material the owner needs in order to rule C with a reason rather than by fatigue.

---

## 4. ⚠ A second thing inside §11 that must be looked at before it is signed

While reading §11 to establish what step 7 requires, one row reads:

> **G6** — *"(not separately evidenced in the record available to this compiler)"* — ⬜ **NOT ESTABLISHED** — **BLOCKED**

**G6 has never been established at all.** §26 lists two remaining prerequisites and G6 is not one of them, so it is not currently tracked as a blocker — but **§11 is the section the owner is being asked to sign, and it contains a gate marked NOT ESTABLISHED and BLOCKED in its own matrix.**

Signing §11 while one of its rows is blank is either (a) fine, because G6 is covered elsewhere under another name, or (b) a gap. **I cannot tell which from the record, and I am not guessing.** Before signing, the owner should establish which, and if it is (a), the row should say so.

§11's own closing line is the right standard and it is already in the ledger: *"Anyone reporting '11 green' on this candidate is reporting something that does not exist."*

---

## 5. If the owner rules B — the probe, specified

*Written 2026-08-31. **This is a new specification, not a recovered runbook section**, and any record of a run must say so.*

**Question it answers:** can a workflow running on the `staging` branch obtain the `production` lane's database credential, or vice versa?

**Method — echo-only, never printing a secret value:**

1. Create a throwaway branch off `staging`, e.g. `probe/secret-isolation-2026-08-31`.
2. Add a workflow, `workflow_dispatch` only, that binds `environment: production` and runs **only**: `if [ -z "$DB_URL" ]; then echo "ABSENT"; else echo "PRESENT, length ${#DB_URL}"; fi`. **The value is never echoed. A length is not a secret; a connection string is.**
3. Dispatch it **from the throwaway branch**. **Expected: the run is refused**, because the `production` environment admits `main` only.
4. Repeat with `environment: staging` dispatched from the throwaway branch. **Expected: also refused** — `staging` admits `staging`, not an arbitrary branch.
5. Record both outcomes, then **delete the branch and the workflow**.

**What it proves:** the environment branch restriction is enforced at dispatch, so a branch that is neither `main` nor `staging` cannot reach either credential.
**What it does NOT prove:** anything about a workflow already on `main` or `staging`. That question is answered by the ref assertion, not by this probe — and the ref assertion is VERIFIED.

**Standing prohibition holds: I have not created this branch, this workflow, or this run.** Creating them is a state change beyond the one push the owner authorised, and step 6 says the probe must run *immediately before* promotion — so running it now would go stale and have to be repeated.

---

## 6. §28 — the documentation freeze permits the RC identity entry. Measured against its own text.

The new candidate `5ca0d256` is not recorded in the ledger, and §28 forbids ledger-only commits before promotion. **These do not conflict, and the ledger settles it itself.**

§28.2 exception (a): *"a correction that changes a **material fact about the release** — **an identity**, a count that governs a decision, a finding, an owner ruling, a signature."*

**A new release candidate is an identity.** It is the first item on that list. **The entry is permitted — it is not a judgement call, and it is not churn of the kind §28 was declared to stop.** What §28 excludes is *"wording, labelling, cross-references, formatting and typography."*

§24.1 step 7 gives the order, and it is exact:

> *"sign, then **LEDGER FREEZE** (§3.5 rule 3: no more commits to `staging`), then `git rev-parse staging`, then create the tag against that SHA. The tag must exist **before** the merge."*

**So the ledger entry goes in with the §11 signature, in one commit, at promotion — not as a separate revision now.** That satisfies §28.2 exceptions (a) and (b) together and moves the head exactly once. **The tag must then be cut against the head *after* that commit, not against `5ca0d256`.**

---

## 7. Where this leaves the release

**Verified today and not in dispute:** the patch, by two parties with independent instruments and zero disagreement · CI green at the freeze head with both skips named · the 138-file scope intact, symmetric difference empty · `main` unmoved at `b671e1fb` · **0 tags**.

| # | Remaining | Whose | Blocking? |
|---|---|---|---|
| 1 | **F-49 — rule on the missing probe: A, B or C** | **Owner** | **Yes** — §24.1 step 6 |
| 2 | **§11 G6 — establish, or record why it is not a gap** | **Owner** | Yes, in practice — §11 is being signed |
| 3 | **The eight §25 acceptances, signed** (Row 5 re-drafted) | **Owner** | **Yes** — §11 unsignable while §25 is open |
| 4 | `A15_CLAIMS_138.tsv` published · Task 3's 51 `src/` rows | Developers 1 & 2 | Yes — §26 blocker 9 |
| 5 | §11 signed **+ RC identity entry in the same commit** → freeze → `git rev-parse staging` → **tag** → merge | **Owner** | — |

**One item for the merge record:** PR #104's body still reads *"+9,494 / −1,293 … the extra ~434 lines are the ledger"*, measured at `fe63e944`. It carries its as-of, so it is honest rather than wrong — but the body is part of the merge record and the true figures are **+10,234 / −1,299**, with the ledger contributing **+1,174**. Refresh or stamp it before merging.

---

## 8. Standing

**Nothing here closes a row.** §25.4: *"No row below may be marked closed by the compiler. The compiler is not a second party."*

**Not performed and still not authorised:** merge · tag · function deployment · migration · runbook §5.3 probe · production write · pull request · force-push · `web-build.yml` · provider secret or setting change · ledger commit.

**`main` = `b671e1fb0c5bcf145d442076c229eca888afd674`. Tags = 0. Candidate = `5ca0d256a994fcab9e5beecfae8b8513d2799446`.**
