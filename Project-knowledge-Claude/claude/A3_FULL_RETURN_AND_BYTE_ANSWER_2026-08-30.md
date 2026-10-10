# A-3 §3a–§3e — full return · and the byte answer on the two email functions

Date: 2026-08-30 · Read-only measurements plus the already-authorised local branch. **No push, no
merge, no tag, no deploy, no PR, no force-push, no push to `staging` or `main`, no ledger commit.**
**Nothing here closes a §25 row (§25.4).** Transcript: `A3_FULL_RETURN_TRANSCRIPT.txt`, re-run fresh.

---

# PART 1 — THE BYTE QUESTION. **No conflict. It is Pass 2 vocabulary.**

> **Answer: the file is `deno.json`, and it is byte-identical on both sides. Nothing differs.**
> My strict reading calls these two DRIFT because **my closure never emits `deno.json` as a member**,
> not because any byte differs. **Developer 2 is right on the bytes.**

## 1.1 The bytes, quoted — not paraphrased

**`handle-email-suppression`**

| file | repo @ `a42b209e` | deployed bundle | identical? |
|---|---|---|---|
| `index.ts` | **5,085 B** · sha256 `02dd49fa6a4cf70cda05ebd2b94397a738ff639b0f31693d362d29a0b41ca1dd` | **5,085 B** · sha256 `02dd49fa6a4cf70cda05ebd2b94397a738ff639b0f31693d362d29a0b41ca1dd` | **YES** |
| `deno.json` | **2 B** · sha256 `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` | **2 B** · sha256 `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` | **YES** |

**`handle-email-unsubscribe`**

| file | repo @ `a42b209e` | deployed bundle | identical? |
|---|---|---|---|
| `index.ts` | **4,035 B** · sha256 `2ef684a9b5dd6bf33b1aaa0d8ea8e2c0bccc903c5a925b3f3394a6d1856d2bf6` | **4,035 B** · sha256 `2ef684a9b5dd6bf33b1aaa0d8ea8e2c0bccc903c5a925b3f3394a6d1856d2bf6` | **YES** |
| `deno.json` | **2 B** · sha256 `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` | **2 B** · sha256 `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` | **YES** |

**`deno.json` content, byte-for-byte, both slugs, both sides:**

```
repo (git show | od -c):   0000000   {   }
                           0000002
deployed (files[].content): '{}'   as bytes: [123, 125]
```

Both repo blobs are the **same git object**, `9e26dfeeb6e641a33dae4961196235bdb965b21b`.
`44136fa3…aff8a` is the sha256 of the two-byte string `{}` — the same value on both sides, for both
functions. **Four files, four matching hash pairs, zero differences.**

## 1.2 So why does my instrument say DRIFT? Its own record, quoted

```json
"handle-email-suppression": {
  "verdict": "DRIFT",
  "detail": { "reason": "path sets differ", "only_in_rc": [],
              "only_in_prod": ["handle-email-suppression/deno.json"] },
  "n_rc": 1, "n_prod": 2 }
```

`n_rc: 1`. My closure emitted **`['handle-email-suppression/index.ts']`** and nothing else.
`classify()` compares path **sets** before it compares any content, finds `deno.json` only on the
production side, and returns `DRIFT` on `"path sets differ"` — **without ever hashing it.**

**The mechanism, from my own harness, line 39–41:**

```python
im = os.path.join(root, slug, "deno.json")
if os.path.exists(im): args += ["--import-map", im]
```

**`deno.json` is passed to the closure as the import map — it is an input to resolution, never a
resolution target.** No `import` statement names it, so nothing ever adds it to the closure. It is
consumed and not emitted.

## 1.3 The Functions API agrees it is a declaration, not a source file

The deployed record carries, verbatim:

```
import_map      : True
import_map_path : '/tmp/user_fn_…/source/handle-email-suppression/deno.json'
entrypoint_path : '/tmp/user_fn_…/source/handle-email-suppression/index.ts'
```

The platform separates **entrypoint** from **import map**. My closure models the entrypoint's
transitive imports; the deployed `files[]` array lists **everything shipped**, map included.

## 1.4 Ruling this against the Pass-1/Pass-2 test

| test | result |
|---|---|
| **Is there a byte conflict?** | **NO.** Four files, four matching sha256 pairs. Nothing outranks anything |
| **Is it a Pass 1 defect?** | **NO.** Neither instrument measured a byte wrongly |
| **Is it Pass 2 vocabulary?** | **YES.** A file-set *enumeration* difference: dependency closure (mine) vs shipped-file listing (Developer 2's, and the platform's) |

**And my instrument is the one that is wrong for this question.** The question B13 runbook step 15b
asks is *"does the deployed bundle differ from the repo?"* — and `deno.json` **is** part of the
deployed bundle and **is** in the repo, byte-identical. Reporting DRIFT for a file that matches is a
**false positive**, produced by a closure that structurally cannot emit an import map.

