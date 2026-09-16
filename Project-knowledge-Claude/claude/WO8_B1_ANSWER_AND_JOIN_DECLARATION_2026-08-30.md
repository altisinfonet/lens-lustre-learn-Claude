# WO-8 B1 answered explicitly · the join reading declared · blocked list corrected

Date: 2026-08-30 · Read-only measurements. **Nothing here closes a §25 row (§25.4).**

---

## 1. WO-8 B1 — `cloudflare/seo-edge-injector/worker.js`

**Its absence from the patch set was not an answer. Here is the answer, measured on both questions
independently, because either alone would be insufficient.**

### Q1 — Is it inside the 138?

**NO.**

```
git rev-parse b671e1fb:cloudflare/seo-edge-injector/worker.js -> 160cd148ab02eb4bd722e877fdc7b904067e4169
git rev-parse a42b209e:cloudflare/seo-edge-injector/worker.js -> 160cd148ab02eb4bd722e877fdc7b904067e4169
git diff --name-only b671e1fb a42b209e -- cloudflare/seo-edge-injector/worker.js  -> (empty)
```

**The blob is byte-identical at `main` and at the RC** — same object id. The file therefore changes
zero times in `main…a42b209e` and is not one of the 138. **It exists at both refs** (checked
separately, so "not in the 138" is not confused with "not in the tree"): `git ls-tree -r a42b209e`
and `git ls-tree -r b671e1fb` both list it.

### Q2 — Does it carry the construct?

**NO.** The construct, quoted: *a `JSON.stringify(...)` result emitted raw into an inline
`<script>`, where a `</script` sequence in any string field closes the element early.*

Measured across `worker.js` at `a42b209e` — **one** `JSON.stringify` occurrence, and it is
**already escaped**:

```js
139:            const json = JSON.stringify(obj).replace(/</g, "\\u003c");
140:            html += `<script type="application/ld+json" data-seo="edge">${json}</script>`;
```
with the file's own comment on line 138: *"Safe JSON: HTMLRewriter inserts as raw, so escape
`</script`"*. Occurrences of `u003c` in the file: **1** — the same line. **Zero unescaped sites.**

**Contrast, same measurement on the file that does carry it** — `functions/_seo.ts` at `a42b209e`:
one `JSON.stringify` at line 118, inside `<script type="application/ld+json">`, and **zero**
`u003c` escapes in the whole file.

### The answer, in one line

**`worker.js` is outside the 138 AND does not carry the construct — B1 is negative on both counts,
each measured separately.** It is the **negative control** for Track R item 5, not a fourth file the
patch set forgot. Its exclusion is correct, and now for stated reasons rather than by omission.

---

## 2. The join — which reading and which lane, declared before seeing Developer 2's list

Per §3 of the join-mapping ruling, endpoint **E3 = `a42b209e`**.

> ⛔ **SUPERSEDED 2026-08-30 — see `19_A3_FULL_RETURN/A3_FULL_RETURN.md` Part 1. Original preserved.**
> ~~"I join from: lane `a42b209e`, STRICT reading. Column `a42b209e_strict`."~~
>
> **CORRECTED JOIN COLUMN: `a42b209e_imap_excluded`.**
> **Reason — a measurement, not a count.** The bytes were taken for both disputed functions: all
> four files (`index.ts` and `deno.json`, both slugs) are **byte-identical** between the repo at
> `a42b209e` and the deployed bundle — `deno.json` is 2 bytes `{}`, sha256
> `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`, on **both** sides.
> **My strict column is a FALSE POSITIVE on those two rows** (**F-40**: my closure structurally
> cannot emit an import map, so a shipped-but-never-imported file always lands in `only_in_prod`).
> The corrected verdicts on the bytes are **MATCH**, so `a42b209e_imap_excluded` is the right column
> — **and it was right for a reason I could not state until the bytes were taken.**
>
> **Collapsed Pass 1 from the corrected column: MATCH = 21, DRIFT = 50, UNKNOWN = 0.**
> This now agrees with Developer 2's 21 **by construction of the bytes.** Rule 5 still governs:
> **membership must be diffed per item**; a matching 21 is not the evidence.
>
> **The published TSV is UNCHANGED and its hash still holds** —
> `951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da`. Both columns were always in
> it; only the declaration of which one to join from has changed.

**Why strict and not import-map-excluded — the reason is construction, not the numbers.** Developer
2's instrument is two-valued: *any byte difference, missing file or extra file is `DRIFT`*. The
strict reading is the one that enumerates the RC-side file set as my protocol specifies — the
dependency closure — and reports an extra deployed file as a difference. The import-map-excluded
reading suppresses exactly that.

**Pass 1 collapse of my column, per the ruled mapping:**

