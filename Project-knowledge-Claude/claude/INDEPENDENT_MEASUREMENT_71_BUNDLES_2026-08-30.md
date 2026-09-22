# Audit ruling — Developer 1 A11b and Developer 2 blind re-measurement

Date: 2026-08-30
Role: auditor. I produced none of the work ruled on here.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 1. Headline — the blind experiment worked

**CORS: two instruments, one of them blind, agree exactly.**

| Category | Developer 1 | Developer 2 (blind) |
|---|---|---|
| static wildcard | **39** | **39** |
| allowlist-gated reflection | **27** | **27** |
| neither | 2 + 3 = **5** | **5** |
| total | 71 | 71 |

Developer 2 was never told these figures, never saw `CORS_CENSUS_71.json`, and wrote its own classifier. It landed on 39 / 27 / 5.

**Ruling: the CORS census moves from INFERRED to VERIFIED.** This is the first number in the engagement carried by two genuinely independent instruments. It is also the first time the answer to "is this real?" is yes on evidence rather than on assurance.

**Drift did not replicate**, and the reason matters more than the numbers. See §4.

---

## 2. Developer 1 — A11b ruling

### ACCEPTED: the CORS census does not share the defective lexer

Three arguments were given. They are not of equal strength and should not be recorded as if they were.

**Argument 2 — the structural discriminator — is the strong one.** All four slugs whose `closure()` returned exit 3 under the defective lexer nonetheless carry **determinate** CORS verdicts in the census (`auth-email-hook`, `preview-transactional-email`, `send-transactional-email` as LOCAL cors object; `process-email-queue` as NO CORS handling). A census routed through `closure()` could not have produced a verdict where `closure()` crashed. **This is a positive test, not an absence of evidence, and it settles the question on its own.** Recorded as the load-bearing argument.

**Argument 3 — independent re-derivation — is strong, with a caveat.** Zero mechanism disagreements across 71, same single prod-vs-repo disagreement. The caveat is that the re-derivation was written by the same session that wrote the original, so it is *fresh* rather than *independent*. Developer 2's blind result supplies the real independence. Both belong in the record; they are different grades of evidence.

**The self-disclosure is the best part of this return.** Developer 1's new classifier used `\bcors\b`, missed `corsHeaders`, and misclassified `submit-judge-comment` and `submit-judge-tag` — **the original was right and the new instrument was wrong.** Reporting that, rather than quietly fixing it, is what makes the agreement mean anything. *"An independent instrument that only ever agrees is no evidence it was independent."* Recorded verbatim as a standing principle.

### QUALIFIED: argument 1 is overstated and must be reworded

> "The import graph is the first line. `json, os, re` — no fourth import… Python cannot reach `tokenize()` or `closure()` without one."

**In Python, `import` is a statement, not a header.** It is legal inside a function, inside a branch, at any line. Twelve recovered lines out of an unrecoverable script establish what the *first twelve lines* do — they cannot establish what the file as a whole imports.

This does not change the conclusion, because argument 2 carries it. But the sentence as written claims proof from a partial artefact, and that is the exact error class this engagement exists to stamp out. **Reword to:** *"No import beyond `json, os, re` appears in the twelve recovered lines. The remainder is unrecoverable, so this is corroborating, not decisive; the structural discriminator is decisive."*

### ACCEPTED: the `prod_wildcard: false` finding — and it is now independently confirmed

Developer 1: `secureHeaders.ts:115` emits `Access-Control-Allow-Origin: "*"` on the non-CORS path, so a caller sending **no** `Origin` header gets `*`. "27 allowlist" holds for browser cross-origin requests only.

Developer 2, blind: *"The 27 gated bundles fall back to `*` for unknown or absent origins."*

**Same finding, two sessions, neither told of the other. VERIFIED.** The boolean `prod_wildcard: false` claims more than the code supports and must be split.

### ACCEPTED: F-30, adopted as a standing rule

> *An instrument that produces a published number ships with the number.*

This is why A11b cost days and why the owner's auditor could not answer Q1: they held the output and not the instrument, which is precisely the position in which corroboration is meaningless. **Adopted. It generalises rule 1 and applies to every future pack.**