> **F-40 — my drift instrument cannot see a file that is shipped but never imported.**
> Any bundle member reachable only by platform convention rather than by an `import` statement is
> invisible to the closure and therefore always lands in `only_in_prod`. In this corpus that is
> exactly two functions and exactly one file each; **the defect is bounded and now named.** The
> import-map-excluded reading was an ad-hoc workaround for it without knowing that is what it was.
>
> **Corrected verdict for these two, on the bytes: `MATCH`.** My `a42b209e_strict` column is wrong
> for `handle-email-suppression` and `handle-email-unsubscribe`, and the
> `a42b209e_imap_excluded` column is right — **for a reason I can now state rather than assume.**
> **Consequence for the join: the correct Pass 1 column is `a42b209e_imap_excluded`, collapsed
> MATCH = 21**, and it agrees with Developer 2's 21 **by construction of the bytes, not by matching
> counts.** Membership must still be diffed per item (rule 5); the file is published for exactly that.
>
> **I am changing my join column because a measurement showed my instrument wrong — not because it
> makes the numbers agree.** The distinction is the whole point, and the evidence is above it: four
> sha256 pairs, quoted, before any count was compared.

---

# PART 2 — A-3 §3a–§3e, returned in full

> **Note on §3b, offered without argument.** The trigger enumeration **was** performed and returned
> before the push attempt; if it did not reach you, that is the relay defect you recorded in §0 of
> the join ruling, and this return is unaffected either way. It is re-run fresh below.

## §3a — patch file sha256, and which set

| file **applied** (from `16_LANES_ABC/patches_fixed/`) | sha256 |
|---|---|
| `01-apply-migration.yml.patch` | **`1a5f1c4fd1ab25afd1076b41e86c976c51d219f7c8513b2e312781d686522d16`** |
| `02-verify-schema-dependencies.yml.patch` | **`7422531b7b04eba9f05df385cb88e9c8ddebe94350aea813cd78418231ca7967`** |
| `03-functions-_seo.ts.patch` | **`ba939941f15cb59daa8cfd9e229d5216448a5d87b32af812587ffeda30565636`** |

| file **NOT applied** (defective originals, `09_OPTION2_PATCHES/`) | sha256 |
|---|---|
| `01-apply-migration.yml.patch` | `2ad96918648a660e80b054b44811b6d9c0939b014ac18cbbb39a8f7cfda3e604` |
| `02-verify-schema-dependencies.yml.patch` | `01fe29f5026a6e2c88845a678e8f52832e7d3ade80dc45a6a841b8368bbf9759` |
| `03-functions-_seo.ts.patch` | `53983b18b885c625b8b8ebb9734d0143a5a5906497f838810457b4728989ae11` |

**Six distinct values; the three applied are the fixed set.** The same three hashes are recorded **in
the commit message** of `9384ba9`, so the branch itself carries the provenance. `git apply --check`
returned OK for all three before any file was written.

## §3b — every workflow on the branch, and which fire on a branch push

Branch `rc-replacement/option2-2026-08-30`, head `9384ba9aeef585f615148b208f13d68fdbe169f5`.
All 8 `on:` blocks are quoted verbatim in the transcript. Verdicts computed from those `branches:`
lists:

| workflow | `on:` push branches | fires on a push to this branch? |
|---|---|---|
| `android-build.yml` | `[main]` (+ 2 path filters) | **no** |
| `apply-migration.yml` | — | **no** — no `push:` trigger at all |
| `health.yml` | — | **no** — no `push:` trigger at all |
| `security.yml` | `[main, staging]` | **no** |
| `typecheck.yml` | `[main, staging]` | **no** |
| `ui-gate.yml` | `[main, staging]` | **no** |
| `verify-schema-dependencies.yml` | — | **no** — no `push:` trigger at all |
| `web-build.yml` | `[main, staging]` | **no** |

**8 of 8: none fires. The push gate is clear.**

**Forward warning, separate from the push:** `security`, `typecheck`, `ui-gate` and `web-build` each
carry `pull_request: branches: [main, staging]`. **Opening a PR from this branch fires all four.**
None was opened. **A push is not a PR.**

## §3c — the diff, the deltas, the per-item file check

```
M	.github/workflows/apply-migration.yml
M	.github/workflows/verify-schema-dependencies.yml
M	functions/_seo.ts
path count: 3   added: 0   deleted: 0
```

| | |
|---|---|
| line delta `a42b209e..head` | `18/5` + `11/1` + `7/1` = **+36 / −7** |
| **files vs `main`** | **138** — and the path **sets** for RC and head have **empty symmetric difference**; each of the three patched paths individually confirmed `MEMBER` of the RC's 138; 0 added, 0 deleted. **Per item, not by count** |
| **lines vs `main`** | **+9,095 / −1,299** measured — **supersedes** A-4's projected +9,096/−1,300 (cause diagnosed: `verify-schema-dependencies.yml` does not exist on `main`, so it is all-additions and the patch's one deletion nets out, `+119/−1` → `+118/−0`) |
| **commits vs `main`** | **40** incl. merges, **38** excl. — A-4's **INFERRED** 40·38 is now **MEASURED and reclassified VERIFIED** |

