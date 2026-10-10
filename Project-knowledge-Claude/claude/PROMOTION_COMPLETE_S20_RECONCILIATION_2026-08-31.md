# PROMOTION COMPLETE — §20 RECONCILIATION

Issued 2026-08-31 by the compiler/audit session, immediately after the merge. **Every figure below was measured from `origin` after the fact, not predicted.**

---

## 1. THE PROMOTION LANDED, AND THE ASSERTION PASSES

```
main   b671e1fb0c5bcf145d442076c229eca888afd674   →   789d45541c8d24c13d7fd4ad74bd7967df42e447
```

### §24.2 step 10 — tree equality against **the tag**, not against a SHA quoted in the ledger

| | |
|---|---|
| `main^{tree}` after the merge | **`693e9d3ce2cbbce1e86be8dc84cbbb7b8a61ee8e`** |
| `RC-20260831-01^{tree}` | **`693e9d3ce2cbbce1e86be8dc84cbbb7b8a61ee8e`** |
| Result | **IDENTICAL ✔** |

**What was tagged is exactly what is on `main`.** This is the assertion §20 exists to make, and it holds.

**Parent check:** the new commit's parent is **`b671e1fb0c5bcf145d442076c229eca888afd674`** — the exact `main` recorded throughout this engagement. Nothing moved underneath the promotion while it was in flight.

### Scope, measured on `main` after the merge

```
138 files changed · 31 A · 107 M · 0 D · +10,357 / −1,299
```

**Identical to what was reviewed, member for member.** The 138-file review describes what is now in production.


### Independently confirmed by a second party

A separate Claude Code session, run by the owner in his own browser with its own tooling and no access to my measurements, was asked only to verify. **It made no changes and reported:**

| | |
|---|---|
| Merged at | **2026-08-31T11:48:13Z by `altisinfonet`**, squash |
| `main` SHA | `789d45541c8d24c13d7fd4ad74bd7967df42e447` |
| `main^{tree}` | `693e9d3ce2cbbce1e86be8dc84cbbb7b8a61ee8e` |
| Expected (tag tree) | `693e9d3ce2cbbce1e86be8dc84cbbb7b8a61ee8e` |
| Match | **YES — identical** |
| `git diff origin/main RC-20260831-01` | **EMPTY** |
| Parents of `789d4554` | **exactly one** (`b671e1f`) — squash confirmed, linear-history rule satisfied |

**Re-measured by me after reading their report, not before:** the diff between `main` and the tag is **0 lines**, and `main` has **one parent**. Both agree.

**This is the only genuinely independent verification in the whole engagement** — a party that did not perform the action, did not write the tooling, and had no expected value to anchor on, reaching the same 40-character hash. Everything else this session verified was verified by whoever also did the work.

---

## 2. THE SECURITY FIXES ARE ON `main` — verified there, not inherited

| Check, run against `789d4554` | Result |
|---|---|
| `${{` inside any `run:` block of `apply-migration.yml` | **0** ✔ |
| `${{` inside any `run:` block of `verify-schema-dependencies.yml` | **0** ✔ |
| `escapeJsonLd` present in `functions/_seo.ts` | **yes** ✔ |
| The `<` escape present | **yes** ✔ |

**The production leg is closed.** Before today, merging would have put a live `environment:` line on `main` beside a workflow that interpolated free-text input into shell **above its own validation**, with the `production` environment holding `SUPABASE_DB_URL` and admitting `main` only, with no required reviewer and no wait timer. **That path is gone, and it is gone on the branch where it mattered.**

---

## 3. THE SQUASH — what was lost, recorded because it will be discovered later

`main` carries a **linear-history ruleset** (`protect-main`, Active), so a merge commit was forbidden. **Rebase was refused** — *"This branch cannot be rebased due to conflicts"*, verified twice on a clean reload — because `staging` contains merge commit **`9faf5a17`**, the D-6 certificate-conflict resolution, which a rebase replays away. **Squash was the only method available.**

**Consequences, stated plainly:**

- The **52 original commits are not in `main`'s history**. `main` gained one commit.
- **`git log origin/main..origin/staging` is no longer reproducible** — §5.4's commit manifest loses its instrument.
- **`staging` will read as ahead of `main` indefinitely** until it is reset onto the new `main`. The next promotion will show every file as changed again unless that is done.

**What was preserved, and it is not nothing:** the squash commit message is **70,187 characters** and carries the identity block plus **all 52 original commit messages verbatim** (78 bullet lines). The history is legible in the message even though the commits are gone.

**The audit conclusion is unaffected.** §20 asserts tree equality against the tag, and the tag holds the exact pre-merge tree. Squashing changed the shape of the history, not what was promoted.

