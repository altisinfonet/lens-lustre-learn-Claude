# The join result, rules 10 and 11 accepted, my C-26, and A-3 returned INCOMPLETE

Date: 2026-08-30
Role: auditor. Prediction registered in `claude/PRE_REGISTERED_JOIN_PREDICTION_AND_PASS2_RULING_2026-08-30.md` **before** this result existed.

---

## 1. The join — my predictions, scored honestly

| Prediction, registered before the run | Result |
|---|---|
| **2.** The two header-only sets are the same 22 — symmetric difference EMPTY | **HELD. Empty in both directions.** |
| **1.** The two MATCH sets are the same 21 — symmetric difference EMPTY | **HELD under `a42b209e_imap_excluded`. FAILED under `a42b209e_strict` by exactly two functions.** |
| **3.** UNKNOWN reported separately, never folded | **HELD** — no row in Developer 1's file carries UNKNOWN |

**Pass 2 is the headline, and it is the strongest single result of this engagement.** Two instruments sharing no code agree, **by membership and not by count**, on exactly which functions differ from the RC only in `_shared/secureHeaders.ts` — including `send-gift-credit`, the one function whose verdict moves between lanes on Developer 1's classifier and which Developer 2's per-file data independently places in the same set.

Slug universes identical by membership. Neither side holds a slug the other lacks.

**Developer 2's predicted five-function gap did not arise, and the reason is now measured on both instruments**: the four `s3-*` bundles and `create-payment-session` fall outside header-only on **both** instruments for the **same reason** — they differ in `_shared/s3.ts` or `_shared/laneConfig.ts` as well. That is agreement on the mechanism, not only on the set.

---

## 2. The two-function Pass-1 difference — NOT a measurement disagreement, and the open question is precisely stated

`handle-email-suppression` and `handle-email-unsubscribe`: MATCH for Developer 2, not MATCH for Developer 1 under the strict reading. Empty under import-map-excluded.

**These are exactly the two functions Developer 1 had already published as the two that separate their strict and import-map-excluded readings** — before the join, in `F34_F35_DRIFT_RECONCILIATION`. The difference landed precisely where the earlier measurement said it would. That is what a reading difference looks like; a measurement disagreement would have landed somewhere unpredicted.

### Developer 2's byte evidence — and I verified the part I could verify myself

```
handle-email-suppression   deno.json  2 B  44136fa3…   index.ts  5085 B  02dd49fa…
handle-email-unsubscribe   deno.json  2 B  44136fa3…   index.ts  4035 B  2ef684a9…
deno.json content, both sides, both endpoints: b'{}'   identical: True
```

**Independent check, run in this container rather than relayed:** `printf '{}' | sha256sum` → `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`, length 2. **The digest, the byte count and the stated content are mutually consistent and correct.** Developer 2's `44136fa3…` is the sha256 of a 2-byte `{}` — measured here, not accepted.

### The question, and Developer 2 was right to refuse to guess it

Under Developer 1's **strict** reading, **which file in those two bundles differs, and what are its bytes on each side?**

- If the answer is **the import-map file** → the two instruments are in direct byte conflict and this becomes a Pass-1 defect outranking everything else.
- If the answer is **the `import_map: true` declaration reported by the Functions API** — metadata, not a file — → it is a vocabulary boundary and belongs in Pass 2.

**These are the two functions the Functions API reports as `import_map: true`.** That is a striking coincidence and it points at the second answer. **I am not recording that as the answer.** Naming the likely mechanism and then treating it as measured is the error this engagement has recorded eleven times. **Developer 1 answers it with bytes, or it stays open.**

---

## 3. Rule 11 — ACCEPTED. And it convicts me, not only Developer 1.

**Proposed:** *when a premise is withdrawn, every conclusion drawn from it is withdrawn with it until independently re-measured. Retention is a new claim and needs new evidence.*

**Adopted as standing rule 11.**

Developer 1 measured what they had asserted without measuring:

```
git merge-base --is-ancestor 702e5ce a42b209e                   -> TRUE
comm -23 <(main..702e5ce paths) <(main..a42b209e paths) | wc -l -> 0
```

`702e5ce` **is** an ancestor of the RC via staging's first-parent line, and all 98 paths are a **strict subset** of the 138. **The sentence they forbade — "the baseline covered 98 of the 138 files" — is true.**

### C-26 — mine. I ratified the retention without testing it.

In C-23 I wrote that the ancestry measurement should be *"retained, because it is still the reason `main..702e5ce = 98 files` must never be described as 'the first 98 of the eventual 138'."* And in the join-mapping ruling I called it *"the right disposition."*

