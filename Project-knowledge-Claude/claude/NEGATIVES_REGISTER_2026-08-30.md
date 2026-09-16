# The negatives register — every "zero", "none" and "absent" with its as-of time

Date: 2026-08-30 · **No new measurement was performed to build this.** Every row cites an artefact
that already exists in this pack and carries the stamp that artefact was written with.
**Nothing here closes a §25 row (§25.4).**

---

## 0. The rule this register applies, and the two clocks it needs

> **A negative is a statement about a moment.** "0 of 71" is not a property of the system; it is a
> property of a set of bytes at a time. Without its stamp it silently becomes a claim about *now*,
> and *now* keeps moving.

**Every deployed-side negative therefore needs two stamps, not one:**

| clock | what it is | value |
|---|---|---|
| **T-capture** | when the production bundles were pulled from the provider | **2026-08-30T03:15:11Z** |
| **T-read** | when the instrument read that capture | per row below |

**And a third fact bounds all of them:** the newest `updated_at` in the capture is
**2026-08-24T15:00:42Z**. So a deployed-side negative describes deployments **as they stood on
2026-08-30T03:15Z**, whose most recent change was six days earlier. **Any deployment after
2026-08-30T03:15:11Z is outside every deployed negative in this pack**, and no instrument here can
see it.

**Repository-side negatives take one stamp plus a commit sha** — the sha *is* the as-of, and it does
not move. Those are the durable ones.

---

## 1. Deployed-state negatives — T-capture `2026-08-30T03:15:11Z`, all of them

| # | The negative | T-read | Source in this pack |
|---|---|---|---|
| N-1 | **`assertStorageLane` appears in 0 of 71 deployed bundles** (C-14-L) | **2026-08-30T16:11:32Z** | `15_.../F34_guard_census.json` |
| N-2 | **0 of 71 deployed bundles satisfy G1, G2 or G3v** — identifier, call site, or a bundled `s3.ts` that calls the guard | **2026-08-30T16:11:32Z** | same |
| N-3 | **0 of the 4 deployed `_shared/s3.ts` variants contain the guard**, and `hard-delete-competition` bundles none at all | **2026-08-30T16:11:32Z** | same |
| N-4 | **0 additional md5 values for the deployed `_shared/secureHeaders.ts`** — exactly **1** distinct value, `58b9f45d5200a9b19f1b24011dfc3511`, across the 27 bundles that carry it | **2026-08-30T16:11:32Z** | `15_.../F35_secureHeaders_md5.json` |
| N-5 | **44 of 71 bundles carry no `_shared/secureHeaders.ts` at all** | **2026-08-30T16:11:32Z** | same |
| N-6 | **0 mechanism disagreements** between the original CORS census and the independent re-derivation, across all 71 | **2026-08-30T13:35:22Z** | `11_.../CORS_CENSUS_71_A11b_INDEPENDENT.json` |
| N-7 | **Symmetric difference EMPTY** between the 27 bundles carrying `secureHeaders.ts` and the 27 the CORS census calls `secureHeaders.ts (shared)` | **2026-08-30T16:11:32Z** | `15_.../F34_F35_DRIFT_RECONCILIATION.md` §F-35 |
| N-8 | **0 content differences** among the common files of `handle-email-suppression` and `handle-email-unsubscribe` — all four files byte-identical to the repo | **2026-08-30T17:06:57Z** | `20_.../F40_BOUND_TRANSCRIPT.txt` |
| N-9 | **0 records where `n_prod ≠ n_rc` and `classify()` nevertheless hashed** (set A \ B is empty) | **2026-08-30T17:06:57Z** | same |
| N-10 | **0 verdict changes** in either drift lane when the census was re-run through the repaired lexer | **2026-08-30T13:15:14Z** | `10_.../A9_A10_A12_TRANSCRIPT.txt` |

> **N-1 is the one to re-take first if any function is redeployed.** It is the best-evidenced finding
> in the engagement and it describes a production system with **no storage-lane guard anywhere** —
> and it is the negative most likely to be invalidated by a deploy, because a deploy is exactly what
> would fix it.

