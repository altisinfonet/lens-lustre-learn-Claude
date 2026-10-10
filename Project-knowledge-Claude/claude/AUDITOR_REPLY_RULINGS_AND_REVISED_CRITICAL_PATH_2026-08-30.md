# Auditor reply received — rulings, my own error, and the revised critical path

Date: 2026-08-30
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes.

**Assessment of the reply: excellent, and the most useful single document this engagement has produced.** It disclosed its own dependency on our instrument unprompted, split a question we asked as one into two because the answer differed across them, refused to certify work it had not done, and corrected a claim in my own letter. Every one of those is the behaviour of a real auditor. Accepted in full.

---

## 1. MY ERROR — C-18, and it is a serious one

### 1a. I cited the wrong clause, all engagement

I have written **"B13 condition 2"** repeatedly. The auditor extracted the actual text by `git show` from `origin/staging` rather than trusting my paraphrase. The clause is **§23.5.1 condition 2**:

> "No edge function is deployed as part of this promotion. The G9 function work is excluded from RC-20260829-05 entirely."

Every occurrence of "B13 condition 2" in my documents is a **citation error** and must be corrected to §23.5.1 condition 2, with the original preserved beside the correction.

### 1b. The fast-close plan rested on a clause that forbids that use — **the option was never available**

The auditor surfaced the neighbouring sentence:

> "Do not deploy functions, merge PR #104… merely because I have accepted B13."

My fast-close plan (`claude/FAST_CLOSE_PLAN_THREE_PARALLEL_TRACKS_2026-08-30.md` §2) proposed a recorded deviation whose entire ground was that clause. **The ledger explicitly says that clause cannot be used to justify merging PR #104.** So the deviation I offered was not merely risky — it was **built on the one sentence that rules it out.**

**Ruling: the fast-close option is WITHDRAWN, not declined.** The record must show it was defective, not that the owner passed on a valid shortcut. Had the owner chosen it, we would have merged on a ground the ledger prohibits, and the auditor would have refused the countersignature — after the deviation was already signed.

This is the same error family as C-12 and LG-05-DEF-1, and the same parent rule: **compression is where scope falls off.** I compressed a two-sentence clause to its first sentence. The second sentence was the whole point.

**The owner's instinct to take the normal close was correct on grounds neither of us knew at the time.**

---

## 2. Q1 answered — the instrument lineage

### Drift totals — **NOT independent. Confirmed defective on both sides.**

