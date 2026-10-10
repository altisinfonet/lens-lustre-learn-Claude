# §25.3 row 1.5 — completion capture, correction C-19, and new finding F-29

Captured: 2026-08-30, compiler/audit session driving the owner's Chrome, read-only.
Companion to `claude/S25_3_CONSOLE_CAPTURES_ROWS_1_4_1_5_1_6B_1_6C_2026-08-30.md`. **That document is not edited.** Per the standing rule, the original wording is preserved and the correction is recorded here beside it.

Safety record: no secret value viewed or captured — names, scopes, dates and counts only. Nothing created, edited, saved or deleted.

---

## 1. The complete GitHub Actions credential inventory

Source: Settings → Secrets and variables → Actions (both tabs, scrolled to end).

**Environment secrets — 1**

| Name | Environment | Last updated |
|---|---|---|
| `SUPABASE_DB_URL` | `production` | Aug 23, 2026 |

**Repository secrets — 4**

| Name | Last updated |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Jul 24, 2026 |
| `ANDROID_KEYSTORE_PASSWORD` | Jul 24, 2026 |
| `ANDROID_KEY_ALIAS` | Jul 24, 2026 |
| `ANDROID_KEY_PASSWORD` | Jul 24, 2026 |

**Environment variables — 0.** **Repository variables — 0.**

That is the entire set. **Five secrets exist in GitHub Actions for this repository. Nothing else.**

---

## 2. CORRECTION C-19 — my finding 1.5-d was wrong

**Original wording, preserved:**

> "**Finding 1.5-d — staging holds no environment secrets, so environment-level lane isolation is partial.** `staging` has zero environment secrets and zero variables. Whatever credentials staging workflows use therefore come from **repository-level** secrets, which are not environment-scoped."

**Corrected:** the inference was wrong. The repository-level secrets are **four Android app-signing secrets and nothing else** — no Supabase credential, no Cloudflare credential, no R2 credential at repository level.

So staging workflows are **not** drawing service credentials from repository secrets, because no such repository secret exists. Where the staging lane gets its credentials is now an **open question**, not a settled one. Three candidates, none yet measured:

1. the staging lane deploys through Cloudflare's own Git integration rather than GitHub Actions, so it needs no Actions secret at all;
2. staging workflows reference secrets that do not exist and fail or silently skip;
3. credentials reach staging by some path outside GitHub Actions entirely.

**Status: INFERRED withdrawn → BLOCKED pending measurement.** This goes to Developer 1 as item A16 below.

**The error class, recorded:** I observed "staging has no environment secrets", and completed the sentence with a mechanism I had not looked at. The correct move was to open the repository-secrets page — one click away — before writing the conclusion. Same family as C-12 and C-18: **a plausible completion written in place of a measurement.**

---

## 3. Finding 1.5-a is STRENGTHENED, not weakened

The correction makes the central finding sharper.

`SUPABASE_DB_URL` in the `production` environment is **the only database credential anywhere in this repository's GitHub Actions configuration.** Not one repository secret, not one staging secret, not one variable.

Therefore:

- the entire GitHub-side reachable surface for a database credential is **one secret**;
- that secret is reachable **only** from the `production` environment;
- the `production` environment permits **only** the `main` branch;
- required reviewers **off**, wait timer **off**, administrator bypass **on**;
- the two injectable workflows are inside the 138 files awaiting promotion.

**One door, one key, no guard — and the merge is what puts the injectable code on the only branch that can open it.** Row 1.5 does not merely support the no-merge position; it is now the cleanest single statement of it in the whole evidence base.

---

## 4. NEW FINDING F-29 — the Android signing keystore is exposed to any branch, **today**

This is not a promotion finding. It is a live one.

GitHub's own text on that page: *"Anyone with collaborator access to this repository can use these secrets and variables for actions. They are not passed to workflows that are triggered by a pull request from a fork."*

**Repository** secrets — unlike environment secrets — are available to workflow runs on **any branch**, with no environment gate, no branch restriction and no reviewer. The four `ANDROID_*` secrets are repository secrets.

So if any workflow carrying the unescaped shell construct is triggerable on **any** branch as the repository stands today, then the Android **app-signing keystore and its password are reachable now** — no merge required. A signing key is not a recoverable credential: whoever holds it can publish a package that every installed device accepts as a genuine update.

**I have not established that the injectable workflows are triggerable on a non-`main` branch today.** That is the question, and it is urgent. It is also cheap to answer — it is a read of the two workflows' `on:` triggers and their lane-gate conditions.

**If the answer is yes, F-29 outranks the entire promotion question and should be handled before anything else in this engagement.**

---

## 5. Issued to Developer 1 — A16 and A17, ahead of the current queue

Standing constraints unchanged and in force. Read-only. No branch, commit, push, merge, tag, deploy, migration, ledger edit or secret read. **Report names and trigger conditions only; never a secret value.**

**A17 — URGENT, answer alone and first.**
For `apply-migration.yml` and `verify-schema-dependencies.yml`, and for every workflow containing the unescaped construct: quote the `on:` block verbatim, and quote every `if:` condition that gates the job containing the construct. Then state plainly: **as the repository stands today, can that job run on a branch other than `main`?** If yes, name the trigger and the branch. Do not paraphrase the conditions — quote them.

**A16.**
Determine how the staging lane obtains its credentials, given that the only repository secrets are the four `ANDROID_*` entries and the only environment secret is `SUPABASE_DB_URL` on `production`. Search the staging workflows for every `secrets.` and `vars.` reference and list the names they expect. Report which of those names exist and which do not. State whether the staging deploy runs through GitHub Actions at all.

**A18.**
List every workflow in the repository that references `secrets.ANDROID_`, with its `on:` triggers and branch conditions. This bounds F-29's exposure regardless of A17's answer.

---

## 6. Status of the four rows

| Row | State |
|---|---|
| 1.4 | Captured. Awaiting independent auditor closure. |
| 1.5 | **Captured and complete.** One correction (C-19) recorded. Awaiting independent auditor closure. |
| 1.6b | Captured — 0 and 0. Awaiting independent auditor closure. |
| 1.6c | Captured. Awaiting independent auditor closure. |

**None is closed.** §25.4 stands: compiler capture is OWNER-ATTESTED and cannot close a §25 row. All four go to the independent human auditor with the screenshots.

Nothing further is pending on the console-capture task. The remaining work on these rows is the auditor's, and A16/A17/A18 are repository reads for Developer 1.
