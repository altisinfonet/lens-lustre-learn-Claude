# WORK ORDER WO-1 — read-only provider measurement
### Issued to: the executing session · Auditor: this session · Owner: Neil Basu · 2026-08-29

---

## 0 · Read this before anything else

**"Fully execute" is not available to you, and you must not attempt it.** Three separate reasons:

| Category | Why not | What you do instead |
|---|---|---|
| Post-merge actions (plan Part A) | PR #104 is unmerged, 0 tags exist, §11 unsigned — per `docs/PROMOTION_LEDGER.md` REV-16 | Nothing. Do not prepare production writes |
| Migration M2, G9 deploys | Marked **owner-only** in the ledger; B13 forbids function redeploy in this release | Nothing |
| 138-file review · independent test-suite run | You reported GitHub access is not enabled for your session | Record **BLOCKED** with that reason. Do not substitute |
| The runbook §5.3 probe | Owner-only, and must run **last**, immediately before promotion | Do not run it. Do not prepare its secrets |

**What IS available to you, and what nobody else can currently do: read-only provider
measurement.** You have Supabase access. The auditor session does not. Two of §25.7.2's four
workstreams are provider-measurable and have never been attempted. That is this work order.

### The one thing you must not misunderstand

**§25.4 closure rule: measurement by an owner or a compiler session is OWNER-ATTESTED and does
NOT close a §25 audit row.** Nothing you produce here closes blocker 9. You are producing
**evidence for the independent human auditor to validate**. If you write, or imply, that a row is
closed, that is a reportable fault.

---

## 1 · Standing prohibitions — these are absolute

- Do not expose secrets, tokens, cookies or credentials — not in chat, not in a file, not in a log.
- **No provider mutation of any kind.** No `apply_migration`, no `deploy_edge_function`, no
  `execute_sql` that is not a `SELECT`, no branch create/merge/reset/rebase, no pause/restore.
- No merge, no tag, no push, no deployment, no migration dispatch.
- **Do not modify `docs/PROMOTION_LEDGER.md`.** It is frozen under §28. If you find something that
  belongs in it, produce a diff and hand it to the owner. Do not commit.
- Do not run N1 as written — it places a production credential in a staging Environment.
- Do not modify the frozen RC `a42b209e4f70a6efed4f3dcdb654e0f994416594` to manufacture a result.
- Do not overwrite a previous conclusion. If earlier evidence said GREEN and you find it was not,
  preserve the original and record the correction separately.
- Before any action you believe is high-impact, verify the actual project ref, workflow and branch
  first, and say what you verified.

---

## 2 · Evidence discipline — every claim, every time

Every result is recorded as **Requirement → Instrument → Evidence → Result → Status**, with status
one of **VERIFIED · OWNER-ATTESTED · INFERRED · BLOCKED · N/A · DEFERRED**.
**Never silently convert one class into another.**

Three rules that exist because they were each broken during this release:

1. **Every figure carries its basis** (§3.5 rule 5) — the exact query or command, the project ref,
   and the UTC timestamp. A number without those three is not evidence.
2. **Every search declares its scope** (§3.5 rule 6) — what you searched, with which command, and
   what you did **not** search. A wrongly-scoped search returns a confident, clean, false answer.
3. **A negative control must produce a stated discriminating result.** "It errored" or "it timed
   out" means the control **did not run**. An unfilled check is BLOCKED, never a pass.

**Do not state a count you have not just measured.** Do not restate a figure from the ledger as
though you measured it, and do not restate a figure you measured as though the ledger says it.

---

## 3 · Tasks

### T1 · WS4 — deployed edge functions (§25.7.2 item 4, and G1.1 step 1)

The `21 MATCH / 21 header-only / 29 DRIFT / 0 UNKNOWN` split is **as of 2026-08-26 @ `702e5ce`
and is stale**. B13 condition 5 forbids acting on the old numbers. Use the WS4 harness,
**revision 8**, which is validated on Linux and Windows.

