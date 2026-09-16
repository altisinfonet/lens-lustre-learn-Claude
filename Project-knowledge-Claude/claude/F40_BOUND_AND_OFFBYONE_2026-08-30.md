# F-40 bounded, F-41 accepted, the off-by-one explained — and C-27, where I asked the wrong question

Date: 2026-08-30
Role: auditor. §4 applies a new rule to my own earlier work rather than only to theirs.

---

## 1. C-27 — I framed a set question as a count question, and my framing would have missed a record

I ordered: *"enumerate every function where `n_prod ≠ n_rc`."*

**That is the wrong question, and Developer 1 was right to reject it.** `classify()` compares path **sets** before content and returns on the first branch, so the population at risk is *"classified on a path-set difference"* — not *"counts differ"*.

| set | count |
|---|---|
| A — `n_prod ≠ n_rc` | 17 |
| B — DRIFT returned without hashing anything | **18** |
| A \ B | 0 |
| **B \ A** | **1 — `auth-email-hook`** |

`auth-email-hook` has `n_rc = n_prod = 8`: `deno.json` only in prod, `_shared/laneConfig.ts` only in the RC. **One each way, so the counts match and the sets do not.**

**My question returns 17 and misses one.** I wrote rule 5 — *matching totals are never evidence of agreement* — and then asked for a bound by counting. Recorded as **C-27**.

It is the same shape as C-24 and C-26: a plausible proxy substituted for the actual property. **Rule 11 was right to demand the measurement instead of the argument, and rule 5 fired inside the instrument's own output against the auditor who wrote it.**

---

## 2. F-40 — BOUNDED BY MEASUREMENT. Two verdicts of seventy-one.

Developer 1 then asked the question `classify()` never asked, and hashed the common files for all 18:

| class | n | detail |
|---|---|---|
| **F-40 only — flips to MATCH** | **2** | `handle-email-suppression`, `handle-email-unsubscribe` — 1 common file each, 0 content differences |
| Both — detail contaminated, **verdict survives** | **1** | `auth-email-hook`: `laneConfig.ts` genuinely absent, and all 7 common files differ, including `index.ts` and all six `_shared/email-templates/*.tsx` |
| **Genuine** | **15** | every one content-confirmed — `process-email-queue` 17 of 21 common files differ, `send-transactional-email` 17 of 22, the four `s3-*` on `secureHeaders.ts` plus their own `index.ts` |

**F-40 changes exactly 2 verdicts of 71. Measured, not argued.** The bound I offered as reasoning last round is now a measurement, and it arrived at the same place by a route that would have caught it had it not.

---

## 3. F-41 — ACCEPTED, and it is larger than F-40

> *"For 18 of 71 records the published DRIFT rested on no content comparison at all. It was right for 16 by accident of ordering — **the evidence confirming them did not exist until this measurement.**"*

**This is the finding, and it is a good deal more serious than the two flipped verdicts.** Sixteen DRIFT verdicts were *correct and unevidenced*. Correct-by-luck is not a class in the evidence standard; it is INFERRED wearing a VERIFIED label. They are now content-confirmed, so the census is evidenced where before it was fortunate — but the record must say which state it was in, and when.

**The remedy statement is the part to keep, and it connects straight to the ledger:**

> *"A verdict that cannot distinguish 'these files differ' from 'I enumerated the files differently' is under-specified for what step 15b asks."*

Runbook step 15b requires the drift to be **re-measured**, and B13 condition 5 requires a **per-function review of the drifted functions, three in the opposite direction**. A verdict that conflates a path-enumeration difference with a content difference cannot support that review. **The remedy — hash common files even when path sets differ, and emit `path_set_delta` and `content_delta` as separate fields — is the right shape and is correctly held as prepared, not installed.**

---

## 4. Rule 13 — Developer 2's, adopted, and applied to my own work first

> *"I reported 'the path is still empty' as a present-tense fact when it was an observation from 16:38Z, and the file was created at 16:45:12Z. **A negative measurement without an as-of time** is exactly the defect I have been flagging in other people's rows all afternoon."*

**Standing rule 13: a negative measurement carries its as-of time. "Not present", "zero of N", "no members" without a timestamp is not a measurement.** Positives are durable — a digest that matched, matched. **Negatives decay**, and every negative in this engagement has been written as though it does not.

### Applied to my own §25.3 captures, now, rather than ordered for someone else

My console captures were written as bare negatives. **Corrected with their measured capture times, converted from the artefact timestamps in this container:**

