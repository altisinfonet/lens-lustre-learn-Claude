# WORKSTREAM 4 — RE-MEASURE ALL **N** DEPLOYED PRODUCTION FUNCTIONS AGAINST `a42b209e`

> **`N` is discovered, not assumed.** The ledger's 71 is a 2026-08-26 figure.
> **`N ≠ 71` is a FINDING — never a reason to discard the measurement.**

**Status: BLOCKED for the compiler** — no Supabase access. Unblocked by **D-13** (ledger §25.7).

> ## ⚠ EXECUTION PROVENANCE: **SPECIFIED, NOT EXECUTED** (§0.11)
> **No command in this file has been run by anyone.** Revisions 1 and 2 each contained procedures
> that could not have worked (§4.0). Treat every command as a **draft to be confirmed** — §4.1 makes
> that confirmation the first step.

> ## ⚠ READ ONLY. DEPLOY NOTHING.
> B13 condition 2 excludes **all** edge-function deployment from this release. A blanket
> staging→production deploy is expressly prohibited (condition 15d) — **production may be AHEAD in
> some functions** and would be regressed by it.

---

## 4.0 · Defects in revisions 1 and 2 — preserved, not deleted

| Rev | Defect | Why it mattered |
|---|---|---|
| 1 | `find … \| xargs sha256sum` called a **per-file** hash list a "bundle SHA" | two auditors would produce different, incomparable outputs |
| 2 | `supabase functions list` parsed with `grep -c .` and `cut -d' ' -f1` | the default output is a **formatted six-column table**; `N` and the slugs would both be wrong |
| 2 | `cd prod/$FN` after download | the CLI writes to **`<workdir>/supabase/functions/<slug>/`** — the path never existed |
| 2 | capture root defined as "relative to that function's own root" | **`_shared/secureHeaders.ts` lives OUTSIDE that root**, so **HEADER-ONLY could never be produced.** The classification was unreachable — the same shape as the untriggerable probe (`05_…§A.0`) |
| 2 | "deployed bundle SHA" | `functions download` returns **source**, not the executable bundle. The name over-claimed what was measured |
| 2 | direction inferred from a production-vs-RC diff alone | a two-way diff **cannot** establish which side is newer |

---

## 4.1 · Step 0 — pin the toolchain, then confirm the flags actually exist

**Record, verbatim, before anything else:**

| Field | Value |
|---|---|
| `supabase --version` | |
| Supabase CLI install method (brew / npm / binary) | |
| `jq --version` | |
| OS / arch | |

**Then confirm the flags this procedure uses are present at *your* pinned version** — the compiler
could not verify them against a live CLI, and CLI flags move between releases:

```bash
supabase functions list --help      | tee help-list.txt
supabase functions download --help  | tee help-download.txt
```

**Check for:** a JSON output mode (`-o json` / `--output json`), `--project-ref`, and `--use-api` on
`download`. **If a flag differs at your version, use the equivalent and RECORD the substitution.**
Do not proceed on a flag that is not in your `--help` output.

> **Never parse a human-readable table.** Structured output only.

## 4.2 · Step 1 — inventory from parsed JSON, and discover `N`

```bash
set -euo pipefail
export LC_ALL=C
REF=jtdtehuqtinjxropkkcn          # PRODUCTION project ref — identity control (§0.6a)
mkdir -p ws4 && cd ws4

supabase functions list --project-ref "$REF" -o json > functions.json
jq -e 'type == "array"' functions.json >/dev/null    # fail fast if the shape is not an array

N=$(jq 'length' functions.json)
echo "N=$N"

# the fields the pack requires, from the parsed array — never from a table
jq -r '.[] | [.slug, (.version|tostring), .status, .updated_at] | @tsv' functions.json \
  | sort > inventory-meta.tsv
wc -l inventory-meta.tsv                              # must equal N
```

**Record from the parsed array, per function:** `slug`, `version`, `status`, `updated_at`.
**Record `N` and how it was derived** (`jq 'length'`).

> If your CLI's JSON uses different key names, record the actual keys and adjust — **and say so.**

## 4.3 · Step 2 — one fresh isolated workspace per function

**Cross-function contamination is prevented by isolation, not by cleanup.**

### Fresh state, and a block that actually parses (repaired at revision 6)