**I withdrew a premise and then approved the survival of a conclusion drawn from it, without asking for the one command that would settle it.** Developer 1 wrote the prohibition; **I blessed it**, and an auditor blessing an untested claim is worse than a developer writing one, because it converts an assertion into a ruling.

**Both withdrawn.** What actually survives is one narrow fact, and it is Developer 1's wording: **`702e5ce` is not a descendant of `main`, so the line counts do not compose. The path set composes perfectly.**

This is the **third instance today** of the same shape — "share four members", the additive line-delta projection, and now this — and by my own count the twelfth across all parties. Rule 11 is the first rule we have written that attacks the *mechanism* rather than the symptom.

---

## 4. Rule 10 — ACCEPTED

*The pack is the single source of truth; a correction sweep republishes every affected project doc in the same action that edits the pack.*

**Adopted as standing rule 10.** F-39 was fixed by sweep rather than by patch — A16, the A9/A10 report, A11b, Lanes, A17 all republished from their pack files, and the duplicate `SESSION1_…` copy deleted with the right reason: *"two copies is the same defect as F-39, and a later correction could reach one and not the other."* One canonical copy. Correct.

**And Developer 2's handling of the path mismatch was exactly right:** the ordered path did not exist, they did not search, and they **let the hash settle identity rather than the name** — 3,623 B, 72 lines, `951a2cfd…59da` exact. A name can be wrong; a digest cannot. Their note that an exact hash match also proves their transcription byte-exact is correct and worth keeping.

---

## 5. A-3 — RETURNED INCOMPLETE. The one thing that mattered is missing.

The branch exists: `rc-replacement/option2-2026-08-30` at `9384ba9aeef585f615148b208f13d68fdbe169f5`, working tree clean, `main` `b671e1fb…` and `staging` `9ac4524d…` unmoved. Not pushed. Good.

The validations delivered — YAML parses, `bash -n` 8/8 and 4/4, `esbuild` exit 0 — are **syntax checks**. They establish the files are well-formed. **They do not establish the defect is gone. A YAML file containing a shell injection parses perfectly.**

**The acceptance conditions set in `claude/A-3_AUTHORISATION_RECORDED_AND_EXECUTION_ORDER_2026-08-30.md` §3 are mostly unmet:**

| Condition | Status |
|---|---|
| 3a — sha256 of each of the three patch files actually applied | **NOT REPORTED** |
| 3b — `on:` enumeration of every workflow, which fire on a branch push | **NOT REPORTED** |
| 3c — `git diff --name-status a42b209e <head>`, exactly three paths | **NOT REPORTED** |
| 3c — line delta, expected `+36 / −7` | **NOT REPORTED** |
| 3c — files vs `main` = 138, **verified per item, not by count** | **NOT REPORTED** |
| 3c — commits vs `main`, measured and reclassified from INFERRED | **NOT REPORTED** |
| 3c — base sha reported | **NOT REPORTED** — only the head sha |
| 3c — `main` and `staging` unmoved | **DONE** |
| **3d — the construct shown removed, quoted at `a42b209e` and on the branch, per file** | **NOT REPORTED — and this is the whole point of the branch** |
| 3e — the three-file 43-line delta as a standalone hashed artefact | **NOT REPORTED** |

**G1 does not move.** *A fix never shown to remove the defect is not a fix* — rule 1's family, stated in the order and not yet satisfied.

### Push — do not seek authority yet

`DISABLED_NO_PUSH_AUTHORITY` is currently protective, not obstructive: **§3b's trigger enumeration has not been done, and that enumeration is the precondition for pushing.** Nothing is lost by waiting — the branch is fully reproducible from `a42b209e` plus three hashed patches, so a container loss costs one rebuild.

**Complete 3a–3e first. Then the push question.**

---

## 6. Completion

| Gate | Before | Now |
|---|---|---|
| G5 — 71-function re-measurement | 0.9 | **0.95** — join run, Pass 2 identical by membership, Pass 1 identical under the import-map-excluded reading; the two-function strict question remains open |
| G1 — RC free of known-armed defects | 0.5 | **0.5** — branch exists, defect removal not demonstrated |
| **Credited** | 2.65 / 9 ≈ 29% | **2.7 / 9 ≈ 30%** |

Classification: OWNER-ATTESTED estimate, basis in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md` as corrected by C-25.

**Unchanged:** after a merge, a `workflow_dispatch` on `main` with `target=production` reaches `SUPABASE_DB_URL` through an injectable job — reviewers off, timer off, admin bypass on. **And the 138-file review has still not begun on any side. It remains the longest item and nothing above shortens it.**
