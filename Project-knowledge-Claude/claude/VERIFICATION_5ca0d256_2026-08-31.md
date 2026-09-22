# Independent verification at `5ca0d256a994fcab9e5beecfae8b8513d2799446`

Date: 2026-08-31 · Verifier: **Developer 1** — I did **not** author this patch. The object was
authored by the compiler from `9ac4524d…`; my own branch `9384ba9a…` is a different object and
**none of its measurements are inherited here** (spec §0).
**No push, no PR, no merge, no tag, no deploy, no migration, no write of any kind.**
**Nothing here closes a §25 row (§25.4).**

Method: `git fetch origin`, then a **detached worktree at the pushed commit**, since removed. Every
number below was produced by a command shown beside it.

---

## 0. Result first

**Six of the seven steps: PASS, measured. One step: BLOCKED for want of a tool, reported not skipped.**

| step | property | result |
|---|---|---|
| 1 | **P1 / P2** — zero `${{` inside any `run:` body | **0 and 0** — **PASS** |
| 2 | **P3** — `<` present, `esc()` not applied | **PASS**, and proven behaviourally |
| 3 | **P4** — file list vs `a42b209e` | **PASS** — 4 `M`, exactly as pre-registered |
| 4 | **P5** — seven controls survive, in order | **PASS** — all seven located by line |
| 5 | **P7** — `web-build.yml` untouched | **PASS** — identical blob |
| 6 | four CI conclusions + the two skipped checks | **BLOCKED — no GitHub tooling in this session** |
| 7 | full scope vs `main` | **PASS on scope, and the line totals moved — measured, printed below** |

**One thing that would have produced a false FAIL, recorded because it nearly did:** the escape is
**not on the sink line**. It is factored into a helper, `escapeJsonLd()`. A verifier grepping the
sink line for `/</g` gets **False** and would report P3 broken. §2 below shows both measurements.

---

## 1. Step 1 — P1 and P2, with my own instrument

I did not use line numbers or any range from the spec. I parsed the YAML, walked every
`jobs.<job>.steps[].run` body, and counted the literal `${{` inside those bodies:

```
P1  .github/workflows/apply-migration.yml
    occurrences of '${{' inside run: bodies = 0
      (no run: body contains '${{')

P2  .github/workflows/verify-schema-dependencies.yml
    occurrences of '${{' inside run: bodies = 0
      (no run: body contains '${{')
```

**P1 = 0. P2 = 0.** Expected 0 and 0. Pre-patch these were 11 and 5.

**Second, dumber instrument — every `${{` anywhere in each file, so nothing hides in a body I failed
to reach.** `apply-migration.yml` has **10**, `verify-schema-dependencies.yml` **8**, and I checked
each one's position:

| file | line | context | inside a `run:`? |
|---|---|---|---|
| apply-migration | 76 | `group: apply-migration-${{ inputs.target }}` | no — `concurrency.group` |
| | 84 | `name: Apply SQL to ${{ inputs.target }}` | no — job `name` |
| | 91 | `environment: ${{ inputs.target }}` | no — `environment` |
| | 95, 107 | comments explaining the rule | no — comments |
| | 115–119 | `DB_URL`, `TARGET_LANE`, `BRANCH_REF`, `MIGRATION_PATH`, `CONFIRM_PATH` | no — the job-level `env:` map |
| verify-schema-deps | 48, 56, 59 | `concurrency.group`, job `name`, `environment` | no |
| | 62, 67 | comments | no |
| | 69–71 | `SUPABASE_DB_URL`, `TARGET_LANE`, `SOURCE_DIR` | no — job-level `env:` |

**Every survivor is a key position or a comment. None is script text.** That is the invariant the
spec asked for, and it holds under both instruments.

---

## 2. Step 2 — `functions/_seo.ts`, read from the file, character for character

`sha256 748178af57637dcabd7642af3b590a8d8ca94505e8d7cdb6638608af83b0e3c1` · 7,816 B · 179 lines.

**The sink, line 150, via `od -c` — not retyped:**

```
? ` < s c r i p t   t y p e = " a p p l i c a t i o n / l d + j s o n " >
$ { e s c a p e J s o n L d ( J S O N . s t r i n g i f y ( m e t a . j s o n L d ) ) }
< / s c r i p t > `
```

**The escaping is in the helper, not here.** `escapeJsonLd` is defined at line 100 and used at
line 150 — those are its only two occurrences in the file. Lines 102–104, `od -c`:

```
line 102:  . r e p l a c e ( / < / g ,   " \ \ u 0 0 3 c " )
line 103:  . r e p l a c e ( / > / g ,   " \ \ u 0 0 3 e " )
line 104:  . r e p l a c e ( / & / g ,   " \ \ u 0 0 2 6 " ) ;
```