---

## 2. Repository negatives — the commit sha **is** the as-of

All against **`a42b209e4f70a6efed4f3dcdb654e0f994416594`** unless stated. These do not decay.

| # | The negative | T-read | Source |
|---|---|---|---|
| N-11 | **0 of the 61 functions not named in §23.5.1 risk 3 carry the guard in RC source**, on any of the four constructs | 2026-08-30T16:11:32Z | `15_.../F34_guard_census.json` |
| N-12 | **`cloudflare/seo-edge-injector/worker.js` is absent from the 138** — blob `160cd148ab02eb4bd722e877fdc7b904067e4169` identical at `b671e1fb` and `a42b209e`, so it changes zero times in the range | 2026-08-30T16:55:51Z | `16_.../WO8_B1_ANSWER_AND_JOIN_DECLARATION.md` |
| N-13 | **`worker.js` has 0 unescaped `JSON.stringify` sites** — its one occurrence is already `.replace(/</g, "\\u003c")`-escaped | 2026-08-30T16:55:51Z | same |
| N-14 | **`functions/_seo.ts` @ `a42b209e` has 0 `u003c` escapes** — the negative that makes it the defective file | 2026-08-30T16:55:51Z | same |
| N-15 | **`.github/workflows/verify-schema-dependencies.yml` does not exist on `main` (`b671e1fb`)** — status `A` in the range; this is the cause of the off-by-one | 2026-08-30T17:06:57Z | `20_.../F40_BOUND_AND_OFFBYONE.md` §2 |
| N-16 | **0 regressions** in the 107-file lexer sweep — no file that parsed under the old lexer fails under the repaired one | 2026-08-30T13:15:14Z | `10_.../A9_A10_A12_TRANSCRIPT.txt` |
| N-17 | **0 specifier-set changes** among files both lexers parsed; **0 phantom string spans containing `import` or `require`**; **0 header-complete fallbacks used** by the repaired lexer | 2026-08-30T13:15:14Z | same |
| N-18 | **`+0 / −0` closure path changes** on all four repaired slugs — the path sets are byte-identical before and after | 2026-08-30T13:15:14Z | same |

---

## 3. Workflow-trigger negatives — as-of the **branch**, not the clock

Against `rc-replacement/option2-2026-08-30` @ **`9384ba9aeef585f615148b208f13d68fdbe169f5`**, and
against `b671e1fb` / `a42b209e` where stated.

| # | The negative | T-read | Source |
|---|---|---|---|
| N-19 | **None of the 8 workflows on the branch fires on a push to it** — 8 of 8 enumerated, verdict computed from each `branches:` list | **2026-08-30T16:55:51Z** | `19_.../A3_FULL_RETURN_TRANSCRIPT.txt` §3b |
| N-20 | **`verify-schema-dependencies.yml` is not dispatchable today** — the file does not exist on `main`, and `workflow_dispatch` requires it on the default branch | **2026-08-30T15:43:40Z** | `14_.../A17_TRIGGER_TRANSCRIPT.txt` |
| N-21 | **`apply-migration.yml` has 0 `github.ref` / `head_ref` / `base_ref` guards and 0 `if:` conditions on its job**, at `b671e1fb` | **2026-08-30T15:43:40Z** | same |
| N-22 | **1 of 8 workflows at `main`, and 1 of 9 at the RC, references `secrets.ANDROID_*`** — i.e. **0 others do** | **2026-08-30T15:43:40Z** | same |

> **N-19 has a stated exclusion and it is not a quibble.** It is a **push** negative. Four of those
> eight carry `pull_request: branches: [main, staging]`, so **a PR from this branch fires four
> workflows.** The negative is true and narrow; the standing instruction rests on the exclusion.

---

## 4. Branch- and pack-state negatives — as-of `2026-08-30T17:35:17Z`, and the most perishable here