| my verdict | n | maps to |
|---|---|---|
| `MATCH` | 19 | **MATCH** |
| `HEADER-ONLY` | 22 | DRIFT |
| `DRIFT` | 30 | DRIFT |
| `UNKNOWN` | **0** | unmapped — none to report |

> **Collapsed: MATCH = 19, DRIFT = 52, UNKNOWN = 0.**

### ⚠ I must flag this BEFORE the join, not after

**The ruling says "both sides currently report 21." My strict collapsed MATCH is 19, not 21.**

**I am not switching readings to make that 21.** My import-map-excluded column *does* give MATCH =
21 — and choosing it for that reason would be tuning an instrument to reach an expected number,
which is the one thing this engagement forbids most consistently.

**What the 19-vs-21 gap actually is, measured:** the two functions are
**`handle-email-suppression`** and **`handle-email-unsubscribe`**, and nothing else. Both deploy
`index.ts` **+ `deno.json`**; my RC-side dependency closure emits only `index.ts`, because
`deno.json` is an import map, not an import target. So they are `DRIFT` under strict and `MATCH`
under import-map-excluded.

**That is a file-set *enumeration* difference, not a verdict disagreement.** A repo-side directory
listing sees `deno.json` on both sides and calls them MATCH; a dependency closure does not emit it
and calls them DRIFT. Both are defensible; they are different questions.

**So one line from Developer 2 decides which of my columns Pass 1 should run against, and it is not
a number:**

> **How did you enumerate the repo-side file set — a dependency closure from `index.ts`, or a
> directory listing of `supabase/functions/<slug>/`?**

- **Directory listing** → join against my **`a42b209e_imap_excluded`** column (MATCH = 21).
- **Dependency closure** → join against **`a42b209e_strict`** (MATCH = 19), and if they report 21
  the difference is real and is these two functions.

**Both columns are published in the same file, so nothing has to be re-measured either way, and
neither side has to choose after seeing the other's answer.** Pass 1 remains a membership test:
symmetric difference empty, never equal counts (rule 5).

**Status: BLOCKED pending that one-line method statement plus Developer 2's list. I will not report
agreement from matching totals.**

---

## 3. Blocked list — corrected

> ⚠ **My blocked list was stale on one item, and the compiler is right to call it.**
> *"the `SUPABASE_DB_URL` repository-secret check on you"* — **that check is DONE.** Repository
> secrets are exactly four: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
> `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. **`SUPABASE_DB_URL` is an environment secret on
> `production` only.** Classification **OWNER-ATTESTED** (the compiler captured it).
> **Item 8 of the Lane board's blocked list is UNBLOCKED and removed.**

**Consequence for A17 item 2, which depended entirely on it — now settled and no longer
conditional:** `apply-migration.yml` on `main` today is dispatchable from any branch, its
`environment:` line is commented out at line 77, and the only database credential is an environment
secret it therefore cannot read. **`${{ secrets.SUPABASE_DB_URL }}` resolves empty and the job's own
first step exits 1.** A17's conditional now rests on an answered question.

**F-36 is unaffected and still stands:** after the merge the `environment:` line is live, and what
separates a dispatch on any branch from production SQL is the `production` environment's
deployment-branch policy — a settings gate outside the 138 files, changeable in the UI without a
commit.

**Also recorded, from the compiler's own §0:** the relay between sessions is a live defect in the
working structure — this is the second stale ruling to reach me late (the first being the withdrawn
`702e5ce` framing, C-23, which I carried forward as my own finding). **Not my correction to make,
but it is the reason two of my last three returns contained an item that was already answered**, and
it belongs on the record beside the findings it produced.

---

## 4. `DRIFT_PER_FUNCTION_BUCKETS.tsv` — published to the project, by exact path

Delivered by path, not by search, per standing rule 9.

| | |
|---|---|
| **project path** | **`claude/SESSION1_DRIFT_PER_FUNCTION_BUCKETS_2026-08-30.tsv`** |
| **sha256** | **`951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da`** |
| size | **3,623 bytes**, 72 lines (71 data rows + header) |
| columns | `slug`, `702e5ce_strict`, `a42b209e_strict`, `702e5ce_imap_excluded`, `a42b209e_imap_excluded` |
| **join column** | **`a42b209e_strict`** — see §2 |
| also in the pack at | `15_F34_F35_DRIFT_RECON/DRIFT_PER_FUNCTION_BUCKETS.tsv` (same bytes, same hash) |

**Developer 2 should read that exact path and issue no search.** Verify the hash on arrival before
joining; I will verify theirs (`6588bca59d538b77cd2c104ff323902fcf16f45bd2051530e55bd4803a1756e3`,
5,850 B, 71 rows) the same way.