The auditor recomputed the aggregate tallies with `collections.Counter` over **our own output files** (`WO3_drift_702e5ce.json`, `WO3_drift_a42b209e.json`), which are the product of `07_ws4_reference_impl.py`'s `closure()`. They independently confirmed that tokenizer treats bare `'` as a generic string delimiter with no JSX-text-child awareness — the exact defect.

**Ruling:** 19/21/31, 19/22/30 strict, 21/21/29, 21/22/28 import-map-excluded → **INFERRED on both sides, effective now.** They return to VERIFIED only on a re-run through a repaired tokenizer, or reproduction by a genuinely separate instrument.

My F-27a is therefore answered for drift: **the corroboration inherited the defect.** This is exactly the failure mode the question was written to catch, and it caught it.

### CORS census — **UNKNOWN, and the auditor has correctly refused to guess**

They recomputed from `CORS_CENSUS_71.json`'s per-function fields but have not seen the producing script, so they cannot say whether it calls the same `tokenize()` / `closure()` path or is an unrelated grep/regex classification. They ask this be answered **specifically**, not folded into the drift answer.

**This is now the single highest-value open question**, because it decides whether 27/39/2/3 stands or joins drift in INFERRED. → **A11b, issued below.**

### What survives as VERIFIED — bank these

Four measurements the auditor made with instruments they wrote or by direct reading. These are unaffected by whatever A9 and A11 return:

| Measurement | Method | Status |
|---|---|---|
| WS-HASH-v1 across all 71 production + 74 staging raw captures — **0 mismatches** | direct byte-level recomputation | **VERIFIED** |
| `assertStorageLane` — **0 of 71** production bundles | substring search they wrote themselves | **VERIFIED — independently, second instrument** |
| `detect-orphan-files` performs no deletion | direct read of `index.ts` from the repository | **VERIFIED** |
| §23.5.1 condition 2 exact text | `git show` from `origin/staging` | **VERIFIED** |

**C-14-L now has two independent instruments behind it.** It is the best-evidenced finding in the engagement, and it describes a production system with **no storage-lane guard anywhere**. That is not a release item and must not wait for one.

---

## 3. Q2 — the four §25.3 rows need the owner in a provider console. **I verified this rather than relaying it.**

The auditor states the required access does not exist in their tool set. I checked my own before accepting that, because relaying an access claim is exactly the RELAYED-vs-VERIFIED error I have made before.

**My tool search result:** the Cloudflare tools available to me are bucket-level only — `r2_buckets_list`, `r2_bucket_get`, `r2_bucket_create`, `r2_bucket_delete`. There is **no object-listing (ListObjectsV2) tool, no API-token scope/policy tool, and no Zero Trust / Access policy tool.** There is **no GitHub tool of any kind.**

**Ruling: the access gap is VERIFIED on all three sides — auditor, compiler, and developer.** No further compiler pass will close these four rows. They require **Neil, personally, in the provider consoles.** They are now on the critical path and have been silently blocked for weeks because nobody stated what they needed.

### Owner console tasks — do these yourself, record names and scopes, **never values**

| Row | Console | What to record |
|---|---|---|
| **1.4** | Cloudflare → My Profile → API Tokens (or Account API Tokens) → the R2 token | token **name**, its permission list, its resource scope, created date. **Do not copy the token value.** |
| **1.5** | GitHub → `altisinfonet/lens-lustre-learn-Claude` → Settings → Environments → `staging` | protection rules, required reviewers, deployment-branch policy, and the **names** of the secrets. **Names only — never values.** |
| **1.6b** | Cloudflare → R2 → buckets `50mm` and `50mm-staging` → browse/search the `isolation-probe/` prefix | object count under that prefix in **each** bucket (expected 0) |
| **1.6c** | Cloudflare → Zero Trust → Access → Applications / Policies | the policies covering `staging.50mmretina.com` — name, action, included/excluded rules |

Screenshots or copied text of the **scopes and names** are the evidence. Standing constraint applies without exception: **do not expose secrets, tokens, cookies or credentials.** If a screen shows a secret value, do not capture that screen.

---

## 4. The 138-file review has not been done — by anyone

The auditor corrected my letter, and they are right. They performed targeted spot-checks tied to specific findings (`detect-orphan-files`, the §23.5.1 text, a few source files) plus the pack's own `docs/`-reference scan — **which itself disclosed it was not a general review.**

My letter said the 134–136 unchanged files could be "reviewed now" and delta'd later. That framing implied a review in progress. **There is none.** Correcting my own letter's claim: the 138-file review is a **from-scratch task**, and it is now the true long pole.

### Proposal, for the auditor to accept or refuse

To make 138 files tractable without costing independence: the **developer** produces a structured review index — per file: path, diff size, change category, risk class, and the specific constructs that need eyes. The **auditor** reviews and forms their own conclusion; the index is navigation, not judgement.

**The risk must be stated plainly:** if the auditor closes rows by agreeing with the index rather than reading the files, the index has audited itself and the review is worthless. **The auditor should decide whether they want the aid at all.** Offering it is not proposing they use it.

---

## 5. Revised critical path — honest new estimate

The earlier "about a week" is withdrawn. Two things changed it: the 138-file review is from scratch, and four rows now wait on owner console access.

| Item | Owner | Blocking | Note |
|---|---|---|---|
| **A11b — CORS census lineage** | developer | sizes the CORS re-run | **today, one answer, ahead of everything** |
| **§25.3 console captures ×4** | **Neil** | 4 of the blocked rows | **today — nobody else can do these** |
| Lexer repair, planted-defect proof, re-run all 71 | developer | drift returns to VERIFIED | ~2 days |
| Option 2 patches + replacement RC branch | developer | G1 | ~1 day, needs owner authorisation |
| **138-file review, from scratch** | **auditor** | G3 | **the long pole — days, not hours** |
| §5.3 probe, §11 signature, tag, merge | owner + auditor | G7–G9 | last |

**Revised estimate: 10–14 days**, driven by the 138-file review. Classification: **OWNER-ATTESTED estimate**, basis stated. Still 15 steps, still no deviation, still a clean ledger entry.

The estimate went up because we learned something true. That is the correct direction.

---

## 6. Issued now

**A11b (developer, urgent, ahead of the full return).** Identify the script that produced `CORS_CENSUS_71.json`. State whether it imports or calls `tokenize()` / `closure()` from `07_ws4_reference_impl.py`, or any shared module that does. Show the import graph or the file. If it shares the path, the CORS census joins drift as INFERRED and must be re-run after A9. If it is an independent grep/regex classification, say so and show the code. **Answer this on its own, immediately.**

**A14 (developer).** Correct every occurrence of "B13 condition 2" to "§23.5.1 condition 2" across all documents and the pack, preserving the original beside each correction. Record as C-18.

**A15 (developer).** Produce the structured 138-file review index described in §4 — **as navigation for the auditor, explicitly not as a review.** Every row must state it is an index entry, not a finding.

All standing constraints unchanged and in force. No merge, tag, deploy, migration, §5.3 probe, production write, ledger edit or secret read. The replacement RC branch remains permitted on owner authorisation only.