### RULING: numbering collision — Developer 1's C-19 becomes C-20

I published **C-19** earlier today for my own correction (the staging-secrets inference) in `claude/S25_3_ROW_1_5_COMPLETION_AND_CORRECTION_C-19_2026-08-30.md`. Developer 1 independently assigned C-19 to the `prod_wildcard` finding.

**My C-19 stands (published first). Developer 1's finding is renumbered C-20.** Correct it in every place before it propagates. From here, correction numbers are issued by me, not chosen by a session.

---

## 3. Developer 2 — blind measurement ruling

### ACCEPTED, and the method was right

Ten planted defects and fifteen assertions **before** reporting any number — and it earned its keep: it caught two bugs in Developer 2's own lexer, one of which was reporting **all 27 gated bundles as unconditional reflection** and preflight as 0/71. Had that shipped unproven, it would have contradicted Developer 1 spectacularly and wrongly, and we would have spent days on a phantom.

**This is the single best vindication of the mutation-testing rule the engagement has produced. Record it.**

Task 4 is equally clean: apostrophes inert in JSX text children, comments and template literals; a delimiter in code; `\'` is content; demonstrated on four real files; **393/393 files lex with zero errors.** That is the correct behaviour, measured — and it is what Developer 1's instrument must match after A9.

### Findings independently confirmed by this blind run

| Finding | Prior status | Now |
|---|---|---|
| Four live versions of `_shared/s3.ts` in production simultaneously | Developer 1 measurement | **VERIFIED, two instruments** |
| Four live versions of `_shared/imageDims.ts` | disputed — I said three, Developer 1 corrected to four | **VERIFIED: four.** My "three" is confirmed wrong; the correction stands |
| C-1: drift is deployment-side, not repository forks | DETERMINED | **VERIFIED** |
| 27 gated bundles fall back to `*` on absent origin | Developer 1, today | **VERIFIED, two instruments** |

### New findings from this run

**F-31 — `send-gift-credit` is a hybrid.** Its `index.ts` is the RC's; its `secureHeaders.ts` is `main`'s. A single deployed function assembled from two different source versions. Deployments were partial or interleaved, not atomic. **This is new and nobody has explained it.**

**F-32 — sixteen deployed files hash to no object on any of the 122 refs in the clone.** If it holds, production is running code that exists nowhere in the repository. **It is not yet established**, because of the limit Developer 2 itself disclosed: the GitHub API returned 403, so the clone could not be confirmed current with `origin`. A stale or shallow clone produces exactly this symptom. **The benign explanation must be excluded before this finding is stated as fact.** Until then: **BLOCKED, not confirmed.** Recorded prominently because if it survives, it outranks everything else in the evidence track.

**F-33 — the allowlist reflects every `*.lovable.app` host.** Anyone able to obtain a subdomain on that third-party platform is inside the allowlist. `Allow-Credentials` is set nowhere, which limits the impact considerably — but the allowlist is wider than "our own origins", and the ledger should say so. Also captured: 4 of 71 carry no OPTIONS branch.

### Limits, accepted as disclosed

70 of 71 source fetches were relayed through courier subagents rather than run by Developer 2 directly; 167/183 files corroborated by matching Git blobs; **61 VERIFIED, 10 RELAYED.** Disclosed unprompted and correctly classified. No objection — this is how a RELAYED row is supposed to look.

---

## 4. The drift numbers did NOT replicate — and the cause is an endpoint mismatch, not a measurement conflict

| Measurement | Endpoint used | Result |
|---|---|---|
| Developer 2 | `main` @ `b671e1fb` | 55 identical · 16 drift · 0 whitespace-only |
| Developer 2 | RC `25c0456` | 21 match · 50 drift · **0 that match the RC but not `main`** |
| Developer 1 / auditor | RC `a42b209e` | 19/21/31 and 19/22/30 strict; 21/21/29 and 21/22/28 import-map-excluded |

Three problems, in order of severity.

**4a — two different RC hashes are in play.** Developer 1 measures against `a42b209e`; Developer 2 against `25c0456`. **These cannot both be the release candidate.** Add the other identifiers already circulating — `fe63e944`, `9ac4524d`, `702e5ce` — and the engagement is measuring five or six different things and calling them all "the endpoint". **This is C-17 recurring in a new place**, and it must be settled before any drift figure is published again.

