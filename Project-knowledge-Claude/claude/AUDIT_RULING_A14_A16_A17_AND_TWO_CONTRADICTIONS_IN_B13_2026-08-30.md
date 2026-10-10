# Audit ruling — A14 / A16 / A17, the citations resolved from the frozen ledger, and two contradictions inside a signed owner ruling

Date: 2026-08-30
Role: auditor. I produced none of the work ruled on here.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`. No commits, tags, pushes, merges, deployments, migrations or provider writes.

**Ledger integrity re-verified by me just now**, on the copy in this container:
`sha256 f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943` · `182,502 bytes` — identical to the frozen value. Every quotation below is read from that file, not from memory or paraphrase.

---

## 0. Developer 1's direct question — ANSWERED

> *"Confirm `SUPABASE_DB_URL` is not among the repository secrets. Names only."*

**CONFIRMED. It is not.** Captured by me in the owner's browser earlier today:

- **Repository secrets — exactly four:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (all Jul 24, 2026).
- **Environment secrets — exactly one:** `SUPABASE_DB_URL`, on the **`production`** environment only (Aug 23, 2026).
- Repository variables: 0. Environment variables: 0.

Classification: **OWNER-ATTESTED** — I captured it, so I do not audit it. It goes to the independent auditor with the screenshots. A17 item 2 may proceed on it labelled OWNER-ATTESTED, not VERIFIED.

---

## 1. A16 — the endpoint register. ACCEPTED, and it is the best single piece of work in this engagement

`git cat-file -t a42b209e` → `commit`. The RC is `a42b209e4f70a6efed4f3dcdb654e0f994416594` and nothing else.

**The finding resolves my §4a worry, and resolves it better than I framed it:** the tree hash of `supabase/functions/` is **identical** — `c7876a89b31a4f92b822e127f7f651e13c71667c` — at `25c0456`, `a42b209e`, `fe63e944`, `393bc55` and `9ac4524d`. Developer 2's endpoint and Developer 1's endpoint are the **same endpoint where it matters**: zero files differ under `supabase/functions/`.

The two drift measurements were not taken against different things. **Their agreement is a measurement, not luck** — and, correctly stated, it does not generalise: under `src/` the two differ by six files.

**Three things earn particular credit.**

1. **Adding a seventh endpoint I did not list.** `393bc55` (REV-13) is already in the ledger carrying C-12's "as at REV-13" figures. *"A register that omits an endpoint already in use is the defect it exists to fix."* Correct instinct — the register's job is completeness, not confirmation of my list.
2. **The file-count trap.** The file count is **138 at four different endpoints.** A matching file count is therefore not evidence that two endpoints agree. **Adopted as standing rule 5, generalised: matching totals are never evidence of agreement — only a per-item comparison is.**
3. **Retracting "the baseline covered 98 of the 138 files."** Recorded false, never to be written again.

### 1a. Order — reconcile the drift per function, not by total

Developer 2 reported **21 match** against the RC. Developer 1's import-map-excluded triple leads with **21**. Rule 5 says that proves nothing.

**Order:** publish the bucket labels for `19/21/31`, `19/22/30`, `21/21/29`, `21/22/28`, then compare **per function name** against Developer 2's list. Report the set difference in both directions. Two totals of 21 built from different functions would be the most dangerous false agreement available to us.

---

## 2. `702e5ce` — the retraction has a consequence neither of us stated

Developer 1 established that `702e5ce` is **not on the same line of development as `main`** — merge-base `32930e75`, joined later by `9faf5a17`. The ledger's own commit table (line 545) lists it as one of four "Add files via upload" commits, **part of PR #102**.

Now read what rests on it. §23.5.3, verbatim:

> ⚠ **The 71-function comparison was taken on 2026-08-26 against `staging @ 702e5ce`.**
>
> | `21 MATCH · 21 secureHeaders-only · 29 DRIFT · 0 UNKNOWN` | as of **2026-08-26**, staging `702e5ce` | **VERIFIED (as of that date) — NOT re-measured** |

**That split is the measured basis of B13 — a signed owner ruling.**

The ledger already knows the numbers are **stale by date**, mandates re-measurement at runbook step 15b, and records at §23.5.1 condition 5 that the review may not be done against them. What the ledger does **not** know is that the baseline may not have been `staging` at all, but a branch parallel to it. **Staleness and wrong-line are different defects: a stale number was once correct; an off-line number was never a valid baseline for this promotion.**

**Ruling: §23.5.3's class `VERIFIED (as of that date)` is DISPUTED pending measurement.** §3.5 rule 5 matter — the figure carries a basis, and the basis label is in question.

**The consequence that must reach the owner's auditor today:** `WO3_drift_702e5ce.json` was **one of the two files they recomputed their drift tallies from.** Part of their corroboration rests on a drift file computed against a commit now shown to be off the promotion's line. They must be told, and they decide what it does to their own classification.

---

## 3. A14 — the two flagged citations, resolved by reading the frozen ledger

**Refusing to guess a clause number was exactly right, and is the lesson of C-18 correctly applied.** Neither should have been changed on a guess. Both are now resolved by reading.

### "B13 condition 4" — **CORRECT AS WRITTEN. Do not change it.**

§23.5.1, condition 4, verbatim:

> "Before any G9 function deployment, the **71 production function bundles must be captured AND HASHED** so the pre-deployment state is reconstructible. A captured snapshot alone is not sufficient; the hashes are required."

Accurate. Leave it.

### "B13 condition 15b" — **DOES NOT EXIST. B13 has conditions 1–7.**

`15b` is a **runbook step**, not a B13 condition. §12 step 15b, verbatim:

> "**15b.** **Re-measure** the drift. The `21/21/29/0` split is **as of 2026-08-26 @ `702e5ce`** and is stale against RC-20260829-05 (§23.5.3). The review may not be done against the old numbers."

Runbook step 15 implements B13 conditions 4, 5 and 6 as sub-steps 15a–15d. **Correct rendering:** *"runbook step 15b (§12), which implements B13 condition 5 (§23.5.1)."* Record as **C-21**, original preserved.

### Also confirmed while I was in the file — the auditor's quotations are exact

§23.5.1 condition 2, verbatim: *"No edge function is deployed as part of this promotion. The G9 function work is excluded from RC-20260829-05 entirely."*

The limits paragraph, verbatim: *"Do not deploy functions, merge PR #104, apply migrations, create a tag, or perform production writes merely because I have accepted B13."*

**The owner's auditor quoted both accurately. C-18 stands, and the fast-close withdrawal stands.**

---

## 4. TWO CONTRADICTIONS BETWEEN MEASUREMENT AND A SIGNED OWNER RULING

The most serious items here. Both concern the **factual basis on which the owner signed B13.**

### 4a — F-34. The ledger says the lane guard is missing in **ten** functions. Two instruments say **all seventy-one.**

§23.5.1, accepted risk 3, verbatim:

> "**The storage-lane guard is absent in ten functions:** `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`, `detect-orphan-files`, `backfill-image-dims`, `media-register-upload`."

Naming ten implies the other sixty-one have it.

Against that: **C-14-L** — `assertStorageLane` appears in **zero of 71** deployed bundles (Developer 1), independently reproduced by the owner's auditor with **a substring search they wrote themselves** (0/71, confirmed without our tooling). **Two instruments, one of them the auditor's own.**

**If both stand as stated, the owner signed a risk acceptance describing an exposure roughly seven times smaller than the measured one.** A risk acceptance signed on a wrong magnitude is not informed consent, and B13 would have to be re-taken.

**I am not asserting that, because a benign reading exists and has not been excluded:** the ledger's "ten functions" may describe the **RC source**, while C-14-L measured **deployed bundles**. If the RC has the guard in sixty-one and production does not, that is deployment drift — serious, but not a defect in B13's text.

**Ordered, and now the highest-priority measurement in the engagement:** does `assertStorageLane` — or whatever construct the ledger means by "the storage-lane guard" — appear in the **RC source** of the sixty-one functions not named in risk 3? Report RC-source count and deployed-bundle count side by side. **Name and quote the construct being searched for.** Do not search for a name and report on a concept.

### 4b — F-35. B13 risk 1 asserts a byte-identical file across production

§23.5.1, accepted risk 1, verbatim:

> "The deployed `_shared/secureHeaders.ts` is **byte-identical across production** (md5 `58b9f45d…`) and uses prefix matching with a `.lovable.app` wildcard."

Against that, from the blind run: **four live versions of `_shared/s3.ts` and four of `_shared/imageDims.ts` simultaneously in production**, and `send-gift-credit` is a **hybrid** — RC `index.ts`, `main` `secureHeaders.ts`.

**This is not yet a contradiction.** If every deployed `secureHeaders.ts` is `main`'s, risk 1 holds and the hybrid concerns only `index.ts`. But production is now shown non-uniform in two other shared modules, and this assertion is load-bearing in a signed ruling.

**Ordered:** md5 `_shared/secureHeaders.ts` across **all 71** deployed bundles. Report the distinct count, and if more than one, which bundles carry which. Confirm or refute `58b9f45d…`.

*(The `.lovable.app` wildcard in the same sentence is independently corroborated — Developer 2, blind, reported the allowlist reflects every `*.lovable.app` host. F-33 stands.)*

---

## 5. A17 — ACCEPTED, and I over-escalated F-29. My error.

### The measurement

| Workflow | On `main` today | Runnable off `main`? |
|---|---|---|
| `apply-migration.yml` | `workflow_dispatch`, no branch filter, no `if:`, zero `github.ref` guards | **YES** |
| `verify-schema-dependencies.yml` | **does not exist on `main`** | NO — the merge creates it |
| `android-build.yml` | `push: branches: [main]`, two paths | NO |

**Line 77 is the finding, not the trigger.** `# environment: production` is commented out today, so `${{ secrets.SUPABASE_DB_URL }}` resolves empty and the job's own first step exits 1. **The injection path is open; the credential behind it is not reachable through this file today.** At the RC the line is live: `environment: ${{ inputs.target }}`.

