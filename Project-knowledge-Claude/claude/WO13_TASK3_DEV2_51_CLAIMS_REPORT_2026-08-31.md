# WO-13 Task 3 — the `src/` half of the 138-file claims document

Session 2. **51 rows.** Developer 1's schema adopted exactly; no column invented, no column dropped,
no value re-derived. Read-only: no branch, commit, push, merge, tag, deploy or migration.

**Deliverable:** `A15_CLAIMS_DEV2_51.tsv` — sha256 `d09e1a4bde8bb18b7024a3892c4a2fd830a2ac38f132d41f3fcbb2735e89f526`,
52 lines (1 header + 51 rows), 10 tab-separated fields on every line, 51 distinct paths, 0 duplicates,
single `0a` terminator with no trailing blank line.

---

## 1. Schema adoption — proved, not asserted

I did not re-implement the generator. I reproduced it and let the hash decide whether my copy is the
reference:

```
my copy   sha256 : 9071e97e29dfd144cbf11a7f4b7b8205bf77d78597a4a766dd5a88de7de014f9
published sha256 : 9071e97e29dfd144cbf11a7f4b7b8205bf77d78597a4a766dd5a88de7de014f9   MATCH
```

**Byte-unchanged, including the hard-coded `G=["git","-C","/home/claude/repo/src"]`.** Rather than
edit that line I symlinked `/home/claude/repo/src → /home/claude/measure/repo`, so the script that
ran is provably the published one. `git diff --name-only BASE RC` in my independently built clone
returns **138** files, reproducing the range size.

### The join test — the three specimen rows

All three published specimens reproduce **byte-for-byte** from my clone, including
`blob_sha_at_RC`, which §7 names as the tie-breaker:

```
MATCH  src/__tests__/laneIsolation.test.ts
MATCH  src/components/comments/CommentThread.tsx
MATCH  src/lib/generateCertificatePdf.ts
```

### Category counts against §6

| category | §6 expects | I measure |
|---|---|---|
| test | 21 | **21** |
| web component | 19 | **19** |
| web library | 9 | **9** |
| web page | 2 | **2** |
| **total** | **51** | **51** |

Status split of my half: 37 `M`, 14 `A`, 0 `D`. Risk: 51 × `LOW` — the generator's stated basis,
unaltered. **I raised no row above `LOW`,** so there is no basis of Developer 1's that I am
overriding. The remaining 87 rows classify as Developer 1's half plus the 12 unassigned, consistent
with §6.

### Test-before-component precedence — measured, and it bites

§3 warns the halves will disagree on 19 files if the order is wrong. In my half the rule moves
**10 rows** into `test` that would otherwise be `web component`:

```
src/components/__tests__/BrandBadgeEverywhere.test.tsx      src/components/ads/__tests__/StoryCardComments.test.tsx
src/components/__tests__/ComposerEnterKey.test.tsx          src/components/ads/__tests__/StoryCardReactions.test.tsx
src/components/__tests__/PrivacyGapDisclosed.test.ts        src/components/comments/__tests__/CommentLineBreaks.test.tsx
src/components/__tests__/SendButtonTapTarget.test.ts        src/components/post/__tests__/PostFullBleedAndTapTargets.test.ts
src/components/__tests__/SummaryTriggerTapTarget.test.ts    src/components/post/__tests__/feedScreenFindings.test.ts
```

Ten, not nineteen, is what the rule moves **inside my 51**; the balance of the nineteen must lie in
paths outside my four categories. Naming which ten is what makes the join checkable rather than
merely congruent.

---

## 2. ⚠ Column 9 is NOT measured in my half — a silent failure I am flagging rather than shipping

`touched_by_replacement_RC` is derived from `git diff --name-only RC NEW`, where
`NEW = 9384ba9aeef585f615148b208f13d68fdbe169f5`.

**That object does not exist in my clone, and no ref on origin points at it** — as-of
2026-08-31T07:54:42Z. Probed directly:

```
$ git cat-file -t 9384ba9aeef585f615148b208f13d68fdbe169f5
fatal: git cat-file: could not get object info
$ git ls-remote <origin> | grep -c 9384ba9a…
0
$ git diff --name-only a42b209e 9384ba9a
fatal: bad object 9384ba9aeef585f615148b208f13d68fdbe169f5      ← stderr
[stdout lines: 0]
```

