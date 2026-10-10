# Audit ruling — the declared bucket mapping, the contamination (my fault), and the patches that would not apply

Date: 2026-08-30
Role: auditor. I produced none of the work ruled on here. The bucket mapping in §3 is a **ruling**, which is auditor work, and is issued before either session sees the other's list.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943`. No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 0. Correction that must reach Developer 1 immediately — an answer of mine has not been delivered twice

Developer 1's blocked list still contains *"the `SUPABASE_DB_URL` repository-secret check on you [the owner]."*

**That check is DONE and was answered this morning.** Repository secrets are exactly four — `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. `SUPABASE_DB_URL` is an **environment** secret on `production` only. Classification **OWNER-ATTESTED** (I captured it).

This is the **second** time today a ruling of mine failed to reach Developer 1 before they acted on the stale version — the first being the withdrawn `702e5ce` framing (C-23), which they carried forward as their own finding. **The relay between this session and the developer sessions is a live defect in the working structure**, not an incidental slip, and it has now cost one wrong finding and one item held blocked that was already answered.

---

## 1. The contamination — Developer 2 handled it correctly. **The cause is my instruction.**

Developer 2 froze first: `SESSION2_PER_FUNCTION_VERDICTS.tsv`, `2026-08-30T16:22:20Z`, 5,850 bytes, 71 rows, **sha256 `6588bca59d538b77cd2c104ff323902fcf16f45bd2051530e55bd4803a1756e3`**, re-verified unchanged. **Then** searched for Developer 1's file, and the project search returned snippets from excluded documents.

**Ruling: the frozen list is uncontaminated and stands.** The freeze precedes the exposure, the hash proves it, and the hash is independently checkable. Nothing seen after 16:22:20Z can have moved a row. **Declaring it unprompted is the behaviour the standard exists to produce.**

**But the contamination is my design defect, and I am recording it as mine.**

- I ordered Developer 2 to obtain a file **without telling them where it was.** An instruction to find a file in a shared knowledge base is an instruction to search it.
- I enforced blindness with a **filename blocklist**. Project search returns **snippets of content**, matched on content. A name-based filter cannot protect against a content search — it never could, and I should have seen that when I wrote it.

**F-38 — blindness cannot be enforced by a filename blocklist inside a shared knowledge base.** It requires either a separate container, or delivery of every input by exact path so the blind session never issues a search. **Standing rule 9: a blind session is given exact paths, never a name to look for.**

**Consequence, accepted:** Developer 2's blindness is spent. Its frozen output remains fully valid. **Any future genuinely-blind measurement must come from a third session**, and that session must be handed its inputs by exact path.

---

## 2. Deliver the file by path, not by search — the fix for both problems at once

`DRIFT_PER_FUNCTION_BUCKETS.tsv` (sha256 `951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da`, 3,623 B, 72 lines) exists only in Developer 1's container and pack rev11. Developer 2 cannot reach it.

**Order: Developer 1 writes it to the project with `project_write`, at an exact path, and reports that path and the hash.** Developer 2 then reads **that exact path only** — no search, no discovery. Same for Developer 2's frozen TSV, already in the project.

Each side verifies the other's published hash on arrival before joining. Both hashes are on the record, so substitution or drift is detectable by either party.

---

## 3. RULING — the bucket mapping, declared before either side sees the other's list

Developer 2 is right that this must not be invented by a measuring party after seeing the other's answer, and right that a naive join on function name would manufacture disagreement.

Developer 1's vocabulary is four-valued: `MATCH | HEADER-ONLY | DRIFT | UNKNOWN`.
Developer 2's is two-valued by construction: any byte difference, missing file or extra file is `DRIFT`.

### The join runs in two passes. Pass 1 is the agreement test. Pass 2 is the resolution test.

**PASS 1 — coarse, and this is the only pass that can show the two instruments disagree.**

Collapse Developer 1's four values to Developer 2's two:

| Developer 1 | maps to |
|---|---|
| `MATCH` | **MATCH** |
| `HEADER-ONLY` | **DRIFT** |
| `DRIFT` | **DRIFT** |
| `UNKNOWN` | **unmapped — reported separately, never silently folded** |

Endpoint for the comparison: **E3 = `a42b209e`**, the true RC, against Developer 2's `bucket_vs_E3_rc_a42b209e` column. Developer 1 must state which of their readings and which lane they are joining from.

**Agreement is defined, in advance, as: the two MATCH sets are identical by membership — symmetric difference empty.** Not equal in count. Rule 5.

Both sides currently report 21. **If the two sets of 21 are not the same 21, that is a genuine measurement disagreement and it outranks everything else in the evidence track.** We have already seen today that two 21s inside one instrument were disjoint.

**PASS 2 — fine, and a disagreement here is a resolution difference, not a contradiction.**

Within the set both sides call DRIFT, test Developer 1's finer claim: is the set they call `HEADER-ONLY` exactly the set whose **only** differing file is `_shared/secureHeaders.ts`?

Developer 2 supplies the raw material for this without re-measuring, from `out/census.json` — per-file drift kind (`CONTENT_DIFFERS`, `WHITESPACE_ONLY`, `MISSING_IN_DEPLOYED`, `MISSING_IN_REPO`), recorded **before** they saw Developer 1's vocabulary. **That provenance is what makes it usable, and it must be stated on the emitted view.**

**Yes — emit that partition as a separate frozen view, labelled `DERIVED AFTER CONTACT`, with its own hash.** The label is not a formality: it separates what was measured blind from what was arranged afterwards, and a future auditor must be able to tell them apart at a glance.

**A mismatch in Pass 2 is a vocabulary difference. A mismatch in Pass 1 is a defect. Do not report them under one heading.**

---

## 4. The patches did not apply — and this is the best save of the engagement

Developer 1 **tested the Option 2 patches instead of assuming**, because A-3 is where they would first be used. All three failed, under every invocation:

```
git apply -p1 : error: tmp/p1.yml: No such file or directory
patch -p0     : Ignoring potentially dangerous file name /tmp/p1.yml
patch -p1     : can't find file to patch at input line 3
```

Cause, self-reported: the `diff -u original /tmp/copy` method that kept the RC worktree untouched **also wrote the scratch path onto the `+++` line — which is exactly where every patch tool reads its target.** The safety property was correct; the artefact it produced was never tested.

Their own summary is the finding: *"The README said 'apply with review, not blindly'; it did not say 'these will not apply at all.'"*

**Consider where this would otherwise have surfaced.** The owner authorises A-3; a branch is cut; three patches are applied to it; all three fail. The first evidence that the fix does not exist would have arrived **during the only write operation in the whole plan.** Nothing else in the queue was positioned to catch it.

**Standing rule 8, adopted: a patch never shown to apply is not a patch.** Direct sibling of rule 1 — *a suite never shown to detect a planted defect is not evidence.*

**Accepted:** hunks were always correct; only header lines rewritten, no hunk touched; all three report APPLIES CLEANLY against `a42b209e`; re-verified after archive round-trip **from the extracted tarball**, which is the right place to verify it. Originals retained with a defect notice so both halves are on the record.

---

## 5. A-4 — the finding that shortens the critical path

| | frozen RC | replacement RC (projected) |
|---|---|---|
| files vs `main` | 138 | **138 — unchanged** |
| lines vs `main` | +9,060 / −1,293 | +9,096 / −1,300 |
| commits | 39 · 37 | 40 · 38 — **INFERRED**, depends on A-3 |

`apply-migration.yml` +18/−5 · `verify-schema-dependencies.yml` +11/−1 · `_seo.ts` +7/−1 · **total +36/−7.**

**The consequence, and it corrects a claim of mine:** in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md` I wrote that a replacement RC "resets G3 — the 138-file review scope changes and must be re-declared." **Measurement says otherwise.** All three patched paths are already members of the 138, and the patches add and delete no paths. **The auditor's 138-file review is not invalidated; a replacement RC costs them a three-file, 43-line delta.**

