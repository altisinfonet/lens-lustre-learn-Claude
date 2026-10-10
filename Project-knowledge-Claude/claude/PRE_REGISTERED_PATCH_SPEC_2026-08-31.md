# PRE-REGISTERED PATCH SPECIFICATION — written BEFORE the patch exists

Issued 2026-08-31 by the compiler/audit session, **before** any patch file was written.

**Why this document exists.** The owner has ruled that I write and push the three fixes. That makes me the **author** and the **auditor** of the same code, which is precisely the structural weakness §25.4 exists to prevent. There is no way to make that separation reappear by wishing for it. What can be done is to remove my discretion after the fact: **the properties the patch must satisfy are fixed here, in advance, and a verifier checks the pushed object against this document rather than against whatever I happened to produce.**

**This document must be published before the patch is written. It is not to be edited afterwards.** If the patch cannot satisfy a property below, the property is not relaxed — the failure is reported.

---

## 0. Provenance, stated plainly

This is **NOT** Developer 1's branch `rc-replacement/option2-2026-08-30` at `9384ba9aeef585f615148b208f13d68fdbe169f5`.

That object is unreachable — it lives in Developer 1's local clone, was never pushed, and `origin` carries only `main`, `staging` and `altisinfonet-patch-35` (verified today).

**Therefore every measurement recorded against `9384ba9a` is discarded, not inherited.** Standing rule 15: a hash of one's own output proves integrity, not provenance. Standing rule 8: a patch never shown to apply is not a patch. The object being pushed is a **new** patch, authored by me from source at `9ac4524d703035e6d2debd9e97ab9a0e73de3bc9`, and it must be measured from zero.

The line delta `+36 / −7` recorded for `9384ba9a` **does not apply** to this patch and must not be quoted for it.

---

## 1. Scope — pre-registered

**Exactly three files change. No file is added. No file is deleted.**

| # | Path |
|---|---|
| 1 | `.github/workflows/apply-migration.yml` |
| 2 | `.github/workflows/verify-schema-dependencies.yml` |
| 3 | `functions/_seo.ts` |

All three are already inside the reviewed 138. **P4: `git diff --name-status a42b209e <new head>` must return exactly these three as `M`, plus `M docs/PROMOTION_LEDGER.md`, and nothing else.**

---

## 2. The invariant the patch must establish — this is the whole point

The defect is not "a string was not escaped." It is that **GitHub Actions substitutes `${{ … }}` into the script text before any shell exists**, so a value containing an apostrophe closes the quote and the remainder executes — above, and therefore before, every validation the step performs.

Quoting cannot fix that. **The interpolation must leave the script body entirely.** The fix is to pass each value through the job's `env:` map, where GitHub sets it as a process environment variable, and to read it in the script as an ordinary shell variable. A shell variable's contents are never re-parsed as script.

That yields an invariant a verifier can check with one command, with no judgement required:

> **P1 — `.github/workflows/apply-migration.yml` must contain ZERO occurrences of `${{` on any line inside any `run:` block.**
> Measured before the patch: **11** (lines 104, 105, 144, 147, 159, 162, 174, 175, 207, 231, 235).

> **P2 — `.github/workflows/verify-schema-dependencies.yml` must contain ZERO occurrences of `${{` on any line inside any `run:` block.**
> Measured before the patch: **5** (lines 75, 81, 85, 88, 108).

**Note the scope of P1 and P2 deliberately exceeds the exploitable set.** Six of the eleven in `apply-migration.yml` interpolate `inputs.target`, which is `type: choice` and cannot carry a payload; `github.ref_name` is likewise constrained. Those are **not** exposures today.

They are converted anyway, and the reason is a standing rule rather than thoroughness for its own sake: an invariant stated as *"no interpolation inside `run:`"* is checkable by anyone in one command. An invariant stated as *"no interpolation inside `run:` except the ones we decided were safe"* requires every future reader to re-derive the safety argument for each exception, and **rule 4 says compression is where scope falls off.** A bright line survives handover; a reasoned exception does not.

