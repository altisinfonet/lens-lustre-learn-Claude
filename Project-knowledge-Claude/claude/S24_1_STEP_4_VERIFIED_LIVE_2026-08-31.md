# §24.1 step 4 — VERIFIED LIVE from the browser by the audit session

Date: 2026-08-31. Read-only observation. **Nothing was created, edited or submitted by me.**

---

## The step, verbatim

> **§24.1 step 4** — *"**Confirm a `staging` Environment exists** with its own `SUPABASE_DB_URL` (§7.1), or `apply-migration.yml target=staging` **cannot run**."*

This confirmation **failed** every time it was measured before today:

| Measurement | Result |
|---|---|
| 2026-08-30T13:50:48Z | staging environment: **no secrets, no variables** |
| 2026-08-31T05:06:13Z | re-confirmed: *"This environment has no secrets."* |
| 2026-08-31T05:06:44Z | Actions Secrets tab: only `SUPABASE_DB_URL` on **`production`**, plus four `ANDROID_*` repository secrets |

---

## Measured now, by me, in the live dashboard

**Observed at 2026-08-31T07:40:40Z**, `github.com/altisinfonet/lens-lustre-learn-Claude/settings/environments/20410299078/edit`:

```
Environment secrets
  Name                Last updated
  SUPABASE_DB_URL     5 minutes ago

Environment variables
  This environment has no variables.
```

**§24.1 step 4: PASS.** The `staging` environment exists **and carries its own `SUPABASE_DB_URL`**.

### Provenance, stated exactly

The secret was created by **the owner**, at his own keyboard, on 2026-08-31 at approximately 07:35Z. **I did not create it, and I did not enter any value** — the safety guard refused every keystroke into the secret dialog, four times, and I did not attempt to work around it.

**What is mine is the verification**, made with my own instrument on the live page rather than from the owner's screenshot. **Classification: OWNER-ATTESTED** — §25.4 makes a compiler observation owner-attested regardless of who took it, so this does not and cannot close a §25 row. It records that the prerequisite is met.

**The value was never displayed, requested, or seen.** GitHub does not redisplay a secret after creation. The Supabase tab holding the connection string was left untouched — not navigated, not screenshotted, not read.

---

## What this changes, and it is not small

`apply-migration.yml target=staging` is now **operable**.

Today, a dispatch with `target=staging` binds the `staging` environment, the secret resolves, and the job passes its own `if [ -z "$DB_URL" ]` check at line 122 — **the check that has been stopping it all along** — and proceeds to line 174, where the free-text `inputs.migration` is interpolated into shell **before any of the step's own validation runs**.

**The staging dispatch path is now live against a workflow whose injection is unfixed.**

This trade-off was put to the owner before the change and he took it deliberately. **Recorded, not re-argued.**

**It closes when the replacement RC is adopted.** That decision was material yesterday; it is more so now, and it is the highest-value remaining item on the pre-promotion list.

---

## §24.1 as it now stands

| # | Step | State |
|---|---|---|
| 1 | D-9 / AF-15 | ✅ ruled and executed |
| 2 | D-8 / AF-11 | ✅ ruled |
| 3 | G8 | ✅ waived (D-12) |
| **4** | **staging env with its own `SUPABASE_DB_URL`** | ✅ **PASS — verified live 07:40:40Z** |
| 5 | B8, B11, B12, B13, D-5 | ✅ all ruled |
| 6 | runbook §5.3 secret-isolation probe | ❌ **un-run** — must be immediately pre-promotion |
| 6a | re-confirm CI on the head at the freeze point | ❌ **unowned** |
| 7 | §11 signed **and** tagged, before the merge | ❌ **unsigned · 0 tags** (verified 07:21:10Z) |

**Five of eight pass. Three open.** Plus §25 — **all eight rows captured, none closed**, and closable only by the owner's written acceptance under §25.7.3.

**D-6 is closed** by measurement: `9faf5a17` is an ancestor of both `origin/staging` and the candidate, so §24.2 step 8 is already done and creates no promotion-time commit.

**Owner decisions remaining: one.** Adopt the replacement RC, or decline it.