> **Revision 5's block was broken:** an unconditional duplicate manifest-hash append, a duplicate
> `done`, a relative `../07_ws4_reference_impl.py` that breaks once you `cd` into `$RUN`, and
> `functions.json` / `inventory-meta.tsv` written outside `$RUN` then read from inside it.
> **It would not have run.** The block below is syntax-checked with `bash -n` (§4.3a).

```bash
set -euo pipefail
export LC_ALL=C
REF=jtdtehuqtinjxropkkcn                     # PRODUCTION project ref - identity control
IMPL="$(cd "$(dirname "$0")" && pwd)/07_ws4_reference_impl.py"   # ABSOLUTE, survives cd
IMPORT_MAP="${IMPORT_MAP:-}"                 # optional; leave empty if the RC has none

RUN="run-$(date -u +%Y%m%dT%H%M%SZ)-$$"      # unique; must not already exist
[ -e "$RUN" ] && { echo "FATAL: run dir $RUN exists - refusing"; exit 1; }
mkdir "$RUN"

# inventory is produced OUTSIDE $RUN (step 1) and copied IN with explicit commands
cp -- functions.json       "$RUN/functions.json"
cp -- inventory-meta.tsv   "$RUN/inventory-meta.tsv"
cd "$RUN"
mkdir -p work snap
: > inventory.txt                            # explicit truncation of every append target
: > unknown.tsv

# validate the inputs BEFORE the loop - a short file here silently shortens the whole run
N=$(python3 -c 'import json,sys; print(len(json.load(open("functions.json"))))')
META=$(grep -c . inventory-meta.tsv || true)
[ "$N" -gt 0 ]        || { echo "FATAL: functions.json parsed to 0 functions"; exit 1; }
[ "$META" -eq "$N" ]  || { echo "FATAL: inventory-meta.tsv has $META rows, expected N=$N"; exit 1; }
echo "N=$N  meta rows=$META  (validated)"

while IFS="$(printf '\t')" read -r SLUG VER STATUS UPDATED; do
  [ -n "$SLUG" ] || continue
  W="work/$SLUG"
  rm -rf -- "$W"; mkdir -p -- "$W"           # a FRESH, EMPTY workspace per function
  ( cd "$W" && supabase functions download "$SLUG" --project-ref "$REF" --use-api )

  ROOT="$W/supabase/functions"               # CAPTURE ROOT - see 4.4

  # ERREXIT CONTRACT: `set -e` aborts before `RC=$?` can run, so capture with if/else.
  if python3 "$IMPL" closure --root "$ROOT" --entry "$SLUG/index.ts" \
        ${IMPORT_MAP:+--import-map "$IMPORT_MAP"} \
        > "snap/closure-$SLUG.txt" 2> "snap/closure-$SLUG.err"
  then CLOSURE_RC=0
  else CLOSURE_RC=$?
  fi

  case "$CLOSURE_RC" in
    0)  python3 "$IMPL" manifest --root "$ROOT" --files-from "snap/closure-$SLUG.txt" \
            > "snap/manifest-$SLUG.txt"
        printf '%s  %s\n' "$(sha256sum "snap/manifest-$SLUG.txt" | cut -d' ' -f1)" "$SLUG" \
            >> inventory.txt
        ;;
    3)  # unresolved / out-of-root / UNPARSEABLE -> UNKNOWN. No manifest, no digest, no classify.
        printf 'UNKNOWN\t%s\t%s\n' "$SLUG" "$(tr '\n' ';' < "snap/closure-$SLUG.err")" \
            >> unknown.tsv
        rm -f -- "snap/manifest-$SLUG.txt"
        ;;
    *)  echo "FATAL: unexpected closure exit $CLOSURE_RC for $SLUG - stopping" >&2
        exit "$CLOSURE_RC"
        ;;
  esac
done < inventory-meta.tsv

sort -o inventory.txt inventory.txt
[ -s unknown.tsv ] && sort -o unknown.tsv unknown.tsv
sha256sum inventory.txt                      # <-- THE INVENTORY DIGEST
CLASSIFIED=$(grep -c . inventory.txt || true)
UNKNOWNS=$(grep -c . unknown.tsv || true)
echo "classified=$CLASSIFIED unknown=$UNKNOWNS N=$N"
[ $((CLASSIFIED + UNKNOWNS)) -eq "$N" ] || { echo "FATAL: functions unaccounted for"; exit 1; }
```

