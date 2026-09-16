# Developer 1's 12 rows vs the compiler's tranche 2 — convergence, and one hint discharged

Date: 2026-08-31 · **Written AFTER my 12 rows were frozen and hashed, and after reading tranche 2 —
in that order.** The frozen file is unchanged; this records what happened beside it.
**Nothing here closes a §25 row (§25.4).**

| | |
|---|---|
| my frozen rows | `A15_CLAIMS_DEV1_SCRIPTS_AND_DOCS.tsv` · sha256 **`ae720a8457998d3e9fe9cf447e736eecb70c0af664bd139293d094a230543823`** · 4,345 B · 13 lines (header + 12) · 10 fields on every line |
| published at | `claude/A15_CLAIMS_DEV1_SCRIPTS_AND_DOCS_2026-08-31.tsv`, **before** tranche 2 was read |
| the other side | `claude/138_FILE_REVIEW_TRANCHE_2_2026-08-31.md`, `2026-08-31T06:05:16Z` |

**The ordering matters and is the point:** my rows were written from source, hashed, and published
**before** I opened tranche 2. Neither set could have been fitted to the other.

---

## 1. Per-item agreement on the mechanical counts — six for six

Not totals. Each of the six is an independently produced count for a named file (rule 5):

| script | my `process.argv` + `process.env` | compiler's §7 | |
|---|---|---|---|
| `generate-headers.mjs` | **0** | **0** | ✓ |
| `generate-redirects.mjs` | **0** | **0** | ✓ |
| `generate-seo-assets.mjs` | **0** | **0** | ✓ |
| `lane-config.mjs` | **1** | **1** | ✓ |
| `health-check.mjs` | **2** | **2** | ✓ |
| `verify-bundle-isolation.mjs` | **11** | **11** | ✓ |

We also independently recorded the same two `spawnSync(process.execPath, [path], …)` sites
(`test-isolation-guard.mjs`, `test-seo-assets.mjs`) and both noted the **argument-array form, no
shell**.

## 2. The one row where the compiler went further than I did — and my hint is discharged

**My frozen row raises `scripts/verify-schema-dependencies.mjs` from MED to HIGH**, with the basis
stated in the row: it is the only one of the ten reading `process.argv`, and `argv[2]` is exactly
where the workflow puts its free-text `source_dir`.

**The compiler answered the question that hint was pointing at: `SOURCE_DIR` never reaches the exec
call. I verified that myself before recording it here** — all six occurrences, quoted:

```
 48: const SOURCE_DIR = process.argv[2] || "src";
605: if (!existsSync(SOURCE_DIR)) fail("S1", `source directory "${SOURCE_DIR}" does not exist.`);
607: const { refs: references, parseErrors } = extractReferences(SOURCE_DIR);
623:   `no .rpc() calls found anywhere under "${SOURCE_DIR}". …`
853: console.error(`Scanned ${SOURCE_DIR}/`);
901: console.log(`Scanned ${SOURCE_DIR}/`);
```

**Filesystem existence check, a directory walk, and three report strings. Nothing else.** The single
child process in all 906 lines is:

```
754: out = execFileSync("psql", [dbUrl, "-At", "-c", CATALOG_SQL], { … });
```

`execFileSync` with an argument array — **no shell** — and **`SOURCE_DIR` is not among the
arguments** (`grep -c 'SOURCE_DIR'` over the `execFileSync` line → **0**).

> **DISCHARGE, recorded beside the frozen row and NOT written over it.**
> The `HIGH` in the published TSV **stands as issued** — it was a routing hint, and it routed
> correctly: it pointed at the largest file in the change set and at the exact question worth asking.
> **The question has now been answered from source, twice, independently, and the answer is clean.**
> A reviewer using the frozen row should read this discharge with it. **The file's hash is unchanged
> because the row is unchanged** — that is the mechanism working, not an oversight.
>
> **What the discharge does NOT cover:** the workflow line
> `run: node scripts/…mjs '${{ inputs.source_dir }}'` remains the exposure, because the shell command
> is assembled by textual substitution **before node exists**. **Patching the workflow and not the
> script was the right call**, and that is now established from source rather than from my assertion.

## 3. Where tranche 2 confirms something I could not have

**The `<` fix shape.** The compiler derived from the defect alone — *"the correct fix is
unicode-escaping the dangerous characters inside the serialised output"* — that `<` is what
`_seo.ts` requires, **without having read the Option 2 patch**, which is unreachable from their clone
because the branch is unpushed. It matches what the branch carries.

**That is a stronger corroboration than reviewing my patch would have been**, and it is worth saying
why: a reviewer who reads a patch can only agree or disagree with it. A reviewer who derives the
required fix from the defect and *then* finds it matches has produced independent evidence. **The two
of us reached `<` from opposite directions.**

**They also closed WO-8 B2 from source:** `stripHtml` is line 76,
`.replace(/<[^>]*>/g, " ")` — a tag stripper, not an escape. That is the same conclusion my A-3
planted-payload proof reached empirically (payload P2, `</script/` with no closing `>`, survives it).
**Derivation and demonstration, agreeing.**

## 4. Two things I am NOT adopting from tranche 2

1. **`docs/PROMOTION_LEDGER.md` status.** Tranche 2 does not address it; my row records **`A`** on
   the measurement `git cat-file -e BASE:docs/PROMOTION_LEDGER.md` → **fails**. The ledger does not
   exist on `main`; this promotion adds it. Stated because it is counter-intuitive for a file that
   has been edited all engagement.
2. **Their coverage arithmetic.** Tranche 2 says *"scripts/ 10 of 10"* reviewed and *"55 of 138"*
   cumulative. **I have written claims rows for those same 10.** Whether two independent reviews of
   the same 10 files count once or twice toward §25.7.2 coverage is **the compiler's ruling, not
   mine** — and rule 5 says I must not assume the two sets are the same 10 without a per-item diff.
   **They are the same 10; I checked by name.** But the coverage credit is theirs to rule.

## 5. Standing

My 12 rows are frozen at `ae720a84…3823` and unchanged by anything above. The remaining **75** of my
87 — 44 `supabase/functions/`, 8 CI workflows, 8 root/config, 7 Pages functions, 7 SQL, 1 supabase
config — are next. **Nothing here closes a §25 row.**
