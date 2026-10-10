# WORKSTREAM 2 — INDEPENDENT REVIEW OF THE 138-FILE PROMOTION SCOPE

> **Execution provenance: the manifest `02a` was MEASURED and self-checked; the review itself is `NOT STARTED` (§0.11).**

**Manifest:** `02a_manifest_main..a42b209e.tsv` — complete, 138 rows, self-checked.
**Range:** `main b671e1fb…` → **application/code RC `a42b209e…`** (frozen).
**Status:** **NOT STARTED. No party has reviewed these files** — not the compiler, not any of the four
audit rounds.

> ## ⚠ CI SUCCESS IS NOT A SUBSTITUTE FOR REVIEW — and this repository has proved it
>
> - The **UI gate** passed a sweep in which the page never rendered (12 × `supabaseUrl is required`).
>   Caught only because someone read the output.
> - The **secret scan** named "full history" **does not scan full history** — it is range-restricted
>   (**AF-20**). An unrestricted scan returns 23 findings CI never sees.
> - The **isolation guard** could not see `supabase/functions/` **at all** until `b3b8c21e` (#94).
> - A guard once matched **its own comment** and passed vacuously.
>
> **CI provenance, precisely (§0.10):** 17 checks ran at `staging` head `9ac4524d` — **15 success, 2
> expected skipped, 0 failing** — and exercised the **same application code** as `a42b209e`, because
> every commit in between changes only `docs/PROMOTION_LEDGER.md`. **That is a fact about the checks,
> not about the code.**

## 2.1 · Group totals — reconciled

| Group | Files | Review priority | Why |
|---|---|---|---|
| **edge-functions** | **44** | 🔴 **1** | Not deployed by this merge, but they are the B13 subject and include `submit-judge-decision` and all ten storage-lane functions |
| **application** | **37** | 🔴 **2** | What members see. Includes the certificate PDF file resolved from a 6-hunk conflict (D-6) |
| **tests** | **21** | 🟠 3 | A weak or self-matching test is a false green — this repo has had one |
| **configuration** | **19** | 🔴 **2** | Lane isolation lives here; a wrong default reaches production silently |
| **workflows** | **8** | 🟠 3 | **All 8 changed.** They are the instruments every other gate depends on |
| **migrations** | **7** | 🔴 **1** | 2 forward + 5 rollback. Schema, and the only undo that exists |
| **documentation** | **2** | ⚪ 5 | `DECISIONS.md`, `PROMOTION_LEDGER.md` |
| | **138** | | |

## 2.2 · Per-group review questions — what a defect would look like here

**Do not tick boxes. For each group, answer the question.**

**edge-functions (44).** Which of the 44 change **behaviour** versus formatting? `_shared/s3.ts`
(+104/−1) and `_shared/secureHeaders.ts` (+108/−12) are the two largest and sit under every function
— **a defect there is systemic, not local.** `submit-judge-decision` (+40/−13) is the ACAO fix.
Ten functions gain a storage-lane guard: do all ten **fail closed**, or does any fall through?
⚠ **The STALE 2026-08-26 measurement found three functions in which production was ahead of
staging** (§23.5, measured against `702e5ce`). **That is a historical figure and must NOT be read as
current.** Its count, and whether it is still three, **must be re-measured** — workstream 4 §4.6. A
repository diff cannot establish it at all.

**application (37).** `PostCommentsSection.tsx` (+62/**−402**), `AdComments.tsx` (+104/**−307**),
`PostCard.tsx` (+57/−152) are **large net deletions** — behaviour moved into new files
(`CommentThread.tsx` +588, `PostActionRow.tsx` +248). **Confirm nothing was dropped in the move**;
this is the classic refactor loss. `generateCertificatePdf.ts` (+39/−7) is the **D-6 conflict
resolution** — verify the merged file compiles and that `TEXT_ACCENT` is defined (the `main` side
used `TEXT_MUTED`, undefined in the merged file). `src/lib/env.ts` (+68, new) centralises lane
config — **check it cannot resolve to a production value in a staging build.**

**configuration (19).** `verify-schema-dependencies.mjs` (+906) and `test-isolation-guard.mjs`
(+280/−3) are guards. **Ask of each: what input makes it fail?** If you cannot construct one, it is
not a guard. `public/_headers` (+8/−2) carries the **ACAO apex → `www` change (AF-11, D-8)** — a
production behaviour change delivered inside a de-hardcoding commit.

**workflows (8).** `web-build.yml` (+157/−13) and `apply-migration.yml` (+75/−5) are the largest.
For `apply-migration.yml`, verify the **four ordered gates** and confirm line ~77
(`environment: production`) is **live in the RC** — it is **commented out on `main`** and only closes
on promotion (G3). For `security.yml`, confirm **AF-20**: the "full history" scan is range-restricted.

**migrations (7).** `20260828082136` adds **2 RESTRICTIVE policies** — RESTRICTIVE is **AND-ed** and
can only remove access; confirm it cannot lock out a legitimate reader. **Applied on staging, NOT on
production.** Check each of the 5 rollback files actually reverses its forward migration, and note
that **rollback file 0 deliberately reopens both RLS gaps** (§17.2). **The whole set has never been
executed against a live database.**

**tests (21).** For the 11 new ones, ask: **would this fail if the fix were reverted?** Mutation-test
at least `SummaryTriggerTapTarget.test.ts`, `storageLane.test.ts` and `corsOriginAllowlist.test.ts`.
Confirm `SummaryTriggerTapTarget.test.ts` **strips comments before matching** — without that it
matches the quoted old code in its own header and passes vacuously.

## 2.3 · Recording

Per group: **files reviewed / total · findings (with file and line) · unresolved questions · reviewer
identity · UTC timestamp · class.** A group is not complete until every file in it is accounted for —
`no changes of substance` is an acceptable disposition, **silence is not.**
