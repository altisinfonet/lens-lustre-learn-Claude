# WO-14 EXECUTED — the replacement candidate is on `staging`. New RC identity, and everything re-measured.

Issued 2026-08-31 by the compiler/audit session, immediately after execution.

**This is the first state change this engagement has made to the repository.** Everything before it was read-only. It was made under the owner's explicit ruling of 2026-08-31 ("Use Claude Code"), against the specification pre-registered and published at **08:19:50Z, before the patch was written** (`PRE_REGISTERED_PATCH_SPEC_2026-08-31.md`, sha256 `691e0a4a…81e3`).

---

## 1. What happened, in order

| # | Action | Result |
|---|---|---|
| 1 | Pre-registered specification published | 08:19:50Z, before any patch file existed |
| 2 | Three patches written from source at `9ac4524d` | verified locally against P1–P8 |
| 3 | Commit 1 — the two workflows, **directly to `staging`**, no pull request | **`fb881eec164869f2a34968556702af5fc72dd467`** |
| 4 | Commit 2 — `functions/_seo.ts`, **directly to `staging`**, no pull request | **`5ca0d256a994fcab9e5beecfae8b8513d2799446`** |
| 5 | CI fired automatically on the new head | **All checks passed** |

### THE NEW RELEASE CANDIDATE

```
origin/staging  =  5ca0d256a994fcab9e5beecfae8b8513d2799446
```

**`RC-20260829-05` / `a42b209e` is superseded as the application candidate.** Every document naming `a42b209e` as "the candidate" now describes a superseded object and must either be corrected or carry an explicit as-of stamp. §3.1's layered identity must be re-stated for the new head. **Standing rule 10: the pack is the single source of truth, and a correction sweep republishes every affected copy in the same action.**

**Standing rule 11 does not fire.** No premise was withdrawn — a new object was created. Every measurement taken at `a42b209e` remains a true statement about `a42b209e`.

---

## 2. Every pre-registered property, re-measured ON THE PUSHED OBJECT

Not on my local copy. On what `origin` actually holds.

| ID | Property | Before | **Measured at `5ca0d256`** | |
|---|---|---|---|---|
| **P1** | `${{` inside any `run:` block of `apply-migration.yml` | 11 | **0** | ✔ |
| **P2** | `${{` inside any `run:` block of `verify-schema-dependencies.yml` | 5 | **0** | ✔ |
| **P3** | `_seo.ts` unicode-escapes the JSON-LD sink | absent | **present at lines 100–104, 150** | ✔ |
| **P4** | Files changed vs `a42b209e` | — | **exactly 3 + the ledger**, all `M`, 0 `A`, 0 `D` | ✔ |
| **P5** | Every validation survives | — | **all seven present, in order** | ✔ |
| **P6** | No trigger / permission / environment / secret change | — | **none** | ✔ |
| **P7** | `web-build.yml` untouched | — | **UNCHANGED** | ✔ |
| **P8** | Both workflows valid YAML, all steps preserved | — | **9 and 6 steps, every name intact** | ✔ |

### Byte-identity of what landed

| File | sha256 pushed | sha256 built locally | |
|---|---|---|---|
| `apply-migration.yml` | `e4b8f951bcd7d0d6521fe592c2214570a674d3ba8894965fb0f5fe3f7ce6ea0f` | identical | **BYTE-IDENTICAL** |
| `verify-schema-dependencies.yml` | `11126037ac4e18a70281ced1fab976b61db8541b5bc8bf1d79c1831a61a0921f` | identical | **BYTE-IDENTICAL** |
| `functions/_seo.ts` | `748178af57637dcabd7642af3b590a8d8ca94505e8d7cdb6638608af83b0e3c1` | identical | **BYTE-IDENTICAL** |

**The upload route was used precisely so that no character was retyped into a browser.** The last transcription of this same `_seo.ts` fix ate the escape. This one is a byte-for-byte copy of a file that was tested before it moved.

### P5 — the surviving controls, each with its line at the new head

`apply-migration.yml`: lane gate L127 · credential-present L148 · ref assertion L169 · confirm-match L203 · allowlist L211 · traversal refusal L216 · existence check L219 · `ON_ERROR_STOP=1` L255.
`verify-schema-dependencies.yml`: ref assertion L84 · project-ref expectations L86–87 · refusal L94 · **guard harness before the guard** L114.

