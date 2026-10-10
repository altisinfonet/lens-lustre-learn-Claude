# REVISION 7 — WS4 HARNESS REPAIR · external evidence pack

**Scope of this revision, set by the owner:** repair the WS4 harness **only**, as an external
evidence pack, with executable tests and checksums. **No provider operations. No repository
change. No ledger change. No deviation drafted. No claim about files the compiler cannot read.**
Then **stop and hand it to the independent auditor.**

`main` is unchanged at `b671e1fb0c5bcf145d442076c229eca888afd674`. Nothing was installed,
committed, pushed, deployed, migrated or configured. No Supabase, Cloudflare or GitHub API call
was made by this revision.

---

## 7.0 · What was actually wrong, and how it was found

Revision 6 shipped **36 passing tests**. Passing is not discriminating. Revision 7 adds
`11_mutation_control.sh`, which breaks the implementation in named ways and requires the suite to
go **RED** for each one.

**On its first run, 6 of 11 mutations were UNDETECTED.** The suite was green against an
implementation that:

| Mutation | The defect the suite did not notice |
|---|---|
| M1 | `classify()` no longer treats a **path-set difference** as DRIFT |
| M3 | the manifest digest silently downgraded from **SHA-256 to MD5** |
| M7 | the **containment check disabled** — a dependency outside the function root is silently absorbed |
| M8 | **path canonicalisation removed** |
| M10 | **exact import-map keys ignored** (only prefix keys worked) |
| M11 | the manifest **no longer sorted** — two auditors, two incomparable outputs |

Each was a real hole. T5, for example, appeared to test "extra reachable file → DRIFT", but its
fixture also changed `index.ts`, so it passed through the *content* branch and never exercised the
*path-set* branch at all.

**Fifteen new assertions (T30–T37) were written to close them, each one after the mutation
escaped, not before.** The suite is now **51 assertions** and detects **12 of 12** mutations.

## 7.1 · Two mutants are provably EQUIVALENT — and the claim is tested in both directions

`norm()` and `closure()` canonicalise paths **redundantly**: remove either one alone and nothing
observable changes, because the other compensates. Calling that "equivalent" is exactly how a real
gap gets excused, so the pack does not simply assert it:

* `equivalent E1` / `E2` require the single removals to stay **GREEN** — if a test detected one,
  the equivalence claim would be **FALSE** and the run fails with `FALSE-EQUIV-CLAIMS`.
* `mutate2 M8` removes **both at once** and must be **DETECTED** (it is, by T36).
* `M8b` removes the canonicalisation in `resolve()`, where it is not redundant, and must be
  **DETECTED** (it is, by T37).

A first attempt at M8b substituted `os.path.abspath()`, which collapses `..` lexically — that was
a *third* equivalent mutant masquerading as a defect. It is recorded here because a mutation
control that quietly accepts non-defects is worthless.

## 7.2 · The authoritative `--rc-root` mode had never been executed

`09_rc_regression.sh --rc-root <checkout>` is the mode the auditor will actually use. Until
revision 7 **nobody had ever run it** — not once, in either direction.
`12_rc_root_mode_test.sh` now exercises it with **12 assertions**, including four negative
controls: a renamed dependency, a missing file, an unparseable file, and an empty root must each
**FAIL**, and restoring the file must make it pass again.

**What this does not prove:** the synthetic checkout is built from the shipped **shape fixtures**.
A green run proves the *mode* works. It says nothing about whether the recorded ground truth
matches the real RC files. That remains **B1**.

## 7.3 · "Exact RC fixtures" — generated, never fabricated

The compiler cannot read the real RC file bodies (no git access to the private repository; the
available read path is refused by a content filter). It therefore did **not** write them.

`13_make_rc_fixtures.sh` lets whoever holds the checkout produce them in one command:

```bash
bash 13_make_rc_fixtures.sh --rc-root /path/to/a42b209e/checkout --out fixtures/rc-exact
bash 09_rc_regression.sh    --rc-root fixtures/rc-exact
```

It writes `FIXTURE_PROVENANCE.txt` recording `git HEAD`, `HEAD^{tree}`, whether the worktree is
dirty, and per file the **git blob SHA-1**, **SHA-256** and byte size. If `HEAD` is not
`a42b209e4f70a6efed4f3dcdb654e0f994416594` it prints
`identity : *** MISMATCH — fixtures are NOT from the frozen RC ***` and refuses to describe the
output as RC fixtures. **A failure of the regression against exact fixtures is a real finding:**
it means the recorded ground truth diverges from the real files.

## 7.4 · Checksums

`10_verify_pack.sh` now also: runs `bash -n` on **every shipped `.sh`**, rejects **CRLF** in any of
them, verifies that `MANIFEST.sha256` **covers every pack file and no others**, and verifies every
checksum. A file added to the pack without being manifested now fails the verifier.

**A defect in that verifier, found and fixed in the same sitting:** the first draft walked the
pack with `find -maxdepth 3`, and the manifest was generated the same way — so the three files
under `fixtures/rc/supabase/…` (depth 5) were excluded from **both**, and the coverage check
passed by agreeing with itself. The walk is now full-depth and the manifest covers **23** files,
including the fixtures.

## 7.5 · Measured results, this host

| Suite | Result |
|---|---|
| `08_selftest.sh` | **51 / 51** |
| `09_rc_regression.sh` (fixture mode) | **8 / 8** |
| `10_verify_pack.sh` | **28 / 28** (run it first, after unpacking — it verifies the manifest, which is generated after the transcript) |
| `11_mutation_control.sh` | **DETECTED 12 · UNDETECTED 0 · EQUIVALENT 2 · FALSE-EQUIV-CLAIMS 0** |
| `12_rc_root_mode_test.sh` | **12 / 12** |

`EXECUTED` on Linux, this container. See `BLOCKED_ITEMS_revision6.md` B2 for the Windows gap,
which revision 7 does **not** close.

## 7.6 · Still BLOCKED — unchanged by this revision

| | |
|---|---|
| **B1** | authoritative `--rc-root` run against a real `a42b209e` checkout — the compiler has no git access. `13_make_rc_fixtures.sh` now makes it a two-command task for the auditor |
| **B2** | Git-for-Windows execution — no Windows host exists in this environment; nothing was simulated |
| **WS4 itself** | the 71-function re-measurement needs Supabase access and is an **authorized, separate** step. This revision performed **no provider operation** |

## 7.7 · Hand-over

The harness is ready for the independent auditor. It is external, executable, checksummed, and its
tests are now shown to discriminate. **It does not close any §25 row, and it does not make the
release ready.** The remaining §25.7.2 workstreams — the eight §25.3 rows, the 138-file review,
the independent test-suite run, and the deployed-function measurement — are the auditor's, and the
§5.3 probe is the owner's, last, with explicit authorization for the persistent GitHub records it
creates.