### Two independent sources converge, and the picture is now complete

Developer 1 read the workflows. I captured the environment configuration. Neither knew the other's result:

- the RC turns the environment gate **on**, and the environment is chosen by the **dispatcher's input**;
- `SUPABASE_DB_URL` exists **only** on the `production` environment;
- the `production` environment permits **only** the `main` branch;
- **required reviewers: OFF · wait timer: OFF · administrator bypass: ON.**

**Therefore, after the merge, a `workflow_dispatch` on `main` with `target=production` reaches the production database URL through an injectable job, and nothing stops it — no reviewer, no timer, and no bypass needed.** Off-`main` dispatch is stopped by the branch policy. On-`main` dispatch is stopped by nothing.

### F-36 — the safety control lives outside the reviewed scope

Developer 1's sentence deserves its own number: *"what then stands between a dispatch on any branch and production SQL is a GitHub environment setting that is not in the 138 files and changeable in the UI without a commit."*

**The promotion's safety depends on a control that is not in the change set, not under review, not version-controlled, and editable without leaving a trace in the repository.** A governance finding, and it belongs in the ledger.

### F-29 — I over-escalated it. Conceded.

I wrote that F-29 "may outrank the entire promotion question." **It does not, and Developer 1 measured why.** The injectable workflow references no Android secret; shell injection reaches only what the workflow YAML puts in the runner. `android-build.yml` is the sole consumer of `secrets.ANDROID_*` and is push-to-`main`-only.

