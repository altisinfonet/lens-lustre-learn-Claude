# RESUME HERE — 2026-08-30

**Nothing in this file closes a §25 row.**

## Resume point

**WO-5 complete. Hand-over pack rev5 shipped** — **84 files, this page included**; the manifest
covers **83** (every file except the pack-root manifest itself), every checksum verifies, coverage
PASS on an independent walker.

> The count moved from the 78 of rev3, and every reason is recorded in `00_INDEX.md`: the two Linux
> transcripts were added after they were found already published; a coverage defect in my own
> manifest was fixed (it had excluded **every** file named `MANIFEST.sha256` from both the generator
> and the check, so the check passed by agreeing with itself — the WS4 revision-7 `find -maxdepth 3`
> fault again); a **20-byte empty** `HANDOVER_…FINAL.tar.gz` that rev4 had manifested was removed;
> and `facts_rev16.json` was added to `05_INSTRUMENTS/` so the owner's published guard manifest
> verifies 12/12 in place. **The release archive is built after this manifest, outside the pack, and
> is not a member of it.**

WO-1…WO-5 are done; all four §25.7.2 workstreams have been executed; the REV-17 correction set is
**prepared and NOT applied**.

**There is no workable item remaining.** Every open thread needs one of: **the Track R sixteen**,
**an independent auditor verdict**, or **a new RC**. A fresh session should not start work without
one of those three. Doing more only adds pages to a pack that already needs reviewing.

## Blocked items, and who closes each

| # | Item | Who can close it |
|---|---|---|
| 1 | **The Track R sixteen** — list never supplied; not in the project or any session | **Owner**, with author and per-item evidence class; then auditor |
| 2 | **§25.3 rows 1.4, 1.5, 1.6b, 1.6c** — R2 token policy, GitHub Environments, prefix searches | **Owner/auditor** with Cloudflare console and repo-settings access; not reachable from a read-only clone |
| 3 | **M8c on Windows** — `11_mutation_control.sh` returns `NO-OP-HERE=1` on Linux; **M8c has never executed anywhere it is a defect. BLOCKED, NOT COVERAGE** | **Independent auditor** on a Windows host |
| 4 | **B4 — symlink resolution** (`realpath` vs `abspath`) | **Unclosable by construction**; needs a different instrument |
| 5 | **PR #104 description currency** — GitHub API state, not repository content | **Owner**, in the PR UI |
| 6 | **LG-05-DEF-1 fix** — specified, not implemented | **Whoever installs ledger-guard**; it is a pre-install gate |

The ledger-guard v3 pack is **complete: 12 of 12 files verify** against its `MANIFEST.sha256`,
including both Linux transcripts — re-verified by measurement 2026-08-30. Do not go looking for
them. Windows figures in `BLOCKED_ITEMS_revision6.md` (B3) remain **AUDITOR-ATTESTED**, not
witnessed. **Track R is NOT STARTED.**

## Standing constraints — a fresh session inherits these verbatim

- **Read-only.** No commit, push, branch, PR, merge, tag, workflow dispatch, deploy, migration, or
  provider write of any kind.
- **The ledger is frozen under §28** at sha256
  `f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943`, 182,502 bytes. Do not modify it.
- **§25.4: no compiler session closes a §25 row.** Neither does the owner re-reading one — that is
  OWNER-ATTESTED, the class those rows already carry. Only an independent auditor can close them.
- **Never execute a pack file that has not hash-verified against `MANIFEST.sha256`.**
- Rank competing hypotheses by what the evidence already supports; verify scope claims before
  stating them; report deviations and stop rather than adjusting to reach an expected number.

## Three live safety facts that outlive this release

These are measurements, not release blockers, and they do **not** bear on whether PR #104 merges —
B13 condition 2 excludes all function deployment from this release.

1. **Shared modules deployed in production do not exist in the source tree.** `_shared/s3.ts` has
   **four** mutually-different deployed variants and **none** is the repo's copy; `_shared/imageDims.ts`
   has four, of which one matches. Cause DETERMINED: the repo holds one copy of each, so this is
   accumulated deployment drift, not per-function forks. **Two destructive-path functions are
   affected: `purge-s3-orphans` and `detect-orphan-files`** — both running storage-layer code that
   is nowhere in the tree.
2. **The frozen RC itself carries 38 wildcard-CORS functions.** Deploying `a42b209e` changes the
   CORS mechanism of **exactly one** function (`submit-judge-decision`). **"Promotion fixes CORS" is
   false as a general claim** — it reaches 1 of 39.
3. **`src/test/judging-invariants.test.ts` self-skips into a green summary.** It requires a live
   service-role client; without credentials it reports as "1 skipped" inside
   `Tests 2475 passed | 1 skipped`. **Wherever 2,475 passing tests is cited, one judging invariant
   is unverified.** Not fixed — that is code, and Track R is not started.

## Re-activation

This session resumes on **exactly one** of: the Track R sixteen arriving with author and per-item
evidence class; the independent auditor returning findings against the pack; or the owner
authorising a replacement RC. **Nothing else.**

Start at `00_INDEX.md`.