> **Exit 3 creates exactly one UNKNOWN row and nothing else** — no manifest, no inventory row, no
> classification — **and the loop continues to the next function.** Pinned by integration fixtures
> **T29a–T29f**. Any other non-zero exit **stops the run**: an unexpected failure is not a finding,
> it is an unknown state.

## 4.3a · Syntax check of the block above

The block above is extracted and checked with `bash -n` (parse only, nothing executed) by the
shipped verifier, which does the same for **every** shell block in this pack:

    bash 10_verify_pack.sh

> **Why this is a script and not an inline one-liner.** The revision-6 draft inlined an `awk`
> extractor here — and the `awk` program itself contained a triple backtick, which **closed the
> markdown fence early** and truncated the block mid-quote. `bash -n` caught it immediately.
> Another defect that reading would not have shown. The extractor now lives in
> `10_verify_pack.sh`, where no fence can bite it.

**Excluded as CLI metadata, not source:** `supabase/.temp/**`, `.DS_Store`. **Record any other path
you exclude and why** — an undocumented exclusion is how a real difference disappears.

**A non-zero closure exit (`3`) means at least one import could not be resolved inside the capture
root. That function is `UNKNOWN`** — record the `.err` file. **Never classify it MATCH.**

## 4.4a · The dependency-closure algorithm — pinned and executable

> **Corrected at revision 4.** Revision 3 said "the shared sources the CLI returns with it", which is
> prose, not an algorithm: two auditors would collect different file sets and get different digests.

**The algorithm is `07_ws4_reference_impl.py`, in this pack.** Revision 5 replaced its regex
scanner with a **token-level lexer** (strings, template literals, comments, regex-vs-division with a
paren-keyword stack) under a **fail-closed contract**: anything it cannot prove it understood makes
the file `UNPARSEABLE`, which makes the function **UNKNOWN**.

**`FIXTURE-TESTED`** — `08_selftest.sh` runs **26** known-answer cases, all pass; `09_rc_regression.sh`
runs **8** against representative real RC files. Pinned by SHA-256 in `MANIFEST.sha256`.

> **JSX.** `<Disclaimer />` makes `/` undecidable for a plain-TS lexer, and every email template in
> this RC is `.tsx`. Rather than declare ~20 real files UNKNOWN, a **narrow header-complete
> fallback** applies **only** when all three hold: the failure is a regex-literal ambiguity, **and**
> the file is `.tsx`/`.jsx`, **and** the remaining raw text mentions neither `import` nor `require`
> anywhere — strings and comments included. Anything malformed under any grammar (unterminated
> string, comment or template; non-literal dynamic import) **fails closed and never reaches the
> fallback**. Fixtures T22–T24 pin all three conditions.

| Concern | How it is handled | Fixture |
|---|---|---|
| Static imports / re-exports | `import … from`, `import "x"`, `export … from` | T1 |
| **Dynamic imports** | `import("x")` is followed | T1 |
| **Shared deps above the function dir** | capture root is `supabase/functions/`, so `_shared/**` is **inside** it | T1, T3 |
| **Cycles** | BFS with a `seen` set over **canonicalised (`realpath`)** paths | **T6** |
| **Import maps** | `--import-map`, longest-prefix trailing-slash resolution | T7 |
| Extensionless / `index.*` specifiers | candidate suffixes `.ts .tsx .js .mjs .jsx /index.*` | T7 |
| **Unresolved bare specifiers** | reported to stderr, **exit 3 → UNKNOWN** | T8 |
| Remote deps (`https:`, `npm:`, `jsr:`, `node:`) | recorded as **EXTERNAL**, not followed, not an error | T9 |
| Imports inside comments | lexer skips comments entirely | T10, T14 |
| **Multiline** `import { … } from` | token-level, newlines irrelevant | **T11** |
| **Multiline** `export { … } from`, `export *`, `export * as ns` | same | **T12** |
| Import-like text in strings / template literals | lexed as literals, never scanned | **T13** |
| **Malformed source** (unterminated string/comment/template) | `UNPARSEABLE` → **UNKNOWN** | **T15** |
| `import`/`require` inside a `${…}` interpolation | fail closed → **UNKNOWN** | **T16** |
| **Dynamic `import(expr)` with a non-literal** | fail closed → **UNKNOWN** | **T17** |
| Regex literal containing import-like text | lexed as a regex | **T18** |
| Unresolved **local** specifier | reported, exit 3 → **UNKNOWN** | **T19** |
| **JSX** (`.tsx`) | narrow header-complete fallback, else fail closed | **T22–T24** |
| **Unparseable dep must never become MATCH** | guarded wrapper returns UNKNOWN on identical trees | **T20/T21** |
| **RC-only dependencies** | the RC side runs the **same** closure from the RC tree; a dep present only on one side changes the **path set** → **DRIFT**, never a silent omission | T5 |