| Step | Requirement |
|---|---|
| T1.1 | **Discover `N`.** The ledger's 71 is a 2026-08-26 figure. **`N ≠ 71` is a FINDING, never a reason to discard the measurement.** Record how you counted it |
| T1.2 | Inventory from **parsed structured output**, never a human-readable table: slug, version, status, updated_at |
| T1.3 | **Capture AND HASH every deployed bundle** — B13 15a. A snapshot without hashes does not satisfy it. This is also G1.1 step 1, and nothing else in that workstream is safe until it exists |
| T1.4 | One fresh isolated workspace per function. Cross-function contamination is prevented by isolation, not cleanup |
| T1.5 | Classify each function **MATCH / HEADER-ONLY / DRIFT / UNKNOWN** using `07_ws4_reference_impl.py`. **UNKNOWN is never folded into MATCH.** Classified + unknown must sum to `N` |
| T1.6 | Per-function review of every DRIFT case, recorded individually — B13 15c |
| T1.7 | **Name the functions where production is AHEAD of the repository.** The 2026-08-26 measurement found three: `send-gift-credit`, `detect-ai-image`, `analyze-gallery-image`. Confirm or refute each **by measurement**, and report any others |
| T1.8 | Report the state of `_shared/imageDims.ts`: 2026-08-26 found it deployed in three different versions across three functions, none matching the repo |

**Run `bash 10_verify_pack.sh` before you trust the harness** (expect `PASS=30 FAIL=0`), then
`08_selftest.sh` (56/56) and `11_mutation_control.sh`. **If mutation control reports
`UNDETECTED` above 0, stop — no WS4 result derived from that suite may be relied on.**

### T2 · WS1 — the eight §25.3 infrastructure rows

Fill every row of `06_RESULTS_TEMPLATE.md` §R.1. Each row needs an **identity control** (which
project ref / account id you actually queried), a **completeness control**, and a **negative
control with a stated discriminating result**.

Two traps recorded during this release:

- Both Supabase projects return `postgres` from `current_database()`. It cannot discriminate the
  lanes. Use the **project ref** — production `jtdtehuqtinjxropkkcn`, staging
  `ztzutckwdhetphwghuzj`.
- `ad_creative_comments` on production returning **7** policies is the **expected pre-state**, not
  a defect: AF-17 records production as missing 2 RLS policies, and D-10 applies M2 post-merge to
  reach **9**. Record it with that citation, the schema-qualified table, the query and the UTC
  timestamp.

### T3 · Declare what you cannot do

Repo-dependent items — the 138-file review and the independent test-suite run — are **BLOCKED**
for you while GitHub access is disabled. Record them as BLOCKED with the reason and who can close
them. **Do not substitute a partial method and report it as the item.**

---

## 4 · Hand-back format

**Checksummed artefacts, not prose.** A paragraph cannot be verified; a manifest can.

1. `06_RESULTS_TEMPLATE.md`, filled. **A blank cell is BLOCKED.**
2. Raw exports: `inventory.tsv`, per-function manifests, per-row provider exports.
3. `MANIFEST.sha256` covering every file you produced, with byte sizes.
4. A transcript of every harness suite you ran, including its exit code.
5. A `BLOCKED.md` listing every item you could not perform, with the reason and who can close it.
6. A one-page summary that states, in its first line, that **nothing here closes a §25 row**.

---

## 5 · What the auditor session will check

Expect these, and pre-empt them:

- **Checksums first.** Every artefact re-hashed against your manifest. A mismatch voids the item.
- **Every figure re-read for its basis** — instrument, project ref, UTC timestamp. Missing any of
  the three is a fault.
- **Every negative control** read for a *stated discriminating result*, not merely for "ran".
- **`N` discovered, not assumed.** If your report says 71 without saying how you counted, fault.
- **Class conversion** — anything INFERRED or OWNER-ATTESTED that has drifted into VERIFIED.
- **BLOCKED items dressed as passes**, including empty cells left to look complete.
- **Ledger facts restated as measurements**, and measurements restated as ledger facts.
- **Arithmetic**, independently: classified + unknown must equal `N`; policy counts against AF-17;
  drift counts against your own per-function table.
- **Any claim that a §25 row is closed.** It is not, and cannot be, by you or by me.
