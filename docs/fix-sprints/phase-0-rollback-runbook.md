# Phase 0 — Rollback Runbook

> **Status:** Documentation only. No code, no DB, no finance mutations.
> **Scope:** Phase 0 Freeze & Guardrails (CI workflow + ESLint rule + baseline tag).
> **Audience:** Non-technical operator + future on-call engineer.

---

## 1. What Phase 0 Actually Shipped (Verified)

| # | Artifact | Path | State |
|---|----------|------|-------|
| 1 | CI workflow covering wallet + RLS globs | `.github/workflows/audit-forbidden.yml` (lines 36–39 run `rls-authority-scan.mjs` + `schema-drift-scan.mjs`) | ✅ already live |
| 2 | ESLint rule banning new `as any` in wallet/judging/admin/lib/edge | `eslint-rules/no-as-any-in-protected-dirs.js` + registered in `eslint.config.js` line 71 | ✅ already live |
| 3 | Baseline snapshot of pre-existing `as any` sites | `scripts/audits/baselines/as-any-protected-baseline.json` | ✅ already live |
| 4 | `v-pre-hardening` git tag | (annotated tag on current HEAD) | ⏸ deferred — operator action only, see §3 |
| 5 | Rollback runbook | this file | ✅ now live |
| 6 | Phase 0 completion report | `/mnt/documents/phase-0-completion-report.docx` | ✅ now live |

**Why no new CI / ESLint code was added in this Phase 0 closure:** items 1–3 were already shipped in earlier sprints (Sprint 0 Phase 0A + 0B-1). Re-adding them would duplicate the workflow steps and the ESLint rule registration, which would themselves fail CI. Per Forensic Mandate Rule 3 (no part checking) and Rule 4 (rollback plan required), we explicitly chose **not to write redundant guardrails**.

---

## 2. Rollback — If Phase 0 Ever Needs To Be Reverted

Phase 0 made **zero runtime changes**. Rollback is therefore trivial and **non-destructive**.

### 2a. Revert the CI guardrail extension
The wallet + RLS coverage lives in `.github/workflows/audit-forbidden.yml`. To temporarily disable:

1. Open `.github/workflows/audit-forbidden.yml`
2. Comment out lines 36–39 (the `rls-authority-scan` + `schema-drift-scan` steps)
3. Commit. CI will stop blocking on those scans.

**Impact:** PRs touching RLS / wallet schema will no longer be auto-flagged. No production impact. No DB impact.

### 2b. Revert the `no-as-any` ESLint rule
1. Open `eslint.config.js`
2. Remove the line `"audit-v6/no-as-any-in-protected-dirs": "error",`
3. Commit.

**Impact:** New `as any` casts in protected dirs will stop failing CI. No runtime impact.

### 2c. Revert the baseline file
Delete `scripts/audits/baselines/as-any-protected-baseline.json`. Only matters if 2b is **not** done (the rule reads the baseline at lint time). Standalone-safe.

### 2d. Revert the git tag (once created — see §3)
The operator runs:
```
git tag -d v-pre-hardening
git push --delete origin v-pre-hardening
```
**Impact:** None. Tags are pointers, not state.

---

## 3. Git Tag `v-pre-hardening` — Operator Instructions

> The Lovable agent cannot create git tags (stateful git commands are blocked by platform policy). The tag is **not a blocker** for Phase 0 closure — it is a convenience marker for future Phase 1 rollback. You can create it **any time before starting Phase 1**.

### Option A — From the Lovable UI (recommended, no terminal)
1. Open the project in Lovable
2. Top-right → **GitHub** icon → **Open in GitHub**
3. In GitHub, click **Releases** (right sidebar) → **Draft a new release**
4. **Choose a tag** → type `v-pre-hardening` → **Create new tag on publish**
5. **Target:** `main` (default)
6. **Release title:** `Pre-hardening baseline (Phase 0 freeze)`
7. **Description:** `Snapshot of repo before Phase 1 wallet/RLS hardening begins. Rollback target.`
8. Click **Publish release**

Done. The tag now exists on GitHub.

### Option B — Skip the tag entirely
Phase 1 rollback can use any of these instead:
- The auto-generated GitHub commit SHA of the last commit before Phase 1 starts
- Lovable's built-in **History** (clock icon, top-left) → revert to any previous version
- The PR-level revert button on each Phase 1 PR

**Recommendation:** Use Lovable History (Option B). It is the lowest-effort, lowest-risk rollback path and requires zero git knowledge.

---

## 4. Verification Checklist (Re-run Anytime)

| Check | Command / Location | Expected |
|-------|-------------------|----------|
| CI workflow has wallet/RLS scans | view `.github/workflows/audit-forbidden.yml` lines 36–39 | rls-authority-scan + schema-drift-scan present |
| ESLint rule registered | view `eslint.config.js` line 71 | `"audit-v6/no-as-any-in-protected-dirs": "error"` |
| Baseline file exists | view `scripts/audits/baselines/as-any-protected-baseline.json` | valid JSON with `entries[]` |
| Rule file exists | view `eslint-rules/no-as-any-in-protected-dirs.js` | exports default rule |

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Phase 0 changes break runtime | **0%** | — | Phase 0 is CI + docs only. No app code touched. |
| Phase 0 changes break DB | **0%** | — | No migration. No SQL. |
| Phase 0 changes break wallet | **0%** | — | No edge-function change. No finance mutation. |
| Git tag missing blocks Phase 1 rollback | low | low | Lovable History provides equivalent rollback (§3 Option B) |

---

## 6. Next Recommended Step

Begin **Phase 1 — Money & Schema (3 weeks, P0)** only after:
- This runbook is reviewed
- Either the `v-pre-hardening` tag is created **or** the operator confirms they will use Lovable History as the rollback path
- Phase 0 completion report is acknowledged

Phase 1 first task: single `wallet_transaction()` RPC + REVOKE direct writes on `wallet_ledger`. That is a P0 DB migration and **will** require a separate forensic plan + canary.