**4b — Developer 2 chose `main` as "the promotion endpoint".** Blind, that was a defensible reading — but `main` is the *destination* of the promotion, not the candidate. The 55/16 figure therefore measures **deployed-vs-production-branch drift**, which is a genuinely useful number nobody had, and not the drift the ledger records. Both numbers should be kept, each labelled with its endpoint. Neither replaces the other.

**4c — the apparent CORS contradiction resolves, and confirms C-4.** Developer 2 reports *"the CORS class is identical between deployed and repository for all 71"*; Developer 1 reports exactly one prod-vs-repo disagreement, `submit-judge-decision`. **Both can be true**, because Developer 2 compared against `main` and Developer 1 against the RC. If `submit-judge-decision`'s CORS differs between `main` and the RC, then deployed matches `main` and differs from the RC — which is precisely what *"the promotion changes exactly one function's CORS"* means.

**That is a hypothesis, not a measurement, and I am not recording it as settled.** It is a one-command check and it is ordered below. I flag my own reasoning here deliberately: completing a sentence with a plausible mechanism instead of measuring it is the error I have made three times in this engagement.

---

## 5. Effect on completion

| Gate | Before | Now |
|---|---|---|
| G5 — 71-function re-measurement | 0.5 | **0.75** — CORS independently verified; drift still unsettled |
| all others | unchanged | unchanged |
| **Credited** | 1.75 / 9 ≈ 20% | **2.0 / 9 ≈ 22%** |

Basis: the nine release gates in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md`. Classification OWNER-ATTESTED estimate.

**Evidence track:** CORS closed. Drift open, and now open for a better reason than before — we know exactly what is wrong with it.

---

## 6. Orders issued

### Developer 1 — WO-11

1. **Reword A11b argument 1** as specified in §2. The conclusion stands; the proof claim does not.
2. **Renumber your C-19 to C-20** everywhere before it propagates.
3. **Publish the endpoint register.** One table: every commit hash used as an endpoint anywhere in this engagement — `a42b209e`, `fe63e944`, `9ac4524d`, `702e5ce`, `b671e1fb`, `25c0456` — with, for each: what it is, which document used it, and for what. Then state which single hash is the release candidate, and show `git cat-file -t` for it. **This is now the top of your queue, ahead of A14 and A15.**
4. **Answer 4c with a measurement**: does `submit-judge-decision`'s CORS mechanism differ between `main` and the RC? One diff. Report the two mechanisms.
5. Then A14 (C-18 citation correction) and A15 (138-file index — **only if the auditor says they want it**; ask first).
6. Then Lanes A, B, C as ordered, including A17 (urgent — can the injectable job run on a non-`main` branch today?), A16 and A18.
7. **Ship every instrument with its number, from now on. F-30 is a standing rule.**

### Developer 2 — WO-12 (blindness partially lifted, deliberately)

Endpoint identifiers are **inputs**, not answers. Developer 2 is given hashes; it is still given no expected counts, and must not be.

1. **Re-run Task 1 against the endpoint the owner supplies**, in addition to the two already measured. Report all three side by side, each labelled with its hash. Change no definitions.
2. **Resolve F-32 before it is quoted anywhere.** `git fetch --all --tags --prune`, re-check the 16 files, and state whether the clone was stale. If the 403 still blocks confirmation that the clone matches `origin`, mark it **BLOCKED** and say so — do not report "exists nowhere in the repository" until the stale-clone explanation is excluded.
3. **Expand F-31.** For all 71 bundles, not just `send-gift-credit`: how many are hybrids, assembled from more than one source version? Report per bundle, per file.
4. **Do not read** any Developer 1 report, the rev6 pack, or any document naming expected totals. Your value is still that you do not know them.

---

## 7. Note for the record

Two sessions measured the same 71 bundles with instruments that share nothing. They agreed on CORS to the function, disagreed on drift for a reason that turned out to be an endpoint definition rather than a measurement error, and each caught a bug in its own tool before publishing.

That is what the evidence standard was built to produce, and this is the first time it has produced it.
