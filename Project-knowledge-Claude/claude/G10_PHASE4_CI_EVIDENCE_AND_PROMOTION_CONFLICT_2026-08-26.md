# G10 PHASE 4 — CI EVIDENCE ON T · THE PROMOTION CONFLICT · WHY 4.3 IS UNAVOIDABLE

**2026-08-26, after the Phase 2 merge. Candidate tree T = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`.**
Read-only except the already-recorded Phase 2 merge.

---

# 1 — 🔴 THE PROMOTION MERGE CONFLICTS. FOUND NOW, NOT AT PROMOTION.

A local dry-run of the Phase 8 promotion (`staging` → `main`) **fails to merge automatically**:

```
CONFLICT (content): Merge conflict in src/lib/generateCertificatePdf.ts
```

- **One file. Six conflict hunks.** The promotion touches 123 files in total; only this one conflicts.
- Both lanes rewrote the same regions since the merge base `32930e75`:
  `main` +411/−126, `staging` +444/−127.

**This would otherwise have surfaced during Phase 8 — under freeze, after an approval was signed.
That is the worst possible moment to discover it.**

## It is textual, not semantic — staging supersedes main

Measured rather than assumed: of the **299 lines `main` added** to that file since the merge base,
**298 are already present in `staging`**. Directly compared, the two versions differ by only
**+39 / −7**.

The single line `main` has that `staging` lacks is `d.setTextColor(...TEXT_MUTED);` — appearing twice
in `main`, zero times in `staging`. **It is not a regression.** Staging's own source documents the
removal at line 401: *"`TEXT_MUTED` is gone rather than left unused: an orphaned [constant]…"* — the
file was redesigned onto a new palette (`TEXT_DARK`, `TEXT_ACCENT`, `TEXT_SUBTLE`, `GOLD`).

**Staging's version is the intended, newer one.**

## The resolution is deterministic and preserves the C2 chain — verified

Resolving by taking staging's version of that one file and completing the merge locally:

```
conflicts remaining : 0
resolved blob       : b19b06f24c8d76fa12263f2ed39b647db29d96e7
staging's blob      : b19b06f24c8d76fa12263f2ed39b647db29d96e7   (identical)

tree after promotion: e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
candidate tree T    : e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
>>> EQUAL — C2 link 4 holds
```

**Two consequences worth stating plainly:**

1. **C2 link 4 survives.** `main`'s tree after promotion equals T exactly, so the runbook's tree-equality
   assertion at step 8.7 is achievable despite the conflict.
2. **`main` carries nothing the candidate lacks.** If it did, the trees could not be equal. Everything
   in PR #101's production certificate work is already represented in the candidate.

**Recorded resolution for Phase 8:** resolve `src/lib/generateCertificatePdf.ts` by taking the
candidate's (staging's) version — `git checkout --theirs` — and assert the resulting tree equals T
before committing. **This must be stated in the RC record so the resolution is pre-agreed, not
improvised under freeze.**

---

# 2 — CI EVIDENCE ON T: WHAT THE MERGE ACTUALLY PRODUCED

The Phase 2 push triggered four workflows on `staging` @ `b8535fe` (tree T):

| Workflow | Run | Duration | Result |
|---|---|---|---|
| Security | #683 | 36s | Success |
| Typecheck | #1195 | 1m 07s | Success |
| UI gate | #115 | 7m 19s | Success |
| **Web build** | **#275 — run ID `32976271438`** | 57s | **Success** |

## ⚠ But "Success" here does NOT satisfy §17-4

Job-level results for run `32976271438`, read individually rather than from the run badge:

| Job | Duration | Outcome |
|---|---|---|
| The lane resolves to exactly one of main or staging | 2s | ✅ ran |
| **Production lane build** | **0s** | **SKIPPED** |
| Staging lane build | 54s | ✅ ran |

**Only the staging lane executed.** §17-4 requires the isolation guard to pass on **both lanes with
host rules active**. A green run badge on a run whose production-lane job was skipped is exactly the
kind of evidence that reads as a pass and is not one.

**Step 4.4 is therefore NOT satisfied**, and neither is the §17-5 requirement to read the mutants-held
count from the *Web build job log* — that count comes from the production-lane job, which did not run.
(The harness was measured **21/21 locally on T**; the CI line remains open.)

---

# 3 — WHY STEP 4.3 IS UNAVOIDABLE

`.github/workflows/web-build.yml` **differs between the lanes**, and the difference is the whole point:

| | `main` (blob `35d5deb`) | `staging` (blob `75da28c`) |
|---|---|---|
| Lane jobs | production only | **production + staging** |
| `ISOLATION_FORBIDDEN_REFS` | `""` — **disarmed** | `ztzutckwdhetphwghuzj` (prod job) / `jtdtehuqtinjxropkkcn` (staging job) |
| `ISOLATION_EXPECTED_HOST` | **absent** | `cdn.50mmretina.com` / `cdn-staging.50mmretina.com` |
| `ISOLATION_FORBIDDEN_HOSTS` | **absent** | `cdn-staging…,staging…` / `cdn…,www…,https://50mmretina.com` |

