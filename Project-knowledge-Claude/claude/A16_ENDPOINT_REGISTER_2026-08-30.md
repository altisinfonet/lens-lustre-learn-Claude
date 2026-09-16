# A16 — THE ENDPOINT REGISTER

Date: 2026-08-30 · Read-only detached clone `/home/claude/repo/src`, push URL
`DISABLED_NO_PUSH_AUTHORITY`. No branch, commit, push, merge, tag, deploy, migration, §5.3 probe,
provider write, ledger edit or secret read. **Nothing here closes a §25 row (§25.4).**

Raw transcript: `A16_ENDPOINT_REGISTER_TRANSCRIPT.txt`. Every figure below is re-derivable from it.

---

## 0. THE ANSWER, FIRST

**The release candidate is one hash: `a42b209e4f70a6efed4f3dcdb654e0f994416594`.**

```
$ git cat-file -t a42b209e
commit
$ git rev-parse a42b209e
a42b209e4f70a6efed4f3dcdb654e0f994416594
```

**Why it and not another.** The RC is defined as *the last non-`docs/` commit on `origin/staging`*.
Measured: `a42b209e` changes exactly one file, `.gitleaks.toml`. **All ten commits after it on
`origin/staging` are docs-only** (`docs/PROMOTION_LEDGER.md` alone, REV-7 through REV-16). The RC
definition selects `a42b209e` uniquely.

**And the good news, which is the point of this register:** for every measurement in this engagement
that is scoped to **edge functions** — the drift census, the CORS census, the WS-HASH-v1
re-measurement, C-14-L — **five of these six hashes are the same endpoint.**

```
tree hash of supabase/functions/
  b671e1fb (main)   a5528524a5214c9afce1a9654eaff8594bda8aa2   <- differs, 44 files
  702e5ce           cdffd7292d29de9e32dfbecf68ee5617cd4bca84   <- differs, 1 file
  25c0456           c7876a89b31a4f92b822e127f7f651e13c71667c   ┐
  a42b209e          c7876a89b31a4f92b822e127f7f651e13c71667c   │ IDENTICAL
  fe63e944          c7876a89b31a4f92b822e127f7f651e13c71667c   │ TREE
  393bc55           c7876a89b31a4f92b822e127f7f651e13c71667c   │
  9ac4524d          c7876a89b31a4f92b822e127f7f651e13c71667c   ┘
```

**Developer 2 measured against `25c0456`; I measured against `a42b209e`. Under
`supabase/functions/` those are byte-identical trees — `0` files differ.** Their agreement with my
CORS census was therefore not luck and is not weakened by the endpoint mismatch. It is now a
measurement.

---

## 1. The register

`main` = `b671e1fb0c5bcf145d442076c229eca888afd674` throughout. All six are **commit** objects.