## §3d — the construct at `a42b209e` and on the branch, side by side, per file

### File 1 · `.github/workflows/apply-migration.yml`

**Construct:** a `${{ inputs.* }}` expression expanded by the runner **inside a `run:` shell body**,
where the value becomes shell text.

| at `a42b209e` (defective) | on the branch (patched) |
|---|---|
| `FILE='${{ inputs.migration }}'` | `env:` → `MIGRATION: ${{ inputs.migration }}` · `FILE="$MIGRATION"` |
| `CONFIRM='${{ inputs.confirm }}'` | `env:` → `CONFIRM_INPUT: ${{ inputs.confirm }}` · `CONFIRM="$CONFIRM_INPUT"` |
| `cat '${{ inputs.migration }}'` | `cat -- "$MIGRATION"` |
| `-f '${{ inputs.migration }}'` | `-f "$MIGRATION"` |
| `echo "✅ Applied: ${{ inputs.migration }}"` | `echo "✅ Applied: $MIGRATION"` |

**Five sites. All five removed from shell bodies.** Residual stated, not glossed:
`${{ inputs.target }}` remains inside `run:` bodies at lines 104, 147, 150, 162, 165 — it is
`type: choice` with `options: [staging, production]`, so the runner admits only those two literals.
`migration` and `confirm` are `type: string`. **That type distinction is the patch's actual rule.**

### File 2 · `.github/workflows/verify-schema-dependencies.yml`

```diff
-        run: node scripts/verify-schema-dependencies.mjs '${{ inputs.source_dir }}'
+        env:
+          SOURCE_DIR: ${{ inputs.source_dir }}
+        run: |
+          set -euo pipefail
+          case "$SOURCE_DIR" in
+            src|supabase/functions|functions) : ;;
+            *) echo "::error::source_dir must be one of: src, supabase/functions, functions. Got: $SOURCE_DIR"; exit 1 ;;
+          esac
+          node scripts/verify-schema-dependencies.mjs "$SOURCE_DIR"
```

Two independent controls: never interpolated into the shell, **and** constrained to three known trees.

### File 3 · `functions/_seo.ts`

| | |
|---|---|
| **`a42b209e` line 118** | `` ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>` `` |
| **branch line 124** | `` ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c")}</script>` `` |

**And quoting is not the proof — the payload is.** `seo_escape_proof.mjs`
(sha256 `6db4629201959a42160f6acdad392e174dadda60047d2443e52c60516094f7e7`):

| payload | OLD `a42b209e` | **branch `9384ba9`** | `stripHtml` (negative control) |
|---|---|---|---|
| `</script><img src=x onerror=…>` | **breaks out** | contained | contained |
| `</script/ onerror=…` (no closing `>`) | **breaks out** | **contained** | **breaks out** |

The second payload exists because the first **did not discriminate the control**. Emitted on the
branch: `{"@type":"Article","name":"Sunset </script/ onerror=PLANTED_XSS "}`.

**Accepted: YAML parsing, `bash -n` and esbuild are syntax checks and prove nothing about the
defect.** They are reported as what they are — the branch is well-formed — and the defect evidence is
the table above.

## §3e — base sha, and everything that must not have moved

| | |
|---|---|
| **base** | **`a42b209e4f70a6efed4f3dcdb654e0f994416594`** (`cat-file -t` → `commit`) — the frozen RC, **not** the `staging` tip |
| **head** | **`9384ba9aeef585f615148b208f13d68fdbe169f5`** |
| `origin/main` | `b671e1fb0c5bcf145d442076c229eca888afd674` — **unmoved** |
| `origin/staging` | `9ac4524d703035e6d2debd9e97ab9a0e73de3bc9` — **unmoved** |
| worktree | clean |
| tags at head | **0** |
| remote refs matching `rc-replacement/*` | **0** — not pushed |

**Push authority is not being sought**, per your instruction. `DISABLED_NO_PUSH_AUTHORITY` cost
nothing: the branch reconstructs from `a42b209e` plus three hashed patches, and both halves are on
the record.

---

## What this return changes

1. **No byte conflict.** Nothing outranks the queue.
2. **F-40 raised, and it is against my own instrument** — the closure cannot see a shipped-but-never-imported file. Bounded to two functions, one file each.
3. **Join column changed to `a42b209e_imap_excluded` (MATCH = 21)** — because the bytes show my strict column wrong on two rows, not because 21 matches 21. Membership still to be diffed per item.
4. **A-3's §3a–§3e are returned in full**, with the defect evidence separated from the syntax checks.