### 🔴 F-50 — the ruleset is incompatible with this repository's own promotion model

`protect-main` requires linear history. **§24.2 step 8 anticipates a promotion-time merge commit, and D-6 legitimately created one.** So the rule forbids the method the ledger's own procedure assumes, and forces either a lossy squash or a rebase that discards a recorded conflict resolution.

**This will block the next promotion identically.** It should be resolved deliberately — either drop the linear-history requirement, or change the promotion model so `staging` never carries a merge commit. **Not urgent, and not optional either.**

---

## 4. 🔴 THE MOST URGENT THING IS NOT DONE BY THIS MERGE

**Apply `20260828082136_ad_comment_ban_and_visibility_policies.sql` to production. Now.**

`apply-migration.yml` · `target=production` · dispatched **from `main`** · the file exists there as of this merge.

**Until it runs, in production:**
- a **banned user can comment on ads**;
- **ad comments are readable regardless of whether the parent creative is visible.**

**Verify after:** `pg_policies` on `ad_creative_comments` returns **9 rows** (production held 7; the migration adds exactly 2, both RESTRICTIVE).

**And note what has changed for the better:** that dispatch now runs through a workflow whose injection path was closed this morning. This time last night, the same dispatch would have executed free-text input as shell with the production database URL already in the job environment.

---

## 5. Still true after the merge — do not let a green promotion suggest otherwise

- **No edge function was deployed.** `submit-judge-decision` v23 still answers `Access-Control-Allow-Origin: *` to any origin in production, and **50 of 71 deployed bundles still differ from the candidate.** G9 excluded under §23.5.1 condition 2. Deploying them is bound by B13's four preconditions **15a–15d**, including the prohibition on a blanket staging→production deploy.
- **§25's eight rows are closed by owner acceptance, not verification.** None was verified by a second party.
- **G6 is AMBER.** The production Cloudflare Pages variable `ISOLATION_FORBIDDEN_REFS` has never been read by anyone.
- **F-47 is now on `main`** — `web-build.yml`'s `lane-guard` carries the same construct patched elsewhere. LATENT under the configured triggers; one trigger widening makes it live.
- **§26 blocker 9 closed by acceptance with its gap named:** 95 of 138 per-file claim rows were never published, so the 138-file review is not independently checkable.
- **The security patch's author and its first checker were the same party**, mitigated by a pre-registered specification and Developer 1's independent re-measurement.

---

## 6. Post-promotion list, in order

| # | Action |
|---|---|
| **1** | 🔴 **Apply `20260828082136` to production** — §4 above |
| 2 | Verify the production build and deployment (§24.2 step 11) |
| 3 | Reset `staging` onto the new `main`, or the next promotion re-reads all 138 files as changed |
| 4 | **F-50** — resolve the linear-history rule vs the promotion model |
| 5 | N2 cross-lane test — **N2 only; never N1 as written** |
| 6 | §18 regression suite |
| 7 | G9 edge-function deployment under B13 15a–15d |
| 8 | F-47 · F-36 · `ANDROID_*` secret scoping · least-privilege on the 15 `verify_jwt=false` service-role functions · R2 token TTL and IP restriction · `national-ids/` under public bucket access · C-14-L · the seven functions carrying both header mechanisms |
| 9 | Ledger: §20 reconciliation, §21 events, F-50, and the ledger→project traceability gap. **The §28 freeze lifts now that promotion is done** |
| 10 | ⚠ **The GitHub bill is overdue, due 2026-08-31.** If Actions minutes lapse, every gate in this ledger stops running. Not a code issue and not mine to act on |

---

## 7. What this session did, complete and final

| | |
|---|---|
| `fb881eec` | two workflows — injection path closed |
| `5ca0d256` | `functions/_seo.ts` — JSON-LD escape |
| `4bfcc4b6` | ledger REV-17 |
| `9c556b8e` | probe branch — created, run, **deleted**, cleanup proved |
| `RC-20260831-01` | the release tag, against the freeze head |
| `789d4554` | **the promotion** |

**One commit to `staging` was stopped before it happened** — the owner's dialog was set to *"Commit directly to the `staging` branch"* while uploading the probe. Catching that mattered more than anything else done today: it would have moved the release candidate **and** inverted the probe's meaning.

**Two corrections were issued against my own work** — C-30 (F-49 withdrawn; I asserted an absence having searched only the repository) and C-31 (a remote-branch claim made from `git branch -r`). Both found by me, both before they reached a decision. **Standing rules 16 and 17 exist because of them.**

**Zero unauthorised actions.** No branch protection was touched, no secret was read or written, no migration was run, no function deployed, no payment made.