| # | Hash (full) | What it is | Date | On | Range from `main`: files / commits (incl·excl merges) / lines | `supabase/functions` tree | Used by which document, for what |
|---|---|---|---|---|---|---|---|
| **1** | **`a42b209e4f70a6efed4f3dcdb654e0f994416594`** | **THE RELEASE CANDIDATE.** Last non-`docs/` commit on `origin/staging`. Subject: *fix(security): allowlist the STAGING anon key too — AF-19*. Changes one file: `.gitleaks.toml` | 2026-08-29 13:45 +0530 | `origin/staging` only | **138 / 39·37 / +9,060 −1,293** | `c7876a89` | The frozen endpoint. §3 identity, §3.2/§5.0 scope, §25 evidence rows, PR #104, the 138-file merge scope, `02a_manifest_main..a42b209e.tsv`, WO-3 drift lane (b), Track R "in merge scope", A9 re-run. **16 pack documents** |
| **2** | `fe63e94483ac9c25c335ad9721258228ebe04571` | **A ledger revision, not a code point.** REV-12 — *B13 RULED (§23.5)*. `docs/PROMOTION_LEDGER.md` only | 2026-08-29 15:57 +0530 | `origin/staging` | **138 / 45·43 / +9,494 −1,293** | `c7876a89` | **C-17 / W3-1.** The `45 / 43` commit pair in `facts_rev16.json` and §3.2(b) is correct **for this endpoint** and was mis-attributed to `main…a42b209e` (which is 39/37). REV-17 correction set. **6 documents** |
| **3** | `9ac4524d703035e6d2debd9e97ab9a0e73de3bc9` | **`origin/staging` TIP.** REV-16 — *C-11 consistency fixes, DOCUMENTATION FREEZE*. Ledger only. The frozen ledger `f00f612a…5943` is this file | 2026-08-29 17:29 +0530 | `origin/staging` tip | **138 / 49·47 / +10,159 −1,293** | `c7876a89` | The §28 freeze anchor; the checkout this session's repo clone is detached at; C-12's *live* `main…staging` figures. **4 documents** |
| **4** | `702e5ceb6d40b6f487cedf2378aae835bd18621f` | **The 2026-08-26 drift baseline**, on `origin/staging` — *Add files via upload*, `src/lib/generateCertificatePdf.ts`. Not an ancestor or descendant of `main` (see 2.2; the `staging @ 702e5ce` label is accurate — C-23) | 2026-08-26 11:04 +0530 | `origin/staging`, `altisinfonet-patch-35`, a `claude/…` branch | **98 / 24·24 / +6,029 −561** ⚠ **not a fast-forward range** — see 2.2 | `cdffd729` | WO-3 drift lane (a): reproduction of the 21/21/29 baseline. ~~B13 15b~~ **runbook step 15b (§12)**'s original endpoint. **9 documents** |
| **5** | `b671e1fb0c5bcf145d442076c229eca888afd674` | **`origin/main` TIP, and the merge-base of `main` and `staging`.** *PRODUCTION — certificates… (#101)* | 2026-08-25 18:17 +0530 | `main`, `origin/main`, `origin/staging` | — (it **is** the base) | `a5528524` | The left-hand side of **every** `main…X` range in the engagement. C-12, REV-17, post-promotion plan. **7 documents** |
| **6** | `25c0456011451f644def7ef5361904e4de25dd08` | **Developer 2's endpoint.** *Drop the composer hint text; shorten the privacy notice copy*. Ancestor of the RC by **9 commits** | 2026-08-29 04:02 **UTC** | `origin/staging`, `altisinfonet-patch-35` | **135 / 32·31 / +10,795 −1,578** | `c7876a89` **= RC** | Previously: one line of §3.3's historical CI table. **Now: the endpoint Developer 2 measured the CORS census against.** **1 pack document** |
| **7** | `393bc5589636a0386d2c059c1fede2f31c01a736` | **A seventh, not in your list, and it is in the ledger.** REV-13 — *C-8 identity/scope correction*. Ledger only | 2026-08-29 16:24 +0530 | `origin/staging` | **138 / 46·44 / +9,680 −1,293** | `c7876a89` | C-12's *"as at REV-13"* figures — `46 / 44` commits, `+9,680 / −1,293` lines. **Recorded here because a register that omits an endpoint already in the ledger is the same defect it exists to fix** |

Plus one **moving** reference that is not a hash and must never be used as an endpoint:
`origin/staging`. It has advanced four times during this engagement (REV-13 → REV-16). Any figure
labelled `main…staging` without a hash is undated and unreproducible.

---

## 2. What the register makes visible — and yes, this is C-17 recurring

### 2.1 Four different commit-count pairs, all true, all for different endpoints

| Endpoint | commits incl·excl merges | lines |
|---|---|---|
| `main…a42b209e` — **the RC** | **39 · 37** | +9,060 / −1,293 |
| `main…fe63e944` — REV-12 | 45 · 43 | +9,494 / −1,293 |
| `main…393bc55` — REV-13 | 46 · 44 | +9,680 / −1,293 |
| `main…9ac4524d` — staging tip | 49 · 47 | +10,159 / −1,293 |

**Every one of these is a correct measurement. Only the first describes what merges.** C-17 was one
instance of picking the wrong row from this table. The table is the fix: from here, a figure without
its endpoint is not a figure.

**The file count is the trap.** `138` is the same for **four** of these endpoints, because the ten
commits after the RC are all `docs/PROMOTION_LEDGER.md`, a file already in the 138. **A matching
file count is not evidence that two endpoints agree.** The commit and line counts move; the file
count does not.

### 2.2 `702e5ce` — the ancestry, and the label

> ⚠ **CORRECTED 2026-08-30 (C-23).** This section originally argued that the label
> **`staging @ 702e5ce` misdescribes the endpoint.** **That framing is WITHDRAWN and the §23.5.3
> classification stands.** `702e5ce` **is** a commit on `origin/staging`; the label names the branch,
> not the ancestry, and it is accurate. The ancestry measurement below is unchanged and is retained
> for the reason it was actually made: the **file-count trap**.

`b671e1fb` is **not** an ancestor of `702e5ce`, and `702e5ce` is **not** an ancestor of `b671e1fb`.
They are **parallel**; their merge-base is `32930e75` (2026-08-22), and they were joined later by
`9faf5a17 Merge branch 'main' into staging`.

~~So `main..702e5ce` = 98 files is a symmetric difference against a divergent tip, not "the first 98
of the eventual 138"… Any statement of the form "the baseline covered 98 of the 138 files" is false
and must not be written.~~ **WITHDRAWN — see the C-23 EXTENDED block below. The 98 paths ARE a
subset of the 138, measured; the forbidden sentence is true.** Two commits on `main` are absent from
`702e5ce`, which is why the *line* counts do not compose — that, and only that, survives.

`702e5ce` is *the tree the 2026-08-26 deployment baseline was taken against*, on `origin/staging`,
and **`staging @ 702e5ce` is the correct way to name it.** It is not a candidate, and it is not
comparable to the RC by simple arithmetic.

### 2.3 Why Developer 2's endpoint did not corrupt their answer — measured, not assumed

`25c0456..a42b209e` is 9 commits touching `.gitleaks.toml`, `docs/PROMOTION_LEDGER.md`, and four
`src/components/…` files. **Zero files under `supabase/functions/`.** The tree hash is identical.

**Therefore, for any function-scoped question, `25c0456` and `a42b209e` are the same endpoint** —
and their CORS agreement (39 wildcard / 27 gated / 5 neither) is corroboration, not coincidence.
**This does not generalise.** For any question touching `src/`, the two endpoints differ by six
files and Developer 2's result would not transfer.

### 2.4 The rule this register exists to enforce

> **Every figure names its endpoint, and every endpoint is a full 40-character commit hash.**
> Not `staging`, not `the RC`, not an abbreviation. This is §3.5 rule 5 (*every figure carries its
> basis*) applied to commits, and it is the fourth engagement rule — *an abbreviated hash is not a
> hash* — extended from hashes to the ranges built out of them.

---

## 3. `submit-judge-decision` — does its CORS mechanism differ between `main` and the RC?

**YES. That single diff is the whole of C-4.**

```
$ git diff --stat b671e1fb a42b209e -- supabase/functions/submit-judge-decision/
 supabase/functions/submit-judge-decision/index.ts | 53 +++++++++++++++++------
 1 file changed, 40 insertions(+), 13 deletions(-)
```

**One file. One function. Both mechanisms, measured by direct read:**

| Endpoint | Mechanism | Evidence |
|---|---|---|
| **`main` `b671e1fb`** | **LOCAL cors object — wildcard** | line 44 `const corsHeaders = {`, line 45 `"Access-Control-Allow-Origin": "*",` |
| **RC `a42b209e`** | **`secureHeaders.ts` (shared) — allowlist** | line 37 `import { getSecureHeaders } from "../_shared/secureHeaders.ts";`, line 60 `function corsFor(req: Request)`, line 76 `const corsHeaders = corsFor(req);` |

The RC's own comment states the defect it repairs:

> *"⚠ THIS FUNCTION USED TO ANSWER EVERY ORIGIN WITH `*`. … a judging decision endpoint granted CORS
> to any origin on the internet while the rest of the judging surface did not."*

**Consistency check against the census — it passes.** `CORS_CENSUS_71.json` records
`submit-judge-decision` as the **single** prod-vs-repo disagreement: production `LOCAL cors object`
(wildcard `true`), repo `secureHeaders.ts (shared)`. Production is still running the pre-change code.
Both my independent re-derivation and Developer 2 reproduce it.

**And the scope limit stands unchanged: C-4 reaches 1 of 39.** Promotion changes the CORS mechanism
of exactly one function. The other 38 local-wildcard functions are untouched by this release, and
under **§23.5.1 condition 2** no function is deployed by it at all — so even this one change does not
reach production on merge.

*(Note for the register: at `702e5ce` this function **already** carries `getSecureHeaders`. The
change predates the 2026-08-26 baseline on the staging line. It is the one file — of all files under
`supabase/functions/` — that differs between `702e5ce` and the RC: `send-gift-credit/index.ts`.
`submit-judge-decision` is identical at both.)*

---

## 4. Standing

**Prepared only.** Nothing above closes a §25 row. A14 (C-18 citation sweep) and A15 (the 138-file
index — to be **offered** to the auditor, not produced unasked) follow, then Lanes A, B and C with
A17 urgent.

> ⛔ **C-23 EXTENDED — 2026-08-30, AND THIS ONE IS ENTIRELY MINE.**
>
> When I withdrew the `702e5ce` framing I **kept** a "consequence that survives":
> ~~"`main..702e5ce` = 98 files is a symmetric difference against a divergent tip, not 'the first 98
> of the eventual 138'. Any statement of the form 'the baseline covered 98 of the 138 files' is false
> and must not be written."~~ **That retained claim is FALSE and is withdrawn.**
>
> **I never ran the subset test. I inferred it from the merge-base.** Measured now:
>
> ```
> comm -23 <(git diff --name-only main 702e5ce | sort) <(git diff --name-only main a42b209e | sort) | wc -l
> -> 0
> ```
>
> **All 98 paths ARE members of the 138. The 98 are a strict subset.** "The baseline covered 98 of
> the 138 files" is **true**, and I forbade writing a true sentence.
>
> **And the compiler's C-23 went further than I credited:** `702e5ce` **is an ancestor of the RC** —
> `git merge-base --is-ancestor 702e5ce a42b209e` returns true, through staging's own first-parent
> line via `fe4505aa`, and it appears in the ledger's §5.4 commit manifest. It is not a divergent
> tip at all with respect to the release; it is an earlier point on staging's line.
>
> **What is left of the original measurement, and it is only this:** `702e5ce` is **not a descendant
> of `main`** (their merge-base is `32930e75`; `main` was merged into `staging` later at `9faf5a17`),
> so `main..702e5ce` is not a fast-forward range and its **line** counts do not compose with the
> RC's. **The path set does compose — it is a subset — and I said the opposite.**
>
> **The failure, named:** I withdrew a framing and retained the consequence I had drawn from it,
> without measuring the consequence. That is the same error as the "share four members" number
> earlier today — a claim written from reasoning inside a document about not doing that.
