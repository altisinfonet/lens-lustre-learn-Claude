# §24.1 walked in order, step by step — and D-6 is resolved by measurement

Issued 2026-08-31 by the compiler/audit session. Owner's instruction: **follow the order, do not change it.** The order below is §24.1 verbatim, in sequence, with what is measured at each step.

---

## D-6 — RESOLVED. Not by a ruling; by the repository.

This was one of three decisions sitting with the owner. **It no longer is.**

```
git cat-file -t 9faf5a17                              → commit
git log --oneline -1 9faf5a17                         → Merge branch 'main' into staging
git rev-list --parents -n1 9faf5a17
   → 9faf5a17  fe4505aa  b671e1fb
git merge-base --is-ancestor 9faf5a17 origin/staging   → YES
git merge-base --is-ancestor 9faf5a17 a42b209e         → YES
```

**The merge exists, its parents are staging (`fe4505aa`) and `main` (`b671e1fb`), and it is an ancestor of both `origin/staging` and the release candidate itself.**

**D-6 is EXECUTED and LANDED, and it is already inside the candidate.**

Three consequences, and the third is the one that matters:

1. **§22's decision row — *"RULED · RESOLUTION PREPARED AND VERIFIED · COMMIT NOT LANDED"* — is STALE.** It was written at REV-5 and superseded at REV-6. The REV-6 changelog was right.
2. **§24.2 step 8 is already done.** *"Resolve the certificate conflict → staging's blue (D-6)"* is not a promotion-time action; the commit landed on 2026-08-29.
3. **Its warning does not apply.** Step 8 says *"This creates a commit; the merged tree will differ from T."* **No commit will be created at promotion time**, because it already exists in staging. The tag will be cut from a `staging` that already contains it, and §20 asserts tree equality **against the tag**. **The §20 concern I raised is withdrawn.**

**One owner decision closed, by measurement, without a ruling.**

---

## §24.1 — the pre-promotion sequence, in order

| # | Step, as written | Measured state |
|---|---|---|
| **1** | **D-9** — rule on AF-15 (red UI gate) | ✅ **RULED AND EXECUTED** — `bfcb68da` + `c8aec5d5`, CI-green |
| **2** | **D-8** — rule on AF-11 (ACAO) | ✅ **RULED** — accepted as `www` |
| **3** | **G8** — resolve | ✅ **WAIVED** — D-12, §23.3 |
| **4** | **Confirm a `staging` Environment exists with its own `SUPABASE_DB_URL`, or `apply-migration.yml target=staging` cannot run** | ❌ **CONFIRMATION FAILS.** Environment exists; **it holds zero secrets and zero variables** (measured 2026-08-30T13:50:48Z, re-confirmed from the Secrets tab 2026-08-31T05:06:44Z). The only environment secret in the repository is `SUPABASE_DB_URL` on **`production`** |
| **5** | Sign B8, B11, B12, B13, D-5 | ✅ **ALL RULED** |
| **6** | **runbook §5.3 secret-isolation probe** | ❌ **UN-RUN.** §5.3.6 requires it **immediately before** promotion; run early it goes stale and must be repeated |
| **6a** | **Re-confirm CI on the head that actually exists at that moment** | ❌ **UNOWNED.** A re-read, not a re-test. Must happen after the freeze point and before the tag |
| **7** | **§11 signed AND tagged, before the merge** | ❌ **UNSIGNED.** **0 tags** — confirmed on GitHub, `github.com/altisinfonet/lens-lustre-learn-Claude/tags` reads *"There aren't any releases here"*, as-of **2026-08-31T07:21:10Z**. Local `git tag` count: 0 |

Plus **§25**, which gates §11 — all eight rows captured, **none closed**.

**Steps 1, 2, 3 and 5 pass. Step 4 fails. Steps 6, 6a and 7 are open.**

---

## Step 4 — the order is followed, and one thing must be on the record before it is remedied

**Step 4 as written is a confirmation, not an instruction to create.** I have performed it. **It fails.** That is the correct output of following the order, and I have not reordered anything.

**How it is remedied is the owner's ruling.** Whichever way it goes, this belongs in the record first:

Today, dispatching `apply-migration.yml` with `target=staging` binds the `staging` environment, finds **no** `SUPABASE_DB_URL`, and the job's own first check exits 1 at line 122 — **sixty lines before the injection point at line 174.**

**Creating that secret removes the thing that is currently stopping it.** At the candidate, the workflow's `environment: ${{ inputs.target }}` is live, so a dispatch from the `staging` branch with `target=staging` would then reach line 174 **with the staging database URL in the job environment.**

**So the two remedies are not equivalent, and neither is wrong:**

- **Record it as inoperative** — the staging migration path does not exist for this release. Nothing new is opened. `apply-migration.yml target=staging` stays dead.
- **Provision the secret** — step 4 passes, and the staging dispatch path becomes live against a workflow whose injection is not yet fixed.

**If the secret is provisioned, the replacement RC should be adopted first.** That is not a change to §24.1's order — step 4 is a *confirmation* and I have run it in place. It is a statement about what the remedy does, which the owner is entitled to have before choosing it.

**And a value must be typed by the owner.** I will navigate to the exact field and verify the result afterwards. **I will not enter a credential into any field, and that does not change.**

---

## Where the pre-promotion sequence now stands

| Closed today, by measurement | |
|---|---|
| **D-6** | landed, in the candidate, §24.2 step 8 already done, §20 concern withdrawn |
| **§25.3 row 4** | token id `73a7920647481fd93553f9c1f68bf5a3` confirmed; one bucket scope, `50mm-staging`, no `50mm` |
| **0 tags** | confirmed on GitHub, timestamped |
| **WO-8 B1** | `worker.js` not in the 138; blob identical at both endpoints |

**Owner decisions remaining: two, not three.** Step 4's remedy, and adopting the replacement RC. Then §25's eight rows, the probe, the signature, the tag, the merge — in §24.1's order, unchanged.