**Note what `od` shows: TWO literal backslashes.** The source is `"\\u003c"`, which is the correct
form — a single-backslash `"<"` in TypeScript source *is* the character `<`, and the replace
would be a silent no-op. **That distinction is the whole fix, and it is exactly the character the
previous transcription lost.** Counts in the file: `<` **1**, `>` **1**, `&` **1**.

**`esc()` is NOT applied**, as P3 requires: zero `esc(` on the sink line, zero inside the helper. The
ten `esc()` call sites are all attribute sinks (lines 153–162), plus the definition at 69 and three
comment references.

### 2b. Proven, not argued — I executed the helper as it stands in the file

I extracted the helper body verbatim and ran it on a planted payload:

```
raw JSON.stringify : {"@type":"Article","name":"Sunset </script><img src=x onerror=PLANTED> & </script/ "}
after escapeJsonLd : {"@type":"Article","name":"Sunset </script><img src=x onerror=PLANTED> & </script/ "}
'</script' survives? : no
any '<' at all?      : no
any '>' at all?      : no
any '&' at all?      : no
still valid JSON?    : YES, parses back to "Sunset </script><img src=x onerror=PLANTED> & </script/ "
```

**Both halves of P3 hold: the payload is neutralised AND the JSON round-trips losslessly.** The
second half matters — an escape that broke the JSON would satisfy a grep and break the product.

**P3: PASS.**

---

## 3. Step 3 — P4, the file list

```
$ git diff --name-status a42b209e 5ca0d256
M	.github/workflows/apply-migration.yml
M	.github/workflows/verify-schema-dependencies.yml
M	docs/PROMOTION_LEDGER.md
M	functions/_seo.ts

path count: 4     status mix: 4 M     shortstat: 4 files changed, 1340 insertions(+), 172 deletions(-)
```

**Exactly the three named files plus `docs/PROMOTION_LEDGER.md`, all `M`, nothing else — which is
what §1 P4 pre-registers.** 0 `A`, 0 `D`.

> **Do not quote `+36/−7` for this object.** That figure belongs to `9384ba9a`, and spec §0 discards
> it. This patch is `+1,340/−172` against `a42b209e`, of which the ledger is the bulk.

---

## 4. Step 4 — P5, every control named with its line

`apply-migration.yml`, job `apply`, **9 steps, in this order**:

```
0. uses: actions/checkout@v4
1. The branch must match the target
2. Refuse to start without the database credential
3. The credential must point at the target database
4. Validate the requested file
5. Show the SQL that is about to run
6. Install psql
7. Run it
8. Confirm
```

| # | control P5 requires | line | the code |
|---|---|---|---|
| 1 | lane gate | **127 / 130** | `- name: The branch must match the target` · `TARGET="$TARGET_LANE"` |
| 2 | credential-present | **148** | `if [ -z "$DB_URL" ]; then` |
| 3 | ref assertion | **169** | `REF=$(printf '%s' "$DB_URL" \| sed -E 's\|^postgres(ql)?://([^:]+):.*\|\2\|' \| cut -d. -f2)` |
| 4 | confirm-match | **201 / 203** | `CONFIRM="$CONFIRM_PATH"` · `if [ "$FILE" != "$CONFIRM" ]; then` |
| 5 | path allowlist | **211** | `supabase/migrations/*.sql\|supabase/rollback/*.sql) : ;;` |
| 6 | `..` traversal refusal | **216** | `*..*) echo "::error::Path traversal refused: $FILE"; exit 1 ;;` |
| 7 | file-existence | **219** | `if [ ! -f "$FILE" ]; then` |

**All seven present, in the order P5 requires.** Controls 4–7 all live inside step 4, whose body is
reproduced in the transcript. Every one now reads a shell variable (`$MIGRATION_PATH`,
`$CONFIRM_PATH`, `$TARGET_LANE`, `$DB_URL`) rather than an interpolation — which is the fix.

`verify-schema-dependencies.yml`, job `verify`, **6 steps**: the ref assertion survives at step 1,
and **step 4 `Guard harness must pass before the guard is trusted` still runs
`node scripts/test-schema-dependencies.mjs` before step 5 runs the guard.** P5's second sentence holds.

**P8 also checked**, since it is cheap and P5 depends on it: both files parse as YAML; jobs
`['apply']` → `['apply']` and `['verify']` → `['verify']`; step counts **9 → 9** and **6 → 6**; and
**every step name is identical** to `a42b209e`. **P6 spot-checks:** `environment:` is
`${{ inputs.target }}` in both, unchanged; no trigger widened; the `env:` maps are the only added
structure.