| # | The negative | as-of | Source |
|---|---|---|---|
| N-23 | **0 remote refs matching `rc-replacement/*`** — the branch is not pushed | **2026-08-30T17:35:17Z** | `19_.../A3_FULL_RETURN_TRANSCRIPT.txt` §3e, re-confirmed at rev15 build |
| N-24 | **0 tags at the branch head** | 2026-08-30T17:35:17Z | same |
| N-25 | **0 paths added, 0 deleted** by the three patches; **empty symmetric difference** between the RC's 138 paths and the branch's 138 | 2026-08-30T16:55:51Z | same, §3c |
| N-26 | **`origin/main` and `origin/staging` unmoved** — `b671e1fb0c5bcf145d442076c229eca888afd674` and `9ac4524d703035e6d2debd9e97ab9a0e73de3bc9` | 2026-08-30T17:35:17Z | same, §3e |
| N-27 | **RC worktree clean** — `git status --porcelain` returns 0 lines | 2026-08-30T17:35:17Z | `10_.../A9_A10_A12_TRANSCRIPT.txt` and every build since |
| N-28 | **Pack coverage: the only uncovered file is `MANIFEST.sha256`; 0 files in the manifest but not on disk; 0 checksum mismatches** | **rev16, 2026-08-30T17:35:17Z** | rev16 manifest header |

> **N-23, N-24, N-26 and N-27 are the shortest-lived negatives in this pack.** They describe *my
> container and the remote at a moment*, and any authorised push, tag or fetch invalidates them
> immediately. They should be re-taken by whoever next acts on the branch — **not carried forward
> from here.**

---

## 5. Relayed negatives — not mine, stamped as theirs

| # | The negative | Whose | Class |
|---|---|---|---|
| N-29 | **"no hybrids"** | **Developer 2**, in their frozen per-function output `SESSION2_PER_FUNCTION_VERDICTS.tsv`, `2026-08-30T16:22:20Z`, sha256 `6588bca5…1756e3` | **RELAYED.** I have not run their instrument and do not restate it as measured here |
| N-30 | **Repository secrets are exactly four `ANDROID_*`; `SUPABASE_DB_URL` is not among them** | **the compiler**, from the GitHub console | **OWNER-ATTESTED.** A17 item 2 depends on it |
| N-31 | **The four §25.3 rows cannot be closed from any session's tooling** | auditor + compiler + this session, each checking their own tool set | **VERIFIED on all three sides**, but the *closure* remains the auditor's |

---

## 6. What a reader must not do with this register

1. **Do not read a deployed negative as current.** Every one is as-of the capture at
   **2026-08-30T03:15:11Z**. If a function has been deployed since, N-1 through N-10 do not describe
   it, and nothing in this pack can tell you whether one has.
2. **Do not read N-19 as "nothing can fire."** It is a *push* negative with a stated PR exclusion.
3. **Do not carry N-23/N-24/N-26/N-27 forward.** They are container-and-remote state and expire on
   the next action.
4. **Do not treat a repository negative as fragile.** N-11 through N-18 are pinned to a commit sha
   and are as durable as the sha.
5. **A negative with no stamp in any earlier document is superseded by its row here.** Where an
   earlier document states one of these without a time, this register supplies it; where the two
   disagree, this register's stamp governs and the earlier wording stands beside it unedited.

---

**CLOSE STAMP — 2026-08-30T17:35:17Z.** Taken at the moment this register was sealed, so the four
perishable rows above carry a real time rather than an approximation:

```
HEAD (branch)                       9384ba9aeef585f615148b208f13d68fdbe169f5
origin/main                         b671e1fb0c5bcf145d442076c229eca888afd674
origin/staging                      9ac4524d703035e6d2debd9e97ab9a0e73de3bc9
remote refs matching rc-replacement/*   0
tags at head                            0
git status --porcelain                  0 lines
```

**Standing: nothing on the critical path is held here. No new measurement was started to produce
this register, and none is in progress. Stopping.**
