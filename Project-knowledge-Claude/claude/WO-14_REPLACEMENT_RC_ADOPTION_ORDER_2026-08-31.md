# WO-14 — REPLACEMENT RC ADOPTION ORDER (Developer 1)

Issued 2026-08-31 by the compiler/audit session, on the **owner's recorded ruling of 2026-08-31: ADOPT the replacement candidate.**

**This order authorises exactly one state change: pushing the three patched files onto `staging`. Nothing else.**

---

## 0. The ruling being executed

The owner has ruled, in writing, on two questions put to him:

1. **Replacement RC — ADOPT.** The Option 2 patch set becomes part of the candidate.
2. **§25 acceptances — the compiler drafts, the owner edits and signs.** Draft issued separately as `S25_ACCEPTANCES_DRAFT_FOR_OWNER_2026-08-31.md`.

This order carries out (1). It does not touch (2).

---

## 1. What is being adopted, precisely

| | |
|---|---|
| Branch | `rc-replacement/option2-2026-08-30` |
| Head | `9384ba9aeef585f615148b208f13d68fdbe169f5` |
| Current location | **Developer 1's local clone only. Unpushed. Not reachable from any other party's clone, including mine.** |
| Push authority | **`DISABLED_NO_PUSH_AUTHORITY`** — the session that built it cannot push it |
| Files changed vs `a42b209e` | **3** |
| Line delta | **+36 / −7** (C-25: measured, not asserted) |
| Paths added | **0** |
| Paths deleted | **0** |

The three paths:

| # | Path | What the patch does |
|---|---|---|
| 1 | `.github/workflows/apply-migration.yml` | Removes the `'${{ inputs.migration }}'` / `'${{ inputs.confirm }}'` shell interpolation at lines 174–175 and the two re-interpolations at 207 and 231 |
| 2 | `.github/workflows/verify-schema-dependencies.yml` | Removes the same construct on `inputs.source_dir` |
| 3 | `functions/_seo.ts` | JSON-LD sink at line 118 — unicode-escapes `<` (and conventionally `>`, `&`) inside the serialised JSON |

**All three paths are already inside the 138.** That is the fact that keeps the review valid: the adoption adds no file that was never reviewed and removes none that was.

---

## 2. What the owner gets, and what he does not

**Closes:**

- The live injection path in `apply-migration.yml` — the one that became reachable the moment `SUPABASE_DB_URL` was created on the `staging` environment at ~07:35Z today.
- The same construct in `verify-schema-dependencies.yml`, a file that **does not exist on `main`** — the merge would otherwise create it.
- The `_seo.ts` JSON-LD escape defect.
- **§25.3 Row 5's exposure.** The acceptance drafted for Row 5 must be re-written once this lands; accepting a risk that has since been fixed would put a false statement in the ledger.

**Does NOT close:**

- **F-47** (`web-build.yml`, `lane-guard` job, same construct on `github.base_ref` / `github.ref_name`). It is **LATENT** — not reachable under the configured triggers — and it is **deliberately not in this patch set.** Widening the patch set now would re-open the review scope. It goes on the post-promotion list, as ruled.
- Anything in §25.3 rows 1, 2, 3, 4, 6a, 6b, 6c. Those still need the eight written acceptances.

---

## 3. The prohibition that matters most — READ THIS BEFORE TOUCHING GIT

**DO NOT OPEN A PULL REQUEST. Not from the replacement branch, not from anywhere.**

Four workflows in this repository carry:

```yaml
on:
  pull_request:
    branches: [main, staging]
```

Opening a new PR fires them on a head that is not the candidate, and puts a second open PR against `main` alongside PR #104. Both consequences are unrecoverable in the record without a correction entry.

**The patches reach the candidate by being pushed onto `staging` itself.** `staging` is the candidate branch. Its head becomes the new RC.

**A consequence worth stating in advance rather than discovering:** pushing to `staging` **updates PR #104** (which is already open, `staging` → `main`) and **fires those same four workflows on the new head automatically.**

That is not a problem. It is useful: **that automatic run is §24.1 step 6a's CI re-read at the freeze head, performed at the moment the head is created.** Do not dispatch a separate run for step 6a. Read that one.

---

## 4. Execution — the exact sequence, in order

**Developer 1 does steps 1–4. Nobody else.**

### Step 1 — Establish push authority

The building session records `DISABLED_NO_PUSH_AUTHORITY`. Resolve this **before** anything else, and record how it was resolved.

State in the return, plainly: *who* pushed, *from which clone*, and *with what credential class* (personal token / SSH key / the owner acting himself). This is a provenance fact and standing rule 15 applies — a hash of one's own output proves integrity, not provenance.

### Step 2 — Verify the branch head before pushing anything

```
git rev-parse rc-replacement/option2-2026-08-30
git diff --name-only a42b209e 9384ba9a
git diff --shortstat a42b209e 9384ba9a
git diff --name-status a42b209e 9384ba9a | cut -f1 | sort | uniq -c
```

**Expected, and this is a pre-registered prediction — record the actual output whether it matches or not:**

- head = `9384ba9aeef585f615148b208f13d68fdbe169f5`
- 3 paths, exactly the three named in §1
- `+36 / −7`
- `3 M`, `0 A`, `0 D`

**If any of the four disagrees, STOP and report. Do not push.** A disagreement means the branch is not the object that was measured.

### Step 3 — Push onto `staging`

**Fast-forward only. No force. No rebase of `staging`. No history rewrite.**