**Run the RC side identically**, with the capture root set to the RC checkout's
`supabase/functions/`, so both sides are collected by the same code.

## 4.4 · Definitions — canonical, so two auditors get the same number

- **Capture root** — `<workdir>/supabase/functions/` for that function's **own isolated workspace**.
  **This is deliberately ABOVE the function directory**, so the shared sources the CLI returns with
  it (`_shared/secureHeaders.ts` and siblings) are **inside** the root and can be compared.
  *Revision 2 rooted at the function directory, which put `_shared/` out of scope and made
  HEADER-ONLY unreachable.*
- **Normalized relative path** — relative to the capture root, `/`-separated, no leading `./`,
  sorted with `LC_ALL=C`.
- **Per-file line** — `<sha256>  <bytes>  <normalized path>`, raw bytes, never text mode.
- **Deployed-source snapshot digest** — SHA-256 **of that function's manifest file**.
  > **Named precisely, per round-5 review.** It is a digest of the **source the platform returned**,
  > **not** the executable bundle's bytes. **Do not call it a bundle hash.** If raw platform bundle
  > bytes are ever obtained, that is a different artifact and gets its own name.
- **Inventory digest** — SHA-256 of `inventory.txt` (`<snapshot digest>  <slug>`, sorted by slug).

## 4.5 · Step 3 — comparison and the HEADER-ONLY algorithm

Build the RC-side manifest for each function from `a42b209e` **using the same capture root shape** —
i.e. the function's own directory **plus** the `_shared/` sources it imports — and the same
normalization. Then:

1. Identical path set **and** identical per-file hashes → **MATCH**.
2. Path sets differ → **DRIFT**. A file added or removed is never header-only.
3. Path sets identical, and the **only** differing normalized paths end `_shared/secureHeaders.ts`
   → **HEADER-ONLY**.
4. Otherwise → **DRIFT**.
5. **Normalization is limited to path form and sort order.** Do **not** strip whitespace, comments or
   line endings, and do not minify — a semantic difference hiding under a formatting normalizer is
   exactly what this workstream exists to catch. A bundler rewrite is **DRIFT**, with the reason
   recorded.
6. **UNKNOWN** only when a function could not be downloaded or read. **Record the reason per
   function. Never fold UNKNOWN into MATCH.**

**Classification is performed by `07_ws4_reference_impl.py classify --rc <m> --prod <m>`** — the
same fixture-tested code on both sides, so the verdict is reproducible rather than a judgement call.

**Report `MATCH / HEADER-ONLY / DRIFT / UNKNOWN` summing to `N`.** If it does not sum to `N`,
functions are unaccounted for — **find them; the measurement is incomplete, not void.**

## 4.6 · Step 4 — DIRECTION, and why a diff alone cannot give it

> **Corrected after round-5 review.** Revision 2 asked for `RC-NEWER` / `PRODUCTION-NEWER` /
> `DIVERGED` from a production-vs-RC comparison. **A two-way diff cannot establish chronology.** It
> shows *that* they differ, never *which came later*.

**Direction requires a common baseline or attributable history. Use whichever is available:**

> ⚠ **`updated_at` versus a commit date is NOT sufficient, and was removed at revision 4.**
> A timestamp says **when a deployment happened**, never **what source it contained**. A function
> deployed after `a42b209e` may carry *older* code — a redeploy, a rollback, a hotfix from another
> branch. **Timestamps do not bind deployed content to a git revision.**

**Direction may be recorded ONLY on one of these two bindings:**