My reasoning had a missing step: *repository secrets are available to any branch* is true, but a workflow must **reference** a secret for injected code to reach it. I jumped from availability to reachability. **Same family as C-19 and C-12 — a plausible completion in place of a measurement.** Logged as **C-22**.

**Developer 1's residual is the correct one and I adopt it:** repository-secret scope still allows a collaborator to push a new workflow on any branch that reads them. **The remedy is scoping the four `ANDROID_*` secrets to an environment, not filtering triggers.** F-29 stands, downgraded to a scope-class finding for the post-promotion list.

---

## 6. A15 and pack rev9

**A15 — offered, not produced. Correct**, and the offer carries the scope, three specimen rows and the self-auditing risk in full. That is what "offering it is not proposing they use it" means. Build nothing until the auditor asks.

**Pack rev9** — 132 files, manifest covers 131, coverage PASS on an independent walker, round-trip 131/131, archive `e7cb4756773b693071e7dfa03f58e2b5de30ff9093d5dbe7d5876898e3bce124`, 1,368,179 bytes, measured twice. Full hash published, not abbreviated — rule 3 satisfied.

**One confirmation before this is quoted anywhere:** state explicitly that the single uncovered file **is the manifest itself**, and that nothing else is uncovered. Given the earlier generator defect that excluded *every* file named `MANIFEST.sha256`, "132 minus 131 = the manifest" must be measured and named, not assumed.

---

## 7. Completion

| Gate | Before | Now |
|---|---|---|
| G5 — 71-function re-measurement | 0.75 | **0.75** — endpoint question closed; per-function reconciliation open |
| G1 — RC free of known-armed defects | 0 | **0.25** — mechanism fully characterised from two independent sources; the fix is not built |
| **Credited** | 2.0 / 9 ≈ 22% | **2.25 / 9 ≈ 25%** |

**Warning attached to this number.** If F-34 resolves against the ledger, **B13 must be re-taken by the owner** — a risk acceptance signed on a magnitude wrong by roughly seven times is not informed consent. That opens a gate rather than closing one. **Do not treat 25% as monotonic until F-34 returns.**

Classification: OWNER-ATTESTED estimate, basis in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md`.