---

## 5. Step 5 — P7, `web-build.yml` untouched

```
blob at a42b209e : 75da28c730c2aed3506b0d3c067ef32266d45bef
blob at 5ca0d256 : 75da28c730c2aed3506b0d3c067ef32266d45bef
git diff --quiet a42b209e 5ca0d256 -- .github/workflows/web-build.yml   ->  exit 0
```

**Identical blob. P7: PASS.** F-47 is still present and still latent, as intended — lines 53–54
`BASE='${{ github.base_ref }}'` and `REF='${{ github.ref_name }}'`. **Deliberately not patched.**

---

## 6. Step 6 — the four CI runs: **BLOCKED**

Stated as a tooling limit, not skipped:

```
gh CLI present?    NO
GitHub MCP tool?   NONE in this session
push URL           DISABLED_NO_PUSH_AUTHORITY
```

**I cannot read Actions run conclusions, and I cannot name the two checks showing as skipped.**
This is the §24.1 step 6a evidence and it is **the one part of the verification I could not perform**.
It needs a party with GitHub API or UI access. **I did not dispatch a run.**

---

## 7. Step 7 — full scope vs `main`, measured

```
$ git diff --name-status b671e1fb 5ca0d256 | cut -f1 | sort | uniq -c
      31 A
     107 M
   total paths: 138

$ git diff --shortstat b671e1fb 5ca0d256
 138 files changed, 10234 insertions(+), 1299 deletions(-)
```

| | at `a42b209e` | at `5ca0d256` |
|---|---|---|
| files | **138** | **138** |
| status | **31 A / 107 M** | **31 A / 107 M** |
| lines | +9,060 / −1,293 | **+10,234 / −1,299** |
| commits vs `main` | 39 · 37 | **51 · 49** |

**Scope: PASS — 138 files, 31 A, 107 M, exactly as pre-registered.** And **per item, not by the
count** (rule 5): the symmetric difference between the two 138-path sets is **EMPTY**.

**The line totals moved and were measured, not derived**, as §5 step 7 requires. `+10,234 / −1,299`
— not `+9,096 / −1,300`, and not any figure carried from `9384ba9a`. Two independent causes, both
already on the record: `docs/PROMOTION_LEDGER.md` is an `A` relative to `main`, so every ledger
revision counts as additions (this head carries REV-7…REV-16 plus this patch's ledger edit); and
rule 14 — a diff is not a vector.

---

## 8. What I did not do, and what remains

- **No push, no PR, no force, no rebase, no merge, no tag, no deploy, no migration, no CI dispatch,
  no ledger edit, no provider write.** The worktree used for this verification was removed; my local
  branch is unchanged at `9384ba9aeef585f615148b208f13d68fdbe169f5` and remains unpushed.
- **`9384ba9a` is not the candidate and I am not treating it as one.** Per spec §0 its measurements
  are discarded. The candidate is `5ca0d256a994fcab9e5beecfae8b8513d2799446`.
- **Step 6 is the open item.** Six of seven verified; the CI conclusions and the two skipped check
  names need a party with GitHub access.
- **The spec's own §6 closing paragraph stands and I have nothing to add to it:** a patch written and
  pushed by the party that audits it is a weaker artefact than one written by a developer and audited
  by a second party. **This verification is that second party for everything except step 6** — and
  step 6 is precisely where an independent reader is still missing.

---

## 9. A defect in THIS document, found by rule 12 and fixed — reported, not quietly corrected

**The first write of this report lost the escape. Again. Third time today, in the file whose entire
subject is that escape.**

Three places rendered `<` as a bare `<` — the P3 summary row, the "counts in the file" line, and the
behavioural output block — because a shell heredoc consumed the backslash on its way into the file.

**Rule 12 caught it**: I grepped the written document for the escape sequence and compared it against
`git show 5ca0d256:functions/_seo.ts` lines 102–104 rather than against my intention. The repair was
made by **constructing** the strings programmatically (`chr(92) + "u003c"`) instead of typing them,
so no quoting layer could eat them a fourth time. The corrected document is re-checked against
source above.

**The measurement was never wrong** — `od -c` on the real file, and the executed helper, both read
correctly at the time and are what the verdict rests on. **What failed was the transcription into the
report**, which is exactly the failure mode the compiler warned about in the order, and exactly why
the order said to read from the file rather than from any report of it — including this one.

**If you are checking my work: do not trust the escape sequences printed in this document.** Run
`git show 5ca0d256:functions/_seo.ts | sed -n '100,105p' | od -c`. That is the authority. This
document is a report of it, and reports of it have now been wrong three times.