| # | Binding | Rule |
|---|---|---|
| **1** | **Digest match to an attributable revision.** Compute the closure manifest digest for the function at candidate commits (`git log --format=%H -- <function path>`), and find a commit `X` whose digest **equals** the deployed-source snapshot digest. | `a42b209e` **descends from** `X` → **RC-NEWER** · `a42b209e` is an **ancestor of** `X` → **PRODUCTION-NEWER** · neither → **DIVERGED** |
| **2** | **Deployment metadata that names the revision** — a Supabase deployment record, CI log, or release artifact identifying the git SHA actually deployed. | same ancestry rule, using the named SHA |

**If neither binding is available, record `DIRECTION = UNKNOWN`.**
`updated_at` may be recorded as **context only**, explicitly labelled non-probative.

**Do not infer direction from "which looks newer", from line counts, from timestamps, or from the
ledger's prior result.** **Prefer UNKNOWN over a guess:** this field drives B13 condition 5, and a
wrong `PRODUCTION-NEWER` is exactly what causes a production regression.

> ⚠ **The 2026-08-26 finding of "three functions to be resolved in the opposite direction" must be
> RE-DERIVED or recorded UNKNOWN. It must not be carried forward** (ledger §23.5.3).

## 4.7 · Step 5 — the four B13 risks, re-checked against today

| # | Risk as recorded | Re-check |
|---|---|---|
| 1 | Pre-G9 CORS across all deployed functions; `secureHeaders.ts` byte-identical, md5 `58b9f45d…`, prefix match with a `.lovable.app` wildcard | Confirm the md5 across the snapshots and whether the wildcard is still present |
| 2 | `submit-judge-decision` **v23** serving `Access-Control-Allow-Origin: *` | Confirm version and ACAO value **today** |
| 3 | Storage-lane guard absent in ten functions: `s3-delete`, `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`, `detect-orphan-files`, `backfill-image-dims`, `media-register-upload` | Confirm all ten individually |
| 4 | Lane-config drift in eight functions, incl. all three email functions | Confirm the eight and name them |

> `purge-s3-orphans`, `detect-orphan-files`, `backfill-image-dims` and `media-register-upload` are
> named in risk 3 but are **NOT among the 138 changed files** — they are deployed functions this
> release does not touch. That is expected, and it is exactly why a deployed-state measurement is
> required and a repository diff is not sufficient.

## 4.8 · Pre-flight smoke test — do this before the full run

**Use a SEPARATE `$RUN` directory for the smoke test.** Its outputs must never enter the full run's
`inventory.txt` (§4.3).

**Run §4.1–§4.5 against ONE function first** (suggest `sitemap`, small and low-risk). Confirm:
the JSON parsed and `jq -e 'type==\"array\"'` succeeded; the download landed under
`supabase/functions/<slug>/`; the closure exited **0** and its output includes at least one
`_shared/**` path (proving shared deps are inside the capture root); the manifest has ≥1 line; the
snapshot digest computed.

**Also run `bash 08_selftest.sh` and `bash 09_rc_regression.sh` once** — they need only `python3`,
touch nothing outside their own temp dirs, and must print `PASS=26 FAIL=0` and `PASS=8 FAIL=0`.
For the authoritative RC form, run `bash 09_rc_regression.sh --rc-root <path-to-a42b209e-checkout>`. If it does not, the reference implementation in your copy
of the pack differs from the tested one; check its hash against `MANIFEST.sha256`.

**If any of those fails, the procedure is wrong — fix it and record the fix.** Revisions 1 and 2 both
failed at exactly this point, and neither failure was visible from reading the text.

## 4.9 · Reporting

`supabase --version`, `jq --version`, flags confirmed or substituted · `N` and how it was counted ·
whether `N = 71` and, if not, which functions were added or removed versus the ledger's list ·
`MATCH / HEADER-ONLY / DRIFT / UNKNOWN` summing to `N` · the per-drift table with **direction and the
evidence that established it** · **every `PRODUCTION-NEWER` function named** · every `UNKNOWN` with
its reason · `functions.json`, `inventory-meta.tsv`, `inventory.txt` and each `snap/manifest-*.txt`
with **SHA-256, byte size, generation timestamp, generator identity, exact command** · and the
**inventory digest**.

**Deploy nothing. Change nothing. This workstream ends in a document.**