**Nothing was removed, reordered, renamed or weakened.**

---

## 3. The fix, stated so a future reader does not "simplify" it back

**What was wrong:** GitHub substitutes `${{ … }}` into a `run:` script's **text** before any shell exists. An input containing an apostrophe closes its quote and the remainder executes — **above**, and therefore **before**, every check the step performs. The allowlist, the traversal refusal, the existence test and the confirm-match in `apply-migration.yml` all sit below the line that is already running attacker text. **They did not fail to catch a payload. They never ran.**

**Quoting was not the fix.** The quoting was already there. **The quoting is what made it exploitable.**

**What was done:** every dispatch input is now bound through the job's `env:` map and read as a shell variable. The runner sets it as a process environment variable; the script never contains it. **A shell variable's contents are never re-parsed as script.**

**Why the patch is wider than the exploitable set.** Six of the eleven interpolations were already safe — `inputs.target` is `type: choice` and cannot carry a payload. They were converted anyway. An invariant of *"no interpolation inside `run:`"* is checkable by anyone in one command. An invariant of *"none except the ones we decided were safe"* makes every future reader re-derive the safety argument for each exception, **and rule 4 says compression is where scope falls off.** A bright line survives handover; a reasoned exception does not.

**`_seo.ts`:** `esc()` is correct for the ten attribute sinks and **wrong** for this one — HTML-escaping a JSON document destroys it. `stripHtml` is not an escape at all. Unicode escaping satisfies both grammars: valid JSON that a conforming parser reads back unchanged, and inert in HTML because the parser never sees a `<`.

**Tested behaviourally before it was pushed**, with a payload carrying a closing `</script>`:

| | |
|---|---|
| raw `JSON.stringify` contains `</script>` | **true** — the defect is real |
| escaped output contains `</script>` | **false** |
| escaped output contains any `<` or `>` | **false** |
| still valid JSON | **true** |
| round-trips to the original value | **true** |
| no `&` survives, so no entity can be reconstructed | **true** |
| rendered page has exactly one `<script>` and one `</script>` | **true** |

---

## 4. §24.1 step 6a — SATISFIED, at the freeze head, and the two skipped checks are now NAMED

The push fired CI automatically. That run **is** step 6a — no separate dispatch was made.

**At `5ca0d256`: All checks have passed. 15 successful · 2 skipped · 0 failing. No conflicts with base branch. Ready to merge.**

| Check | on: push | on: pull_request |
|---|---|---|
| Typecheck | SUCCESS | SUCCESS |
| UI gate — *"Every control reachable, nothing regressed"* | SUCCESS | SUCCESS |
| Web build — *"The lane resolves to exactly one of main or staging"* | SUCCESS | SUCCESS |
| Web build — **Production lane build** | **SKIPPED** | SUCCESS |
| Web build — **Staging lane build** | SUCCESS | **SKIPPED** |
| Security — *"This project's own security rules"* | SUCCESS | SUCCESS |
| Security — **Secret scan (full history)** | SUCCESS | SUCCESS |
| Security — *"Dependency vulnerabilities (production only)"* | SUCCESS | SUCCESS |
| Cloudflare Pages staging deploy | **SUCCESS** at `5ca0d25` | — |

**The open item from tranche 4 is closed.** The two skipped checks are **the opposite lane in each event**: the `push` event runs on `staging`, so the production lane build is skipped; the `pull_request` event targets `main`, so the staging lane build is skipped. **That is correct lane-aware behaviour, not a coverage gap.** Between the two events, both lanes are built.

**Recorded because it deserves stating: the secret scan passed on full history at a head that adds a security patch, and the gate that caught AF-19 is the same one that just ran clean.**

---

## 5. Scope after the patch — re-measured, not derived

| | at `a42b209e` | **at `5ca0d256`** |
|---|---|---|
| Files vs `main` | 138 | **138** |
| Added / Modified / Deleted | 31 / 107 / 0 | **31 / 107 / 0** |
| Lines vs `main` | +9,060 / −1,293 | **+10,234 / −1,299** |
| Symmetric difference of the two file sets | — | **EMPTY** |

**The 138-file review survives intact.** The patch touched three files that were already inside it and added no path. **C-25 stands: a replacement candidate does not reset the review — that claim of mine was withdrawn and this measurement replaces it.**