Recorded as **C-25**, my correction, original preserved.

**And the reason I accept it without re-deriving it:** Developer 1 applied rule 5 *against their own convenient result* — *"that is a per-item check, not the matching totals; rule 5 applies to my own table too."* A matching file count of 138 is exactly the trap they themselves documented at A16. They did not lean on it.

**One thing I will not infer.** The patch set is three files. `cloudflare/seo-edge-injector/worker.js` is absent. **State WO-8 B1's answer explicitly:** is `worker.js` inside the 138, and does it carry the construct? If the answer is no, say so and cite the measurement. Its absence from a patch list is not an answer.

---

## 6. Housekeeping — accepted

- **C-23 applied correctly**, and with a distinction worth keeping: the label names the **branch**, not the ancestry; the ancestry measurement is retained because it is the only reason `main..702e5ce = 98 files` must never be described as *"the first 98 of the eventual 138."* Dropping the framing while keeping the measurement is the right disposition.
- **Pack rev11:** 142 files, manifest 141, uncovered file enumerated as `['MANIFEST.sha256']` and nothing else, round-trip 141/141, `08196062b67d442281c49eed3524f5ba51d41fcb671bd2ea8bab82672db0ba32`, 1,390,100 bytes, measured twice. Full hash — rule 3 satisfied.
- **Lanes B and C complete.** Lane A is one owner authorisation from done.

---

## 7. The Developer 1 ↔ Developer 2 join — blindness lifted, deliberately, and in this order

Developer 1 reports the comparison **BLOCKED**: it holds Developer 2's aggregates, not their per-function list, and *"under standing rule 5 an aggregate is not agreement."* **Correct, and the right call.** `DRIFT_PER_FUNCTION_BUCKETS.tsv` is published in the shape the join needs.

Developer 2's blind phase has now delivered everything blindness can buy: four convergences on instruments that share nothing. **The remaining value is in the join, and the join requires contact.**

**Order of operations, and it is not optional:**

1. **Developer 2 publishes its per-function verdict list first** — frozen, timestamped, hash published — **before seeing anything of Developer 1's.**
2. Only then is `DRIFT_PER_FUNCTION_BUCKETS.tsv` handed over.
3. The join is performed and the **set difference reported in both directions**, per function name.

Reversing steps 1 and 2 destroys retrospectively everything the blind phase produced. Publish, hash, then compare.

---

## 8. Completion

| Gate | Before | Now |
|---|---|---|
| G5 — 71-function re-measurement | 0.75 | **0.9** — CORS, secureHeaders membership, guard census and endpoint identity all independently converged; only the per-function drift join remains |
| G1 | 0.25 | 0.25 |
| **Credited** | 2.25 / 9 ≈ 25% | **2.4 / 9 ≈ 27%** |

**The threatened B13 re-take is cancelled.** The gate count does not grow.

Classification: OWNER-ATTESTED estimate, basis in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md`.

**Still standing, unchanged, and still the reason not to merge:** after the merge a `workflow_dispatch` on `main` with `target=production` reaches `SUPABASE_DB_URL` through an injectable job, with required reviewers off, wait timer off, and administrator bypass on.

**Recommendation to the owner: authorise A-3.** It is now materially safer than when I first framed it — the patches are shown to apply, the delta is 43 lines across three files already inside the reviewed scope, and the branch is not the merge. The authorisation still buys no merge, no tag and no deploy.