The generator captures **stdout only**. The fatal goes to stderr, `patched` becomes the empty set,
and every row is written `no` — with no measurement having occurred, and no error surfaced. On my
half the defaulted value happens to coincide with the expected answer (§6 says all three `YES` rows
are in Developer 1's half), which is exactly what makes it dangerous: **it looks right.**

**Disposition: all 51 rows carry `no` in column 9, and that value is RELAYED, not VERIFIED.** Its
only basis is Developer 1's statement in §6. If the auditor needs column 9 measured for my half, the
replacement RC must be pushed or the object otherwise made reachable, and I will re-run.

**Defect for Developer 1's instrument, offered not asserted:** `run()` discards stderr and the script
never checks that `NEW` resolves. Anyone running it without the replacement RC gets a full 138-row
document with column 9 uniformly `no` and no indication. Two lines — resolve `NEW` with
`git cat-file -e` and abort, or record `UNKNOWN` — would close it. Rule 8's sibling: *a column never
shown to distinguish is not a measurement.*

---

## 3. The 12 unassigned — my independent classification

I measured these rather than copying the list; they agree with §6 exactly, path for path.

| category | files |
|---|---|
| `build/CI script` (10) | `generate-headers.mjs` +125 · `generate-redirects.mjs` +43/−10 · `generate-seo-assets.mjs` +111 · `health-check.mjs` +5/−10 · `lane-config.mjs` +73 · `test-isolation-guard.mjs` +280/−3 · `test-schema-dependencies.mjs` +403 · `test-seo-assets.mjs` +274 · `verify-bundle-isolation.mjs` +193/−14 · `verify-schema-dependencies.mjs` +906 |
| `documentation` (2) | `docs/DECISIONS.md` +49/−6 · `docs/PROMOTION_LEDGER.md` +1,173 |

**Ready to take half on your naming.** One observation that bears on how you split them, offered as
a fact rather than a preference: `scripts/lane-config.mjs` is the file I planted defect **D1** into
during Task 1, and `src/__tests__/laneIsolation.test.ts` — already row 1 of my half — is the test
that caught it. Whoever reviews that script, the test pinning it is in my 51 and the demonstration
that the pin fires is in the Task 1 transcript bundle.

---

## 4. Row

| Requirement | Instrument | Evidence | Result | Status |
|---|---|---|---|---|
| Adopt Developer 1's schema exactly | reproduce `build_claims.py`; hash decides | sha256 `9071e97e…14f9` matches published | reference implementation run byte-unchanged | **VERIFIED** |
| The two halves join | three specimen rows + `blob_sha_at_RC` tie-breaker | §1 | **3 of 3 byte-identical** | **VERIFIED** as-of 2026-08-31T07:55:47Z |
| 51 `src/` rows | generator output filtered to the four Developer 2 categories | `A15_CLAIMS_DEV2_51.tsv` | **51 rows, 51 distinct paths**, per-category counts match §6 | **VERIFIED** |
| Test-before-component precedence | differential re-classification | §1 | rule moves **10** rows into `test`, named | **VERIFIED** |
| Every row checkable against source, marked as claim | schema `check` column, verbatim per category | the TSV | no row asserts a conclusion; no row says "this file is fine" | **VERIFIED** |
| `touched_by_replacement_RC` for my 51 | `git diff RC NEW` | `NEW` unreachable; stderr swallowed | 51 × `no`, **defaulted not measured** | **RELAYED** — basis is §6, not my measurement |
| `risk` overrides | — | none made | 51 × `LOW`, generator's basis unaltered | **N/A** |

**Stamped negatives.** No row in my half is `D` — as-of 2026-08-31T07:55:47Z. No duplicate path, no
row with other than 10 fields, no trailing blank line — as-of 07:56:09Z. No `risk` value above `LOW`
in my half — as-of 07:55:47Z. `NEW` `9384ba9a` not present in my clone and on no origin ref — as-of
07:54:42Z. No branch, commit, push, tag, deploy or migration performed — as-of 07:56Z.