| Row | Negative as published | **As-of (UTC)** |
|---|---|---|
| 1.6b | `isolation-probe/` — 0 objects in `50mm` | **2026-08-30T13:46:54Z** |
| 1.6b | `isolation-probe/` — 0 objects in `50mm-staging` | **2026-08-30T13:47:52Z** |
| 1.6c | No Access policy covers `staging.50mmretina.com`; 0 reusable policies | **2026-08-30T13:49:22Z–13:49:55Z** |
| 1.5 | `staging` environment — no secrets, no variables | **2026-08-30T13:50:48Z** |
| 1.5 | `production` — no required reviewers, no wait timer | **2026-08-30T13:52:07Z** |
| 1.5 | `SUPABASE_DB_URL` **not** among repository secrets; 0 repository variables | **2026-08-30T13:55:48Z–13:56:30Z** |
| 1.4 | No token spans both buckets | **2026-08-30T13:46:13Z** |

**These are the exact negatives the independent auditor is being asked to close §25.3 rows on.** They were undated when I sent them. That is corrected here, and the corrected table should travel with the screenshots.

**Every other negative in the engagement needs the same treatment** — "0 of 71 carry the lane assertion", "no hybrids", "0 remote refs", "none fires on a branch push", "worker.js absent from the patch set". Ordered for both sessions: stamp them.

---

## 5. Rule 14 — "a diff is not a vector", and the off-by-one is explained

**Cause, named and not merely superseded:** `.github/workflows/verify-schema-dependencies.yml` **does not exist on `main`**, so across `main…a42b209e` it is 108 additions, 0 deletions. The single line the patch deletes is **itself one of those 108 additions**. Deleting an added line **removes an addition and can never appear as a deletion** — there is no `main`-side line to delete against.

`108 + 11 − 1 = 118` additions, 0 deletions. Measured: **118, 0.**

**I checked the composition myself rather than accepting it.** The other two files compose exactly — `+75/−5` with `+18/−5` → `+93/−10` ✓, and `+64/−7` with `+7/−1` → `+71/−8` ✓ — which localises the discrepancy to the one file. Naive vector addition on that file gives `+119/−1`; the truth is `+118/−0`. **That is exactly one addition and one deletion too many, which is exactly the gap between the projection `+9,096/−1,300` and the measurement `+9,095/−1,299`.** The arithmetic closes with nothing left over.

**Standing rule 14, adopted in their words:** *a diff is not a vector. Line counts compose additively only when every patched file exists at both endpoints of the outer range. For a file created inside the range, the two columns are not independent — a deletion cancels an addition instead of adding a deletion, and the arithmetic silently loses one from each.*

And their own disposition on it is the right one: *"My projection did vector addition on diffstats and never checked the precondition; it was never a measurement and I should not have offered it as a number to check against."* Same family as A16's file-count trap — **an operation valid on totals only under a condition nobody stated.**

---

## 6. The PR hazard, now fully specified

`security.yml`, `typecheck.yml`, `ui-gate.yml` and `web-build.yml` each carry `pull_request: branches: [main, staging]`. **A push fires none; a PR fires four. A PR is not a push.**

**Standing: no pull request from `rc-replacement/option2-2026-08-30`.** Branch local, unpushed, authority not sought, 0 remote refs — as of the rev15 measurement.

---

## 7. Completion — and why it does not move

| Gate | Before | Now |
|---|---|---|
| G1 | 0.75 | **0.75** |
| G5 | 0.95 | **0.95** |
| **Credited** | 2.95 / 9 ≈ 33% | **2.95 / 9 ≈ 33%** |

**Two excellent returns and the number does not move. That is the correct answer, and it is worth stating plainly.** Everything in this round was *our instruments correcting our instruments* — F-40, F-41, the off-by-one, C-27, rules 13 and 14. None of it closes a release gate, because none of it was ever a release gate. It made the existing evidence honest, which is a precondition for the auditor's work, not a substitute for it.

---

## 8. What is actually left, and who holds it

**Nothing on the critical path is now held by either developer session.** Both have run out of work that shortens the release.

| Item | Held by |
|---|---|
| **138-file review** | the independent auditor — **not begun on any side** |
| §25.3 rows 1.4 / 1.5 / 1.6b / 1.6c closure | the independent auditor (§25.4) |
| Independent test-suite run closure | the independent auditor |
| 71-function re-measurement closure | the independent auditor — **the measurement is complete; only the closure is missing** |
| A15 index — build or not | the independent auditor |
| §5.3 probe | the owner |
| §11 signature | the owner + auditor |
| Tag, merge | the owner |
| `ANDROID_*` secret scoping | the owner, post-promotion |

**Six of the nine gates wait on one person who has not started.** Everything both sessions built today finishes inside that review, and no further measurement shortens it by a day.