**The armed workflow already exists — on `staging`.** It has never reached `main`.

That produces a closed loop:

- The **production lane job only runs on `main`** (it is skipped on staging pushes — proven above).
- **`main`'s workflow is disarmed**, so a production-lane run there proves nothing about host rules.
- §17-4 is checked **immediately before promotion**, so post-promotion arming is too late.

**Therefore `main`'s `web-build.yml` must be armed before promotion. That is step 4.3, and it cannot be
skipped or satisfied another way.**

### Good news on the mechanics

`main`'s copy is **unchanged since the merge base**, so the promotion merge takes staging's armed
version cleanly with no conflict in that file. Arming `main` early does not create a future conflict —
it simply brings forward a change the promotion would make anyway.

---

# 4 — PHASE 4 STATUS ON T

| Step | Status | Evidence |
|---|---|---|
| 4.1 Schema guard vs PRODUCTION | **BLOCKED** | Workflow not yet on `main`; dispatch-only workflows are unregistered until then |
| **4.2** Guard harness on T | ✅ **VERIFIED** | 41/41, 0 failed, on tree T |
| 4.3 Arm production-lane host rules | **REQUIRED — NOT STARTED** | Section 3 above |
| 4.4 Both lanes' CI on T, armed | **NOT SATISFIED** | Run `32976271438`: production lane **skipped** |
| **4.5** Isolation mutants on T | ⚠ **PARTIAL** | 21/21 measured locally on T; CI job-log count needs 4.3 first |
| 4.6 ACL remediation (staging only) | **NOT STARTED** | 76 anon / 52 authenticated grants; every statement needs review |
| 4.7 G8 freshness | **PARTIAL** | Bucket/CORS/public-access verified; bidirectional write-refusal re-test outstanding |
| 4.8(a) Zero Trust | ✅ **NOT APPLICABLE** | Cloudflare One not provisioned |
| 4.8(b) Skipped previews | **NOT STARTED** | |
| 4.9 §15.2 refusals N7/N8 | **NOT STARTED** | |
| **4.10** G7 residual | ✅ **VERIFIED** | staging robots.txt: `User-agent: * / Disallow: /` |
| 4.11 Edge-function inventory | ✅ **NOT APPLICABLE** | G9 excluded |

---

# THE NEXT ACTION — AND IT TOUCHES `main`

Step 4.3 requires editing `.github/workflows/web-build.yml` on **`main`**, which is protected
(PR required, force-push blocked, empty bypass list). It must go through a pull request.

**It is a change to production surface 1**, requires a §16 blast-radius classification and a Change
Ledger entry, and it is the gate for both 4.1 and 4.4.

*No secret value was displayed or recorded. The promotion dry-run was local only; nothing was pushed.*
