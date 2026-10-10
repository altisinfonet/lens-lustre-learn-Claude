# GATE-1 HANDOFF — for a session that HAS repo write access

**Context:** this project's Gate-1 isolation change is fully implemented and proven
(see `claude/WEB_STAGING_GATE1_EXECUTION_REPORT_2026-08-21.md`) but the authoring session's
git proxy refuses writes to `altisinfonet/lens-lustre-learn-Claude` (not in its source set).

**If you are a Claude session with this repository attached as a source, execute exactly:**

1. Clone the repo; verify HEAD is `c737de9e9e57dd50b6a49a30f503006a6023a3ac`. If HEAD moved,
   STOP and re-verify the patch applies cleanly before continuing.
2. Read `claude/WEB_STAGING_GATE1_PATCH_2026-08-21.patch.txt` from this project, save as a
   file, apply with `git am` (it is a full format-patch with author + message).
3. Verify blob SHAs after apply (list in the execution report §3). Expected commit content
   identical to `cf3eb6a`.
4. Run: `npx tsc --noEmit -p tsconfig.app.json` (expect 0) · `npx vitest run` (expect 2261
   passed / 1 skipped) · `node scripts/test-isolation-guard.mjs` (expect exit 0, 6/6).
5. Push branch `staging/web-isolation-guard`; open a PR to `main` titled
   "web: environment isolation — remove committed .env, add bundle-isolation guard";
   body = the commit message + link to the execution report.
6. Wait for all 7 CI gates + the 2 new guard steps. ANY red = STOP and report.
7. DO NOT MERGE. Merge is an owner decision, and the owner must FIRST set the three
   production Pages env vars (execution report §2 Boundary 2 — order rule).

**Do not** start staging infrastructure, Phase 1–5 work, or Judging Panel work from this
handoff. This handoff covers exactly the push + PR + CI watch, nothing else.