```
git fetch origin
git log --oneline origin/staging..rc-replacement/option2-2026-08-30
git push origin rc-replacement/option2-2026-08-30:staging
```

If the push is rejected as non-fast-forward, **STOP and report.** Do not add `--force`. A rejection means `origin/staging` moved and the measured delta no longer describes reality.

### Step 4 — Capture the new head immediately

```
git fetch origin
git rev-parse origin/staging
git log --oneline -3 origin/staging
```

**Record the new head SHA in full, 40 characters.** Standing rule 3: an abbreviated hash is not a hash.

---

## 5. What must be re-measured on the new head, and what must not be re-measured

This is the part where scope falls off. Standing rule 4 is the parent rule: **compression is where scope falls off.**

### Must be re-measured at the new head — non-negotiable

| # | Claim | Why it cannot be inherited |
|---|---|---|
| R1 | **The construct-removal proof.** No `${{ inputs.* }}` interpolation remains inside any `run:` block of the three patched files | It was verified at `9384ba9a` **in a local branch**. Standing rule 15: it must be re-verified **wherever it lands**. A verification of a local object is not a verification of the pushed object |
| R2 | **Scope vs `main`.** `git diff --name-status b671e1fb <new head>` | §3.2(a)'s 138 / 31 A / 107 M was measured at `a42b209e`. The count is expected to stay **138** because the patch adds and deletes no paths — but that is a prediction, and it must be measured, not assumed |
| R3 | **Line totals.** `git diff --shortstat b671e1fb <new head>` | Expected `+9096 / −1300` (9060+36, 1293+7). **Standing rule 14: a diff is not a vector.** Line counts compose only when every patched file exists at both endpoints. `verify-schema-dependencies.yml` **does not exist on `main`** — so this arithmetic is a *prediction to test*, not a derivation to trust. Record the measured figures and, if they differ, the arithmetic is wrong and the measurement is right |
| R4 | **The four `pull_request` workflow runs** fired by the push, read at the new head | This is §24.1 step 6a. Read conclusions, not just green ticks |
| R5 | **`_seo.ts` line 118 read character-for-character** at the new head | Standing rule 12. The last transcription of this exact fix ate the escape (`.replace(/</g, "<")` written where `<` belongs). Read it from the file, do not retype it from a report |

### Must NOT be re-measured — and stating this is what keeps the schedule honest

The 138-file review, the 71-bundle comparison, the CORS census, the storage-lane decomposition, the database policy states, the R2 and Zero Trust captures — **none of these is invalidated.** C-25 is the measurement that settles it: the delta is 3 files and 43 lines, all inside the already-reviewed set, adding and deleting no paths.

**C-25 is itself a correction of mine.** I previously claimed a replacement RC resets the 138-file review. It does not. That claim is withdrawn and the measurement stands in its place.

---

## 6. The RC identity changes, and §3.1 requires it be re-stated

`RC-20260829-05` was pinned to `a42b209e4f70a6efed4f3dcdb654e0f994416594`. **After the push, that pin is stale.**

§3.1's layered identity must be re-stated for the new head — the label, the 40-character commit, the branch, and the as-of time. **Every document that names `a42b209e` as "the candidate" is now describing a superseded object** and must either be corrected or carry an explicit as-of stamp saying it describes the pre-adoption candidate.

**Standing rule 10:** the pack is the single source of truth; a correction sweep republishes every affected copy in the same action. Do not leave half the pack pointing at `a42b209e`.

**Standing rule 11 does not fire here.** No premise is being withdrawn — a new object is being created. The measurements at `a42b209e` remain true statements about `a42b209e`.

---

## 7. Standing prohibitions — unchanged, and this order does not relax them

**Authorised by this order:** one fast-forward push of three patched files onto `staging`, and reading the CI runs it fires.

**NOT authorised, by this order or any other:**

- Merging PR #104
- Creating a tag
- Deploying any edge function (§23.5.1 condition 2 excludes all function deployment from this release)
- Applying any migration, to either lane
- Running the §5.3 runbook probe
- Any production write
- Opening a pull request
- Force-pushing, rebasing, or rewriting `staging`'s history
- Touching `web-build.yml` / F-47
- Modifying the frozen ledger

---

## 8. Return format — what Developer 1 sends back

One document. Every row carries `Requirement → Instrument → Evidence → Result → Status`, classified **VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED**. Never silently convert one class into another.

Required contents:

1. Step 1's provenance statement — who pushed, from where, with what credential class.
2. Step 2's four pre-registered outputs, **actual**, matched or not.
3. The new `origin/staging` head, 40 characters.
4. R1–R5 above, each measured, each with the command that produced it.
5. The four CI run IDs and their conclusions.
6. Anything that disagreed with a prediction, stated first and not buried.

**If a step was skipped, say it was skipped.** A skipped step recorded as skipped costs nothing. A skipped step recorded as done is the failure this whole engagement exists to prevent.

---

## 9. Standing of this order

**This order closes nothing.** §25.4: *"No row below may be marked closed by the compiler. The compiler is not a second party."* Executing WO-14 changes the candidate; it does not close §25, and it does not authorise the merge.

After WO-14 the remaining §24.1 work is: **step 6** (§5.3 probe, immediately pre-promotion), **step 6a** (satisfied by the push's own CI run, read at the new head), and **step 7** (§11 signed and tagged — which cannot be signed while §25 is open, by §11's own header).

**§25 closes on the owner's eight signatures. Nothing in this order advances that.**