**Rule 14 fired again, and it must be recorded.** The line totals do **not** compose from the patch's own `+85 / −17`. Measured against `main` the delta is `+75 / −6`, because `verify-schema-dependencies.yml` **does not exist on `main`** — it is an `A`, so its deletions never appear in a `main`-relative diff. **This is the second time in two days that naive line arithmetic would have produced a wrong number. The figures above are measured.**

---

## 6. What this closes, and what it does NOT

**CLOSED by this push:**

- The `apply-migration.yml` injection path — including its **production leg**, which was verified live at the provider earlier today (`production` holds `SUPABASE_DB_URL` and admits `main` only). **The merge no longer hands a repository-write actor a shell with the production database URL in the environment.**
- The same construct in `verify-schema-dependencies.yml`, a file that does not exist on `main` and that the merge would otherwise have created.
- The `_seo.ts` JSON-LD escape defect.
- **The exposure named in §25.3 Row 5.** Its acceptance is re-drafted separately — accepting a risk that has since been fixed would put a false statement in the ledger.

**NOT closed, and not touched:**

- **F-47** — `web-build.yml`'s `lane-guard` job carries the same construct. **LATENT**: its triggers admit only `main` and `staging`, it binds no environment, references no secret, and its token is `contents: read`. One trigger widening makes it live. **Post-promotion list, as ruled.**
- §25.3 rows 1, 2, 3, 4, 6a, 6b, 6c. **Eight written acceptances are still what closes §25**, and §11 cannot be signed while §25 is open.
- Everything on the post-promotion list: `ANDROID_*` secret scoping · F-36 · least-privilege on the 15 `verify_jwt=false` service-role functions · token TTL and IP restriction · `national-ids/` under public access · C-14-L · the seven functions carrying both header mechanisms.

---

## 7. THE LIMIT OF THIS ARTEFACT — and it must be quoted, not paraphrased

**I wrote this patch and I verified it. That is the same party twice, and it is weaker than this ledger's standard.**

§25.4 exists precisely to prevent it: *"No row below may be marked closed by the compiler. The compiler is not a second party."* Pre-registering the specification before writing the code removes my discretion after the fact — it does not manufacture a second party. **Nothing in section 2 above should be read as verification. It is the author checking his own work against a list he published in advance, which is better than nothing and is not an audit.**

**This is also NOT Developer 1's `9384ba9a`.** That object was never pushed; `origin` never held it. Every measurement recorded against it — including the `+36 / −7` figure — **is discarded, not inherited.** Rule 15: a hash of one's own output proves integrity, not provenance.

**Required: independent verification at `5ca0d256` by a party that did not write it.** The seven steps are listed in §5 of the pre-registered specification. A verifier who reports "matches expected" without printing the measurement has verified nothing.

---

## 8. Standing prohibitions — unchanged

**Performed:** two commits to `staging`, and reading the CI they fired.

**NOT performed, and still not authorised:** merging PR #104 · creating a tag · deploying any edge function · applying any migration to either lane · running the §5.3 probe · any production write · opening a pull request · force-push, rebase or history rewrite · touching `web-build.yml` · modifying the ledger · any change to any provider secret or setting.

**0 tags. `main` still `b671e1fb0c5bcf145d442076c229eca888afd674`, unmoved.**

---

## 9. What remains — five items

| # | Item | Who |
|---|---|---|
| 1 | **Independent verification of this patch at `5ca0d256`** | Developer 1 or 2 — whoever did not write it |
| 2 | **The eight §25 acceptances, signed** | **The owner.** §11 cannot be signed until §25 closes |
| 3 | `A15_CLAIMS_138.tsv` published, and Task 3's 51 `src/` rows — the last of §26 blocker 9 | Developers 1 and 2 |
| 4 | §24.1 **step 6** — the §5.3 secret-isolation probe, immediately pre-promotion | owner-directed |
| 5 | §24.1 **step 7** — §11 signed, then the tag, then the merge | the owner |

**One housekeeping item that belongs in the merge record:** PR #104's body still states *"+9,494 / −1,293 … the extra ~434 lines are the ledger"*, measured at `fe63e944`. It carries its as-of, so it is honest rather than wrong — but the body is part of the merge record and the true figures at the new head are **+10,234 / −1,299**, with the ledger contributing **+1,099**. It should be refreshed or stamped before the merge.