> **P3 — `functions/_seo.ts` must unicode-escape the JSON-LD payload.**
> The serialised output of `JSON.stringify(meta.jsonLd)` must have `<` replaced by `<`, `>` by `>`, and `&` by `&`, **before** it is placed between `<script type="application/ld+json">` and `</script>`.
>
> **`esc()` MUST NOT be applied to it.** HTML-escaping a JSON document produces `&quot;` inside the JSON and destroys it. Unicode escapes remain valid JSON — a conforming parser reads `<` as `<` — and are inert in HTML, because the HTML parser never sees a `<`.
>
> The literal character sequence `<` must be present in the file. **A verifier must confirm this by reading the file, not by reading any report of it** — the last transcription of this exact fix ate the escape, writing `.replace(/</g, "<")` where the escape belonged. Standing rule 12.

---

## 3. What the patch must NOT do — pre-registered

> **P5 — No validation is removed, weakened, reordered or renamed in substance.** After the patch, `apply-migration.yml` must still perform, in this order: the lane gate (branch must match target), the credential-present check, the ref assertion (the credential must point at the target project), the confirm-match, the `supabase/migrations/*.sql | supabase/rollback/*.sql` allowlist, the `..` traversal refusal, and the file-existence check. `verify-schema-dependencies.yml` must still perform its ref assertion and still run its guard harness before the guard.

> **P6 — No behavioural change beyond the interpolation fix and the JSON-LD escape.** No trigger is added or widened. No `permissions:` block is changed. No `environment:` line is added, removed, or altered. No secret name changes. No new dependency, action or step is introduced.

> **P7 — `web-build.yml` is NOT touched.** F-47 is LATENT — its `lane-guard` job interpolates `github.base_ref` and `github.ref_name`, but the workflow's triggers admit only `main` and `staging`, it binds no environment, references no secret, and its token is `contents: read`. It stays on the post-promotion list. **Widening the patch set now would re-open the review scope, and that is exactly the trade this specification exists to prevent.**

> **P8 — Both workflow files must remain valid YAML**, and the resulting document must preserve every job, step and step name that exists today.

---

## 4. How this must be pushed — pre-registered

- **Committed directly to `staging`.** `staging` is the candidate branch; its head becomes the new RC.
- **NO pull request is opened.** Four workflows carry `pull_request: branches: [main, staging]`; a new PR would fire them on a head that is not the candidate and place a second open PR against `main` alongside #104.
- **No force-push, no rebase, no history rewrite.**
- Pushing to `staging` **updates PR #104** and fires those four workflows automatically. **That run is §24.1 step 6a's CI re-read at the freeze head.** No separate dispatch.
- `verify-schema-dependencies.yml` is `workflow_dispatch`-only and **will not fire** on the push. Its patch is therefore **not** exercised by CI and must be checked by reading, not by a green tick.

---

## 5. What a verifier must do, and it must not be me

**This is the part that carries the audit weight.** Developer 1 or Developer 2 — whoever did not author this — must, at the pushed head:

1. Re-measure P1 and P2 with their own command and report the two counts. **Expected: 0 and 0.**
2. Read `functions/_seo.ts` and confirm the literal `<` is present and that `esc()` is not applied to the JSON — **character for character, from the file.**
3. Re-measure P4: the file list against `a42b209e`.
4. Confirm P5 by naming each surviving control and the line it is on.
5. Confirm P7 by showing `web-build.yml` is unchanged.
6. Report the four CI conclusions, and **name the two checks that show as skipped** — they are unnamed in the current summary and §24.1 step 6a says read conclusions, not tick colours.
7. Re-measure the full scope: `git diff --name-status b671e1fb <new head>` and `--shortstat`. **Expected 138 files, 31 A, 107 M.** The line totals will move and **must be measured, not derived** — rule 14, and `docs/PROMOTION_LEDGER.md` is an `A` relative to `main`, which is the only reason the arithmetic composed last time.

**A verifier who reports "matches expected" without printing the measurement has not verified anything.** Print the numbers.

---

## 6. Standing

**This specification closes nothing and authorises nothing beyond the push the owner has ruled.** No merge, no tag, no deployment, no migration, no production write, no pull request, no change to `web-build.yml`, no touch to any provider secret.

**And the honest limit, recorded here rather than left to be discovered:** a patch written and pushed by the same party that audits it is a weaker artefact than one written by a developer and audited by a second party, no matter how carefully this document constrains it. The owner chose speed over that separation with the trade explained to him. **The ledger must record it that way, and this paragraph is the sentence it should quote.**
